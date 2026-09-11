/* ============================================================
   HHpro - Psychrometric calculator view
   ------------------------------------------------------------
   Two tools on one page, sharing a chart:

     Air Handler (default) - an ordered chain of stages, each with
       an Include toggle: outdoor air, energy recovery, return air,
       mixing, preheat, fan (blow-through), cooling coil (leaving
       condition or ADP + bypass factor), fan (draw-through),
       reheat, humidifier (steam / evaporative), evaporative
       cooler. Plus the room side (space condition + loads -> SHR
       line and required supply), an economizer check, condensate
       and drain size. Every stage plots as an arrow and reports
       its load.

     State Points - any number of air states (dry bulb plus one
       other property) with every property read back.

   Everything is calculated in IP (psychro_core.js); the IP/SI
   toggle converts at the screen edge (psychro_units.js). Inputs
   live in memory only - a page reload starts from the defaults
   (Eric's choice, so a shared screen never opens on someone
   else's numbers). "Save to project" stores a snapshot in the
   active project's extra data (cart.js) which the View Project
   page lists and exports as PDF (psychro_pdf.js).

   Public surface for other modules:
     HHpro.Psychrometrics.pdfBlob(snapshot, meta) -> Blob
     HHpro.Psychrometrics.summarize(snapshot)     -> string
     HHpro.Psychrometrics.listSaved()             -> [{id, name, savedAt, snapshot}]
     HHpro.Psychrometrics.deleteSaved(id)
   Opening a saved calculation: HHpro.App.showView('psychrometrics', { calcId })
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    var STORAGE_KEY = 'hhpro.psychro';
    var CALC_EXTRA_KEY = 'calculations';
    var MAX_POINTS = 8;
    var POINT_COLOR_COUNT = 6;

    var RANGE_OPTIONS = [
        { dbMin: 20,  label: '20 to 120 (standard)' },
        { dbMin: 0,   label: '0 to 120' },
        { dbMin: -20, label: '-20 to 120 (cold climate)' }
    ];

    var Psy, U, Chart;

    // -----------------------------------------------------------------
    // Persistent state
    // -----------------------------------------------------------------

    function defaults() {
        return {
            units: 'IP',
            altitude: 0,
            mode: 'ahu',                                     // 'ahu' | 'points'
            dbMin: 20,
            view: null,                                      // zoomed viewport or null = default
            show: { rh: true, wb: true, h: true, v: false },
            points: [
                { label: 'Point 1', db: 75, key: 'rh', value: 50 }
            ],
            ahu: {
                oa:  { enabled: true, db: 95, key: 'wb', value: 78 },
                erv: { enabled: false, effS: 70, effL: 60 },
                ra:  { enabled: true, db: 75, key: 'rh', value: 50 },
                flowMode: 'each', basis: 'std',
                oaCfm: 2000, raCfm: 8000, totalCfm: 10000, oaPct: 20,
                econ: { enabled: false, mode: 'enthalpy', limitDb: 65 },
                preheat: { enabled: false, db: 55 },
                coil: { enabled: true, mode: 'leaving', db: 55, key: 'rh', value: 95, adp: 50, bf: 10 },
                fan: { enabled: false, mode: 'bhp', bhp: 5, motorIn: true, motorEff: 90, dt: 1.5 },
                reheat: { enabled: false, db: 65 },
                hum: { enabled: false, type: 'steam', key: 'rh', value: 40, eff: 85 },
                room: { enabled: false, db: 75, key: 'rh', value: 50, qs: 120000, ql: 30000,
                        solve: 'db', cfm: null, dbSupply: 55 }
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

    function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

    // Earlier versions stored a `mix` block; fold it into `ahu`.
    function migrate(parsed) {
        if (parsed && parsed.mix && !parsed.ahu) {
            var m = parsed.mix;
            parsed.ahu = {
                oa: { enabled: m.oaEnabled !== false, db: m.oa && m.oa.db, key: m.oa && m.oa.key, value: m.oa && m.oa.value },
                ra: { enabled: m.raEnabled !== false, db: m.ra && m.ra.db, key: m.ra && m.ra.key, value: m.ra && m.ra.value },
                flowMode: m.flowMode, basis: m.basis,
                oaCfm: m.oaCfm, raCfm: m.raCfm, totalCfm: m.totalCfm, oaPct: m.oaPct,
                coil: { enabled: m.saEnabled !== false, mode: 'leaving', db: m.sa && m.sa.db, key: m.sa && m.sa.key, value: m.sa && m.sa.value },
                reheat: { enabled: !!m.rhEnabled, db: m.rhDb }
            };
            delete parsed.mix;
        }
        if (parsed && parsed.mode === 'mix') parsed.mode = 'ahu';
        if (parsed && parsed.ahu && !parsed.ahu.fan) {
            var f = (parsed.ahu.fan2 && parsed.ahu.fan2.enabled) ? parsed.ahu.fan2 : parsed.ahu.fan1;
            if (f) parsed.ahu.fan = f;
        }
        return parsed;
    }

    function fromSnapshot(snap) {
        var d = defaults();
        try {
            var parsed = migrate(deepClone(snap || {}));
            var pts = Array.isArray(parsed.points) && parsed.points.length ? parsed.points : d.points;
            var view = parsed.view;
            extend(d, parsed);
            d.points = pts.slice(0, MAX_POINTS);
            d.view = (view && isFinite(view.dbMin)) ? view : null;
        } catch (e) { /* use defaults */ }
        return d;
    }

    // A page reload always starts from the defaults. State survives
    // navigating between views within the app (module memory only).
    function load() {
        try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
        return defaults();
    }

    function save() { /* intentionally not persisted */ }

    var state = null;
    var refs = {};
    var fieldErrorEls = {};

    function init() {
        Psy = HHpro.Psychro; U = HHpro.PsychroUnits; Chart = HHpro.PsychroChart;
        if (!state) state = load();
    }

    HHpro.Calculators.register({
        key: 'psychrometrics',
        name: 'Psychrometrics',
        description: 'Air handler chain (mixing, coils, fan, reheat, humidifier), room loads, economizer and condensate on a psychrometric chart.',
        icon: 'thermometer',
        view: 'psychrometrics'
    });

    // -----------------------------------------------------------------
    // View
    // -----------------------------------------------------------------

    HHpro.Views.psychrometrics = {
        render: function (root, params) {
            init();
            if (params && params.calcId) {
                var saved = findSaved(params.calcId);
                if (saved) { state = fromSnapshot(saved.snapshot); save(); }
            }
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
        sub.textContent = 'Build the air handler stage by stage (mixing, coils, fan, reheat, humidifier), ' +
            'check it against the room load, and read every state off the chart.';
        intro.appendChild(title);
        intro.appendChild(sub);
        bar.appendChild(intro);
        return bar;
    }

    // -----------------------------------------------------------------
    // Units + number helpers
    // -----------------------------------------------------------------

    function sys() { return state.units === 'SI' ? 'SI' : 'IP'; }

    function fmt(n, d) {
        if (n === null || n === undefined || !isFinite(n)) return '—';
        return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }

    // Value in the display system with its unit, from an IP value.
    function fmtU(kind, ipValue, dec) {
        var s = sys();
        var d = dec !== undefined ? dec : U.decimals(kind, s);
        return fmt(U.toDisp(kind, ipValue, s), d) + ' ' + U.unit(kind, s);
    }

    function fmtPower(btuh, withTons) {
        var s = sys();
        if (s === 'SI') return fmt(U.toDisp('power', btuh, s), 2) + ' kW';
        return fmt(btuh, 0) + ' Btu/h' + (withTons ? '  (' + fmt(btuh / 12000, 2) + ' tons)' : '');
    }

    function fmtH(st) {
        var s = sys();
        return fmt(U.enthalpyDisp(st, s), 2) + ' ' + U.unit('h', s);
    }

    function toNum(v, fallback) {
        var n = parseFloat(v);
        return isFinite(n) ? n : fallback;
    }

    function inputDisp(kind, ipValue) {
        if (ipValue === null || ipValue === undefined || !isFinite(ipValue)) return '';
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
    // Left panel
    // -----------------------------------------------------------------

    function buildPanel() {
        var panel = document.createElement('aside');
        panel.className = 'psy-panel';

        panel.appendChild(buildSettingsStrip());

        var tabs = document.createElement('div');
        tabs.className = 'psy-tabs';
        tabs.setAttribute('role', 'tablist');
        [['ahu', 'Air Handler'], ['points', 'State Points']].forEach(function (t) {
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

    // Altitude, unit system, save / export.
    function buildSettingsStrip() {
        var strip = document.createElement('div');
        strip.className = 'psy-settings';

        var altRow = document.createElement('div');
        altRow.className = 'psy-altitude';
        var label = document.createElement('label');
        label.className = 'psy-field-label';
        label.textContent = 'Altitude';
        label.htmlFor = 'psy-altitude-input';
        altRow.appendChild(label);
        var input = numberInput(inputDisp('altitude', state.altitude), { step: sys() === 'SI' ? 50 : 100, cls: 'psy-input psy-input-alt' });
        input.id = 'psy-altitude-input';
        input.addEventListener('input', function () {
            state.altitude = U.fromDisp('altitude', toNum(input.value, 0), sys());
            save();
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

        // Unit system segmented control
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
                save();
                HHpro.App.showView('psychrometrics');
            });
            seg.appendChild(b);
        });
        altRow.appendChild(seg);
        strip.appendChild(altRow);

        var actions = document.createElement('div');
        actions.className = 'psy-actions-bar';
        var saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'projects-btn projects-btn-secondary psy-small-btn';
        saveBtn.appendChild(HHpro.UI.icon('folder'));
        var saveLbl = document.createElement('span');
        saveLbl.textContent = 'Save to project';
        saveBtn.appendChild(saveLbl);
        saveBtn.addEventListener('click', function () { beginSave(actions); });
        actions.appendChild(saveBtn);

        var pdfBtn = document.createElement('button');
        pdfBtn.type = 'button';
        pdfBtn.className = 'projects-btn projects-btn-secondary psy-small-btn';
        pdfBtn.appendChild(HHpro.UI.icon('download'));
        var pdfLbl = document.createElement('span');
        pdfLbl.textContent = 'Export PDF';
        pdfBtn.appendChild(pdfLbl);
        pdfBtn.addEventListener('click', function () {
            var active = HHpro.Cart.getActiveState();
            var name = (active && active.name) || '';
            var blob = pdfBlob(deepClone(state), { projectName: name, title: defaultCalcName() });
            triggerDownload(blob, (name ? name + ' - ' : '') + 'Psychrometrics - ' + dateStamp() + '.pdf');
        });
        actions.appendChild(pdfBtn);

        var status = document.createElement('span');
        status.className = 'psy-save-status';
        actions.appendChild(status);
        refs.saveStatus = status;
        strip.appendChild(actions);

        return strip;
    }

    function buildForm() {
        var form = refs.form;
        form.innerHTML = '';
        fieldErrorEls = {};
        if (state.mode === 'points') buildPointsForm(form);
        else buildAhuForm(form);
    }

    // ---------- State Points form ----------

    function buildPointsForm(form) {
        var section = document.createElement('div');
        section.className = 'psy-section';
        section.appendChild(sectionTitle('Air states'));
        section.appendChild(hint('Dry bulb plus any one other property defines a point.'));

        var list = document.createElement('div');
        list.className = 'psy-point-list';
        section.appendChild(list);
        refs.pointList = list;
        state.points.forEach(function (pt, i) { list.appendChild(buildPointRow(pt, i)); });

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
            var last = state.points[state.points.length - 1];
            state.points.push({
                label: 'Point ' + (state.points.length + 1),
                db: last ? last.db : 75, key: last ? last.key : 'rh', value: last ? last.value : 50
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
        name.addEventListener('input', function () { pt.label = name.value; save(); recompute(); });
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
            save(); buildForm(); recompute();
        });
        head.appendChild(remove);
        row.appendChild(head);
        row.appendChild(buildStateFields(pt, 'p' + index));
        return row;
    }

    // ---------- Air Handler form ----------

    function buildAhuForm(form) {
        var a = state.ahu;

        // Outdoor air
        form.appendChild(stageSection('oa', 'Outdoor air', a.oa, function (sec, body) {
            body.appendChild(buildStateFields(a.oa, 'oa'));
        }, function () { renderFlowFields(); }));

        // Energy recovery
        form.appendChild(stageSection('er', 'Energy recovery on outdoor air', a.erv, function (sec, body) {
            body.appendChild(hint('Wheel or plate exchanger between outdoor and exhaust (return) air. The outdoor air leaving it plots as ER.'));
            var g = fields();
            g.appendChild(numberField('Sensible eff.', 'pct', a.erv.effS, { min: 0, max: 100, step: 1 }, function (v) { a.erv.effS = v; }));
            g.appendChild(numberField('Latent eff.', 'pct', a.erv.effL, { min: 0, max: 100, step: 1 }, function (v) { a.erv.effL = v; }));
            body.appendChild(g);
            body.appendChild(errorLine('erv'));
        }));

        // Return air
        form.appendChild(stageSection('ra', 'Return air', a.ra, function (sec, body) {
            body.appendChild(buildStateFields(a.ra, 'ra'));
        }, function () { renderFlowFields(); }));

        // Airflow
        var flow = document.createElement('div');
        flow.className = 'psy-section';
        flow.appendChild(sectionTitle('Airflow'));
        var flowFields = document.createElement('div');
        flowFields.className = 'psy-flow-fields';
        flow.appendChild(flowFields);
        refs.flowFields = flowFields;
        renderFlowFields();
        var basisRow = document.createElement('div');
        basisRow.className = 'psy-radio-row';
        basisRow.appendChild(inlineLabel('Load basis:'));
        [['std', 'Standard air (' + (sys() === 'SI' ? '1.2 kg/m³' : '0.075 lb/ft³') + ')'], ['actual', 'Actual air at each stream']].forEach(function (m) {
            basisRow.appendChild(radio('psy-basis', m[0], m[1], a.basis === m[0], function () { a.basis = m[0]; save(); recompute(); }));
        });
        flow.appendChild(basisRow);
        flow.appendChild(hint('Standard air is the CFM × 4.5 convention used by coil selection software and the 1.08 / 4.5 rules of thumb, independent of altitude.'));
        flow.appendChild(errorLine('flow'));
        form.appendChild(flow);

        // Economizer check
        form.appendChild(stageSection('econ', 'Economizer check', a.econ, function (sec, body) {
            body.appendChild(hint('Compares outdoor to return air and a fixed high limit; reports whether free cooling applies.'));
            var r = document.createElement('div');
            r.className = 'psy-radio-row';
            r.appendChild(inlineLabel('Changeover:'));
            [['enthalpy', 'Differential enthalpy'], ['db', 'Differential dry bulb']].forEach(function (m) {
                r.appendChild(radio('psy-econ-mode', m[0], m[1], a.econ.mode === m[0], function () { a.econ.mode = m[0]; save(); recompute(); }));
            });
            body.appendChild(r);
            var g = fields();
            g.appendChild(numberField('High limit', 'temp', a.econ.limitDb, { step: 0.5 }, function (v) { a.econ.limitDb = v; }));
            body.appendChild(g);
        }));

        // Preheat
        form.appendChild(stageSection('ph', 'Preheat coil', a.preheat, function (sec, body) {
            var g = fields();
            g.appendChild(numberField('Leaving dry bulb', 'temp', a.preheat.db, { step: 0.5 }, function (v) { a.preheat.db = v; }));
            body.appendChild(g);
            body.appendChild(errorLine('preheat'));
        }));

        // Cooling coil
        form.appendChild(stageSection('sa', 'Cooling coil leaving air', a.coil, function (sec, body) {
            var r = document.createElement('div');
            r.className = 'psy-radio-row';
            r.appendChild(inlineLabel('Define by:'));
            [['leaving', 'Leaving condition'], ['adp', 'ADP + bypass factor']].forEach(function (m) {
                r.appendChild(radio('psy-coil-mode', m[0], m[1], a.coil.mode === m[0], function () {
                    a.coil.mode = m[0]; save(); buildForm(); recompute();
                }));
            });
            body.appendChild(r);
            if (a.coil.mode === 'adp') {
                var g = fields();
                g.appendChild(numberField('Apparatus dew point', 'temp', a.coil.adp, { step: 0.5 }, function (v) { a.coil.adp = v; }));
                g.appendChild(numberField('Bypass factor', 'pct', a.coil.bf, { min: 0, max: 99, step: 1 }, function (v) { a.coil.bf = v; }));
                body.appendChild(g);
                body.appendChild(errorLine('coil'));
                body.appendChild(hint('Leaving state is the point on the entering → ADP line a bypass-factor fraction back from the ADP.'));
            } else {
                body.appendChild(buildStateFields(a.coil, 'coil'));
                body.appendChild(hint('The ADP and bypass factor implied by this leaving condition are reported below.'));
            }
        }));

        // Supply fan (draw-through: after the coil, before reheat)
        form.appendChild(stageSection('sf', 'Supply fan heat (draw-through)', a.fan, function (sec, body) {
            body.appendChild(hint('Fan and motor heat picked up after the coil, before any reheat.'));
            buildFanFields(body, a.fan, 'fan');
        }));

        // Reheat
        form.appendChild(stageSection('rh', 'Reheat', a.reheat, function (sec, body) {
            body.appendChild(hint('Hot gas, electric or hydronic reheat: humidity ratio is held, only dry bulb rises.'));
            var g = fields();
            g.appendChild(numberField('Leaving dry bulb', 'temp', a.reheat.db, { step: 0.5 }, function (v) { a.reheat.db = v; }));
            body.appendChild(g);
            body.appendChild(errorLine('reheat'));
        }));

        // Humidifier
        form.appendChild(stageSection('hu', 'Humidifier', a.hum, function (sec, body) {
            var r = document.createElement('div');
            r.className = 'psy-radio-row';
            r.appendChild(inlineLabel('Type:'));
            [['steam', 'Steam (constant dry bulb)'], ['evap', 'Evaporative (constant wet bulb)']].forEach(function (m) {
                r.appendChild(radio('psy-hum-type', m[0], m[1], a.hum.type === m[0], function () {
                    a.hum.type = m[0]; save(); buildForm(); recompute();
                }));
            });
            body.appendChild(r);
            var g = fields();
            if (a.hum.type === 'evap') {
                g.appendChild(numberField('Effectiveness', 'pct', a.hum.eff, { min: 0, max: 100, step: 1 }, function (v) { a.hum.eff = v; }));
            } else {
                g.appendChild(buildSecondProperty(a.hum, 'Target', ['rh', 'dp', 'w']));
            }
            body.appendChild(g);
            body.appendChild(errorLine('hum'));
        }));

        // Room
        form.appendChild(stageSection('rm', 'Room', a.room, function (sec, body) {
            body.appendChild(hint('Space condition and loads draw the room sensible-heat-ratio line and size the supply air.'));
            body.appendChild(buildStateFields(a.room, 'room'));
            var g = fields();
            g.appendChild(numberField('Sensible load', 'power', a.room.qs, { min: 0, step: sys() === 'SI' ? 0.5 : 1000 }, function (v) { a.room.qs = v; }));
            g.appendChild(numberField('Latent load', 'power', a.room.ql, { min: 0, step: sys() === 'SI' ? 0.5 : 1000 }, function (v) { a.room.ql = v; }));
            body.appendChild(g);
            var r = document.createElement('div');
            r.className = 'psy-radio-row';
            r.appendChild(inlineLabel('Solve for:'));
            [['db', 'Supply temperature from airflow'], ['cfm', 'Airflow from supply temperature']].forEach(function (m) {
                r.appendChild(radio('psy-room-solve', m[0], m[1], a.room.solve === m[0], function () {
                    a.room.solve = m[0]; save(); buildForm(); recompute();
                }));
            });
            body.appendChild(r);
            var g2 = fields();
            if (a.room.solve === 'cfm') {
                g2.appendChild(numberField('Supply dry bulb', 'temp', a.room.dbSupply, { step: 0.5 }, function (v) { a.room.dbSupply = v; }));
            } else {
                var f = numberField('Supply airflow', 'flow', a.room.cfm, { min: 0, step: 50 }, function (v) { a.room.cfm = v; });
                f.querySelector('input').placeholder = 'system';
                g2.appendChild(f);
            }
            body.appendChild(g2);
            body.appendChild(errorLine('room'));
        }));
    }

    function buildFanFields(body, fan, errId) {
        var r = document.createElement('div');
        r.className = 'psy-radio-row';
        r.appendChild(inlineLabel('Heat from:'));
        [['bhp', 'Brake horsepower'], ['dt', 'Temperature rise']].forEach(function (m) {
            r.appendChild(radio('psy-' + errId + '-mode', m[0], m[1], fan.mode === m[0], function () {
                fan.mode = m[0]; save(); buildForm(); recompute();
            }));
        });
        body.appendChild(r);
        var g = fields();
        if (fan.mode === 'dt') {
            g.appendChild(numberField('Temperature rise', 'dtemp', fan.dt, { min: 0, step: 0.1 }, function (v) { fan.dt = v; }));
        } else {
            g.appendChild(numberField('Fan power', 'hp', fan.bhp, { min: 0, step: 0.25 }, function (v) { fan.bhp = v; }));
            var lbl = document.createElement('label');
            lbl.className = 'psy-check';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!fan.motorIn;
            cb.addEventListener('change', function () { fan.motorIn = cb.checked; save(); buildForm(); recompute(); });
            var sp = document.createElement('span');
            sp.textContent = 'Motor in airstream';
            lbl.appendChild(cb); lbl.appendChild(sp);
            g.appendChild(lbl);
            if (fan.motorIn) {
                g.appendChild(numberField('Motor eff.', 'pct', fan.motorEff, { min: 1, max: 100, step: 1 }, function (v) { fan.motorEff = v; }));
            }
        }
        body.appendChild(g);
        body.appendChild(errorLine(errId));
    }

    // A chain stage: swatch + title + Include toggle; body greys out when off.
    function stageSection(pointId, titleText, obj, buildBody, onToggle) {
        var sec = document.createElement('div');
        sec.className = 'psy-section psy-stage psy-point-' + pointId;
        var head = document.createElement('div');
        head.className = 'psy-section-head';
        var swatch = document.createElement('span');
        swatch.className = 'psy-swatch';
        head.appendChild(swatch);
        var h = document.createElement('h2');
        h.className = 'psy-section-title';
        h.textContent = titleText;
        head.appendChild(h);
        var toggle = document.createElement('label');
        toggle.className = 'psy-check';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = !!obj.enabled;
        var cbText = document.createElement('span');
        cbText.textContent = 'Include';
        toggle.appendChild(cb);
        toggle.appendChild(cbText);
        head.appendChild(toggle);
        sec.appendChild(head);

        var body = document.createElement('div');
        body.className = 'psy-stage-body';
        buildBody(sec, body);
        sec.appendChild(body);

        function apply() {
            body.classList.toggle('is-disabled', !obj.enabled);
            sec.classList.toggle('is-off', !obj.enabled);
            setFieldsDisabled(body, !obj.enabled);
        }
        cb.addEventListener('change', function () {
            obj.enabled = cb.checked;
            apply();
            save();
            if (onToggle) onToggle();
            recompute();
        });
        apply();
        return sec;
    }

    function renderFlowFields() {
        var a = state.ahu;
        var wrap = refs.flowFields;
        if (!wrap) return;
        wrap.innerHTML = '';
        var both = a.oa.enabled && a.ra.enabled;
        var g = fields();
        if (both) {
            var modes = document.createElement('div');
            modes.className = 'psy-radio-row';
            [['each', 'Per stream'], ['pct', 'Total + % outdoor air']].forEach(function (m) {
                modes.appendChild(radio('psy-flow-mode', m[0], m[1], a.flowMode === m[0], function () {
                    a.flowMode = m[0]; save(); renderFlowFields(); recompute();
                }));
            });
            wrap.appendChild(modes);
            if (a.flowMode === 'pct') {
                g.appendChild(numberField('Total airflow', 'flow', a.totalCfm, { min: 0, step: 50 }, function (v) { a.totalCfm = v; }));
                g.appendChild(numberField('Outdoor air', 'pct', a.oaPct, { min: 0, max: 100, step: 1 }, function (v) { a.oaPct = v; }));
            } else {
                g.appendChild(numberField('Outdoor air', 'flow', a.oaCfm, { min: 0, step: 50 }, function (v) { a.oaCfm = v; }));
                g.appendChild(numberField('Return air', 'flow', a.raCfm, { min: 0, step: 50 }, function (v) { a.raCfm = v; }));
            }
        } else if (a.oa.enabled) {
            g.appendChild(numberField('Outdoor air', 'flow', a.oaCfm, { min: 0, step: 50 }, function (v) { a.oaCfm = v; }));
        } else if (a.ra.enabled) {
            g.appendChild(numberField('Return air', 'flow', a.raCfm, { min: 0, step: 50 }, function (v) { a.raCfm = v; }));
        } else {
            g.appendChild(hint('Include at least one air stream above.'));
        }
        wrap.appendChild(g);
    }

    // ---------- Shared field builders ----------

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

    function inlineLabel(text) {
        var s = document.createElement('span');
        s.className = 'psy-inline-label';
        s.textContent = text;
        return s;
    }

    function fields() {
        var g = document.createElement('div');
        g.className = 'psy-fields';
        return g;
    }

    function errorLine(id) {
        var p = document.createElement('p');
        p.className = 'psy-field-error';
        fieldErrorEls[id] = p;
        return p;
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

    // [label] [input in display units] [unit]; onChange receives IP.
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
            save();
            recompute();
        });
        wrap.appendChild(input);
        var u = document.createElement('span');
        u.className = 'psy-unit';
        u.textContent = U.unit(kind, sys());
        wrap.appendChild(u);
        return wrap;
    }

    // Second-property value <-> IP storage, honouring the enthalpy
    // reference difference in SI.
    function secondDisp(obj) {
        if (obj.value === null || obj.value === undefined) return '';
        if (obj.key === 'h' && sys() === 'SI') {
            try {
                var st = Psy.state(obj.db, 'h', obj.value, Psy.pressureFromAltitude(state.altitude));
                return String(Number(U.enthalpyDisp(st, 'SI').toFixed(2)));
            } catch (e) { return ''; }
        }
        return inputDisp(kindForKey(obj.key), obj.value);
    }

    function secondFromDisp(obj, disp) {
        if (disp === null) return null;
        if (obj.key === 'h' && sys() === 'SI') {
            var w = U.humRatioFromEnthalpy(disp, Number(obj.db) || 0, 'SI');
            return Psy.enthalpy(Number(obj.db) || 0, Math.max(0, w));
        }
        return U.fromDisp(kindForKey(obj.key), disp, sys());
    }

    // Property selector + value for `obj` ({key, value}); optional key subset.
    function buildSecondProperty(obj, labelText, allowedKeys) {
        var second = document.createElement('div');
        second.className = 'psy-field';
        if (labelText) {
            var l = document.createElement('span');
            l.className = 'psy-field-label';
            l.textContent = labelText;
            second.appendChild(l);
        }
        var select = document.createElement('select');
        select.className = 'filter-select psy-select';
        select.setAttribute('aria-label', 'Property');
        Psy.INPUT_KEYS.forEach(function (k) {
            if (allowedKeys && allowedKeys.indexOf(k.key) < 0) return;
            var opt = document.createElement('option');
            opt.value = k.key;
            opt.textContent = k.label;
            if (k.key === obj.key) opt.selected = true;
            select.appendChild(opt);
        });
        if (allowedKeys && allowedKeys.indexOf(obj.key) < 0) { obj.key = allowedKeys[0]; select.value = obj.key; }
        second.appendChild(select);
        var input = numberInput(secondDisp(obj), { step: 0.5 });
        input.setAttribute('aria-label', 'Property value');
        second.appendChild(input);
        var unit = document.createElement('span');
        unit.className = 'psy-unit';
        unit.textContent = U.unit(kindForKey(obj.key), sys());
        second.appendChild(unit);
        select.addEventListener('change', function () {
            obj.key = select.value;
            unit.textContent = U.unit(kindForKey(obj.key), sys());
            obj.value = input.value === '' ? null : secondFromDisp(obj, toNum(input.value, null));
            save(); recompute();
        });
        input.addEventListener('input', function () {
            obj.value = input.value === '' ? null : secondFromDisp(obj, toNum(input.value, null));
            save(); recompute();
        });
        return second;
    }

    // Dry bulb + (property selector, value) for one air state.
    function buildStateFields(obj, id) {
        var wrap = document.createElement('div');
        wrap.className = 'psy-state-fields';
        var grid = fields();
        grid.appendChild(numberField('Dry bulb', 'temp', obj.db, { step: 0.5 }, function (v) { obj.db = v; }));
        grid.appendChild(buildSecondProperty(obj, null, null));
        wrap.appendChild(grid);
        wrap.appendChild(errorLine(id));
        return wrap;
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
        legend.textContent = 'Lines:';
        toolbar.appendChild(legend);
        [['rh', 'RH'], ['wb', 'Wet bulb'], ['h', 'Enthalpy'], ['v', 'Sp. volume']].forEach(function (t) {
            var lbl = document.createElement('label');
            lbl.className = 'psy-check';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!state.show[t[0]];
            cb.addEventListener('change', function () { state.show[t[0]] = cb.checked; save(); recompute(); });
            var span = document.createElement('span');
            span.textContent = t[1];
            lbl.appendChild(cb); lbl.appendChild(span);
            toolbar.appendChild(lbl);
        });

        // Range + zoom controls
        var ctrl = document.createElement('div');
        ctrl.className = 'psy-chart-controls';
        var rangeWrap = document.createElement('label');
        rangeWrap.className = 'psy-field';
        rangeWrap.appendChild(inlineLabel('Range:'));
        var rangeSel = document.createElement('select');
        rangeSel.className = 'filter-select psy-select psy-range-select';
        RANGE_OPTIONS.forEach(function (o) {
            var opt = document.createElement('option');
            opt.value = String(o.dbMin);
            opt.textContent = sys() === 'SI'
                ? Math.round((o.dbMin - 32) / 1.8) + ' to 49 °C' + (o.dbMin === 20 ? ' (standard)' : (o.dbMin === -20 ? ' (cold)' : ''))
                : o.label + ' °F';
            if (o.dbMin === state.dbMin) opt.selected = true;
            rangeSel.appendChild(opt);
        });
        rangeSel.addEventListener('change', function () {
            state.dbMin = toNum(rangeSel.value, 20);
            state.view = null;
            save(); recompute();
        });
        rangeWrap.appendChild(rangeSel);
        ctrl.appendChild(rangeWrap);

        function zoomBtn(label, title, fn) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'psy-zoom-btn';
            b.title = title;
            b.setAttribute('aria-label', title);
            b.textContent = label;
            b.addEventListener('click', function () { fn(); save(); recompute(); });
            return b;
        }
        var mouseHint = document.createElement('span');
        mouseHint.className = 'psy-toolbar-label psy-mouse-hint';
        mouseHint.textContent = 'Wheel to zoom · drag to pan';
        ctrl.appendChild(mouseHint);
        var group = document.createElement('div');
        group.className = 'psy-zoom-group';
        group.appendChild(zoomBtn('Fit', 'Zoom to the plotted points', function () {
            var sts = (refs.lastResult ? refs.lastResult.points : []).map(function (p) { return p.state; });
            state.view = Chart.fit(currentViewport(), sts);
        }));
        group.appendChild(zoomBtn('Reset', 'Back to the full chart', function () { state.view = null; }));
        ctrl.appendChild(group);
        toolbar.appendChild(ctrl);
        area.appendChild(toolbar);

        var wrap = document.createElement('div');
        wrap.className = 'psy-chart-wrap';
        area.appendChild(wrap);
        refs.chart = Chart.create(wrap);

        var readout = document.createElement('div');
        readout.className = 'psy-readout';
        area.appendChild(readout);
        refs.readout = readout;
        showReadout(null);
        refs.chart.onHover(showReadout);
        // Wheel / drag updates arrive faster than a full redraw is worth;
        // coalesce them to one redraw every ~30 ms.
        var pendingView = null;
        refs.chart.onViewportChange(function (vp) {
            pendingView = vp;
            if (refs.viewTimer) return;
            refs.viewTimer = setTimeout(function () {
                refs.viewTimer = null;
                state.view = pendingView;
                recompute();
            }, 30);
        });
        return area;
    }

    function currentViewport() {
        return state.view || Chart.defaultViewport(state.dbMin);
    }

    function showReadout(st) {
        var r = refs.readout;
        if (!r) return;
        r.innerHTML = '';
        if (!st) {
            var h = document.createElement('span');
            h.className = 'psy-readout-hint';
            h.textContent = 'Move the pointer over the chart to read the air state at that spot.';
            r.appendChild(h);
            return;
        }
        [
            ['DB', fmtU('temp', st.db)], ['WB', fmtU('temp', st.wb)], ['DP', fmtU('temp', st.dp)],
            ['RH', fmt(st.rh * 100, 1) + ' %'], ['W', fmtU('grains', st.grains)],
            ['h', fmtH(st)], ['v', fmtU('v', st.v)]
        ].forEach(function (pair) {
            var item = document.createElement('span');
            item.className = 'psy-readout-item';
            var k = document.createElement('span');
            k.className = 'psy-readout-key';
            k.textContent = pair[0];
            var v = document.createElement('span');
            v.className = 'psy-readout-val';
            v.textContent = pair[1];
            item.appendChild(k); item.appendChild(v);
            r.appendChild(item);
        });
    }

    // -----------------------------------------------------------------
    // Evaluation (pure: takes a state snapshot, reports errors by id)
    // -----------------------------------------------------------------

    function evaluate(s, onError) {
        var P = Psy.pressureFromAltitude(s.altitude);
        var res = s.mode === 'points' ? evalPoints(s, P, onError) : evalAhu(s, P, onError);
        res.pressure = P;
        return res;
    }

    function tryState(obj, id, P, onError) {
        try {
            return Psy.state(obj.db, obj.key, obj.value, P);
        } catch (e) {
            onError(id, e.message);
            return null;
        }
    }

    function evalPoints(s, P, onError) {
        var points = [];
        s.points.forEach(function (pt, i) {
            var st = tryState(pt, 'p' + i, P, onError);
            var label = (pt.label || '').trim() || ('Point ' + (i + 1));
            if (!st) return;
            points.push({ id: 'p' + i, label: label, state: st, cls: 'psy-point-c' + (i % POINT_COLOR_COUNT), title: label });
        });
        return { kind: 'points', points: points, lines: [], paths: [], stages: [], tablePoints: points };
    }

    function evalAhu(s, P, onError) {
        var a = s.ahu;
        var points = [], lines = [], paths = [], stages = [];
        var basis = a.basis === 'actual' ? 'actual' : 'std';
        var res = { kind: 'ahu', points: points, lines: lines, paths: paths, stages: stages };

        function addPoint(id, label, st, title) {
            points.push({ id: id, label: label, state: st, cls: 'psy-point-' + id, title: title || label });
        }

        var oa = a.oa.enabled ? tryState(a.oa, 'oa', P, onError) : null;
        var ra = a.ra.enabled ? tryState(a.ra, 'ra', P, onError) : null;
        if (oa) addPoint('oa', 'OA', oa, 'Outdoor air');
        if (ra) addPoint('ra', 'RA', ra, 'Return air');

        // Airflow per stream
        var oaCfm = null, raCfm = null;
        var both = a.oa.enabled && a.ra.enabled;
        if (both) {
            if (a.flowMode === 'pct') {
                var total = toNum(a.totalCfm, null), pct = toNum(a.oaPct, null);
                if (total !== null && pct !== null) { oaCfm = total * pct / 100; raCfm = total - oaCfm; }
            } else { oaCfm = toNum(a.oaCfm, null); raCfm = toNum(a.raCfm, null); }
        } else if (a.oa.enabled) oaCfm = toNum(a.oaCfm, null);
        else if (a.ra.enabled) raCfm = toNum(a.raCfm, null);

        // Energy recovery on the OA stream
        var oaStream = oa, oaStreamId = 'oa';
        if (a.erv.enabled) {
            if (!oa || !ra) {
                onError('erv', 'Energy recovery needs both outdoor and return air included.');
            } else {
                try {
                    var er = Psy.erv(oa, ra, a.erv.effS, a.erv.effL, P);
                    addPoint('er', 'ER', er, 'Outdoor air leaving energy recovery');
                    lines.push({ from: 'oa', to: 'er', cls: 'psy-line-process', arrow: true });
                    oaStream = er; oaStreamId = 'er';
                    res.erv = { from: oa, to: er };
                } catch (e) { onError('erv', e.message); }
            }
        }

        // Mixing / entering state
        var streams = [];
        if (a.oa.enabled && oaStream) streams.push({ id: oaStreamId, label: oaStreamId.toUpperCase(), state: oaStream, cfm: oaCfm, raw: oa });
        if (a.ra.enabled && ra) streams.push({ id: 'ra', label: 'RA', state: ra, cfm: raCfm, raw: ra });
        var enabledCount = (a.oa.enabled ? 1 : 0) + (a.ra.enabled ? 1 : 0);

        var mixed = null, cur = null, curId = null, curLabel = null;
        if (enabledCount === 0) {
            onError('flow', 'Include at least one air stream.');
        } else if (streams.length === enabledCount) {
            if (streams.some(function (x) { return x.cfm === null || x.cfm === undefined; })) {
                onError('flow', 'Enter the airflow to compute the entering condition.');
            } else if (streams.some(function (x) { return x.cfm < 0; })) {
                onError('flow', 'Airflow cannot be negative.');
            } else {
                try {
                    mixed = Psy.mix(streams.map(function (x) { return { state: x.state, cfm: x.cfm }; }), P, basis);
                    mixed.single = streams.length === 1;
                    mixed.oaCfm = a.oa.enabled ? oaCfm : 0;
                    mixed.oaPctVolume = mixed.cfm > 0 ? mixed.oaCfm / mixed.cfm * 100 : 0;
                    mixed.oaPctMass = a.oa.enabled ? mixed.fractions[0] * 100 : 0;
                    if (res.erv) {
                        res.erv.massFlow = Psy.massFlow(oa, oaCfm, basis);
                        res.erv.load = Psy.process(res.erv.from, res.erv.to, res.erv.massFlow);
                    }
                    if (mixed.single) {
                        cur = streams[0].state; curId = streams[0].id; curLabel = streams[0].label;
                    } else {
                        cur = mixed.state; curId = 'ma'; curLabel = 'MA';
                        addPoint('ma', 'MA', mixed.state, 'Mixed air');
                        lines.push({ from: oaStreamId, to: 'ra', cls: 'psy-line-mix', arrow: false });
                    }
                } catch (e) { onError('flow', e.message); }
            }
        }
        res.mixed = mixed;
        res.entering = cur;
        res.enteringLabel = curLabel;
        var m = mixed ? mixed.massFlow : 0;

        // Economizer: verdict plus the changeover boundary drawn on the chart.
        // The shaded region is where OA would have to sit for free cooling:
        // below the RA enthalpy line (or left of the RA dry bulb) and left
        // of the high limit, under the saturation curve.
        if (a.econ.enabled && oa && ra) {
            res.econ = Psy.economizer(oa, ra, { mode: a.econ.mode, limitDb: a.econ.limitDb });
            var lim = Number(a.econ.limitDb);
            var hasLim = isFinite(lim);
            var dbLo = -100, wTop = 0.06;
            var region, boundary, dbCut;
            if (a.econ.mode === 'enthalpy') {
                var hRa = ra.h;
                var dbZero = hRa / 0.240;
                var wH = function (db) { return Math.max(0, Psy.humRatioFromEnthalpy(hRa, db)); };
                boundary = [];
                for (var dbb = dbLo; dbb <= dbZero + 1e-9; dbb += 2) boundary.push({ db: dbb, w: wH(dbb) });
                boundary.push({ db: dbZero, w: 0 });
                dbCut = hasLim ? Math.min(lim, dbZero) : dbZero;
                region = [{ db: dbLo, w: 0 }, { db: dbCut, w: 0 }, { db: dbCut, w: wH(dbCut) }];
                for (var dbr = dbCut - 2; dbr >= dbLo; dbr -= 2) region.push({ db: dbr, w: wH(dbr) });
                region.push({ db: dbLo, w: wH(dbLo) });
                paths.push({ pts: boundary, cls: 'psy-line-econ', under: true, label: 'RA enthalpy ' + fmtH(ra), labelAt: 'end', labelCls: 'psy-label-econ' });
            } else {
                boundary = [{ db: ra.db, w: 0 }, { db: ra.db, w: wTop }];
                dbCut = hasLim ? Math.min(lim, ra.db) : ra.db;
                region = [{ db: dbLo, w: 0 }, { db: dbCut, w: 0 }, { db: dbCut, w: wTop }, { db: dbLo, w: wTop }];
                paths.push({ pts: boundary, cls: 'psy-line-econ', under: true, label: 'RA dry bulb ' + fmtU('temp', ra.db), labelAt: 'end', labelCls: 'psy-label-econ' });
            }
            paths.unshift({ pts: region, cls: 'psy-econ-region', fill: true, under: true });
            if (hasLim) {
                paths.push({ pts: [{ db: lim, w: 0 }, { db: lim, w: wTop }], cls: 'psy-line-limit', under: true,
                             label: 'High limit ' + fmtU('temp', lim), labelAt: 'end', labelCls: 'psy-label-limit' });
            }
            res.econ.regionNote = 'Shaded chart area = free-cooling region';

            // Plain-language explainer drawn in the chart's top-left corner.
            var ec0 = res.econ;
            var rows = [{ swatch: ec0.ok ? 'ok' : 'no',
                          text: ec0.ok ? 'Free cooling available' : 'Free cooling not available' }];
            if (a.econ.mode === 'enthalpy') {
                var dh = Math.abs(ec0.hDiff), hUnit = U.unit('h', sys());
                var dhDisp = sys() === 'SI' ? dh * 2.326 : dh;
                rows.push({ swatch: 'econ', text: 'RA enthalpy ' + fmtH(ra) + ' - OA is ' + fmt(dhDisp, 1) + ' ' + hUnit +
                    (ec0.hDiff > 0 ? ' below (good)' : ' above (too warm)') });
            } else {
                rows.push({ swatch: 'econ', text: 'RA dry bulb ' + fmtU('temp', ra.db) + ' - OA is ' + fmtU('dtemp', Math.abs(ec0.dbDiff)) +
                    (ec0.dbDiff > 0 ? ' cooler (good)' : ' warmer') });
            }
            if (hasLim) {
                rows.push({ swatch: 'limit', text: 'High limit ' + fmtU('temp', lim) + ' - OA is ' + fmtU('dtemp', Math.abs(oa.db - lim)) +
                    (ec0.belowLimit ? ' below (dampers may open)' : ' above (dampers at minimum)') });
            }
            rows.push({ swatch: 'region', text: 'OA must sit in the shaded area for free cooling' });
            res.callouts = res.callouts || [];
            res.callouts.push({ title: 'Economizer check', rows: rows });
        }

        // Sequential stages
        function stage(id, label, name, errId, compute) {
            if (!cur) return;
            try {
                var out = compute(cur);
                var st = out.state || out;
                addPoint(id, label, st, name);
                lines.push({ from: curId, to: id, cls: id === 'rh' ? 'psy-line-reheat' : 'psy-line-process', arrow: true });
                var rec = { id: id, label: label, name: name, fromLabel: curLabel, from: cur, to: st,
                            load: Psy.process(cur, st, m), extra: out.extra || {} };
                stages.push(rec);
                cur = st; curId = id; curLabel = label;
            } catch (e) { onError(errId, e.message); }
        }

        if (a.preheat.enabled) stage('ph', 'PH', 'Preheat coil', 'preheat', function (c) {
            var db = Number(a.preheat.db);
            if (isFinite(db) && db < c.db) throw new Error('Preheat leaving temperature is below the entering air');
            return Psy.sensible(c, a.preheat.db, P);
        });
        if (a.coil.enabled) stage('sa', 'SA', 'Cooling coil', 'coil', function (c) {
            var st, adpInfo;
            if (a.coil.mode === 'adp') {
                var r = Psy.coilFromAdp(c, a.coil.adp, Number(a.coil.bf) / 100, P);
                st = r.state; adpInfo = { adp: r.adp, bf: r.bf };
            } else {
                st = Psy.state(a.coil.db, a.coil.key, a.coil.value, P);
                adpInfo = Psy.adpFromLeaving(c, st, P);
            }
            return { state: st, extra: { adp: adpInfo } };
        });
        if (a.fan.enabled) stage('sf', 'SF', 'Supply fan heat', 'fan', function (c) {
            var f = Psy.fanHeat(c, a.fan, m, P);
            return { state: f.state, extra: { q: f.q, dt: f.dt } };
        });
        if (a.reheat.enabled) stage('rh', 'RH', 'Reheat', 'reheat', function (c) { return Psy.reheat(c, a.reheat.db, P); });
        if (a.hum.enabled) stage('hu', 'HU', a.hum.type === 'evap' ? 'Evaporative humidifier' : 'Steam humidifier', 'hum', function (c) {
            return a.hum.type === 'evap' ? Psy.evap(c, a.hum.eff, P) : Psy.steam(c, a.hum.key, a.hum.value, P);
        });

        res.final = cur;
        res.finalLabel = curLabel;
        if (res.entering && stages.length) res.net = Psy.process(res.entering, res.final, m);

        // Cooling coil condensate
        stages.forEach(function (st) {
            if (st.id === 'sa' && st.load.total > 0) {
                st.extra.condensate = Psy.condensate(st.load.moistureLbHr, st.load.tons);
            }
        });

        // Room side
        if (a.room.enabled) {
            var rm = tryState(a.room, 'room', P, onError);
            if (rm) {
                addPoint('rm', 'RM', rm, 'Room');
                var qs = toNum(a.room.qs, null), ql = toNum(a.room.ql, 0);
                var roomRes = { state: rm, qs: qs, ql: ql };
                if (qs !== null && qs > 0) {
                    var shr = qs / (qs + Math.max(0, ql));
                    roomRes.shr = shr;
                    var vpLow = (s.view && isFinite(s.view.dbMin)) ? s.view.dbMin : s.dbMin;
                    paths.push({ pts: Psy.roomLine(rm, shr, P, Math.min(vpLow, -20)), cls: 'psy-line-room' });
                    try {
                        var given = a.room.solve === 'cfm'
                            ? { dbSupply: a.room.dbSupply }
                            : { cfm: (a.room.cfm !== null && a.room.cfm !== undefined) ? a.room.cfm : (mixed ? mixed.cfm : null) };
                        if (given.cfm === null) throw new Error('Enter a supply airflow (or include an air stream with airflow).');
                        roomRes.required = Psy.supplyFromRoom(rm, qs, ql, given, basis, P);
                        addPoint('rq', 'REQ', roomRes.required.state, 'Required supply air');
                    } catch (e) { onError('room', e.message); }
                    if (res.final && m > 0) {
                        var del = Psy.process(rm, res.final, m); // positive = delivered cooling
                        roomRes.delivered = del;
                    }
                } else {
                    onError('room', 'Enter the room sensible load.');
                }
                res.room = roomRes;

                // Explainer box for the room line and required supply point.
                if (roomRes.shr !== undefined) {
                    var rrows = [{ swatch: 'room', text: 'Room line, SHR ' + fmt(roomRes.shr, 2) +
                        ' - supply air on this line matches the room sensible/latent split' }];
                    if (roomRes.required) {
                        var rq = roomRes.required;
                        rrows.push({ swatch: 'req', text: 'REQ = supply that carries the load: ' +
                            (a.room.solve === 'cfm'
                                ? fmtU('flow', rq.cfm) + ' at ' + fmtU('temp', rq.state.db)
                                : fmtU('temp', rq.state.db) + ' at ' + fmtU('flow', rq.cfm)) });
                    }
                    if (roomRes.delivered && res.final) {
                        var dd = roomRes.delivered;
                        var sOk = dd.sensible >= roomRes.qs * 0.98, lOk = dd.latent >= roomRes.ql * 0.98;
                        rrows.push({ swatch: sOk && lOk ? 'ok' : 'no',
                            text: sOk && lOk
                                ? res.finalLabel + ' meets the room load'
                                : res.finalLabel + ' falls short - sensible ' + fmtPower(dd.sensible) + ' of ' + fmtPower(roomRes.qs) +
                                  (lOk ? '' : ', latent ' + fmtPower(dd.latent) + ' of ' + fmtPower(roomRes.ql)) });
                    }
                    res.callouts = res.callouts || [];
                    res.callouts.push({ title: 'Room check', rows: rrows });
                }
            }
        }

        res.tablePoints = points.slice();
        return res;
    }

    // -----------------------------------------------------------------
    // Report model (shared by the panel and the PDF)
    // -----------------------------------------------------------------

    function buildReport(res, s) {
        var blocks = [];
        var a = s.ahu;

        if (res.kind === 'ahu') {
            var m = res.mixed;
            if (m) {
                var rows = [['Total airflow', fmtU('flow', m.cfm)]];
                if (!m.single) {
                    rows.push(['Outdoor air (by volume)', fmt(m.oaPctVolume, 1) + ' %']);
                    rows.push(['Outdoor air (by mass)', fmt(m.oaPctMass, 1) + ' %']);
                }
                rows.push(['Dry-air mass flow', fmtU('massflow', m.massFlow) + (a.basis === 'actual' ? ' (actual)' : ' (standard air)')]);
                if (m.state && m.state.fogged) rows.push(['Note', 'Mixture lands in the fog region; saturated state shown.']);
                blocks.push({ title: m.single ? 'Airflow' : 'Mixing', rows: rows });
            }

            if (res.erv) {
                var e = res.erv, er = [];
                er.push(['OA leaving ER', fmtU('temp', e.to.db) + ' DB / ' + fmtU('temp', e.to.wb) + ' WB']);
                if (e.load) {
                    var cooling = e.load.total >= 0;
                    er.push([cooling ? 'Recovered (removed from OA)' : 'Recovered (added to OA)', fmtPower(Math.abs(e.load.total), cooling)]);
                    er.push(['Sensible', fmtPower(Math.abs(e.load.sensible))]);
                    er.push(['Latent', fmtPower(Math.abs(e.load.latent))]);
                }
                blocks.push({ title: 'Energy recovery (OA → ER)', rows: er });
            }

            if (res.econ) {
                var ec = res.econ;
                blocks.push({ title: 'Economizer check', rows: [
                    ['Free cooling', ec.ok ? 'Available' : 'Not available'],
                    ['Dry bulb, RA − OA', fmtU('dtemp', ec.dbDiff)],
                    ['Enthalpy, RA − OA', fmt(sys() === 'SI' ? ec.hDiff * 2.326 : ec.hDiff, 2) + ' ' + U.unit('h', sys())],
                    ['High limit', (ec.belowLimit ? 'OA below ' : 'OA above ') + fmtU('temp', a.econ.limitDb)],
                    ['On the chart', 'Shaded area is where OA must fall for free cooling']
                ] });
            }

            res.stages.forEach(function (st) {
                var L = st.load, rowsS = [];
                var title = st.name + ' (' + st.fromLabel + ' → ' + st.label + ')';
                if (st.id === 'sa') {
                    var cool = L.total >= 0, sg = cool ? 1 : -1;
                    rowsS.push([cool ? 'Total cooling' : 'Total heating', fmtPower(sg * L.total, cool)]);
                    rowsS.push(['Sensible', fmtPower(sg * L.sensible)]);
                    rowsS.push(['Latent', fmtPower(sg * L.latent)]);
                    if (cool && L.shr !== null) rowsS.push(['Sensible heat ratio', fmt(L.shr, 3)]);
                    if (st.extra.adp) {
                        rowsS.push(['Apparatus dew point', fmtU('temp', st.extra.adp.adp.db)]);
                        rowsS.push(['Bypass factor', fmt(st.extra.adp.bf * 100, 1) + ' %']);
                    } else if (a.coil.mode !== 'adp') {
                        rowsS.push(['Apparatus dew point', 'n/a (line does not reach saturation)']);
                    }
                    rowsS.push([L.moistureLbHr >= 0 ? 'Moisture removed' : 'Moisture added', fmtU('massflow', Math.abs(L.moistureLbHr), 1)]);
                    if (st.extra.condensate) {
                        var c = st.extra.condensate;
                        rowsS.push(['Condensate', fmtU('volrate', c.galhr) + '  /  ' + fmtU('volday', c.galday)]);
                        rowsS.push(['Drain size (IMC 307.2.2)', c.drainSize]);
                    }
                } else if (st.id === 'sf') {
                    rowsS.push(['Fan heat added', fmtPower(st.extra.q)]);
                    rowsS.push(['Temperature rise', fmtU('dtemp', st.extra.dt, 2)]);
                } else if (st.id === 'hu') {
                    rowsS.push(['Water added', fmtU('massflow', Math.abs(L.moistureLbHr), 1)]);
                    if (a.hum.type === 'steam') rowsS.push(['Heat added with steam', fmtPower(-L.total)]);
                    else rowsS.push(['Dry bulb drop', fmtU('dtemp', st.from.db - st.to.db)]);
                } else {
                    rowsS.push(['Heat added', fmtPower(-L.total)]);
                    rowsS.push(['Leaving dry bulb', fmtU('temp', st.to.db)]);
                }
                blocks.push({ title: title, rows: rowsS });
            });

            if (res.net) {
                var n = res.net, nc = n.total >= 0;
                blocks.push({ title: 'Net, ' + res.enteringLabel + ' → ' + res.finalLabel + ' (supply)', rows: [
                    [nc ? 'Net cooling' : 'Net heating', fmtPower(Math.abs(n.total), nc)],
                    ['Sensible', fmtPower(n.sensible) + (n.sensible < 0 ? ' (added)' : '')],
                    ['Latent', fmtPower(n.latent) + (n.latent < 0 ? ' (added)' : '')]
                ] });
            }

            if (res.room) {
                var r = res.room, rr = [];
                if (r.shr !== undefined) rr.push(['Room sensible heat ratio', fmt(r.shr, 3)]);
                if (r.required) {
                    var q = r.required;
                    rr.push([a.room.solve === 'cfm' ? 'Required airflow' : 'Required supply dry bulb',
                        a.room.solve === 'cfm' ? fmtU('flow', q.cfm) : fmtU('temp', q.state.db)]);
                    rr.push(['Required supply humidity', fmtU('grains', q.state.grains) + ' (' + fmt(q.state.rh * 100, 0) + '% RH)']);
                    if (!q.feasible && q.note) rr.push(['Note', q.note]);
                }
                if (r.delivered && res.final) {
                    var d = r.delivered;
                    var sensOk = d.sensible >= r.qs * 0.98, latOk = d.latent >= r.ql * 0.98;
                    rr.push(['Delivered sensible (' + res.finalLabel + ')', fmtPower(d.sensible) + ' vs ' + fmtPower(r.qs) + (sensOk ? '  OK' : '  short')]);
                    rr.push(['Delivered latent (' + res.finalLabel + ')', fmtPower(d.latent) + ' vs ' + fmtPower(r.ql) + (latOk ? '  OK' : '  short')]);
                    rr.push(['Supply SHR vs room SHR', fmt(d.total ? d.sensible / d.total : 0, 3) + ' vs ' + fmt(r.shr, 3)]);
                    rr.push(['Result', sensOk && latOk ? 'Supply air meets the room load' : 'Supply air does not meet the room load']);
                }
                blocks.push({ title: 'Room (RM)', rows: rr });
            }
        }

        // Air properties (rows = points)
        if (res.tablePoints && res.tablePoints.length) {
            var S = sys();
            var head = ['Point', 'DB ' + U.unit('temp', S), 'WB ' + U.unit('temp', S), 'DP ' + U.unit('temp', S), 'RH %',
                        'W ' + U.unit('grains', S), 'h ' + U.unit('h', S), 'v ' + U.unit('v', S)];
            var rowsT = res.tablePoints.map(function (p) {
                var st = p.state;
                return [p.label, fmt(U.toDisp('temp', st.db, S), 1), fmt(U.toDisp('temp', st.wb, S), 1), fmt(U.toDisp('temp', st.dp, S), 1),
                        fmt(st.rh * 100, 1), fmt(U.toDisp('grains', st.grains, S), 1), fmt(U.enthalpyDisp(st, S), 2), fmt(U.toDisp('v', st.v, S), 3)];
            });
            blocks.push({ title: 'Air properties', table: { head: head, rows: rowsT }, cls: res.tablePoints.map(function (p) { return p.cls; }) });
            var head2 = ['Point', 'W ' + U.unit('w', S), 'Density ' + U.unit('density', S), 'Vapor pressure ' + U.unit('pressure', S)];
            var rows2 = res.tablePoints.map(function (p) {
                var st = p.state;
                return [p.label, st.w.toFixed(5), fmt(U.toDisp('density', st.density, S), U.decimals('density', S)), fmt(U.toDisp('pressure', st.pv, S), U.decimals('pressure', S))];
            });
            blocks.push({ title: 'More properties', table: { head: head2, rows: rows2 }, cls: res.tablePoints.map(function (p) { return p.cls; }) });
        }
        return blocks;
    }

    // -----------------------------------------------------------------
    // Recompute + render
    // -----------------------------------------------------------------

    function recompute() {
        Object.keys(fieldErrorEls).forEach(function (k) { fieldErrorEls[k].textContent = ''; });
        var res = evaluate(state, function (id, msg) {
            if (fieldErrorEls[id] && !fieldErrorEls[id].textContent) fieldErrorEls[id].textContent = msg;
        });
        refs.lastResult = res;
        if (refs.pressure) {
            refs.pressure.textContent = sys() === 'SI'
                ? fmt(res.pressure * 6.894757, 2) + ' kPa'
                : fmt(Psy.inHgFromPsi(res.pressure), 2) + ' in Hg · ' + fmt(res.pressure, 3) + ' psia';
        }
        refs.chart.update({
            pressure: res.pressure,
            units: sys(),
            viewport: currentViewport(),
            show: state.show,
            points: res.points,
            lines: res.lines,
            paths: res.paths,
            callouts: res.callouts || []
        });
        renderResults(buildReport(res, state));
        updateAddState();
    }

    function renderResults(blocks) {
        var box = refs.results;
        box.innerHTML = '';
        if (!blocks.length) {
            box.appendChild(hint('Enter a valid air state to see its properties.'));
            return;
        }
        blocks.forEach(function (b) {
            box.appendChild(sectionTitle(b.title));
            if (b.rows) box.appendChild(buildKvList(b.rows));
            else if (b.table) box.appendChild(buildTable(b.table, b.cls));
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
            if (/\bshort\b|does not meet|Not available/.test(r[1])) dd.classList.add('is-warn');
            if (/\bOK\b|meets the room|^Available/.test(r[1])) dd.classList.add('is-ok');
            dl.appendChild(dt); dl.appendChild(dd);
        });
        return dl;
    }

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
    // Save to project / saved calculations
    // -----------------------------------------------------------------

    function dateStamp() {
        var d = new Date();
        return (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getFullYear();
    }

    function defaultCalcName() {
        if (state.mode === 'points') return 'State points';
        var a = state.ahu, parts = [];
        if (a.oa.enabled && a.ra.enabled) parts.push('Mixed air');
        else if (a.oa.enabled) parts.push('100% OA');
        else parts.push('Return air');
        if (a.coil.enabled) parts.push('cooling coil');
        if (a.reheat.enabled) parts.push('reheat');
        if (a.room.enabled) parts.push('room check');
        return parts.join(' + ');
    }

    function summarize(snap) {
        var s = fromSnapshot(snap);
        if (s.mode === 'points') return s.points.length + ' state point' + (s.points.length === 1 ? '' : 's');
        var a = s.ahu, bits = [];
        if (a.oa.enabled) bits.push('OA ' + fmt(a.oa.db, 0) + '°F');
        if (a.ra.enabled) bits.push('RA ' + fmt(a.ra.db, 0) + '°F');
        var cfm = (a.oa.enabled && a.ra.enabled && a.flowMode === 'pct') ? a.totalCfm
            : ((a.oa.enabled ? Number(a.oaCfm) || 0 : 0) + (a.ra.enabled ? Number(a.raCfm) || 0 : 0));
        if (cfm) bits.push(fmt(cfm, 0) + ' CFM');
        var stagesOn = ['erv', 'preheat', 'coil', 'fan', 'reheat', 'hum', 'room'].filter(function (k) { return a[k] && a[k].enabled; });
        var names = { erv: 'ER', preheat: 'PH', coil: 'SA', fan: 'SF', reheat: 'RH', hum: 'HU', room: 'RM' };
        if (stagesOn.length) bits.push(stagesOn.map(function (k) { return names[k]; }).join(' → '));
        if (s.altitude) bits.push(fmt(s.altitude, 0) + ' ft');
        return bits.join(' · ');
    }

    function listSaved() {
        if (!HHpro.Cart || !HHpro.Cart.getProjectExtra) return [];
        var ex = HHpro.Cart.getProjectExtra(CALC_EXTRA_KEY) || {};
        return Array.isArray(ex.list) ? ex.list : [];
    }

    function findSaved(id) {
        var list = listSaved();
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
        return null;
    }

    function writeSaved(list) {
        HHpro.Cart.setProjectExtra(CALC_EXTRA_KEY, { list: list });
    }

    function deleteSaved(id) {
        writeSaved(listSaved().filter(function (c) { return c.id !== id; }));
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
                var list = listSaved();
                list.push({
                    id: 'calc_' + Date.now().toString(36),
                    name: name,
                    savedAt: new Date().toISOString(),
                    snapshot: deepClone(state)
                });
                writeSaved(list);
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

    // -----------------------------------------------------------------
    // PDF (works from any snapshot, no page needed)
    // -----------------------------------------------------------------

    function pdfBlob(snapshot, meta) {
        init();
        meta = meta || {};
        var saved = state;
        var s = fromSnapshot(snapshot);
        state = s; // fmt helpers read the unit system from `state`
        try {
            var res = evaluate(s, function () {});
            var holder = document.createElement('div');
            var chart = Chart.create(holder);
            chart.update({
                pressure: res.pressure, units: s.units, viewport: s.view || Chart.defaultViewport(s.dbMin),
                show: s.show, points: res.points, lines: res.lines, paths: res.paths, callouts: res.callouts || []
            });
            var blocks = buildReport(res, s);
            var sub = [];
            if (meta.projectName) sub.push(meta.projectName);
            sub.push('HHpro Psychrometrics');
            sub.push(new Date(meta.savedAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }));
            sub.push('Altitude ' + fmtU('altitude', s.altitude));
            sub.push(s.units === 'SI' ? 'SI units' : 'IP units');
            return HHpro.PsychroPdf.build({
                title: meta.title || defaultCalcName(),
                subtitle: sub.join(' · '),
                blocks: blocks,
                svg: chart.element,
                footer: 'Generated by HHpro · psychrometrics per ASHRAE Fundamentals (PsychroLib) · loads on the ' +
                    (s.ahu.basis === 'actual' ? 'actual-air' : 'standard-air') + ' basis'
            });
        } finally {
            state = saved;
        }
    }

    HHpro.Psychrometrics = {
        pdfBlob: pdfBlob,
        summarize: summarize,
        listSaved: listSaved,
        deleteSaved: deleteSaved,
        findSaved: findSaved
    };
})();
