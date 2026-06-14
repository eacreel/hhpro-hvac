/* ============================================================
   HHpro - Ambient background grid
   ------------------------------------------------------------
   Draws the faint blueprint grid on a fixed full-viewport canvas
   behind every view (the brand glow under it is plain CSS on the
   body - see base.css). Grid vertices are pulled toward the mouse
   pointer with a smooth falloff, so the squares visibly condense
   around the cursor as it moves. The pinch eases in on the first
   movement and fades back out when the pointer leaves the window.

   Self-contained: no other module depends on this, and it only
   reads the DOM it creates. The effect stays inert (a static
   grid) when the user prefers reduced motion or has no fine
   pointer (touch screens), and the animation loop fully stops
   once the pointer and fade settle, so an idle page costs
   nothing.
   ============================================================ */

(function () {
    'use strict';

    // Tuning. SPACING matches the 32px pitch of the old CSS grid.
    // STRENGTH stays below 1: the warp math guarantees grid lines
    // compress but can never cross for any STRENGTH < 1.
    var SPACING = 32;     // px between grid lines
    var SAMPLE = 16;      // px between bend points along a line
    var RADIUS = 200;     // px reach of the pinch around the cursor
    var STRENGTH = 0.4;   // 0..1 pull at the cursor itself
    var EASE = 0.14;      // per-frame smoothing (position and fade)
    var LINE_COLOR = 'rgba(255, 255, 255, 0.028)';

    // Lines bend only within this distance of the cursor; farther
    // ones draw as cheap straight segments. At 2.5x RADIUS the
    // displacement at the boundary is sub-pixel (~0.4px), so lines
    // crossing the threshold never visibly pop.
    var REACH = RADIUS * 2.5;

    // Pointer state. "Parked" far offscreen until the first move so
    // the initial frame renders an undistorted grid.
    var PARKED = -100000;

    var canvas = null;
    var ctx = null;
    var width = 0;
    var height = 0;
    var mouseX = PARKED;
    var mouseY = PARKED;
    var easedX = PARKED;
    var easedY = PARKED;
    // Fade envelope 0..1 multiplied into the pull strength: eases in
    // on the first move, eases out (in place) after mouseleave.
    var fade = 0;
    var fadeTarget = 0;
    var rafId = null;

    // warp() writes here instead of allocating a point per vertex.
    var px = 0;
    var py = 0;

    var reducedMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)');
    var finePointer = window.matchMedia &&
        window.matchMedia('(pointer: fine)');

    function interactive() {
        return finePointer && finePointer.matches &&
            !(reducedMotion && reducedMotion.matches);
    }

    function init() {
        canvas = document.createElement('canvas');
        canvas.id = 'bg-grid';
        canvas.setAttribute('aria-hidden', 'true');
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');

        resize();
        window.addEventListener('resize', resize);

        if (interactive()) {
            window.addEventListener('mousemove', onMouseMove, { passive: true });
            // Fade the pinch out when the pointer leaves the window so
            // the grid doesn't stay dented at the last position.
            document.documentElement.addEventListener('mouseleave', onMouseLeave);
        }
    }

    function resize() {
        var dpr = window.devicePixelRatio || 1;
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw();
    }

    function onMouseMove(e) {
        mouseX = e.clientX;
        mouseY = e.clientY;
        fadeTarget = 1;
        // First movement (or return after a completed fade-out): start
        // the dent at the pointer itself and let the fade ease it in,
        // rather than dragging it across the screen from wherever the
        // eased point last sat parked.
        if (easedX === PARKED) {
            easedX = mouseX;
            easedY = mouseY;
        }
        wake();
    }

    function onMouseLeave() {
        // Leave the position alone - the dent eases out where it is.
        // tick() parks the coordinates once the fade finishes.
        fadeTarget = 0;
        wake();
    }

    function wake() {
        if (rafId === null) {
            rafId = window.requestAnimationFrame(tick);
        }
    }

    function tick() {
        easedX += (mouseX - easedX) * EASE;
        easedY += (mouseY - easedY) * EASE;
        fade += (fadeTarget - fade) * EASE;

        var dx = mouseX - easedX;
        var dy = mouseY - easedY;
        var settled = (dx * dx + dy * dy) < 0.25 &&
            Math.abs(fadeTarget - fade) < 0.01;

        if (settled) {
            easedX = mouseX;
            easedY = mouseY;
            fade = fadeTarget;
            // Fully faded out: park the pointer so the next mousemove
            // takes the ease-in-at-cursor branch and draw() takes the
            // all-straight cheap path.
            if (fadeTarget === 0) {
                mouseX = PARKED;
                mouseY = PARKED;
                easedX = PARKED;
                easedY = PARKED;
            }
        }
        draw();

        // Stop the loop once the grid has caught up with the pointer;
        // the last drawn frame stays on screen (condensed around a
        // resting cursor, straight after a finished fade-out).
        rafId = settled ? null : window.requestAnimationFrame(tick);
    }

    // Pull a grid point toward the eased pointer, writing the result
    // to px/py. Gaussian falloff: full STRENGTH at the cursor fading
    // smoothly to nothing around REACH, scaled by the fade envelope.
    function warp(x, y) {
        var dx = easedX - x;
        var dy = easedY - y;
        var pull = STRENGTH * fade *
            Math.exp(-(dx * dx + dy * dy) / (RADIUS * RADIUS));
        px = x + dx * pull;
        py = y + dy * pull;
    }

    function draw() {
        ctx.clearRect(0, 0, width, height);

        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();

        var bend = fade > 0.01;
        var x, y, x0, x1, y0, y1;

        for (x = 0.5; x <= width; x += SPACING) {
            if (!bend || Math.abs(easedX - x) > REACH) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                continue;
            }
            // Only the span within REACH of the cursor bends; the rest
            // of the line draws as straight stubs (displacement at the
            // clamp boundary is sub-pixel, so the seam is invisible).
            y0 = Math.max(0, easedY - REACH);
            y1 = Math.min(height, easedY + REACH);
            ctx.moveTo(x, 0);
            for (y = y0; y < y1; y += SAMPLE) {
                warp(x, y);
                ctx.lineTo(px, py);
            }
            warp(x, y1);
            ctx.lineTo(px, py);
            ctx.lineTo(x, height);
        }

        for (y = 0.5; y <= height; y += SPACING) {
            if (!bend || Math.abs(easedY - y) > REACH) {
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                continue;
            }
            x0 = Math.max(0, easedX - REACH);
            x1 = Math.min(width, easedX + REACH);
            ctx.moveTo(0, y);
            for (x = x0; x < x1; x += SAMPLE) {
                warp(x, y);
                ctx.lineTo(px, py);
            }
            warp(x1, y);
            ctx.lineTo(px, py);
            ctx.lineTo(width, y);
        }

        ctx.stroke();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
