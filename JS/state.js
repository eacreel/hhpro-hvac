/* ============================================================
   HHpro - State module
   ------------------------------------------------------------
   Holds all shared application state. Persists selected pieces
   to sessionStorage so page refreshes don't bounce the user
   back to the login screen in the middle of a session. Saved
   projects (later step) will use localStorage instead.
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};

    var STORAGE_KEYS = {
        loggedIn: 'hhpro.loggedIn',
        allowedEngineers: 'hhpro.allowedEngineers'
    };

    // Every login can see the standard (Hoffman & Hoffman) layout; an
    // engineer-specific password unlocks additional firm templates.
    var DEFAULT_ALLOWED = ['hoffman'];

    function loadAllowedEngineers() {
        try {
            var raw = sessionStorage.getItem(STORAGE_KEYS.allowedEngineers);
            if (!raw) return DEFAULT_ALLOWED.slice();
            var parsed = JSON.parse(raw);
            return (Array.isArray(parsed) && parsed.length) ? parsed : DEFAULT_ALLOWED.slice();
        } catch (e) {
            return DEFAULT_ALLOWED.slice();
        }
    }

    var state = {
        loggedIn: sessionStorage.getItem(STORAGE_KEYS.loggedIn) === 'true',

        // Engineer-template keys this session is allowed to use. Set at
        // login from the password and persisted so a refresh keeps the
        // same access. Always includes 'hoffman' (the standard layout).
        allowedEngineers: loadAllowedEngineers(),

        // Placeholders for later steps. Listed here so the shape of the
        // state object is visible in one place.
        currentProject: null,
        cart: []
    };

    HHpro.State = {
        isLoggedIn: function () {
            return state.loggedIn === true;
        },

        setLoggedIn: function (value) {
            state.loggedIn = !!value;
            if (state.loggedIn) {
                sessionStorage.setItem(STORAGE_KEYS.loggedIn, 'true');
            } else {
                sessionStorage.removeItem(STORAGE_KEYS.loggedIn);
            }
        },

        /**
         * Engineer-template access for the current login. Returns a copy
         * of the allowed engineer keys (always at least ['hoffman']).
         */
        getAllowedEngineers: function () {
            return (state.allowedEngineers && state.allowedEngineers.length)
                ? state.allowedEngineers.slice() : DEFAULT_ALLOWED.slice();
        },

        setAllowedEngineers: function (list) {
            var arr = Array.isArray(list) && list.length ? list.slice() : DEFAULT_ALLOWED.slice();
            // Standard layout is always available.
            if (arr.indexOf('hoffman') === -1) arr.unshift('hoffman');
            state.allowedEngineers = arr;
            try {
                sessionStorage.setItem(STORAGE_KEYS.allowedEngineers, JSON.stringify(arr));
            } catch (e) { /* non-fatal */ }
        },

        isEngineerAllowed: function (key) {
            return this.getAllowedEngineers().indexOf(key) !== -1;
        },

        logout: function () {
            this.setLoggedIn(false);
            state.allowedEngineers = DEFAULT_ALLOWED.slice();
            try { sessionStorage.removeItem(STORAGE_KEYS.allowedEngineers); } catch (e) { /* noop */ }
            state.currentProject = null;
            state.cart = [];
        }
    };
})();