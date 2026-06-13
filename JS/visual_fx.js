/* ============================================================
   HHpro - Visual effects (HHpro.FX)
   ------------------------------------------------------------
   The shared home for the tasteful, low-cost visual touches that
   sit on top of the app chrome. Everything here is deliberately
   restrained: pointer-driven effects gate on a fine pointer and
   respect prefers-reduced-motion, and nothing animates while idle.

   Owns:
     - Spotlight card borders : the edge of a tile/card facing the
                                cursor lights up (CSS reads --spot-x/y).
     - Table crosshair guides : CAD-style horizontal+vertical guide
                                lines that track the cursor across a
                                schedule. Self-attaches the first time
                                the pointer enters a schedule wrap.
     - staggerReveal()        : fade/rise children in with a small
                                per-item delay on first paint.
     - tweenNumber()          : ease a numeric readout from its
                                current value to a new one.
     - flashSuccess()         : draw a checkmark over a button as a
                                one-shot "done" confirmation.

   The grid + ambient cursor glow live in background.js (it already
   owns the eased pointer signal); this module covers everything else.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    // ----- Capability gates (mirror background.js) -----
    function prefersReducedMotion() {
        return !!(window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }
    function finePointer() {
        return !!(window.matchMedia &&
            window.matchMedia('(pointer: fine)').matches);
    }
    // Pointer-tracking effects only make sense with a fine pointer, and
    // we hold them back under reduced-motion to match the app's restraint.
    function interactive() {
        return finePointer() && !prefersReducedMotion();
    }

    // =================================================================
    // Spotlight card borders
    // -----------------------------------------------------------------
    // One delegated pointer listener for the whole document. When the
    // cursor is over a tile/card we write its cursor-relative position
    // to --spot-x / --spot-y; the CSS uses those to brighten the edge
    // nearest the pointer. rAF-throttled so we touch the DOM at most
    // once per frame.
    // =================================================================

    var SPOT_SELECTOR = '.tile, .project-card';

    function initSpotlight() {
        if (!interactive()) return;
        var pending = false;
        var lastEvt = null;
        document.addEventListener('pointermove', function (e) {
            lastEvt = e;
            if (pending) return;
            pending = true;
            requestAnimationFrame(function () {
                pending = false;
                var ev = lastEvt;
                if (!ev || !ev.target || !ev.target.closest) return;
                var el = ev.target.closest(SPOT_SELECTOR);
                if (!el) return;
                var rect = el.getBoundingClientRect();
                el.style.setProperty('--spot-x', (ev.clientX - rect.left) + 'px');
                el.style.setProperty('--spot-y', (ev.clientY - rect.top) + 'px');
            });
        }, { passive: true });
    }

    // =================================================================
    // Table crosshair guides
    // -----------------------------------------------------------------
    // Self-attaches the first time the pointer enters a schedule wrap,
    // so no schedule-building code needs to opt in. The overlay is sized
    // to the table (not the wrap) so the guide lines line up with cells
    // and scroll with the content; sticky header/columns paint over the
    // lines, which reads as intentional.
    // =================================================================

    // Every schedule table - the project-view schedules and the editable
    // grid both carry .schedule-wrap, the equipment-browse schedule uses
    // it too, and the refrigerant tab has its own wrap.
    var CROSS_SELECTOR = '.schedule-wrap, .refrigerant-table-wrap';

    function initCrosshair() {
        if (!interactive()) return;
        document.addEventListener('pointerover', function (e) {
            if (!e.target || !e.target.closest) return;
            var wrap = e.target.closest(CROSS_SELECTOR);
            if (!wrap || wrap.__xhInit) return;
            attachCrosshair(wrap);
        }, { passive: true });
    }

    function attachCrosshair(wrap) {
        if (!wrap || wrap.__xhInit) return;
        wrap.__xhInit = true;
        wrap.classList.add('hh-crosshair-host');

        var overlay = document.createElement('div');
        overlay.className = 'hh-crosshair';
        overlay.setAttribute('aria-hidden', 'true');
        var vline = document.createElement('div');
        vline.className = 'hh-crosshair-line hh-crosshair-v';
        var hline = document.createElement('div');
        hline.className = 'hh-crosshair-line hh-crosshair-h';
        overlay.appendChild(vline);
        overlay.appendChild(hline);
        wrap.appendChild(overlay);

        var table = wrap.querySelector('table');
        function sizeOverlay() {
            var w = table ? table.offsetWidth : wrap.scrollWidth;
            var h = table ? table.offsetHeight : wrap.scrollHeight;
            overlay.style.width = w + 'px';
            overlay.style.height = h + 'px';
        }
        sizeOverlay();
        if (window.ResizeObserver) {
            var ro = new ResizeObserver(sizeOverlay);
            ro.observe(wrap);
            if (table) ro.observe(table);
        }

        var pending = false, lastX = 0, lastY = 0;
        wrap.addEventListener('pointermove', function (e) {
            lastX = e.clientX;
            lastY = e.clientY;
            if (pending) return;
            pending = true;
            requestAnimationFrame(function () {
                pending = false;
                var rect = wrap.getBoundingClientRect();
                overlay.style.setProperty('--cx',
                    (lastX - rect.left + wrap.scrollLeft) + 'px');
                overlay.style.setProperty('--cy',
                    (lastY - rect.top + wrap.scrollTop) + 'px');
                wrap.classList.add('hh-crosshair-active');
            });
        }, { passive: true });
        wrap.addEventListener('pointerleave', function () {
            wrap.classList.remove('hh-crosshair-active');
        });
    }

    // =================================================================
    // staggerReveal - fade/rise children in on first paint
    // =================================================================

    function staggerReveal(container, selector, opts) {
        if (!container || prefersReducedMotion()) return;
        opts = opts || {};
        var step = opts.step || 45;        // ms between items
        var maxIdx = opts.max || 12;       // cap the delay growth
        var items = selector
            ? container.querySelectorAll(selector)
            : container.children;
        Array.prototype.forEach.call(items, function (el, i) {
            el.style.setProperty('--reveal-delay',
                (Math.min(i, maxIdx) * step) + 'ms');
            el.classList.add('hh-reveal');
        });
    }

    // =================================================================
    // tweenNumber - ease a numeric readout to a new value
    // -----------------------------------------------------------------
    // Stores the live value on the element so repeated calls (e.g. on
    // every keystroke) animate smoothly from wherever the last one left
    // off, cancelling any in-flight tween first.
    // =================================================================

    function tweenNumber(el, to, opts) {
        if (!el) return;
        opts = opts || {};
        var format = opts.format || function (v) { return String(Math.round(v)); };
        var dur = opts.duration || 280;

        if (el.__tweenRaf) {
            cancelAnimationFrame(el.__tweenRaf);
            el.__tweenRaf = null;
        }
        var from = (typeof el.__tweenVal === 'number')
            ? el.__tweenVal
            : (opts.from != null ? opts.from : to);

        if (prefersReducedMotion() || from === to) {
            el.__tweenVal = to;
            el.textContent = format(to);
            return;
        }

        var start = null;
        function frame(ts) {
            if (start === null) start = ts;
            var t = Math.min(1, (ts - start) / dur);
            var eased = 1 - Math.pow(1 - t, 3);   // easeOutCubic
            var val = from + (to - from) * eased;
            el.__tweenVal = val;
            el.textContent = format(val);
            if (t < 1) {
                el.__tweenRaf = requestAnimationFrame(frame);
            } else {
                el.__tweenVal = to;
                el.textContent = format(to);
                el.__tweenRaf = null;
            }
        }
        el.__tweenRaf = requestAnimationFrame(frame);
    }

    // =================================================================
    // flashSuccess - one-shot "done" checkmark over a button
    // =================================================================

    function flashSuccess(btn, opts) {
        if (!btn || btn.__flashing) return;
        if (!(HHpro.UI && HHpro.UI.icon)) return;
        btn.__flashing = true;
        opts = opts || {};

        var badge = document.createElement('span');
        badge.className = 'hh-check';
        badge.setAttribute('aria-hidden', 'true');
        badge.appendChild(HHpro.UI.icon('check'));
        btn.classList.add('hh-flashing');
        btn.appendChild(badge);

        window.setTimeout(function () {
            if (badge.parentNode) badge.parentNode.removeChild(badge);
            btn.classList.remove('hh-flashing');
            btn.__flashing = false;
        }, opts.duration || 1300);
    }

    // =================================================================
    // Wiring
    // =================================================================

    function init() {
        initSpotlight();
        initCrosshair();
    }

    HHpro.FX = {
        staggerReveal: staggerReveal,
        tweenNumber: tweenNumber,
        flashSuccess: flashSuccess,
        attachCrosshair: attachCrosshair
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
