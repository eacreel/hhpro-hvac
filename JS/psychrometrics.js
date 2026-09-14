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
                preset: 'custom',                            // system type; opens on Custom (no stages)
                oa:  { enabled: false, db: 95, key: 'wb', value: 78 },
                erv: { enabled: false, mode: 'mix', effS: 70, effL: 60, exhCfm: null },
                ra:  { enabled: false, db: 75, key: 'rh', value: 50 },
                flowMode: 'each', basis: 'actual',           // actual air: what the Daikin selection software uses
                oaCfm: 2000, raCfm: 8000, totalCfm: 10000, oaPct: 20,
                econ: { enabled: false, mode: 'enthalpy', limitDb: 65 },
                preheat: { enabled: false, db: 55 },
                coil: { enabled: false, mode: 'leaving', db: 55, key: 'rh', value: 95, adp: 50, bf: 10 },
                fan: { enabled: false, mode: 'bhp', bhp: 5, motorIn: true, motorEff: 90, dt: 1.5 },
                reheat: { enabled: false, db: 72 },
                hum: { enabled: false, type: 'steam', key: 'rh', value: 40, eff: 85 },
                room: { enabled: false, db: 75, key: 'rh', value: 50, qs: 120000, ql: 30000,
                        solve: 'db', cfm: null, dbSupply: 55,
                        latentOnly: false, vozCfm: null }   // latentOnly: ventilation air carries all latent (DOAS)
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
            if (parsed.ahu && parsed.ahu.preset === undefined) d.ahu.preset = 'custom';
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
        view: 'psychrometrics',
        saved: { summarize: summarize, pdfBlob: pdfBlob, docType: 'PSYCHROMETRICS (PDF)' }
    });


    // -----------------------------------------------------------------
    // Help text for the "?" icons. Each entry: what the input is, and
    // how changing it moves the chart.
    // -----------------------------------------------------------------

    var HELP = {
        system: 'The kind of unit being modelled. Choosing one switches on the air streams and stages that belong to it and fills in typical design conditions for them; other numbers you have entered are kept. Add or remove components with the chips below, or take a stage out with the × in its header.',
        room_latentonly: 'Dedicated outdoor air design: the ventilation air is the only thing removing moisture from the space, while the zone equipment (VRF, chilled beams, fan coils, sensible RTUs) runs dry. The supply must be dried to a dew point low enough that the ventilation airflow alone carries the space latent load. The sensible load is left to the zone equipment and is not checked in this mode.',
        room_voz: 'Ventilation (outdoor) airflow delivered to the space, ASHRAE 62.1 Voz. Blank uses the outdoor airflow from the Airflow section. Less airflow calls for a lower supply dew point.',
        altitude: 'Site elevation. Sets the barometric pressure used for every property. Higher altitude means lower pressure, which raises the saturation curve and the humidity ratio at a given RH, so the same wet bulb reads a little wetter.',
        units: 'Switches every input and result between IP (\u00B0F, gr/lb, Btu/h, CFM) and SI (\u00B0C, g/kg, kW, L/s). The math does not change, only how values are shown.',
        oa: 'Outdoor air brought into the unit. Plots as OA. With return air included it is one end of the grey mixing line; with return air excluded it is the entering-coil air itself.',
        oa_db: 'Outdoor design dry bulb. Moves OA left or right.',
        oa_second: 'Any one of wet bulb, RH, dew point, humidity ratio or enthalpy fixes the moisture in the outdoor air. Moves OA up or down.',
        erv: 'Energy recovery wheel or plate between the incoming outdoor air and the building exhaust, which is taken at the return air condition. Pre-conditions OA toward RA and plots the leaving air as ER with an arrow from OA. Whether ER then mixes with return air or goes straight to the coil depends on the arrangement below.',
        erv_mode: 'Return air mixes: the recovery device treats the outdoor air, then ER mixes with the recirculated return air (MA) before the coil. Dedicated outdoor air unit: return air is only the exhaust side of the device and never enters the supply; the coil sees ER directly and no mixing line is drawn.',
        erv_exh: 'Airflow through the exhaust side of the device. Blank means equal to the outdoor airflow. When the exhaust is smaller than the outdoor air the recovery on the outdoor side drops in proportion (AHRI 1060), so ER moves less far toward RA.',
        exh_cfm: 'Building exhaust airflow through the recovery device. It sets the flow correction: exhaust smaller than the outdoor air reduces the recovery. It does not add to the supply.',
        erv_s: 'Sensible effectiveness: the fraction of the temperature difference between OA and RA that is recovered. 70% moves ER 70% of the way toward the RA temperature.',
        erv_l: 'Latent effectiveness: the fraction of the moisture difference recovered (wheels only; plates are near zero). Moves ER vertically toward the RA humidity ratio.',
        ra: 'Air returning from the space, normally at the room condition. Plots as RA; the other end of the mixing line.',
        ra_db: 'Return air dry bulb. Moves RA left or right.',
        ra_second: 'Fixes the moisture in the return air. Moves RA up or down.',
        flowmode: 'Per stream: enter the outdoor and return CFM separately. Total + % outdoor air: enter the fan airflow and the outdoor fraction.',
        oa_cfm: 'Outdoor airflow. The ratio of outdoor to return air sets where MA sits on the mixing line: more outdoor air pulls MA toward OA.',
        ra_cfm: 'Return airflow. More return air pulls MA toward RA.',
        total_cfm: 'Total supply airflow through the unit. Sets the mass flow every load is figured on; does not move the points.',
        oa_pct: 'Outdoor air as a percentage of total airflow. Slides MA along the mixing line: 0% lands on RA, 100% on OA.',
        basis: 'How CFM becomes mass flow. Standard air uses 0.075 lb/ft\u00B3 (CFM \u00D7 4.5 lb/hr), the convention in coil selection software and the 1.08 / 4.5 rules of thumb. Actual air uses the specific volume at each stream, which matters at altitude or high temperature. Changes the loads, not the plotted points.',
        econ: 'Asks whether the outdoor air could cool the space without running the coil. Draws the changeover line through RA, the amber high-limit line, and shades the free-cooling region. The box in the chart states the verdict for the current OA point.',
        econ_mode: 'Differential enthalpy compares total heat (temperature plus moisture); the green boundary is the RA enthalpy line. Differential dry bulb compares temperature only; the boundary is a vertical line at the RA dry bulb.',
        econ_limit: 'Fixed outdoor dry bulb above which the dampers stay at minimum no matter what the comparison says. Draws the amber vertical line; the shaded region never extends to its right.',
        preheat: 'Sensible heating ahead of the cooling coil, for freeze protection or winter heating. Moves the point horizontally to the right at constant moisture and plots PH.',
        preheat_db: 'Air temperature leaving the preheat coil. Must be at or above the entering air. Sets how far right PH sits.',
        coil: 'The cooling and dehumidifying coil. The process runs down and to the left from the entering air to SA. Leaving condition: enter the state you want and the implied apparatus dew point and bypass factor are reported. ADP + bypass factor: describe the coil instead and the leaving point is calculated.',
        coil_db: 'Coil leaving dry bulb. Moves SA left or right; colder means more sensible cooling.',
        coil_second: 'Fixes the moisture leaving the coil. Lower moisture means more latent cooling; a dehumidifying coil usually leaves air near 90 to 95% RH.',
        coil_adp: 'Apparatus dew point: the saturation temperature the coil surface effectively runs at, where the process line meets the saturation curve. Lower ADP gives colder, drier leaving air and a steeper process line.',
        coil_bf: 'Bypass factor: the fraction of air that passes the coil untouched. 0% lands SA on the ADP; higher values move SA back toward the entering air along the same line. Typical values are 5 to 15% for 4 to 6 row coils.',
        fan: 'Heat from the supply fan and motor picked up after the coil (draw-through). A small horizontal step to the right, usually 1 to 3 \u00B0F, plotted as SF. It reduces the net cooling delivered.',
        fan_mode: 'Brake horsepower converts fan work to heat (2545 Btu/h per hp) and spreads it over the airflow. Temperature rise lets you enter the rise directly.',
        fan_bhp: 'Fan brake horsepower at design airflow. More power means a larger temperature rise.',
        fan_motor: 'Tick when the motor sits in the airstream, so its losses also heat the air.',
        fan_eff: 'Motor efficiency. Losses (1 minus efficiency) are added to the air when the motor is in the airstream.',
        fan_dt: 'Temperature rise across the fan. Moves SF that far to the right of the previous point.',
        reheat: 'Sensible heat added after the coil (hot gas, electric or hydronic) to avoid overcooling the space while keeping the dehumidification. Horizontal move to the right at constant moisture; plots RH.',
        reheat_db: 'Air temperature leaving the reheat. Must be at or above the coil leaving temperature. Sets how far right RH sits.',
        hum: 'Adds moisture to the supply air. Steam rises almost vertically at constant dry bulb to the target humidity. Evaporative moves up and to the left along the wet-bulb line by the effectiveness. Plots HU.',
        hum_type: 'Steam: choose a target RH, dew point or humidity ratio. Evaporative: choose an effectiveness; the air cools as it humidifies.',
        hum_target: 'Humidity to reach at the current dry bulb. Sets how far up HU sits.',
        hum_eff: 'Saturation effectiveness of the evaporative media. 100% reaches the wet-bulb temperature.',
        room: 'The space being served: its design condition and loads. Draws the purple room line (every supply state that matches the space sensible / latent split), places REQ where your airflow lands on it, and checks the final supply air against the loads.',
        room_db: 'Space design dry bulb. Plots RM and anchors the room line.',
        room_second: 'Space design humidity. Moves RM up or down and shifts the whole room line with it.',
        room_qs: 'Sensible load: heat that raises the space temperature (solar, lights, equipment, people). With the latent load it sets the slope of the room line; more sensible flattens it.',
        room_ql: 'Latent load: moisture gain (people, infiltration, processes). More latent steepens the room line, calling for drier supply air. It also sets the maximum supply dew point: Q latent = 0.69 × CFM × (W room − W supply) in gr/lb, where 0.69 is 4.5 lb/h per CFM of standard air × 1076 Btu/lb of moisture ÷ 7000 gr/lb. The actual-air basis uses the real mass flow instead of 4.5.',
        room_solve: 'Supply temperature from airflow: you give the CFM and it finds where REQ lands on the line. Airflow from supply temperature: you give the supply dry bulb and it finds the CFM needed.',
        room_cfm: 'Supply airflow to size against. Blank uses the system airflow from the Airflow section. More CFM moves REQ up the line toward RM (warmer supply); less moves it down toward saturation.',
        room_dbsupply: 'Supply dry bulb to size against. Colder supply needs less airflow to carry the same load.',
        point: 'Dry bulb plus any one other property defines a state point. The chart plots it with this colour and the table lists every property.'
    };

    var helpPop = null, helpPinned = null;

    function ensureHelpPop() {
        if (helpPop) return helpPop;
        helpPop = document.createElement('div');
        helpPop.className = 'psy-help-pop';
        helpPop.hidden = true;
        document.body.appendChild(helpPop);
        document.addEventListener('click', function (e) {
            if (!helpPinned) return;
            if (e.target === helpPinned || helpPop.contains(e.target)) return;
            helpPinned = null;
            helpPop.hidden = true;
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { helpPinned = null; helpPop.hidden = true; }
        });
        return helpPop;
    }

    function showHelp(btn, key) {
        var pop = ensureHelpPop();
        pop.textContent = HELP[key] || '';
        pop.hidden = false;
        var r = btn.getBoundingClientRect();
        var w = Math.min(340, window.innerWidth - 24);
        pop.style.width = w + 'px';
        var left = Math.min(r.left, window.innerWidth - w - 12);
        var top = r.bottom + 6;
        pop.style.left = Math.max(8, left) + 'px';
        pop.style.top = top + 'px';
        var ph = pop.getBoundingClientRect().height;
        if (top + ph > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - ph - 6) + 'px';
    }

    function hideHelp() {
        if (helpPinned || !helpPop) return;
        helpPop.hidden = true;
    }

    // "?" icon: hover to peek, click to pin, click again / Escape / click away to close.
    function help(key) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'psy-help';
        b.textContent = '?';
        b.setAttribute('aria-label', 'Explain this input');
        b.title = '';
        b.addEventListener('mouseenter', function () { if (!helpPinned) showHelp(b, key); });
        b.addEventListener('mouseleave', hideHelp);
        b.addEventListener('focus', function () { if (!helpPinned) showHelp(b, key); });
        b.addEventListener('blur', hideHelp);
        b.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            if (helpPinned === b) { helpPinned = null; helpPop.hidden = true; return; }
            helpPinned = b;
            showHelp(b, key);
        });
        return b;
    }

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
            if (params && params.seed) applySeed(params.seed);
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

    // Hand-off from the Supply air dew point calculator: DOAS preset with
    // the Room check in ventilation-latent mode and its inputs filled in.
    // seed = { units, altitude, basis, room: {db, key, value}, ql, cfm, supplyDp }
    function applySeed(seed) {
        state = defaults();
        if (seed.units === 'SI') state.units = 'SI';
        if (isFinite(seed.altitude)) state.altitude = Number(seed.altitude);
        var a = state.ahu;
        if (seed.basis === 'std' || seed.basis === 'actual') a.basis = seed.basis;
        applyPreset('doas');
        a.room.enabled = true;
        a.room.latentOnly = true;
        if (seed.room) {
            if (isFinite(seed.room.db)) a.room.db = Number(seed.room.db);
            if (seed.room.key) a.room.key = seed.room.key;
            if (seed.room.value !== undefined && seed.room.value !== null) a.room.value = Number(seed.room.value);
        }
        if (isFinite(seed.ql)) a.room.ql = Number(seed.ql);
        if (isFinite(seed.cfm) && seed.cfm !== null) { a.room.vozCfm = Number(seed.cfm); a.oaCfm = Number(seed.cfm); }
        // Put the coil at the delivered dew point (near-saturated) when known,
        // so the SA point sits where the unit actually leaves the air.
        if (isFinite(seed.supplyDp) && seed.supplyDp !== null) {
            a.coil.mode = 'leaving';
            a.coil.db = Number(seed.supplyDp) + 2;
            a.coil.key = 'dp';
            a.coil.value = Number(seed.supplyDp);
        }
        save();
    }

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
        sub.textContent = 'Pick the system type, add or remove its components, ' +
            'check the supply air against the room load and dew point, and read every state off the chart.';
        intro.appendChild(title);
        intro.appendChild(sub);
        bar.appendChild(intro);

        // Design-condition lookup (ASHRAE climatic data by station). A plain
        // link: nothing is requested until it is clicked, so privacy.js
        // stays accurate.
        var links = document.createElement('div');
        links.className = 'psy-topbar-links';
        var meteo = document.createElement('a');
        meteo.className = 'projects-btn projects-btn-secondary psy-ext-link';
        meteo.href = 'https://ashrae-meteo.info/';
        meteo.target = '_blank';
        meteo.rel = 'noopener noreferrer';
        meteo.title = 'ASHRAE climatic design conditions by weather station (opens in a new tab)';
        meteo.appendChild(HHpro.UI.icon('search'));
        var meteoLbl = document.createElement('span');
        meteoLbl.textContent = 'ASHRAE design conditions';
        meteo.appendChild(meteoLbl);
        links.appendChild(meteo);
        bar.appendChild(links);
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
        altRow.appendChild(help('altitude'));
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
        altRow.appendChild(help('units'));
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
        var pth = document.createElement('div');
        pth.className = 'psy-section-head';
        pth.appendChild(sectionTitle('Air states'));
        pth.appendChild(help('point'));
        section.appendChild(pth);
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

    // ---------- System presets ----------
    // A preset switches the streams and stages on or off (`on`) and may
    // set typical design values for them (`values`, merged into the state).
    // Everything else you have entered is kept.
    var PRESETS = [
        { key: 'rtu', label: 'Packaged RTU / split (mixed air)', short: 'RTU',
          desc: 'Outdoor and return air mix ahead of the cooling coil. Add Reheat for hot gas reheat, Room check to size against the space load.',
          on: ['oa', 'ra', 'coil'],
          values: { oa: { db: 95, key: 'wb', value: 78 }, ra: { db: 75, key: 'rh', value: 50 } } },
        { key: 'doas', label: '100% outdoor air / DOAS', short: 'DOAS',
          desc: 'Dedicated outdoor air unit: cooling coil and reheat on 100% outdoor air. Add Energy recovery (with Return air as the exhaust) or Room check for the Law #1 supply dew point.',
          on: ['oa', 'coil', 'reheat'], erv: 'doas', latentOnly: true,
          values: { oa: { db: 95, key: 'wb', value: 78 } } },
        { key: 'mau', label: 'Makeup air / heating', short: 'Makeup air',
          desc: '100% outdoor air through a heating coil.',
          on: ['oa', 'preheat'],
          values: { oa: { db: 21.5, key: 'rh', value: 25 }, preheat: { db: 95 } } },
        { key: 'hum', label: 'Winter humidification', short: 'Humidification',
          desc: 'Outdoor and return air mixed, heated and humidified. Add Room check to compare with the space condition.',
          on: ['oa', 'ra', 'preheat', 'hum'],
          values: { oa: { db: 95, key: 'rh', value: 25 }, ra: { db: 70, key: 'rh', value: 50 }, preheat: { db: 95 } } },
        { key: 'custom', label: 'Custom (pick the components)', short: null,
          desc: 'Start empty and add the streams and stages you need.',
          on: [] }
    ];
    var STAGE_KEYS = ['oa', 'ra', 'erv', 'econ', 'preheat', 'coil', 'fan', 'reheat', 'hum', 'room'];
    var COMPONENTS = [
        ['oa', 'Outdoor air'], ['ra', 'Return air'], ['erv', 'Energy recovery'], ['econ', 'Economizer'],
        ['preheat', 'Preheat / heating coil'], ['coil', 'Cooling coil'], ['fan', 'Fan heat'],
        ['reheat', 'Reheat'], ['hum', 'Humidifier'], ['room', 'Room check']
    ];

    function presetByKey(key) {
        for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].key === key) return PRESETS[i];
        return null;
    }

    function applyPreset(key) {
        var a = state.ahu, p = presetByKey(key);
        a.preset = key;
        if (!p) return;
        STAGE_KEYS.forEach(function (k) { a[k].enabled = p.on.indexOf(k) >= 0; });
        if (p.values) extend(a, deepClone(p.values));
        a.erv.mode = p.erv || 'mix';
        a.room.latentOnly = !!p.latentOnly;
        enforceStreamRules();
    }

    // Recovery and the economizer compare outdoor to return air, so both
    // streams have to be present for either to stay in the system.
    function enforceStreamRules() {
        var a = state.ahu;
        if (!(a.oa.enabled && a.ra.enabled)) { a.erv.enabled = false; a.econ.enabled = false; }
    }

    function anyStageOn() {
        var a = state.ahu;
        return STAGE_KEYS.some(function (k) { return a[k].enabled; });
    }

    // System type chooser + component chips. Sits at the top of the
    // Air Handler tab; everything below it is driven by what is ticked here.
    function buildSystemCard() {
        var a = state.ahu;
        var sec = document.createElement('div');
        sec.className = 'psy-section psy-system';
        var head = document.createElement('div');
        head.className = 'psy-section-head';
        head.appendChild(sectionTitle('System'));
        head.appendChild(help('system'));
        sec.appendChild(head);

        var sel = document.createElement('select');
        sel.className = 'filter-select psy-select psy-system-select';
        sel.setAttribute('aria-label', 'System type');
        var ph = document.createElement('option');
        ph.value = '';
        ph.textContent = 'Choose a system type\u2026';
        ph.disabled = true;
        ph.selected = !a.preset;
        sel.appendChild(ph);
        PRESETS.forEach(function (p) {
            var o = document.createElement('option');
            o.value = p.key;
            o.textContent = p.label;
            if (a.preset === p.key) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', function () {
            if (!sel.value) return;
            applyPreset(sel.value);
            save(); buildForm(); recompute();
        });
        sec.appendChild(sel);

        var p = presetByKey(a.preset);
        if (!p) {
            sec.appendChild(hint('Pick the type of system to start. Its components appear below and can be added or removed one at a time.'));
            return sec;
        }
        if (p.desc) sec.appendChild(hint(p.desc));

        var row = document.createElement('div');
        row.className = 'psy-chips';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', 'Components');
        var both = a.oa.enabled && a.ra.enabled;
        COMPONENTS.forEach(function (c) {
            var key = c[0], on = !!a[key].enabled;
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'psy-chip' + (on ? ' is-on' : '');
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
            b.textContent = c[1];
            if ((key === 'erv' || key === 'econ') && !both) {
                b.disabled = true;
                b.title = 'Needs both outdoor and return air';
            }
            b.addEventListener('click', function () {
                a[key].enabled = !on;
                enforceStreamRules();
                save(); buildForm(); recompute();
            });
            row.appendChild(b);
        });
        sec.appendChild(row);
        return sec;
    }

    // ---------- Air Handler form ----------

    function buildAhuForm(form) {
        var a = state.ahu;
        form.appendChild(buildSystemCard());
        if (!a.preset) return;
        var both = a.oa.enabled && a.ra.enabled;

        // Outdoor air
        if (a.oa.enabled) form.appendChild(stageSection('oa', 'Outdoor air', a.oa, function (sec, body) {
            body.appendChild(buildStateFields(a.oa, 'oa', 'oa'));
        }, 'oa'));

        // Energy recovery (needs both streams; enforceStreamRules keeps it honest)
        if (a.erv.enabled && both) form.appendChild(stageSection('er', 'Energy recovery on outdoor air', a.erv, function (sec, body) {
            body.appendChild(hint('Wheel or plate exchanger between outdoor and exhaust (return) air. The outdoor air leaving it plots as ER.'));
            var r = document.createElement('div');
            r.className = 'psy-radio-row';
            r.appendChild(inlineLabel('Arrangement:'));
            r.appendChild(help('erv_mode'));
            [['mix', 'Return air mixes with outdoor air'], ['doas', 'Dedicated outdoor air unit (return air is exhaust only)']].forEach(function (m) {
                r.appendChild(radio('psy-erv-mode', m[0], m[1], a.erv.mode === m[0], function () {
                    a.erv.mode = m[0]; save(); buildForm(); recompute();
                }));
            });
            body.appendChild(r);
            var g = fields();
            g.appendChild(numberField('Sensible eff.', 'pct', a.erv.effS, { min: 0, max: 100, step: 1 }, function (v) { a.erv.effS = v; }, 'erv_s'));
            g.appendChild(numberField('Latent eff.', 'pct', a.erv.effL, { min: 0, max: 100, step: 1 }, function (v) { a.erv.effL = v; }, 'erv_l'));
            if (a.erv.mode !== 'doas') {
                var ex = numberField('Exhaust airflow', 'flow', a.erv.exhCfm, { min: 0, step: 50 }, function (v) { a.erv.exhCfm = v; }, 'erv_exh');
                ex.querySelector('input').placeholder = '= outdoor';
                g.appendChild(ex);
            }
            body.appendChild(g);
            if (a.erv.mode === 'doas') {
                body.appendChild(hint('Exhaust airflow is entered in the Airflow section. The return air condition is still the exhaust-side condition.'));
            }
            body.appendChild(errorLine('erv'));
        }, 'erv'));

        // Return air
        if (a.ra.enabled) form.appendChild(stageSection('ra', 'Return air', a.ra, function (sec, body) {
            body.appendChild(buildStateFields(a.ra, 'ra', 'ra'));
        }, 'ra'));

        // Airflow
        if (a.oa.enabled || a.ra.enabled) {
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
            basisRow.appendChild(help('basis'));
            [['std', 'Standard air (' + (sys() === 'SI' ? '1.2 kg/m³' : '0.075 lb/ft³') + ')'], ['actual', 'Actual air at each stream']].forEach(function (m) {
                basisRow.appendChild(radio('psy-basis', m[0], m[1], a.basis === m[0], function () { a.basis = m[0]; save(); recompute(); }));
            });
            flow.appendChild(basisRow);
            flow.appendChild(hint('Standard air is the CFM × 4.5 convention used by coil selection software and the 1.08 / 4.5 rules of thumb, independent of altitude.'));
            flow.appendChild(errorLine('flow'));
            form.appendChild(flow);
        }

        // Economizer check (needs both streams to compare)
        if (a.econ.enabled && both) form.appendChild(stageSection('econ', 'Economizer check', a.econ, function (sec, body) {
            body.appendChild(hint('Compares outdoor to return air and a fixed high limit; reports whether free cooling applies.'));
            var r = document.createElement('div');
            r.className = 'psy-radio-row';
            r.appendChild(inlineLabel('Changeover:'));
            r.appendChild(help('econ_mode'));
            [['enthalpy', 'Differential enthalpy'], ['db', 'Differential dry bulb']].forEach(function (m) {
                r.appendChild(radio('psy-econ-mode', m[0], m[1], a.econ.mode === m[0], function () { a.econ.mode = m[0]; save(); recompute(); }));
            });
            body.appendChild(r);
            var g = fields();
            g.appendChild(numberField('High limit', 'temp', a.econ.limitDb, { step: 0.5 }, function (v) { a.econ.limitDb = v; }, 'econ_limit'));
            body.appendChild(g);
        }, 'econ'));

        // Preheat / heating coil
        if (a.preheat.enabled) form.appendChild(stageSection('ph', a.coil.enabled ? 'Preheat coil' : 'Heating coil', a.preheat, function (sec, body) {
            var g = fields();
            g.appendChild(numberField('Leaving dry bulb', 'temp', a.preheat.db, { step: 0.5 }, function (v) { a.preheat.db = v; }, 'preheat_db'));
            body.appendChild(g);
            body.appendChild(errorLine('preheat'));
        }, 'preheat'));

        // Cooling coil
        if (a.coil.enabled) form.appendChild(stageSection('sa', 'Cooling coil leaving air', a.coil, function (sec, body) {
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
                g.appendChild(numberField('Apparatus dew point', 'temp', a.coil.adp, { step: 0.5 }, function (v) { a.coil.adp = v; }, 'coil_adp'));
                g.appendChild(numberField('Bypass factor', 'pct', a.coil.bf, { min: 0, max: 99, step: 1 }, function (v) { a.coil.bf = v; }, 'coil_bf'));
                body.appendChild(g);
                body.appendChild(errorLine('coil'));
                body.appendChild(hint('Leaving state is the point on the entering → ADP line a bypass-factor fraction back from the ADP.'));
            } else {
                body.appendChild(buildStateFields(a.coil, 'coil', 'coil'));
                body.appendChild(hint('The ADP and bypass factor implied by this leaving condition are reported below.'));
            }
        }, 'coil'));

        // Supply fan (draw-through: after the coil, before reheat)
        if (a.fan.enabled) form.appendChild(stageSection('sf', 'Supply fan heat (draw-through)', a.fan, function (sec, body) {
            body.appendChild(hint('Fan and motor heat picked up after the coil, before any reheat.'));
            buildFanFields(body, a.fan, 'fan');
        }, 'fan'));

        // Reheat
        if (a.reheat.enabled) form.appendChild(stageSection('rh', 'Reheat', a.reheat, function (sec, body) {
            body.appendChild(hint('Hot gas, electric or hydronic reheat: humidity ratio is held, only dry bulb rises.'));
            var g = fields();
            g.appendChild(numberField('Leaving dry bulb', 'temp', a.reheat.db, { step: 0.5 }, function (v) { a.reheat.db = v; }, 'reheat_db'));
            body.appendChild(g);
            body.appendChild(errorLine('reheat'));
        }, 'reheat'));

        // Humidifier
        if (a.hum.enabled) form.appendChild(stageSection('hu', 'Humidifier', a.hum, function (sec, body) {
            var r = document.createElement('div');
            r.className = 'psy-radio-row';
            r.appendChild(inlineLabel('Type:'));
            r.appendChild(help('hum_type'));
            [['steam', 'Steam (constant dry bulb)'], ['evap', 'Evaporative (constant wet bulb)']].forEach(function (m) {
                r.appendChild(radio('psy-hum-type', m[0], m[1], a.hum.type === m[0], function () {
                    a.hum.type = m[0]; save(); buildForm(); recompute();
                }));
            });
            body.appendChild(r);
            var g = fields();
            if (a.hum.type === 'evap') {
                g.appendChild(numberField('Effectiveness', 'pct', a.hum.eff, { min: 0, max: 100, step: 1 }, function (v) { a.hum.eff = v; }, 'hum_eff'));
            } else {
                g.appendChild(buildSecondProperty(a.hum, 'Target', ['rh', 'dp', 'w'], 'hum_target'));
            }
            body.appendChild(g);
            body.appendChild(errorLine('hum'));
        }, 'hum'));

        // Room
        if (a.room.enabled) form.appendChild(stageSection('rm', 'Room', a.room, function (sec, body) {
            body.appendChild(hint(a.room.latentOnly
                ? 'Space condition and latent load set the dew point the ventilation air must be dried to (Law #1).'
                : 'Space condition and loads draw the room sensible-heat-ratio line, size the supply air and set the maximum supply dew point.'));
            body.appendChild(buildStateFields(a.room, 'room', 'room'));

            var loRow = document.createElement('div');
            loRow.className = 'psy-radio-row';
            var lo = document.createElement('label');
            lo.className = 'psy-check';
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !!a.room.latentOnly;
            cb.addEventListener('change', function () { a.room.latentOnly = cb.checked; save(); buildForm(); recompute(); });
            var cbText = document.createElement('span');
            cbText.textContent = 'Ventilation air carries all the latent load (DOAS)';
            lo.appendChild(cb); lo.appendChild(cbText);
            loRow.appendChild(lo);
            loRow.appendChild(help('room_latentonly'));
            body.appendChild(loRow);

            var g = fields();
            if (a.room.latentOnly) {
                g.appendChild(numberField('Latent load', 'power', a.room.ql, { min: 0, step: sys() === 'SI' ? 0.5 : 1000 }, function (v) { a.room.ql = v; }, 'room_ql'));
                var vz = numberField('Ventilation airflow', 'flow', a.room.vozCfm, { min: 0, step: 50 }, function (v) { a.room.vozCfm = v; }, 'room_voz');
                vz.querySelector('input').placeholder = '= outdoor air';
                g.appendChild(vz);
                body.appendChild(g);
                body.appendChild(hint('Required supply dew point from Q latent = 0.69 × CFM × Δgr/lb. The sensible load is handled by the zone equipment and is not checked.'));
            } else {
                g.appendChild(numberField('Sensible load', 'power', a.room.qs, { min: 0, step: sys() === 'SI' ? 0.5 : 1000 }, function (v) { a.room.qs = v; }, 'room_qs'));
                g.appendChild(numberField('Latent load', 'power', a.room.ql, { min: 0, step: sys() === 'SI' ? 0.5 : 1000 }, function (v) { a.room.ql = v; }, 'room_ql'));
                body.appendChild(g);
                var r = document.createElement('div');
                r.className = 'psy-radio-row';
                r.appendChild(inlineLabel('Solve for:'));
                r.appendChild(help('room_solve'));
                [['db', 'Supply temperature from airflow'], ['cfm', 'Airflow from supply temperature']].forEach(function (m) {
                    r.appendChild(radio('psy-room-solve', m[0], m[1], a.room.solve === m[0], function () {
                        a.room.solve = m[0]; save(); buildForm(); recompute();
                    }));
                });
                body.appendChild(r);
                var g2 = fields();
                if (a.room.solve === 'cfm') {
                    g2.appendChild(numberField('Supply dry bulb', 'temp', a.room.dbSupply, { step: 0.5 }, function (v) { a.room.dbSupply = v; }, 'room_dbsupply'));
                } else {
                    var f = numberField('Supply airflow', 'flow', a.room.cfm, { min: 0, step: 50 }, function (v) { a.room.cfm = v; }, 'room_cfm');
                    f.querySelector('input').placeholder = 'system';
                    g2.appendChild(f);
                }
                body.appendChild(g2);
            }
            body.appendChild(errorLine('room'));
        }, 'room'));

        if (!anyStageOn()) form.appendChild(hint('Add components with the chips above to build the system.'));
    }

    function buildFanFields(body, fan, errId) {
        var r = document.createElement('div');
        r.className = 'psy-radio-row';
        r.appendChild(inlineLabel('Heat from:'));
        r.appendChild(help('fan_mode'));
        [['bhp', 'Brake horsepower'], ['dt', 'Temperature rise']].forEach(function (m) {
            r.appendChild(radio('psy-' + errId + '-mode', m[0], m[1], fan.mode === m[0], function () {
                fan.mode = m[0]; save(); buildForm(); recompute();
            }));
        });
        body.appendChild(r);
        var g = fields();
        if (fan.mode === 'dt') {
            g.appendChild(numberField('Temperature rise', 'dtemp', fan.dt, { min: 0, step: 0.1 }, function (v) { fan.dt = v; }, 'fan_dt'));
        } else {
            g.appendChild(numberField('Fan power', 'hp', fan.bhp, { min: 0, step: 0.25 }, function (v) { fan.bhp = v; }, 'fan_bhp'));
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
            g.appendChild(help('fan_motor'));
            if (fan.motorIn) {
                g.appendChild(numberField('Motor eff.', 'pct', fan.motorEff, { min: 1, max: 100, step: 1 }, function (v) { fan.motorEff = v; }, 'fan_eff'));
            }
        }
        body.appendChild(g);
        body.appendChild(errorLine(errId));
    }

    // A chain stage: swatch + title + remove button. Only rendered while
    // the stage is part of the system (see buildAhuForm).
    function stageSection(pointId, titleText, obj, buildBody, helpKey) {
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
        if (helpKey) head.appendChild(help(helpKey));
        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'psy-icon-btn psy-stage-remove';
        remove.title = 'Remove from the system';
        remove.setAttribute('aria-label', 'Remove ' + titleText);
        remove.appendChild(HHpro.UI.icon('x'));
        remove.addEventListener('click', function () {
            obj.enabled = false;
            enforceStreamRules();
            save(); buildForm(); recompute();
        });
        head.appendChild(remove);
        sec.appendChild(head);

        var body = document.createElement('div');
        body.className = 'psy-stage-body';
        buildBody(sec, body);
        sec.appendChild(body);
        return sec;
    }

    function renderFlowFields() {
        var a = state.ahu;
        var wrap = refs.flowFields;
        if (!wrap) return;
        wrap.innerHTML = '';
        var both = a.oa.enabled && a.ra.enabled;
        var g = fields();
        if (both && a.erv.enabled && a.erv.mode === 'doas') {
            g.appendChild(numberField('Outdoor air', 'flow', a.oaCfm, { min: 0, step: 50 }, function (v) { a.oaCfm = v; }, 'oa_cfm'));
            g.appendChild(numberField('Exhaust airflow', 'flow', a.raCfm, { min: 0, step: 50 }, function (v) { a.raCfm = v; }, 'exh_cfm'));
        } else if (both) {
            var modes = document.createElement('div');
            modes.className = 'psy-radio-row';
            [['each', 'Per stream'], ['pct', 'Total + % outdoor air']].forEach(function (m) {
                modes.appendChild(radio('psy-flow-mode', m[0], m[1], a.flowMode === m[0], function () {
                    a.flowMode = m[0]; save(); renderFlowFields(); recompute();
                }));
            });
            modes.appendChild(help('flowmode'));
            wrap.appendChild(modes);
            if (a.flowMode === 'pct') {
                g.appendChild(numberField('Total airflow', 'flow', a.totalCfm, { min: 0, step: 50 }, function (v) { a.totalCfm = v; }, 'total_cfm'));
                g.appendChild(numberField('Outdoor air', 'pct', a.oaPct, { min: 0, max: 100, step: 1 }, function (v) { a.oaPct = v; }, 'oa_pct'));
            } else {
                g.appendChild(numberField('Outdoor air', 'flow', a.oaCfm, { min: 0, step: 50 }, function (v) { a.oaCfm = v; }, 'oa_cfm'));
                g.appendChild(numberField('Return air', 'flow', a.raCfm, { min: 0, step: 50 }, function (v) { a.raCfm = v; }, 'ra_cfm'));
            }
        } else if (a.oa.enabled) {
            g.appendChild(numberField('Outdoor air', 'flow', a.oaCfm, { min: 0, step: 50 }, function (v) { a.oaCfm = v; }, 'oa_cfm'));
        } else if (a.ra.enabled) {
            g.appendChild(numberField('Return air', 'flow', a.raCfm, { min: 0, step: 50 }, function (v) { a.raCfm = v; }, 'ra_cfm'));
        } else {
            g.appendChild(hint('Add an air stream with the chips above.'));
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
    function numberField(labelText, kind, ipValue, opts, onChange, helpKey) {
        var wrap = document.createElement('label');
        wrap.className = 'psy-field';
        var label = document.createElement('span');
        label.className = 'psy-field-label';
        label.textContent = labelText;
        wrap.appendChild(label);
        if (helpKey) wrap.appendChild(help(helpKey));
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

    // Value of `newKey` for the state {obj.db, oldKey, obj.value}, in IP,
    // or null when there is no dry bulb (humidifier target) or the
    // current value does not describe a valid state.
    function convertSecond(obj, oldKey, newKey) {
        if (oldKey === newKey) return null;
        var db = Number(obj.db), v = Number(obj.value);
        if (!isFinite(db) || obj.value === null || obj.value === undefined || !isFinite(v)) return null;
        try {
            var st = Psy.state(db, oldKey, v, Psy.pressureFromAltitude(state.altitude));
            var out = Psy.propertyValue(st, newKey);
            return isFinite(out) ? out : null;
        } catch (e) { return null; }
    }

    // Property selector + value for `obj` ({key, value}); optional key subset.
    function buildSecondProperty(obj, labelText, allowedKeys, helpKey) {
        var second = document.createElement('div');
        second.className = 'psy-field';
        if (labelText) {
            var l = document.createElement('span');
            l.className = 'psy-field-label';
            l.textContent = labelText;
            second.appendChild(l);
        }
        if (helpKey) second.appendChild(help(helpKey));
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
            // Same air state, new property: re-express the value so the
            // point does not jump (78 F WB becomes 47.3% RH, not 78% RH).
            var converted = convertSecond(obj, obj.key, select.value);
            obj.key = select.value;
            unit.textContent = U.unit(kindForKey(obj.key), sys());
            if (converted !== null) {
                obj.value = converted;
                input.value = secondDisp(obj);
            } else {
                obj.value = input.value === '' ? null : secondFromDisp(obj, toNum(input.value, null));
            }
            save(); recompute();
        });
        input.addEventListener('input', function () {
            obj.value = input.value === '' ? null : secondFromDisp(obj, toNum(input.value, null));
            save(); recompute();
        });
        return second;
    }

    // Dry bulb + (property selector, value) for one air state.
    function buildStateFields(obj, id, helpBase) {
        var wrap = document.createElement('div');
        wrap.className = 'psy-state-fields';
        var grid = fields();
        grid.appendChild(numberField('Dry bulb', 'temp', obj.db, { step: 0.5 }, function (v) { obj.db = v; }, helpBase ? helpBase + '_db' : null));
        grid.appendChild(buildSecondProperty(obj, null, null, helpBase ? helpBase + '_second' : null));
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
        if (!a.preset || !STAGE_KEYS.some(function (k) { return a[k].enabled; })) {
            res.callouts = [{ title: 'Psychrometric calculator', rows: [{ swatch: null, text: a.preset
                ? 'Add components with the chips in the panel to start plotting.'
                : 'Choose a system type in the panel to start plotting.' }] }];
            res.tablePoints = [];
            return res;
        }

        function addPoint(id, label, st, title) {
            points.push({ id: id, label: label, state: st, cls: 'psy-point-' + id, title: title || label });
        }

        var oa = a.oa.enabled ? tryState(a.oa, 'oa', P, onError) : null;
        var ra = a.ra.enabled ? tryState(a.ra, 'ra', P, onError) : null;
        var both = a.oa.enabled && a.ra.enabled;
        // Dedicated outdoor air arrangement: return air is the exhaust side
        // of the recovery device only and never enters the supply.
        var doas = both && a.erv.enabled && a.erv.mode === 'doas';
        if (oa) addPoint('oa', 'OA', oa, 'Outdoor air');
        if (ra) addPoint('ra', 'RA', ra, doas ? 'Return air (exhaust side only, not mixed)' : 'Return air');

        // Airflow per stream
        var oaCfm = null, raCfm = null;
        if (both) {
            if (a.flowMode === 'pct' && !doas) {
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
                    var exhCfm = doas ? raCfm
                        : ((a.erv.exhCfm !== null && a.erv.exhCfm !== undefined) ? Number(a.erv.exhCfm) : oaCfm);
                    var ratio = (oaCfm > 0 && exhCfm !== null && isFinite(exhCfm)) ? Math.min(1, exhCfm / oaCfm) : 1;
                    var er = Psy.erv(oa, ra, a.erv.effS, a.erv.effL, P, ratio);
                    addPoint('er', 'ER', er, 'Outdoor air leaving energy recovery');
                    lines.push({ from: 'oa', to: 'er', cls: 'psy-line-process', arrow: true });
                    oaStream = er; oaStreamId = 'er';
                    res.erv = { from: oa, to: er, mode: doas ? 'doas' : 'mix', exhCfm: exhCfm, ratio: ratio };
                } catch (e) { onError('erv', e.message); }
            }
        }

        // Mixing / entering state
        var streams = [];
        if (a.oa.enabled && oaStream) streams.push({ id: oaStreamId, label: oaStreamId.toUpperCase(), state: oaStream, cfm: oaCfm, raw: oa });
        if (a.ra.enabled && ra && !doas) streams.push({ id: 'ra', label: 'RA', state: ra, cfm: raCfm, raw: ra });
        var enabledCount = doas ? 1 : (a.oa.enabled ? 1 : 0) + (a.ra.enabled ? 1 : 0);

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
                var latentOnly = !!a.room.latentOnly;
                var qs = latentOnly ? null : toNum(a.room.qs, null), ql = toNum(a.room.ql, 0);
                var roomRes = { state: rm, qs: qs, ql: ql, latentOnly: latentOnly };
                var sysCfm = mixed ? mixed.cfm : null;
                // Airflow the latent check is made on: the ventilation air in
                // DOAS mode, otherwise the supply air sized for the room.
                var latCfm = null, latSource = '';
                if (latentOnly) {
                    if (a.room.vozCfm !== null && a.room.vozCfm !== undefined) { latCfm = Number(a.room.vozCfm); latSource = 'ventilation airflow'; }
                    else if (a.oa.enabled && oaCfm !== null) { latCfm = oaCfm; latSource = 'outdoor airflow'; }
                    else { latCfm = sysCfm; latSource = 'system airflow'; }
                    if (latCfm === null) onError('room', 'Enter the ventilation airflow.');
                } else if (qs !== null && qs > 0) {
                    var shr = qs / (qs + Math.max(0, ql));
                    roomRes.shr = shr;
                    var vpLow = (s.view && isFinite(s.view.dbMin)) ? s.view.dbMin : s.dbMin;
                    paths.push({ pts: Psy.roomLine(rm, shr, P, Math.min(vpLow, -20)), cls: 'psy-line-room' });
                    try {
                        var given = a.room.solve === 'cfm'
                            ? { dbSupply: a.room.dbSupply }
                            : { cfm: (a.room.cfm !== null && a.room.cfm !== undefined) ? a.room.cfm : sysCfm };
                        if (given.cfm === null) throw new Error('Enter a supply airflow (or include an air stream with airflow).');
                        roomRes.required = Psy.supplyFromRoom(rm, qs, ql, given, basis, P);
                        addPoint('rq', 'REQ', roomRes.required.state, 'Required supply air');
                        latCfm = roomRes.required.cfm; latSource = 'supply airflow';
                    } catch (e) { onError('room', e.message); }
                    if (res.final && m > 0) {
                        roomRes.delivered = Psy.process(rm, res.final, m); // positive = delivered cooling
                    }
                } else {
                    onError('room', 'Enter the room sensible load.');
                }

                // Law #1: the wettest supply air that still carries the latent
                // load on that airflow. Drawn as a constant-humidity line with
                // the too-humid band above it.
                if (latCfm !== null && ql !== null && ql > 0) {
                    try {
                        var lim = Psy.latentLimit(rm, ql, latCfm, basis, P);
                        lim.source = latSource;
                        roomRes.dpLimit = lim;
                        var dbLoL = -100, dbHiL = 200, wTopL = 0.06;
                        paths.unshift({ pts: [{ db: dbLoL, w: lim.w }, { db: dbHiL, w: lim.w }, { db: dbHiL, w: wTopL }, { db: dbLoL, w: wTopL }],
                                        cls: 'psy-dp-region', fill: true, under: true });
                        paths.push({ pts: [{ db: dbLoL, w: lim.w }, { db: dbHiL, w: lim.w }], cls: 'psy-line-dplimit', under: true,
                                     label: 'Max supply DP ' + fmtU('temp', lim.dp), labelAt: 'end', labelCls: 'psy-label-dplimit' });
                        if (res.final) {
                            var fin = res.final;
                            lim.finalOk = fin.w <= lim.w * 1.02;   // same 2% tolerance as the load check
                            lim.carried = Psy.latentCarried(rm, fin, lim.massFlow);
                            if (fin.w < rm.w) lim.minCfm = ql / (Psy.HFG_LATENT * (rm.w - fin.w) * (lim.massFlow / latCfm));
                        }
                    } catch (e) { onError('room', e.message); }
                }
                res.room = roomRes;

                // Explainer box: what the room line / limit mean and whether
                // the supply passes, sensible and latent reported separately.
                var rrows = [];
                if (latentOnly) {
                    rrows.push({ swatch: null, text: 'Ventilation air carries the latent load; sensible is left to the zone equipment' });
                } else if (roomRes.shr !== undefined) {
                    rrows.push({ swatch: 'room', text: 'Room line, SHR ' + fmt(roomRes.shr, 2) +
                        ' - supply air on this line matches the room sensible/latent split' });
                    if (roomRes.required) {
                        var rq = roomRes.required;
                        rrows.push({ swatch: 'req', text: 'REQ = supply that carries the load: ' +
                            (a.room.solve === 'cfm'
                                ? fmtU('flow', rq.cfm) + ' at ' + fmtU('temp', rq.state.db)
                                : fmtU('temp', rq.state.db) + ' at ' + fmtU('flow', rq.cfm)) });
                    }
                }
                if (roomRes.dpLimit) {
                    var L0 = roomRes.dpLimit;
                    rrows.push({ swatch: 'dplimit', text: 'Max supply dew point ' + fmtU('temp', L0.dp) + ' (' + fmtU('grains', L0.grains) +
                        ') to carry ' + fmtPower(ql) + ' latent on ' + fmtU('flow', L0.cfm) });
                }
                if (res.final && roomRes.delivered) {
                    var dd = roomRes.delivered, sOk = dd.sensible >= roomRes.qs * 0.98;
                    rrows.push({ swatch: sOk ? 'ok' : 'no', text: 'Sensible: ' + res.finalLabel + ' delivers ' + fmtPower(dd.sensible) +
                        ' of ' + fmtPower(roomRes.qs) + (sOk ? ' - OK' : ' - short') });
                }
                if (res.final && roomRes.dpLimit) {
                    var L1 = roomRes.dpLimit;
                    rrows.push({ swatch: L1.finalOk ? 'ok' : 'no', text: 'Latent: ' + res.finalLabel + ' dew point ' + fmtU('temp', res.final.dp) +
                        (L1.finalOk ? ' - dry enough' : ' - too humid, dry to ' + fmtU('temp', L1.dp)) });
                }
                if (rrows.length) {
                    res.callouts = res.callouts || [];
                    res.callouts.push({ title: latentOnly ? 'Room check (Law #1)' : 'Room check', rows: rrows });
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
                er.push(['Arrangement', e.mode === 'doas' ? 'Dedicated OA unit, return air is exhaust only' : 'Return air mixes with outdoor air']);
                if (e.exhCfm !== null && isFinite(e.exhCfm)) er.push(['Exhaust airflow', fmtU('flow', e.exhCfm)]);
                if (e.ratio < 0.999) er.push(['Flow correction', 'Exhaust is ' + fmt(e.ratio * 100, 0) + '% of outdoor flow; recovery scaled to match']);
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
                if (r.latentOnly) rr.push(['Basis', 'Ventilation air carries all the latent load (DOAS); sensible handled by the zone equipment']);
                if (r.shr !== undefined) rr.push(['Room sensible heat ratio', fmt(r.shr, 3)]);
                if (r.required) {
                    var q = r.required;
                    rr.push([a.room.solve === 'cfm' ? 'Required airflow' : 'Required supply dry bulb',
                        a.room.solve === 'cfm' ? fmtU('flow', q.cfm) : fmtU('temp', q.state.db)]);
                    rr.push(['Required supply humidity', fmtU('grains', q.state.grains) + ' (' + fmt(q.state.rh * 100, 0) + '% RH)']);
                    if (!q.feasible && q.note) rr.push(['Note', q.note]);
                }
                if (r.dpLimit) {
                    var L = r.dpLimit;
                    rr.push(['Airflow for latent check', fmtU('flow', L.cfm) + ' (' + L.source + ')']);
                    rr.push(['Max supply humidity ratio', fmtU('grains', L.grains)]);
                    rr.push(['Max supply dew point', fmtU('temp', L.dp)]);
                    if (sys() === 'IP') rr.push(['Latent formula', 'Q = ' + fmt(L.factor, 2) + ' × CFM × Δgr/lb' + (a.basis === 'actual' ? ' (actual air)' : ' (standard air)')]);
                    if (res.final) {
                        rr.push([res.finalLabel + ' dew point', fmtU('temp', res.final.dp) + ' vs ' + fmtU('temp', L.dp) + ' max' + (L.finalOk ? '  OK' : '  too humid')]);
                        if (L.carried !== undefined) rr.push(['Latent carried by ' + fmtU('flow', L.cfm) + ' at ' + res.finalLabel,
                            fmtPower(Math.max(0, L.carried)) + ' vs ' + fmtPower(r.ql) + ' room latent']);
                        if (L.minCfm !== undefined) rr.push(['Min airflow at ' + res.finalLabel + ' dew point', fmtU('flow', L.minCfm)]);
                    }
                }
                if (r.delivered && res.final) {
                    var d = r.delivered;
                    var sensOk = d.sensible >= r.qs * 0.98, latOk = d.latent >= r.ql * 0.98;
                    rr.push(['Delivered sensible (' + res.finalLabel + ')', fmtPower(d.sensible) + ' vs ' + fmtPower(r.qs) + (sensOk ? '  OK' : '  short')]);
                    rr.push(['Delivered latent (' + res.finalLabel + ')', fmtPower(d.latent) + ' vs ' + fmtPower(r.ql) + (latOk ? '  OK' : '  short')]);
                    rr.push(['Supply SHR vs room SHR', fmt(d.total ? d.sensible / d.total : 0, 3) + ' vs ' + fmt(r.shr, 3)]);
                    rr.push(['Result', sensOk && latOk ? 'Supply air meets the room load' : 'Supply air does not meet the room load']);
                }
                blocks.push({ title: r.latentOnly ? 'Room (RM), Law #1 dew point check' : 'Room (RM)', rows: rr });
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
            box.appendChild(hint(state.mode === 'ahu' && !anyStageOn()
                ? (state.ahu.preset ? 'Add components to begin.' : 'Choose a system type to begin.')
                : 'Enter a valid air state to see its properties.'));
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
            if (/\bshort\b|does not meet|Not available|too humid/.test(r[1])) dd.classList.add('is-warn');
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
        var p = presetByKey(a.preset);
        if (p && p.short) parts.push(p.short);
        else if (a.oa.enabled && a.ra.enabled) parts.push(a.erv.enabled && a.erv.mode === 'doas' ? '100% OA' : 'Mixed air');
        else if (a.oa.enabled) parts.push('100% OA');
        else if (a.ra.enabled) parts.push('Return air');
        else parts.push('Psychrometrics');
        if (a.coil.enabled) parts.push('cooling coil');
        if (a.reheat.enabled) parts.push('reheat');
        if (a.room.enabled) parts.push(a.room.latentOnly ? 'dew point check' : 'room check');
        return parts.join(' + ');
    }

    function summarize(snap) {
        var s = fromSnapshot(snap);
        if (s.mode === 'points') return s.points.length + ' state point' + (s.points.length === 1 ? '' : 's');
        var a = s.ahu, bits = [];
        var p = presetByKey(a.preset);
        if (p && p.short) bits.push(p.short);
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

    // Saved calculations are stored by the shared store in calculators.js;
    // this calculator only sees its own entries.
    function listSaved() {
        return HHpro.Calculators.saved.list().filter(function (c) { return HHpro.Calculators.saved.calcKey(c) === 'psychrometrics'; });
    }

    function findSaved(id) {
        var c = HHpro.Calculators.saved.find(id);
        return (c && HHpro.Calculators.saved.calcKey(c) === 'psychrometrics') ? c : null;
    }

    function deleteSaved(id) { HHpro.Calculators.saved.remove(id); }

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
                HHpro.Calculators.saved.add({ name: name, calc: 'psychrometrics', snapshot: deepClone(state) });
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
