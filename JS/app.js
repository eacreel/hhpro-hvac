/* ============================================================
   HHpro - App entry point and router
   ------------------------------------------------------------
   Registers views and decides which one to show on page load.
   Other modules register themselves onto HHpro.Views (keyed by
   name), and any code that wants to navigate just calls
   HHpro.App.showView('viewName').
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
        }
    };

    function init() {
        if (HHpro.State.isLoggedIn()) {
            HHpro.App.showView('main');
        } else {
            HHpro.App.showView('login');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();