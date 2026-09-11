/* ============================================================
   HHpro - Psychrometric calculator view
   ------------------------------------------------------------
   Two tools on one page, sharing a chart:

     State Points - enter any number of air states (dry bulb plus
       one of wet bulb / RH / dew point / humidity ratio / enthalpy)
       and read every property back; each point plots on the chart.

     Mixed Air - outdoor + return air with airflow (CFM each, or
       total CFM and % OA) -> mixed-air state, plus an optional
       supply-air state. The chart shows OA, RA, MA on the mixing
       line and the MA -> SA process line; the results list the
       coil loads for that process.

   Altitude (default sea level) sets the barometric pressure for
   both the numbers and the chart curves. Everything the user
   types is kept in localStorage so the page reopens where they
   left it.

   Math lives in JS/psychro_core.js, drawing in JS/psychro_chart.js;
   this file is only the form, the results tables and the glue.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    var STORAGE_KEY = 'hhpro.psychro';
    var MAX_POINTS = 8;
    var POINT_COLOR_COUNT = 6; // .psy-point-c0 .. c5 in calculators.css

    // -----------------------------------------------------------------
    // Persistent state
    // -----------------------------------------------------------------

    function defaults() {
        return {
            altitude: 0,
            mode: 'points',                                  // 'points' | 'mix'
            show: { rh: true, wb: true, h: true, v: false },
            points: [
                { label: 'Point 1', db: 75, key: 'rh', value: 50 }
            ],
            mix: {
                oa: { db: 95, key: 'wb', value: 78 },
                ra: { db: 75, key: 'rh', value: 50 },
                flowMode: 'each',                            // 'each' | 'pct'
                oaCfm: 2000, raCfm: 8000,
                totalCfm: 10000, oaPct: 20,
                saEnabled: true,
                sa: { db: 55, key: 'rh', value: 95 }
            }
        };
    }

    function extend(base, over) {
        if (!over || typeof over !== 'object') return base;
        Object.keys(over).forEach(function (k) {
            var v = over[k];
            if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
                extend(base[k], v);
            } else if (v !== undefined) {
                base[k] = v;
            }
        });
        return base;
    }

    function load() {
        var d = defaults();
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                var pts = Array.isArray(parsed.points) && parsed.points.length ? parsed.points : d.points;
                extend(d, parsed);
                d.points = pts.slice(0, MAX_POINTS);
            }
        } catch (e) { /* corrupt or unavailable storage: use defaults */ }
        return d;
    }

    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* non-fatal */ }
    }

    var state = load();

    // Live DOM references for the current render.
    var refs = {};
    var fieldErrorEls = {};

    HHpro.Calculators.register({
        key: 'psychrometrics',
        name: 'Psychrometrics',
        description: 'Air state properties, mixed air and supply air plotted on a psychrometric chart.',
        icon: 'thermometer',
        view: 'psychrometrics'
    });

    // -----------------------------------------------------------------
    // View
    // -----------------------------------------------------------------

    HHpro.Views.psychrometrics = {
        render: function (root) {
            root.innerHTML = '';
            refs = {};
            fieldErrorEls = {};
            root.appendChild(HHpro.UI.buildHeader([
                { label: 'Calculators', view: 'calculators' },
                'Psychrometrics'
            ]));

            var main = document.createElement('main');
            main.className = 'psy-page';
            root.appendChild(main);

            main.appendChild(buildTopBar());

            var work = document.createElement('div');
            work.className = 'psy-work';
            main.appendChild(work);

            work.appendChild(buildPanel());
            work.appendChild(buildChartArea());

            recompute();
        }
    };

    // -----------------------------------------------------------------
    // Top bar: title + altitude
    // -----------------------------------------------------------------

    function buildTopBar() {
        var bar = document.createElement('div');
        bar.className = 'psy-topbar';

        var intro = document.createElement('div');
        intro.className = 'psy-intro';
        var title = document.createElement('h1');
        title.className = 'psy-title';
        title.textContent = 'Psychrometric Calculator';
        var sub = document.createElement('p');
        sub.className = 'psy-sub';
        sub.textContent = 'Enter air states to read their properties and plot them. ' +
            'Use Mixed Air for outdoor + return air mixing and the coil load to a supply condition.';
        intro.appendChild(title);
        intro.appendChild(sub);
        bar.appendChild(intro);

        var alt = document.createElement('div');
        alt.className = 'psy-altitude';

        var label = document.createElement('label');
        label.className = 'psy-field-label';
        label.textContent = 'Altitude';
        label.htmlFor = 'psy-altitude-input';
        alt.appendChild(label);

        var input = numberInput(state.altitude, { step: 100, min: -1000, max: 30000, cls: 'psy-input psy-input-alt' });
        input.id = 'psy-altitude-input';
        input.addEventListener('input', function () {
            state.altitude = toNum(input.value, 0);
            save();
            recompute();
        });
        alt.appendChild(input);

        var unit = document.createElement('span');
        unit.className = 'psy-unit';
        unit.textContent = 'ft';
        alt.appendChild(unit);

        var pressure = document.createElement('span');
        pressure.className = 'psy-pressure';
        alt.appendChild(pressure);
        refs.pressure = pressure;

        bar.appendChild(alt);
        return bar;
    }

    // -----------------------------------------------------------------
    // Left panel: tabs + form + results
    // -----------------------------------------------------------------

    function buildPanel() {
        var panel = document.createElement('aside');
        panel.className = 'psy-panel';

        var tabs = document.createElement('div');
        tabs.className = 'psy-tabs';
        tabs.setAttribute('role', 'tablist');
        [['points', 'State Points'], ['mix', 'Mixed Air']].forEach(function (t) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'psy-tab' + (state.mode === t[0] ? ' is-active' : '');
            btn.setAttribute('role', 'tab');
            btn.textContent = t[1];
            btn.dataset.mode = t[0];
            btn.addEventListener('click', function () {
                if (state.mode === t[0]) return;
                state.mode = t[0];
                save();
                Array.prototype.forEach.call(tabs.children, function (c) {
                    c.classList.toggle('is-active', c.dataset.mode === state.mode);
                });
                buildForm();
                recompute();
            });
            tabs.appendChild(btn);
        });
        panel.appendChild(tabs);

        var body = document.createElement('div');
        body.className = 'psy-panel-body';
        panel.appendChild(body);
        refs.panelBody = body;

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

    function buildForm() {
        var form = refs.form;
        form.innerHTML = '';
        fieldErrorEls = {};
        if (state.mode === 'mix') {
            buildMixForm(form);
        } else {
            buildPointsForm(form);
        }
    }

    // ---------- State Points form ----------

    function buildPointsForm(form) {
        var section = document.createElement('div');
        section.className = 'psy-section';

        var hdr = document.createElement('h2');
        hdr.className = 'psy-section-title';
        hdr.textContent = 'Air states';
        section.appendChild(hdr);

        var hint = document.createElement('p');
        hint.className = 'psy-hint';
        hint.textContent = 'Dry bulb plus any one other property defines a point.';
        section.appendChild(hint);

        var list = document.createElement('div');
        list.className = 'psy-point-list';
        section.appendChild(list);
        refs.pointList = list;

        state.points.forEach(function (pt, i) {
            list.appendChild(buildPointRow(pt, i));
        });

        var actions = document.createElement('div');
        actions.className = 'psy-actions';
        var add = document.createElement('button');
        add.type = 'button';
        add.className = 'projects-btn projects-btn-secondary psy-add-btn';
        add.appendChild(HHpro.UI.icon('plus'));
        var addLabel = document.createElement('span');
        addLabel.textContent = 'Add point';
        add.appendChild(addLabel);
        add.addEventListener('click', function () {
            if (state.points.length >= MAX_POINTS) return;
            var n = state.points.length + 1;
            var last = state.points[state.points.length - 1];
            state.points.push({
                label: 'Point ' + n,
                db: last ? last.db : 75,
                key: last ? last.key : 'rh',
                value: last ? last.value : 50
            });
            save();
            buildForm();
            recompute();
            var rows = refs.pointList.querySelectorAll('.psy-point-name');
            if (rows.length) rows[rows.length - 1].focus();
        });
        actions.appendChild(add);
        refs.addBtn = add;
        section.appendChild(actions);

        form.appendChild(section);
        updateAddState();
    }

    function updateAddState() {
        if (refs.addBtn) refs.addBtn.disabled = state.points.length >= MAX_POINTS;
    }

    function buildPointRow(pt, index) {
        var row = document.createElement('div');
        row.className = 'psy-point-row psy-point-c' + (index % POINT_COLOR_COUNT);

        var head = document.createElement('div');
        head.className = 'psy-point-head';

        var swatch = document.createElement('span');
        swatch.className = 'psy-swatch';
        head.appendChild(swatch);

        var name = document.createElement('input');
        name.type = 'text';
        name.className = 'psy-input psy-point-name';
        name.value = pt.label || ('Point ' + (index + 1));
        name.maxLength = 24;
        name.setAttribute('aria-label', 'Point name');
        name.addEventListener('input', function () {
            pt.label = name.value;
            save();
            recompute();
        });
        head.appendChild(name);

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'psy-icon-btn';
        remove.title = 'Remove point';
        remove.setAttribute('aria-label', 'Remove point');
        remove.appendChild(HHpro.UI.icon('x'));
        remove.disabled = state.points.length <= 1;
        remove.addEventListener('click', function () {
            if (state.points.length <= 1) return;
            state.points.splice(index, 1);
            save();
            buildForm();
            recompute();
        });
        head.appendChild(remove);
        row.appendChild(head);

        row.appendChild(buildStateFields(pt, 'p' + index));
        return row;
    }

    // ---------- Mixed Air form ----------

    function buildMixForm(form) {
        var mix = state.mix;

        form.appendChild(buildStreamSection('Outdoor air', 'OA', mix.oa, 'oa'));
        form.appendChild(buildStreamSection('Return air', 'RA', mix.ra, 'ra'));

        // Airflow
        var flow = document.createElement('div');
        flow.className = 'psy-section';
        var fh = document.createElement('h2');
        fh.className = 'psy-section-title';
        fh.textContent = 'Airflow';
        flow.appendChild(fh);

        var modes = document.createElement('div');
        modes.className = 'psy-radio-row';
        [['each', 'CFM per stream'], ['pct', 'Total CFM + % outdoor air']].forEach(function (m) {
            var lbl = document.createElement('label');
            lbl.className = 'psy-radio';
            var r = document.createElement('input');
            r.type = 'radio';
            r.name = 'psy-flow-mode';
            r.value = m[0];
            r.checked = mix.flowMode === m[0];
            r.addEventListener('change', function () {
                if (!r.checked) return;
                mix.flowMode = m[0];
                save();
                renderFlowFields();
                recompute();
            });
            var span = document.createElement('span');
            span.textContent = m[1];
            lbl.appendChild(r);
            lbl.appendChild(span);
            modes.appendChild(lbl);
        });
        flow.appendChild(modes);

        var flowFields = document.createElement('div');
        flowFields.className = 'psy-fields';
        flow.appendChild(flowFields);
        refs.flowFields = flowFields;
        renderFlowFields();

        var flowErr = document.createElement('p');
        flowErr.className = 'psy-field-error';
        flow.appendChild(flowErr);
        fieldErrorEls.flow = flowErr;
        form.appendChild(flow);

        // Supply air
        var sa = document.createElement('div');
        sa.className = 'psy-section';
        var sh = document.createElement('div');
        sh.className = 'psy-section-head';
        var st = document.createElement('h2');
        st.className = 'psy-section-title';
        st.textContent = 'Supply air';
        sh.appendChild(st);

        var toggle = document.createElement('label');
        toggle.className = 'psy-check';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!mix.saEnabled;
        var cbText = document.createElement('span');
        cbText.textContent = 'Include';
        toggle.appendChild(cb);
        toggle.appendChild(cbText);
        sh.appendChild(toggle);
        sa.appendChild(sh);

        var saHint = document.createElement('p');
        saHint.className = 'psy-hint';
        saHint.textContent = 'Desired leaving-coil condition. Plots the MA → SA process and reports the coil load.';
        sa.appendChild(saHint);

        var saFields = buildStateFields(mix.sa, 'sa');
        saFields.classList.toggle('is-disabled', !mix.saEnabled);
        sa.appendChild(saFields);
        cb.addEventListener('change', function () {
            mix.saEnabled = cb.checked;
            saFields.classList.toggle('is-disabled', !mix.saEnabled);
            setFieldsDisabled(saFields, !mix.saEnabled);
            save();
            recompute();
        });
        setFieldsDisabled(saFields, !mix.saEnabled);
        form.appendChild(sa);
    }

    function setFieldsDisabled(container, disabled) {
        Array.prototype.forEach.call(container.querySelectorAll('input, select'), function (c) {
            c.disabled = disabled;
        });
    }

    function buildStreamSection(title, tag, obj, id) {
        var sec = document.createElement('div');
        sec.className = 'psy-section psy-stream-' + id;
        var head = document.createElement('div');
        head.className = 'psy-section-head';
        var swatch = document.createElement('span');
        swatch.className = 'psy-swatch';
        head.appendChild(swatch);
        var h = document.createElement('h2');
        h.className = 'psy-section-title';
        h.textContent = title + ' (' + tag + ')';
        head.appendChild(h);
        sec.appendChild(head);
        sec.appendChild(buildStateFields(obj, id));
        return sec;
    }

    function renderFlowFields() {
        var mix = state.mix;
        var wrap = refs.flowFields;
        wrap.innerHTML = '';
        if (mix.flowMode === 'pct') {
            wrap.appendChild(numberField('Total airflow', 'CFM', mix.totalCfm, { min: 0, step: 50 }, function (v) { mix.totalCfm = v; }));
            wrap.appendChild(numberField('Outdoor air', '%', mix.oaPct, { min: 0, max: 100, step: 1 }, function (v) { mix.oaPct = v; }));
        } else {
            wrap.appendChild(numberField('Outdoor air', 'CFM', mix.oaCfm, { min: 0, step: 50 }, function (v) { mix.oaCfm = v; }));
            wrap.appendChild(numberField('Return air', 'CFM', mix.raCfm, { min: 0, step: 50 }, function (v) { mix.raCfm = v; }));
        }
    }

    // ---------- Shared field builders ----------

    function toNum(v, fallback) {
        var n = parseFloat(v);
        return isFinite(n) ? n : fallback;
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

    // [label] [input] [unit]
    function numberField(labelText, unit, value, opts, onChange) {
        var wrap = document.createElement('label');
        wrap.className = 'psy-field';
        var label = document.createElement('span');
        label.className = 'psy-field-label';
        label.textContent = labelText;
        wrap.appendChild(label);
        var input = numberInput(value, opts);
        input.addEventListener('input', function () {
            onChange(input.value === '' ? null : toNum(input.value, null));
            save();
            recompute();
        });
        wrap.appendChild(input);
        var u = document.createElement('span');
        u.className = 'psy-unit';
        u.textContent = unit;
        wrap.appendChild(u);
        return wrap;
    }

    // Dry bulb + (property selector, value) for one air state. Mutates
    // `obj` ({db, key, value}) in place and registers an error line
    // under `fieldErrorEls[id]`.
    function buildStateFields(obj, id) {
        var wrap = document.createElement('div');
        wrap.className = 'psy-state-fields';

        var grid = document.createElement('div');
        grid.className = 'psy-fields';

        grid.appendChild(numberField('Dry bulb', '°F', obj.db, { step: 0.5 }, function (v) { obj.db = v; }));

        var second = document.createElement('div');
        second.className = 'psy-field';

        var select = document.createElement('select');
        select.className = 'filter-select psy-select';
        select.setAttribute('aria-label', 'Second property');
        HHpro.Psychro.INPUT_KEYS.forEach(function (k) {
            var opt = document.createElement('option');
            opt.value = k.key;
            opt.textContent = k.label;
            if (k.key === obj.key) opt.selected = true;
            select.appendChild(opt);
        });
        second.appendChild(select);

        var input = numberInput(obj.value, { step: 0.5 });
        input.setAttribute('aria-label', 'Second property value');
        second.appendChild(input);

        var unit = document.createElement('span');
        unit.className = 'psy-unit';
        unit.textContent = unitFor(obj.key);
        second.appendChild(unit);

        select.addEventListener('change', function () {
            obj.key = select.value;
            unit.textContent = unitFor(obj.key);
            save();
            recompute();
        });
        input.addEventListener('input', function () {
            obj.value = input.value === '' ? null : toNum(input.value, null);
            save();
            recompute();
        });

        grid.appendChild(second);
        wrap.appendChild(grid);

        var err = document.createElement('p');
        err.className = 'psy-field-error';
        wrap.appendChild(err);
        fieldErrorEls[id] = err;

        return wrap;
    }

    function unitFor(key) {
        var keys = HHpro.Psychro.INPUT_KEYS;
        for (var i = 0; i < keys.length; i++) if (keys[i].key === key) return keys[i].unit;
        return '';
    }

    // -----------------------------------------------------------------
    // Chart area
    // -----------------------------------------------------------------

    function buildChartArea() {
        var area = document.createElement('section');
        area.className = 'psy-chart-area';

        var toolbar = document.createElement('div');
        toolbar.className = 'psy-chart-toolbar';

        var legend = document.createElement('span');
        legend.className = 'psy-toolbar-label';
        legend.textContent = 'Show lines:';
        toolbar.appendChild(legend);

        [['rh', 'Relative humidity'], ['wb', 'Wet bulb'], ['h', 'Enthalpy'], ['v', 'Specific volume']].forEach(function (t) {
            var lbl = document.createElement('label');
            lbl.className = 'psy-check';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!state.show[t[0]];
            cb.addEventListener('change', function () {
                state.show[t[0]] = cb.checked;
                save();
                recompute();
            });
            var span = document.createElement('span');
            span.textContent = t[1];
            lbl.appendChild(cb);
            lbl.appendChild(span);
            toolbar.appendChild(lbl);
        });
        area.appendChild(toolbar);

        var wrap = document.createElement('div');
        wrap.className = 'psy-chart-wrap';
        area.appendChild(wrap);
        refs.chart = HHpro.PsychroChart.create(wrap);

        var readout = document.createElement('div');
        readout.className = 'psy-readout';
        area.appendChild(readout);
        refs.readout = readout;
        showReadout(null);

        refs.chart.onHover(showReadout);
        return area;
    }

    function showReadout(st) {
        var r = refs.readout;
        if (!r) return;
        r.innerHTML = '';
        if (!st) {
            var hint = document.createElement('span');
            hint.className = 'psy-readout-hint';
            hint.textContent = 'Move the pointer over the chart to read the air state at that spot.';
            r.appendChild(hint);
            return;
        }
        [
            ['DB', fmt(st.db, 1) + ' °F'],
            ['WB', fmt(st.wb, 1) + ' °F'],
            ['DP', fmt(st.dp, 1) + ' °F'],
            ['RH', fmt(st.rh * 100, 1) + ' %'],
            ['W', fmt(st.grains, 1) + ' gr/lb'],
            ['h', fmt(st.h, 2) + ' Btu/lb'],
            ['v', fmt(st.v, 3) + ' ft³/lb']
        ].forEach(function (pair) {
            var item = document.createElement('span');
            item.className = 'psy-readout-item';
            var k = document.createElement('span');
            k.className = 'psy-readout-key';
            k.textContent = pair[0];
            var v = document.createElement('span');
            v.className = 'psy-readout-val';
            v.textContent = pair[1];
            item.appendChild(k);
            item.appendChild(v);
            r.appendChild(item);
        });
    }

    // -----------------------------------------------------------------
    // Compute + render results
    // -----------------------------------------------------------------

    function recompute() {
        var Psy = HHpro.Psychro;
        var P = Psy.pressureFromAltitude(state.altitude);
        if (refs.pressure) {
            refs.pressure.textContent = fmt(Psy.inHgFromPsi(P), 2) + ' in Hg · ' + fmt(P, 3) + ' psia';
        }

        // Reset all field errors; the branches below fill in any that apply.
        Object.keys(fieldErrorEls).forEach(function (k) { fieldErrorEls[k].textContent = ''; });

        var result = state.mode === 'mix' ? computeMix(P) : computePoints(P);

        refs.chart.update({
            pressure: P,
            show: state.show,
            points: result.points,
            lines: result.lines
        });
        renderResults(result, P);
        updateAddState();
    }

    function resolveState(obj, id, P) {
        try {
            return HHpro.Psychro.state(obj.db, obj.key, obj.value, P);
        } catch (e) {
            if (fieldErrorEls[id]) fieldErrorEls[id].textContent = e.message;
            return null;
        }
    }

    function computePoints(P) {
        var points = [], columns = [];
        state.points.forEach(function (pt, i) {
            var st = resolveState(pt, 'p' + i, P);
            var label = (pt.label || '').trim() || ('Point ' + (i + 1));
            if (!st) return;
            points.push({
                id: 'p' + i, label: label, state: st,
                cls: 'psy-point-c' + (i % POINT_COLOR_COUNT),
                title: label + ': ' + fmt(st.db, 1) + ' °F DB / ' + fmt(st.wb, 1) + ' °F WB'
            });
            columns.push({ label: label, state: st, cls: 'psy-point-c' + (i % POINT_COLOR_COUNT) });
        });
        return { kind: 'points', points: points, lines: [], columns: columns };
    }

    function computeMix(P) {
        var Psy = HHpro.Psychro;
        var mix = state.mix;
        var oa = resolveState(mix.oa, 'oa', P);
        var ra = resolveState(mix.ra, 'ra', P);
        var sa = mix.saEnabled ? resolveState(mix.sa, 'sa', P) : null;

        var oaCfm, raCfm;
        if (mix.flowMode === 'pct') {
            var total = toNum(mix.totalCfm, null), pct = toNum(mix.oaPct, null);
            if (total !== null && pct !== null) {
                oaCfm = total * pct / 100;
                raCfm = total - oaCfm;
            }
        } else {
            oaCfm = toNum(mix.oaCfm, null);
            raCfm = toNum(mix.raCfm, null);
        }

        var points = [], lines = [], columns = [];
        if (oa) { points.push({ id: 'oa', label: 'OA', state: oa, cls: 'psy-point-oa', title: 'Outdoor air' }); columns.push({ label: 'OA', state: oa, cls: 'psy-point-oa' }); }
        if (ra) { points.push({ id: 'ra', label: 'RA', state: ra, cls: 'psy-point-ra', title: 'Return air' }); columns.push({ label: 'RA', state: ra, cls: 'psy-point-ra' }); }

        var mixed = null, coil = null, flowError = null;
        if (oa && ra) {
            if (oaCfm === null || raCfm === null || oaCfm === undefined || raCfm === undefined) {
                flowError = 'Enter the airflow to compute the mixed condition.';
            } else if (oaCfm < 0 || raCfm < 0) {
                flowError = 'Airflow cannot be negative.';
            } else {
                try {
                    mixed = Psy.mix([{ state: oa, cfm: oaCfm }, { state: ra, cfm: raCfm }], P);
                    mixed.oaCfm = oaCfm;
                    mixed.raCfm = raCfm;
                    mixed.oaPctVolume = mixed.cfm > 0 ? oaCfm / mixed.cfm * 100 : 0;
                    points.push({ id: 'ma', label: 'MA', state: mixed.state, cls: 'psy-point-ma', title: 'Mixed air' });
                    columns.push({ label: 'MA', state: mixed.state, cls: 'psy-point-ma' });
                    lines.push({ from: 'oa', to: 'ra', cls: 'psy-line-mix', arrow: false });
                } catch (e) {
                    flowError = e.message;
                }
            }
        }
        if (flowError && fieldErrorEls.flow) fieldErrorEls.flow.textContent = flowError;

        if (sa) {
            points.push({ id: 'sa', label: 'SA', state: sa, cls: 'psy-point-sa', title: 'Supply air' });
            columns.push({ label: 'SA', state: sa, cls: 'psy-point-sa' });
            if (mixed) {
                lines.push({ from: 'ma', to: 'sa', cls: 'psy-line-process', arrow: true });
                coil = Psy.process(mixed.state, sa, mixed.massFlow);
            }
        }

        return { kind: 'mix', points: points, lines: lines, columns: columns, mixed: mixed, coil: coil, sa: sa };
    }

    // ---------- Results ----------

    var PROPS = [
        { label: 'Dry bulb',        unit: '°F',      get: function (s) { return fmt(s.db, 1); } },
        { label: 'Wet bulb',        unit: '°F',      get: function (s) { return fmt(s.wb, 1); } },
        { label: 'Dew point',       unit: '°F',      get: function (s) { return fmt(s.dp, 1); } },
        { label: 'Relative humidity', unit: '%',          get: function (s) { return fmt(s.rh * 100, 1); } },
        { label: 'Humidity ratio',  unit: 'gr/lb',        get: function (s) { return fmt(s.grains, 1); } },
        { label: 'Humidity ratio',  unit: 'lb/lb',        get: function (s) { return s.w.toFixed(5); } },
        { label: 'Enthalpy',        unit: 'Btu/lb',       get: function (s) { return fmt(s.h, 2); } },
        { label: 'Specific volume', unit: 'ft³/lb',  get: function (s) { return fmt(s.v, 3); } },
        { label: 'Density',         unit: 'lb/ft³',  get: function (s) { return fmt(s.density, 4); } },
        { label: 'Vapor pressure',  unit: 'psia',         get: function (s) { return fmt(s.pv, 4); } }
    ];

    function renderResults(result, P) {
        var box = refs.results;
        box.innerHTML = '';

        if (!result.columns.length) {
            var empty = document.createElement('p');
            empty.className = 'psy-hint';
            empty.textContent = 'Enter a valid air state to see its properties.';
            box.appendChild(empty);
            return;
        }

        var hdr = document.createElement('h2');
        hdr.className = 'psy-section-title';
        hdr.textContent = result.kind === 'mix' ? 'Air properties' : 'Properties';

        if (result.kind !== 'mix') {
            box.appendChild(hdr);
            box.appendChild(buildPropTable(result.columns));
            return;
        }

        // Mixed Air: the mixing summary and coil load are the point of
        // the tab, so they lead; the full property table follows.
        if (result.mixed) {
            var m = result.mixed;
            var mh = document.createElement('h2');
            mh.className = 'psy-section-title';
            mh.textContent = 'Mixing';
            box.appendChild(mh);
            var rows = [
                ['Total airflow', fmt(m.cfm, 0) + ' CFM'],
                ['Outdoor air (by volume)', fmt(m.oaPctVolume, 1) + ' %'],
                ['Outdoor air (by mass)', fmt(m.fractions[0] * 100, 1) + ' %'],
                ['Dry-air mass flow', fmt(m.massFlow, 0) + ' lb/hr']
            ];
            if (m.state.fogged) rows.push(['Note', 'Mixture lands in the fog region; saturated state shown.']);
            box.appendChild(buildKvList(rows));
        }

        if (result.coil) {
            var c = result.coil;
            var cooling = c.total >= 0;
            var ch = document.createElement('h2');
            ch.className = 'psy-section-title';
            ch.textContent = (cooling ? 'Cooling coil load' : 'Heating load') + ' (MA → SA)';
            box.appendChild(ch);
            var sign = cooling ? 1 : -1;
            var crows = [
                ['Total', fmt(sign * c.total, 0) + ' Btu/h' + (cooling ? '  (' + fmt(c.tons, 2) + ' tons)' : '')],
                ['Sensible', fmt(sign * c.sensible, 0) + ' Btu/h'],
                ['Latent', fmt(sign * c.latent, 0) + ' Btu/h']
            ];
            if (cooling && c.shr !== null) crows.push(['Sensible heat ratio', fmt(c.shr, 3)]);
            var lbhr = c.moistureLbHr;
            crows.push([lbhr >= 0 ? 'Moisture removed' : 'Moisture added',
                fmt(Math.abs(lbhr), 1) + ' lb/hr  (' + fmt(Math.abs(lbhr) / 8.345, 2) + ' gal/hr)']);
            box.appendChild(buildKvList(crows));

            var note = document.createElement('p');
            note.className = 'psy-hint';
            note.textContent = cooling
                ? 'Loads are what the coil removes from the air stream at the mixed-air mass flow.'
                : 'Supply air is warmer than mixed air, so the process adds heat to the air stream.';
            box.appendChild(note);
        } else if (result.sa && !result.mixed) {
            var n2 = document.createElement('p');
            n2.className = 'psy-hint';
            n2.textContent = 'Coil load needs both streams and their airflow.';
            box.appendChild(n2);
        }

        box.appendChild(hdr);
        box.appendChild(buildPropTable(result.columns));
    }

    function buildPropTable(columns) {
        var wrap = document.createElement('div');
        wrap.className = 'psy-table-wrap';
        var table = document.createElement('table');
        table.className = 'psy-table';

        var thead = document.createElement('thead');
        var hr = document.createElement('tr');
        var th0 = document.createElement('th');
        th0.className = 'psy-table-prop';
        th0.textContent = 'Property';
        hr.appendChild(th0);
        columns.forEach(function (c) {
            var th = document.createElement('th');
            th.className = 'psy-table-col ' + (c.cls || '');
            var sw = document.createElement('span');
            sw.className = 'psy-swatch';
            th.appendChild(sw);
            var t = document.createElement('span');
            t.textContent = c.label;
            th.appendChild(t);
            hr.appendChild(th);
        });
        thead.appendChild(hr);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        PROPS.forEach(function (p) {
            var tr = document.createElement('tr');
            var td0 = document.createElement('td');
            td0.className = 'psy-table-prop';
            td0.textContent = p.label;
            var u = document.createElement('span');
            u.className = 'psy-table-unit';
            u.textContent = p.unit;
            td0.appendChild(u);
            tr.appendChild(td0);
            columns.forEach(function (c) {
                var td = document.createElement('td');
                td.className = 'psy-table-val';
                td.textContent = p.get(c.state);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    function buildKvList(rows) {
        var dl = document.createElement('dl');
        dl.className = 'psy-kv';
        rows.forEach(function (r) {
            var dt = document.createElement('dt');
            dt.textContent = r[0];
            var dd = document.createElement('dd');
            dd.textContent = r[1];
            dl.appendChild(dt);
            dl.appendChild(dd);
        });
        return dl;
    }

    function fmt(n, d) {
        if (n === null || n === undefined || !isFinite(n)) return '—';
        return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }
})();
