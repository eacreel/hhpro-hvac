/* ============================================================
   HHpro - Supply air dew point calculator ("Law #1")
   ------------------------------------------------------------
   The dedicated-outdoor-air rule of thumb quoted by KCC and others:

       Q latent = 0.69 x CFM x (W space - W supply)      [W in gr/lb]

   where 0.69 = 4.5 lb/h of standard air per CFM x 1076 Btu/lb of
   moisture / 7000 gr/lb. The ventilation air alone has to carry the
   space latent load, so its supply dew point is fixed by the latent
   load and the ventilation airflow. This view solves that relation
   for any one of the three unknowns:

       dp   required supply dew point  (given latent load + CFM)
       cfm  minimum ventilation airflow (given latent load + dew point)
       ql   maximum latent load        (given CFM + dew point)

   The maths lives in psychro_core.js (latentLimit / latentCarried /
   HFG_LATENT) and is the same code the Psychrometrics calculator's
   Room check uses, so both views always agree. "Show on chart" hands
   the inputs to the Psychrometrics view (DOAS preset + Room check).
   ============================================================ */
(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    var Psy, U;
    var state = null;
    var refs = {};
    var errorEl = null;

    var SOLVES = [
        ['dp', 'Supply dew point', 'from the latent load and ventilation airflow'],
        ['cfm', 'Ventilation airflow', 'from the latent load and the dew point the unit delivers'],
        ['ql', 'Latent load', 'that this airflow and dew point can carry']
    ];
    var ROOM_KEYS = ['rh', 'wb', 'dp', 'w'];

    function defaults() {
        return {
            units: 'IP',
            altitude: 0,
            basis: 'actual',          // 'std' (0.69 rule exactly) | 'actual' (site default, matches Daikin software)
            solve: 'dp',
            room: { db: 74, key: 'rh', value: 50 },
            ql: 6400,
            cfm: 700,
            supplyDp: null            // dew point the unit delivers (optional check in 'dp' mode)
        };
    }

    function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

    function fromSnapshot(snap) {
        var d = defaults();
        try {
            var p = deepClone(snap || {});
            Object.keys(p).forEach(function (k) {
                if (k === 'room' && p.room && typeof p.room === 'object') {
                    Object.keys(p.room).forEach(function (rk) { if (p.room[rk] !== undefined) d.room[rk] = p.room[rk]; });
                } else if (p[k] !== undefined) d[k] = p[k];
            });
        } catch (e) { /* defaults */ }
        return d;
    }

    function init() {
        Psy = HHpro.Psychro; U = HHpro.PsychroUnits;
        if (!state) state = defaults();
    }

    // -----------------------------------------------------------------
    // Formatting (mirrors psychrometrics.js)
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

    function fmtPower(btuh) {
        var s = sys();
        return fmtU('power', btuh) + (s === 'IP' && Math.abs(btuh) >= 6000 ? ' (' + fmt(btuh / 12000, 2) + ' tons)' : '');
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

    function kindForKey(key) {
        var keys = Psy.INPUT_KEYS;
        for (var i = 0; i < keys.length; i++) if (keys[i].key === key) return keys[i].kind;
        return 'none';
    }

    // -----------------------------------------------------------------
    // Evaluation (pure)
    // -----------------------------------------------------------------

    function evaluate(s) {
        var P = Psy.pressureFromAltitude(s.altitude);
        var basis = s.basis === 'std' ? 'std' : 'actual';
        var room = Psy.state(s.room.db, s.room.key, s.room.value, P);
        var res = { pressure: P, basis: basis, room: room, solve: s.solve };
        var HFG = Psy.HFG_LATENT;

        function supplyFromDp() {
            var dp = Number(s.supplyDp);
            if (!isFinite(dp)) throw new Error('Enter the supply air dew point the unit delivers.');
            if (dp >= room.dp) throw new Error('The supply dew point must be below the room dew point (' + fmtU('temp', room.dp) + ') to remove moisture.');
            return Psy.state(room.db, 'dp', dp, P);
        }

        if (s.solve === 'dp') {
            var ql = toNum(s.ql, null), cfm = toNum(s.cfm, null);
            if (ql === null) throw new Error('Enter the space latent load.');
            if (cfm === null) throw new Error('Enter the ventilation airflow.');
            var lim = Psy.latentLimit(room, ql, cfm, basis, P);
            res.ql = ql; res.cfm = cfm; res.limit = lim; res.massFlow = lim.massFlow; res.factor = lim.factor;
            if (s.supplyDp !== null && s.supplyDp !== undefined && s.supplyDp !== '') {
                var sup = Psy.state(room.db, 'dp', Number(s.supplyDp), P);
                res.supply = sup;
                res.supplyOk = sup.w <= lim.w * 1.02;
                res.carried = Psy.latentCarried(room, sup, lim.massFlow);
                if (sup.w < room.w) res.minCfm = ql / (HFG * (room.w - sup.w) * (lim.massFlow / cfm));
            }
        } else if (s.solve === 'cfm') {
            var ql2 = toNum(s.ql, null);
            if (ql2 === null || ql2 <= 0) throw new Error('Enter the space latent load.');
            var sup2 = supplyFromDp();
            var dW2 = room.w - sup2.w;
            var m2 = ql2 / (HFG * dW2);
            res.ql = ql2; res.supply = sup2; res.dW = dW2; res.massFlow = m2;
            res.cfm = Psy.cfmFromMass(room, m2, basis);
            res.factor = HFG * (m2 / res.cfm) / Psy.GRAINS_PER_LB;
        } else {
            var cfm3 = toNum(s.cfm, null);
            if (cfm3 === null || cfm3 <= 0) throw new Error('Enter the ventilation airflow.');
            var sup3 = supplyFromDp();
            var m3 = Psy.massFlow(room, cfm3, basis);
            res.cfm = cfm3; res.supply = sup3; res.dW = room.w - sup3.w; res.massFlow = m3;
            res.ql = Psy.latentCarried(room, sup3, m3);
            res.factor = HFG * (m3 / cfm3) / Psy.GRAINS_PER_LB;
        }
        return res;
    }

    // Report model shared by the results panel and the PDF.
    function buildReport(res, s) {
        var blocks = [];
        var room = res.room;
        var S = sys();
        var grains = function (w) { return fmtU('grains', w * Psy.GRAINS_PER_LB); };

        blocks.push({ title: 'Space', rows: [
            ['Room condition', fmtU('temp', room.db) + ' DB / ' + fmt(room.rh * 100, 0) + '% RH'],
            ['Room dew point', fmtU('temp', room.dp)],
            ['Room humidity ratio', grains(room.w)],
            ['Barometric pressure', S === 'SI' ? fmt(res.pressure * 6.894757, 2) + ' kPa' : fmt(Psy.inHgFromPsi(res.pressure), 2) + ' in Hg'
                + ' (' + fmtU('altitude', s.altitude) + ')']
        ] });

        var rows = [];
        if (res.solve === 'dp') {
            var L = res.limit;
            rows.push(['Latent load', fmtPower(res.ql)]);
            rows.push(['Ventilation airflow', fmtU('flow', res.cfm)]);
            rows.push(['Moisture to remove', grains(L.dW) + ' per lb of air']);
            rows.push(['Required supply humidity ratio', grains(L.w) + '  (max)']);
            rows.push(['Required supply dew point', fmtU('temp', L.dp) + '  (max)']);
            if (res.supply) {
                rows.push(['Unit supply dew point', fmtU('temp', res.supply.dp) + ' vs ' + fmtU('temp', L.dp) + ' max' + (res.supplyOk ? '  OK' : '  too humid')]);
                rows.push(['Latent carried at that dew point', fmtPower(Math.max(0, res.carried)) + ' vs ' + fmtPower(res.ql)]);
                if (res.minCfm !== undefined) rows.push(['Airflow needed at that dew point', fmtU('flow', res.minCfm)]);
            }
        } else if (res.solve === 'cfm') {
            rows.push(['Latent load', fmtPower(res.ql)]);
            rows.push(['Unit supply dew point', fmtU('temp', res.supply.dp) + ' (' + grains(res.supply.w) + ')']);
            rows.push(['Moisture removed', grains(res.dW) + ' per lb of air']);
            rows.push(['Minimum ventilation airflow', fmtU('flow', res.cfm)]);
        } else {
            rows.push(['Ventilation airflow', fmtU('flow', res.cfm)]);
            rows.push(['Unit supply dew point', fmtU('temp', res.supply.dp) + ' (' + grains(res.supply.w) + ')']);
            rows.push(['Moisture removed', grains(res.dW) + ' per lb of air']);
            rows.push(['Maximum latent load', fmtPower(res.ql)]);
        }
        rows.push(['Dry-air mass flow', fmtU('massflow', res.massFlow) + (res.basis === 'actual' ? ' (actual air at the room state)' : ' (standard air)')]);
        blocks.push({ title: SOLVES.filter(function (x) { return x[0] === res.solve; })[0][1], rows: rows });

        var frows = [];
        if (S === 'IP') {
            frows.push(['Q latent =', fmt(res.factor, 2) + ' × CFM × (W room − W supply), W in gr/lb']);
            frows.push([fmt(res.factor, 2) + ' =', (res.basis === 'std' ? '4.5' : fmt(res.massFlow / res.cfm, 2)) +
                ' lb/h per CFM × ' + Psy.HFG_LATENT + ' Btu/lb ÷ 7000 gr/lb' + (res.basis === 'std' ? ' (standard air)' : ' (actual air)')]);
        } else {
            frows.push(['Q latent =', 'm dry air × ' + fmt(Psy.HFG_LATENT * 2.326, 0) + ' kJ/kg × (W room − W supply)']);
        }
        blocks.push({ title: 'Formula', rows: frows });
        return blocks;
    }

    // -----------------------------------------------------------------
    // View
    // -----------------------------------------------------------------

    HHpro.Calculators.register({
        key: 'dewpoint',
        name: 'Supply air dew point',
        description: 'Law #1 for dedicated outdoor air: the dew point the ventilation air must reach to carry the space latent load, or the airflow / latent load that goes with a given dew point.',
        icon: 'calculator',
        view: 'dewpoint',
        saved: { summarize: summarize, pdfBlob: pdfBlob, docType: 'DEW POINT (PDF)' }
    });

    HHpro.Views.dewpoint = {
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
                'Supply air dew point'
            ]));

            var main = document.createElement('main');
            main.className = 'psy-page dp-page';
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
        title.textContent = 'Supply Air Dew Point';
        var sub = document.createElement('p');
        sub.className = 'psy-sub';
        sub.textContent = 'Law #1 for dedicated outdoor air: the ventilation air alone must carry the space latent load, ' +
            'so its dew point is set by the latent load and the airflow.';
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
        label.htmlFor = 'dp-altitude-input';
        altRow.appendChild(label);
        var input = numberInput(inputDisp('altitude', state.altitude), { step: sys() === 'SI' ? 50 : 100, cls: 'psy-input psy-input-alt' });
        input.id = 'dp-altitude-input';
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
                HHpro.App.showView('dewpoint');
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
                triggerDownload(blob, (name ? name + ' - ' : '') + 'Supply air dew point - ' + dateStamp() + '.pdf');
            } catch (e) { setStatus(e.message); }
        }));
        actions.appendChild(actionButton('thermometer', 'Show on chart', showOnChart));
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

    // Hand the inputs to the Psychrometrics calculator: DOAS preset with
    // the Room check in ventilation-latent mode, so the dew point line and
    // the coil leaving point sit on the same chart.
    function showOnChart() {
        var s = state;
        var seed = {
            units: s.units, altitude: s.altitude, basis: s.basis,
            room: deepClone(s.room), ql: toNum(s.ql, null), cfm: toNum(s.cfm, null),
            snapshot: deepClone(s)      // full calculation, reported in the chart's PDF
        };
        try {
            var res = evaluate(s);
            if (s.solve === 'cfm') seed.cfm = res.cfm;
            if (s.solve === 'ql') seed.ql = res.ql;
            if (res.supply) seed.supplyDp = res.supply.dp;
        } catch (e) { /* send what we have */ }
        HHpro.App.showView('psychrometrics', { seed: seed });
    }

    // ---------- Form ----------

    function buildForm() {
        var form = refs.form;
        form.innerHTML = '';
        var s = state;

        // Solve for
        var solveSec = section('Solve for');
        var r = document.createElement('div');
        r.className = 'psy-radio-row dp-solve-row';
        SOLVES.forEach(function (o) {
            r.appendChild(radio('dp-solve', o[0], o[1], s.solve === o[0], function () {
                s.solve = o[0]; buildForm(); recompute();
            }));
        });
        solveSec.appendChild(r);
        solveSec.appendChild(hint(SOLVES.filter(function (x) { return x[0] === s.solve; })[0][1] + ' ' +
            SOLVES.filter(function (x) { return x[0] === s.solve; })[0][2] + '.'));
        form.appendChild(solveSec);

        // Space
        var roomSec = section('Space condition');
        var g = fields();
        g.appendChild(numberField('Dry bulb', 'temp', s.room.db, { step: 0.5 }, function (v) { s.room.db = v; }));
        g.appendChild(buildSecondProperty(s.room));
        roomSec.appendChild(g);
        roomSec.appendChild(hint('Design space condition. Its humidity ratio is the starting point; the supply must be drier by the moisture the load adds.'));
        form.appendChild(roomSec);

        // Givens
        var inSec = section('Inputs');
        var g2 = fields();
        if (s.solve !== 'ql') {
            g2.appendChild(numberField('Latent load', 'power', s.ql, { min: 0, step: sys() === 'SI' ? 0.5 : 500 }, function (v) { s.ql = v; }));
        }
        if (s.solve !== 'cfm') {
            g2.appendChild(numberField('Ventilation airflow', 'flow', s.cfm, { min: 0, step: 50 }, function (v) { s.cfm = v; }));
        }
        var dpLabel = s.solve === 'dp' ? 'Unit supply dew point' : 'Unit supply dew point';
        var dpField = numberField(dpLabel, 'temp', s.supplyDp, { step: 0.5 }, function (v) { s.supplyDp = v; });
        if (s.solve === 'dp') dpField.querySelector('input').placeholder = 'optional';
        g2.appendChild(dpField);
        inSec.appendChild(g2);
        inSec.appendChild(hint(s.solve === 'dp'
            ? 'Latent load from the space (people, infiltration, process). Ventilation airflow is the outdoor air delivered to the space (ASHRAE 62.1 Voz). Enter the dew point the unit can deliver to check it against the requirement.'
            : s.solve === 'cfm'
                ? 'The dew point the DOAS unit can deliver at design; the result is the least ventilation air that still carries the latent load.'
                : 'With the airflow and delivered dew point fixed, this is the most space latent load the ventilation air can remove.'));
        var basisRow = document.createElement('div');
        basisRow.className = 'psy-radio-row';
        basisRow.appendChild(inlineLabel('Air basis:'));
        [['actual', 'Actual air at the room state'], ['std', 'Standard air (' + (sys() === 'SI' ? '1.2 kg/m³' : '0.075 lb/ft³, the 0.69 rule') + ')']].forEach(function (m) {
            basisRow.appendChild(radio('dp-basis', m[0], m[1], s.basis === m[0], function () { s.basis = m[0]; recompute(); }));
        });
        inSec.appendChild(basisRow);
        var err = document.createElement('p');
        err.className = 'psy-field-error';
        inSec.appendChild(err);
        errorEl = err;
        form.appendChild(inSec);
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

    function inlineLabel(text) {
        var sp = document.createElement('span');
        sp.className = 'psy-inline-label';
        sp.textContent = text;
        return sp;
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

    function buildSecondProperty(obj) {
        var second = document.createElement('div');
        second.className = 'psy-field';
        var select = document.createElement('select');
        select.className = 'filter-select psy-select';
        select.setAttribute('aria-label', 'Property');
        Psy.INPUT_KEYS.forEach(function (k) {
            if (ROOM_KEYS.indexOf(k.key) < 0) return;
            var opt = document.createElement('option');
            opt.value = k.key;
            opt.textContent = k.label;
            if (k.key === obj.key) opt.selected = true;
            select.appendChild(opt);
        });
        if (ROOM_KEYS.indexOf(obj.key) < 0) { obj.key = ROOM_KEYS[0]; select.value = obj.key; }
        second.appendChild(select);
        var input = numberInput(inputDisp(kindForKey(obj.key), obj.value), { step: 0.5 });
        input.setAttribute('aria-label', 'Property value');
        second.appendChild(input);
        var unit = document.createElement('span');
        unit.className = 'psy-unit';
        unit.textContent = U.unit(kindForKey(obj.key), sys());
        second.appendChild(unit);
        select.addEventListener('change', function () {
            // Same air state, new property: re-express the value so the
            // point does not jump when the selector changes.
            var converted = null;
            try {
                if (obj.value !== null && obj.value !== undefined && isFinite(Number(obj.db))) {
                    var st = Psy.state(obj.db, obj.key, obj.value, Psy.pressureFromAltitude(state.altitude));
                    converted = Psy.propertyValue(st, select.value);
                }
            } catch (e) { converted = null; }
            obj.key = select.value;
            unit.textContent = U.unit(kindForKey(obj.key), sys());
            if (converted !== null && isFinite(converted)) {
                obj.value = converted;
                input.value = inputDisp(kindForKey(obj.key), obj.value);
            } else {
                obj.value = input.value === '' ? null : U.fromDisp(kindForKey(obj.key), toNum(input.value, null), sys());
            }
            recompute();
        });
        input.addEventListener('input', function () {
            obj.value = input.value === '' ? null : U.fromDisp(kindForKey(obj.key), toNum(input.value, null), sys());
            recompute();
        });
        return second;
    }

    // ---------- Right-hand side: headline result + explanation ----------

    function buildSide() {
        var side = document.createElement('section');
        side.className = 'psy-chart-area dp-side';

        var hero = document.createElement('div');
        hero.className = 'dp-hero';
        side.appendChild(hero);
        refs.hero = hero;

        var explain = document.createElement('div');
        explain.className = 'dp-explain';
        var h = document.createElement('h2');
        h.className = 'psy-section-title';
        h.textContent = 'Why the dew point comes first';
        explain.appendChild(h);
        [
            'In a dedicated outdoor air system the ventilation air is the only thing removing moisture from the space. The zone equipment (VRF, chilled beams, fan coils, sensible-only rooftops) runs with a dry coil.',
            'So the ventilation air has to leave the unit dry enough that, at the ventilation airflow, it soaks up the whole space latent load before it climbs back to the room humidity. That target is the required supply dew point.',
            'The rule of thumb is Q latent = 0.69 × CFM × Δgr/lb: 4.5 lb/h of standard air per CFM, 1076 Btu to condense each pound of moisture, 7000 grains per pound. Older texts use 0.68; the actual-air basis uses the real mass flow at the room state instead of 4.5.',
            'If the unit cannot reach the required dew point, the fixes are more ventilation air, a lower coil temperature or a wheel that dries the air further, or a lower space humidity target. Reheat after the coil does not change the dew point.'
        ].forEach(function (t) {
            var p = document.createElement('p');
            p.className = 'dp-explain-p';
            p.textContent = t;
            explain.appendChild(p);
        });
        side.appendChild(explain);
        return side;
    }

    function renderHero(res, err) {
        var hero = refs.hero;
        if (!hero) return;
        hero.innerHTML = '';
        var big = document.createElement('div');
        big.className = 'dp-hero-value';
        var cap = document.createElement('div');
        cap.className = 'dp-hero-caption';
        var line = document.createElement('div');
        line.className = 'dp-hero-line';
        if (err) {
            big.textContent = '—';
            cap.textContent = err;
            cap.classList.add('is-warn');
        } else if (res.solve === 'dp') {
            var L = res.limit;
            big.textContent = fmtU('temp', L.dp);
            cap.textContent = 'maximum supply dew point (' + fmtU('grains', L.grains) + ') to carry ' + fmtPower(res.ql) + ' on ' + fmtU('flow', res.cfm);
            if (res.supply) {
                line.textContent = 'Unit delivers ' + fmtU('temp', res.supply.dp) + ': ' + (res.supplyOk ? 'dry enough' : 'too humid');
                line.classList.add(res.supplyOk ? 'is-ok' : 'is-warn');
            }
        } else if (res.solve === 'cfm') {
            big.textContent = fmtU('flow', res.cfm);
            cap.textContent = 'minimum ventilation airflow to carry ' + fmtPower(res.ql) + ' at a ' + fmtU('temp', res.supply.dp) + ' supply dew point';
        } else {
            big.textContent = fmtPower(res.ql);
            cap.textContent = 'maximum latent load ' + fmtU('flow', res.cfm) + ' can carry at a ' + fmtU('temp', res.supply.dp) + ' supply dew point';
        }
        hero.appendChild(big);
        hero.appendChild(cap);
        if (line.textContent) hero.appendChild(line);
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
            box.appendChild(buildKvList(b.rows));
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
            if (/too humid/.test(r[1])) dd.classList.add('is-warn');
            if (/\bOK\b/.test(r[1])) dd.classList.add('is-ok');
            dl.appendChild(dt); dl.appendChild(dd);
        });
        return dl;
    }

    // -----------------------------------------------------------------
    // Save / PDF / summary
    // -----------------------------------------------------------------

    function dateStamp() {
        var d = new Date();
        return (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getFullYear();
    }

    function defaultCalcName() {
        var s = SOLVES.filter(function (x) { return x[0] === state.solve; })[0];
        return 'Supply air dew point - ' + s[1].toLowerCase();
    }

    function summarize(snap) {
        var saved = state;
        state = fromSnapshot(snap);
        try {
            var res = evaluate(state);
            var bits = ['Room ' + fmt(res.room.db, 0) + '°F / ' + fmt(res.room.rh * 100, 0) + '% RH'];
            if (res.solve === 'dp') bits.push(fmtPower(res.ql), fmtU('flow', res.cfm), 'max DP ' + fmtU('temp', res.limit.dp));
            else if (res.solve === 'cfm') bits.push(fmtPower(res.ql), 'DP ' + fmtU('temp', res.supply.dp), 'min ' + fmtU('flow', res.cfm));
            else bits.push(fmtU('flow', res.cfm), 'DP ' + fmtU('temp', res.supply.dp), 'max ' + fmtPower(res.ql));
            return bits.join(' · ');
        } catch (e) {
            return 'Supply air dew point';
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
                HHpro.Calculators.saved.add({ name: name, calc: 'dewpoint', snapshot: deepClone(state) });
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
            var sub = [];
            if (meta.projectName) sub.push(meta.projectName);
            sub.push('HHpro Supply air dew point');
            sub.push(new Date(meta.savedAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
            sub.push('Altitude ' + fmtU('altitude', state.altitude));
            sub.push(state.units === 'SI' ? 'SI units' : 'IP units');
            return HHpro.PsychroPdf.build({
                title: meta.title || defaultCalcName(),
                subtitle: sub.join(' · '),
                blocks: blocks,
                footer: 'Generated by HHpro · Q latent = m × 1076 Btu/lb × ΔW (0.69 × CFM × Δgr/lb for standard air) · psychrometrics per ASHRAE Fundamentals (PsychroLib)'
            });
        } finally {
            state = saved;
        }
    }

    // Report blocks for a snapshot in the caller's unit system: the
    // Psychrometrics view appends these to its results and PDF after a
    // "Show on chart" hand-off.
    function reportBlocks(snap, units) {
        init();
        var saved = state;
        state = fromSnapshot(snap);
        if (units === 'SI' || units === 'IP') state.units = units;
        try {
            var res = evaluate(state);
            return buildReport(res, state).map(function (b) {
                return { title: 'Supply air dew point: ' + b.title.toLowerCase(), rows: b.rows };
            });
        } catch (e) {
            return [{ title: 'Supply air dew point', rows: [['Note', e.message]] }];
        } finally {
            state = saved;
        }
    }

    HHpro.DewPoint = { pdfBlob: pdfBlob, summarize: summarize, reportBlocks: reportBlocks };
})();
