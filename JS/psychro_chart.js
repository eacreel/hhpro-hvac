/* ============================================================
   HHpro - Psychrometric chart (SVG, IP core, IP or SI labels)
   ------------------------------------------------------------
   Draws an ASHRAE-style chart entirely from HHpro.Psychro (no
   chart library): dry bulb along the bottom, humidity ratio up
   the right-hand side, and the usual curve families clipped to
   the region under the saturation line.

     var chart = HHpro.PsychroChart.create(containerEl);
     chart.update({
         pressure: psia,
         units: 'IP' | 'SI',                       // axis + curve labels
         viewport: { dbMin, dbMax, wMin, wMax },   // degF and lb/lb (IP always)
         show: { rh: true, wb: true, h: true, v: false,   // curve families
                 h1: false,        // enthalpy lines every 1 (needs h)
                 hscale: false,    // enthalpy ruler outside the saturation curve
                 prot: false,      // SHR / dh:dW protractor, top-left
                 shr: false,       // sensible heat factor scale, right
                 rscale: false },  // dew point, vapor pressure, enthalpy columns, right
         points: [{ id: 'oa', label: 'OA', state: st, cls: 'psy-point-oa', title }],
         lines:  [{ from: 'oa', to: 'ra', cls: 'psy-line-mix', arrow: false }],
         paths:  [{ pts: [{ db, w }, ...], cls: 'psy-line-room' }]
     });
     chart.onHover(function (stateOrNull) { ... });
     chart.onViewportChange(function (vp) { ... });   // wheel zoom / drag pan

   Mouse: the wheel zooms about the pointer, click-and-drag pans.
   Both report the new viewport through onViewportChange; the page
   stores it and calls update() again, so the chart itself stays
   stateless about where the view "should" be.

   Viewport helpers (pure functions, used by the page for its
   zoom / pan / fit buttons):
     HHpro.PsychroChart.defaultViewport(dbMin)
     HHpro.PsychroChart.zoom(vp, factor)      factor < 1 zooms in
     HHpro.PsychroChart.pan(vp, fx, fy)       fractions of the span
     HHpro.PsychroChart.fit(vp, states)       frame the given states

   Everything is styled through CSS classes (CSS/calculators.css)
   so the chart follows the site theme; only geometry is set here.
   The same SVG is what psychro_pdf.js converts for the PDF export.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var instanceCounter = 0;

    var GR = 7000;                 // grains per lb
    var V_SI_PER_IP = 0.0624280;   // m3/kg per ft3/lb
    var BTU_PER_KJ = 1 / 2.326;
    var SHR_REF = { db: 80, rh: 0.5 };   // ASHRAE reference state for the SHR scales (80 degF, 50% RH)

    function fToC(f) { return (f - 32) / 1.8; }
    function cToF(c) { return c * 1.8 + 32; }

    function el(tag, attrs, cls) {
        var node = document.createElementNS(SVG_NS, tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                node.setAttribute(k, String(attrs[k]));
            });
        }
        if (cls) node.setAttribute('class', cls);
        return node;
    }

    function text(x, y, str, cls, anchor) {
        var t = el('text', { x: x.toFixed(1), y: y.toFixed(1) }, cls);
        if (anchor) t.setAttribute('text-anchor', anchor);
        t.textContent = str;
        return t;
    }

    // Text rotated `deg` (clockwise, SVG convention) about (x, y). The
    // PDF exporter reads translate + rotate only, so x/y stay at 0.
    function rtext(x, y, deg, str, cls, anchor) {
        var t = el('text', { x: 0, y: 0 }, cls);
        t.setAttribute('transform', 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') rotate(' + deg + ')');
        if (anchor) t.setAttribute('text-anchor', anchor);
        t.textContent = str;
        return t;
    }

    function isMultiple(v, step) {
        return Math.abs(v / step - Math.round(v / step)) < 1e-6;
    }

    function niceStep(span, target, candidates) {
        for (var i = 0; i < candidates.length; i++) {
            if (span / candidates[i] <= target) return candidates[i];
        }
        return candidates[candidates.length - 1];
    }

    // Pick a (line step, label step) pair for a curve family by span.
    function familySteps(spanDisp, table) {
        for (var i = 0; i < table.length; i++) {
            if (spanDisp <= table[i].maxSpan) return table[i];
        }
        return table[table.length - 1];
    }

    function fmtTick(v) {
        return String(Math.round(v * 100) / 100);
    }

    // ---------------- viewport helpers ----------------

    var VP_LIMITS = { dbMin: -100, dbMax: 200, minDbSpan: 8, minWSpan: 0.0015 };

    function clampViewport(vp) {
        var out = { dbMin: vp.dbMin, dbMax: vp.dbMax, wMin: vp.wMin, wMax: vp.wMax };
        if (out.wMin < 0) { out.wMax -= out.wMin; out.wMin = 0; }
        if (out.dbMax - out.dbMin < VP_LIMITS.minDbSpan) {
            var c = (out.dbMax + out.dbMin) / 2;
            out.dbMin = c - VP_LIMITS.minDbSpan / 2; out.dbMax = c + VP_LIMITS.minDbSpan / 2;
        }
        if (out.wMax - out.wMin < VP_LIMITS.minWSpan) out.wMax = out.wMin + VP_LIMITS.minWSpan;
        if (out.dbMin < VP_LIMITS.dbMin) { out.dbMax += VP_LIMITS.dbMin - out.dbMin; out.dbMin = VP_LIMITS.dbMin; }
        if (out.dbMax > VP_LIMITS.dbMax) { out.dbMin -= out.dbMax - VP_LIMITS.dbMax; out.dbMax = VP_LIMITS.dbMax; }
        if (out.dbMin < VP_LIMITS.dbMin) out.dbMin = VP_LIMITS.dbMin;
        return out;
    }

    function defaultViewport(dbMin) {
        return { dbMin: isFinite(dbMin) ? Number(dbMin) : 20, dbMax: 120, wMin: 0, wMax: 210 / GR };
    }

    function zoom(vp, factor) {
        var cx = (vp.dbMin + vp.dbMax) / 2, cy = (vp.wMin + vp.wMax) / 2;
        var hx = (vp.dbMax - vp.dbMin) / 2 * factor, hy = (vp.wMax - vp.wMin) / 2 * factor;
        return clampViewport({ dbMin: cx - hx, dbMax: cx + hx, wMin: cy - hy, wMax: cy + hy });
    }

    // Zoom keeping the state under the pointer (db, w) where it is.
    function zoomAt(vp, factor, db, w) {
        return clampViewport({
            dbMin: db - (db - vp.dbMin) * factor, dbMax: db + (vp.dbMax - db) * factor,
            wMin: w - (w - vp.wMin) * factor,     wMax: w + (vp.wMax - w) * factor
        });
    }

    function pan(vp, fx, fy) {
        var dx = (vp.dbMax - vp.dbMin) * fx, dy = (vp.wMax - vp.wMin) * fy;
        return clampViewport({ dbMin: vp.dbMin + dx, dbMax: vp.dbMax + dx, wMin: vp.wMin + dy, wMax: vp.wMax + dy });
    }

    function fit(vp, states) {
        if (!states || !states.length) return vp;
        var dbLo = Infinity, dbHi = -Infinity, wLo = Infinity, wHi = -Infinity;
        states.forEach(function (s) {
            if (!s) return;
            dbLo = Math.min(dbLo, s.db); dbHi = Math.max(dbHi, s.db);
            wLo = Math.min(wLo, s.w);   wHi = Math.max(wHi, s.w);
        });
        if (!isFinite(dbLo)) return vp;
        var dbSpan = Math.max(dbHi - dbLo, 10), wSpan = Math.max(wHi - wLo, 0.004);
        // Keep the chart's normal proportion (about 2.1 gr per degF) so a
        // fitted view does not look stretched.
        var ratio = (210 / GR) / 100;
        if (wSpan / dbSpan < ratio) wSpan = dbSpan * ratio; else dbSpan = wSpan / ratio;
        var cx = (dbLo + dbHi) / 2, cy = (wLo + wHi) / 2;
        var m = 1.35;
        return clampViewport({
            dbMin: cx - dbSpan * m / 2, dbMax: cx + dbSpan * m / 2,
            wMin: Math.max(0, cy - wSpan * m / 2), wMax: cy + wSpan * m / 2
        });
    }

    // ---------------- chart instance ----------------

    function create(container) {
        var Psy = HHpro.Psychro;
        var id = 'psy' + (++instanceCounter);

        var W = 980, H = 640;
        // The right margin grows when the optional right-hand scales are
        // shown (see layout()); everything else is fixed.
        var MR_BASE = 84, RSCALE_W = 136, SHR_W = 62;
        var mL = 36, mR = MR_BASE, mT = 28, mB = 58;
        var pw = W - mL - mR, ph = H - mT - mB;

        var vp = defaultViewport(20);
        var units = 'IP';

        function xOf(db) { return mL + (db - vp.dbMin) / (vp.dbMax - vp.dbMin) * pw; }
        function yOf(w)  { return mT + ph - (w - vp.wMin) / (vp.wMax - vp.wMin) * ph; }
        function dbOf(x) { return vp.dbMin + (x - mL) / pw * (vp.dbMax - vp.dbMin); }
        function wOf(y)  { return vp.wMin + (mT + ph - y) / ph * (vp.wMax - vp.wMin); }

        var svg = el('svg', {
            viewBox: '0 0 ' + W + ' ' + H,
            preserveAspectRatio: 'xMidYMid meet',
            role: 'img'
        }, 'psy-chart');
        svg.setAttribute('aria-label', 'Psychrometric chart');
        container.appendChild(svg);

        var defs = el('defs');
        svg.appendChild(defs);

        var marker = el('marker', {
            id: id + '-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
            markerWidth: 10, markerHeight: 10, orient: 'auto-start-reverse',
            markerUnits: 'userSpaceOnUse'
        }, 'psy-arrow');
        marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z' }));
        defs.appendChild(marker);

        var clipRect = el('clipPath', { id: id + '-rect' });
        var clipRectBox = el('rect', { x: mL, y: mT, width: pw, height: ph });
        clipRect.appendChild(clipRectBox);
        defs.appendChild(clipRect);

        var clipSat = el('clipPath', { id: id + '-sat' });
        var clipPoly = el('polygon');
        clipSat.appendChild(clipPoly);
        defs.appendChild(clipSat);

        // Layers. gPlot is clipped to the frame; gCurves additionally to
        // the region under saturation. Points sit outside the clip so
        // off-chart states can be pinned to the frame edge.
        var gBg     = el('g', null, 'psy-bg');
        var gPlot   = el('g', { 'clip-path': 'url(#' + id + '-rect)' }, 'psy-plot');
        var gGrid   = el('g', null, 'psy-grid');
        var gCurves = el('g', { 'clip-path': 'url(#' + id + '-sat)' }, 'psy-curves');
        var gLabels = el('g', null, 'psy-curve-labels');
        var gSat    = el('g', null, 'psy-sat-layer');
        var gUnder  = el('g', { 'clip-path': 'url(#' + id + '-sat)' }, 'psy-paths-under');
        var gPaths  = el('g', null, 'psy-paths');
        var gLines  = el('g', null, 'psy-lines');
        var gAxes   = el('g', null, 'psy-axes');
        var gScales = el('g', null, 'psy-scales');   // protractor + right-hand scales
        var gPoints = el('g', null, 'psy-points');
        var gCallout = el('g', null, 'psy-callout');
        var gHover  = el('g', null, 'psy-hover');
        [gGrid, gCurves, gLabels, gSat, gUnder, gPaths, gLines].forEach(function (g) { gPlot.appendChild(g); });
        [gBg, gPlot, gAxes, gScales, gPoints, gCallout, gHover].forEach(function (g) { svg.appendChild(g); });

        var frameBg = el('rect', { x: mL, y: mT, width: pw, height: ph }, 'psy-frame');
        gBg.appendChild(frameBg);
        var frame = el('rect', { x: mL, y: mT, width: pw, height: ph }, 'psy-frame-outline');

        var crossV = el('line', null, 'psy-crosshair');
        var crossH = el('line', null, 'psy-crosshair');
        var crossDot = el('circle', { r: 3.5 }, 'psy-crosshair-dot');
        gHover.appendChild(crossV);
        gHover.appendChild(crossH);
        gHover.appendChild(crossDot);
        hideCross();

        var hoverCb = null;
        var current = {
            pressure: null,
            show: { rh: true, wb: true, h: true, v: false },
            points: [], lines: [], paths: [], callouts: []
        };
        var viewportCb = null;
        var calloutTop = mT + 44;   // set by drawStatic (below the protractor when shown)

        function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }

        // Plot width follows the right-hand scales that are switched on.
        function layout() {
            mR = MR_BASE + (current.show.rscale ? RSCALE_W : 0) + (current.show.shr ? SHR_W : 0);
            pw = W - mL - mR;
            [clipRectBox, frameBg, frame].forEach(function (r) { r.setAttribute('width', pw); });
        }

        function pathFrom(pts) {
            var d = '', pen = false;
            pts.forEach(function (p) {
                if (!p) { pen = false; return; }
                d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
                pen = true;
            });
            return d;
        }

        function inView(db, w) {
            return db >= vp.dbMin && db <= vp.dbMax && w >= vp.wMin && w <= vp.wMax;
        }

        function inFrame(x, y, pad) {
            pad = pad || 0;
            return x >= mL + pad && x <= mL + pw - pad && y >= mT + pad && y <= mT + ph - pad;
        }

        // -------- process-line geometry for the SHR scales --------
        // Both scales are linearised at the ASHRAE reference state
        // (80 degF, 50% RH). A process step dW < 0 with dt/dW degF per
        // lb/lb points in pixel direction (-dtPerDw * kx, ky), so the
        // angles follow the live viewport and stay correct when zoomed.
        function refThermo(P) {
            var w = Psy.humRatioFromRh(SHR_REF.db, SHR_REF.rh, P);
            return { db: SHR_REF.db, w: w, cp: Psy.cpMoist(w), hg: 1061 + 0.444 * SHR_REF.db };
        }
        function processDir(dtPerDw) {
            if (dtPerDw === Infinity) return [-1, 0];
            if (dtPerDw === -Infinity) return [1, 0];
            var kx = pw / (vp.dbMax - vp.dbMin), ky = ph / (vp.wMax - vp.wMin);
            var dx = -dtPerDw * kx, dy = ky;
            var L = Math.sqrt(dx * dx + dy * dy) || 1;
            return [dx / L, dy / L];
        }
        // Sensible / total: cp dt = s dh and hg dW = (1 - s) dh.
        function dtDwForShr(s, ref) {
            if (s === 1) return Infinity;
            if (!isFinite(s)) return -ref.hg / ref.cp;
            return s * ref.hg / ((1 - s) * ref.cp);
        }
        // Enthalpy / humidity ratio: dh = cp dt + hg dW.
        function dtDwForSlope(r, ref) {
            if (r === Infinity) return Infinity;
            if (r === -Infinity) return -Infinity;
            return (r - ref.hg) / ref.cp;
        }

        // ASHRAE-style protractor in the top-left corner: inner scale is
        // sensible heat / total heat, outer scale is enthalpy change per
        // unit humidity-ratio change. Labels that would overlap an
        // earlier one are dropped (the tick stays), so the scale thins
        // itself at whatever the current axis proportions are.
        var PROT = { R: 104, w: 308, h: 196 };
        function drawProtractor(P, si) {
            var ref = refThermo(P);
            var R = PROT.R, cx = mL + 8 + PROT.w / 2, cy = mT + 70;
            var g = el('g', null, 'psy-prot');
            gScales.appendChild(g);
            g.appendChild(el('rect', { x: mL + 8, y: mT + 40, width: PROT.w, height: PROT.h, rx: 3 }, 'psy-prot-bg'));
            g.appendChild(el('line', { x1: cx - R, y1: cy, x2: cx + R, y2: cy }, 'psy-prot-line'));
            g.appendChild(el('line', { x1: cx, y1: cy - 5, x2: cx, y2: cy + 5 }, 'psy-prot-line'));
            var arc = [];
            for (var a = 0; a <= 180; a += 3) {
                var rad = a * Math.PI / 180;
                arc.push([cx - R * Math.cos(rad), cy + R * Math.sin(rad)]);
            }
            g.appendChild(el('path', { d: pathFrom(arc) }, 'psy-prot-line'));

            function tick(dir, r0, r1) {
                g.appendChild(el('line', {
                    x1: cx + dir[0] * r0, y1: cy + dir[1] * r0,
                    x2: cx + dir[0] * r1, y2: cy + dir[1] * r1 }, 'psy-prot-tick'));
            }
            // A label goes at radius r0 along `dir`; if that spot is
            // taken it steps to r1 (a second ring), else it is dropped.
            var placed = [];   // [centre x, centre y, half width], shared by both scales
            function free(x, y, hw) {
                for (var i = 0; i < placed.length; i++) {
                    if (Math.abs(placed[i][0] - x) < placed[i][2] + hw + 3 && Math.abs(placed[i][1] - y) < 10) return false;
                }
                return true;
            }
            // Captions inside the arc are placed first so the scale
            // labels keep clear of them.
            function caption(x, y, str, anchor) {
                var hw = estWidth(str, 8) / 2;
                placed.push([anchor === 'start' ? x + hw : x, y - 2.5, hw]);
                g.appendChild(text(x, y, str, 'psy-prot-caption', anchor || 'middle'));
            }
            caption(cx, cy + 18, 'SENSIBLE HEAT');
            g.appendChild(el('line', { x1: cx - 26, y1: cy + 21, x2: cx + 26, y2: cy + 21 }, 'psy-prot-tick'));
            caption(cx, cy + 30, 'TOTAL HEAT');
            caption(cx, cy + 42, '= Qs / Qt');

            function labeller(cls) {
                // (cxm, y) is the centre of the text box; x is the anchor point.
                function put(cxm, y, hw, x, str, anchor) {
                    placed.push([cxm, y, hw]);
                    g.appendChild(text(x, y + 2.5, str, cls, anchor || 'middle'));
                }
                return {
                    at: function (x, y, str, anchor) {
                        var hw = estWidth(str, 8) / 2;
                        var cxm = anchor === 'start' ? x + hw : (anchor === 'end' ? x - hw : x);
                        if (free(cxm, y, hw)) put(cxm, y, hw, x, str, anchor);
                    },
                    along: function (dir, r0, r1, str) {
                        var hw = estWidth(str, 8) / 2;
                        var radii = [r0, r1, r1 + (r1 - r0)];   // up to three rings
                        for (var k = 0; k < radii.length; k++) {
                            var x = cx + dir[0] * radii[k], y = cy + dir[1] * radii[k];
                            if (free(x, y, hw)) return put(x, y, hw, x, str);
                        }
                    }
                };
            }
            var labInner = labeller('psy-prot-label psy-prot-label-shr');
            var labOuter = labeller('psy-prot-label');

            // Ends of the horizontal line: SHR 1.0 inside, +-infinity outside.
            labInner.at(cx - R + 4, cy - 7, '1.0', 'start');  labInner.at(cx + R - 4, cy - 7, '1.0', 'end');
            labOuter.at(cx - R - 3, cy - 7, '∞', 'end');   labOuter.at(cx + R + 3, cy - 7, '-∞', 'start');
            tick([-1, 0], R, R - 6); tick([1, 0], R, R - 6);

            var shrMajor = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0, -0.2, -0.5, -1, -2, -4, Infinity, 4, 2, 1.5];
            shrMajor.forEach(function (s) {
                var dir = processDir(dtDwForShr(s, ref));
                tick(dir, R, R - 6);
                labInner.along(dir, R - 15, R - 26, isFinite(s) ? String(s) : '±∞');
            });
            for (var sm = 0.05; sm < 0.999; sm += 0.1) tick(processDir(dtDwForShr(sm, ref)), R, R - 3);

            // Outer scale: dh/dW. IP in Btu/lb per lb/lb, SI in kJ/kg per g/kg.
            var slopes = si
                ? [10, 8, 6, 5, 4, 3, 2.5, 2, 1.5, 1, 0.5, 0, -0.5, -1, -2, -4]
                : [5000, 3000, 2000, 1500, 1000, 500, 0, -500, -1000, -2000];
            slopes.forEach(function (v) {
                var rIp = si ? v * 1000 * BTU_PER_KJ : v;
                var dir = processDir(dtDwForSlope(rIp, ref));
                tick(dir, R, R + 6);
                labOuter.along(dir, R + 15, R + 26, String(v));
            });

            // Caption below the arc
            var by = cy + R + 30;
            g.appendChild(text(cx - 14, by, 'ENTHALPY', 'psy-prot-caption', 'middle'));
            g.appendChild(el('line', { x1: cx - 48, y1: by + 3, x2: cx + 20, y2: by + 3 }, 'psy-prot-tick'));
            g.appendChild(text(cx - 14, by + 12, 'HUMIDITY RATIO', 'psy-prot-caption', 'middle'));
            g.appendChild(text(cx + 26, by + 7, '= Δh / ΔW', 'psy-prot-caption', 'start'));
            g.appendChild(text(cx - 14, by + 22, si ? 'kJ/kg per g/kg' : 'Btu/lb per lb/lb', 'psy-prot-label', 'middle'));
        }

        // One vertical scale in the right margin: a bar at x with ticks
        // [{ y, major, str }] and a rotated caption. Ticks outside the
        // frame height are dropped; a label that would land on the
        // previous one is skipped (its tick stays), so list the ticks in
        // the order labels should win.
        function drawColumn(x, ticks, caption, labelW) {
            var g = el('g', null, 'psy-rscale');
            var yTop = Infinity, yBot = -Infinity, labelled = [];
            ticks.forEach(function (t) {
                if (!(t.y >= mT - 0.5 && t.y <= mT + ph + 0.5)) return;
                yTop = Math.min(yTop, t.y); yBot = Math.max(yBot, t.y);
                g.appendChild(el('line', { x1: x, y1: t.y, x2: x + (t.major ? 6 : 3), y2: t.y }, 'psy-rscale-tick'));
                if (!t.major) return;
                for (var i = 0; i < labelled.length; i++) if (Math.abs(labelled[i] - t.y) < 10) return;
                labelled.push(t.y);
                g.appendChild(text(x + 9, t.y + 3.5, t.str, 'psy-rscale-label', 'start'));
            });
            if (!isFinite(yTop)) return;
            g.appendChild(el('line', { x1: x, y1: yTop, x2: x, y2: yBot }, 'psy-rscale-bar'));
            g.appendChild(rtext(x + 9 + labelW + 10, mT + ph / 2, 90, caption, 'psy-rscale-caption', 'middle'));
            gScales.appendChild(g);
        }

        // Dew point, vapor pressure and enthalpy columns to the right of
        // the humidity ratio axis, as on the printed chart. Dew point and
        // vapor pressure depend on humidity ratio alone; the enthalpy
        // column marks where each enthalpy line meets the right-hand edge.
        function drawRightScales(P, si, hx) {
            var x0 = mL + pw + MR_BASE;
            var n, ticks;

            // Dew point: 1-degree ticks where they have room, labels every 5.
            var dpTop = Psy.satDbWhere(function (d, ws) { return ws - vp.wMax; }, P);
            var dpHi = si ? fToC(dpTop) : dpTop;
            ticks = [];
            for (n = Math.floor(dpHi); n >= (si ? -40 : -40); n--) {
                var dpF = si ? cToF(n) : n;
                var wDp = Psy.satHumRatio(dpF, P);
                if (wDp < vp.wMin) break;
                var major = n % 5 === 0;
                var gap = yOf(Psy.satHumRatio(dpF - (si ? 1.8 : 1), P)) - yOf(wDp);
                if (gap < 0.8) break;            // scale has closed up; stop
                if (!major && gap < 3) continue;
                ticks.push({ y: yOf(wDp), major: major, str: String(n) });
            }
            drawColumn(x0 + 6, ticks, 'Dew Point (' + (si ? '°C' : '°F') + ')', 16);

            // Vapor pressure: pv = P W / (0.621945 + W), linear enough in W
            // for a regular step.
            var pvK = si ? 6.894757 : Psy.inHgFromPsi(1);
            function pvOf(w) { return P * w / (0.621945 + w) * pvK; }
            var pvLo = pvOf(vp.wMin), pvHi = pvOf(vp.wMax);
            var pvStep = niceStep(pvHi - pvLo, 14, [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2]);
            var pvDec = pvStep < 0.1 ? 2 : (pvStep < 1 ? 1 : 0);
            ticks = [];
            for (n = Math.ceil(pvLo / (pvStep / 2) - 1e-9); n * pvStep / 2 <= pvHi + 1e-9; n++) {
                var pvD = n * pvStep / 2, pvPsi = pvD / pvK;
                ticks.push({ y: yOf(0.621945 * pvPsi / (P - pvPsi)), major: n % 2 === 0, str: pvD.toFixed(pvDec) });
            }
            drawColumn(x0 + 50, ticks, 'Vapor Pressure (' + (si ? 'kPa' : 'in Hg') + ')', 20);

            // Enthalpy where the lines meet the right-hand edge.
            ticks = [];
            var hLo = hx.hOf(vp.dbMax, vp.wMin), hHi = hx.hOf(vp.dbMax, vp.wMax);
            for (n = Math.ceil(hLo / hx.ruler.minor - 1e-9); n * hx.ruler.minor <= hHi + 1e-9; n++) {
                var hv = n * hx.ruler.minor;
                ticks.push({ y: yOf(hx.wOfH(hv, vp.dbMax)), major: isMultiple(hv, hx.ruler.label), str: fmtTick(hv) });
            }
            drawColumn(x0 + 96, ticks, 'Enthalpy (' + (si ? 'kJ/kg' : 'Btu/lb') + ')', 14);
        }

        // Sensible heat factor scale to the right of the plot, anchored
        // at the reference state like the ASHRAE chart: a line from the
        // reference marker to a value on the bar has that SHR's slope.
        // Hidden when the reference state is outside the view.
        function drawShrScale(P, si) {
            var ref = refThermo(P);
            if (!inView(ref.db, ref.w)) return;
            var ax = xOf(ref.db), ay = yOf(ref.w);
            var g = el('g', null, 'psy-shr-scale');
            gScales.appendChild(g);
            var ring = [];
            for (var a = 0; a <= 360; a += 30) {
                var rad = a * Math.PI / 180;
                ring.push([ax + 4.5 * Math.cos(rad), ay + 4.5 * Math.sin(rad)]);
            }
            g.appendChild(el('path', { d: pathFrom(ring) }, 'psy-shr-ref'));
            var refTitle = el('title');
            refTitle.textContent = 'SHF scale reference: ' + (si ? '26.7 °C' : '80 °F') + ', 50% RH';
            g.appendChild(refTitle);

            var barX = mL + pw + MR_BASE + (current.show.rscale ? RSCALE_W : 0) + 8;
            var yTop = Infinity, yBot = -Infinity, any = false, lastLabelY = -Infinity;
            // From 1.00 downward so 1.00 is always labelled; labels that
            // would land on the previous one are skipped (tick stays).
            for (var i = 100; i >= 20; i--) {
                var s = i / 100;
                var dir = processDir(dtDwForShr(s, ref));   // toward lower dry bulb
                if (dir[0] > -1e-6) continue;
                var t = (barX - ax) / -dir[0];
                var y = ay - t * dir[1];                      // extended the other way, up-right
                if (y < mT + 2 || y > mT + ph - 2) continue;
                any = true;
                yTop = Math.min(yTop, y); yBot = Math.max(yBot, y);
                var major = i % 5 === 0;
                g.appendChild(el('line', { x1: barX, y1: y, x2: barX + (major ? 6 : 3), y2: y }, 'psy-rscale-tick'));
                if (major && Math.abs(y - lastLabelY) >= 10) {
                    g.appendChild(text(barX + 9, y + 3.5, s.toFixed(2), 'psy-rscale-label', 'start'));
                    lastLabelY = y;
                }
            }
            if (!any) return;
            g.appendChild(el('line', { x1: barX, y1: yTop, x2: barX, y2: yBot }, 'psy-rscale-bar'));
            g.appendChild(rtext(barX + 42, mT + ph / 2, 90,
                'Sensible Heat Factor (ref. ' + (si ? '26.7 °C' : '80 °F') + ', 50% RH)', 'psy-rscale-caption', 'middle'));
        }

        // -------- static layers: grid, axes, curve families --------

        function drawStatic(P) {
            clear(gGrid); clear(gCurves); clear(gLabels); clear(gSat); clear(gAxes); clear(gScales);
            gAxes.appendChild(frame);

            var show = current.show;
            var si = units === 'SI';
            var dbSpan = vp.dbMax - vp.dbMin;
            var dbStepF = dbSpan / 240;

            // --- Saturation curve + under-saturation clip polygon ---
            var satPts = [], clipPts = [], dbTop = null;   // dbTop: where saturation leaves the top of the view
            for (var db = vp.dbMin; db <= vp.dbMax + 1e-9; db += dbStepF) {
                var ws = Psy.satHumRatio(db, P);
                satPts.push([xOf(db), yOf(ws)]);
                clipPts.push([xOf(db), yOf(ws)]);
                if (dbTop === null && ws > vp.wMax) dbTop = db;
            }
            if (dbTop === null) dbTop = vp.dbMax;
            clipPts.push([xOf(vp.dbMax), mT + ph + 2000]);
            clipPts.push([xOf(vp.dbMin), mT + ph + 2000]);
            clipPoly.setAttribute('points', clipPts.map(function (p) {
                return p[0].toFixed(1) + ',' + p[1].toFixed(1);
            }).join(' '));
            gSat.appendChild(el('path', { d: pathFrom(satPts) }, 'psy-sat'));

            // --- Axes: dry bulb ---
            var xStep, xLo, xHi, xToF, xLabel;
            if (si) {
                xLo = fToC(vp.dbMin); xHi = fToC(vp.dbMax);
                xStep = niceStep(xHi - xLo, 12, [0.5, 1, 2, 5, 10, 20, 50]);
                xToF = cToF; xLabel = 'Dry Bulb Temperature (°C)';
            } else {
                xLo = vp.dbMin; xHi = vp.dbMax;
                xStep = niceStep(xHi - xLo, 12, [1, 2, 5, 10, 20, 50]);
                xToF = function (f) { return f; }; xLabel = 'Dry Bulb Temperature (°F)';
            }
            var xStart = Math.ceil(xLo / xStep - 1e-9) * xStep;
            for (var xv = xStart; xv <= xHi + 1e-9; xv += xStep) {
                var xpx = xOf(xToF(xv));
                var gl = el('line', { x1: xpx, y1: mT, x2: xpx, y2: mT + ph }, 'psy-grid-line psy-grid-major');
                gl.setAttribute('clip-path', 'url(#' + id + '-sat)');
                gGrid.appendChild(gl);
                gAxes.appendChild(el('line', { x1: xpx, y1: mT + ph, x2: xpx, y2: mT + ph + 6 }, 'psy-tick'));
                gAxes.appendChild(text(xpx, mT + ph + 18, fmtTick(xv), 'psy-axis-label', 'middle'));
            }
            for (var xm = xStart - xStep / 2; xm <= xHi + 1e-9; xm += xStep) {
                if (xm < xLo) continue;
                var xmp = xOf(xToF(xm));
                gAxes.appendChild(el('line', { x1: xmp, y1: mT + ph, x2: xmp, y2: mT + ph + 3 }, 'psy-tick'));
                var ml = el('line', { x1: xmp, y1: mT, x2: xmp, y2: mT + ph }, 'psy-grid-line');
                ml.setAttribute('clip-path', 'url(#' + id + '-sat)');
                gGrid.appendChild(ml);
            }

            // --- Axes: humidity ratio ---
            var yStep, yLo, yHi, yToW, yLabel;
            if (si) {
                yLo = vp.wMin * 1000; yHi = vp.wMax * 1000;   // g/kg
                yStep = niceStep(yHi - yLo, 11, [0.2, 0.5, 1, 2, 5, 10]);
                yToW = function (g) { return g / 1000; }; yLabel = 'Humidity Ratio (g/kg dry air)';
            } else {
                yLo = vp.wMin * GR; yHi = vp.wMax * GR;       // gr/lb
                yStep = niceStep(yHi - yLo, 11, [1, 2, 5, 10, 20, 50]);
                yToW = function (g) { return g / GR; }; yLabel = 'Humidity Ratio (grains / lb dry air)';
            }
            var yStart = Math.ceil(yLo / yStep - 1e-9) * yStep;
            for (var yv = yStart; yv <= yHi + 1e-9; yv += yStep) {
                var ypx = yOf(yToW(yv));
                var hl = el('line', { x1: mL, y1: ypx, x2: mL + pw, y2: ypx }, 'psy-grid-line psy-grid-major');
                hl.setAttribute('clip-path', 'url(#' + id + '-sat)');
                gGrid.appendChild(hl);
                gAxes.appendChild(el('line', { x1: mL + pw, y1: ypx, x2: mL + pw + 6, y2: ypx }, 'psy-tick'));
                gAxes.appendChild(text(mL + pw + 10, ypx + 4, fmtTick(yv), 'psy-axis-label', 'start'));
            }
            for (var ym = yStart - yStep / 2; ym <= yHi + 1e-9; ym += yStep) {
                if (ym < yLo) continue;
                var ymp = yOf(yToW(ym));
                gAxes.appendChild(el('line', { x1: mL + pw, y1: ymp, x2: mL + pw + 3, y2: ymp }, 'psy-tick'));
            }

            gAxes.appendChild(text(mL + pw / 2, H - 14, xLabel, 'psy-axis-title', 'middle'));
            var yTitle = text(0, 0, yLabel, 'psy-axis-title', 'middle');
            yTitle.setAttribute('transform', 'translate(' + (mL + pw + MR_BASE - 14) + ' ' + (mT + ph / 2) + ') rotate(90)');
            gAxes.appendChild(yTitle);
            var pCaption = si
                ? 'Barometric pressure ' + (P * 6.894757).toFixed(2) + ' kPa'
                : 'Barometric pressure ' + Psy.inHgFromPsi(P).toFixed(2) + ' in Hg (' + P.toFixed(3) + ' psia)';
            gAxes.appendChild(text(mL + 6, mT + 16, pCaption, 'psy-pressure-label', 'start'));

            var labelBottom = mT + ph - 14;   // labels below this would sit on the axis

            // --- Relative humidity curves 10..90% ---
            if (show.rh) {
                for (var rh = 10; rh <= 90; rh += 10) {
                    var pts = [], last = null;
                    for (var d1 = vp.dbMin; d1 <= vp.dbMax + 1e-9; d1 += dbStepF) {
                        var w1 = Psy.humRatioFromRh(d1, rh / 100, P);
                        if (w1 > vp.wMax) break;
                        pts.push([xOf(d1), yOf(w1)]);
                        if (w1 >= vp.wMin) last = { db: d1, w: w1 };
                    }
                    if (pts.length < 2) continue;
                    gCurves.appendChild(el('path', { d: pathFrom(pts) }, 'psy-rh'));
                    if (last) {
                        var lx = xOf(last.db) - 4, ly = yOf(last.w) - 5;
                        if (ly < mT + 12) { ly = mT + 12; lx -= 8; }
                        gLabels.appendChild(text(lx, ly, rh + '%', 'psy-label psy-label-rh', 'end'));
                    }
                }
            }

            // --- Wet-bulb lines ---
            if (show.wb) {
                var wbCfg = si
                    ? familySteps(fToC(vp.dbMax) - fToC(vp.dbMin), [
                        { maxSpan: 12, step: 1, label: 1 }, { maxSpan: 30, step: 2, label: 2 }, { maxSpan: 1e9, step: 5, label: 5 }])
                    : familySteps(dbSpan, [
                        { maxSpan: 20, step: 1, label: 1 }, { maxSpan: 45, step: 2, label: 2 },
                        { maxSpan: 70, step: 5, label: 5 }, { maxSpan: 1e9, step: 5, label: 10 }]);
                var wbLo = si ? fToC(vp.dbMin) - 20 : vp.dbMin - 20;
                var wbHi = si ? fToC(vp.dbMax) : vp.dbMax;
                for (var wbv = Math.ceil(wbLo / wbCfg.step) * wbCfg.step; wbv <= wbHi; wbv += wbCfg.step) {
                    var wbF = si ? cToF(wbv) : wbv;
                    var wsat = Psy.satHumRatio(wbF, P);
                    if (wsat < vp.wMin * 0.2) continue;
                    var wpts = [];
                    var dStart = Math.max(wbF, vp.dbMin);
                    for (var d2 = dStart; d2 <= vp.dbMax + 1e-9; d2 += dbStepF * 2) {
                        var w2 = Psy.humRatioFromWb(d2, wbF, P);
                        if (w2 === null) break;
                        wpts.push([xOf(d2), yOf(w2)]);
                    }
                    if (wpts.length < 2) continue;
                    gCurves.appendChild(el('path', { d: pathFrom(wpts) }, 'psy-wb'));
                    var labelIt = Math.abs(wbv / wbCfg.label - Math.round(wbv / wbCfg.label)) < 1e-6;
                    var ldb = wbF + dbSpan * 0.04, lw = Psy.humRatioFromWb(ldb, wbF, P);
                    if (labelIt && lw !== null && inView(ldb, lw) && yOf(lw) < labelBottom) {
                        gLabels.appendChild(text(xOf(ldb) + 2, yOf(lw) - 3, fmtTick(wbv), 'psy-label psy-label-wb', 'start'));
                    }
                }
            }

            // --- Enthalpy lines and ruler ---
            var hOf, wOfH, satDbForH, hCfg, hCaption, hRuler;
            if (show.h || show.hscale || show.rscale) {
                if (si) {
                    hOf = function (dbF, w) { var t = fToC(dbF); return 1.006 * t + w * (2501 + 1.86 * t); };
                    wOfH = function (h, dbF) { var t = fToC(dbF); return (h - 1.006 * t) / (2501 + 1.86 * t); };
                    satDbForH = function (h) { return Psy.satDbWhere(function (d, wsx) { return hOf(d, wsx) - h; }, P); };
                    hCaption = 'Enthalpy, kJ/kg dry air';
                } else {
                    hOf = Psy.enthalpy;
                    wOfH = Psy.humRatioFromEnthalpy;
                    satDbForH = function (h) { return Psy.satDbForEnthalpy(h, P); };
                    hCaption = 'Enthalpy, Btu/lb dry air';
                }
                var hMin = hOf(vp.dbMin, vp.wMin);
                var hMax = Math.max(
                    hOf(vp.dbMax, Math.min(vp.wMax, Psy.satHumRatio(vp.dbMax, P))),
                    hOf(vp.dbMin, Math.min(vp.wMax, Psy.satHumRatio(vp.dbMin, P))));
                hCfg = si
                    ? familySteps(hMax - hMin, [{ maxSpan: 25, step: 2, label: 2 }, { maxSpan: 60, step: 5, label: 5 }, { maxSpan: 1e9, step: 10, label: 10 }])
                    : familySteps(hMax - hMin, [{ maxSpan: 12, step: 1, label: 1 }, { maxSpan: 25, step: 2, label: 2 }, { maxSpan: 1e9, step: 5, label: 5 }]);
                // Ruler graduations (also used by the right-hand enthalpy column).
                hRuler = si
                    ? familySteps(hMax - hMin, [{ maxSpan: 25, minor: 0.5, label: 2 }, { maxSpan: 60, minor: 1, label: 5 }, { maxSpan: 1e9, minor: 2, label: 10 }])
                    : familySteps(hMax - hMin, [{ maxSpan: 12, minor: 0.2, label: 1 }, { maxSpan: 25, minor: 0.5, label: 2 }, { maxSpan: 1e9, minor: 1, label: 5 }]);
            }
            if (show.h) {
                // "Every 1" adds the fine lines between the normal ones.
                var hFine = si ? 2 : 1;
                var hStep = (show.h1 && hCfg.step > hFine) ? hFine : hCfg.step;
                for (var hn = Math.ceil(hMin / hStep - 1e-9); hn * hStep <= hMax; hn++) {
                    var h = hn * hStep;
                    var dbS = satDbForH(h);
                    var hpts = [];
                    for (var d3 = Math.max(dbS, vp.dbMin); d3 <= vp.dbMax + 1e-9; d3 += dbStepF * 2) {
                        var wh = wOfH(h, d3);
                        if (wh < vp.wMin - (vp.wMax - vp.wMin)) break;
                        hpts.push([xOf(d3), yOf(wh)]);
                    }
                    if (hpts.length < 2) continue;
                    gCurves.appendChild(el('path', { d: pathFrom(hpts) }, isMultiple(h, hCfg.step) ? 'psy-h' : 'psy-h psy-h-fine'));
                    // The ruler carries the values when it is shown.
                    var wS = Psy.satHumRatio(dbS, P);
                    if (!show.hscale && isMultiple(h, hCfg.label) && inView(dbS, wS) && yOf(wS) < labelBottom && xOf(dbS) > mL + 24) {
                        gLabels.appendChild(text(xOf(dbS) - 8, yOf(wS) - 6, fmtTick(h), 'psy-label psy-label-h', 'end'));
                    }
                }
            }
            if (show.h || show.hscale) {
                gLabels.appendChild(text(mL + 6, mT + 36, hCaption, 'psy-label psy-label-h psy-label-caption', 'start'));
            }

            // --- Enthalpy ruler ---
            // Graduations just outside the saturation curve, each one in
            // line with its enthalpy line, so a straightedge laid along
            // the lines reads the value. Past the point where saturation
            // leaves the view the ruler carries on along the top edge.
            if (show.hscale) {
                var lastTopX = -Infinity;
                for (var rn = Math.ceil(hMin / hRuler.minor - 1e-9); rn * hRuler.minor <= hMax + 1e-9; rn++) {
                    var hv = rn * hRuler.minor, majorH = isMultiple(hv, hRuler.label);
                    var dbR = satDbForH(hv), wR = Psy.satHumRatio(dbR, P);
                    if (dbR < vp.dbMin) continue;
                    if (wR <= vp.wMax && dbR <= vp.dbMax) {
                        if (wR < vp.wMin) continue;
                        var rx0 = xOf(dbR), ry0 = yOf(wR);
                        var ux = rx0 - xOf(dbR + 1), uy = ry0 - yOf(wOfH(hv, dbR + 1));
                        var uL = Math.sqrt(ux * ux + uy * uy) || 1;
                        ux /= uL; uy /= uL;
                        var t1 = majorH ? 11 : 6;
                        if (!inFrame(rx0 + ux * t1, ry0 + uy * t1, 1)) continue;
                        gLabels.appendChild(el('line', {
                            x1: rx0 + ux * 2, y1: ry0 + uy * 2,
                            x2: rx0 + ux * t1, y2: ry0 + uy * t1 }, 'psy-h-tick'));
                        var rlx = rx0 + ux * 21, rly = ry0 + uy * 21;
                        if (majorH && inFrame(rlx, rly, 8) && ry0 < labelBottom) {
                            gLabels.appendChild(text(rlx, rly + 3.5, fmtTick(hv), 'psy-label psy-label-h', 'middle'));
                        }
                    } else {
                        // Where this enthalpy line meets the top edge (W = wMax).
                        var lo = dbTop, hi = vp.dbMax;
                        if (hOf(lo, vp.wMax) > hv || hOf(hi, vp.wMax) < hv) continue;
                        for (var bi = 0; bi < 40; bi++) {
                            var mid = (lo + hi) / 2;
                            if (hOf(mid, vp.wMax) < hv) lo = mid; else hi = mid;
                        }
                        var tx0 = xOf((lo + hi) / 2);
                        gAxes.appendChild(el('line', { x1: tx0, y1: mT, x2: tx0, y2: mT - (majorH ? 7 : 4) }, 'psy-h-tick'));
                        if (majorH && tx0 - lastTopX >= 18) {
                            gAxes.appendChild(text(tx0, mT - 10, fmtTick(hv), 'psy-label-h psy-h-edge-label', 'middle'));
                            lastTopX = tx0;
                        }
                    }
                }
            }

            // --- Specific volume lines ---
            if (show.v) {
                var vMin = Psy.volume(vp.dbMin, vp.wMin, P), vMax = Psy.volume(vp.dbMax, vp.wMax, P);
                var vCfg, vToIp, vDec;
                if (si) {
                    vMin *= V_SI_PER_IP; vMax *= V_SI_PER_IP;
                    vCfg = familySteps(vMax - vMin, [{ maxSpan: 0.06, step: 0.005, label: 0.005 }, { maxSpan: 0.15, step: 0.01, label: 0.01 }, { maxSpan: 1e9, step: 0.02, label: 0.02 }]);
                    vToIp = function (v) { return v / V_SI_PER_IP; };
                    vDec = 3;
                } else {
                    vCfg = familySteps(vMax - vMin, [{ maxSpan: 1.0, step: 0.1, label: 0.1 }, { maxSpan: 2.5, step: 0.2, label: 0.2 }, { maxSpan: 1e9, step: 0.5, label: 0.5 }]);
                    vToIp = function (v) { return v; };
                    vDec = 1;
                }
                for (var v = Math.ceil(vMin / vCfg.step) * vCfg.step; v <= vMax + 1e-9; v += vCfg.step) {
                    var vIp = vToIp(v);
                    var db0 = vIp * P / 0.370486 - 459.67; // W = 0 crossing
                    var dbSv = Psy.satDbForVolume(vIp, P);
                    var vpts = [];
                    var dvStart = Math.max(dbSv, vp.dbMin), dvEnd = Math.min(db0, vp.dbMax);
                    for (var d4 = dvStart; d4 <= dvEnd + 1e-9; d4 += dbStepF) {
                        vpts.push([xOf(d4), yOf(Math.max(0, Psy.humRatioFromVolume(vIp, d4, P)))]);
                    }
                    if (vpts.length < 2) continue;
                    gCurves.appendChild(el('path', { d: pathFrom(vpts) }, 'psy-v'));
                    var midDb = dvStart + (dvEnd - dvStart) * 0.35;
                    var midW = Math.max(0, Psy.humRatioFromVolume(vIp, midDb, P));
                    if (inView(midDb, midW) && yOf(midW) < labelBottom) {
                        gLabels.appendChild(text(xOf(midDb) + 3, yOf(midW) - 2, v.toFixed(vDec), 'psy-label psy-label-v', 'start'));
                    }
                }
            }

            // --- Optional scales: protractor, right-hand columns, SHF ---
            if (show.prot) drawProtractor(P, si);
            if (show.rscale) drawRightScales(P, si, { hOf: hOf, wOfH: wOfH, ruler: hRuler });
            if (show.shr) drawShrScale(P, si);
            calloutTop = show.prot ? mT + 40 + PROT.h + 8 : mT + 44;
        }

        // -------- dynamic layers: paths, lines, points --------

        function drawDynamic() {
            clear(gUnder); clear(gPaths); clear(gLines); clear(gPoints);
            var pointPx = {};
            current.points.forEach(function (p) {
                if (!p || !p.state) return;
                pointPx[p.id] = { x: xOf(p.state.db), y: yOf(p.state.w) };
            });
            // Paths: polylines in (db, w). `fill` closes and fills the shape,
            // `under` additionally clips it to the region under saturation,
            // `label` puts a caption at the first or last point (kept
            // inside the frame).
            current.paths.forEach(function (pth) {
                if (!pth || !pth.pts || pth.pts.length < 2) return;
                var pts = pth.pts.map(function (q) { return [xOf(q.db), yOf(q.w)]; });
                var d = pathFrom(pts) + (pth.fill ? ' Z' : '');
                var target = pth.under ? gUnder : gPaths;
                target.appendChild(el('path', { d: d }, (pth.fill ? 'psy-region ' : 'psy-path ') + (pth.cls || '')));
                if (pth.label) {
                    var at = pth.labelAt === 'start' ? pts[0] : pts[pts.length - 1];
                    var lx = Math.min(Math.max(at[0], mL + 6), mL + pw - 6);
                    var ly = Math.min(Math.max(at[1], mT + 14), mT + ph - 6);
                    var anchor = lx > mL + pw * 0.7 ? 'end' : 'start';
                    var t = text(lx + (anchor === 'end' ? -4 : 4), ly, pth.label, 'psy-path-label ' + (pth.labelCls || ''), anchor);
                    gPaths.appendChild(t);
                }
            });
            current.lines.forEach(function (ln) {
                var a = pointPx[ln.from], b = pointPx[ln.to];
                if (!a || !b) return;
                var line = el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y }, 'psy-line ' + (ln.cls || ''));
                if (ln.arrow) line.setAttribute('marker-end', 'url(#' + id + '-arrow)');
                gLines.appendChild(line);
            });
            current.points.forEach(function (p) {
                var px = pointPx[p.id];
                if (!px) return;
                var g = el('g', null, 'psy-point ' + (p.cls || ''));
                if (!inView(p.state.db, p.state.w)) g.setAttribute('class', g.getAttribute('class') + ' psy-point-offchart');
                var cx = Math.min(Math.max(px.x, mL), mL + pw);
                var cy = Math.min(Math.max(px.y, mT), mT + ph);
                g.appendChild(el('circle', { cx: cx, cy: cy, r: 6 }, 'psy-point-halo'));
                g.appendChild(el('circle', { cx: cx, cy: cy, r: 4 }, 'psy-point-dot'));
                var lx = cx + 9, anchor = 'start';
                if (cx > mL + pw - 40) { lx = cx - 9; anchor = 'end'; }
                g.appendChild(text(lx, cy - 8, p.label || '', 'psy-point-label', anchor));
                if (p.title) {
                    var title = el('title');
                    title.textContent = p.title;
                    g.appendChild(title);
                }
                gPoints.appendChild(g);
            });
        }

        // -------- callout: explainer box in the top-left of the plot --------
        // callout = { title, rows: [{ swatch: 'ok'|'no'|'econ'|'limit'|'region'|null, text }] }

        // Compact boxes stacked down the top-left of the plot. Each box:
        // { title, rows: [{ swatch, text }] } with swatch one of
        // ok | no | econ | limit | region | room | req | null.
        // Text width is estimated per character (Inter at 9px) and long
        // rows wrap, so the box always encloses its text.
        function estWidth(str, size) {
            var w = 0;
            for (var i = 0; i < str.length; i++) {
                var ch = str[i];
                if (ch === ' ') w += 0.28;
                else if (/[A-Z]/.test(ch)) w += 0.70;
                else if (/[0-9]/.test(ch)) w += 0.60;
                else if (/[mw]/.test(ch)) w += 0.85;
                else if (/[il.,:;'|!]/.test(ch)) w += 0.30;
                else if (/[a-z]/.test(ch)) w += 0.56;
                else w += 0.60;
            }
            return w * size;
        }

        function wrapText(str, maxW, size) {
            var words = str.split(' '), lines = [], cur = '';
            words.forEach(function (wd) {
                var trial = cur ? cur + ' ' + wd : wd;
                if (cur && estWidth(trial, size) > maxW) { lines.push(cur); cur = wd; }
                else cur = trial;
            });
            if (cur) lines.push(cur);
            return lines;
        }

        function drawCallout() {
            clear(gCallout);
            var list = current.callouts || [];
            var x = mL + 8, y = calloutTop;
            var size = 9, lineH = 12, pad = 6, swatchW = 20;
            var maxTextW = pw * 0.46 - swatchW - pad * 2;
            list.forEach(function (c) {
                if (!c || !c.rows || !c.rows.length) return;
                var rows = c.rows.map(function (r) {
                    return { swatch: r.swatch, lines: wrapText(r.text, maxTextW, size) };
                });
                var widest = c.title ? estWidth(c.title, size + 0.5) * 1.05 : 0;
                var lineCount = 0;
                rows.forEach(function (r) {
                    r.lines.forEach(function (ln) { widest = Math.max(widest, estWidth(ln, size) + swatchW); });
                    lineCount += r.lines.length;
                });
                var w = Math.min(pw * 0.46, widest + pad * 2 + 6);
                var h = pad * 2 + (c.title ? lineH + 1 : 0) + lineCount * lineH;
                gCallout.appendChild(el('rect', { x: x, y: y, width: w, height: h, rx: 3 }, 'psy-callout-bg'));
                var cy = y + pad + 9;
                if (c.title) {
                    gCallout.appendChild(text(x + pad, cy, c.title, 'psy-callout-title', 'start'));
                    cy += lineH + 1;
                }
                rows.forEach(function (r) {
                    var sx = x + pad, sy = cy - 3;
                    if (r.swatch === 'econ' || r.swatch === 'limit' || r.swatch === 'room' || r.swatch === 'dplimit') {
                        gCallout.appendChild(el('line', { x1: sx, y1: sy, x2: sx + swatchW - 4, y2: sy },
                            'psy-line psy-line-' + r.swatch + ' psy-callout-swatch'));
                    } else if (r.swatch === 'region') {
                        gCallout.appendChild(el('rect', { x: sx, y: sy - 4, width: swatchW - 4, height: 8 }, 'psy-region psy-econ-region psy-callout-swatch-box'));
                    } else if (r.swatch === 'ok' || r.swatch === 'no') {
                        gCallout.appendChild(el('circle', { cx: sx + 5, cy: sy, r: 3.5 }, 'psy-callout-dot ' + (r.swatch === 'ok' ? 'is-ok' : 'is-no')));
                    } else if (r.swatch === 'req') {
                        gCallout.appendChild(el('circle', { cx: sx + 5, cy: sy, r: 3.5 }, 'psy-callout-req'));
                    }
                    r.lines.forEach(function (ln) {
                        gCallout.appendChild(text(x + pad + swatchW, cy, ln, 'psy-callout-text', 'start'));
                        cy += lineH;
                    });
                });
                y += h + 6;
            });
        }

        // -------- hover --------

        function hideCross() {
            crossV.setAttribute('visibility', 'hidden');
            crossH.setAttribute('visibility', 'hidden');
            crossDot.setAttribute('visibility', 'hidden');
        }

        function svgPoint(evt) {
            var pt = svg.createSVGPoint();
            pt.x = evt.clientX; pt.y = evt.clientY;
            var ctm = svg.getScreenCTM();
            if (!ctm) return null;
            try { return pt.matrixTransform(ctm.inverse()); } catch (e) { return null; }
        }

        // --- wheel zoom about the pointer ---
        svg.addEventListener('wheel', function (evt) {
            if (current.pressure === null || !viewportCb) return;
            var p = svgPoint(evt);
            if (!p) return;
            evt.preventDefault();
            var db = dbOf(p.x), w = wOf(p.y);
            var factor = evt.deltaY > 0 ? 1.15 : 1 / 1.15;
            viewportCb(zoomAt(vp, factor, db, w));
        }, { passive: false });

        // --- click-and-drag pan (pixel deltas against the viewport at mousedown) ---
        var drag = null;
        svg.addEventListener('mousedown', function (evt) {
            if (evt.button !== 0 || current.pressure === null || !viewportCb) return;
            var p = svgPoint(evt);
            if (!p) return;
            drag = { x: p.x, y: p.y, vp: { dbMin: vp.dbMin, dbMax: vp.dbMax, wMin: vp.wMin, wMax: vp.wMax }, moved: false };
            svg.classList.add('is-dragging');
            evt.preventDefault();
        });
        function endDrag() {
            if (!drag) return;
            drag = null;
            svg.classList.remove('is-dragging');
        }
        if (typeof window.addEventListener === 'function') window.addEventListener('mouseup', endDrag);
        svg.addEventListener('mousemove', function (evt) {
            if (!drag) return;
            var p = svgPoint(evt);
            if (!p) return;
            var v0 = drag.vp;
            var dDb = -(p.x - drag.x) / pw * (v0.dbMax - v0.dbMin);
            var dW  =  (p.y - drag.y) / ph * (v0.wMax - v0.wMin);
            if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 2) drag.moved = true;
            if (!drag.moved) return;
            hideCross();
            if (hoverCb) hoverCb(null);
            viewportCb(clampViewport({ dbMin: v0.dbMin + dDb, dbMax: v0.dbMax + dDb, wMin: v0.wMin + dW, wMax: v0.wMax + dW }));
        });

        svg.addEventListener('mousemove', function (evt) {
            if (current.pressure === null || drag) return;
            var p = svgPoint(evt);
            if (!p) return;
            var db = dbOf(p.x), w = wOf(p.y);
            var inside = inView(db, w) && w <= Psy.satHumRatio(db, current.pressure);
            if (!inside) {
                hideCross();
                if (hoverCb) hoverCb(null);
                return;
            }
            crossV.setAttribute('x1', p.x); crossV.setAttribute('x2', p.x);
            crossV.setAttribute('y1', mT + ph);  crossV.setAttribute('y2', p.y);
            crossH.setAttribute('x1', p.x);      crossH.setAttribute('x2', mL + pw);
            crossH.setAttribute('y1', p.y);      crossH.setAttribute('y2', p.y);
            crossDot.setAttribute('cx', p.x);    crossDot.setAttribute('cy', p.y);
            crossV.removeAttribute('visibility');
            crossH.removeAttribute('visibility');
            crossDot.removeAttribute('visibility');
            if (hoverCb) {
                var st = null;
                try { st = Psy.fromDbW(db, w, current.pressure); } catch (e) { st = null; }
                hoverCb(st);
            }
        });
        svg.addEventListener('mouseleave', function () {
            hideCross();
            if (hoverCb) hoverCb(null);
        });

        // -------- public API --------

        var lastStaticKey = null;
        return {
            element: svg,
            update: function (data) {
                data = data || {};
                if (data.show) current.show = data.show;
                if (data.pressure !== undefined) current.pressure = data.pressure;
                if (data.units) units = data.units === 'SI' ? 'SI' : 'IP';
                if (data.viewport) vp = clampViewport(data.viewport);
                layout();
                current.points = data.points || [];
                current.lines = data.lines || [];
                current.paths = data.paths || [];
                current.callouts = data.callouts || (data.callout ? [data.callout] : []);
                var key = [current.pressure, units, vp.dbMin, vp.dbMax, vp.wMin, vp.wMax,
                           current.show.rh, current.show.wb, current.show.h, current.show.v,
                           current.show.h1, current.show.hscale, current.show.prot,
                           current.show.shr, current.show.rscale].join('|');
                if (key !== lastStaticKey && current.pressure !== null) {
                    drawStatic(current.pressure);
                    lastStaticKey = key;
                }
                drawDynamic();
                drawCallout();
            },
            onHover: function (cb) { hoverCb = cb; },
            onViewportChange: function (cb) { viewportCb = cb; },
            viewport: function () { return { dbMin: vp.dbMin, dbMax: vp.dbMax, wMin: vp.wMin, wMax: vp.wMax }; }
        };
    }

    HHpro.PsychroChart = {
        create: create,
        defaultViewport: defaultViewport,
        zoom: zoom,
        zoomAt: zoomAt,
        pan: pan,
        fit: fit,
        clampViewport: clampViewport
    };
})();
