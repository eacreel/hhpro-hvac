/* ============================================================
   HHpro - Mixed air calculator
   ------------------------------------------------------------
   Outdoor air and return air at their airflows give the mixed
   air condition. Mixing is adiabatic and by mass of dry air: the
   mixed humidity ratio and enthalpy are the mass-weighted averages
   of the two streams and every other property follows from them.
   The maths is Psy.mix in psychro_core.js, the same code the
   Psychrometrics calculator's mixing stage runs, so the two always
   agree.

   Each stream is entered as dry bulb plus one other property (wet
   bulb by default; RH, dew point or humidity ratio on the
   selector). Airflow is either OA + RA CFM or total CFM + % OA.

   "Add to Psychrometric Chart" opens the Psychrometrics calculator
   on a Custom system with Outdoor air and Return air switched on
   and these values filled in, so OA, RA and the MA they mix to plot
   with the mixing line (psychrometrics.js applyMixSeed).
   ============================================================ */
(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    var Psy, U;
    var state = null;
    var refs = {};
    var errorEl = null;

    // Second-property choices for a stream; wet bulb first (the default).
    var STREAM_KEYS = ['wb', 'rh', 'dp', 'w'];
    var FLOW_MODES = [
        ['each', 'Outdoor + return airflow'],
        ['pct', 'Total airflow + % outdoor air']
    ];

    function defaults() {
        return {
            units: 'IP',
            altitude: 0,
            basis: 'actual',          // 'actual' (Psychrometrics default) | 'std' (0.075 lb/ft3)
            flowMode: 'each',         // 'each' = OA + RA CFM | 'pct' = total CFM + % OA
            oa: { db: 95, key: 'wb', value: 75 },
            ra: { db: 75, key: 'wb', value: 63 },
            oaCfm: 2000, raCfm: 8000,
            totalCfm: 10000, oaPct: 20
        };
    }

    function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

    function fromSnapshot(snap) {
        var d = defaults();
        try {
            var p = deepClone(snap || {});
            Object.keys(p).forEach(function (k) {
                if ((k === 'oa' || k === 'ra') && p[k] && typeof p[k] === 'object') {
                    Object.keys(p[k]).forEach(function (sk) { if (p[k][sk] !== undefined) d[k][sk] = p[k][sk]; });
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
    // Formatting (mirrors dewpoint.js)
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

    function keyDef(key) {
        var keys = Psy.INPUT_KEYS;
        for (var i = 0; i < keys.length; i++) if (keys[i].key === key) return keys[i];
        return { key: key, label: key, kind: 'none' };
    }

    function round(n, d) { var f = Math.pow(10, d); return Math.round(n * f) / f; }

    // -----------------------------------------------------------------
    // Evaluation (pure)
    // -----------------------------------------------------------------

    // A stream's air state. Blank fields are caught here: Psy.state would
    // read a blank as 0.
    function streamState(obj, name, P) {
        if (toNum(obj.db, null) === null) throw new Error('Enter the ' + name + ' dry bulb.');
        if (toNum(obj.value, null) === null) throw new Error('Enter the ' + name + ' ' + keyDef(obj.key).label.toLowerCase() + '.');
        try {
            return Psy.state(obj.db, obj.key, obj.value, P);
        } catch (e) {
            throw new Error(name.charAt(0).toUpperCase() + name.slice(1) + ': ' + e.message.replace(/\.$/, '') + '.');
        }
    }

    // OA and RA airflow (CFM) from either way of entering it.
    function streamFlows(s) {
        if (s.flowMode === 'pct') {
            var total = toNum(s.totalCfm, null), pct = toNum(s.oaPct, null);
            if (total === null) throw new Error('Enter the total airflow.');
            if (pct === null) throw new Error('Enter the outdoor air percentage.');
            if (total <= 0) throw new Error('Total airflow must be more than zero.');
            if (pct < 0 || pct > 100) throw new Error('Outdoor air must be 0 to 100% of the total airflow.');
            var oa = total * pct / 100;
            return { oa: oa, ra: total - oa };
        }
        var o = toNum(s.oaCfm, null), r = toNum(s.raCfm, null);
        if (o === null) throw new Error('Enter the outdoor airflow.');
        if (r === null) throw new Error('Enter the return airflow.');
        if (o < 0 || r < 0) throw new Error('Airflow cannot be negative.');
        if (o + r <= 0) throw new Error('Enter airflow for at least one stream.');
        return { oa: o, ra: r };
    }

    function evaluate(s) {
        var P = Psy.pressureFromAltitude(s.altitude);
        var basis = s.basis === 'std' ? 'std' : 'actual';
        var oa = streamState(s.oa, 'outdoor air', P);
        var ra = streamState(s.ra, 'return air', P);
        var f = streamFlows(s);
        var m = Psy.mix([{ state: oa, cfm: f.oa }, { state: ra, cfm: f.ra }], P, basis);
        return {
            pressure: P, basis: basis,
            oa: oa, ra: ra, ma: m.state,
            oaCfm: f.oa, raCfm: f.ra, cfm: m.cfm,
            massFlow: m.massFlow,
            oaMass: m.fractions[0] * m.massFlow,
            raMass: m.fractions[1] * m.massFlow,
            oaPctVolume: m.cfm > 0 ? f.oa / m.cfm * 100 : 0,
            oaPctMass: m.fractions[0] * 100,
            // The familiar CFM-weighted dry bulb, for comparison.
            quickDb: (f.oa * oa.db + f.ra * ra.db) / m.cfm
        };
    }

    // Report model shared by the page and the PDF. Key/value blocks go in
    // the panel, the property tables beside the result.
    function buildReport(res, s) {
        var S = sys();
        var blocks = [];
        var ma = res.ma;

        blocks.push({ title: 'Mixed air', rows: [
            ['Dry bulb', fmtU('temp', ma.db)],
            ['Wet bulb', fmtU('temp', ma.wb)],
            ['Dew point', fmtU('temp', ma.dp)],
            ['Relative humidity', fmt(ma.rh * 100, 1) + ' %'],
            ['Humidity ratio', fmtU('grains', ma.grains)],
            ['Enthalpy', fmt(U.enthalpyDisp(ma, S), 2) + ' ' + U.unit('h', S)],
            ['Specific volume', fmtU('v', ma.v)]
        ] });
        if (ma.fogged) blocks[0].rows.push(['Note', 'The mixture lands in the fog region; the saturated state is shown.']);

        blocks.push({ title: 'Mixing', rows: [
            ['Outdoor airflow', fmtU('flow', res.oaCfm)],
            ['Return airflow', fmtU('flow', res.raCfm)],
            ['Total airflow', fmtU('flow', res.cfm)],
            ['Outdoor air (by volume)', fmt(res.oaPctVolume, 1) + ' %'],
            ['Outdoor air (by mass)', fmt(res.oaPctMass, 1) + ' %'],
            ['Dry-air mass flow', fmtU('massflow', res.massFlow) + (res.basis === 'actual' ? ' (actual air)' : ' (standard air)')],
            ['Barometric pressure', (S === 'SI' ? fmt(res.pressure * 6.894757, 2) + ' kPa' : fmt(Psy.inHgFromPsi(res.pressure), 2) + ' in Hg') +
                ' (' + fmtU('altitude', s.altitude) + ')']
        ] });

        var flowWord = S === 'SI' ? 'L/s' : 'CFM';
        blocks.push({ title: 'Formula', rows: [
            ['W MA =', '(m OA × W OA + m RA × W RA) ÷ (m OA + m RA)'],
            ['h MA =', '(m OA × h OA + m RA × h RA) ÷ (m OA + m RA)'],
            ['DB MA', 'from h MA and W MA; the other properties follow'],
            ['m =', res.basis === 'actual'
                ? flowWord + ' ÷ specific volume of each stream (actual air)'
                : (S === 'SI' ? 'L/s × 1.2 kg/m³ (standard air)' : 'CFM × 60 × 0.075 lb/ft³ (standard air)')],
            // No '≈' here: the PDF fonts are Latin-1 only.
            ['Quick estimate', '(' + flowWord + ' OA × DB OA + ' + flowWord + ' RA × DB RA) ÷ ' + flowWord + ' total = ' + fmtU('temp', res.quickDb)]
        ] });

        // Air properties, one row per stream, in the Psychrometrics
        // calculator's own layout (its table styles and PDF columns).
        var pts = [['OA', res.oa, res.oaCfm, 'psy-point-oa'], ['RA', res.ra, res.raCfm, 'psy-point-ra'], ['MA', ma, res.cfm, 'psy-point-ma']];
        var head = ['Point', U.unit('flow', S), 'DB ' + U.unit('temp', S), 'WB ' + U.unit('temp', S), 'DP ' + U.unit('temp', S), 'RH %',
            'W ' + U.unit('grains', S), 'h ' + U.unit('h', S), 'v ' + U.unit('v', S)];
        blocks.push({ title: 'Air properties', table: { head: head, rows: pts.map(function (p) {
            var st = p[1];
            return [p[0], fmt(U.toDisp('flow', p[2], S), 0),
                fmt(U.toDisp('temp', st.db, S), 1), fmt(U.toDisp('temp', st.wb, S), 1), fmt(U.toDisp('temp', st.dp, S), 1),
                fmt(st.rh * 100, 1), fmt(U.toDisp('grains', st.grains, S), 1), fmt(U.enthalpyDisp(st, S), 2), fmt(U.toDisp('v', st.v, S), 3)];
        }) }, cls: pts.map(function (p) { return p[3]; }) });
        blocks.push({ title: 'More properties', table: {
            head: ['Point', 'W ' + U.unit('w', S), 'Density ' + U.unit('density', S), 'Vapor pressure ' + U.unit('pressure', S)],
            rows: pts.map(function (p) {
                var st = p[1];
                return [p[0], st.w.toFixed(5), fmt(U.toDisp('density', st.density, S), U.decimals('density', S)),
                    fmt(U.toDisp('pressure', st.pv, S), U.decimals('pressure', S))];
            }) }, cls: pts.map(function (p) { return p[3]; }) });
        return blocks;
    }

    // -----------------------------------------------------------------
    // View
    // -----------------------------------------------------------------

    HHpro.Calculators.register({
        key: 'mixedair',
        name: 'Mixed air',
        description: 'Outdoor and return air at their airflows: the mixed air dry bulb, wet bulb, dew point, RH and the rest, ready to add to the psychrometric chart.',
        icon: 'merge',
        view: 'mixedair',
        saved: { summarize: summarize, pdfBlob: pdfBlob, docType: 'MIXED AIR (PDF)' }
    });

    HHpro.Views.mixedair = {
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
                'Mixed air'
            ]));

            var main = document.createElement('main');
            main.className = 'psy-page dp-page ma-page';
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
        title.textContent = 'Mixed Air';
        var sub = document.createElement('p');
        sub.className = 'psy-sub';
        sub.textContent = 'Outdoor and return air at their airflows give the mixed air entering the unit. ' +
            'Enter each stream as dry bulb and wet bulb (or RH, dew point or humidity ratio).';
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
        label.textContent = 'Elevation';
        label.htmlFor = 'ma-altitude-input';
        altRow.appendChild(label);
        var input = numberInput(inputDisp('altitude', state.altitude), { step: sys() === 'SI' ? 50 : 100, cls: 'psy-input psy-input-alt' });
        input.id = 'ma-altitude-input';
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
                HHpro.App.showView('mixedair');
            });
            seg.appendChild(b);
        });
        altRow.appendChild(seg);
        strip.appendChild(altRow);

        var actions = document.createElement('div');
        actions.className = 'psy-actions-bar';
        var toChart = actionButton('thermometer', 'Add to Psychrometric Chart', addToChart);
        toChart.className = 'projects-btn projects-btn-primary psy-small-btn';
        toChart.title = 'Open the Psychrometrics calculator with OA, RA and MA plotted';
        actions.appendChild(toChart);
        // Calculators-only accounts (Manufacturer) have no projects.
        if (!HHpro.State.isCalculatorsOnly()) {
            actions.appendChild(actionButton('folder', 'Save to project', function () { beginSave(actions); }));
        }
        actions.appendChild(actionButton('download', 'Export PDF', function () {
            var active = HHpro.Cart.getActiveState();
            var name = (active && active.name) || '';
            try {
                var blob = pdfBlob(deepClone(state), { projectName: name, title: defaultCalcName() });
                triggerDownload(blob, (name ? name + ' - ' : '') + 'Mixed air - ' + dateStamp() + '.pdf');
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

    // Hand the streams to the Psychrometrics calculator (applyMixSeed):
    // Custom system, Outdoor air + Return air, same airflow and air basis,
    // so its MA is this result. Nothing to plot until the inputs are valid.
    function addToChart() {
        var s = state, res;
        try { res = evaluate(s); } catch (e) { setStatus(e.message); return; }
        var pct = s.flowMode === 'pct';
        HHpro.App.showView('psychrometrics', { mixSeed: {
            units: s.units, altitude: s.altitude, basis: res.basis,
            oa: deepClone(s.oa), ra: deepClone(s.ra),
            flowMode: pct ? 'pct' : 'each',
            oaCfm: pct ? round(res.oaCfm, 0) : toNum(s.oaCfm, null),
            raCfm: pct ? round(res.raCfm, 0) : toNum(s.raCfm, null),
            totalCfm: pct ? toNum(s.totalCfm, null) : res.cfm,
            oaPct: pct ? toNum(s.oaPct, null) : round(res.oaPctVolume, 1)
        } });
    }

    // ---------- Form ----------

    function buildForm() {
        var form = refs.form;
        form.innerHTML = '';
        var s = state;

        form.appendChild(streamSection('oa', 'Outdoor air', s.oa,
            'Outdoor design condition, e.g. 95 °F DB / 75 °F WB for summer cooling.'));
        form.appendChild(streamSection('ra', 'Return air', s.ra,
            'Air coming back from the space, normally at the room condition.'));

        var flowSec = section('Airflow');
        var modeRow = document.createElement('div');
        modeRow.className = 'psy-radio-row dp-solve-row';
        FLOW_MODES.forEach(function (m) {
            modeRow.appendChild(radio('ma-flow', m[0], m[1], s.flowMode === m[0], function () {
                switchFlowMode(m[0]); buildForm(); recompute();
            }));
        });
        flowSec.appendChild(modeRow);
        var g = fields();
        if (s.flowMode === 'pct') {
            g.appendChild(numberField('Total airflow', 'flow', s.totalCfm, { min: 0, step: 100 }, function (v) { s.totalCfm = v; }));
            g.appendChild(numberField('Outdoor air', 'pct', s.oaPct, { min: 0, max: 100, step: 1 }, function (v) { s.oaPct = v; }));
        } else {
            g.appendChild(numberField('Outdoor airflow', 'flow', s.oaCfm, { min: 0, step: 100 }, function (v) { s.oaCfm = v; }));
            g.appendChild(numberField('Return airflow', 'flow', s.raCfm, { min: 0, step: 100 }, function (v) { s.raCfm = v; }));
        }
        flowSec.appendChild(g);
        var basisRow = document.createElement('div');
        basisRow.className = 'psy-radio-row';
        basisRow.appendChild(inlineLabel('Air basis:'));
        [['actual', 'Actual air'], ['std', 'Standard air (' + (sys() === 'SI' ? '1.2 kg/m³' : '0.075 lb/ft³') + ')']].forEach(function (m) {
            basisRow.appendChild(radio('ma-basis', m[0], m[1], s.basis === m[0], function () { s.basis = m[0]; recompute(); }));
        });
        flowSec.appendChild(basisRow);
        flowSec.appendChild(hint('Air mixes by mass. Actual air converts each stream’s airflow with its own density, which counts at altitude and with very hot or cold outdoor air. Standard air treats both alike, so the mass split equals the airflow split.'));
        var err = document.createElement('p');
        err.className = 'psy-field-error';
        flowSec.appendChild(err);
        errorEl = err;
        form.appendChild(flowSec);
    }

    // Switching how airflow is entered carries the same split across, so
    // the mixed air does not move.
    function switchFlowMode(mode) {
        var s = state;
        if (s.flowMode === mode) return;
        if (mode === 'pct') {
            var o = toNum(s.oaCfm, null), r = toNum(s.raCfm, null);
            if (o !== null && r !== null && o + r > 0) {
                s.totalCfm = o + r;
                s.oaPct = round(o / (o + r) * 100, 1);
            }
        } else {
            var t = toNum(s.totalCfm, null), p = toNum(s.oaPct, null);
            if (t !== null && p !== null) {
                s.oaCfm = round(t * p / 100, 0);
                s.raCfm = round(t - s.oaCfm, 0);
            }
        }
        s.flowMode = mode;
    }

    // Outdoor / return air: swatch in the chart colour, dry bulb, then
    // the property selector (wet bulb by default).
    function streamSection(id, titleText, obj, hintText) {
        var sec = document.createElement('div');
        sec.className = 'psy-section psy-point-' + id;
        var head = document.createElement('div');
        head.className = 'psy-section-head';
        var swatch = document.createElement('span');
        swatch.className = 'psy-swatch';
        head.appendChild(swatch);
        var h = document.createElement('h2');
        h.className = 'psy-section-title';
        h.textContent = titleText;
        head.appendChild(h);
        sec.appendChild(head);
        var g = fields();
        g.appendChild(numberField('Dry bulb', 'temp', obj.db, { step: 0.5 }, function (v) { obj.db = v; }));
        g.appendChild(buildSecondProperty(obj));
        sec.appendChild(g);
        sec.appendChild(hint(hintText));
        return sec;
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
        if (opts.min !== undefined) input.min = String(opts.min);
        if (opts.max !== undefined) input.max = String(opts.max);
        // Any typed value is valid; the arrow keys still move by opts.step.
        HHpro.UI.stepNumberInput(input, opts.step, opts.min, opts.max);
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
            if (STREAM_KEYS.indexOf(k.key) < 0) return;
            var opt = document.createElement('option');
            opt.value = k.key;
            opt.textContent = k.label;
            if (k.key === obj.key) opt.selected = true;
            select.appendChild(opt);
        });
        if (STREAM_KEYS.indexOf(obj.key) < 0) { obj.key = STREAM_KEYS[0]; select.value = obj.key; }
        second.appendChild(select);
        var input = numberInput(inputDisp(keyDef(obj.key).kind, obj.value), { step: 0.5 });
        input.setAttribute('aria-label', 'Property value');
        second.appendChild(input);
        var unit = document.createElement('span');
        unit.className = 'psy-unit';
        unit.textContent = U.unit(keyDef(obj.key).kind, sys());
        second.appendChild(unit);
        select.addEventListener('change', function () {
            // Same air state, new property: re-express the value so the
            // point does not jump when the selector changes.
            var converted = null;
            try {
                if (toNum(obj.value, null) !== null && toNum(obj.db, null) !== null) {
                    var st = Psy.state(obj.db, obj.key, obj.value, Psy.pressureFromAltitude(state.altitude));
                    converted = Psy.propertyValue(st, select.value);
                }
            } catch (e) { converted = null; }
            obj.key = select.value;
            var kind = keyDef(obj.key).kind;
            unit.textContent = U.unit(kind, sys());
            if (converted !== null && isFinite(converted)) {
                obj.value = converted;
                input.value = inputDisp(kind, obj.value);
            } else {
                obj.value = input.value === '' ? null : U.fromDisp(kind, toNum(input.value, null), sys());
            }
            recompute();
        });
        input.addEventListener('input', function () {
            obj.value = input.value === '' ? null : U.fromDisp(keyDef(obj.key).kind, toNum(input.value, null), sys());
            recompute();
        });
        return second;
    }

    // ---------- Right-hand side: headline result, tables, explanation ----------

    function buildSide() {
        var side = document.createElement('section');
        side.className = 'psy-chart-area dp-side ma-side';

        var hero = document.createElement('div');
        hero.className = 'dp-hero ma-hero psy-point-ma';
        side.appendChild(hero);
        refs.hero = hero;

        var tables = document.createElement('div');
        tables.className = 'ma-tables';
        side.appendChild(tables);
        refs.tables = tables;

        var explain = document.createElement('div');
        explain.className = 'dp-explain';
        var h = document.createElement('h2');
        h.className = 'psy-section-title';
        h.textContent = 'How the mix is worked out';
        explain.appendChild(h);
        [
            'Outdoor and return air mix without adding or removing heat or moisture, so on the psychrometric chart the mixed air lands on the straight line between OA and RA, closer to the stream with more air.',
            'Air mixes by mass of dry air. The mixed humidity ratio and enthalpy are the mass-weighted averages of the two streams, and the dry bulb, wet bulb, dew point and RH all follow from those two.',
            'The quick estimate, (OA CFM × OA DB + RA CFM × RA DB) ÷ total CFM, lands within a few tenths of a degree on standard air. On actual air, cold outdoor air is denser than its CFM suggests, so in winter the true mix is colder than the estimate. Wet bulb and RH do not average this way.',
            'Add to Psychrometric Chart opens the Psychrometrics calculator with these streams as Outdoor air and Return air, so OA, RA and MA plot with the mixing line. Add a cooling coil, preheat or other stages there to carry on from MA.'
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
        var label = document.createElement('div');
        label.className = 'ma-hero-label';
        var sw = document.createElement('span');
        sw.className = 'psy-swatch';
        label.appendChild(sw);
        label.appendChild(document.createTextNode('Mixed air (MA)'));
        hero.appendChild(label);
        var big = document.createElement('div');
        big.className = 'dp-hero-value';
        var cap = document.createElement('div');
        cap.className = 'dp-hero-caption';
        if (err) {
            big.textContent = '—';
            cap.textContent = err;
            cap.classList.add('is-warn');
            hero.appendChild(big);
            hero.appendChild(cap);
            return;
        }
        var ma = res.ma;
        big.textContent = fmtU('temp', ma.db) + ' DB / ' + fmtU('temp', ma.wb) + ' WB';
        cap.textContent = fmt(ma.rh * 100, 0) + '% RH · ' + fmtU('temp', ma.dp) + ' dew point · ' +
            fmtU('grains', ma.grains) + ' · ' + fmt(res.oaPctVolume, 1) + '% outdoor air (' +
            fmtU('flow', res.oaCfm) + ' of ' + fmtU('flow', res.cfm) + ')';
        hero.appendChild(big);
        hero.appendChild(cap);
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
        var box = refs.results, tables = refs.tables;
        box.innerHTML = '';
        tables.innerHTML = '';
        if (err) {
            if (errorEl) errorEl.textContent = err;
            return;
        }
        buildReport(res, state).forEach(function (b) {
            var h = document.createElement('h2');
            h.className = 'psy-section-title';
            h.textContent = b.title;
            if (b.table) {
                tables.appendChild(h);
                tables.appendChild(buildTable(b.table, b.cls));
            } else {
                box.appendChild(h);
                box.appendChild(buildKvList(b.rows));
            }
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
            dl.appendChild(dt); dl.appendChild(dd);
        });
        return dl;
    }

    // Same markup as the Psychrometrics calculator's property tables.
    function buildTable(t, rowCls) {
        var wrap = document.createElement('div');
        wrap.className = 'psy-table-wrap';
        var table = document.createElement('table');
        table.className = 'psy-table psy-table-cols-' + t.head.length;
        var thead = document.createElement('thead');
        var hr = document.createElement('tr');
        t.head.forEach(function (h, i) {
            var th = document.createElement('th');
            th.className = i === 0 ? 'psy-table-prop' : 'psy-table-col';
            th.textContent = h;
            hr.appendChild(th);
        });
        thead.appendChild(hr);
        table.appendChild(thead);
        var tbody = document.createElement('tbody');
        t.rows.forEach(function (row, ri) {
            var tr = document.createElement('tr');
            if (rowCls && rowCls[ri]) tr.className = rowCls[ri];
            row.forEach(function (cell, i) {
                var td = document.createElement('td');
                td.className = i === 0 ? 'psy-table-prop' : 'psy-table-val';
                if (i === 0 && rowCls) {
                    var sw = document.createElement('span');
                    sw.className = 'psy-swatch';
                    td.appendChild(sw);
                }
                td.appendChild(document.createTextNode(cell));
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    // -----------------------------------------------------------------
    // Save / PDF / summary
    // -----------------------------------------------------------------

    function dateStamp() {
        var d = new Date();
        return (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getFullYear();
    }

    function defaultCalcName() { return 'Mixed air'; }

    function summarize(snap) {
        init();   // the project view can call this before the calculator has opened
        var saved = state;
        state = fromSnapshot(snap);
        try {
            var res = evaluate(state);
            return ['OA ' + fmtU('temp', res.oa.db, 0) + ' / ' + fmtU('temp', res.oa.wb, 0) + ' WB',
                'RA ' + fmtU('temp', res.ra.db, 0) + ' / ' + fmtU('temp', res.ra.wb, 0) + ' WB',
                fmt(res.oaPctVolume, 0) + '% OA',
                'MA ' + fmtU('temp', res.ma.db) + ' / ' + fmtU('temp', res.ma.wb) + ' WB'].join(' · ');
        } catch (e) {
            return 'Mixed air';
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
                HHpro.Calculators.saved.add({ name: name, calc: 'mixedair', snapshot: deepClone(state) });
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
            var sub = [];
            if (meta.projectName) sub.push(meta.projectName);
            sub.push('HHpro Mixed air');
            sub.push(new Date(meta.savedAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
            sub.push('Elevation ' + fmtU('altitude', state.altitude));
            sub.push(state.units === 'SI' ? 'SI units' : 'IP units');
            return HHpro.PsychroPdf.build({
                title: meta.title || defaultCalcName(),
                subtitle: sub.join(' · '),
                blocks: buildReport(res, state),
                footer: 'Generated by HHpro · adiabatic mixing by mass of dry air · psychrometrics per ASHRAE Fundamentals (PsychroLib)'
            });
        } finally {
            state = saved;
        }
    }

    HHpro.MixedAir = { pdfBlob: pdfBlob, summarize: summarize };
})();
