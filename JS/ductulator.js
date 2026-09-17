/* ============================================================
   HHpro - Ductulator (duct sizing calculator)
   ------------------------------------------------------------
   The slide-rule duct calculator, done properly. Airflow plus
   ONE of friction rate / velocity / round diameter / rectangular
   size fixes the other quantities:

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

   Roughness comes from the ASHRAE duct roughness categories; the
   physical Ductulator assumes galvanized steel (medium smooth,
   0.0003 ft). Air density follows the site altitude at 70F.

   The wheel on the right is our own drawing of the classic
   instrument: a fixed friction ring, a rotating airflow disk with
   an index arrow, and a fixed diameter scale on the hub. The disk
   turns so the airflow lines up with the friction rate, and the
   arrow lands on the diameter - the same move as the real one.
   Scales are logarithmic; the diameter scale is laid out from the
   exact equations at 0.1 in. w.g./100 ft, so the arrow is exact
   there and within a couple of percent elsewhere (the power-law
   approximation every slide rule makes). The numbers on the hub
   and in the results panel are always the exact solution.

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
        ['flexfabric', 'Flexible duct, fabric and wire, fully extended',    0.01,   'rough'],
        ['fabric',     'Fabric duct, non-porous (DuctSox type)',            0.0003, 'medium smooth (assumed)']
    ];

    var MODES = [
        ['friction', 'Airflow + friction rate', 'the everyday equal-friction sizing: read the round size and velocity'],
        ['velocity', 'Airflow + velocity',      'size to a velocity limit and read the friction rate that goes with it'],
        ['diameter', 'Airflow + round diameter', 'check an existing round duct: velocity and friction at this airflow'],
        ['rect',     'Airflow + rectangular size', 'check a rectangular duct: equivalent round, velocity and friction']
    ];

    // Widths tried for the equal-friction rectangular table (inches).
    var RECT_WIDTHS = [6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 40, 42, 44, 48, 54, 60, 66, 72, 84, 96];
    var MAX_ASPECT = 4;

    function defaults() {
        return {
            units: 'IP',
            altitude: 0,
            material: 'galv',
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
            Object.keys(p).forEach(function (k) { if (p[k] !== undefined && d.hasOwnProperty(k)) d[k] = p[k]; });
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

    function evaluate(s) {
        var rho = airDensity(s.altitude);
        var mat = materialOf(s.material);
        var eps = mat[2];
        var Q = toNum(s.cfm, null);
        if (Q === null || Q <= 0) throw new Error('Enter the airflow.');
        var res = { rho: rho, material: mat, mode: s.mode, Q: Q };
        var D;

        if (s.mode === 'friction') {
            var fr = toNum(s.friction, null);
            if (fr === null || fr <= 0) throw new Error('Enter the friction rate.');
            D = diameterForFriction(Q, fr, rho, eps);
        } else if (s.mode === 'velocity') {
            var V = toNum(s.velocity, null);
            if (V === null || V <= 0) throw new Error('Enter the velocity.');
            D = diameterForVelocity(Q, V);
        } else if (s.mode === 'diameter') {
            D = toNum(s.diameter, null);
            if (D === null || D <= 0) throw new Error('Enter the round duct diameter.');
        } else {
            var w = toNum(s.width, null), h = toNum(s.height, null);
            if (w === null || w <= 0 || h === null || h <= 0) throw new Error('Enter the rectangular duct width and height.');
            D = equivRound(w, h);
            var Ar = w * h / 144;
            var Vr = Q / Ar;
            res.rect = {
                w: w, h: h, A: Ar, V: Vr, vp: rho * Math.pow(Vr / 1097, 2),
                aspect: Math.max(w, h) / Math.min(w, h)
            };
        }

        res.round = roundDuct(Q, D, rho, eps);
        var stdD = standardRound(D);
        res.standard = roundDuct(Q, stdD, rho, eps);
        var L = toNum(s.length, null);
        if (L !== null && L > 0) {
            res.length = L;
            res.totalLoss = res.round.dp100 * L / 100;
        }

        // Equal-friction rectangular equivalents (even inches, aspect <= 4:1).
        var rows = [];
        RECT_WIDTHS.forEach(function (wd) {
            var hExact = heightForEquiv(wd, D);
            var hr = evenInch(hExact);
            if (hr > wd) return;                       // list each pair once, wide side first
            var aspect = wd / hr;
            var de = equivRound(wd, hr);
            var atSize = roundDuct(Q, de, rho, eps);
            rows.push({
                w: wd, h: hr, de: de, aspect: aspect,
                dp100: atSize.dp100, V: Q / (wd * hr / 144),
                overAspect: aspect > MAX_ASPECT
            });
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
        var rowsIn = [['Airflow', fmtU('flow', res.Q)]];
        if (res.mode === 'friction') rowsIn.push(['Friction rate', fmtU('friction', r.dp100)]);
        if (res.mode === 'velocity') rowsIn.push(['Velocity', fmtU('velocity', r.V)]);
        if (res.mode === 'diameter') rowsIn.push(['Round diameter', fmtU('dim', r.D)]);
        if (res.mode === 'rect') rowsIn.push(['Rectangular size', sizeText(res.rect.w, res.rect.h)]);
        rowsIn.push(['Duct material', res.material[1] + ' (' + res.material[3] + ', ε = ' +
            (sys() === 'SI' ? fmt(res.material[2] * 304.8, 2) + ' mm' : res.material[2] + ' ft') + ')']);
        rowsIn.push(['Air density', fmtU('density', res.rho) + ' (' + fmtU('altitude', s.altitude) + ', 70°F)']);
        blocks.push({ title: 'Inputs', rows: rowsIn });

        var out = [];
        if (res.mode === 'rect') {
            out.push(['Equivalent round diameter', fmtU('dim', r.D) + ' (same friction)']);
            out.push(['Velocity in the rectangle', fmtU('velocity', res.rect.V) +
                (res.rect.overAspect ? '' : '') + '  (' + fmtU('area', res.rect.A) + ')']);
            out.push(['Velocity pressure in the rectangle', fmtU('pstat', res.rect.vp)]);
            out.push(['Aspect ratio', fmt(res.rect.aspect, 1) + ' : 1' + (res.rect.aspect > MAX_ASPECT ? '  (over 4:1 - avoid)' : '')]);
            out.push(['Friction rate', fmtU('friction', r.dp100)]);
        } else {
            out.push(['Round diameter', fmtU('dim', r.D)]);
            if (res.mode !== 'diameter') {
                out.push(['Nearest stock round size', fmtU('dim', res.standard.D, 0) + '  →  ' +
                    fmtU('friction', res.standard.dp100) + ', ' + fmtU('velocity', res.standard.V)]);
            }
            out.push(['Velocity', fmtU('velocity', r.V)]);
            out.push(['Friction rate', fmtU('friction', r.dp100)]);
            out.push(['Velocity pressure', fmtU('pstat', r.vp)]);
            out.push(['Cross-sectional area', fmtU('area', r.A)]);
        }
        if (res.length) {
            out.push(['Straight-run loss', fmtU('pstat', res.totalLoss) + ' over ' + fmtU('length', res.length) + ' (no fittings)']);
        }
        out.push(['Reynolds number / friction factor', fmt(r.Re, 0) + ' / ' + fmt(r.f, 4) + (r.Re < 2300 ? ' (laminar)' : '')]);
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
        blocks.push({ title: 'Rectangular sizes at the same friction', table: { head: head, rows: trows } });
        return blocks;
    }

    // -----------------------------------------------------------------
    // View
    // -----------------------------------------------------------------

    HHpro.Calculators.register({
        key: 'ductulator',
        name: 'Ductulator',
        description: 'Duct sizing slide rule: airflow plus friction rate, velocity or duct size gives the rest, with equal-friction rectangular equivalents and a spinning wheel.',
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
        sub.textContent = 'Duct sizing by the equal-friction method: enter the airflow and one of friction rate, ' +
            'velocity or duct size, and read the rest. Darcy-Weisbach with Colebrook friction, ASHRAE roughness.';
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

        var modeSec = section('Known values');
        var r = document.createElement('div');
        r.className = 'psy-radio-row dt-solve-row';
        MODES.forEach(function (m) {
            r.appendChild(radio('dt-mode', m[0], m[1], s.mode === m[0], function () {
                s.mode = m[0]; buildForm(); recompute();
            }));
        });
        modeSec.appendChild(r);
        var cur = MODES.filter(function (m) { return m[0] === s.mode; })[0];
        modeSec.appendChild(hint(cur[1] + ': ' + cur[2] + '.'));
        form.appendChild(modeSec);

        var inSec = section('Inputs');
        var g = fields();
        g.appendChild(numberField('Airflow', 'flow', s.cfm, { min: 0, step: 50 }, function (v) { s.cfm = v; }));
        if (s.mode === 'friction') {
            g.appendChild(numberField('Friction rate', 'friction', s.friction, { min: 0, step: sys() === 'SI' ? 0.1 : 0.01 }, function (v) { s.friction = v; }));
        } else if (s.mode === 'velocity') {
            g.appendChild(numberField('Velocity', 'velocity', s.velocity, { min: 0, step: sys() === 'SI' ? 0.5 : 100 }, function (v) { s.velocity = v; }));
        } else if (s.mode === 'diameter') {
            g.appendChild(numberField('Round diameter', 'dim', s.diameter, { min: 0, step: sys() === 'SI' ? 25 : 1 }, function (v) { s.diameter = v; }));
        } else {
            g.appendChild(numberField('Width', 'dim', s.width, { min: 0, step: sys() === 'SI' ? 50 : 2 }, function (v) { s.width = v; }));
            g.appendChild(numberField('Height', 'dim', s.height, { min: 0, step: sys() === 'SI' ? 50 : 2 }, function (v) { s.height = v; }));
        }
        var lenField = numberField('Straight run', 'length', s.length, { min: 0, step: sys() === 'SI' ? 5 : 10 }, function (v) { s.length = v; });
        lenField.querySelector('input').placeholder = 'optional';
        g.appendChild(lenField);
        inSec.appendChild(g);
        inSec.appendChild(hint(s.mode === 'friction'
            ? 'Typical friction rates: 0.08 to 0.10 in. w.g./100 ft for low-pressure supply, 0.05 to 0.08 for return. The straight run only adds a total loss for that length; fittings are extra.'
            : s.mode === 'velocity'
                ? 'Typical limits: 700 to 900 fpm in occupied-space branches, 1,000 to 1,500 fpm in mains, higher for medium-pressure systems.'
                : 'Checks an existing or proposed duct at this airflow. Rectangular sizes use the ASHRAE equivalent-round relation, so the friction matches a round duct of the equivalent diameter.'));

        var matSec = section('Duct material');
        var matRow = document.createElement('div');
        matRow.className = 'psy-field';
        var sel = document.createElement('select');
        sel.className = 'filter-select psy-select';
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
        matSec.appendChild(hint('ASHRAE roughness categories. The physical Ductulator is galvanized steel. Flexible duct figures assume it is pulled fully straight; sagging or compressed flex loses far more. ' +
            'Fabric duct is treated as medium smooth for a non-porous fabric; porous DuctSox runs discharge along their length and should be sized with the manufacturer\'s software.'));
        var err = document.createElement('p');
        err.className = 'psy-field-error';
        matSec.appendChild(err);
        errorEl = err;
        form.appendChild(inSec);
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

    // ---------- Right-hand side: headline numbers + the wheel ----------

    function buildSide() {
        var side = document.createElement('section');
        side.className = 'psy-chart-area dt-side';

        var hero = document.createElement('div');
        hero.className = 'dt-hero';
        side.appendChild(hero);
        refs.hero = hero;

        var wrap = document.createElement('div');
        wrap.className = 'dt-wheel-wrap';
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 620 620');
        svg.setAttribute('class', 'dt-wheel');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Ductulator wheel');
        wrap.appendChild(svg);
        side.appendChild(wrap);
        refs.svg = svg;
        drawWheel(svg, null, { bake: false });

        var note = document.createElement('p');
        note.className = 'dt-note';
        note.textContent = 'The disk turns so the airflow (red) lines up with the friction rate (blue); the arrow then points at the round diameter (green). ' +
            'Scales are logarithmic like the real slide rule, so the arrow is a close reading and the numbers on the hub are the exact solution.';
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
        var r = res.round;
        if (res.mode === 'rect') {
            hero.appendChild(heroItem(fmtU('dim', r.D), 'Equivalent round'));
            hero.appendChild(heroItem(fmtU('friction', r.dp100), 'Friction rate'));
            hero.appendChild(heroItem(fmtU('velocity', res.rect.V), 'Velocity in duct'));
        } else {
            hero.appendChild(heroItem(fmtU('dim', r.D), 'Round diameter'));
            hero.appendChild(heroItem(fmtU('velocity', r.V), 'Velocity'));
            hero.appendChild(heroItem(fmtU('friction', r.dp100), 'Friction rate'));
        }
        hero.appendChild(heroItem(fmtU('pstat', res.mode === 'rect' ? res.rect.vp : r.vp), 'Velocity pressure'));
    }

    // -----------------------------------------------------------------
    // The wheel
    // -----------------------------------------------------------------
    // Geometry (SVG units, 620 x 620, centre C):
    //   friction ring   fixed, band R 268..300, log scale, 0.1 at the top
    //   airflow disk    rotating, band R 224..262, log scale, index arrow
    //                   at disk angle 0 pointing at the hub
    //   diameter hub    fixed, band R 150..192, laid out so the arrow
    //                   reads the diameter for the aligned Q / friction
    //   centre          fixed, exact readouts
    // Angles are SVG degrees: 0 = +x (3 o'clock), clockwise positive.
    var C = 310;
    var DEG_PER_DECADE_Q = 60;                // airflow disk
    var POWER_LAW_N = 1.9;                    // dp ~ Q^n at fixed D (slide-rule assumption)
    var DEG_PER_DECADE_F = DEG_PER_DECADE_Q / POWER_LAW_N;
    var Q0 = 1000, F0 = 0.1, F0_ANGLE = -90;  // 1000 cfm at disk angle 0; 0.1 in/100 ft at the top
    var Q_MIN = 50, Q_MAX = 200000;
    var F_MIN = 0.01, F_MAX = 5;
    var D_MIN = 3, D_MAX = 90;
    var lastRotation = 0;

    function diskAngle(Q) { return DEG_PER_DECADE_Q * Math.log10(Q / Q0); }
    function ringAngle(fr) { return F0_ANGLE + DEG_PER_DECADE_F * Math.log10(fr / F0); }
    function rotationFor(Q, fr) { return ringAngle(fr) - diskAngle(Q); }
    // Hub angle for a diameter: where the arrow lands when Q(D) at the
    // reference friction is aligned with that friction.
    function hubAngle(D, rho, eps) {
        var Qref = airflowAtFriction(D, F0, rho, eps);
        return rotationFor(Qref, F0);
    }
    function airflowAtFriction(D, fr, rho, eps) {
        var lo = 1, hi = 1e6;
        for (var i = 0; i < 70; i++) {
            var mid = Math.sqrt(lo * hi);
            if (roundDuct(mid, D, rho, eps).dp100 < fr) lo = mid; else hi = mid;
        }
        return Math.sqrt(lo * hi);
    }

    function polar(R, deg) {
        var a = deg * Math.PI / 180;
        return [C + R * Math.cos(a), C + R * Math.sin(a)];
    }
    function pt(p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }

    // Closed polygonal ring between radii r1 < r2 over [a1, a2] degrees.
    function bandPath(r1, r2, a1, a2) {
        var steps = Math.max(8, Math.ceil(Math.abs(a2 - a1) / 3));
        var d = [];
        for (var i = 0; i <= steps; i++) {
            var a = a1 + (a2 - a1) * i / steps;
            d.push((i ? 'L ' : 'M ') + pt(polar(r2, a)));
        }
        for (var j = steps; j >= 0; j--) {
            var b = a1 + (a2 - a1) * j / steps;
            d.push('L ' + pt(polar(r1, b)));
        }
        return d.join(' ') + ' Z';
    }
    function circlePath(R) {
        var d = [];
        for (var i = 0; i <= 120; i++) d.push((i ? 'L ' : 'M ') + pt(polar(R, i * 3)));
        return d.join(' ') + ' Z';
    }

    function el(tag, attrs, cls) {
        var e = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
        if (cls) e.setAttribute('class', cls);
        return e;
    }

    function tick(parent, rIn, rOut, deg, cls) {
        var a = polar(rIn, deg), b = polar(rOut, deg);
        parent.appendChild(el('line', { x1: a[0].toFixed(2), y1: a[1].toFixed(2), x2: b[0].toFixed(2), y2: b[1].toFixed(2) }, cls));
    }

    // Text sitting on the circle at radius R, reading along the circle.
    function arcLabel(parent, R, deg, text, cls) {
        var p = polar(R, deg);
        var t = el('text', {
            transform: 'translate(' + p[0].toFixed(2) + ' ' + p[1].toFixed(2) + ') rotate(' + (deg + 90).toFixed(2) + ')',
            'text-anchor': 'middle'
        }, cls);
        t.textContent = text;
        parent.appendChild(t);
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

    // Draw the wheel. res = evaluate() result or null.
    // opts.bake = true renders the disk at its rotation with plain
    // coordinates (no transforms) so the PDF writer can copy it.
    // On screen the scales only depend on the unit system, air density
    // and roughness, so a wheel already drawn for the same settings is
    // just turned (CSS transition) and its centre readouts refreshed;
    // rebuilding the disk element would skip the animation.
    function drawWheel(svg, res, opts) {
        opts = opts || {};
        var rho = res ? res.rho : airDensity(state.altitude);
        var eps = res ? res.material[2] : materialOf(state.material)[2];
        var rot = res ? rotationFor(res.Q, res.round.dp100) : rotationFor(1000, 0.1);
        if (!opts.bake) {
            // Keep turning the short way round between updates.
            var k = Math.round((lastRotation - rot) / 360);
            rot += 360 * k;
            lastRotation = rot;
            var key = sys() + '|' + rho.toFixed(6) + '|' + eps;
            if (svg.__wheelKey === key) {
                var diskEl = svg.querySelector('.dt-disk');
                if (diskEl) diskEl.setAttribute('style', 'transform: rotate(' + rot.toFixed(3) + 'deg)');
                var centre = svg.querySelector('.dt-centre');
                if (centre) {
                    while (centre.firstChild) centre.removeChild(centre.firstChild);
                    drawCentre(centre, res);
                }
                return;
            }
            svg.__wheelKey = key;
        }
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        // ---- fixed face + friction ring
        svg.appendChild(el('path', { d: circlePath(300) }, 'dt-face psy-frame'));
        var fA1 = ringAngle(F_MIN) - 4, fA2 = ringAngle(F_MAX) + 4;
        svg.appendChild(el('path', { d: bandPath(268, 300, fA1, fA2) }, 'dt-band dt-band-friction psy-region'));
        var ft = logTicks(F_MIN, F_MAX);
        ft.minors.forEach(function (v) { tick(svg, 268, 276, ringAngle(v), 'dt-tick-minor psy-tick'); });
        ft.majors.forEach(function (v) {
            tick(svg, 268, 282, ringAngle(v), 'dt-tick psy-tick');
            arcLabel(svg, 291, ringAngle(v), labelNum(v), 'dt-label psy-axis-label');
        });
        arcLabel(svg, 291, fA2 + 12, 'FRICTION ' + (sys() === 'SI' ? 'Pa/m' : 'in. w.g. / 100 ft'), 'dt-scale-title psy-axis-title');
        svg.appendChild(el('path', { d: circlePath(268) }, 'dt-ring psy-frame-outline'));

        // ---- rotating airflow disk
        var disk = el('g', {}, 'dt-disk');
        var add = opts.bake ? rot : 0;
        if (!opts.bake) disk.setAttribute('style', 'transform: rotate(' + rot.toFixed(3) + 'deg)');
        disk.appendChild(el('path', { d: circlePath(262) }, 'dt-face psy-frame'));
        var qA1 = diskAngle(Q_MIN) - 4 + add, qA2 = diskAngle(Q_MAX) + 4 + add;
        disk.appendChild(el('path', { d: bandPath(224, 262, qA1, qA2) }, 'dt-band dt-band-airflow psy-region'));
        var qt = logTicks(Q_MIN, Q_MAX);
        qt.minors.forEach(function (v) { tick(disk, 254, 262, diskAngle(v) + add, 'dt-tick-minor psy-tick'); });
        qt.majors.forEach(function (v) {
            tick(disk, 248, 262, diskAngle(v) + add, 'dt-tick psy-tick');
            arcLabel(disk, 238, diskAngle(v) + add, labelNum(v), 'dt-label psy-axis-label');
        });
        arcLabel(disk, 238, qA1 - 14, 'AIRFLOW ' + U.unit('flow', sys()), 'dt-scale-title psy-axis-title');
        disk.appendChild(el('path', { d: circlePath(224) }, 'dt-ring psy-frame-outline'));
        // index arrow at disk angle 0, pointing inward at the hub scale
        var tipR = 194, baseR = 216, half = 7;
        var tip = polar(tipR, add), b1 = polar(baseR, add - half), b2 = polar(baseR, add + half);
        disk.appendChild(el('path', { d: 'M ' + pt(tip) + ' L ' + pt(b1) + ' L ' + pt(b2) + ' Z' }, 'dt-arrow psy-line'));
        tick(disk, 196, 224, add, 'dt-marker psy-line');
        svg.appendChild(disk);

        // ---- fixed diameter hub
        var hub = el('g', {}, 'dt-hub-group');
        hub.appendChild(el('path', { d: circlePath(192) }, 'dt-hub psy-frame'));
        var dStops = [];
        for (var d = D_MIN; d <= D_MAX; d += (d < 12 ? 1 : d < 30 ? 2 : d < 60 ? 5 : 10)) dStops.push(d);
        if (dStops[dStops.length - 1] !== D_MAX) dStops.push(D_MAX);
        var hA1 = hubAngle(D_MIN, rho, eps) + 4, hA2 = hubAngle(D_MAX, rho, eps) - 4;
        hub.appendChild(el('path', { d: bandPath(150, 192, Math.min(hA1, hA2), Math.max(hA1, hA2)) }, 'dt-band dt-band-diameter psy-region'));
        dStops.forEach(function (dv) {
            var ang = hubAngle(dv, rho, eps);
            var major = (dv <= 12) || (dv <= 30 && dv % 4 === 0) || (dv <= 60 && dv % 10 === 0) || dv % 20 === 0 || dv === D_MAX;
            tick(hub, 178, 192, ang, major ? 'dt-tick psy-tick' : 'dt-tick-minor psy-tick');
            if (major) {
                var lbl = sys() === 'SI' ? String(Math.round(dv * 25.4)) : String(dv);
                arcLabel(hub, 165, ang, lbl, 'dt-label-small psy-axis-label');
            }
        });
        arcLabel(hub, 165, Math.max(hA1, hA2) + 12, 'DIAMETER ' + U.unit('dim', sys()), 'dt-scale-title psy-axis-title');
        hub.appendChild(el('path', { d: circlePath(150) }, 'dt-ring psy-frame-outline'));

        // centre readouts (exact) - kept in their own group so an update
        // can refresh them without touching the scales.
        var centre = el('g', {}, 'dt-centre');
        drawCentre(centre, res);
        hub.appendChild(centre);
        svg.appendChild(hub);
    }

    function drawCentre(group, res) {
        function centreText(y, text, cls) {
            var t = el('text', { x: C, y: y, 'text-anchor': 'middle' }, cls);
            t.textContent = text;
            group.appendChild(t);
        }
        if (res) {
            var r = res.round;
            centreText(C - 46, res.mode === 'rect' ? 'EQUIVALENT ROUND' : 'ROUND DIAMETER', 'dt-center-label psy-axis-label');
            centreText(C - 20, fmtU('dim', r.D), 'dt-center-value psy-axis-title');
            centreText(C + 8, fmtU('velocity', res.mode === 'rect' ? res.rect.V : r.V), 'dt-center-sub psy-axis-label');
            centreText(C + 30, fmtU('friction', r.dp100), 'dt-center-sub psy-axis-label');
            centreText(C + 54, fmtU('flow', res.Q), 'dt-center-sub psy-axis-label');
        } else {
            centreText(C, 'Enter the inputs', 'dt-center-label psy-axis-label');
        }
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
        if (refs.svg) drawWheel(refs.svg, res, { bake: false });
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
        note.textContent = 'Even-inch sizes with the same friction rate as the round duct above. "!" marks aspect ratios over 4:1, which cost more sheet metal and pressure drop than they save in depth.';
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
            return 'Ductulator - ' + fmt(res.Q, 0) + ' CFM, ' + fmt(res.round.D, 1) + ' in';
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
            if (res.mode === 'rect') bits.push(sizeText(res.rect.w, res.rect.h), 'eq. ' + fmtU('dim', res.round.D));
            else bits.push(fmtU('dim', res.round.D) + ' round');
            bits.push(fmtU('velocity', res.mode === 'rect' ? res.rect.V : res.round.V), fmtU('friction', res.round.dp100));
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
    function pdfBlob(snapshot, meta) {
        init();
        meta = meta || {};
        var saved = state;
        state = fromSnapshot(snapshot);
        try {
            var res = evaluate(state);
            var blocks = buildReport(res, state);
            // Wheel with the rotation baked into the coordinates.
            var svg = document.createElementNS(SVG_NS, 'svg');
            svg.setAttribute('viewBox', '0 0 620 620');
            drawWheel(svg, res, { bake: true });
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

    HHpro.Ductulator = { evaluate: function (s) { init(); return evaluate(s || state); }, pdfBlob: pdfBlob, summarize: summarize };
})();
