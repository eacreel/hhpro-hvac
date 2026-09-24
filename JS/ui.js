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
        ],
        'calculator': [
            ['rect', { x: 4, y: 2, width: 16, height: 20, rx: 2 }],
            ['line', { x1: 8, y1: 6, x2: 16, y2: 6 }],
            ['line', { x1: 16, y1: 14, x2: 16, y2: 18 }],
            ['path', { d: 'M16 10h.01' }],
            ['path', { d: 'M12 10h.01' }],
            ['path', { d: 'M8 10h.01' }],
            ['path', { d: 'M12 14h.01' }],
            ['path', { d: 'M8 14h.01' }],
            ['path', { d: 'M12 18h.01' }],
            ['path', { d: 'M8 18h.01' }]
        ],
        'thermometer': [
            ['path', { d: 'M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z' }]
        ],
        // Users screen (header button + row actions)
        'users': [
            ['path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }],
            ['circle', { cx: 9, cy: 7, r: 4 }],
            ['path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }],
            ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }]
        ],
        'mail': [
            ['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }],
            ['path', { d: 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7' }]
        ],
        'edit': [
            ['path', { d: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z' }]
        ],
        'trash': [
            ['polyline', { points: '3 6 5 6 21 6' }],
            ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }]
        ],
        // Slide-rule wheel (Ductulator calculator card)
        'dial': [
            ['circle', { cx: 12, cy: 12, r: 10 }],
            ['circle', { cx: 12, cy: 12, r: 5.5 }],
            ['line', { x1: 12, y1: 2, x2: 12, y2: 6.5 }],
            ['line', { x1: 12, y1: 12, x2: 15.5, y2: 8.5 }]
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
         * Company logo, separator bar and HHpro wordmark, as shown at the
         * left of every header. Returns a fragment so it can drop into
         * the plain brand div on the overview or the clickable breadcrumb
         * button on every other page.
         *
         * @returns {DocumentFragment}
         */
        createHeaderBrand: function () {
            var frag = document.createDocumentFragment();

            var logo = document.createElement('img');
            logo.className = 'header-logo';
            logo.src = 'ASSETS/HH_FullLogo_white_header.png';
            logo.alt = 'Hoffman & Hoffman';
            logo.decoding = 'async';
            frag.appendChild(logo);

            var sep = document.createElement('span');
            sep.className = 'header-brand-sep';
            sep.setAttribute('aria-hidden', 'true');
            frag.appendChild(sep);

            frag.appendChild(HHpro.UI.createLogo());
            return frag;
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
            // Calculators-only accounts see no products, so no model
            // lookup; the empty wrapper keeps the header's spacing.
            if (HHpro.State && HHpro.State.isCalculatorsOnly()) return wrap;

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
         * "Users" header button. Only administrators get one; everyone
         * else gets null, so callers append it conditionally.
         *
         * @returns {HTMLElement|null}
         */
        createUsersButton: function () {
            if (!HHpro.State || !HHpro.State.canManageUsers()) return null;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'header-action';
            btn.appendChild(HHpro.UI.icon('users'));
            var label = document.createElement('span');
            label.textContent = 'Users';
            btn.appendChild(label);
            btn.addEventListener('click', function () {
                HHpro.App.showView('users');
            });
            return btn;
        },

        /**
         * "Log out" header button. Ends the session on the server too.
         *
         * @returns {HTMLElement}
         */
        createLogoutButton: function () {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'header-action';
            btn.appendChild(HHpro.UI.icon('log-out'));
            var label = document.createElement('span');
            label.textContent = 'Log out';
            btn.appendChild(label);
            btn.title = HHpro.State && HHpro.State.getUserName ? HHpro.State.getUserName() : '';
            btn.addEventListener('click', function () {
                HHpro.App.logout();
            });
            return btn;
        },

        /**
         * Brief status message at the bottom of the screen. One element
         * is reused; a new call replaces the text and restarts the timer.
         *
         * @param {string} message
         * @param {boolean=} isError - red border, stays up longer
         */
        toast: function (message, isError) {
            var el = document.getElementById('hh-toast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'hh-toast';
                el.className = 'hh-toast';
                el.setAttribute('role', 'status');
                document.body.appendChild(el);
            }
            el.textContent = message;
            el.classList.toggle('hh-toast-error', !!isError);
            el.classList.add('hh-toast-show');
            clearTimeout(el._timer);
            el._timer = setTimeout(function () { el.classList.remove('hh-toast-show'); }, isError ? 7000 : 3500);
        },

        /**
         * Open a pre-filled message in the user's own mail program. The
         * site never sends email itself; this is how invitations and
         * reset requests travel.
         *
         * @param {{to:string, cc?:string, subject:string, body:string}} mail
         */
        openMailto: function (mail) {
            var params = [];
            if (mail.cc) params.push('cc=' + encodeURIComponent(mail.cc));
            params.push('subject=' + encodeURIComponent(mail.subject || ''));
            params.push('body=' + encodeURIComponent(mail.body || ''));
            window.location.href = 'mailto:' + encodeURIComponent(mail.to || '') + '?' + params.join('&');
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
            brand.className = 'breadcrumb-link breadcrumb-brand';
            brand.appendChild(HHpro.UI.createHeaderBrand());
            brand.addEventListener('click', function () {
                HHpro.App.showView('main');
            });
            brandWrap.appendChild(brand);

            // currentPage is either a string (one crumb, the current
            // page) or an array of crumbs. Array entries are strings
            // (plain text) or { label, view, params } objects, which
            // render as clickable links to that view - used by pages
            // nested under a hub (Calculators › Psychrometrics).
            var crumbs = Array.isArray(currentPage) ? currentPage
                : (currentPage ? [currentPage] : []);
            crumbs.forEach(function (crumb, idx) {
                var sep = document.createElement('span');
                sep.className = 'breadcrumb-sep';
                sep.textContent = '›';
                brandWrap.appendChild(sep);

                var isLast = idx === crumbs.length - 1;
                if (crumb && typeof crumb === 'object' && crumb.view && !isLast) {
                    var link = document.createElement('button');
                    link.type = 'button';
                    link.className = 'breadcrumb-link breadcrumb-parent';
                    link.textContent = crumb.label;
                    link.addEventListener('click', function () {
                        HHpro.App.showView(crumb.view, crumb.params || {});
                    });
                    brandWrap.appendChild(link);
                } else {
                    var curr = document.createElement('span');
                    curr.className = 'breadcrumb-current';
                    curr.textContent = (crumb && typeof crumb === 'object') ? crumb.label : crumb;
                    brandWrap.appendChild(curr);
                }
            });

            header.appendChild(brandWrap);

            header.appendChild(HHpro.UI.createLookupInput());

            var actions = document.createElement('div');
            actions.className = 'header-actions';

            actions.appendChild(HHpro.UI.createUserGuideButton());
            var usersBtn = HHpro.UI.createUsersButton();
            if (usersBtn) actions.appendChild(usersBtn);
            actions.appendChild(HHpro.UI.createLogoutButton());

            header.appendChild(actions);

            return header;
        },

        /**
         * Arrow-key stepping for a number input without the browser's step
         * validation. With step="50" the browser calls 510 invalid and
         * shows "the two nearest valid values are 500 and 550" on hover,
         * though the calculators use whatever is typed. So the input takes
         * any value (step="any") and ArrowUp / ArrowDown (or the wheel
         * while focused) move to the next multiple of `step` here instead,
         * clamped to min / max. Typing is untouched.
         *
         * @param {HTMLInputElement} input
         * @param {number} step - nudge size; nothing is attached if not > 0
         * @param {number} [min]
         * @param {number} [max]
         */
        stepNumberInput: function (input, step, min, max) {
            input.step = 'any';
            var s = Number(step);
            if (!isFinite(s) || s <= 0) return;
            var lo = (min === undefined || min === null) ? -Infinity : Number(min);
            var hi = (max === undefined || max === null) ? Infinity : Number(max);
            // Decimals in the step, so 0.1 steps don't print 72.30000000001.
            var places = (String(s).split('.')[1] || '').length;

            function nudge(dir) {
                var cur = parseFloat(input.value);
                var next;
                if (!isFinite(cur)) {
                    next = isFinite(lo) ? lo : 0;
                } else {
                    // Off-grid values land on the next grid line in that
                    // direction (510 -> 550 up, 500 down); on-grid ones
                    // move one step.
                    var k = cur / s;
                    var r = Math.round(k);
                    if (Math.abs(k - r) < 1e-9) k = r;
                    next = (dir > 0 ? Math.floor(k) + 1 : Math.ceil(k) - 1) * s;
                }
                next = Math.min(hi, Math.max(lo, next));
                input.value = String(Number(next.toFixed(places)));
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }

            input.addEventListener('keydown', function (e) {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
                e.preventDefault();
                nudge(e.key === 'ArrowUp' ? 1 : -1);
            });
            input.addEventListener('wheel', function (e) {
                if (document.activeElement !== input || !e.deltaY) return;
                e.preventDefault();
                nudge(e.deltaY < 0 ? 1 : -1);
            }, { passive: false });
        }
    };
})();