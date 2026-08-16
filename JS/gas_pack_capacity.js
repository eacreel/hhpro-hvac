/* ============================================================
   HHpro - Gas Pack RTU capacity tables (HHpro.GasPackCapacity)
   ------------------------------------------------------------
   Backs the condition-aware Gas Pack RTU section of Design
   Search. Every number on the schedule today came from a
   selection Eric ran by hand at one condition (80/67 EAT, 95
   ambient, 0.5" ESP); these tables let the site answer for any
   condition Daikin publishes, without re-running the software
   for every combination.

   Data: DATA/JSON/gas_pack_capacity.json (built by
   convert_to_json.py from "Daikin LC RTU Capacity Tables.xlsx").
   Keyed by CABINET - DSG036, DHG090, ... - because Daikin
   publishes one cooling table per cabinet that applies to every
   voltage and motor built on it. Voltage and motor only change
   the electrical block.

   The off-grid policy (worst-case, never interpolate) lives in
   capacity_core.js and is shared with Multi Position Splits.
   Airflow is handled here rather than there: a cabinet qualifies
   only if one of its three rated airflows falls inside the CFM
   tolerance the engineer entered, and capacity is then read at a
   RATED airflow - never at the typed value, which would pair a
   real capacity with an airflow it was not measured at.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var CAPACITY_URL = 'DATA/JSON/gas_pack_capacity.json';
    var PRODUCT = 'gas_packs';

    var core = HHpro.CapacityCore;
    var cache = null;
    var loadPromise = null;

    // Only standard and high static are offered. Medium (L) exists on the
    // 7.5-12.5 ton cabinets but is not something Eric quotes, and the main
    // schedule carries no L models at all.
    var OFFERED_MOTORS = ['D', 'W'];
    var MOTOR_LABELS = { D: 'Standard Static', W: 'High Static' };
    // Heat-size letter in a schedule model number -> the Gas Heating sheet's
    // size name (DSG0363D**M** is the medium heat exchanger).
    var HEAT_LETTERS = { L: 'Low', M: 'Medium', H: 'High' };
    var HEAT_TO_LETTER = { Low: 'L', Medium: 'M', High: 'H' };
    var EFFICIENCY_LABELS = { LOW: 'Low', HIGH: 'High' };
    // Hot gas reheat is a DHG-only option, and only up to 12.5 tons.
    var HGRH_MAX_TONS = 12.5;

    // Sensible heat rate for standard air: BTU/h = 1.08 x CFM x deltaT.
    var AIR_CONST = 1.08;

    // -----------------------------------------------------------------
    // Loading
    // -----------------------------------------------------------------
    function load() {
        if (cache) return Promise.resolve(cache);
        if (loadPromise) return loadPromise;
        loadPromise = fetch(CAPACITY_URL)
            .then(function (r) {
                if (!r.ok) throw new Error('gas pack capacity tables ' + r.status);
                return r.json();
            })
            .then(function (json) { cache = json || { cabinets: {} }; return cache; })
            .catch(function () {
                // Missing/unreadable: degrade to "no tables" so Design Search
                // falls back to its schema targets instead of erroring.
                cache = { cabinets: {} };
                return cache;
            });
        return loadPromise;
    }

    function ensureFor(productKey) {
        return (productKey === PRODUCT) ? load() : Promise.resolve(cache);
    }

    function cabinets() { return (cache && cache.cabinets) || {}; }

    // -----------------------------------------------------------------
    // Model numbers
    // -----------------------------------------------------------------
    /**
     * Split a schedule model number into its parts.
     * 'DSG0363DM' -> { cabinet:'DSG036', voltage:'208/3', motor:'D',
     *                  heatLetter:'M', heat:'Medium' }
     * Returns null for anything that isn't a gas pack model number.
     */
    function parseModel(model) {
        var s = String(model || '').trim().toUpperCase();
        if (!/^D[SH]G\d{3}[34][DLW][LMH]?$/.test(s)) return null;
        var letter = s.charAt(8) || null;
        return {
            cabinet: s.slice(0, 6),
            voltage: s.charAt(6) === '3' ? '208/3' : '460/3',
            motor: s.charAt(7),
            heatLetter: letter,
            heat: letter ? HEAT_LETTERS[letter] : null
        };
    }

    /** Rebuild a model number from its parts (the motor letter is what the
     *  design-values toggle rewrites when High Static is chosen). */
    function buildModel(parts) {
        var volt = parts.voltage === '460/3' ? '4' : '3';
        var letter = parts.heatLetter || HEAT_TO_LETTER[parts.heat] || '';
        return parts.cabinet + volt + parts.motor + letter;
    }

    // -----------------------------------------------------------------
    // Form options
    // -----------------------------------------------------------------
    function formOptions() {
        var cabs = cabinets();
        var tons = {}, volts = {}, ambients = {}, effs = {};
        Object.keys(cabs).forEach(function (name) {
            var c = cabs[name];
            if (c.tons != null) tons[c.tons] = true;
            Object.keys(c.electrical || {}).forEach(function (v) { volts[v] = true; });
            (((c.axes || {}).oaCooling) || []).forEach(function (a) { ambients[a] = true; });
            if (c.efficiency) effs[c.efficiency] = true;
        });
        function nums(o) {
            return Object.keys(o).map(Number).sort(function (a, b) { return a - b; });
        }
        return {
            tons: nums(tons),
            electrical: Object.keys(volts).sort(),
            motors: OFFERED_MOTORS.map(function (m) {
                return { value: m, label: MOTOR_LABELS[m] };
            }),
            ambients: nums(ambients),
            // Low before High -- ascending efficiency, not alphabetical.
            efficiencies: ['LOW', 'HIGH'].filter(function (e) { return effs[e]; })
                .map(function (e) { return { value: e, label: EFFICIENCY_LABELS[e] }; })
        };
    }

    // -----------------------------------------------------------------
    // Gas heat
    // -----------------------------------------------------------------
    /** High-stage temperature rise (degF) a heat size produces at an airflow. */
    function riseFor(outputMbh, cfm) {
        var o = Number(outputMbh), c = Number(cfm);
        if (!isFinite(o) || !isFinite(c) || c <= 0) return null;
        return o * 1000 / (AIR_CONST * c);
    }

    function inRange(value, range) {
        if (!range || value == null) return true;   // no published range -> can't reject
        return value >= range[0] && value <= range[1];
    }

    /**
     * Gas heat performance for one heat size at an airflow.
     * Returns null when the resulting rise falls outside the range Daikin
     * publishes for that furnace - an out-of-range rise is not a selection
     * you can make, so the size is dropped rather than shown as a near miss.
     */
    function heatAt(heat, cfm) {
        var riseHigh = riseFor(heat.outputHigh, cfm);
        if (riseHigh == null || !inRange(riseHigh, heat.riseHigh)) return null;
        var riseLow = riseFor(heat.outputLow, cfm);
        return {
            size: heat.size,
            letter: HEAT_TO_LETTER[heat.size] || null,
            inputHigh: heat.inputHigh, outputHigh: heat.outputHigh,
            inputLow: heat.inputLow, outputLow: heat.outputLow,
            riseHigh: riseHigh,
            riseLow: riseLow,
            // Low fire is reported, not gated: the unit is selected on high
            // stage, and a low stage that drifts under its published range
            // is a modulation detail rather than a reason to reject.
            riseLowInRange: inRange(riseLow, heat.riseLow),
            riseHighRange: heat.riseHigh, riseLowRange: heat.riseLow,
            thermalEff: heat.thermalEff
        };
    }

    // -----------------------------------------------------------------
    // Electrical
    // -----------------------------------------------------------------
    /**
     * MCA / MOP / HP for a cabinet at a voltage and motor, for the
     * electrical options ticked on the form.
     * opts = { convOutlet: bool, powerExhaust: bool }
     */
    function electricalFor(cabinet, voltage, motor, opts) {
        var cab = cabinets()[cabinet];
        var e = cab && cab.electrical && cab.electrical[voltage] &&
                cab.electrical[voltage][motor];
        if (!e) return null;
        var conv = !!(opts && opts.convOutlet);
        var pe = !!(opts && opts.powerExhaust);
        var mca = e.mca, mop = e.mop;
        if (conv && pe) { mca = e.mcaBoth; mop = e.mopBoth; }
        else if (conv) { mca = e.mcaConv; mop = e.mopConv; }
        else if (pe) { mca = e.mcaPe; mop = e.mopPe; }
        return {
            model: e.model, voltage: voltage, motor: motor,
            mca: mca, mop: mop, hp: e.hp,
            convOutlet: conv, powerExhaust: pe,
            convFla: e.convFla, peFla: e.peFla
        };
    }

    // -----------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------
    function within(value, target, tolPct) {
        if (target == null || !isFinite(target) || target <= 0) return true;
        var tol = (tolPct == null ? 10 : tolPct) / 100;
        return Math.abs(value - target) <= Math.abs(target) * tol;
    }

    function deviation(value, target) {
        if (target == null || !isFinite(target) || target <= 0) return 0;
        return Math.abs(value - target) / target;
    }

    /** Rated airflows inside the CFM tolerance window. */
    function airflowsInWindow(axes, cfm, tolPct) {
        var all = ((axes || {}).airflow || []).map(Number).filter(isFinite);
        if (cfm == null || !isFinite(cfm)) return all;
        return all.filter(function (a) { return within(a, cfm, tolPct); });
    }

    /**
     * Run a design search.
     *
     * criteria = {
     *   tons, electrical, motor, efficiency, hgrh,   // hard filters, null = any
     *   ambient,                                     // degF, required
     *   eatDb, eatWb,                                // degF, required
     *   cfm:{value,tol}, coolTotal:{value,tol}, coolSensible:{value,tol},
     *   heatRise:{value,tol},
     *   convOutlet, powerExhaust                     // booleans
     * }
     *
     * Returns { results:[...], skipped:[{cabinet, reason}] } with results
     * sorted best-match first. One result per cabinet + voltage + motor +
     * heat size, because those are four genuinely different units.
     */
    function search(criteria) {
        var c = criteria || {};
        var cabs = cabinets();
        var results = [];
        var skipped = [];

        Object.keys(cabs).forEach(function (name) {
            var cab = cabs[name];

            if (cab.coolingUnavailable) {
                skipped.push({ cabinet: name, tons: cab.tons,
                               reason: 'no published cooling data' });
                return;
            }
            if (c.tons != null && Number(cab.tons) !== Number(c.tons)) return;
            if (c.efficiency && cab.efficiency !== c.efficiency) return;
            if (c.hgrh === 'YES' &&
                (cab.family !== 'DHG' || Number(cab.tons) > HGRH_MAX_TONS)) return;

            var cfmTarget = (c.cfm && c.cfm.value) || null;
            var cfmTol = (c.cfm && c.cfm.tol);
            var airflows = airflowsInWindow(cab.axes, cfmTarget, cfmTol);
            if (!airflows.length) return;

            var cool = core.coolingAt(
                cab,
                { oa: c.ambient, eatDb: c.eatDb, eatWb: c.eatWb },
                {
                    total: (c.coolTotal && c.coolTotal.value) || null,
                    sensible: (c.coolSensible && c.coolSensible.value) || null
                },
                { airflows: airflows }
            );
            if (!cool.applicable || cool.outOfRange || cool.noData || !cool.result) {
                if (cool.outOfRange) {
                    skipped.push({ cabinet: name, tons: cab.tons,
                                   reason: 'design condition outside the rated table',
                                   ranges: cool.ranges });
                }
                return;
            }
            var r = cool.result;
            if (!within(r.total, c.coolTotal && c.coolTotal.value,
                        c.coolTotal && c.coolTotal.tol)) return;
            if (!within(r.sensible, c.coolSensible && c.coolSensible.value,
                        c.coolSensible && c.coolSensible.tol)) return;

            // Voltage x motor x heat size -> one result each.
            Object.keys(cab.electrical || {}).forEach(function (voltage) {
                if (c.electrical && voltage !== c.electrical) return;
                OFFERED_MOTORS.forEach(function (motor) {
                    if (c.motor && motor !== c.motor) return;
                    var elec = electricalFor(name, voltage, motor, c);
                    if (!elec) return;

                    (cab.heat || []).forEach(function (h) {
                        var heat = heatAt(h, r.airflow);
                        if (!heat) return;   // rise outside the published range
                        if (!within(heat.riseHigh, c.heatRise && c.heatRise.value,
                                    c.heatRise && c.heatRise.tol)) return;

                        var score =
                            deviation(r.total, c.coolTotal && c.coolTotal.value) +
                            deviation(r.sensible, c.coolSensible && c.coolSensible.value) +
                            deviation(r.airflow, cfmTarget) +
                            deviation(heat.riseHigh, c.heatRise && c.heatRise.value);

                        results.push({
                            cabinet: name,
                            family: cab.family,
                            efficiency: cab.efficiency,
                            tons: cab.tons,
                            model: buildModel({ cabinet: name, voltage: voltage,
                                                motor: motor, heat: heat.size }),
                            voltage: voltage,
                            motor: motor,
                            motorLabel: MOTOR_LABELS[motor],
                            hgrh: (cab.family === 'DHG' &&
                                   Number(cab.tons) <= HGRH_MAX_TONS)
                                ? (c.hgrh || 'NO') : 'NO',
                            cooling: {
                                airflow: r.airflow,
                                eatDb: r.eatDb, eatWb: r.eatWb,
                                ambient: r.oaCooling,
                                total: r.total, sensible: r.sensible,
                                lat: r.lat
                            },
                            // Which axes were snapped to a harsher rated point
                            // (null when the design point was rated exactly).
                            offGrid: Object.keys(cool.offGrid || {}).length
                                ? cool.offGrid : null,
                            heat: heat,
                            electrical: elec,
                            score: score
                        });
                    });
                });
            });
        });

        results.sort(function (a, b) {
            if (a.score !== b.score) return a.score - b.score;
            return a.model < b.model ? -1 : (a.model > b.model ? 1 : 0);
        });
        return { results: results, skipped: skipped };
    }

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------
    HHpro.GasPackCapacity = {
        PRODUCT: PRODUCT,
        load: load,
        ensureFor: ensureFor,
        isProduct: function (productKey) { return productKey === PRODUCT; },
        hasTables: function () {
            return !!(cache && cache.cabinets && Object.keys(cache.cabinets).length);
        },
        cabinets: cabinets,
        formOptions: formOptions,
        parseModel: parseModel,
        buildModel: buildModel,
        riseFor: riseFor,
        heatAt: heatAt,
        electricalFor: electricalFor,
        search: search,
        MOTOR_LABELS: MOTOR_LABELS,
        HEAT_LETTERS: HEAT_LETTERS
    };

    core.register(PRODUCT, HHpro.GasPackCapacity);
})();
