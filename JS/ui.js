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

    // ----- Inline icon set (Lucide paths) -----
    // Each entry is an array of child <tag, attrs> descriptors that render
    // inside a 24x24 stroked SVG. We inline only the icons we actually use
    // so there's no external dep; adding a new icon means dropping its
    // path data here and calling HHpro.UI.icon('name').
    var SVG_NS = 'http://www.w3.org/2000/svg';
    var ICONS = {
        'plus': [
            ['line', { x1: 12, y1: 5, x2: 12, y2: 19 }],
            ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }]
        ],
        'x': [
            ['line', { x1: 18, y1: 6, x2: 6, y2: 18 }],
            ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]
        ],
        'search': [
            ['circle', { cx: 11, cy: 11, r: 8 }],
            ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }]
        ],
        'arrow-left': [
            ['line', { x1: 19, y1: 12, x2: 5, y2: 12 }],
            ['polyline', { points: '12 19 5 12 12 5' }]
        ],
        'log-out': [
            ['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4' }],
            ['polyline', { points: '16 17 21 12 16 7' }],
            ['line', { x1: 21, y1: 12, x2: 9, y2: 12 }]
        ],
        'file-text': [
            ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
            ['polyline', { points: '14 2 14 8 20 8' }],
            ['line', { x1: 16, y1: 13, x2: 8, y2: 13 }],
            ['line', { x1: 16, y1: 17, x2: 8, y2: 17 }]
        ],
        'folder': [
            ['path', { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' }]
        ],
        'shopping-cart': [
            ['circle', { cx: 9, cy: 21, r: 1 }],
            ['circle', { cx: 20, cy: 21, r: 1 }],
            ['path', { d: 'M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6' }]
        ],
        'file-plus': [
            ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
            ['polyline', { points: '14 2 14 8 20 8' }],
            ['line', { x1: 12, y1: 18, x2: 12, y2: 12 }],
            ['line', { x1: 9, y1: 15, x2: 15, y2: 15 }]
        ],
        'upload': [
            ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
            ['polyline', { points: '17 8 12 3 7 8' }],
            ['line', { x1: 12, y1: 3, x2: 12, y2: 15 }]
        ],
        'download': [
            ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
            ['polyline', { points: '7 10 12 15 17 10' }],
            ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }]
        ],
        'alert-triangle': [
            ['path', { d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }],
            ['line', { x1: 12, y1: 9, x2: 12, y2: 13 }],
            ['line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }]
        ],
        'undo': [
            ['path', { d: 'M9 14L4 9l5-5' }],
            ['path', { d: 'M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11' }]
        ],
        'redo': [
            ['path', { d: 'M15 14l5-5-5-5' }],
            ['path', { d: 'M20 9H9.5A5.5 5.5 0 0 0 4 14.5v0A5.5 5.5 0 0 0 9.5 20H13' }]
        ],
        // Drawn by the export "draw-in" confirmation (HHpro.FX.flashSuccess).
        'check': [
            ['polyline', { points: '20 6 9 17 4 12' }]
        ],
        // 2x3 dot grid used as a drag handle (lucide "grip-vertical")
        'grip': [
            ['circle', { cx: '9', cy: '5', r: '1' }],
            ['circle', { cx: '9', cy: '12', r: '1' }],
            ['circle', { cx: '9', cy: '19', r: '1' }],
            ['circle', { cx: '15', cy: '5', r: '1' }],
            ['circle', { cx: '15', cy: '12', r: '1' }],
            ['circle', { cx: '15', cy: '19', r: '1' }]
        ],
        // Two overlapping squares (lucide "copy") - duplicate action
        'copy': [
            ['rect', { x: '9', y: '9', width: '13', height: '13', rx: '2', ry: '2' }],
            ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]
        ]
    };

    HHpro.UI = {
        /**
         * Build an inline SVG icon. Sized via CSS (.icon class scales to 1em
         * so icons follow the surrounding font-size). The icon strokes use
         * currentColor so they recolor with the parent's text color.
         *
         * @param {string} name - key into the ICONS table above
         * @returns {SVGElement}
         */
        icon: function (name) {
            var children = ICONS[name];
            if (!children) {
                console.warn('HHpro.UI.icon: unknown icon "' + name + '"');
                children = [];
            }
            var svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', 'currentColor');
            svg.setAttribute('stroke-width', '2');
            svg.setAttribute('stroke-linecap', 'round');
            svg.setAttribute('stroke-linejoin', 'round');
            svg.setAttribute('aria-hidden', 'true');
            svg.classList.add('icon');
            children.forEach(function (def) {
                var tag = def[0];
                var attrs = def[1];
                var el = document.createElementNS(SVG_NS, tag);
                Object.keys(attrs).forEach(function (k) {
                    el.setAttribute(k, String(attrs[k]));
                });
                svg.appendChild(el);
            });
            return svg;
        },
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
         * Build the model-lookup search input shown in the app header.
         * Returns a wrapper div containing the icon + input, with the
         * QuickLookup behavior already attached.
         *
         * @returns {HTMLElement}
         */
        createLookupInput: function () {
            var wrap = document.createElement('div');
            wrap.className = 'quick-lookup';

            var icon = HHpro.UI.icon('search');
            icon.classList.add('quick-lookup-icon');
            wrap.appendChild(icon);

            var input = document.createElement('input');
            input.type = 'search';
            input.className = 'quick-lookup-input';
            input.placeholder = 'Find a model number...';
            input.setAttribute('aria-label', 'Find a model number');
            wrap.appendChild(input);

            // Defer the attach until QuickLookup is loaded (script order
            // already places it before this view code runs, but guard
            // anyway so a stray load order doesn't blow up the header).
            if (HHpro.QuickLookup && typeof HHpro.QuickLookup.attach === 'function') {
                HHpro.QuickLookup.attach(input);
            }
            return wrap;
        },

        /**
         * "User Guide" header button - opens the PDF guide in a new tab.
         * Shared by the main-overview header (main.js) and the standard
         * header below so both stay in sync.
         *
         * @returns {HTMLElement}
         */
        createUserGuideButton: function () {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'header-action';
            btn.appendChild(HHpro.UI.icon('file-text'));
            var label = document.createElement('span');
            label.textContent = 'User Guide';
            btn.appendChild(label);
            btn.addEventListener('click', function () {
                // encodeURI handles the space in the filename
                window.open(encodeURI('ASSETS/HHpro User Guide.pdf'), '_blank', 'noopener');
            });
            return btn;
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

            header.appendChild(HHpro.UI.createLookupInput());

            var actions = document.createElement('div');
            actions.className = 'header-actions';

            actions.appendChild(HHpro.UI.createUserGuideButton());

            var logout = document.createElement('button');
            logout.type = 'button';
            logout.className = 'header-action';
            logout.appendChild(HHpro.UI.icon('log-out'));
            var logoutLabel = document.createElement('span');
            logoutLabel.textContent = 'Log out';
            logout.appendChild(logoutLabel);
            logout.addEventListener('click', function () {
                HHpro.State.logout();
                HHpro.App.showView('login');
            });
            actions.appendChild(logout);

            header.appendChild(actions);

            return header;
        }
    };
})();