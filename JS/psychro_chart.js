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
         show: { rh: true, wb: true, h: true, v: false },
         points: [{ id: 'oa', label: 'OA', state: st, cls: 'psy-point-oa', title }],
         lines:  [{ from: 'oa', to: 'ra', cls: 'psy-line-mix', arrow: false }],
         paths:  [{ pts: [{ db, w }, ...], cls: 'psy-line-room' }]
     });
     chart.onHover(function (stateOrNull) { ... });

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
        var mL = 36, mR = 84, mT = 28, mB = 58;
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
        clipRect.appendChild(el('rect', { x: mL, y: mT, width: pw, height: ph }));
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
        var gPoints = el('g', null, 'psy-points');
        var gCallout = el('g', null, 'psy-callout');
        var gHover  = el('g', null, 'psy-hover');
        [gGrid, gCurves, gLabels, gSat, gUnder, gPaths, gLines].forEach(function (g) { gPlot.appendChild(g); });
        [gBg, gPlot, gAxes, gPoints, gCallout, gHover].forEach(function (g) { svg.appendChild(g); });

        gBg.appendChild(el('rect', { x: mL, y: mT, width: pw, height: ph }, 'psy-frame'));
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
            points: [], lines: [], paths: [], callout: null
        };

        function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }

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

        // -------- static layers: grid, axes, curve families --------

        function drawStatic(P) {
            clear(gGrid); clear(gCurves); clear(gLabels); clear(gSat); clear(gAxes);
            gAxes.appendChild(frame);

            var show = current.show;
            var si = units === 'SI';
            var dbSpan = vp.dbMax - vp.dbMin;
            var dbStepF = dbSpan / 240;

            // --- Saturation curve + under-saturation clip polygon ---
            var satPts = [], clipPts = [];
            for (var db = vp.dbMin; db <= vp.dbMax + 1e-9; db += dbStepF) {
                var ws = Psy.satHumRatio(db, P);
                satPts.push([xOf(db), yOf(ws)]);
                clipPts.push([xOf(db), yOf(ws)]);
            }
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
            yTitle.setAttribute('transform', 'translate(' + (W - 14) + ' ' + (mT + ph / 2) + ') rotate(90)');
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

            // --- Enthalpy lines ---
            if (show.h) {
                var hOf, wOfH, satDbForH, hCfg, hCaption;
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
                    : familySteps(hMax - hMin, [{ maxSpan: 12, step: 1, label: 1 }, { maxSpan: 25, step: 2, label: 2 }, { maxSpan: 1e9, step: 5, label: 10 }]);
                for (var h = Math.ceil(hMin / hCfg.step) * hCfg.step; h <= hMax; h += hCfg.step) {
                    var dbS = satDbForH(h);
                    var hpts = [];
                    for (var d3 = Math.max(dbS, vp.dbMin); d3 <= vp.dbMax + 1e-9; d3 += dbStepF * 2) {
                        var wh = wOfH(h, d3);
                        if (wh < vp.wMin - (vp.wMax - vp.wMin)) break;
                        hpts.push([xOf(d3), yOf(wh)]);
                    }
                    if (hpts.length < 2) continue;
                    gCurves.appendChild(el('path', { d: pathFrom(hpts) }, 'psy-h'));
                    var labelH = Math.abs(h / hCfg.label - Math.round(h / hCfg.label)) < 1e-6;
                    var wS = Psy.satHumRatio(dbS, P);
                    if (labelH && inView(dbS, wS) && yOf(wS) < labelBottom && xOf(dbS) > mL + 24) {
                        gLabels.appendChild(text(xOf(dbS) - 8, yOf(wS) - 6, fmtTick(h), 'psy-label psy-label-h', 'end'));
                    }
                }
                gLabels.appendChild(text(mL + 6, mT + 36, hCaption, 'psy-label psy-label-h psy-label-caption', 'start'));
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

        function drawCallout() {
            clear(gCallout);
            var c = current.callout;
            if (!c || !c.rows || !c.rows.length) return;
            var x = mL + 8, y = mT + 46;
            var lineH = 15, pad = 8, swatchW = 22;
            var charW = 5.6; // approx px per character at 10.5px
            var maxLen = (c.title || '').length * 1.15;
            c.rows.forEach(function (r) { maxLen = Math.max(maxLen, r.text.length); });
            var w = Math.min(pw * 0.6, Math.max(180, maxLen * charW + swatchW + pad * 2 + 6));
            var h = pad * 2 + (c.title ? lineH + 2 : 0) + c.rows.length * lineH;
            gCallout.appendChild(el('rect', { x: x, y: y, width: w, height: h, rx: 4 }, 'psy-callout-bg'));
            var cy = y + pad + 11;
            if (c.title) {
                gCallout.appendChild(text(x + pad, cy, c.title, 'psy-callout-title', 'start'));
                cy += lineH + 2;
            }
            c.rows.forEach(function (r) {
                var sx = x + pad, sy = cy - 4;
                if (r.swatch === 'econ') {
                    gCallout.appendChild(el('line', { x1: sx, y1: sy, x2: sx + swatchW - 4, y2: sy }, 'psy-line psy-line-econ psy-callout-swatch'));
                } else if (r.swatch === 'limit') {
                    gCallout.appendChild(el('line', { x1: sx, y1: sy, x2: sx + swatchW - 4, y2: sy }, 'psy-line psy-line-limit psy-callout-swatch'));
                } else if (r.swatch === 'region') {
                    gCallout.appendChild(el('rect', { x: sx, y: sy - 5, width: swatchW - 4, height: 10 }, 'psy-region psy-econ-region psy-callout-swatch-box'));
                } else if (r.swatch === 'ok' || r.swatch === 'no') {
                    gCallout.appendChild(el('circle', { cx: sx + 6, cy: sy, r: 4.5 }, 'psy-callout-dot ' + (r.swatch === 'ok' ? 'is-ok' : 'is-no')));
                }
                gCallout.appendChild(text(x + pad + swatchW, cy, r.text, 'psy-callout-text', 'start'));
                cy += lineH;
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

        svg.addEventListener('mousemove', function (evt) {
            if (current.pressure === null) return;
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
                current.points = data.points || [];
                current.lines = data.lines || [];
                current.paths = data.paths || [];
                current.callout = data.callout || null;
                var key = [current.pressure, units, vp.dbMin, vp.dbMax, vp.wMin, vp.wMax,
                           current.show.rh, current.show.wb, current.show.h, current.show.v].join('|');
                if (key !== lastStaticKey && current.pressure !== null) {
                    drawStatic(current.pressure);
                    lastStaticKey = key;
                }
                drawDynamic();
                drawCallout();
            },
            onHover: function (cb) { hoverCb = cb; },
            viewport: function () { return { dbMin: vp.dbMin, dbMax: vp.dbMax, wMin: vp.wMin, wMax: vp.wMax }; }
        };
    }

    HHpro.PsychroChart = {
        create: create,
        defaultViewport: defaultViewport,
        zoom: zoom,
        pan: pan,
        fit: fit,
        clampViewport: clampViewport
    };
})();
