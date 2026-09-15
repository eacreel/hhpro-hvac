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

    HHpro.App = {
        showView: function (viewName, params) {
            var view = (HHpro.Views || {})[viewName];
            if (!view || typeof view.render !== 'function') {
                console.error('HHpro.App: unknown view "' + viewName + '"');
                return;
            }
            view.render(root(), params || {});
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
                HHpro.State.setSession(profile);
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
