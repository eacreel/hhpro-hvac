/* ============================================================
   HHpro - Main overview view
   ------------------------------------------------------------
   The landing page shown after login. A grid of tiles:
     - Projects (top-left, distinct styling) -> 'projects' view
     - One tile per product type               -> 'product' view

   The cart panel (HHpro.Cart) shows on this view too once
   initialized, so users can see their progress from here.
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    HHpro.Views.main = {
        render: function (root) {
            root.innerHTML = '';
            // Leaving the login screen - unhide the cart UI (login.js
            // sets this class; main is the only view login routes to).
            document.body.classList.remove('login-active');
            // The cart panel/toggle should appear on the main overview
            // too, not just on product pages.
            if (HHpro.Cart && typeof HHpro.Cart.init === 'function') {
                HHpro.Cart.init();
            }
            root.appendChild(buildHeader());
            root.appendChild(buildBody());
        }
    };

    function buildHeader() {
        var header = document.createElement('header');
        header.className = 'app-header';

        var brand = document.createElement('div');
        brand.className = 'app-header-brand';
        brand.appendChild(HHpro.UI.createLogo());
        header.appendChild(brand);

        header.appendChild(HHpro.UI.createLookupInput());

        // Logout button on the right. Later steps may add additional
        // header actions alongside this one.
        var logoutBtn = document.createElement('button');
        logoutBtn.type = 'button';
        logoutBtn.className = 'header-action';
        logoutBtn.appendChild(HHpro.UI.icon('log-out'));
        var logoutLabel = document.createElement('span');
        logoutLabel.textContent = 'Log out';
        logoutBtn.appendChild(logoutLabel);
        logoutBtn.addEventListener('click', function () {
            HHpro.State.logout();
            HHpro.App.showView('login');
        });
        header.appendChild(logoutBtn);

        return header;
    }

    function buildBody() {
        var main = document.createElement('main');
        main.className = 'app-main main-view';

        var title = document.createElement('h2');
        title.className = 'main-title';
        title.textContent = 'Select Projects or a product type to get started';
        main.appendChild(title);

        // Action tiles row: prominent shortcuts above the product grid.
        // Centered as a flex row so the two tiles sit together regardless
        // of viewport width.
        var projectsRow = document.createElement('div');
        projectsRow.className = 'projects-row';
        projectsRow.appendChild(createProjectsTile());
        projectsRow.appendChild(createDesignSearchTile());
        main.appendChild(projectsRow);

        // Product grid: one tile per product type, laid out in the same
        // responsive auto-fill grid as before.
        var grid = document.createElement('div');
        grid.className = 'tile-grid';
        HHpro.Data.getProducts().forEach(function (product) {
            grid.appendChild(createProductTile(product));
        });
        main.appendChild(grid);

        return main;
    }

    function createProjectsTile() {
        var tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile tile-projects tile-projects-compact';

        var body = document.createElement('div');
        body.className = 'tile-body';

        // Icon + text span (rather than bare textContent) so the label's
        // flex layout can space the two with a gap.
        var label = document.createElement('h3');
        label.className = 'tile-label';
        label.appendChild(HHpro.UI.icon('folder'));
        var labelText = document.createElement('span');
        labelText.textContent = 'Projects';
        label.appendChild(labelText);

        var sublabel = document.createElement('p');
        sublabel.className = 'tile-sublabel';
        sublabel.textContent = 'Open or create a project';

        body.appendChild(label);
        body.appendChild(sublabel);
        tile.appendChild(body);

        tile.addEventListener('click', function () {
            HHpro.App.showView('projects');
        });

        return tile;
    }

    function createDesignSearchTile() {
        var tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile tile-design-search tile-projects-compact';

        var body = document.createElement('div');
        body.className = 'tile-body';

        var label = document.createElement('h3');
        label.className = 'tile-label';
        label.appendChild(HHpro.UI.icon('search'));
        var labelText = document.createElement('span');
        labelText.textContent = 'Design Search';
        label.appendChild(labelText);

        var sublabel = document.createElement('p');
        sublabel.className = 'tile-sublabel';
        sublabel.textContent = 'Find equipment by design loads';

        body.appendChild(label);
        body.appendChild(sublabel);
        tile.appendChild(body);

        tile.addEventListener('click', function () {
            HHpro.App.showView('design_search');
        });

        return tile;
    }

    function createProductTile(product) {
        var tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile ' + product.tileClass;

        var image = document.createElement('div');
        image.className = 'tile-image';
        // Default label shown until a real JPG loads (or permanently, if
        // none exists). The product name reads as an intentional text
        // card rather than a broken-looking 'Placeholder'.
        image.textContent = product.displayName;

        // Try to swap in the real picture if one exists at the expected path.
        // If the load fails (missing file), leave the text placeholder as-is.
        var img = new Image();
        img.alt = product.displayName;
        img.onload = function () {
            image.textContent = '';
            image.appendChild(img);
        };
        img.src = product.pictureFile;

        var body = document.createElement('div');
        body.className = 'tile-body';

        var label = document.createElement('h3');
        label.className = 'tile-label';
        label.textContent = product.displayName;

        body.appendChild(label);
        tile.appendChild(image);
        tile.appendChild(body);

        tile.addEventListener('click', function () {
            HHpro.App.showView('product', { productKey: product.productKey });
        });

        return tile;
    }
})();