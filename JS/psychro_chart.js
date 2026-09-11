/* ============================================================
   HHpro - Psychrometric chart (SVG, IP units)
   ------------------------------------------------------------
   Draws an ASHRAE-style chart entirely from HHpro.Psychro (no
   chart library): dry bulb along the bottom, humidity ratio up
   the right-hand side, and the usual curve families clipped to
   the region under the saturation line.

     var chart = HHpro.PsychroChart.create(containerEl, {
         dbMin: 20, dbMax: 120, wMaxGrains: 210   // all optional
     });
     chart.update({
         pressure: psia,
         show: { rh: true, wb: true, h: true, v: false },
         points: [{ id: 'oa', label: 'OA', state: st, cls: 'psy-point-oa' }],
         lines:  [{ from: 'oa', to: 'ra', cls: 'psy-line-mix', arrow: false }]
     });
     chart.onHover(function (stateOrNull) { ... });

   Everything is styled through CSS classes (CSS/calculators.css)
   so the chart follows the site theme; the only attributes set
   here are geometry.

   Coordinates: x(db) is linear in dry bulb, y(W) is linear in
   humidity ratio (lb/lb) - the same projection ASHRAE uses, so
   mixing lines are straight and process lines read correctly.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var SVG_NS = 'http://www.w3.org/2000/svg';
    var instanceCounter = 0;

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

    function create(container, opts) {
        opts = opts || {};
        var Psy = HHpro.Psychro;
        var id = 'psy' + (++instanceCounter);

        // Chart window (IP). 0.030 lb/lb = 210 gr/lb, the ASHRAE Chart 1 top.
        var dbMin = opts.dbMin !== undefined ? opts.dbMin : 20;
        var dbMax = opts.dbMax !== undefined ? opts.dbMax : 120;
        var wMax = (opts.wMaxGrains !== undefined ? opts.wMaxGrains : 210) / Psy.GRAINS_PER_LB;

        // Drawing surface. The viewBox is fixed; CSS scales the SVG to fit.
        var W = 980, H = 640;
        var mL = 36, mR = 84, mT = 28, mB = 58;
        var pw = W - mL - mR, ph = H - mT - mB;

        function xOf(db) { return mL + (db - dbMin) / (dbMax - dbMin) * pw; }
        function yOf(w)  { return mT + ph - (w / wMax) * ph; }
        function dbOf(x) { return dbMin + (x - mL) / pw * (dbMax - dbMin); }
        function wOf(y)  { return (mT + ph - y) / ph * wMax; }

        var svg = el('svg', {
            viewBox: '0 0 ' + W + ' ' + H,
            preserveAspectRatio: 'xMidYMid meet',
            role: 'img'
        }, 'psy-chart');
        svg.setAttribute('aria-label', 'Psychrometric chart');
        container.appendChild(svg);

        var defs = el('defs');
        svg.appendChild(defs);

        // Arrow head for process lines. markerUnits=userSpaceOnUse keeps the
        // arrow the same size regardless of the line's stroke width.
        var marker = el('marker', {
            id: id + '-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
            markerWidth: 10, markerHeight: 10, orient: 'auto-start-reverse',
            markerUnits: 'userSpaceOnUse'
        }, 'psy-arrow');
        marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z' }));
        defs.appendChild(marker);

        var clip = el('clipPath', { id: id + '-clip' });
        var clipPoly = el('polygon');
        clip.appendChild(clipPoly);
        defs.appendChild(clip);

        // Layer order: plot background, grid, curve families, saturation
        // line, axes, plotted lines, points, then the hover crosshair.
        var gBg     = el('g', null, 'psy-bg');
        var gGrid   = el('g', null, 'psy-grid');
        var gCurves = el('g', { 'clip-path': 'url(#' + id + '-clip)' }, 'psy-curves');
        var gLabels = el('g', null, 'psy-curve-labels');
        var gSat    = el('g', null, 'psy-sat-layer');
        var gAxes   = el('g', null, 'psy-axes');
        var gLines  = el('g', null, 'psy-lines');
        var gPoints = el('g', null, 'psy-points');
        var gHover  = el('g', null, 'psy-hover');
        [gBg, gGrid, gCurves, gLabels, gSat, gAxes, gLines, gPoints, gHover].forEach(function (g) {
            svg.appendChild(g);
        });

        // Filled plot background (also the hover capture surface) sits in
        // the bottom layer; the frame outline is redrawn on top in gAxes.
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
        var current = { pressure: null, show: { rh: true, wb: true, h: true, v: false }, points: [], lines: [] };
        var pointPx = {};

        function clear(g) { while (g.firstChild) g.removeChild(g.firstChild); }

        // -------- Curve families --------

        function pathFrom(pts) {
            // pts: array of [x, y] px; null breaks the path
            var d = '', pen = false;
            pts.forEach(function (p) {
                if (!p) { pen = false; return; }
                d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1);
                pen = true;
            });
            return d;
        }

        function drawStatic(P) {
            clear(gGrid); clear(gCurves); clear(gLabels); clear(gSat);
            gAxes.innerHTML = '';
            gAxes.appendChild(frame);

            var show = current.show;

            // --- Saturation curve + clip polygon ---
            var satPts = [], clipPts = [];
            var satTopDb = dbMax;
            for (var db = dbMin; db <= dbMax + 1e-9; db += 0.5) {
                var ws = Psy.satHumRatio(db, P);
                if (ws >= wMax) {
                    // Interpolate where the curve leaves the top of the plot.
                    var prev = db - 0.5, wp = Psy.satHumRatio(prev, P);
                    var f = (wMax - wp) / (ws - wp);
                    satTopDb = prev + 0.5 * f;
                    satPts.push([xOf(satTopDb), yOf(wMax)]);
                    clipPts.push([xOf(satTopDb), yOf(wMax)]);
                    clipPts.push([xOf(dbMax), yOf(wMax)]);
                    break;
                }
                satPts.push([xOf(db), yOf(ws)]);
                clipPts.push([xOf(db), yOf(ws)]);
            }
            clipPts.push([xOf(dbMax), yOf(0)]);
            clipPts.push([xOf(dbMin), yOf(0)]);
            clipPoly.setAttribute('points', clipPts.map(function (p) {
                return p[0].toFixed(1) + ',' + p[1].toFixed(1);
            }).join(' '));
            gSat.appendChild(el('path', { d: pathFrom(satPts) }, 'psy-sat'));

            // --- Grid: vertical dry-bulb lines every 5F, horizontal W every 10 gr ---
            for (var t = dbMin; t <= dbMax + 1e-9; t += 5) {
                var major = (t % 10 === 0);
                var vl = el('line', { x1: xOf(t), y1: yOf(0), x2: xOf(t), y2: mT },
                    major ? 'psy-grid-line psy-grid-major' : 'psy-grid-line');
                vl.setAttribute('clip-path', 'url(#' + id + '-clip)');
                gGrid.appendChild(vl);
                if (major) {
                    gAxes.appendChild(text(xOf(t), mT + ph + 18, String(t), 'psy-axis-label', 'middle'));
                }
                gAxes.appendChild(el('line', { x1: xOf(t), y1: mT + ph, x2: xOf(t), y2: mT + ph + (major ? 6 : 3) }, 'psy-tick'));
            }
            var grStep = 10;
            for (var gr = 0; gr <= wMax * Psy.GRAINS_PER_LB + 1e-9; gr += grStep) {
                var wv = gr / Psy.GRAINS_PER_LB;
                var majorG = (gr % 20 === 0);
                var hl = el('line', { x1: mL, y1: yOf(wv), x2: mL + pw, y2: yOf(wv) },
                    majorG ? 'psy-grid-line psy-grid-major' : 'psy-grid-line');
                hl.setAttribute('clip-path', 'url(#' + id + '-clip)');
                gGrid.appendChild(hl);
                gAxes.appendChild(el('line', { x1: mL + pw, y1: yOf(wv), x2: mL + pw + (majorG ? 6 : 3), y2: yOf(wv) }, 'psy-tick'));
                if (majorG) {
                    gAxes.appendChild(text(mL + pw + 10, yOf(wv) + 4, String(gr), 'psy-axis-label', 'start'));
                }
            }
            gAxes.appendChild(text(mL + pw / 2, H - 14, 'Dry Bulb Temperature (°F)', 'psy-axis-title', 'middle'));
            var yTitle = text(0, 0, 'Humidity Ratio (grains / lb dry air)', 'psy-axis-title', 'middle');
            yTitle.setAttribute('transform', 'translate(' + (W - 14) + ' ' + (mT + ph / 2) + ') rotate(90)');
            gAxes.appendChild(yTitle);
            gAxes.appendChild(text(mL + 6, mT + 16,
                'Barometric pressure ' + Psy.inHgFromPsi(P).toFixed(2) + ' in Hg (' + P.toFixed(3) + ' psia)',
                'psy-pressure-label', 'start'));

            // --- Relative humidity curves 10..90% ---
            if (show.rh) {
                for (var rh = 10; rh <= 90; rh += 10) {
                    var pts = [], last = null;
                    for (var d1 = dbMin; d1 <= dbMax + 1e-9; d1 += 1) {
                        var w1 = Psy.humRatioFromRh(d1, rh / 100, P);
                        if (w1 > wMax) break;
                        pts.push([xOf(d1), yOf(w1)]);
                        last = { db: d1, w: w1 };
                    }
                    if (pts.length < 2) continue;
                    gCurves.appendChild(el('path', { d: pathFrom(pts) }, 'psy-rh'));
                    if (last) {
                        // Label sits just above the line at its right-hand end;
                        // lines that leave through the top get it tucked inside.
                        var lx = xOf(last.db) - 4, ly = yOf(last.w) - 5;
                        if (ly < mT + 12) { ly = mT + 12; lx -= 8; }
                        gLabels.appendChild(text(lx, ly, rh + '%', 'psy-label psy-label-rh', 'end'));
                    }
                }
            }

            // --- Wet-bulb lines every 5F ---
            if (show.wb) {
                for (var wb = Math.ceil(dbMin / 5) * 5; wb <= dbMax; wb += 5) {
                    var wsat = Psy.satHumRatio(wb, P);
                    if (wsat > wMax) break;
                    var wpts = [];
                    for (var d2 = wb; d2 <= dbMax + 1e-9; d2 += 2) {
                        var w2 = Psy.humRatioFromWb(d2, wb, P);
                        if (w2 === null) { // crossed W = 0; add the exact end
                            wpts.push(null);
                            break;
                        }
                        wpts.push([xOf(d2), yOf(w2)]);
                    }
                    gCurves.appendChild(el('path', { d: pathFrom(wpts) }, 'psy-wb'));
                    // Label a little inside the plot, riding the line.
                    var ldb = wb + 4, lw = Psy.humRatioFromWb(ldb, wb, P);
                    if (lw !== null && ldb < dbMax && wb % 10 === 0) {
                        gLabels.appendChild(text(xOf(ldb) + 2, yOf(lw) - 3, String(wb), 'psy-label psy-label-wb', 'start'));
                    }
                }
            }

            // --- Enthalpy lines every 5 Btu/lb, labeled outside saturation ---
            if (show.h) {
                var hMaxAtTop = Psy.enthalpy(satTopDb, wMax);
                var hMin = Math.ceil(Psy.enthalpy(dbMin, 0) / 5) * 5;
                for (var h = hMin; h <= hMaxAtTop; h += 5) {
                    var dbS = Psy.satDbForEnthalpy(h, P);
                    var dbE = h / 0.240; // W = 0 crossing
                    var hpts = [];
                    for (var d3 = dbS; d3 <= Math.min(dbE, dbMax) + 1e-9; d3 += 2) {
                        hpts.push([xOf(d3), yOf(Psy.humRatioFromEnthalpy(h, d3))]);
                    }
                    hpts.push([xOf(Math.min(dbE, dbMax)), yOf(Math.max(0, Psy.humRatioFromEnthalpy(h, Math.min(dbE, dbMax))))]);
                    gCurves.appendChild(el('path', { d: pathFrom(hpts) }, 'psy-h'));
                    if (dbS >= dbMin && dbS <= satTopDb && h % 10 === 0) {
                        var wS = Psy.satHumRatio(dbS, P);
                        gLabels.appendChild(text(xOf(dbS) - 8, yOf(wS) - 6, String(h), 'psy-label psy-label-h', 'end'));
                    }
                }
                // Scale caption once, at the upper-left of the saturation curve.
                gLabels.appendChild(text(mL + 6, mT + 36, 'Enthalpy, Btu/lb dry air', 'psy-label psy-label-h psy-label-caption', 'start'));
            }

            // --- Specific volume lines every 0.5 ft3/lb ---
            if (show.v) {
                for (var v = 12.0; v <= 16.0; v += 0.5) {
                    var db0 = v * P / 0.370486 - 459.67; // W = 0 crossing
                    var dbSv = Psy.satDbForVolume(v, P);
                    if (dbSv < dbMin || db0 > dbMax) continue;
                    var vpts = [];
                    for (var d4 = dbSv; d4 <= Math.min(db0, dbMax) + 1e-9; d4 += 1) {
                        vpts.push([xOf(d4), yOf(Math.max(0, Psy.humRatioFromVolume(v, d4, P)))]);
                    }
                    if (vpts.length < 2) continue;
                    gCurves.appendChild(el('path', { d: pathFrom(vpts) }, 'psy-v'));
                    // Label near the bottom of the line where there is room.
                    var midDb = dbSv + (Math.min(db0, dbMax) - dbSv) * 0.35;
                    var midW = Math.max(0, Psy.humRatioFromVolume(v, midDb, P));
                    if (midDb > dbMin && midDb < dbMax) {
                        gLabels.appendChild(text(xOf(midDb) + 3, yOf(midW) - 2, v.toFixed(1), 'psy-label psy-label-v', 'start'));
                    }
                }
            }
        }

        // -------- Points and lines --------

        function drawDynamic() {
            clear(gLines); clear(gPoints);
            pointPx = {};
            current.points.forEach(function (p) {
                if (!p || !p.state) return;
                var x = xOf(p.state.db), y = yOf(p.state.w);
                pointPx[p.id] = { x: x, y: y };
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
                var inside = p.state.db >= dbMin && p.state.db <= dbMax && p.state.w <= wMax;
                if (!inside) g.setAttribute('class', g.getAttribute('class') + ' psy-point-offchart');
                var cx = Math.min(Math.max(px.x, mL), mL + pw);
                var cy = Math.min(Math.max(px.y, mT), mT + ph);
                g.appendChild(el('circle', { cx: cx, cy: cy, r: 6 }, 'psy-point-halo'));
                g.appendChild(el('circle', { cx: cx, cy: cy, r: 4 }, 'psy-point-dot'));
                var lbl = text(cx + 9, cy - 8, p.label || '', 'psy-point-label', 'start');
                g.appendChild(lbl);
                if (p.title) {
                    var title = el('title');
                    title.textContent = p.title;
                    g.appendChild(title);
                }
                gPoints.appendChild(g);
            });
        }

        // -------- Hover --------

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
            // A hidden/zero-size SVG has a singular matrix; inverse() throws.
            try { return pt.matrixTransform(ctm.inverse()); } catch (e) { return null; }
        }

        svg.addEventListener('mousemove', function (evt) {
            if (current.pressure === null) return;
            var p = svgPoint(evt);
            if (!p) return;
            var db = dbOf(p.x), w = wOf(p.y);
            var inside = db >= dbMin && db <= dbMax && w >= 0 && w <= wMax &&
                         w <= Psy.satHumRatio(db, current.pressure);
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

        // -------- Public API --------

        var lastStaticKey = null;
        return {
            element: svg,
            update: function (data) {
                data = data || {};
                if (data.show) current.show = data.show;
                if (data.pressure !== undefined) current.pressure = data.pressure;
                current.points = data.points || [];
                current.lines = data.lines || [];
                var key = [current.pressure, current.show.rh, current.show.wb, current.show.h, current.show.v].join('|');
                if (key !== lastStaticKey && current.pressure !== null) {
                    drawStatic(current.pressure);
                    lastStaticKey = key;
                }
                drawDynamic();
            },
            onHover: function (cb) { hoverCb = cb; }
        };
    }

    HHpro.PsychroChart = { create: create };
})();
