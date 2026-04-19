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
        loggedIn: 'hhpro.loggedIn'
    };

    var state = {
        loggedIn: sessionStorage.getItem(STORAGE_KEYS.loggedIn) === 'true',

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

        logout: function () {
            this.setLoggedIn(false);
            state.currentProject = null;
            state.cart = [];
        }
    };
})();