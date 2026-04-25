/* ============================================================
   HHpro - Shared UI helpers
   ------------------------------------------------------------
   Reusable building blocks shared across views. Right now just
   the dark top header (with optional breadcrumb); more helpers
   will land here in later steps as they come up more than once.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    HHpro.UI = {
        /**
         * Build the HHpro brand wordmark. Two spans inside a wrapper:
         *   - .brand-mark  ("HH")  - currentColor, bold
         *   - .brand-accent ("pro") - fixed brand-light blue, lighter weight
         * The element inherits font-size and color from its parent, so the
         * same helper works on the dark headers and the white login card.
         *
         * @returns {HTMLElement}
         */
        createLogo: function () {
            var wrap = document.createElement('span');
            wrap.className = 'brand-logo';

            var mark = document.createElement('span');
            mark.className = 'brand-mark';
            mark.textContent = 'HH';

            var accent = document.createElement('span');
            accent.className = 'brand-accent';
            accent.textContent = 'pro';

            wrap.appendChild(mark);
            wrap.appendChild(accent);
            return wrap;
        },

        /**
         * Build the dark top header used on every logged-in view.
         *
         * @param {string=} currentPage - optional breadcrumb label shown after the logo.
         *                                When omitted, the header shows just the logo
         *                                (as on the main overview page).
         * @returns {HTMLElement}
         */
        buildHeader: function (currentPage) {
            var header = document.createElement('header');
            header.className = 'app-header';

            var brandWrap = document.createElement('div');
            brandWrap.className = 'breadcrumb';

            var brand = document.createElement('button');
            brand.type = 'button';
            brand.className = 'breadcrumb-link';
            brand.appendChild(HHpro.UI.createLogo());
            brand.addEventListener('click', function () {
                HHpro.App.showView('main');
            });
            brandWrap.appendChild(brand);

            if (currentPage) {
                var sep = document.createElement('span');
                sep.className = 'breadcrumb-sep';
                sep.textContent = '›';
                brandWrap.appendChild(sep);

                var curr = document.createElement('span');
                curr.className = 'breadcrumb-current';
                curr.textContent = currentPage;
                brandWrap.appendChild(curr);
            }

            header.appendChild(brandWrap);

            var logout = document.createElement('button');
            logout.type = 'button';
            logout.className = 'header-action';
            logout.textContent = 'Log out';
            logout.addEventListener('click', function () {
                HHpro.State.logout();
                HHpro.App.showView('login');
            });
            header.appendChild(logout);

            return header;
        }
    };
})();