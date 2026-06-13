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
    }

    HHpro.FX = {
        staggerReveal: staggerReveal,
        tweenNumber: tweenNumber,
        flashSuccess: flashSuccess
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
