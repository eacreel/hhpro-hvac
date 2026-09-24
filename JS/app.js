/* ============================================================
   HHpro - App entry point and router
   ------------------------------------------------------------
   Registers views and decides which one to show on page load.
   Other modules register themselves onto HHpro.Views (keyed by
   name), and any code that wants to navigate just calls
   HHpro.App.showView('viewName').

   On load:
     - a #register/<token> link opens the registration screen
     - otherwise the cached session (if any) paints the main
       page at once while /api/auth/me confirms it in the
       background; no cached session means a quick check of the
       cookie, then main or login.
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};

    function root() {
        return document.getElementById('app-root');
    }

    // -----------------------------------------------------------------
    // Browser history
    // -----------------------------------------------------------------
    // Every showView() call records a history entry, so the browser's
    // Back / Forward buttons move between the site's own pages instead
    // of leaving the site (there used to be a single entry for the whole
    // session). The address bar is left alone: the entry's state carries
    // { view, id } and the view's params stay in memory under that id,
    // so params that are not structured-cloneable are safe. Rules:
    //   - re-rendering the SAME view with the same params (project_view
    //     does this after every edit) replaces the entry, never stacks
    //   - the sign-in / registration screens never pile up, and the page
    //     shown right after them replaces them, so Back from the main
    //     page does not land on a stale sign-in form
    //   - a popped entry is re-checked against the session: signed out
    //     -> sign-in; signed in but the entry is a sign-in screen -> main
    var HIST_TAG = 'hhpro';
    var AUTH_VIEWS = { login: true, register: true };
    var paramsById = {};
    var nextId = 1;
    var current = null;     // { id, view, sig } of the entry on screen

    function sig(viewName, params) {
        try { return viewName + '|' + JSON.stringify(params || {}); }
        catch (e) { return viewName + '|?'; }
    }

    function recordHistory(viewName, params, replace) {
        var s = sig(viewName, params);
        var same = !!(current && current.sig === s);
        var useReplace = replace || same || !current ||
            AUTH_VIEWS[viewName] || AUTH_VIEWS[current.view];
        var id = same ? current.id : nextId++;
        paramsById[id] = params;
        var entry = { tag: HIST_TAG, id: id, view: viewName };
        try {
            if (useReplace) history.replaceState(entry, '');
            else history.pushState(entry, '');
        } catch (e) { /* history unavailable: navigation still works */ }
        current = { id: id, view: viewName, sig: s };
    }

    // Calculators-only accounts (Manufacturer) reach the overview, the
    // Calculators hub, each calculator and the privacy page; any other
    // view (products, Projects, Design Search, Users) lands on the
    // overview instead.
    var CALC_ONLY_VIEWS = { main: true, calculators: true, privacy: true };

    function viewAllowed(viewName) {
        if (AUTH_VIEWS[viewName] || !HHpro.State || !HHpro.State.isCalculatorsOnly()) return true;
        if (CALC_ONLY_VIEWS[viewName]) return true;
        var calcs = HHpro.Calculators ? HHpro.Calculators.list() : [];
        for (var i = 0; i < calcs.length; i++) if (calcs[i].view === viewName) return true;
        return false;
    }

    function onPopState(e) {
        var st = e.state;
        var loggedIn = !!(HHpro.State && HHpro.State.isLoggedIn());
        if (!st || st.tag !== HIST_TAG) {
            // An entry from before the app took over (e.g. the one the
            // registration link replaced) - land on the right start page.
            HHpro.App.showView(loggedIn ? 'main' : 'login', {}, { replace: true });
            return;
        }
        if (!loggedIn && !AUTH_VIEWS[st.view]) {
            HHpro.App.showView('login', {}, { replace: true });
            return;
        }
        if (loggedIn && AUTH_VIEWS[st.view]) {
            HHpro.App.showView('main', {}, { replace: true });
            return;
        }
        var params = paramsById[st.id] || {};
        HHpro.App.showView(st.view, params, {
            fromHistory: { id: st.id, view: st.view, sig: sig(st.view, params) }
        });
    }

    HHpro.App = {
        /**
         * Render a view. opts (optional):
         *   replace     - overwrite the current history entry instead of
         *                 adding one (start pages, redirects)
         *   fromHistory - internal: the entry being restored by Back /
         *                 Forward, so no new entry is recorded
         */
        showView: function (viewName, params, opts) {
            var view = (HHpro.Views || {})[viewName];
            if (!view || typeof view.render !== 'function') {
                console.error('HHpro.App: unknown view "' + viewName + '"');
                return;
            }
            params = params || {};
            opts = opts || {};
            if (!viewAllowed(viewName)) {
                HHpro.App.showView('main', {}, { replace: true });
                return;
            }
            // Hides the cart (cart.css) for calculators-only accounts.
            document.body.classList.toggle('calculators-only', !!(HHpro.State && HHpro.State.isCalculatorsOnly()));
            view.render(root(), params);
            if (opts.fromHistory) {
                current = opts.fromHistory;
                return;
            }
            recordHistory(viewName, params, !!opts.replace);
        },

        /** End the session on the server, forget it locally, back to sign-in. */
        logout: function () {
            var done = function () {
                HHpro.State.logout();
                HHpro.App.showView('login');
            };
            HHpro.Api.post('/api/auth/logout').then(done, done);
        },

        /** Re-check the session with the server; bounce to login if it is gone. */
        refreshSession: function () {
            return HHpro.Api.get('/api/auth/me').then(function (profile) {
                var wasCalcOnly = HHpro.State.isCalculatorsOnly();
                HHpro.State.setSession(profile);
                // The page was painted from the cached profile; if the
                // account's level has since moved into or out of
                // calculators-only, repaint the overview to match.
                if (HHpro.State.isCalculatorsOnly() !== wasCalcOnly) {
                    HHpro.App.showView('main', {}, { replace: true });
                }
                return profile;
            }, function (err) {
                if (err.status === 401) {
                    HHpro.State.logout();
                    HHpro.App.showView('login', { message: 'Your session ended. Please sign in again.' });
                }
                // Network trouble: keep going on the cached profile.
                return null;
            });
        }
    };

    function registrationToken() {
        var m = /^#register\/([A-Za-z0-9_-]{20,})$/.exec(window.location.hash || '');
        return m ? m[1] : null;
    }

    function init() {
        var token = registrationToken();
        if (token) {
            // Drop the token from the address bar so it is not kept in
            // history or bookmarked; the view holds it in memory.
            try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* noop */ }
            HHpro.App.showView('register', { token: token });
            return;
        }

        if (HHpro.State.isLoggedIn()) {
            HHpro.App.showView('main');
            HHpro.App.refreshSession();
            return;
        }

        // No cached profile in this browser. The cookie may still be
        // valid (localStorage cleared, or first visit after go-live),
        // so ask the server before showing the sign-in form.
        HHpro.App.showView('login', { checking: true });
        HHpro.Api.get('/api/auth/me').then(function (profile) {
            HHpro.State.setSession(profile);
            HHpro.App.showView('main');
        }, function () {
            HHpro.App.showView('login');
        });
    }

    window.addEventListener('popstate', onPopState);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
