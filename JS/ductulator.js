/* ============================================================
   HHpro - Ductulator (duct sizing calculator)
   ------------------------------------------------------------
   The slide-rule duct calculator, done properly. Pick the duct
   shape (round or rectangular), then airflow plus ONE of friction
   rate / velocity / size fixes the other quantities:

       friction rate   Darcy-Weisbach with the Colebrook friction
                       factor (ASHRAE Fundamentals, Duct Design):
                         dp = 12 f (L / D) rho (V / 1097)^2   [in. w.g.]
                       D in inches, V in fpm, rho in lb/ft3
       velocity        V = Q / A
       velocity pressure  VP = rho (V / 1097)^2
       equivalent round   Huebscher: De = 1.30 (a b)^0.625 / (a + b)^0.25
                       (same friction per foot as the rectangle at the
                       same airflow; the rectangle's own velocity is
                       lower because its area is larger)

   Rectangular ducts are solved the way the instrument is used: the
   width you can fit is given, the height comes out, and the answer
   is rounded to the even-inch stock size with that size's actual
   friction and velocity reported.

   Roughness comes from the ASHRAE duct roughness categories; the
   physical Ductulator assumes galvanized steel (medium smooth,
   0.0003 ft). Air density follows the site altitude at 70F.

   The chart on the right is the standard log-log duct friction
   chart (airflow vs friction rate with round-diameter and velocity
   line families), computed from the same equations as the results
   so the picture is exact, with the duct in hand plotted as a dot
   and a hover readout. Beside it, a dimensioned cross-section of
   the selected duct is drawn to scale so the shape and size in the
   picture always match the numbers.

   Registers on the Calculators hub; Save to project / Export PDF
   mirror the dew point calculator.
   ============================================================ */
