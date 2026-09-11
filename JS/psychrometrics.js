/* ============================================================
   HHpro - Psychrometric calculator view
   ------------------------------------------------------------
   Two tools on one page, sharing a chart:

     Mixed Air (default) - outdoor and/or return air with airflow
       (CFM each, or total CFM and % OA) -> mixed-air state, an
       optional coil leaving (supply) state and an optional hot gas
       reheat leaving temperature. The chart shows OA, RA, MA on
       the mixing line, the MA -> SA coil process and the SA -> RH
       reheat; the results list the coil and reheat loads.

     State Points - enter any number of air states (dry bulb plus
       one of wet bulb / RH / dew point / humidity ratio / enthalpy)
       and read every property back; each point plots on the chart.

   Altitude (default sea level) sets the barometric pressure for
   both the numbers and the chart curves. Loads default to the
   standard-air basis (0.075 lb/ft3, i.e. CFM x 4.5) that coil
   selection software and the 1.08/4.5 rules of thumb use; the
   "actual air" basis uses the specific volume at each stream.
   Everything the user types is kept in localStorage so the page
   reopens where they left it.

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

    var RANGE_OPTIONS = [
        { dbMin: 20,  label: '20 to 120 °F (standard)' },
        { dbMin: 0,   label: '0 to 120 °F' },
        { dbMin: -20, label: '-20 to 120 °F (cold climate)' }
    ];

    // -----------------------------------------------------------------
    // Persistent state
    // -----------------------------------------------------------------

    function defaults() {
        return {
            altitude: 0,
            mode: 'mix',                                     // 'mix' | 'points'
            dbMin: 20,                                       // chart low end
            show: { rh: true, wb: true, h: true, v: false },
            points: [
                { label: 'Point 1', db: 75, key: 'rh', value: 50 }
            ],
            mix: {
                oaEnabled: true,
                raEnabled: true,
                oa: { db: 95, key: 'wb', value: 78 },
                ra: { db: 75, key: 'rh', value: 50 },
                flowMode: 'each',                            // 'each' | 'pct'
                basis: 'std',                                // 'std' | 'actual'
                oaCfm: 2000, raCfm: 8000,
                totalCfm: 10000, oaPct: 20,
                saEnabled: true,
                sa: { db: 55, key: 'rh', value: 95 },        // coil leaving air
                rhEnabled: false,
                rhDb: 65                                     // hot gas reheat leaving dry bulb
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
        description: 'Mixed air, coil leaving air and reheat plotted on a psychrometric chart, plus air state properties.',
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
    // Top bar: title only (altitude lives at the top of the panel)
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
        sub.textContent = 'Mixed Air takes outdoor and return air through the coil (and reheat) and reports the loads. ' +
            'State Points reads the properties of any air condition. Everything plots on the chart.';
        intro.appendChild(title);
        intro.appendChild(sub);
        bar.appendChild(intro);
        return bar;
    }

    function buildAltitudeStrip() {
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
        return alt;
    }

    // -----------------------------------------------------------------
    // Left panel: altitude + tabs + form + results
    // -----------------------------------------------------------------

    function buildPanel() {
        var panel = document.createElement('aside');
        panel.className = 'psy-panel';

        panel.appendChild(buildAltitudeStrip());

        var tabs = document.createElement('div');
        tabs.className = 'psy-tabs';
        tabs.setAttribute('role', 'tablist');
        [['mix', 'Mixed Air'], ['points', 'State Points']].forEach(function (t) {
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
        if (state.mode === 'points') {
            buildPointsForm(form);
        } else {
            buildMixForm(form);
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

        form.appendChild(buildStreamSection('Outdoor air', 'OA', mix.oa, 'oa', 'oaEnabled',
            'Include'));
        form.appendChild(buildStreamSection('Return air', 'RA', mix.ra, 'ra', 'raEnabled',
            'Include'));

        // Airflow
        var flow = document.createElement('div');
        flow.className = 'psy-section';
        var fh = document.createElement('h2');
        fh.className = 'psy-section-title';
        fh.textContent = 'Airflow';
        flow.appendChild(fh);

        var flowFields = document.createElement('div');
        flowFields.className = 'psy-flow-fields';
        flow.appendChild(flowFields);
        refs.flowFields = flowFields;
        renderFlowFields();

        var basisRow = document.createElement('div');
        basisRow.className = 'psy-radio-row';
        var basisLbl = document.createElement('span');
        basisLbl.className = 'psy-inline-label';
        basisLbl.textContent = 'Load basis:';
        basisRow.appendChild(basisLbl);
        [['std', 'Standard air (0.075 lb/ft³)'], ['actual', 'Actual air at each stream']].forEach(function (m) {
            basisRow.appendChild(radio('psy-basis', m[0], m[1], mix.basis === m[0], function () {
                mix.basis = m[0];
                save();
                recompute();
            }));
        });
        flow.appendChild(basisRow);

        var basisHint = document.createElement('p');
        basisHint.className = 'psy-hint';
        basisHint.textContent = 'Standard air is the CFM × 4.5 convention used by coil selection ' +
            'software and the 1.08 / 4.5 rules of thumb, independent of altitude.';
        flow.appendChild(basisHint);

        var flowErr = document.createElement('p');
        flowErr.className = 'psy-field-error';
        flow.appendChild(flowErr);
        fieldErrorEls.flow = flowErr;
        form.appendChild(flow);

        // Coil leaving air (supply)
        var sa = document.createElement('div');
        sa.className = 'psy-section psy-stream-sa';
        sa.appendChild(buildSectionHead('Coil leaving air (SA)', true, mix.saEnabled, function (on) {
            mix.saEnabled = on;
            saFields.classList.toggle('is-disabled', !on);
            setFieldsDisabled(saFields, !on);
            save();
            recompute();
        }));
        var saHint = document.createElement('p');
        saHint.className = 'psy-hint';
        saHint.textContent = 'Desired leaving-coil condition. Plots the MA → SA process and reports the coil load.';
        sa.appendChild(saHint);
        var saFields = buildStateFields(mix.sa, 'sa');
        saFields.classList.toggle('is-disabled', !mix.saEnabled);
        setFieldsDisabled(saFields, !mix.saEnabled);
        sa.appendChild(saFields);
        form.appendChild(sa);

        // Hot gas reheat
        var rh = document.createElement('div');
        rh.className = 'psy-section psy-stream-rh';
        rh.appendChild(buildSectionHead('Hot gas reheat (RH)', true, mix.rhEnabled, function (on) {
            mix.rhEnabled = on;
            rhFields.classList.toggle('is-disabled', !on);
            setFieldsDisabled(rhFields, !on);
            save();
            recompute();
        }));
        var rhHint = document.createElement('p');
        rhHint.className = 'psy-hint';
        rhHint.textContent = 'Sensible reheat after the coil: humidity ratio stays at the coil leaving value, ' +
            'only dry bulb rises. Plots SA → RH.';
        rh.appendChild(rhHint);
        var rhFields = document.createElement('div');
        rhFields.className = 'psy-state-fields';
        var rhGrid = document.createElement('div');
        rhGrid.className = 'psy-fields';
        rhGrid.appendChild(numberField('Leaving dry bulb', '°F', mix.rhDb, { step: 0.5 }, function (v) { mix.rhDb = v; }));
        rhFields.appendChild(rhGrid);
        var rhErr = document.createElement('p');
        rhErr.className = 'psy-field-error';
        rhFields.appendChild(rhErr);
        fieldErrorEls.rh = rhErr;
        rhFields.classList.toggle('is-disabled', !mix.rhEnabled);
        setFieldsDisabled(rhFields, !mix.rhEnabled);
        rh.appendChild(rhFields);
        form.appendChild(rh);
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

    function setFieldsDisabled(container, disabled) {
        Array.prototype.forEach.call(container.querySelectorAll('input, select'), function (c) {
            c.disabled = disabled;
        });
    }

    // Section heading with the colour swatch and an optional Include toggle.
    function buildSectionHead(titleText, withToggle, checked, onToggle) {
        var head = document.createElement('div');
        head.className = 'psy-section-head';
        var swatch = document.createElement('span');
        swatch.className = 'psy-swatch';
        head.appendChild(swatch);
        var h = document.createElement('h2');
        h.className = 'psy-section-title';
        h.textContent = titleText;
        head.appendChild(h);
        if (withToggle) {
            var toggle = document.createElement('label');
            toggle.className = 'psy-check';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!checked;
            cb.addEventListener('change', function () { onToggle(cb.checked); });
            var cbText = document.createElement('span');
            cbText.textContent = 'Include';
            toggle.appendChild(cb);
            toggle.appendChild(cbText);
            head.appendChild(toggle);
        }
        return head;
    }

    function buildStreamSection(title, tag, obj, id, enabledKey) {
        var mix = state.mix;
        var sec = document.createElement('div');
        sec.className = 'psy-section psy-stream-' + id;
        var fields = buildStateFields(obj, id);
        sec.appendChild(buildSectionHead(title + ' (' + tag + ')', true, mix[enabledKey], function (on) {
            mix[enabledKey] = on;
            fields.classList.toggle('is-disabled', !on);
            setFieldsDisabled(fields, !on);
            save();
            renderFlowFields();
            recompute();
        }));
        fields.classList.toggle('is-disabled', !mix[enabledKey]);
        setFieldsDisabled(fields, !mix[enabledKey]);
        sec.appendChild(fields);
        return sec;
    }

    // Airflow inputs depend on which streams are included: both streams
    // get the CFM-each / total+%OA choice, a single stream just needs
    // its own CFM.
    function renderFlowFields() {
        var mix = state.mix;
        var wrap = refs.flowFields;
        if (!wrap) return;
        wrap.innerHTML = '';
        var both = mix.oaEnabled && mix.raEnabled;
        var fields = document.createElement('div');
        fields.className = 'psy-fields';

        if (both) {
            var modes = document.createElement('div');
            modes.className = 'psy-radio-row';
            [['each', 'CFM per stream'], ['pct', 'Total CFM + % outdoor air']].forEach(function (m) {
                modes.appendChild(radio('psy-flow-mode', m[0], m[1], mix.flowMode === m[0], function () {
                    mix.flowMode = m[0];
                    save();
                    renderFlowFields();
                    recompute();
                }));
            });
            wrap.appendChild(modes);
            if (mix.flowMode === 'pct') {
                fields.appendChild(numberField('Total airflow', 'CFM', mix.totalCfm, { min: 0, step: 50 }, function (v) { mix.totalCfm = v; }));
                fields.appendChild(numberField('Outdoor air', '%', mix.oaPct, { min: 0, max: 100, step: 1 }, function (v) { mix.oaPct = v; }));
            } else {
                fields.appendChild(numberField('Outdoor air', 'CFM', mix.oaCfm, { min: 0, step: 50 }, function (v) { mix.oaCfm = v; }));
                fields.appendChild(numberField('Return air', 'CFM', mix.raCfm, { min: 0, step: 50 }, function (v) { mix.raCfm = v; }));
            }
        } else if (mix.oaEnabled) {
            fields.appendChild(numberField('Outdoor air', 'CFM', mix.oaCfm, { min: 0, step: 50 }, function (v) { mix.oaCfm = v; }));
        } else if (mix.raEnabled) {
            fields.appendChild(numberField('Return air', 'CFM', mix.raCfm, { min: 0, step: 50 }, function (v) { mix.raCfm = v; }));
        } else {
            var none = document.createElement('p');
            none.className = 'psy-hint';
            none.textContent = 'Include at least one air stream above.';
            fields.appendChild(none);
        }
        wrap.appendChild(fields);
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

        // Chart temperature window
        var rangeWrap = document.createElement('label');
        rangeWrap.className = 'psy-field psy-range';
        var rangeLbl = document.createElement('span');
        rangeLbl.className = 'psy-toolbar-label';
        rangeLbl.textContent = 'Range:';
        rangeWrap.appendChild(rangeLbl);
        var rangeSel = document.createElement('select');
        rangeSel.className = 'filter-select psy-select psy-range-select';
        RANGE_OPTIONS.forEach(function (o) {
            var opt = document.createElement('option');
            opt.value = String(o.dbMin);
            opt.textContent = o.label;
            if (o.dbMin === state.dbMin) opt.selected = true;
            rangeSel.appendChild(opt);
        });
        rangeSel.addEventListener('change', function () {
            state.dbMin = toNum(rangeSel.value, 20);
            save();
            recompute();
        });
        rangeWrap.appendChild(rangeSel);
        toolbar.appendChild(rangeWrap);

        area.appendChild(toolbar);

        var wrap = document.createElement('div');
        wrap.className = 'psy-chart-wrap';
        area.appendChild(wrap);
        refs.chart = HHpro.PsychroChart.create(wrap, { dbMin: state.dbMin });

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

        var result = state.mode === 'points' ? computePoints(P) : computeMix(P);

        refs.chart.update({
            pressure: P,
            dbMin: state.dbMin,
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
        var both = mix.oaEnabled && mix.raEnabled;

        var oa = mix.oaEnabled ? resolveState(mix.oa, 'oa', P) : null;
        var ra = mix.raEnabled ? resolveState(mix.ra, 'ra', P) : null;
        var sa = mix.saEnabled ? resolveState(mix.sa, 'sa', P) : null;

        // Airflow per included stream
        var oaCfm = null, raCfm = null;
        if (both) {
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
        } else if (mix.oaEnabled) {
            oaCfm = toNum(mix.oaCfm, null);
        } else if (mix.raEnabled) {
            raCfm = toNum(mix.raCfm, null);
        }

        var points = [], lines = [], columns = [];
        if (oa) { points.push({ id: 'oa', label: 'OA', state: oa, cls: 'psy-point-oa', title: 'Outdoor air' }); columns.push({ label: 'OA', state: oa, cls: 'psy-point-oa' }); }
        if (ra) { points.push({ id: 'ra', label: 'RA', state: ra, cls: 'psy-point-ra', title: 'Return air' }); columns.push({ label: 'RA', state: ra, cls: 'psy-point-ra' }); }

        // Entering-coil state: the mixture when both streams are in, or
        // the single included stream.
        var streams = [];
        if (mix.oaEnabled && oa) streams.push({ id: 'oa', label: 'OA', state: oa, cfm: oaCfm });
        if (mix.raEnabled && ra) streams.push({ id: 'ra', label: 'RA', state: ra, cfm: raCfm });
        var enabledCount = (mix.oaEnabled ? 1 : 0) + (mix.raEnabled ? 1 : 0);

        var mixed = null, entering = null, enteringId = null, enteringLabel = null, flowError = null;
        if (enabledCount === 0) {
            flowError = 'Include at least one air stream.';
        } else if (streams.length === enabledCount) {
            var missing = streams.some(function (s) { return s.cfm === null || s.cfm === undefined; });
            var negative = streams.some(function (s) { return s.cfm < 0; });
            if (missing) {
                flowError = 'Enter the airflow to compute the entering condition.';
            } else if (negative) {
                flowError = 'Airflow cannot be negative.';
            } else {
                try {
                    mixed = Psy.mix(streams.map(function (s) { return { state: s.state, cfm: s.cfm }; }), P, mix.basis);
                    mixed.oaCfm = mix.oaEnabled ? oaCfm : 0;
                    mixed.single = streams.length === 1;
                    mixed.oaPctVolume = mixed.cfm > 0 ? mixed.oaCfm / mixed.cfm * 100 : 0;
                    mixed.oaPctMass = mix.oaEnabled ? mixed.fractions[0] * 100 : 0;
                    if (mixed.single) {
                        entering = streams[0].state;
                        enteringId = streams[0].id;
                        enteringLabel = streams[0].label;
                    } else {
                        entering = mixed.state;
                        enteringId = 'ma';
                        enteringLabel = 'MA';
                        points.push({ id: 'ma', label: 'MA', state: mixed.state, cls: 'psy-point-ma', title: 'Mixed air' });
                        columns.push({ label: 'MA', state: mixed.state, cls: 'psy-point-ma' });
                        lines.push({ from: 'oa', to: 'ra', cls: 'psy-line-mix', arrow: false });
                    }
                } catch (e) {
                    flowError = e.message;
                }
            }
        }
        if (flowError && fieldErrorEls.flow) fieldErrorEls.flow.textContent = flowError;

        var coil = null;
        if (sa) {
            points.push({ id: 'sa', label: 'SA', state: sa, cls: 'psy-point-sa', title: 'Coil leaving air' });
            columns.push({ label: 'SA', state: sa, cls: 'psy-point-sa' });
            if (entering) {
                lines.push({ from: enteringId, to: 'sa', cls: 'psy-line-process', arrow: true });
                coil = Psy.process(entering, sa, mixed.massFlow);
            }
        }

        // Hot gas reheat: sensible-only rise from the coil leaving state.
        var rhState = null, reheat = null, net = null;
        if (mix.rhEnabled) {
            if (!sa) {
                if (fieldErrorEls.rh) fieldErrorEls.rh.textContent = 'Reheat needs the coil leaving air above.';
            } else {
                try {
                    rhState = Psy.reheat(sa, mix.rhDb, P);
                    points.push({ id: 'rh', label: 'RH', state: rhState, cls: 'psy-point-rh', title: 'After hot gas reheat' });
                    columns.push({ label: 'RH', state: rhState, cls: 'psy-point-rh' });
                    lines.push({ from: 'sa', to: 'rh', cls: 'psy-line-reheat', arrow: true });
                    if (entering) {
                        reheat = Psy.process(sa, rhState, mixed.massFlow);      // negative = heat added
                        net = Psy.process(entering, rhState, mixed.massFlow);   // entering -> final supply
                    }
                } catch (e) {
                    if (fieldErrorEls.rh) fieldErrorEls.rh.textContent = e.message;
                }
            }
        }

        return {
            kind: 'mix', points: points, lines: lines, columns: columns,
            mixed: mixed, entering: entering, enteringLabel: enteringLabel,
            coil: coil, sa: sa, reheat: reheat, net: net, rhState: rhState
        };
    }

    // ---------- Results ----------

    var PROPS = [
        { label: 'Dry bulb',        unit: '°F',      get: function (s) { return fmt(s.db, 1); } },
        { label: 'Wet bulb',        unit: '°F',      get: function (s) { return fmt(s.wb, 1); } },
        { label: 'Dew point',       unit: '°F',      get: function (s) { return fmt(s.dp, 1); } },
        { label: 'Rel. humidity',   unit: '%',            get: function (s) { return fmt(s.rh * 100, 1); } },
        { label: 'Humidity ratio',  unit: 'gr/lb',        get: function (s) { return fmt(s.grains, 1); } },
        { label: 'Humidity ratio',  unit: 'lb/lb',        get: function (s) { return s.w.toFixed(5); } },
        { label: 'Enthalpy',        unit: 'Btu/lb',       get: function (s) { return fmt(s.h, 2); } },
        { label: 'Sp. volume',      unit: 'ft³/lb',  get: function (s) { return fmt(s.v, 3); } },
        { label: 'Density',         unit: 'lb/ft³',  get: function (s) { return fmt(s.density, 4); } },
        { label: 'Vapor pressure',  unit: 'psia',         get: function (s) { return fmt(s.pv, 4); } }
    ];

    function sectionTitle(text) {
        var h = document.createElement('h2');
        h.className = 'psy-section-title';
        h.textContent = text;
        return h;
    }

    function hint(text) {
        var p = document.createElement('p');
        p.className = 'psy-hint';
        p.textContent = text;
        return p;
    }

    function renderResults(result, P) {
        var box = refs.results;
        box.innerHTML = '';

        if (!result.columns.length) {
            box.appendChild(hint('Enter a valid air state to see its properties.'));
            return;
        }

        if (result.kind !== 'mix') {
            box.appendChild(sectionTitle('Properties'));
            box.appendChild(buildPropTable(result.columns));
            return;
        }

        // Mixed Air: airflow/mixing summary and the loads lead; the full
        // property table follows.
        var m = result.mixed;
        if (m) {
            box.appendChild(sectionTitle(m.single ? 'Airflow' : 'Mixing'));
            var rows = [['Total airflow', fmt(m.cfm, 0) + ' CFM']];
            if (!m.single) {
                rows.push(['Outdoor air (by volume)', fmt(m.oaPctVolume, 1) + ' %']);
                rows.push(['Outdoor air (by mass)', fmt(m.oaPctMass, 1) + ' %']);
            }
            rows.push(['Dry-air mass flow', fmt(m.massFlow, 0) + ' lb/hr' +
                (state.mix.basis === 'actual' ? ' (actual air)' : ' (standard air)')]);
            if (m.state.fogged) rows.push(['Note', 'Mixture lands in the fog region; saturated state shown.']);
            box.appendChild(buildKvList(rows));
        }

        if (result.coil) {
            var c = result.coil;
            var cooling = c.total >= 0;
            box.appendChild(sectionTitle((cooling ? 'Cooling coil load' : 'Heating load') +
                ' (' + result.enteringLabel + ' → SA)'));
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
            if (!cooling) {
                box.appendChild(hint('Coil leaving air is warmer than the entering air, so the process adds heat to the air stream.'));
            }
        } else if (result.sa && !result.entering) {
            box.appendChild(hint('Coil load needs an included air stream with its airflow.'));
        }

        if (result.reheat) {
            var r = result.reheat, n = result.net;
            box.appendChild(sectionTitle('Hot gas reheat (SA → RH)'));
            var rrows = [
                ['Reheat added (sensible)', fmt(-r.total, 0) + ' Btu/h']
            ];
            if (n) {
                rrows.push(['Net total (' + result.enteringLabel + ' → RH)', fmt(n.total, 0) + ' Btu/h' +
                    (n.total >= 0 ? '  (' + fmt(n.tons, 2) + ' tons)' : '')]);
                rrows.push(['Net sensible (' + result.enteringLabel + ' → RH)', fmt(n.sensible, 0) + ' Btu/h']);
            }
            box.appendChild(buildKvList(rrows));
        }

        box.appendChild(sectionTitle('Air properties'));
        box.appendChild(buildPropTable(result.columns));
    }

    function buildPropTable(columns) {
        var wrap = document.createElement('div');
        wrap.className = 'psy-table-wrap';
        var table = document.createElement('table');
        table.className = 'psy-table psy-table-cols-' + columns.length;

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
