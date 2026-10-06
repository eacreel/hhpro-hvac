/* ============================================================
   HHpro - ASHRAE climate conditions lookup
   ------------------------------------------------------------
   "Look Up Climate Conditions" on the Psychrometric Calculator:
   a pop-up map of North America with every weather station in
   HHpro - ASHRAE CLIMATE CONDITIONS.xlsx (DATA/JSON/
   ashrae_climate.json, written by convert_to_json.py).

     drag (left button)  pan
     mouse wheel         zoom about the cursor
     right-click         the 10 closest stations, nearest first
                         (press and hold on a touch screen)
     click a station     its heating / cooling design conditions,
                         and the button that imports them

   The basemap (ASSETS/MAP/north_america_map.json) is Natural Earth
   1:10m data (public domain): countries, US / Canadian / Mexican
   state lines, large lakes and cities, pre-projected to a spherical
   Lambert conformal conic and polyline-encoded. Stations are
   projected here with the same formula. Everything comes from our
   own host; no map tiles or other third-party requests.

   Public surface:
     HHpro.ClimateLookup.open({ units, station, onImport })
       units    'IP' | 'SI' for the figures shown (data is IP)
       station  a station to open on (from an earlier import)
       onImport function (station, cooling) - cooling is 'cool'
                (0.4% DB + WB) or 'dehum' (0.4% dehum. DB + DP)
     HHpro.ClimateLookup.loadStations() -> Promise
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var STATIONS_URL = 'DATA/JSON/ashrae_climate.json';
    var MAP_URL = 'ASSETS/MAP/north_america_map.json';
    var NEAREST = 10;
    var EARTH_MI = 3958.8;
    var FIELDS = ['state', 'city', 'station', 'lat', 'lon', 'elev',
        'heatDb', 'coolDb', 'coolWb', 'dehumDb', 'dehumDp'];

    var stationsPromise = null, mapPromise = null;

    function getJson(url) {
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error(url + ' (HTTP ' + r.status + ')');
            return r.json();
        });
    }

    // Rows come as arrays in the order of doc.fields; looked up by name
    // so the converter can add columns without breaking this.
    function loadStations() {
        if (!stationsPromise) {
            stationsPromise = getJson(STATIONS_URL).then(function (doc) {
                var idx = {};
                (doc.fields || []).forEach(function (k, i) { idx[k] = i; });
                FIELDS.forEach(function (k) {
                    if (idx[k] === undefined) throw new Error('ashrae_climate.json has no "' + k + '" field');
                });
                var list = (doc.stations || []).map(function (r) {
                    var s = {};
                    FIELDS.forEach(function (k) { s[k] = r[idx[k]]; });
                    return s;
                });
                return { title: doc.title || '', stations: list };
            });
            stationsPromise.catch(function () { stationsPromise = null; });
        }
        return stationsPromise;
    }

    // Just the data fields (no map coordinates), for the calculator state.
    function cleanStation(s) {
        var o = {};
        FIELDS.forEach(function (k) { o[k] = s[k]; });
        return o;
    }

    function sameStation(a, b) {
        return !!(a && b && a.state === b.state && a.station === b.station &&
            Math.abs(a.lat - b.lat) < 0.01 && Math.abs(a.lon - b.lon) < 0.01);
    }

    // -----------------------------------------------------------------
    // Geometry
    // -----------------------------------------------------------------

    // Spherical Lambert conformal conic (Snyder 15-1..15-5), the same
    // projection mapshaper applied to the basemap (+proj=lcc ... +R=).
    function makeProjection(p) {
        var D = Math.PI / 180, R = p.R;
        var f1 = p.lat1 * D, f2 = p.lat2 * D, f0 = p.lat0 * D, l0 = p.lon0 * D;
        function t(f) { return Math.tan(Math.PI / 4 + f / 2); }
        var n = Math.log(Math.cos(f1) / Math.cos(f2)) / Math.log(t(f2) / t(f1));
        var F = Math.cos(f1) * Math.pow(t(f1), n) / n;
        var rho0 = R * F / Math.pow(t(f0), n);
        return {
            forward: function (lat, lon) {
                var dl = lon * D - l0;
                while (dl > Math.PI) dl -= 2 * Math.PI;
                while (dl < -Math.PI) dl += 2 * Math.PI;
                var rho = R * F / Math.pow(t(lat * D), n);
                return [rho * Math.sin(n * dl), rho0 - rho * Math.cos(n * dl)];
            },
            inverse: function (x, y) {
                var dy = rho0 - y, sg = n < 0 ? -1 : 1;
                var rho = sg * Math.sqrt(x * x + dy * dy);
                var theta = Math.atan2(sg * x, sg * dy);
                var lat = rho === 0 ? sg * 90 : (2 * Math.atan(Math.pow(R * F / rho, 1 / n)) - Math.PI / 2) / D;
                var lon = (theta / n + l0) / D;
                while (lon > 180) lon -= 360;
                while (lon < -180) lon += 360;
                return [lat, lon];
            }
        };
    }

    // Google polyline decoding of x,y pairs (q-metre units) -> metres.
    function decode(str, q) {
        var out = [], i = 0, x = 0, y = 0, len = str.length, b, v, shift;
        while (i < len) {
            v = 0; shift = 0;
            do { b = str.charCodeAt(i++) - 63; v |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
            x += (v & 1) ? ~(v >> 1) : (v >> 1);
            v = 0; shift = 0;
            do { b = str.charCodeAt(i++) - 63; v |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
            y += (v & 1) ? ~(v >> 1) : (v >> 1);
            out.push(x * q, y * q);
        }
        return out;
    }

    function loadMap() {
        if (!mapPromise) {
            mapPromise = getJson(MAP_URL).then(function (doc) {
                var q = doc.q || 100;
                var proj = makeProjection(doc.proj);
                var bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
                function add(path, enc, closed, grow) {
                    var c = decode(enc, q);
                    if (c.length < 4) return;
                    path.moveTo(c[0], c[1]);
                    for (var i = 2; i < c.length; i += 2) path.lineTo(c[i], c[i + 1]);
                    if (closed) path.closePath();
                    if (grow) {
                        for (var j = 0; j < c.length; j += 2) {
                            if (c[j] < bounds.minX) bounds.minX = c[j];
                            if (c[j] > bounds.maxX) bounds.maxX = c[j];
                            if (c[j + 1] < bounds.minY) bounds.minY = c[j + 1];
                            if (c[j + 1] > bounds.maxY) bounds.maxY = c[j + 1];
                        }
                    }
                }
                function lines(list, closed) {
                    var p = new Path2D();
                    (list || []).forEach(function (s) { add(p, s, closed, false); });
                    return p;
                }
                var landUs = new Path2D(), landOther = new Path2D();
                (doc.land || []).forEach(function (c) {
                    var p = c.a === 'USA' ? landUs : landOther;
                    c.r.forEach(function (s) { add(p, s, true, true); });
                });
                function placed(list, map) {
                    return (list || []).map(function (r) {
                        var xy = proj.forward(r[1], r[2]);
                        return map(r, xy[0], xy[1]);
                    });
                }
                return {
                    proj: proj,
                    bounds: bounds,
                    landUs: landUs,
                    landOther: landOther,
                    lakes: lines(doc.lakes, true),
                    states: lines(doc.states, false),
                    borders: lines(doc.borders, false),
                    labels: placed(doc.labels, function (r, x, y) { return { text: r[0], x: x, y: y }; }),
                    cities: placed(doc.cities, function (r, x, y) { return { name: r[0], rank: r[3], x: x, y: y }; })
                };
            });
            mapPromise.catch(function () { mapPromise = null; });
        }
        return mapPromise;
    }

    function haversineMi(lat1, lon1, lat2, lon2) {
        var D = Math.PI / 180;
        var dLat = (lat2 - lat1) * D, dLon = (lon2 - lon1) * D;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * D) * Math.cos(lat2 * D) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * EARTH_MI * Math.asin(Math.min(1, Math.sqrt(a)));
    }

    // -----------------------------------------------------------------
    // Map view (canvas)
    // -----------------------------------------------------------------

    var MAP_COLORS = ['water', 'land', 'land-us', 'coast', 'state', 'border', 'label',
        'city', 'station', 'station-edge', 'near', 'selected', 'query'];

    // host: positioned element the canvas fills. handlers: onPick(station),
    // onQuery(lat, lon), onHover(station|null).
    function MapView(host, geo, stations, handlers) {
        var canvas = document.createElement('canvas');
        canvas.className = 'climate-canvas';
        canvas.setAttribute('aria-label', 'Map of ASHRAE weather stations');
        host.appendChild(canvas);
        var tip = document.createElement('div');
        tip.className = 'climate-tip';
        tip.hidden = true;
        host.appendChild(tip);
        var ctx = canvas.getContext('2d');

        var css = getComputedStyle(host);
        var C = {};
        MAP_COLORS.forEach(function (k) { C[k] = css.getPropertyValue('--map-' + k).trim() || '#888'; });
        var FONT = css.fontFamily || 'sans-serif';

        var b = geo.bounds;
        var w = 0, h = 0, dpr = 1, k = 0, cx = 0, cy = 0;
        // 100 m per pixel at the closest zoom: about what the 1:10m coastline
        // holds up to (coastal stations sit within a few km of it).
        var kMax = 1 / 100;
        var near = [], selected = null, query = null, hover = null;
        var frame = 0, alive = true;

        function kMin() {
            return Math.min(w / ((b.maxX - b.minX) * 1.02), h / ((b.maxY - b.minY) * 1.02));
        }

        function clampView() {
            k = Math.max(kMin(), Math.min(kMax, k));
            cx = Math.max(b.minX, Math.min(b.maxX, cx));
            cy = Math.max(b.minY, Math.min(b.maxY, cy));
        }

        function toScreen(x, y) { return [(x - cx) * k + w / 2, (cy - y) * k + h / 2]; }
        function toWorld(sx, sy) { return [(sx - w / 2) / k + cx, cy - (sy - h / 2) / k]; }

        // Contiguous US with a margin: where most lookups start.
        function lower48() {
            var pts = [];
            [-125, -115, -105, -96, -87, -77, -67].forEach(function (lon) {
                pts.push(geo.proj.forward(49.5, lon));
                pts.push(geo.proj.forward(24.5, lon));
            });
            return fitFor(pts, 0.04);
        }

        // View {cx, cy, k} that frames the points with `pad` of margin.
        function fitFor(pts, pad) {
            var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            pts.forEach(function (p) {
                x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
                y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
            });
            var bw = Math.max(x1 - x0, 20000), bh = Math.max(y1 - y0, 20000);
            return {
                cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
                k: Math.min(w / (bw * (1 + 2 * pad)), h / (bh * (1 + 2 * pad)))
            };
        }

        // Ease to a view (zoom on a log scale). Dragging or the wheel stops it.
        var anim = 0;
        function stopAnim() { if (anim) { cancelAnimationFrame(anim); anim = 0; } }
        function animateTo(t) {
            stopAnim();
            var tk = Math.max(kMin(), Math.min(kMax, t.k));
            var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            if (reduce) { cx = t.cx; cy = t.cy; k = tk; clampView(); schedule(); return; }
            var s = { cx: cx, cy: cy, lk: Math.log(k) }, lt = Math.log(tk), t0 = 0, dur = 420;
            function step(now) {
                if (!t0) t0 = now;
                var u = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - u, 3);
                k = Math.exp(s.lk + (lt - s.lk) * e);
                cx = s.cx + (t.cx - s.cx) * e;
                cy = s.cy + (t.cy - s.cy) * e;
                clampView();
                draw();
                anim = (u < 1 && alive) ? requestAnimationFrame(step) : 0;
            }
            anim = requestAnimationFrame(step);
        }

        function resize() {
            var r = host.getBoundingClientRect();
            var nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
            if (nw === w && nh === h) return;
            var first = !w;
            w = nw; h = nh;
            dpr = window.devicePixelRatio || 1;
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            if (first) { var v = lower48(); cx = v.cx; cy = v.cy; k = v.k; }
            clampView();
            draw();
        }

        function schedule() {
            if (frame || !alive) return;
            frame = requestAnimationFrame(function () { frame = 0; draw(); });
        }

        function overlaps(r, placed) {
            for (var i = 0; i < placed.length; i++) {
                var p = placed[i];
                if (r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]) return true;
            }
            return false;
        }

        function stationRadius() {
            var km = w / k / 1000;
            return km > 3500 ? 1.8 : km > 1200 ? 2.4 : km > 400 ? 3 : 3.6;
        }

        function draw() {
            if (!w || !alive) return;
            var px = 1 / k;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = C.water;
            ctx.fillRect(0, 0, w, h);

            // Basemap in world (metre) coordinates, y up.
            ctx.setTransform(k * dpr, 0, 0, -k * dpr, (w / 2 - cx * k) * dpr, (h / 2 + cy * k) * dpr);
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.fillStyle = C.land;
            ctx.fill(geo.landOther, 'evenodd');
            ctx.fillStyle = C['land-us'];
            ctx.fill(geo.landUs, 'evenodd');
            ctx.strokeStyle = C.coast;
            ctx.lineWidth = 0.8 * px;
            ctx.stroke(geo.landOther);
            ctx.stroke(geo.landUs);
            ctx.fillStyle = C.water;
            ctx.fill(geo.lakes, 'evenodd');
            ctx.stroke(geo.lakes);
            ctx.strokeStyle = C.state;
            ctx.lineWidth = 0.8 * px;
            ctx.stroke(geo.states);
            ctx.strokeStyle = C.border;
            ctx.lineWidth = 1.3 * px;
            ctx.stroke(geo.borders);

            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            var km = w / k / 1000, placed = [];

            // State / province abbreviations at mid zoom.
            if (km < 7000 && km > 350) {
                ctx.font = '600 11px ' + FONT;
                ctx.fillStyle = C.label;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                geo.labels.forEach(function (l) {
                    var s = toScreen(l.x, l.y);
                    if (s[0] < -20 || s[0] > w + 20 || s[1] < -20 || s[1] > h + 20) return;
                    var tw = ctx.measureText(l.text).width;
                    var r = [s[0] - tw / 2 - 2, s[1] - 7, s[0] + tw / 2 + 2, s[1] + 7];
                    if (overlaps(r, placed)) return;
                    placed.push(r);
                    ctx.fillText(l.text, s[0], s[1]);
                });
            }

            // Cities: larger ones first, more as you zoom in; a city is
            // only drawn when its label fits.
            var maxRank = km > 5000 ? 2 : km > 2500 ? 3 : km > 1200 ? 4 : km > 600 ? 6 : km > 250 ? 7 : 8;
            ctx.font = '11px ' + FONT;
            ctx.textBaseline = 'middle';
            var shown = 0;
            for (var i = 0; i < geo.cities.length && shown < 140; i++) {
                var c = geo.cities[i];
                if (c.rank > maxRank) continue;
                var s = toScreen(c.x, c.y);
                if (s[0] < -40 || s[0] > w + 40 || s[1] < -10 || s[1] > h + 10) continue;
                var tw = ctx.measureText(c.name).width;
                var right = [s[0] - 3, s[1] - 7, s[0] + 6 + tw, s[1] + 7];
                var left = [s[0] - 6 - tw, s[1] - 7, s[0] + 3, s[1] + 7];
                var r = !overlaps(right, placed) ? right : (!overlaps(left, placed) ? left : null);
                if (!r) continue;
                placed.push(r);
                shown++;
                ctx.fillStyle = C.city;
                ctx.beginPath();
                ctx.arc(s[0], s[1], 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 0.85;
                ctx.textAlign = r === right ? 'left' : 'right';
                ctx.fillText(c.name, r === right ? s[0] + 5 : s[0] - 5, s[1]);
                ctx.globalAlpha = 1;
            }

            // Stations.
            var rad = stationRadius();
            ctx.beginPath();
            stations.forEach(function (st) {
                var p = toScreen(st.x, st.y);
                if (p[0] < -5 || p[0] > w + 5 || p[1] < -5 || p[1] > h + 5) return;
                ctx.moveTo(p[0] + rad, p[1]);
                ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
            });
            ctx.fillStyle = C.station;
            ctx.fill();
            ctx.lineWidth = 0.75;
            ctx.strokeStyle = C['station-edge'];
            ctx.stroke();

            if (query) {
                var qs = toScreen(query.x, query.y);
                ctx.strokeStyle = C.query;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(qs[0], qs[1], 6, 0, Math.PI * 2);
                ctx.moveTo(qs[0] - 11, qs[1]); ctx.lineTo(qs[0] - 3, qs[1]);
                ctx.moveTo(qs[0] + 3, qs[1]); ctx.lineTo(qs[0] + 11, qs[1]);
                ctx.moveTo(qs[0], qs[1] - 11); ctx.lineTo(qs[0], qs[1] - 3);
                ctx.moveTo(qs[0], qs[1] + 3); ctx.lineTo(qs[0], qs[1] + 11);
                ctx.stroke();
            }

            // Numbered badges for the closest stations, farthest drawn first
            // so number 1 sits on top.
            ctx.font = '700 10px ' + FONT;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (var n = near.length - 1; n >= 0; n--) {
                var ns = toScreen(near[n].x, near[n].y);
                var isSel = near[n] === selected;
                ctx.beginPath();
                ctx.arc(ns[0], ns[1], 9, 0, Math.PI * 2);
                ctx.fillStyle = isSel ? C.selected : C.near;
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = C['station-edge'];
                ctx.stroke();
                ctx.fillStyle = C['station-edge'];
                ctx.fillText(String(n + 1), ns[0], ns[1] + 0.5);
            }

            if (selected && near.indexOf(selected) < 0) {
                var ss = toScreen(selected.x, selected.y);
                ctx.beginPath();
                ctx.arc(ss[0], ss[1], 6, 0, Math.PI * 2);
                ctx.fillStyle = C.selected;
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = C['station-edge'];
                ctx.stroke();
            }

            if (hover) {
                var hs = toScreen(hover.x, hover.y);
                ctx.beginPath();
                ctx.arc(hs[0], hs[1], near.indexOf(hover) >= 0 ? 12 : 8, 0, Math.PI * 2);
                ctx.lineWidth = 2;
                ctx.strokeStyle = C.city;
                ctx.stroke();
            }

            drawScale();
        }

        // Scale bar (miles), measured across the middle of the view.
        function drawScale() {
            var a = toWorld(w / 2 - 50, h / 2), z = toWorld(w / 2 + 50, h / 2);
            var la = geo.proj.inverse(a[0], a[1]), lz = geo.proj.inverse(z[0], z[1]);
            var miPerPx = haversineMi(la[0], la[1], lz[0], lz[1]) / 100;
            if (!(miPerPx > 0)) return;
            var target = 110 * miPerPx, pow = Math.pow(10, Math.floor(Math.log(target) / Math.LN10));
            var nice = [5, 2, 1].map(function (m) { return m * pow; }).filter(function (v) { return v <= target; })[0] || pow;
            var len = nice / miPerPx, x0 = 14, y0 = h - 16;
            ctx.strokeStyle = C.city;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x0, y0 - 5); ctx.lineTo(x0, y0); ctx.lineTo(x0 + len, y0); ctx.lineTo(x0 + len, y0 - 5);
            ctx.stroke();
            ctx.font = '11px ' + FONT;
            ctx.fillStyle = C.city;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillText(nice.toLocaleString('en-US') + ' mi', x0 + len + 6, y0 + 1);
        }

        function localPoint(e) {
            var r = canvas.getBoundingClientRect();
            return [e.clientX - r.left, e.clientY - r.top];
        }

        function stationAt(sx, sy) {
            var best = null, bestD = Infinity, lim = Math.max(7, stationRadius() + 4);
            // Numbered badges are bigger targets.
            near.forEach(function (st) {
                var p = toScreen(st.x, st.y), d = Math.hypot(p[0] - sx, p[1] - sy);
                if (d <= 10 && d < bestD) { best = st; bestD = d; }
            });
            if (best) return best;
            stations.forEach(function (st) {
                var p = toScreen(st.x, st.y), d = Math.hypot(p[0] - sx, p[1] - sy);
                if (d <= lim && d < bestD) { best = st; bestD = d; }
            });
            return best;
        }

        function zoomAt(sx, sy, f) {
            var wp = toWorld(sx, sy);
            k = k * f;
            clampView();
            cx = wp[0] - (sx - w / 2) / k;
            cy = wp[1] + (sy - h / 2) / k;
            clampView();
            schedule();
        }

        function setHover(st, sx, sy) {
            if (st !== hover) { hover = st; schedule(); if (handlers.onHover) handlers.onHover(st); }
            if (st && sx !== undefined) {
                tip.textContent = st.station + ' — ' + st.city + ', ' + st.state;
                tip.hidden = false;
                var tx = Math.min(sx + 14, w - tip.offsetWidth - 6);
                tip.style.left = Math.max(6, tx) + 'px';
                tip.style.top = Math.max(6, sy - 30) + 'px';
            } else {
                tip.hidden = true;
            }
        }

        function runQuery(sx, sy) {
            var wp = toWorld(sx, sy), ll = geo.proj.inverse(wp[0], wp[1]);
            query = { x: wp[0], y: wp[1], lat: ll[0], lon: ll[1] };
            schedule();
            handlers.onQuery(ll[0], ll[1]);
        }

        // ---- pointer + wheel ----
        var drag = null, holdTimer = 0;

        canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            stopAnim();
            var d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
            var p = localPoint(e);
            zoomAt(p[0], p[1], Math.exp(-d * 0.0018));
        }, { passive: false });

        canvas.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) return;
            stopAnim();
            var p = localPoint(e);
            drag = { x: p[0], y: p[1], cx: cx, cy: cy, moved: false };
            try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
            canvas.classList.add('is-dragging');
            if (e.pointerType === 'touch') {
                clearTimeout(holdTimer);
                holdTimer = setTimeout(function () {
                    if (drag && !drag.moved) { drag.held = true; runQuery(p[0], p[1]); }
                }, 550);
            }
        });

        canvas.addEventListener('pointermove', function (e) {
            var p = localPoint(e);
            if (drag) {
                var dx = p[0] - drag.x, dy = p[1] - drag.y;
                if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; clearTimeout(holdTimer); setHover(null); }
                if (drag.moved) {
                    cx = drag.cx - dx / k;
                    cy = drag.cy + dy / k;
                    clampView();
                    schedule();
                }
            } else {
                setHover(stationAt(p[0], p[1]), p[0], p[1]);
            }
            if (handlers.onPointer) {
                var wp = toWorld(p[0], p[1]);
                handlers.onPointer(geo.proj.inverse(wp[0], wp[1]));
            }
        });

        function endDrag(e, cancelled) {
            clearTimeout(holdTimer);
            if (!drag) return;
            var d = drag;
            drag = null;
            canvas.classList.remove('is-dragging');
            if (cancelled || d.moved || d.held) return;
            var p = localPoint(e), st = stationAt(p[0], p[1]);
            if (st) handlers.onPick(st);
        }
        canvas.addEventListener('pointerup', function (e) { endDrag(e, false); });
        canvas.addEventListener('pointercancel', function (e) { endDrag(e, true); });
        canvas.addEventListener('pointerleave', function () {
            if (!drag) setHover(null);
            if (handlers.onPointer) handlers.onPointer(null);
        });

        canvas.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            var p = localPoint(e);
            runQuery(p[0], p[1]);
        });

        canvas.addEventListener('dblclick', function (e) {
            var p = localPoint(e);
            zoomAt(p[0], p[1], 2);
        });

        var ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
        if (ro) ro.observe(host); else window.addEventListener('resize', resize);
        resize();

        function inView(x, y, margin) {
            var s = toScreen(x, y);
            return s[0] > margin && s[0] < w - margin && s[1] > margin && s[1] < h - margin;
        }

        return {
            zoomBy: function (f) { stopAnim(); zoomAt(w / 2, h / 2, f); },
            reset: function () { animateTo(lower48()); },
            setNear: function (list) { near = list.slice(); schedule(); },
            setSelected: function (st) { selected = st; schedule(); },
            setHighlight: function (st) { hover = st; schedule(); },
            // Bring a station into view; minK zooms in to at least that
            // scale. `now` skips the easing (opening on a station).
            focus: function (st, minK, now) {
                var tk = Math.max(k, minK || 0);
                if (tk === k && inView(st.x, st.y, 40)) return;
                if (now) { cx = st.x; cy = st.y; k = tk; clampView(); schedule(); }
                else animateTo({ cx: st.x, cy: st.y, k: tk });
            },
            // Frame the closest stations and the clicked point: zoom out if
            // they do not all fit, or in (up to 6x) when they are bunched
            // up too small to tell the numbered badges apart.
            show: function (list) {
                if (!list.length) return;
                var pts = list.map(function (st) { return [st.x, st.y]; });
                if (query) pts.push([query.x, query.y]);
                var all = pts.every(function (pt) { return inView(pt[0], pt[1], 20); });
                var f = fitFor(pts, 0.3);
                if (!all) animateTo({ cx: f.cx, cy: f.cy, k: Math.min(f.k, k) });
                else if (f.k > k * 1.5) animateTo({ cx: f.cx, cy: f.cy, k: Math.min(f.k, k * 6) });
            },
            stateScale: function () { return w / 900000; },   // about 900 km across
            destroy: function () {
                alive = false;
                stopAnim();
                clearTimeout(holdTimer);
                if (frame) cancelAnimationFrame(frame);
                if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
            }
        };
    }

    // -----------------------------------------------------------------
    // Pop-up
    // -----------------------------------------------------------------

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function fmt(n, d) {
        return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    // '2025 ASHRAE CLIMATE DESIGN CONDITIONS - IP' (the workbook's heading)
    // -> '2025 ASHRAE Climate Design Conditions (IP)'.
    function titleCase(t) {
        if (!t) return 'ASHRAE Climatic Design Conditions';
        var ip = /\s*-\s*IP$/i.test(t);
        t = t.replace(/\s*-\s*IP$/i, '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); })
            .replace(/\bAshrae\b/g, 'ASHRAE');
        return ip ? t + ' (IP)' : t;
    }

    function open(opts) {
        opts = opts || {};
        var SI = opts.units === 'SI';
        function temp(f) { return SI ? fmt((f - 32) / 1.8, 1) + ' °C' : fmt(f, 1) + ' °F'; }
        function elev(ft) { return SI ? fmt(ft * 0.3048, 0) + ' m' : fmt(ft, 0) + ' ft'; }
        function dist(mi) { return SI ? fmt(mi * 1.609344, mi < 6 ? 1 : 0) + ' km' : fmt(mi, mi < 10 ? 1 : 0) + ' mi'; }
        function latLon(lat, lon) {
            return fmt(Math.abs(lat), 3) + '°' + (lat < 0 ? 'S' : 'N') + ', ' +
                fmt(Math.abs(lon), 3) + '°' + (lon < 0 ? 'W' : 'E');
        }

        var bd = el('div', 'modal-backdrop climate-backdrop');
        var box = el('div', 'climate-modal');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'climate-title');
        bd.appendChild(box);

        var head = el('div', 'climate-head');
        var titles = el('div', 'climate-titles');
        var h = el('h2', 'climate-title', 'Look Up Climate Conditions');
        h.id = 'climate-title';
        titles.appendChild(h);
        var sub = el('p', 'climate-sub', 'ASHRAE climatic design conditions by weather station');
        titles.appendChild(sub);
        head.appendChild(titles);
        var closeBtn = el('button', 'psy-icon-btn climate-close');
        closeBtn.type = 'button';
        closeBtn.title = 'Close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.appendChild(HHpro.UI.icon('x'));
        head.appendChild(closeBtn);
        box.appendChild(head);

        var body = el('div', 'climate-body');
        var mapHost = el('div', 'climate-map');
        var status = el('div', 'climate-map-status', 'Loading map and stations…');
        mapHost.appendChild(status);
        body.appendChild(mapHost);
        var side = el('div', 'climate-side');
        body.appendChild(side);
        box.appendChild(body);

        var view = null, data = null, ui = { mode: 'intro', back: null, near: [], query: null, results: [] };

        function close() {
            if (view) view.destroy();
            document.removeEventListener('keydown', onKey, true);
            if (bd.parentNode) bd.parentNode.removeChild(bd);
        }
        function onKey(e) {
            if (e.key === 'Escape') { e.stopPropagation(); close(); }
        }
        closeBtn.addEventListener('click', close);
        bd.addEventListener('click', function (e) { if (e.target === bd) close(); });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(bd);

        // ---- side panel ----
        var search = el('input', 'psy-input climate-search');
        search.type = 'search';
        search.placeholder = 'Search city, station or state…';
        search.setAttribute('aria-label', 'Search stations');
        search.disabled = true;
        var sideBody = el('div', 'climate-side-body');
        side.appendChild(search);
        side.appendChild(sideBody);

        function render() {
            sideBody.innerHTML = '';
            if (ui.mode === 'station') renderStation();
            else if (ui.mode === 'search') renderList(ui.results, false);
            else if (ui.mode === 'nearest') renderList(ui.near, true);
            else renderIntro();
        }

        function renderIntro() {
            sideBody.appendChild(el('h3', 'climate-side-title', 'Find a station'));
            var ul = el('ul', 'climate-steps');
            ['Drag the map to move around; use the mouse wheel to zoom.',
                'Right-click a spot to list the 10 closest stations, nearest first (press and hold on a touch screen).',
                'Click a station in the list or on the map to see its heating and cooling design conditions and import them.'
            ].forEach(function (t) { ul.appendChild(el('li', null, t)); });
            sideBody.appendChild(ul);
            if (data) {
                sideBody.appendChild(el('p', 'climate-note', fmt(data.stations.length, 0) + ' stations from ' +
                    (data.title || 'the ASHRAE climatic design conditions') + '.'));
            }
        }

        function stationRow(st, i, d) {
            var b = el('button', 'climate-st' + (st === ui.station ? ' is-selected' : ''));
            b.type = 'button';
            if (i !== null) b.appendChild(el('span', 'climate-st-num', String(i + 1)));
            var main = el('span', 'climate-st-main');
            main.appendChild(el('span', 'climate-st-name', st.station));
            main.appendChild(el('span', 'climate-st-meta', st.city + ', ' + st.state + ' · ' + elev(st.elev)));
            b.appendChild(main);
            if (d !== null && d !== undefined) b.appendChild(el('span', 'climate-st-dist', dist(d)));
            b.addEventListener('mouseenter', function () { if (view) view.setHighlight(st); });
            b.addEventListener('mouseleave', function () { if (view) view.setHighlight(null); });
            b.addEventListener('click', function () { pick(st, ui.mode); });
            return b;
        }

        function renderList(list, isNear) {
            var top = el('div', 'climate-side-head');
            if (isNear) {
                top.appendChild(el('h3', 'climate-side-title', NEAREST + ' closest stations'));
                top.appendChild(el('p', 'climate-note', 'To ' + latLon(ui.query.lat, ui.query.lon) + '. Right-click again to move the point.'));
            } else {
                top.appendChild(el('h3', 'climate-side-title', list.length ? 'Search results' : 'No stations found'));
                if (list.length >= 40) top.appendChild(el('p', 'climate-note', 'First 40 matches. Add more of the name to narrow it down.'));
            }
            sideBody.appendChild(top);
            var wrap = el('div', 'climate-st-list');
            list.forEach(function (item, i) {
                wrap.appendChild(isNear ? stationRow(item.st, i, item.d) : stationRow(item, null, null));
            });
            sideBody.appendChild(wrap);
        }

        function dataRow(tbl, label, value) {
            var tr = el('tr');
            tr.appendChild(el('th', null, label));
            tr.appendChild(el('td', null, value));
            tbl.appendChild(tr);
        }

        function renderStation() {
            var st = ui.station;
            if (ui.back) {
                var back = el('button', 'climate-back');
                back.type = 'button';
                back.appendChild(HHpro.UI.icon('arrow-left'));
                back.appendChild(el('span', null, ui.back === 'nearest' ? 'Closest stations' : 'Search results'));
                back.addEventListener('click', function () { ui.mode = ui.back; ui.back = null; render(); });
                sideBody.appendChild(back);
            }
            var card = el('div', 'climate-card');
            card.appendChild(el('h3', 'climate-card-title', st.station));
            card.appendChild(el('p', 'climate-card-place', st.city + ', ' + st.state));
            var meta = el('dl', 'psy-kv climate-kv');
            function kv(k, v) { meta.appendChild(el('dt', null, k)); meta.appendChild(el('dd', null, v)); }
            kv('Location', latLon(st.lat, st.lon));
            kv('Elevation', elev(st.elev));
            if (ui.query) kv('Distance', dist(haversineMi(ui.query.lat, ui.query.lon, st.lat, st.lon)) + ' from the point clicked');
            card.appendChild(meta);

            var tbl = el('table', 'climate-data');
            dataRow(tbl, '99.6% Heating', temp(st.heatDb) + ' DB');
            dataRow(tbl, '0.4% Cooling', temp(st.coolDb) + ' DB / ' + temp(st.coolWb) + ' WB');
            dataRow(tbl, '0.4% Cooling Dehum.', temp(st.dehumDb) + ' DB / ' + temp(st.dehumDp) + ' DP');
            card.appendChild(tbl);

            if (typeof opts.onImport === 'function') {
                var imp = el('button', 'projects-btn projects-btn-primary climate-import');
                imp.type = 'button';
                imp.appendChild(HHpro.UI.icon('download'));
                imp.appendChild(el('span', null, 'Import to psychrometric chart'));
                card.appendChild(imp);

                var ask = el('div', 'climate-ask');
                ask.hidden = true;
                ask.appendChild(el('p', 'climate-ask-q', 'Which cooling condition should be used?'));
                [['cool', '0.4% Cooling', temp(st.coolDb) + ' DB / ' + temp(st.coolWb) + ' WB'],
                    ['dehum', '0.4% Cooling Dehum.', temp(st.dehumDb) + ' DB / ' + temp(st.dehumDp) + ' DP']
                ].forEach(function (c) {
                    var b = el('button', 'climate-choice');
                    b.type = 'button';
                    b.appendChild(el('span', 'climate-choice-name', c[1]));
                    b.appendChild(el('span', 'climate-choice-val', c[2]));
                    b.addEventListener('click', function () {
                        var fn = opts.onImport;
                        close();
                        fn(cleanStation(st), c[0]);
                    });
                    ask.appendChild(b);
                });
                ask.appendChild(el('p', 'climate-note', 'The heating condition (' + temp(st.heatDb) + ' DB) and the elevation (' +
                    elev(st.elev) + ') come with either. You can switch between the two cooling conditions later in the ASHRAE Conditions section.'));
                var cancel = el('button', 'projects-btn projects-btn-secondary psy-small-btn climate-ask-cancel', 'Cancel');
                cancel.type = 'button';
                cancel.addEventListener('click', function () { ask.hidden = true; imp.hidden = false; });
                ask.appendChild(cancel);
                card.appendChild(ask);
                imp.addEventListener('click', function () {
                    imp.hidden = true;
                    ask.hidden = false;
                    var first = ask.querySelector('.climate-choice');
                    if (first) first.focus();
                });
            }
            sideBody.appendChild(card);
        }

        // from: the list the station was picked in ('nearest' / 'search'),
        // which the Back button returns to.
        function pick(st, from) {
            ui.station = st;
            ui.back = ((from === 'nearest' && ui.near.length) || (from === 'search' && ui.results.length)) ? from : null;
            ui.mode = 'station';
            // A search hit can be anywhere: go there at state scale.
            if (view) { view.setSelected(st); view.focus(st, from === 'search' ? view.stateScale() : 0); }
            render();
        }

        function nearestTo(lat, lon) {
            return data.stations
                .map(function (st) { return { st: st, d: haversineMi(lat, lon, st.lat, st.lon) }; })
                .sort(function (a, b) { return a.d - b.d; })
                .slice(0, NEAREST);
        }

        function runSearch() {
            var q = search.value.trim().toLowerCase();
            if (!q) {
                ui.mode = ui.near.length ? 'nearest' : 'intro';
                render();
                return;
            }
            var words = q.split(/[\s,]+/).filter(Boolean);
            var hits = data.stations.filter(function (st) {
                var hay = (st.station + ' ' + st.city + ' ' + st.state).toLowerCase();
                return words.every(function (wd) { return hay.indexOf(wd) >= 0; });
            });
            // Cities and stations that start with the search come first.
            hits.sort(function (a, b) {
                var sa = (a.city.toLowerCase().indexOf(words[0]) === 0 || a.station.toLowerCase().indexOf(words[0]) === 0) ? 0 : 1;
                var sb = (b.city.toLowerCase().indexOf(words[0]) === 0 || b.station.toLowerCase().indexOf(words[0]) === 0) ? 0 : 1;
                return (sa - sb) || a.state.localeCompare(b.state) || a.station.localeCompare(b.station);
            });
            ui.results = hits.slice(0, 40);
            ui.mode = 'search';
            render();
        }
        search.addEventListener('input', runSearch);

        render();

        Promise.all([loadStations(), loadMap()]).then(function (res) {
            if (!bd.parentNode) return;
            data = res[0];
            var geo = res[1];
            data.stations.forEach(function (st) {
                if (st.x === undefined) { var p = geo.proj.forward(st.lat, st.lon); st.x = p[0]; st.y = p[1]; }
            });
            mapHost.removeChild(status);
            sub.textContent = titleCase(data.title) + ' · ' + fmt(data.stations.length, 0) + ' stations';

            var coords = el('div', 'climate-coords');
            view = MapView(mapHost, geo, data.stations, {
                onPick: function (st) { pick(st, ui.mode === 'station' ? ui.back : ui.mode); },
                onQuery: function (lat, lon) {
                    ui.query = { lat: lat, lon: lon };
                    ui.near = nearestTo(lat, lon);
                    view.setNear(ui.near.map(function (n) { return n.st; }));
                    view.show(ui.near.map(function (n) { return n.st; }));
                    search.value = '';
                    ui.mode = 'nearest';
                    ui.back = null;
                    render();
                },
                onPointer: function (ll) {
                    coords.textContent = ll ? fmt(Math.abs(ll[0]), 2) + '°' + (ll[0] < 0 ? 'S' : 'N') + '  ' +
                        fmt(Math.abs(ll[1]), 2) + '°' + (ll[1] < 0 ? 'W' : 'E') : '';
                }
            });

            var ctl = el('div', 'climate-ctl');
            [['+', 'Zoom in', function () { view.zoomBy(1.6); }],
                ['−', 'Zoom out', function () { view.zoomBy(1 / 1.6); }],
                ['⌂', 'Reset view (contiguous US)', function () { view.reset(); }]
            ].forEach(function (c) {
                var b = el('button', 'climate-ctl-btn', c[0]);
                b.type = 'button';
                b.title = c[1];
                b.setAttribute('aria-label', c[1]);
                b.addEventListener('click', c[2]);
                ctl.appendChild(b);
            });
            mapHost.appendChild(ctl);
            mapHost.appendChild(el('div', 'climate-hint', 'Drag to pan · Wheel to zoom · Right-click for the 10 closest stations'));
            var foot = el('div', 'climate-foot');
            foot.appendChild(coords);
            foot.appendChild(el('span', 'climate-attrib', 'Map data: Natural Earth'));
            mapHost.appendChild(foot);

            search.disabled = false;

            // Re-opened from the ASHRAE Conditions section: start on that station.
            if (opts.station) {
                var cur = null;
                data.stations.forEach(function (st) { if (!cur && sameStation(st, opts.station)) cur = st; });
                if (cur) {
                    ui.station = cur;
                    ui.mode = 'station';
                    view.setSelected(cur);
                    view.focus(cur, view.stateScale(), true);
                    render();
                }
            }
            if (ui.mode !== 'station') search.focus();
        }).catch(function (err) {
            console.error('Climate lookup:', err);
            if (!bd.parentNode) return;
            status.textContent = 'Could not load the climate data. ' + (err && err.message ? err.message : '');
            status.classList.add('is-error');
        });

        return { close: close };
    }

    HHpro.ClimateLookup = {
        open: open,
        loadStations: loadStations
    };
})();