(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    var Psy, U;
    var state = null;
    var refs = {};
    var errorEl = null;
    var SVG_NS = 'http://www.w3.org/2000/svg';

    // ---------- Physical constants (IP) ----------
    var RHO_STD = 0.075;      // lb/ft3, standard air
    var MU_AIR = 1.222e-5;    // lb/(ft s), dynamic viscosity near 70F
    var P_STD = 14.696;       // psia

    // ASHRAE Fundamentals duct roughness categories (absolute roughness, ft).
    var MATERIALS = [
        ['galv',       'Galvanized steel, longitudinal seams, 4 ft joints', 0.0003, 'medium smooth'],
        ['spiral',     'Galvanized steel, spiral seams',                    0.0003, 'medium smooth'],
        ['galv25',     'Galvanized steel, longitudinal seams, 2.5 ft joints', 0.0006, 'average'],
        ['smooth',     'Aluminum, stainless, PVC (smooth)',                 0.0001, 'smooth'],
        ['fgrigid',    'Fibrous glass duct, rigid',                         0.0006, 'average'],
        ['linerfaced', 'Fibrous glass liner, faced',                        0.0006, 'average'],
        ['linerspray', 'Fibrous glass liner, spray coated',                 0.003,  'medium rough'],
        ['flexmetal',  'Flexible duct, metallic, fully extended',           0.003,  'medium rough'],
        ['flexfabric', 'Flexible duct, fabric and wire, fully extended',    0.01,   'rough']
    ];

    var SHAPES = [
        ['round', 'Round'],
        ['rect', 'Rectangular']
    ];

    // Known-value modes per shape: [key, label, hint]
    var MODES = {
        round: [
            ['friction', 'Airflow + friction rate', 'the everyday equal-friction sizing: read the round size and velocity'],
            ['velocity', 'Airflow + velocity',      'size to a velocity limit and read the friction rate that goes with it'],
            ['size',     'Airflow + diameter',      'check a round duct: velocity and friction at this airflow']
        ],
        rect: [
            ['friction', 'Airflow + friction rate + width', 'give the width you can fit; the height comes out at that friction rate'],
            ['velocity', 'Airflow + velocity + width',      'give the width you can fit; the height comes out at that velocity'],
            ['size',     'Airflow + width × height',        'check a rectangular duct: velocity, friction and equivalent round']
        ]
    };

    // Widths tried for the equal-friction rectangular table (inches).
    var RECT_WIDTHS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 42, 44, 48, 54, 60, 66, 72, 84, 96];
    var MAX_ASPECT = 4;

    function defaults() {
        return {
            units: 'IP',
            altitude: 0,
            material: 'galv',
            shape: 'round',
            mode: 'friction',
            cfm: 1000,
            friction: 0.1,     // in. w.g. / 100 ft
            velocity: 1200,    // fpm
            diameter: 12,      // in
            width: 12,         // in
            height: 8,         // in
            length: null       // ft, optional straight run for total loss
        };
    }

    function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

    function fromSnapshot(snap) {
        var d = defaults();
        try {
            var p = deepClone(snap || {});
            // First-release snapshots had no shape: mode 'diameter' /
            // 'rect' carried it.
            if (p.mode === 'diameter') { p.shape = 'round'; p.mode = 'size'; }
            if (p.mode === 'rect') { p.shape = 'rect'; p.mode = 'size'; }
            Object.keys(p).forEach(function (k) { if (p[k] !== undefined && d.hasOwnProperty(k)) d[k] = p[k]; });
            if (!MODES[d.shape]) d.shape = 'round';
            if (!MODES[d.shape].some(function (m) { return m[0] === d.mode; })) d.mode = 'friction';
        } catch (e) { /* defaults */ }
        return d;
    }

    function init() {
        Psy = HHpro.Psychro; U = HHpro.PsychroUnits;
        if (!state) state = defaults();
    }

    function materialOf(key) {
        for (var i = 0; i < MATERIALS.length; i++) if (MATERIALS[i][0] === key) return MATERIALS[i];
        return MATERIALS[0];
    }

    function modeDef(shape, mode) {
        var list = MODES[shape] || MODES.round;
        return list.filter(function (m) { return m[0] === mode; })[0] || list[0];
    }

    // -----------------------------------------------------------------
    // Formatting
    // -----------------------------------------------------------------

    function sys() { return state.units === 'SI' ? 'SI' : 'IP'; }

    function fmt(n, d) {
        if (n === null || n === undefined || !isFinite(n)) return '-';
        return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    function fmtU(kind, ipValue, dec) {
        var s = sys();
        var d = dec !== undefined ? dec : U.decimals(kind, s);
        return fmt(U.toDisp(kind, ipValue, s), d) + ' ' + U.unit(kind, s);
    }

    function toNum(v, fallback) {
        var n = parseFloat(v);
        return isFinite(n) ? n : fallback;
    }

    function inputDisp(kind, ipValue) {
        if (ipValue === null || ipValue === undefined || ipValue === '') return '';
        var s = sys();
        var v = U.toDisp(kind, ipValue, s);
        var d = Math.max(U.decimals(kind, s), s === 'SI' ? 1 : 0);
        return String(Number(v.toFixed(d)));
    }

    function dimText(x, dec) {
        var s = sys();
        var v = U.toDisp('dim', x, s);
        var d = dec !== undefined ? dec : ((s === 'IP' && v % 1) ? 1 : 0);
        return fmt(v, d);
    }

    function sizeText(w, h) {
        // "12 × 8 in" or "305 × 203 mm" - whole numbers unless a fraction
        // was entered.
        var s = sys();
        var wd = U.toDisp('dim', w, s), hd = U.toDisp('dim', h, s);
        var d = (s === 'IP' && (wd % 1 || hd % 1)) ? 1 : 0;
        return fmt(wd, d) + ' × ' + fmt(hd, d) + ' ' + U.unit('dim', s);
    }

    // -----------------------------------------------------------------
    // Duct physics (pure, IP)
    // -----------------------------------------------------------------

    function airDensity(altitude) {
        var P = Psy.pressureFromAltitude(altitude || 0);
        return RHO_STD * P / P_STD;
    }

    // Darcy friction factor: laminar below Re 2300, Colebrook above.
    function frictionFactor(Re, epsFt, Dft) {
        if (!isFinite(Re) || Re <= 0) return NaN;
        if (Re < 2300) return 64 / Re;
        var rr = epsFt / Dft;
        // Haaland seed, then Colebrook fixed-point iterations.
        var f = Math.pow(-1.8 * Math.log10(Math.pow(rr / 3.7, 1.11) + 6.9 / Re), -2);
        for (var i = 0; i < 40; i++) {
            var g = -2 * Math.log10(rr / 3.7 + 2.51 / (Re * Math.sqrt(f)));
            var fn = 1 / (g * g);
            if (Math.abs(fn - f) < 1e-10) { f = fn; break; }
            f = fn;
        }
        return f;
    }

    // Everything about a round duct of diameter D (in) carrying Q (cfm).
    function roundDuct(Q, Din, rho, epsFt) {
        var Dft = Din / 12;
        var A = Math.PI * Dft * Dft / 4;              // ft2
        var V = Q / A;                                // fpm
        var Re = rho * (V / 60) * Dft / MU_AIR;
        var f = frictionFactor(Re, epsFt, Dft);
        var vp = rho * Math.pow(V / 1097, 2);         // in. w.g.
        var dp100 = 12 * f * (100 / Din) * vp;        // in. w.g. per 100 ft
        return { D: Din, A: A, V: V, Re: Re, f: f, vp: vp, dp100: dp100 };
    }

    // Diameter (in) that gives the target friction rate at Q: bisection
    // (loss falls monotonically with diameter).
    function diameterForFriction(Q, dp100, rho, epsFt) {
        var lo = 1, hi = 400;
        for (var i = 0; i < 80; i++) {
            var mid = 0.5 * (lo + hi);
            if (roundDuct(Q, mid, rho, epsFt).dp100 > dp100) lo = mid; else hi = mid;
        }
        return 0.5 * (lo + hi);
    }

    function diameterForVelocity(Q, V) {
        return 12 * Math.sqrt(4 * Q / (Math.PI * V));
    }

    // Huebscher equivalent round of a rectangle a x b (in).
    function equivRound(a, b) {
        return 1.30 * Math.pow(a * b, 0.625) / Math.pow(a + b, 0.25);
    }

    // Height (in) that pairs with width w to give equivalent diameter De.
    function heightForEquiv(w, De) {
        var lo = 0.5, hi = 400;
        for (var i = 0; i < 80; i++) {
            var mid = 0.5 * (lo + hi);
            if (equivRound(w, mid) < De) lo = mid; else hi = mid;
        }
        return 0.5 * (lo + hi);
    }

    // Nearest stock round size: whole inches to 20 in, even inches above.
    function standardRound(D) {
        if (D <= 20) return Math.max(3, Math.round(D));
        return Math.max(22, 2 * Math.ceil(D / 2));
    }

    function evenInch(x) { return Math.max(4, 2 * Math.round(x / 2)); }

    // Full description of a rectangle w x h (in) at Q.
    function rectDuct(Q, w, h, rho, eps) {
        var A = w * h / 144;
        var V = Q / A;
        var de = equivRound(w, h);
        var eq = roundDuct(Q, de, rho, eps);
        return {
            w: w, h: h, A: A, V: V, vp: rho * Math.pow(V / 1097, 2),
            de: de, dp100: eq.dp100, aspect: Math.max(w, h) / Math.min(w, h), equiv: eq
        };
    }

    function evaluate(s) {
        var rho = airDensity(s.altitude);
        var mat = materialOf(s.material);
        var eps = mat[2];
        var Q = toNum(s.cfm, null);
        if (Q === null || Q <= 0) throw new Error('Enter the airflow.');
        var shape = MODES[s.shape] ? s.shape : 'round';
        var res = { rho: rho, material: mat, shape: shape, mode: s.mode, Q: Q };
        var D;

        if (shape === 'round') {
            if (s.mode === 'friction') {
                var fr = toNum(s.friction, null);
                if (fr === null || fr <= 0) throw new Error('Enter the friction rate.');
                D = diameterForFriction(Q, fr, rho, eps);
            } else if (s.mode === 'velocity') {
                var V = toNum(s.velocity, null);
                if (V === null || V <= 0) throw new Error('Enter the velocity.');
                D = diameterForVelocity(Q, V);
            } else {
                D = toNum(s.diameter, null);
                if (D === null || D <= 0) throw new Error('Enter the round duct diameter.');
            }
            res.round = roundDuct(Q, D, rho, eps);
            var stdD = standardRound(D);
            res.standard = roundDuct(Q, stdD, rho, eps);
            res.headline = res.round;
        } else {
            var w = toNum(s.width, null);
            if (w === null || w <= 0) throw new Error('Enter the duct width.');
            var hExact;
            if (s.mode === 'friction') {
                var fr2 = toNum(s.friction, null);
                if (fr2 === null || fr2 <= 0) throw new Error('Enter the friction rate.');
                D = diameterForFriction(Q, fr2, rho, eps);
                hExact = heightForEquiv(w, D);
            } else if (s.mode === 'velocity') {
                var V2 = toNum(s.velocity, null);
                if (V2 === null || V2 <= 0) throw new Error('Enter the velocity.');
                hExact = (Q / V2) * 144 / w;           // area the rectangle needs
                D = equivRound(w, hExact);
            } else {
                hExact = toNum(s.height, null);
                if (hExact === null || hExact <= 0) throw new Error('Enter the duct height.');
                D = equivRound(w, hExact);
            }
            res.round = roundDuct(Q, D, rho, eps);       // equivalent round
            res.rectExact = rectDuct(Q, w, hExact, rho, eps);
            if (s.mode === 'size') {
                res.rect = res.rectExact;
            } else {
                // Stock answer: even-inch height, with that size's own numbers.
                res.rect = rectDuct(Q, w, evenInch(hExact), rho, eps);
                res.rectRounded = true;
            }
            res.headline = res.rect;
        }
        var L = toNum(s.length, null);
        if (L !== null && L > 0) {
            res.length = L;
            res.totalLoss = (shape === 'round' ? res.round.dp100 : res.rect.dp100) * L / 100;
        }

        // Equal-friction rectangular equivalents (even inches, aspect <= 4:1)
        // for the round / equivalent round diameter.
        var rows = [];
        RECT_WIDTHS.forEach(function (wd) {
            var hr = evenInch(heightForEquiv(wd, D));
            if (hr > wd) return;                       // list each pair once, wide side first
            var r = rectDuct(Q, wd, hr, rho, eps);
            rows.push({ w: wd, h: hr, de: r.de, aspect: r.aspect, dp100: r.dp100, V: r.V, overAspect: r.aspect > MAX_ASPECT });
        });
        res.rectTable = rows;
        return res;
    }

    // -----------------------------------------------------------------
    // Report model (results panel + PDF)
    // -----------------------------------------------------------------

    function buildReport(res, s) {
        var blocks = [];
        var r = res.round;
        var rowsIn = [['Duct shape', res.shape === 'round' ? 'Round' : 'Rectangular'], ['Airflow', fmtU('flow', res.Q)]];
        if (res.mode === 'friction') rowsIn.push(['Friction rate', fmtU('friction', res.shape === 'round' ? r.dp100 : res.rectExact.dp100)]);
        if (res.mode === 'velocity') rowsIn.push(['Velocity', fmtU('velocity', res.shape === 'round' ? r.V : res.rectExact.V)]);
        if (res.shape === 'round' && res.mode === 'size') rowsIn.push(['Diameter', fmtU('dim', r.D)]);
        if (res.shape === 'rect') {
            if (res.mode === 'size') rowsIn.push(['Size (W × H)', sizeText(res.rect.w, res.rect.h)]);
            else rowsIn.push(['Width', dimText(res.rect.w) + ' ' + U.unit('dim', sys())]);
        }
        rowsIn.push(['Duct material', res.material[1] + ' (' + res.material[3] + ', ε = ' +
            (sys() === 'SI' ? fmt(res.material[2] * 304.8, 2) + ' mm' : res.material[2] + ' ft') + ')']);
        rowsIn.push(['Air density', fmtU('density', res.rho) + ' (' + fmtU('altitude', s.altitude) + ', 70°F)']);
        blocks.push({ title: 'Inputs', rows: rowsIn });

        var out = [];
        if (res.shape === 'round') {
            out.push(['Round diameter', fmtU('dim', r.D)]);
            if (res.mode !== 'size') {
                out.push(['Nearest stock round size', fmtU('dim', res.standard.D, 0) + '  →  ' +
                    fmtU('friction', res.standard.dp100) + ', ' + fmtU('velocity', res.standard.V)]);
            }
            out.push(['Velocity', fmtU('velocity', r.V)]);
            out.push(['Friction rate', fmtU('friction', r.dp100)]);
            out.push(['Velocity pressure', fmtU('pstat', r.vp)]);
            out.push(['Cross-sectional area', fmtU('area', r.A)]);
        } else {
            var rc = res.rect;
            if (res.rectRounded) {
                out.push(['Exact height at the target', dimText(res.rectExact.h, 1) + ' ' + U.unit('dim', sys()) +
                    '  (' + sizeText(res.rectExact.w, res.rectExact.h) + ')']);
                out.push(['Stock size (even inch)', sizeText(rc.w, rc.h)]);
            } else {
                out.push(['Size (W × H)', sizeText(rc.w, rc.h)]);
            }
            out.push(['Velocity in the duct', fmtU('velocity', rc.V) + '  (' + fmtU('area', rc.A) + ')']);
            out.push(['Friction rate', fmtU('friction', rc.dp100)]);
            out.push(['Velocity pressure', fmtU('pstat', rc.vp)]);
            out.push(['Equivalent round diameter', fmtU('dim', rc.de) + ' (same friction; velocity in that round duct ' + fmtU('velocity', rc.equiv.V) + ')']);
            out.push(['Aspect ratio', fmt(rc.aspect, 1) + ' : 1' + (rc.aspect > MAX_ASPECT ? '  (over 4:1 - avoid)' : '')]);
        }
        if (res.length) {
            out.push(['Straight-run loss', fmtU('pstat', res.totalLoss) + ' over ' + fmtU('length', res.length) + ' (no fittings)']);
        }
        var eq = res.shape === 'round' ? r : res.rect.equiv;
        out.push(['Reynolds number / friction factor', fmt(eq.Re, 0) + ' / ' + fmt(eq.f, 4) + (eq.Re < 2300 ? ' (laminar)' : '')]);
        blocks.push({ title: 'Results', rows: out });

        var head = ['Size (W × H)', 'Equiv. round', 'Friction', 'Velocity', 'Aspect'];
        var trows = res.rectTable.map(function (t) {
            return [
                sizeText(t.w, t.h),
                fmtU('dim', t.de),
                fmtU('friction', t.dp100),
                fmtU('velocity', t.V),
                fmt(t.aspect, 1) + ':1' + (t.overAspect ? ' !' : '')
            ];
        });
        blocks.push({
            title: res.shape === 'round' ? 'Rectangular sizes at the same friction' : 'Other rectangular sizes at the same friction',
            table: { head: head, rows: trows }
        });
        return blocks;
    }

    // -----------------------------------------------------------------
    // View
    // -----------------------------------------------------------------

    HHpro.Calculators.register({
        key: 'ductulator',
        name: 'Ductulator',
        description: 'Duct sizing for round and rectangular duct: airflow plus friction rate, velocity or size gives the rest, plotted on the duct friction chart with a to-scale duct drawing.',
        icon: 'dial',
        view: 'ductulator',
        saved: { summarize: summarize, pdfBlob: pdfBlob, docType: 'DUCTULATOR (PDF)' }
    });

    HHpro.Views.ductulator = {
        render: function (root, params) {
            init();
            if (params && params.calcId && HHpro.Calculators.saved) {
                var saved = HHpro.Calculators.saved.find(params.calcId);
                if (saved) state = fromSnapshot(saved.snapshot);
            }
            root.innerHTML = '';
            refs = {};
            root.appendChild(HHpro.UI.buildHeader([
                { label: 'Calculators', view: 'calculators' },
                'Ductulator'
            ]));

            var main = document.createElement('main');
            main.className = 'psy-page dp-page dt-page';
            root.appendChild(main);
            main.appendChild(buildTopBar());

            var work = document.createElement('div');
            work.className = 'psy-work dp-work';
            main.appendChild(work);
            work.appendChild(buildPanel());
            work.appendChild(buildSide());
            recompute();
        }
    };

    function buildTopBar() {
        var bar = document.createElement('div');
        bar.className = 'psy-topbar';
        var intro = document.createElement('div');
        intro.className = 'psy-intro';
        var title = document.createElement('h1');
        title.className = 'psy-title';
        title.textContent = 'Ductulator';
        var sub = document.createElement('p');
        sub.className = 'psy-sub';
        sub.textContent = 'Duct sizing by the equal-friction method: pick the duct shape, enter the airflow and one of ' +
            'friction rate, velocity or size, and read the rest. Darcy-Weisbach with Colebrook friction, ASHRAE roughness.';
        intro.appendChild(title);
        intro.appendChild(sub);
        bar.appendChild(intro);
        return bar;
    }

    function buildPanel() {
        var panel = document.createElement('aside');
        panel.className = 'psy-panel dp-panel';
        panel.appendChild(buildSettingsStrip());
        var body = document.createElement('div');
        body.className = 'psy-panel-body';
        panel.appendChild(body);
        var form = document.createElement('div');
        form.className = 'psy-form';
        body.appendChild(form);
        refs.form = form;
        var results = document.createElement('div');
        results.className = 'psy-results';
        body.appendChild(results);
        refs.results = results;
        buildForm();
        return panel;
    }

    function buildSettingsStrip() {
        var strip = document.createElement('div');
        strip.className = 'psy-settings';
        var altRow = document.createElement('div');
        altRow.className = 'psy-altitude';
        var label = document.createElement('label');
        label.className = 'psy-field-label';
        label.textContent = 'Altitude';
        label.htmlFor = 'dt-altitude-input';
        altRow.appendChild(label);
        var input = numberInput(inputDisp('altitude', state.altitude), { step: sys() === 'SI' ? 50 : 100, cls: 'psy-input psy-input-alt' });
        input.id = 'dt-altitude-input';
        input.addEventListener('input', function () {
            state.altitude = U.fromDisp('altitude', toNum(input.value, 0), sys());
            recompute();
        });
        altRow.appendChild(input);
        var unit = document.createElement('span');
        unit.className = 'psy-unit';
        unit.textContent = U.unit('altitude', sys());
        altRow.appendChild(unit);
        var pressure = document.createElement('span');
        pressure.className = 'psy-pressure';
        altRow.appendChild(pressure);
        refs.pressure = pressure;

        var seg = document.createElement('div');
        seg.className = 'psy-seg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Unit system');
        ['IP', 'SI'].forEach(function (u) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'psy-seg-btn' + (sys() === u ? ' is-active' : '');
            b.textContent = u;
            b.addEventListener('click', function () {
                if (sys() === u) return;
                state.units = u;
                HHpro.App.showView('ductulator');
            });
            seg.appendChild(b);
        });
        altRow.appendChild(seg);
        strip.appendChild(altRow);

        var actions = document.createElement('div');
        actions.className = 'psy-actions-bar';
        actions.appendChild(actionButton('folder', 'Save to project', function () { beginSave(actions); }));
        actions.appendChild(actionButton('download', 'Export PDF', function () {
            var active = HHpro.Cart.getActiveState();
            var name = (active && active.name) || '';
            try {
                var blob = pdfBlob(deepClone(state), { projectName: name, title: defaultCalcName() });
                triggerDownload(blob, (name ? name + ' - ' : '') + 'Ductulator - ' + dateStamp() + '.pdf');
            } catch (e) { setStatus(e.message); }
        }));
        var status = document.createElement('span');
        status.className = 'psy-save-status';
        actions.appendChild(status);
        refs.saveStatus = status;
        strip.appendChild(actions);
        return strip;
    }

    function actionButton(icon, text, onClick) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'projects-btn projects-btn-secondary psy-small-btn';
        b.appendChild(HHpro.UI.icon(icon));
        var l = document.createElement('span');
        l.textContent = text;
        b.appendChild(l);
        b.addEventListener('click', onClick);
        return b;
    }

    // ---------- Form ----------

    function buildForm() {
        var form = refs.form;
        form.innerHTML = '';
        var s = state;
        if (!MODES[s.shape]) s.shape = 'round';
        if (!MODES[s.shape].some(function (m) { return m[0] === s.mode; })) s.mode = 'friction';

        // Shape
        var shapeSec = section('Duct shape');
        var seg = document.createElement('div');
        seg.className = 'psy-seg dt-shape-seg';
        seg.setAttribute('role', 'group');
        seg.setAttribute('aria-label', 'Duct shape');
        SHAPES.forEach(function (sh) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'psy-seg-btn' + (s.shape === sh[0] ? ' is-active' : '');
            b.textContent = sh[1];
            b.addEventListener('click', function () {
                if (s.shape === sh[0]) return;
                s.shape = sh[0];
                buildForm();
                recompute();
            });
            seg.appendChild(b);
        });
        shapeSec.appendChild(seg);
        shapeSec.appendChild(hint(s.shape === 'round'
            ? 'Round duct: the instrument\'s native case. The rectangular table below lists sizes with the same friction.'
            : 'Rectangular duct: give the width you can fit and the height is solved, or enter both to check a size. Friction comes from the equivalent round diameter (ASHRAE); the velocity shown is in the rectangle itself.'));
        form.appendChild(shapeSec);

        // Known values
        var modeSec = section('Known values');
        var r = document.createElement('div');
        r.className = 'psy-radio-row dt-solve-row';
        MODES[s.shape].forEach(function (m) {
            r.appendChild(radio('dt-mode', m[0], m[1], s.mode === m[0], function () {
                s.mode = m[0]; buildForm(); recompute();
            }));
        });
        modeSec.appendChild(r);
        var cur = modeDef(s.shape, s.mode);
        modeSec.appendChild(hint(cur[1] + ': ' + cur[2] + '.'));
        form.appendChild(modeSec);

        // Inputs
        var inSec = section('Inputs');
        var g = fields();
        g.appendChild(numberField('Airflow', 'flow', s.cfm, { min: 0, step: 50 }, function (v) { s.cfm = v; }));
        if (s.mode === 'friction') {
            g.appendChild(numberField('Friction rate', 'friction', s.friction, { min: 0, step: sys() === 'SI' ? 0.1 : 0.01 }, function (v) { s.friction = v; }));
        } else if (s.mode === 'velocity') {
            g.appendChild(numberField('Velocity', 'velocity', s.velocity, { min: 0, step: sys() === 'SI' ? 0.5 : 100 }, function (v) { s.velocity = v; }));
        }
        if (s.shape === 'round') {
            if (s.mode === 'size') {
                g.appendChild(numberField('Diameter', 'dim', s.diameter, { min: 0, step: sys() === 'SI' ? 25 : 1 }, function (v) { s.diameter = v; }));
            }
        } else {
            g.appendChild(numberField('Width', 'dim', s.width, { min: 0, step: sys() === 'SI' ? 50 : 2 }, function (v) { s.width = v; }));
            if (s.mode === 'size') {
                g.appendChild(numberField('Height', 'dim', s.height, { min: 0, step: sys() === 'SI' ? 50 : 2 }, function (v) { s.height = v; }));
            }
        }
        var lenField = numberField('Straight run', 'length', s.length, { min: 0, step: sys() === 'SI' ? 5 : 10 }, function (v) { s.length = v; });
        lenField.querySelector('input').placeholder = 'optional';
        g.appendChild(lenField);
        inSec.appendChild(g);
        inSec.appendChild(hint(s.mode === 'friction'
            ? 'Typical friction rates: 0.08 to 0.10 in. w.g./100 ft for low-pressure supply, 0.05 to 0.08 for return. The straight run only adds a total loss for that length; fittings are extra.'
            : s.mode === 'velocity'
                ? 'Typical limits: 700 to 900 fpm in occupied-space branches, 1,000 to 1,500 fpm in mains, higher for medium-pressure systems.'
                : 'Checks an existing or proposed duct at this airflow.'));
        form.appendChild(inSec);

        // Material
        var matSec = section('Duct material');
        var matRow = document.createElement('div');
        matRow.className = 'psy-field dt-material-field';
        var sel = document.createElement('select');
        sel.className = 'filter-select psy-select dt-material-select';
        sel.setAttribute('aria-label', 'Duct material');
        MATERIALS.forEach(function (m) {
            var o = document.createElement('option');
            o.value = m[0];
            o.textContent = m[1];
            if (m[0] === s.material) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function () { s.material = sel.value; recompute(); });
        matRow.appendChild(sel);
        matSec.appendChild(matRow);
        matSec.appendChild(hint('ASHRAE Fundamentals roughness categories. The physical Ductulator is galvanized steel. ' +
            'Flexible duct figures assume it is pulled fully straight; sagging or compressed flex loses far more.'));
        var err = document.createElement('p');
        err.className = 'psy-field-error';
        matSec.appendChild(err);
        errorEl = err;
        form.appendChild(matSec);
    }

    function section(titleText) {
        var sec = document.createElement('div');
        sec.className = 'psy-section';
        var h = document.createElement('h2');
        h.className = 'psy-section-title';
        h.textContent = titleText;
        sec.appendChild(h);
        return sec;
    }

    function hint(text) {
        var p = document.createElement('p');
        p.className = 'psy-hint';
        p.textContent = text;
        return p;
    }

    function fields() {
        var g = document.createElement('div');
        g.className = 'psy-fields';
        return g;
    }

    function radio(name, value, labelText, checked, onChange) {
        var lbl = document.createElement('label');
        lbl.className = 'psy-radio';
        var r = document.createElement('input');
        r.type = 'radio';
        r.name = name;
        r.value = value;
        r.checked = checked;
        r.addEventListener('change', function () { if (r.checked) onChange(); });
        var span = document.createElement('span');
        span.textContent = labelText;
        lbl.appendChild(r);
        lbl.appendChild(span);
        return lbl;
    }

    function numberInput(value, opts) {
        opts = opts || {};
        var input = document.createElement('input');
        input.type = 'number';
        input.className = opts.cls || 'psy-input';
        input.step = opts.step !== undefined ? String(opts.step) : 'any';
        if (opts.min !== undefined) input.min = String(opts.min);
        if (opts.max !== undefined) input.max = String(opts.max);
        input.value = (value === null || value === undefined || value === '') ? '' : String(value);
        input.inputMode = 'decimal';
        return input;
    }

    function numberField(labelText, kind, ipValue, opts, onChange) {
        var wrap = document.createElement('label');
        wrap.className = 'psy-field';
        var label = document.createElement('span');
        label.className = 'psy-field-label';
        label.textContent = labelText;
        wrap.appendChild(label);
        var input = numberInput(inputDisp(kind, ipValue), opts);
        input.addEventListener('input', function () {
            var v = input.value === '' ? null : toNum(input.value, null);
            onChange(v === null ? null : U.fromDisp(kind, v, sys()));
            recompute();
        });
        wrap.appendChild(input);
        var u = document.createElement('span');
        u.className = 'psy-unit';
        u.textContent = U.unit(kind, sys());
        wrap.appendChild(u);
        return wrap;
    }

    // ---------- Right-hand side: headline numbers, wheel, duct drawing ----------

    function buildSide() {
        var side = document.createElement('section');
        side.className = 'psy-chart-area dt-side';

        var hero = document.createElement('div');
        hero.className = 'dt-hero';
        side.appendChild(hero);
        refs.hero = hero;

        var visuals = document.createElement('div');
        visuals.className = 'dt-visuals';
        side.appendChild(visuals);

        var wrap = document.createElement('div');
        wrap.className = 'dt-chart-wrap';
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + CH_W + ' ' + CH_H);
        svg.setAttribute('class', 'dt-chart');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Duct friction chart');
        wrap.appendChild(svg);
        var readout = document.createElement('div');
        readout.className = 'psy-readout dt-readout';
        wrap.appendChild(readout);
        visuals.appendChild(wrap);
        refs.svg = svg;
        attachHover(svg, readout);

        var dwrap = document.createElement('div');
        dwrap.className = 'dt-duct-wrap';
        var dsvg = document.createElementNS(SVG_NS, 'svg');
        dsvg.setAttribute('viewBox', '0 0 ' + DUCT_W + ' ' + DUCT_H);
        dsvg.setAttribute('class', 'dt-duct');
        dsvg.setAttribute('role', 'img');
        dsvg.setAttribute('aria-label', 'Selected duct, drawn to scale');
        dwrap.appendChild(dsvg);
        visuals.appendChild(dwrap);
        refs.duct = dsvg;

        var note = document.createElement('p');
        note.className = 'dt-note';
        note.textContent = 'Chart: the standard duct friction chart. Find the airflow along the bottom and the friction rate up the side; ' +
            'the dot is the duct in hand, the blue line through it is its round diameter and the green line its velocity. ' +
            'A rectangular duct plots at its equivalent round, with its own velocity in the label. Every line is computed from the same equations as the results. ' +
            'Drawing: the selected duct, dimensioned and drawn to scale.';
        side.appendChild(note);
        return side;
    }

    function heroItem(value, caption, warn) {
        var it = document.createElement('div');
        it.className = 'dt-hero-item';
        var v = document.createElement('div');
        v.className = 'dt-hero-value' + (warn ? ' is-warn' : '');
        v.textContent = value;
        var c = document.createElement('div');
        c.className = 'dt-hero-caption';
        c.textContent = caption;
        it.appendChild(v);
        it.appendChild(c);
        return it;
    }

    function renderHero(res, err) {
        var hero = refs.hero;
        if (!hero) return;
        hero.innerHTML = '';
        if (err) {
            hero.appendChild(heroItem('—', err, true));
            return;
        }
        if (res.shape === 'round') {
            var r = res.round;
            hero.appendChild(heroItem(fmtU('dim', r.D), 'Round diameter'));
            hero.appendChild(heroItem(fmtU('velocity', r.V), 'Velocity'));
            hero.appendChild(heroItem(fmtU('friction', r.dp100), 'Friction rate'));
            hero.appendChild(heroItem(fmtU('pstat', r.vp), 'Velocity pressure'));
        } else {
            var rc = res.rect;
            hero.appendChild(heroItem(sizeText(rc.w, rc.h), res.rectRounded ? 'Rectangular size (stock)' : 'Rectangular size'));
            hero.appendChild(heroItem(fmtU('velocity', rc.V), 'Velocity'));
            hero.appendChild(heroItem(fmtU('friction', rc.dp100), 'Friction rate'));
            hero.appendChild(heroItem(fmtU('dim', rc.de), 'Equivalent round'));
        }
    }

    // -----------------------------------------------------------------
    // The friction chart
    // -----------------------------------------------------------------
    // The log-log duct friction chart from the ASHRAE / SMACNA manuals:
    // airflow across, friction rate up, a fan of round-diameter lines
    // (blue) and a fan of velocity lines (green, dashed), all computed
    // from the same Darcy-Weisbach / Colebrook equations as the results,
    // so the picture is exact. The operating point is the dot; a
    // rectangular duct plots at its equivalent round. Hovering reads the
    // round size and velocity at any spot. Plain rect / line / path /
    // text only, so the PDF writer can copy it.
    var CH_W = 760, CH_H = 560;
    var ML = 66, MR = 26, MT = 26, MB = 54;
    var PX0 = ML, PX1 = CH_W - MR, PY0 = MT, PY1 = CH_H - MB;
    var QX_MIN = 50, QX_MAX = 100000;       // CFM (internal)
    var FY_MIN = 0.01, FY_MAX = 2;          // in. w.g. / 100 ft (internal)
    var DIAMS = [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 34, 38, 42, 48, 54, 60, 72, 84];
    var VELS_IP = [400, 500, 600, 700, 800, 900, 1000, 1200, 1500, 2000, 2500, 3000, 4000, 5000];
    var VELS_SI = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25];      // m/s
    var DESIGN_FR = [0.05, 0.10];           // shaded low-pressure design band
    var LINE_SAMPLES = 40;

    function xOf(Q) { return PX0 + (PX1 - PX0) * Math.log10(Q / QX_MIN) / Math.log10(QX_MAX / QX_MIN); }
    function yOf(fr) { return PY1 - (PY1 - PY0) * Math.log10(fr / FY_MIN) / Math.log10(FY_MAX / FY_MIN); }
    function qAt(x) { return QX_MIN * Math.pow(QX_MAX / QX_MIN, (x - PX0) / (PX1 - PX0)); }
    function frAt(y) { return FY_MIN * Math.pow(FY_MAX / FY_MIN, (PY1 - y) / (PY1 - PY0)); }

    function el(tag, attrs, cls) {
        var e = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
        if (cls) e.setAttribute('class', cls);
        return e;
    }

    function logTicks(min, max) {
        // 1-2-5 majors plus unit minors per decade, clipped to [min, max]
        var majors = [], minors = [];
        var dec = Math.floor(Math.log10(min)) - 1;
        for (; Math.pow(10, dec) <= max * 1.0001; dec++) {
            for (var m = 1; m < 10; m++) {
                var v = m * Math.pow(10, dec);
                if (v < min * 0.9999 || v > max * 1.0001) continue;
                if (m === 1 || m === 2 || m === 5) majors.push(v); else minors.push(v);
            }
        }
        return { majors: majors, minors: minors };
    }

    function labelNum(v) {
        if (v >= 1000) return (v / 1000) + 'k';
        if (v >= 1) return String(v);
        return String(Number(v.toFixed(3)));
    }

    // Clip a polyline (pixel space) to the plot rectangle; returns the
    // visible pieces. Lines are near-straight in log-log, so linear
    // interpolation between samples is plenty.
    function clipToPlot(points) {
        function inside(p) { return p[0] >= PX0 - 0.01 && p[0] <= PX1 + 0.01 && p[1] >= PY0 - 0.01 && p[1] <= PY1 + 0.01; }
        function clipSeg(a, b) {
            // Liang-Barsky
            var t0 = 0, t1 = 1, dx = b[0] - a[0], dy = b[1] - a[1];
            var checks = [[-dx, a[0] - PX0], [dx, PX1 - a[0]], [-dy, a[1] - PY0], [dy, PY1 - a[1]]];
            for (var i = 0; i < 4; i++) {
                var p = checks[i][0], q = checks[i][1];
                if (p === 0) { if (q < 0) return null; continue; }
                var t = q / p;
                if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
                else { if (t < t0) return null; if (t < t1) t1 = t; }
            }
            return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
        }
        var pieces = [], cur = null;
        for (var i = 0; i < points.length - 1; i++) {
            var seg = clipSeg(points[i], points[i + 1]);
            if (!seg) { if (cur) { pieces.push(cur); cur = null; } continue; }
            if (!cur) cur = [seg[0]];
            cur.push(seg[1]);
            if (!inside(points[i + 1])) { pieces.push(cur); cur = null; }
        }
        if (cur) pieces.push(cur);
        return pieces;
    }

    function pathOf(points) {
        return points.map(function (p, i) { return (i ? 'L ' : 'M ') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    }

    // Sample a family line: fn(Q) -> friction rate.
    function sampleLine(fn) {
        var pts = [];
        for (var i = 0; i <= LINE_SAMPLES; i++) {
            var Q = QX_MIN * Math.pow(QX_MAX / QX_MIN, i / LINE_SAMPLES);
            var fr = fn(Q);
            if (!isFinite(fr) || fr <= 0) continue;
            pts.push([xOf(Q), yOf(fr)]);
        }
        return pts;
    }

    // Label a visible piece: at the point nearest the requested fraction
    // of the piece's length, rotated along the line.
    function lineLabel(parent, piece, frac, text, cls, dy) {
        if (piece.length < 2) return;
        var idx = Math.max(1, Math.min(piece.length - 1, Math.round((piece.length - 1) * frac)));
        var a = piece[idx - 1], b = piece[idx];
        var ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        var t = el('text', {
            transform: 'translate(' + mx.toFixed(1) + ' ' + (my + (dy || -3)).toFixed(1) + ') rotate(' + ang.toFixed(1) + ')',
            'text-anchor': 'middle'
        }, cls);
        t.textContent = text;
        parent.appendChild(t);
    }

    function velocityList() { return sys() === 'SI' ? VELS_SI.map(function (v) { return v / 0.00508; }) : VELS_IP; }
    function velocityLabel(vFpm) { return sys() === 'SI' ? String(Number((vFpm * 0.00508).toFixed(1))) : String(Math.round(vFpm)); }
    function diameterLabel(Din) { return sys() === 'SI' ? String(Math.round(Din * 25.4)) : String(Din); }

    // Draw the chart. res = evaluate() result or null. opts.bake = true
    // renders the operating point with plain coordinates (no transforms)
    // for the PDF; on screen the point sits in a translated group so it
    // slides to its new place (CSS transition). The grid and line
    // families depend only on the unit system, air density and roughness,
    // so they are kept when those are unchanged.
    function drawChart(svg, res, opts) {
        opts = opts || {};
        var rho = res ? res.rho : airDensity(state.altitude);
        var eps = res ? res.material[2] : materialOf(state.material)[2];
        var key = sys() + '|' + rho.toFixed(6) + '|' + eps;
        if (!opts.bake && svg.__chartKey === key) {
            var pg = svg.querySelector('.dt-point');
            if (pg) { while (pg.firstChild) pg.removeChild(pg.firstChild); drawPoint(pg, res, false); }
            return;
        }
        if (!opts.bake) svg.__chartKey = key;
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        // background + plot frame
        svg.appendChild(el('rect', { x: 0, y: 0, width: CH_W, height: CH_H }, 'dt-chart-bg psy-frame'));
        svg.appendChild(el('rect', { x: PX0, y: yOf(DESIGN_FR[1]), width: PX1 - PX0, height: yOf(DESIGN_FR[0]) - yOf(DESIGN_FR[1]) }, 'dt-design-band psy-region'));
        var bandLabel = el('text', { x: PX0 + 6, y: yOf(DESIGN_FR[1]) + 12, 'text-anchor': 'start' }, 'dt-band-label psy-label-caption');
        bandLabel.textContent = 'typical low-pressure design range';
        svg.appendChild(bandLabel);

        // grid + ticks in DISPLAY units
        var S = sys();
        var xt = logTicks(U.toDisp('flow', QX_MIN, S), U.toDisp('flow', QX_MAX, S));
        xt.minors.forEach(function (v) {
            var x = xOf(U.fromDisp('flow', v, S));
            svg.appendChild(el('line', { x1: x.toFixed(1), y1: PY0, x2: x.toFixed(1), y2: PY1 }, 'dt-grid psy-grid-line'));
        });
        xt.majors.forEach(function (v) {
            var x = xOf(U.fromDisp('flow', v, S));
            svg.appendChild(el('line', { x1: x.toFixed(1), y1: PY0, x2: x.toFixed(1), y2: PY1 }, 'dt-grid-major psy-grid-major'));
            var t = el('text', { x: x.toFixed(1), y: PY1 + 16, 'text-anchor': 'middle' }, 'dt-axis-label psy-axis-label');
            t.textContent = labelNum(v);
            svg.appendChild(t);
        });
        var yt = logTicks(U.toDisp('friction', FY_MIN, S), U.toDisp('friction', FY_MAX, S));
        yt.minors.forEach(function (v) {
            var y = yOf(U.fromDisp('friction', v, S));
            svg.appendChild(el('line', { x1: PX0, y1: y.toFixed(1), x2: PX1, y2: y.toFixed(1) }, 'dt-grid psy-grid-line'));
        });
        yt.majors.forEach(function (v) {
            var y = yOf(U.fromDisp('friction', v, S));
            svg.appendChild(el('line', { x1: PX0, y1: y.toFixed(1), x2: PX1, y2: y.toFixed(1) }, 'dt-grid-major psy-grid-major'));
            var t = el('text', { x: PX0 - 6, y: (y + 3.5).toFixed(1), 'text-anchor': 'end' }, 'dt-axis-label psy-axis-label');
            t.textContent = labelNum(v);
            svg.appendChild(t);
        });
        var xTitle = el('text', { x: (PX0 + PX1) / 2, y: CH_H - 14, 'text-anchor': 'middle' }, 'dt-axis-title psy-axis-title');
        xTitle.textContent = 'AIRFLOW, ' + U.unit('flow', S);
        svg.appendChild(xTitle);
        var yTitle = el('text', { transform: 'translate(16 ' + ((PY0 + PY1) / 2).toFixed(1) + ') rotate(-90)', 'text-anchor': 'middle' }, 'dt-axis-title psy-axis-title');
        yTitle.textContent = 'FRICTION RATE, ' + U.unit('friction', S);
        svg.appendChild(yTitle);

        // velocity lines (round duct), dashed green
        velocityList().forEach(function (V) {
            var pts = sampleLine(function (Q) { return roundDuct(Q, diameterForVelocity(Q, V), rho, eps).dp100; });
            clipToPlot(pts).forEach(function (piece) {
                svg.appendChild(el('path', { d: pathOf(piece) }, 'dt-line-v psy-wb'));
                lineLabel(svg, piece, 0.78, velocityLabel(V), 'dt-line-label-v psy-label psy-label-wb');
            });
        });
        // diameter lines, blue
        DIAMS.forEach(function (D, i) {
            var pts = sampleLine(function (Q) { return roundDuct(Q, D, rho, eps).dp100; });
            clipToPlot(pts).forEach(function (piece) {
                svg.appendChild(el('path', { d: pathOf(piece) }, 'dt-line-d psy-rh'));
                lineLabel(svg, piece, i % 2 ? 0.86 : 0.7, diameterLabel(D), 'dt-line-label-d psy-label psy-label-rh');
            });
        });
        var legend = el('text', { x: PX1 - 6, y: PY0 + 14, 'text-anchor': 'end' }, 'dt-legend psy-label-caption');
        legend.textContent = 'blue: round diameter ' + U.unit('dim', S) + '   green: velocity ' + U.unit('velocity', S) + ' (round duct)';
        svg.appendChild(legend);
        svg.appendChild(el('rect', { x: PX0, y: PY0, width: PX1 - PX0, height: PY1 - PY0 }, 'dt-plot-frame psy-frame-outline'));

        // operating point
        var pointGroup = el('g', {}, 'dt-point');
        drawPoint(pointGroup, res, !!opts.bake);
        svg.appendChild(pointGroup);
    }

    // Operating point: crosshairs to both axes, the dot and its label.
    // On screen the group is translated to (x, y) and its children are
    // drawn relative to 0,0 so the whole thing animates; baked, the
    // children carry absolute coordinates.
    function drawPoint(group, res, bake) {
        if (!res) { group.removeAttribute('style'); return; }
        var Q = Math.min(Math.max(res.Q, QX_MIN), QX_MAX);
        var fr = res.shape === 'round' ? res.round.dp100 : res.rect.dp100;
        var frc = Math.min(Math.max(fr, FY_MIN), FY_MAX);
        var x = xOf(Q), y = yOf(frc);
        var offX = bake ? x : 0, offY = bake ? y : 0;
        if (!bake) group.setAttribute('style', 'transform: translate(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px)');
        group.appendChild(el('line', { x1: (PX0 - x + offX).toFixed(1), y1: offY, x2: offX, y2: offY }, 'dt-cross psy-line-mix'));
        group.appendChild(el('line', { x1: offX, y1: offY, x2: offX, y2: (PY1 - y + offY).toFixed(1) }, 'dt-cross psy-line-mix'));
        group.appendChild(el('circle', { cx: offX, cy: offY, r: 6 }, 'dt-point-dot psy-point-oa'));
        var label = res.shape === 'round'
            ? fmtU('dim', res.round.D) + ' round · ' + fmtU('velocity', res.round.V)
            : sizeText(res.rect.w, res.rect.h) + ' (eq. ' + fmtU('dim', res.rect.de) + ') · ' + fmtU('velocity', res.rect.V);
        var above = y > PY0 + 40;
        var t = el('text', { x: (offX + 10).toFixed(1), y: (offY + (above ? -10 : 18)).toFixed(1), 'text-anchor': 'start' }, 'dt-point-label psy-point-label');
        t.textContent = label;
        // keep the label inside the plot on the right edge
        if (x > PX1 - 200) { t.setAttribute('x', (offX - 10).toFixed(1)); t.setAttribute('text-anchor', 'end'); }
        group.appendChild(t);
        var offChart = (res.Q !== Q) || (fr !== frc);
        if (offChart) {
            var w = el('text', { x: (offX + 10).toFixed(1), y: (offY + (above ? 6 : 34)).toFixed(1), 'text-anchor': 'start' }, 'dt-point-note psy-label-caption');
            w.textContent = 'off the chart - shown at the edge';
            group.appendChild(w);
        }
    }

    // Hover: pointer position -> airflow + friction -> round size + velocity.
    function attachHover(svg, readout) {
        function toViewBox(evt) {
            var ptx = svg.createSVGPoint();
            ptx.x = evt.clientX; ptx.y = evt.clientY;
            var m = svg.getScreenCTM();
            if (!m) return null;
            var p = ptx.matrixTransform(m.inverse());
            return [p.x, p.y];
        }
        function hint() {
            readout.innerHTML = '';
            var h = document.createElement('span');
            h.className = 'psy-readout-hint';
            h.textContent = 'Move the pointer over the chart to read the round size and velocity at any airflow and friction rate.';
            readout.appendChild(h);
        }
        function item(k, v) {
            var it = document.createElement('span');
            it.className = 'psy-readout-item';
            var key = document.createElement('span'); key.className = 'psy-readout-key'; key.textContent = k;
            var val = document.createElement('span'); val.className = 'psy-readout-val'; val.textContent = v;
            it.appendChild(key); it.appendChild(val);
            readout.appendChild(it);
        }
        svg.addEventListener('mousemove', function (evt) {
            var p = toViewBox(evt);
            if (!p || p[0] < PX0 || p[0] > PX1 || p[1] < PY0 || p[1] > PY1) { hint(); return; }
            var Q = qAt(p[0]), fr = frAt(p[1]);
            var rho = airDensity(state.altitude), eps = materialOf(state.material)[2];
            var D = diameterForFriction(Q, fr, rho, eps);
            var r = roundDuct(Q, D, rho, eps);
            readout.innerHTML = '';
            item('Airflow', fmtU('flow', Q, 0));
            item('Friction', fmtU('friction', fr));
            item('Round', fmtU('dim', D));
            item('Velocity', fmtU('velocity', r.V));
            item('VP', fmtU('pstat', r.vp));
        });
        svg.addEventListener('mouseleave', hint);
        hint();
    }

    // -----------------------------------------------------------------
    // The duct drawing
    // -----------------------------------------------------------------
    // Cross-section of the selected duct drawn to scale (the larger side
    // fills the drawing area), extruded a short way in an oblique view
    // with the airflow arrow, plus dimension lines. Plain lines / paths /
    // text only, so the PDF writer can copy it too.
    var DUCT_W = 360, DUCT_H = 360;

    function drawDuct(svg, res, offX, offY) {
        offX = offX || 0; offY = offY || 0;
        while (svg.firstChild) svg.removeChild(svg.firstChild);
        var g = el('g', {}, 'dt-duct-group');
        svg.appendChild(g);
        function L(x1, y1, x2, y2, cls) {
            g.appendChild(el('line', { x1: (x1 + offX).toFixed(1), y1: (y1 + offY).toFixed(1), x2: (x2 + offX).toFixed(1), y2: (y2 + offY).toFixed(1) }, cls));
        }
        function P(points, cls, close) {
            var d = points.map(function (p, i) { return (i ? 'L ' : 'M ') + (p[0] + offX).toFixed(1) + ' ' + (p[1] + offY).toFixed(1); }).join(' ');
            g.appendChild(el('path', { d: d + (close ? ' Z' : '') }, cls));
        }
        function T(x, y, text, cls, anchor, rotate) {
            var attrs = { 'text-anchor': anchor || 'middle' };
            if (rotate) attrs.transform = 'translate(' + (x + offX).toFixed(1) + ' ' + (y + offY).toFixed(1) + ') rotate(' + rotate + ')';
            else { attrs.x = (x + offX).toFixed(1); attrs.y = (y + offY).toFixed(1); }
            var t = el('text', attrs, cls);
            t.textContent = text;
            g.appendChild(t);
        }
        function ellipsePath(cx, cy, rx, ry) {
            var pts = [];
            for (var i = 0; i <= 72; i++) {
                var a = i * 5 * Math.PI / 180;
                pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
            }
            return pts;
        }
        // Dimension line with end ticks and a label.
        function dim(x1, y1, x2, y2, label, side) {
            L(x1, y1, x2, y2, 'dt-dim psy-tick');
            var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
            var nx = -dy / len * 5, ny = dx / len * 5;
            L(x1 - nx, y1 - ny, x1 + nx, y1 + ny, 'dt-dim psy-tick');
            L(x2 - nx, y2 - ny, x2 + nx, y2 + ny, 'dt-dim psy-tick');
            var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            if (side === 'left') T(mx - 8, my, label, 'dt-dim-label psy-axis-label', 'middle', -90);
            else T(mx, my - 7, label, 'dt-dim-label psy-axis-label', 'middle');
        }

        if (!res) {
            T(DUCT_W / 2, DUCT_H / 2, 'Enter the inputs', 'dt-center-label psy-axis-label');
            return;
        }
        var unit = U.unit('dim', sys());
        var box = 200;                       // drawing area for the section
        var cx = 150, cy = 205;              // section centre (room for the extrusion up-right)
        var ex = 62, ey = -40;               // oblique extrusion offset
        var flowText = fmtU('flow', res.Q) + ' · ' + fmtU('velocity', res.shape === 'round' ? res.round.V : res.rect.V);

        if (res.shape === 'round') {
            var D = res.round.D;
            var R = box / 2;
            // back ring, tangents, front face
            P(ellipsePath(cx + ex, cy + ey, R, R), 'dt-duct-back psy-frame-outline', true);
            var ang = Math.atan2(ey, ex);
            var tx = -Math.sin(ang) * R, ty = Math.cos(ang) * R;
            L(cx + tx, cy + ty, cx + ex + tx, cy + ey + ty, 'dt-duct-edge psy-frame-outline');
            L(cx - tx, cy - ty, cx + ex - tx, cy + ey - ty, 'dt-duct-edge psy-frame-outline');
            P(ellipsePath(cx, cy, R, R), 'dt-duct-face psy-frame-outline', true);
            // airflow arrow out of the face
            L(cx + ex * 0.55, cy + ey * 0.55, cx - ex * 0.5, cy - ey * 0.5, 'dt-flow psy-line');
            P([[cx - ex * 0.5, cy - ey * 0.5], [cx - ex * 0.5 + 14, cy - ey * 0.5 + 1], [cx - ex * 0.5 + 2, cy - ey * 0.5 - 11]], 'dt-flow-head', true);
            // diameter dimension
            dim(cx - R, cy + R + 22, cx + R, cy + R + 22, 'Ø ' + dimText(D, 1) + ' ' + unit);
            T(cx, cy + R + 52, 'ROUND DUCT', 'dt-duct-title psy-axis-title');
            if (res.mode !== 'size') T(cx, cy + R + 70, 'stock ' + dimText(res.standard.D, 0) + ' ' + unit + ' · ' + fmtU('friction', res.standard.dp100), 'dt-duct-sub psy-axis-label');
        } else {
            var rc = res.rect;
            var big = Math.max(rc.w, rc.h);
            var sw = box * rc.w / big, sh = box * rc.h / big;
            var x0 = cx - sw / 2, y0 = cy - sh / 2;
            var fx = [[x0, y0], [x0 + sw, y0], [x0 + sw, y0 + sh], [x0, y0 + sh]];
            var bx = fx.map(function (p) { return [p[0] + ex, p[1] + ey]; });
            P(bx, 'dt-duct-back psy-frame-outline', true);
            fx.forEach(function (p, i) { L(p[0], p[1], bx[i][0], bx[i][1], 'dt-duct-edge psy-frame-outline'); });
            P(fx, 'dt-duct-face psy-frame-outline', true);
            L(cx + ex * 0.55, cy + ey * 0.55, cx - ex * 0.5, cy - ey * 0.5, 'dt-flow psy-line');
            P([[cx - ex * 0.5, cy - ey * 0.5], [cx - ex * 0.5 + 14, cy - ey * 0.5 + 1], [cx - ex * 0.5 + 2, cy - ey * 0.5 - 11]], 'dt-flow-head', true);
            dim(x0, y0 + sh + 22, x0 + sw, y0 + sh + 22, 'W ' + dimText(rc.w) + ' ' + unit);
            dim(x0 - 22, y0 + sh, x0 - 22, y0, 'H ' + dimText(rc.h) + ' ' + unit, 'left');
            T(cx, cy + box / 2 + 52, 'RECTANGULAR DUCT', 'dt-duct-title psy-axis-title');
            T(cx, cy + box / 2 + 70, 'equivalent round ' + dimText(rc.de, 1) + ' ' + unit + (rc.aspect > MAX_ASPECT ? ' · aspect over 4:1' : ''), 'dt-duct-sub psy-axis-label');
        }
        T(cx + ex + 30, cy + ey - 118, flowText, 'dt-duct-sub psy-axis-label', 'middle');
        T(cx + ex + 30, cy + ey - 134, 'AIRFLOW', 'dt-duct-title psy-axis-title', 'middle');
    }

    // ---------- Recompute + render ----------

    function recompute() {
        if (errorEl) errorEl.textContent = '';
        var res = null, err = null;
        try { res = evaluate(state); } catch (e) { err = e.message; }
        if (refs.pressure) {
            var P = Psy.pressureFromAltitude(state.altitude);
            refs.pressure.textContent = sys() === 'SI'
                ? fmt(P * 6.894757, 2) + ' kPa'
                : fmt(Psy.inHgFromPsi(P), 2) + ' in Hg · ' + fmt(P, 3) + ' psia';
        }
        renderHero(res, err);
        if (refs.svg) drawChart(refs.svg, res, { bake: false });
        if (refs.duct) drawDuct(refs.duct, res);
        var box = refs.results;
        box.innerHTML = '';
        if (err) {
            if (errorEl) errorEl.textContent = err;
            return;
        }
        buildReport(res, state).forEach(function (b) {
            var h = document.createElement('h2');
            h.className = 'psy-section-title';
            h.textContent = b.title;
            box.appendChild(h);
            if (b.table) box.appendChild(buildTable(b.table));
            else box.appendChild(buildKvList(b.rows));
        });
    }

    function buildKvList(rows) {
        var dl = document.createElement('dl');
        dl.className = 'psy-kv';
        rows.forEach(function (r) {
            var dt = document.createElement('dt');
            dt.textContent = r[0];
            var dd = document.createElement('dd');
            dd.textContent = r[1];
            if (/avoid/.test(r[1])) dd.classList.add('is-warn');
            dl.appendChild(dt); dl.appendChild(dd);
        });
        return dl;
    }

    function buildTable(tbl) {
        var wrap = document.createElement('div');
        wrap.className = 'psy-table-wrap';
        var table = document.createElement('table');
        table.className = 'psy-table dt-rect-table';
        var thead = document.createElement('thead');
        var trh = document.createElement('tr');
        tbl.head.forEach(function (h, i) {
            var th = document.createElement('th');
            th.className = i ? 'psy-table-col' : 'psy-table-prop';
            th.textContent = h;
            trh.appendChild(th);
        });
        thead.appendChild(trh);
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        tbl.rows.forEach(function (row) {
            var tr = document.createElement('tr');
            row.forEach(function (c, i) {
                var td = document.createElement('td');
                td.className = i ? 'psy-table-val' : 'psy-table-prop';
                td.textContent = c;
                if (/!$/.test(c)) td.classList.add('is-warn');
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        var note = document.createElement('p');
        note.className = 'psy-hint';
        note.textContent = 'Even-inch sizes with the same friction rate as the round (or equivalent round) duct. "!" marks aspect ratios over 4:1, which cost more sheet metal and pressure drop than they save in depth.';
        wrap.appendChild(note);
        return wrap;
    }

    // -----------------------------------------------------------------
    // Save / PDF / summary
    // -----------------------------------------------------------------

    function dateStamp() {
        var d = new Date();
        return (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getFullYear();
    }

    function defaultCalcName() {
        try {
            var res = evaluate(state);
            var size = res.shape === 'round' ? fmt(res.round.D, 1) + ' in round' : fmt(res.rect.w, 0) + ' x ' + fmt(res.rect.h, 0) + ' in';
            return 'Ductulator - ' + fmt(res.Q, 0) + ' CFM, ' + size;
        } catch (e) {
            return 'Ductulator';
        }
    }

    function summarize(snap) {
        var saved = state;
        state = fromSnapshot(snap);
        try {
            var res = evaluate(state);
            var bits = [fmtU('flow', res.Q)];
            if (res.shape === 'rect') bits.push(sizeText(res.rect.w, res.rect.h), 'eq. ' + fmtU('dim', res.rect.de));
            else bits.push(fmtU('dim', res.round.D) + ' round');
            bits.push(fmtU('velocity', res.shape === 'rect' ? res.rect.V : res.round.V), fmtU('friction', res.shape === 'rect' ? res.rect.dp100 : res.round.dp100));
            return bits.join(' · ');
        } catch (e) {
            return 'Ductulator';
        } finally {
            state = saved;
        }
    }

    function beginSave(bar) {
        if (bar.querySelector('.psy-save-form')) return;
        var form = document.createElement('div');
        form.className = 'psy-save-form';
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'psy-input psy-save-name';
        input.placeholder = 'Calculation name';
        input.value = defaultCalcName();
        input.maxLength = 60;
        var ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'projects-btn projects-btn-primary psy-small-btn';
        ok.textContent = 'Save';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'projects-btn projects-btn-secondary psy-small-btn';
        cancel.textContent = 'Cancel';
        form.appendChild(input); form.appendChild(ok); form.appendChild(cancel);
        bar.appendChild(form);
        input.focus(); input.select();
        function done() { if (form.parentNode) form.parentNode.removeChild(form); }
        cancel.addEventListener('click', done);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') ok.click();
            if (e.key === 'Escape') done();
        });
        ok.addEventListener('click', function () {
            var name = input.value.trim() || defaultCalcName();
            var proceed = function () {
                HHpro.Calculators.saved.add({ name: name, calc: 'ductulator', snapshot: deepClone(state) });
                done();
                var active = HHpro.Cart.getActiveState();
                setStatus('Saved to ' + (active.mode === 'project' ? (active.name || 'project') : 'the temporary cart') + '.');
            };
            if (HHpro.Cart.ensureModeChosen) HHpro.Cart.ensureModeChosen(proceed);
            else proceed();
        });
    }

    function setStatus(msg) {
        if (!refs.saveStatus) return;
        refs.saveStatus.textContent = msg;
        clearTimeout(refs.statusTimer);
        refs.statusTimer = setTimeout(function () { refs.saveStatus.textContent = ''; }, 4000);
    }

    function triggerDownload(blob, filename) {
        var url = URL.createObjectURL(blob);
        var aEl = document.createElement('a');
        aEl.href = url;
        aEl.download = filename;
        document.body.appendChild(aEl);
        aEl.click();
        document.body.removeChild(aEl);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
    }

    // PDF from any snapshot (used by the page and by the project view).
    // The chart and the duct drawing share one SVG (chart on top).
    function pdfBlob(snapshot, meta) {
        init();
        meta = meta || {};
        var saved = state;
        state = fromSnapshot(snapshot);
        try {
            var res = evaluate(state);
            var blocks = buildReport(res, state);
            var svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('viewBox', '0 0 ' + CH_W + ' ' + (CH_H + DUCT_H + 20));
            drawChart(svg, res, { bake: true });
            var ductSvg = document.createElementNS(SVG_NS, 'svg');
            drawDuct(ductSvg, res, (CH_W - DUCT_W) / 2, CH_H + 20);
            while (ductSvg.firstChild) svg.appendChild(ductSvg.firstChild);
            var sub = [];
            if (meta.projectName) sub.push(meta.projectName);
            sub.push('HHpro Ductulator');
            sub.push(new Date(meta.savedAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
            sub.push('Altitude ' + fmtU('altitude', state.altitude));
            sub.push(state.units === 'SI' ? 'SI units' : 'IP units');
            return HHpro.PsychroPdf.build({
                title: meta.title || defaultCalcName(),
                subtitle: sub.join(' · '),
                blocks: blocks,
                svg: svg,
                footer: 'Generated by HHpro · Darcy-Weisbach with Colebrook friction factor, ASHRAE Fundamentals duct roughness; equivalent round per Huebscher'
            });
        } finally {
            state = saved;
        }
    }

    HHpro.Ductulator = {
        evaluate: function (s) { init(); return evaluate(s ? fromSnapshot(s) : state); },
        pdfBlob: pdfBlob,
        summarize: summarize
    };
})();
