/* ============================================================
   HHpro - State module
   ------------------------------------------------------------
   Holds all shared application state. The signed-in person's
   profile (who they are, which templates and products they may
   use) comes from the backend at sign-in and is cached in
   localStorage so a refresh or a new tab paints instantly; the
   app re-checks it against the server in the background.

   The backend is the authority. Nothing here grants access on
   its own; it only remembers what the server said.
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};

    var STORAGE_KEY = 'hhpro.session';

    // Standard (Hoffman & Hoffman) layout, always available.
    var DEFAULT_ENGINEER = 'hoffman';

    function loadSession() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            return (parsed && parsed.user && parsed.user.email) ? parsed : null;
        } catch (e) {
            return null;
        }
    }

    var state = {
        // Profile as returned by /api/auth/me:
        //   { user, allowedEngineers, defaultEngineer, blockedProducts,
        //     canManageUsers, contactEmail }
        session: loadSession(),

        // Placeholders for later steps. Listed here so the shape of the
        // state object is visible in one place.
        currentProject: null,
        cart: []
    };

    HHpro.State = {
        isLoggedIn: function () {
            return !!state.session;
        },

        /** Remember the profile the server just sent. */
        setSession: function (profile) {
            state.session = (profile && profile.user) ? profile : null;
            try {
                if (state.session) localStorage.setItem(STORAGE_KEY, JSON.stringify(state.session));
                else localStorage.removeItem(STORAGE_KEY);
            } catch (e) { /* non-fatal */ }
        },

        getSession: function () {
            return state.session;
        },

        /** The signed-in person, or null. */
        getUser: function () {
            return state.session ? state.session.user : null;
        },

        /** Short display name, e.g. "Eric Creel". */
        getUserName: function () {
            var u = this.getUser();
            if (!u) return '';
            return ((u.firstName || '') + ' ' + (u.lastName || '')).trim() || u.email;
        },

        canManageUsers: function () {
            return !!(state.session && state.session.canManageUsers);
        },

        getContactEmail: function () {
            return (state.session && state.session.contactEmail) || 'eric.creel@hoffman-hoffman.com';
        },

        /**
         * Engineer-template access for the current login. Returns a copy
         * of the allowed engineer keys (always at least ['hoffman']).
         */
        getAllowedEngineers: function () {
            var list = state.session && state.session.allowedEngineers;
            var arr = (Array.isArray(list) && list.length) ? list.slice() : [DEFAULT_ENGINEER];
            if (arr.indexOf(DEFAULT_ENGINEER) === -1) arr.unshift(DEFAULT_ENGINEER);
            return arr;
        },

        isEngineerAllowed: function (key) {
            return this.getAllowedEngineers().indexOf(key) !== -1;
        },

        /** The layout a new project starts on: the firm's own for Engineers, else standard. */
        getDefaultEngineer: function () {
            var key = state.session && state.session.defaultEngineer;
            return (key && this.isEngineerAllowed(key)) ? key : DEFAULT_ENGINEER;
        },

        /** Products hidden for this person's location come from the Permissions tab. */
        isProductAllowed: function (displayName) {
            var blocked = state.session && state.session.blockedProducts;
            if (!Array.isArray(blocked)) return true;
            return blocked.indexOf(displayName) === -1;
        },

        /** Forget the local copy of the session. The API call is App.logout's job. */
        logout: function () {
            this.setSession(null);
            state.currentProject = null;
            state.cart = [];
        }
    };
})();
