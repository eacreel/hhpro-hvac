/* ============================================================
   HHpro - Main overview view
   ------------------------------------------------------------
   The landing page shown after login. A grid of tiles:
     - Projects (top-left, distinct styling) -> 'projects' view
     - Cook Select / Price Select logo links (new tab)
     - One tile per product type               -> 'product' view
   Calculators-only accounts (Manufacturer) get the Calculators
   tile alone.

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
        brand.appendChild(HHpro.UI.createHeaderBrand());
        header.appendChild(brand);

        header.appendChild(HHpro.UI.createLookupInput());

        // Header actions on the right: What's New, User Guide, Users
        // (admins only), Log out. Shared with HHpro.UI.buildHeader so
        // both stay in sync.
        var actions = document.createElement('div');
        actions.className = 'header-actions';

        var whatsNewBtn = HHpro.UI.createWhatsNewButton();
        if (whatsNewBtn) actions.appendChild(whatsNewBtn);
        actions.appendChild(HHpro.UI.createUserGuideButton());
        var usersBtn = HHpro.UI.createUsersButton();
        if (usersBtn) actions.appendChild(usersBtn);
        actions.appendChild(HHpro.UI.createLogoutButton());

        header.appendChild(actions);

        return header;
    }

    function buildBody() {
        var main = document.createElement('main');
        main.className = 'app-main main-view';

        // Manufacturer accounts see the Calculators tile and nothing else.
        var calcOnly = HHpro.State.isCalculatorsOnly();

        var title = document.createElement('h2');
        title.className = 'main-title hh-dimline';
        title.textContent = calcOnly
            ? 'Select Calculators to get started'
            : 'Select Projects or a product type to get started';
        main.appendChild(title);

        // Action tiles row: prominent shortcuts above the product grid.
        // Centered as a flex row so the two tiles sit together regardless
        // of viewport width.
        var projectsRow = document.createElement('div');
        projectsRow.className = 'projects-row';
        if (!calcOnly) {
            projectsRow.appendChild(createProjectsTile());
            projectsRow.appendChild(createDesignSearchTile());
        }
        projectsRow.appendChild(createCalculatorsTile());
        main.appendChild(projectsRow);

        // Manufacturer selection program links, centered under the action
        // tiles. Hidden from calculators-only (Manufacturer) accounts along
        // with everything else engineer-facing.
        var selectLinks = calcOnly ? null : buildSelectLinks();
        if (selectLinks) main.appendChild(selectLinks);

        // Product grid: one tile per product type, laid out in the same
        // responsive auto-fill grid as before.
        var grid = null;
        if (!calcOnly) {
            grid = document.createElement('div');
            grid.className = 'tile-grid';
            HHpro.Data.getProducts().forEach(function (product) {
                grid.appendChild(createProductTile(product));
            });
            main.appendChild(grid);
        }

        // Soft staggered reveal as the overview paints in.
        if (HHpro.FX && HHpro.FX.staggerReveal) {
            HHpro.FX.staggerReveal(projectsRow);
            // The logo row reveals as one piece just after the action tiles
            // (revealing the links themselves would pin their transform and
            // cancel the hover lift).
            if (selectLinks) {
                selectLinks.style.setProperty('--reveal-delay', '135ms');
                selectLinks.classList.add('hh-reveal');
            }
            if (grid) HHpro.FX.staggerReveal(grid);
        }

        if (HHpro.UI.buildPrivacyFooter) {
            main.appendChild(HHpro.UI.buildPrivacyFooter());
        }

        return main;
    }

    // Manufacturer selection programs engineers can sign in to or register
    // for. Each logo sits on a card in the background it was drawn for (the
    // Price logo is navy, Cook's is red and white), and both images render
    // at the same height (main.css .select-link img). Links open in a new tab.
    var SELECTION_PROGRAMS = [
        {
            name: 'Cook Select',
            url: 'https://cookselect.lorencook.com/login',
            logo: 'DATA/PICTURES/red-white-cook-select-logo.svg',
            cardClass: 'select-link-dark'
        },
        {
            name: 'Price Select',
            // Price's sign-in page (Customer / Employee, with registration).
            // Don't paste a URL copied from the address bar mid-login: those
            // carry a one-time, IP-stamped state token that expires.
            url: 'https://sso.priceindustries.com/am/XUI/?realm=/alpha#/',
            logo: 'DATA/PICTURES/Price_Logo_Blue.svg',
            cardClass: 'select-link-light'
        }
    ];

    function buildSelectLinks() {
        var section = document.createElement('section');
        section.className = 'select-links';
        section.setAttribute('aria-label', 'Manufacturer selection programs');

        var heading = document.createElement('p');
        heading.className = 'select-links-title';
        heading.textContent = 'Manufacturer selection programs';
        section.appendChild(heading);

        var row = document.createElement('div');
        row.className = 'select-links-row';
        SELECTION_PROGRAMS.forEach(function (program) {
            var hint = 'Click to open or register for ' + program.name;

            var link = document.createElement('a');
            link.className = 'select-link ' + program.cardClass;
            link.href = program.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.setAttribute('aria-label', hint + ' (opens in a new tab)');

            var img = document.createElement('img');
            img.src = program.logo;
            img.alt = program.name;
            link.appendChild(img);

            // Hover / keyboard-focus hint; the aria-label already says it
            // for screen readers.
            var tip = document.createElement('span');
            tip.className = 'select-link-tip';
            tip.setAttribute('aria-hidden', 'true');
            tip.textContent = hint;
            link.appendChild(tip);

            row.appendChild(link);
        });
        section.appendChild(row);

        return section;
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

        // Badge for projects others have shared that this person hasn't
        // looked at yet; filled in now and again once projects load.
        var shared = document.createElement('span');
        shared.className = 'tile-shared-badge';
        shared.hidden = true;
        tile.appendChild(shared);
        updateSharedBadge(tile);

        tile.addEventListener('click', function () {
            HHpro.App.showView('projects');
        });

        return tile;
    }

    /**
     * Show or hide the shared-projects badge on the Projects tile. The
     * badge clears itself: opening Projects (or the shared project)
     * marks them seen in HHpro.Cart.
     */
    function updateSharedBadge(tile) {
        var badge = tile.querySelector('.tile-shared-badge');
        var sublabel = tile.querySelector('.tile-sublabel');
        if (!badge) return;
        var n = HHpro.Cart && HHpro.Cart.countNewShared ? HHpro.Cart.countNewShared() : 0;
        badge.hidden = !n;
        tile.classList.toggle('tile-has-shared', !!n);
        if (n) {
            var text = n + (n === 1 ? ' project' : ' projects') + ' shared with you';
            badge.textContent = '';
            badge.appendChild(HHpro.UI.icon('users'));
            var count = document.createElement('span');
            count.textContent = n;
            badge.appendChild(count);
            badge.title = text;
            tile.setAttribute('aria-label', 'Projects: ' + text);
            if (sublabel) sublabel.textContent = text;
        } else {
            tile.removeAttribute('aria-label');
            if (sublabel) sublabel.textContent = 'Open or create a project';
        }
    }

    // Projects arrive from the server after the overview has painted.
    document.addEventListener('hhpro:projects-loaded', function () {
        var tile = document.querySelector('.tile-projects');
        if (tile) updateSharedBadge(tile);
    });

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

    function createCalculatorsTile() {
        var tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tile tile-calculators tile-projects-compact';

        var body = document.createElement('div');
        body.className = 'tile-body';

        var label = document.createElement('h3');
        label.className = 'tile-label';
        label.appendChild(HHpro.UI.icon('calculator'));
        var labelText = document.createElement('span');
        labelText.textContent = 'Calculators';
        label.appendChild(labelText);

        var sublabel = document.createElement('p');
        sublabel.className = 'tile-sublabel';
        sublabel.textContent = 'Psychrometrics and HVAC calculations';

        body.appendChild(label);
        body.appendChild(sublabel);
        tile.appendChild(body);

        tile.addEventListener('click', function () {
            HHpro.App.showView('calculators');
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