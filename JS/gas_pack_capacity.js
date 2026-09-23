/* ============================================================
   HHpro - LC RTU capacity tables (HHpro.GasPackCapacity)
   ------------------------------------------------------------
   Backs the condition-aware Light Commercial RTU section of
   Design Search: DSG / DHG gas packs and DSH / DHH / DVH heat
   pumps. Every number on the schedule today came from a
   selection Eric ran by hand at one condition (80/67 EAT, 95
   ambient, 0.5" ESP); these tables let the site answer for any
   condition Daikin publishes, without re-running the software
   for every combination.

   Data: DATA/JSON/gas_pack_capacity.json (built by
   convert_to_json.py from "Daikin LC RTU Capacity Tables.xlsx").
   Keyed by CABINET - DSG036, DHG090, DSH036, ... - because Daikin
   publishes one cooling table per cabinet that applies to every
   voltage and motor built on it. Voltage and motor only change
   the electrical block (and, for heat pumps, the heat kit).

   Heat pump heating is read at a heating design outdoor DRY
   bulb with 70 F entering air (the only indoor temperature the
   DSH / DHH tables publish). DVH tables are rated on outdoor WET
   bulb, so DVH is looked up at DB - 2 F (AHRI's 17 F DB / 15 F
   WB spread).

   Design Search picks every condition (ambient, EAT DB / WB,
   heating ambient) from the values these tables publish, and the
   search runs with `exact`: a unit is read only at a published
   point, never snapped to a harsher neighbour, and a unit with no
   rating at the chosen condition is left out (and named). The
   snapping policy in capacity_core.js still exists for callers
   that don't ask for exact.
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
    var EFFICIENCY_LABELS = { LOW: 'Standard', HIGH: 'High', VARIABLE: 'Variable Speed' };
    var TYPE_LABELS = { 'GAS': 'Gas', 'HEAT PUMP': 'Heat Pump' };
    // Heat pump heating: coil entering air, and the outdoor wet bulb
    // depression used for the wet-bulb-rated DVH tables.
    var HP_EAT = 70;
    var HP_WB_DEPRESSION = 2;
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
     * 'DSG0363DM' -> { type:'GAS', cabinet:'DSG036', voltage:'208/3',
     *                  motor:'D', heatLetter:'M', heat:'Medium' }
     * 'DSH0363'   -> { type:'HEAT PUMP', cabinet:'DSH036', voltage:'208/3',
     *                  motor:'D', heatLetter:null, heat:null }
     * Heat pump schedule rows carry no motor letter (they are the
     * standard-static selections), so a bare one reads as D.
     * Returns null for anything that isn't an LC RTU model number.
     */
    function parseModel(model) {
        var s = String(model || '').trim().toUpperCase();
        var voltage = s.charAt(6) === '3' ? '208/3' : '460/3';
        if (/^D[SH]G\d{3}[34][DLW][LMH]?$/.test(s)) {
            var letter = s.charAt(8) || null;
            return {
                type: 'GAS',
                cabinet: s.slice(0, 6),
                voltage: voltage,
                motor: s.charAt(7),
                heatLetter: letter,
                heat: letter ? HEAT_LETTERS[letter] : null
            };
        }
        if (/^D[SHV]H\d{3}[34][DW]?$/.test(s)) {
            return {
                type: 'HEAT PUMP',
                cabinet: s.slice(0, 6),
                voltage: voltage,
                motor: s.charAt(7) || 'D',
                heatLetter: null,
                heat: null
            };
        }
        return null;
    }

    /** Rebuild a model number from its parts (the motor letter is what the
     *  design-values toggle rewrites when High Static is chosen). Heat
     *  pumps have no heat-exchanger letter. */
    function buildModel(parts) {
        var volt = parts.voltage === '460/3' ? '4' : '3';
        if (parts.type === 'HEAT PUMP') return parts.cabinet + volt + parts.motor;
        var letter = parts.heatLetter || HEAT_TO_LETTER[parts.heat] || '';
        return parts.cabinet + volt + parts.motor + letter;
    }

    // -----------------------------------------------------------------
    // Form options
    // -----------------------------------------------------------------
    /** Hot gas reheat is a DHG-only factory option, up to 12.5 tons. */
    function hgrhCapable(cab) {
        return cab.family === 'DHG' && Number(cab.tons) <= HGRH_MAX_TONS;
    }

    /**
     * Dropdown choices for the form. `type` ('GAS' | 'HEAT PUMP' | null)
     * scopes every list except `types` to that unit type, so a Gas search
     * never offers Variable Speed or heat kits, and a Heat Pump search
     * never offers 25 tons or hot gas reheat.
     *
     * The design-condition lists (ambients, eatDbs, eatWbs, heatAmbients)
     * are the values the tables actually publish for the units in scope -
     * `scope` = { tons, efficiency, eatDb } narrows them further. eatWbs
     * holds only wet bulbs rated at scope.eatDb, and heatAmbients are
     * outdoor DRY bulbs (a wet-bulb DVH point shows as WB + 2).
     */
    function formOptions(type, scope) {
        scope = scope || {};
        var cabs = cabinets();
        var tons = {}, volts = {}, effs = {}, types = {}, kits = {};
        // Condition value -> { family: true } for every family publishing it,
        // plus the families in scope, so a value only some of them publish
        // can say so in the dropdown ("22 (DVH only)").
        var ambients = {}, eatDbs = {}, eatWbs = {}, heatAmbients = {};
        var coolFams = {}, heatFams = {};
        var hgrh = false;
        var wantDb = scope.eatDb != null ? core.numStr(scope.eatDb) : null;
        function mark(map, v, fam) { (map[v] = map[v] || {})[fam] = true; }
        Object.keys(cabs).forEach(function (name) {
            var c = cabs[name];
            types[c.type || 'GAS'] = true;
            if (type && (c.type || 'GAS') !== type) return;
            if (c.tons != null) tons[c.tons] = true;
            if (hgrhCapable(c)) hgrh = true;
            Object.keys(c.electrical || {}).forEach(function (v) {
                volts[v] = true;
                Object.keys(c.electrical[v]).forEach(function (m) {
                    Object.keys(c.electrical[v][m].kits || {}).forEach(function (kw) {
                        kits[kw] = true;
                    });
                });
            });
            if (c.efficiency) effs[c.efficiency] = true;

            // Rated design conditions, for the units in scope.
            if (scope.tons != null && Number(c.tons) !== Number(scope.tons)) return;
            if (scope.efficiency && c.efficiency !== scope.efficiency) return;
            var fam = c.family || name.slice(0, 3);
            if (!c.coolingUnavailable) {
                coolFams[fam] = true;
                (((c.axes || {}).oaCooling) || []).forEach(function (a) { mark(ambients, a, fam); });
                (((c.axes || {}).eatDb) || []).forEach(function (d) { mark(eatDbs, d, fam); });
                Object.keys(c.cooling || {}).forEach(function (k) {
                    var p = k.split('|');
                    if (wantDb == null || p[0] === wantDb) mark(eatWbs, p[1], fam);
                });
            }
            var t = c.hpHeat;
            if (t && t.points) {
                heatFams[fam] = true;
                var shift = t.basis === 'WB' ? HP_WB_DEPRESSION : 0;
                Object.keys(t.points).forEach(function (k) {
                    var p = k.split('|');
                    if (Number(p[0]) === HP_EAT) mark(heatAmbients, Number(p[1]) + shift, fam);
                });
            }
        });
        function nums(o) {
            return Object.keys(o).map(Number).sort(function (a, b) { return a - b; });
        }
        // Dropdown choices; a value that not every family in scope
        // publishes names who does ("22 (DVH only)") or who doesn't
        // ("85 (not DVH)"), whichever is shorter.
        function choices(map, fams) {
            var all = Object.keys(fams).sort();
            return nums(map).map(function (v) {
                var have = all.filter(function (f) { return map[v][f]; });
                var label = String(v);
                if (have.length < all.length) {
                    var missing = all.filter(function (f) { return !map[v][f]; });
                    label += (have.length <= missing.length)
                        ? ' (' + have.join('/') + ' only)'
                        : ' (not ' + missing.join('/') + ')';
                }
                return { value: String(v), label: label };
            });
        }
        return {
            types: ['GAS', 'HEAT PUMP'].filter(function (t) { return types[t]; })
                .map(function (t) { return { value: t, label: TYPE_LABELS[t] }; }),
            // Which unit types the scoped lists cover.
            hasGas: !!types['GAS'] && type !== 'HEAT PUMP',
            hasHeatPump: !!types['HEAT PUMP'] && type !== 'GAS',
            hgrh: hgrh,
            tons: nums(tons),
            electrical: Object.keys(volts).sort(),
            motors: OFFERED_MOTORS.map(function (m) {
                return { value: m, label: MOTOR_LABELS[m] };
            }),
            ambients: nums(ambients),
            eatDbs: nums(eatDbs),
            eatWbs: nums(eatWbs),
            heatAmbients: nums(heatAmbients),
            ambientChoices: choices(ambients, coolFams),
            eatDbChoices: choices(eatDbs, coolFams),
            eatWbChoices: choices(eatWbs, coolFams),
            heatAmbientChoices: choices(heatAmbients, heatFams),
            // Heat pump electric heat kits; 0 = no kit.
            kits: nums(kits).map(function (k) {
                return { value: String(k), label: k === 0 ? 'None' : k + ' kW' };
            }),
            // Low before High -- ascending efficiency, not alphabetical.
            efficiencies: ['LOW', 'HIGH', 'VARIABLE'].filter(function (e) { return effs[e]; })
                .map(function (e) { return { value: e, label: EFFICIENCY_LABELS[e] }; })
        };
    }

    // -----------------------------------------------------------------
    // Heat pump heating
    // -----------------------------------------------------------------
    /**
     * Heat pump heating at a heating design outdoor DRY bulb, 70 F EAT.
     *
     * exact = true (Design Search): only a published point is read - a
     * temperature the unit isn't rated at (or a blank misprint cell)
     * returns available:false with notRated.
     * Otherwise colder is harsher, so an off-grid temperature snaps DOWN
     * to the next rated point, and a blank cell is passed over for the
     * next colder one. Nothing outside the table is extrapolated.
     *
     * Returns { available:false, reason, outOfRange?, notRated? } or
     *   { available:true, basis:'DB'|'WB', designDb, lookup, oa, airflow,
     *     eatDb, capacity (BTU/h), rise, kw, cop, offGrid:bool }
     * where `lookup` is the temperature looked up (DB, or DB - 2 for the
     * wet-bulb DVH tables) and `oa` the rated point actually used.
     */
    function hpHeatAt(cab, designDb, airflow, exact) {
        var t = cab && cab.hpHeat;
        if (!t || !t.points) {
            return { available: false, reason: 'no published heat pump heating data' };
        }
        var d = Number(designDb);
        if (designDb == null || !isFinite(d)) {
            return { available: false, reason: 'no heating design temperature entered' };
        }
        var wb = t.basis === 'WB';
        var x = wb ? d - HP_WB_DEPRESSION : d;
        var axes = t.axes || {};
        if ((axes.eatDb || []).map(Number).indexOf(HP_EAT) < 0) {
            return { available: false, reason: 'heating not rated at ' + HP_EAT + ' °F entering air' };
        }
        var oas = (axes.oa || []).map(Number).filter(isFinite)
            .sort(function (a, b) { return a - b; });
        if (!oas.length) return { available: false, reason: 'no published heat pump heating data' };
        var lo = oas[0], hi = oas[oas.length - 1];
        if (x < lo || x > hi) {
            return {
                available: false, outOfRange: true,
                reason: 'heating design temperature outside the rated table (' + lo + ' to ' + hi +
                    ' °F outdoor ' + (wb ? 'WB, looked up at DB − ' + HP_WB_DEPRESSION + ' °F' : 'DB') + ')'
            };
        }
        // DSH / DHH publish heating only at the nominal CFM; DVH's three
        // heating airflows are the same as its cooling ones, so the cooling
        // airflow is used when it is one of them (else the nearest, lower
        // on a tie - less airflow is the conservative side for heating).
        var flows = (axes.airflow || []).map(Number).filter(isFinite)
            .sort(function (a, b) { return a - b; });
        var a = Number(airflow);
        var cfm = flows[0];
        if (isFinite(a)) {
            flows.forEach(function (f) {
                if (Math.abs(f - a) < Math.abs(cfm - a)) cfm = f;
            });
        }
        var below = oas.filter(function (o) { return o <= x; }).sort(function (p, q) { return q - p; });
        if (exact) {
            var hit = t.points[[HP_EAT, x, cfm].map(core.numStr).join('|')];
            if (below[0] !== x || !hit || !isFinite(core.capNum(hit[0]))) {
                // Name the nearest temperatures this unit IS rated at (as
                // outdoor DB, so they match the dropdown).
                var shift = wb ? HP_WB_DEPRESSION : 0;
                var rated = oas.filter(function (o) {
                    var q = t.points[[HP_EAT, o, cfm].map(core.numStr).join('|')];
                    return q && isFinite(core.capNum(q[0]));
                }).map(function (o) { return o + shift; });
                var dn = rated.filter(function (o) { return o < d; }).pop();
                var up = rated.filter(function (o) { return o > d; })[0];
                var near = [dn, up].filter(function (o) { return o != null; });
                return {
                    available: false, notRated: true,
                    reason: 'heating not published at ' + d + ' °F outdoor' +
                        (near.length ? ' - nearest rated: ' + near.join(' and ') + ' °F' : '') +
                        (wb ? ' (DVH is rated on outdoor WB, read at DB − ' + HP_WB_DEPRESSION + ' °F)' : '')
                };
            }
            below = [x];
        }
        for (var i = 0; i < below.length; i++) {
            var p = t.points[[HP_EAT, below[i], cfm].map(core.numStr).join('|')];
            if (!p || !isFinite(core.capNum(p[0]))) continue;
            return {
                available: true,
                basis: wb ? 'WB' : 'DB',
                designDb: d, lookup: x, oa: below[i], airflow: cfm, eatDb: HP_EAT,
                capacity: core.capNum(p[0]), rise: p[1], kw: p[2], cop: p[3],
                offGrid: below[i] !== d
            };
        }
        return { available: false, reason: 'no rated heating point at or below the design temperature' };
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
     * kw   = heat pump heat kit (nominal kW, 0 = none); ignored for gas
     *        packs, which have no kits. null when that kit isn't offered.
     */
    function electricalFor(cabinet, voltage, motor, opts, kw) {
        var cab = cabinets()[cabinet];
        var slot = cab && cab.electrical && cab.electrical[voltage] &&
                cab.electrical[voltage][motor];
        if (!slot) return null;
        var e = slot;
        if (slot.kits) {
            e = slot.kits[String(kw == null ? 0 : Number(kw))];
            if (!e) return null;
        }
        var conv = !!(opts && opts.convOutlet);
        var pe = !!(opts && opts.powerExhaust);
        var mca = e.mca, mop = e.mop;
        if (conv && pe) { mca = e.mcaBoth; mop = e.mopBoth; }
        else if (conv) { mca = e.mcaConv; mop = e.mopConv; }
        else if (pe) { mca = e.mcaPe; mop = e.mopPe; }
        return {
            model: slot.model, voltage: voltage, motor: motor,
            mca: mca, mop: mop, hp: e.hp,
            convOutlet: conv, powerExhaust: pe,
            convFla: e.convFla, peFla: e.peFla,
            // Heat pumps only: the heat kit this MCA / MOP includes.
            kitKw: slot.kits ? e.kw : null,
            kit: slot.kits ? (e.kit || null) : null,
            kitFla: slot.kits ? (e.kitFla == null ? null : e.kitFla) : null
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

    function hasTarget(t) {
        return !!(t && t.value != null && isFinite(t.value) && t.value > 0);
    }

    /**
     * Run a design search.
     *
     * criteria = {
     *   type,                                        // 'GAS' | 'HEAT PUMP' | null = both
     *   tons, electrical, motor, efficiency, hgrh,   // hard filters, null = any
     *   kw,                                          // heat pump heat kit kW, 0 = none, null = any
     *   ambient,                                     // degF, required
     *   eatDb, eatWb,                                // degF, required
     *   heatAmbient,                                 // heat pump heating design OA DB (degF)
     *   cfm:{value,tol}, coolTotal:{value,tol}, coolSensible:{value,tol},
     *   heatRise:{value,tol},                        // gas packs
     *   hpHeating:{value,tol},                       // heat pumps, BTU/h at heatAmbient
     *   convOutlet, powerExhaust,                    // booleans
     *   exact                                        // true: published points only
     * }
     *
     * Returns { results:[...], skipped:[...] } with results sorted
     * best-match first. One result per cabinet + voltage + motor + gas heat
     * size (gas packs) or heat kit (heat pumps), because those are genuinely
     * different units. A target only one unit type can meet (gas temp rise,
     * heat pump heating) rules the other type out. skipped entries are
     * {cabinet, tons, reason, partial?} or, for units with no rating at
     * an exact condition, one {notRated:true, cabinets:[...]} summary.
     */
    function search(criteria) {
        var c = criteria || {};
        var cabs = cabinets();
        var results = [];
        var skipped = [];
        var notRated = [];
        var wantRise = hasTarget(c.heatRise);
        var wantHp = hasTarget(c.hpHeating);

        Object.keys(cabs).forEach(function (name) {
            var cab = cabs[name];
            var isHp = cab.type === 'HEAT PUMP';

            if (c.type && (cab.type || 'GAS') !== c.type) return;
            if (isHp && wantRise) return;
            if (!isHp && wantHp) return;
            // Gas packs have no electric heat: they pass "None", not a kit size.
            if (!isHp && c.kw != null && Number(c.kw) !== 0) return;

            if (c.tons != null && Number(cab.tons) !== Number(c.tons)) return;
            if (c.efficiency && cab.efficiency !== c.efficiency) return;
            // After the unit filters, so a 5-ton search doesn't report the
            // 12.5-ton DSG150 gap.
            if (cab.coolingUnavailable) {
                skipped.push({ cabinet: name, tons: cab.tons,
                               reason: 'no published cooling data' });
                return;
            }

            // Hot gas reheat is not in the capacity tables at all - it is a
            // factory option that exists as its own row in the schedule, and
            // it does not change cooling capacity. So it is expanded here
            // rather than filtered: a cabinet that can be built either way
            // yields BOTH variants when the filter is left on All, because
            // both are genuinely orderable units.
            var canHgrh = hgrhCapable(cab);
            if (c.hgrh === 'YES' && !canHgrh) return;
            var hgrhOptions = c.hgrh ? [c.hgrh] : (canHgrh ? ['NO', 'YES'] : ['NO']);

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
                { airflows: airflows, exact: !!c.exact }
            );
            if (!cool.applicable || cool.outOfRange || cool.noData || cool.notRated || !cool.result) {
                // Exact search: an unrated condition (including a DB / WB
                // pair the table prints as "-") just isn't this unit's.
                if (c.exact && (cool.notRated || cool.noData || cool.outOfRange)) {
                    notRated.push(name);
                    return;
                }
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

            // Leaving wet bulb isn't published; it is computed from the
            // table's own total / sensible / LDB at the rated airflow.
            var leaving = core.leavingAir(r.eatDb, r.eatWb, r.airflow, r.total, r.sensible, r.lat);
            var coolingOut = {
                airflow: r.airflow,
                eatDb: r.eatDb, eatWb: r.eatWb,
                ambient: r.oaCooling,
                total: r.total, sensible: r.sensible,
                lat: r.lat,
                lwb: leaving ? leaving.lwb : null,
                lwbSaturated: leaving ? leaving.saturated : false
            };
            // Which axes were snapped to a harsher rated point (null when
            // the design point was rated exactly).
            var offGrid = Object.keys(cool.offGrid || {}).length ? cool.offGrid : null;
            var coolScore =
                deviation(r.total, c.coolTotal && c.coolTotal.value) +
                deviation(r.sensible, c.coolSensible && c.coolSensible.value) +
                deviation(r.airflow, cfmTarget);

            if (isHp) {
                var hp = hpHeatAt(cab, c.heatAmbient, r.airflow, !!c.exact);
                if (!hp.available && wantHp) {
                    // A heating target can't be judged without heating data.
                    skipped.push({ cabinet: name, tons: cab.tons, reason: hp.reason });
                    return;
                }
                var before = results.length;
                if (hp.available && !within(hp.capacity, c.hpHeating && c.hpHeating.value,
                                            c.hpHeating && c.hpHeating.tol)) return;
                var hpScore = coolScore +
                    (hp.available ? deviation(hp.capacity, c.hpHeating && c.hpHeating.value) : 0);

                // Voltage x motor x heat kit -> one result each.
                Object.keys(cab.electrical || {}).forEach(function (voltage) {
                    if (c.electrical && voltage !== c.electrical) return;
                    OFFERED_MOTORS.forEach(function (motor) {
                        if (c.motor && motor !== c.motor) return;
                        var slot = cab.electrical[voltage][motor];
                        if (!slot) return;
                        Object.keys(slot.kits || { 0: true }).map(Number)
                            .sort(function (a, b) { return a - b; })
                            .forEach(function (kw) {
                                if (c.kw != null && Number(c.kw) !== kw) return;
                                var elec = electricalFor(name, voltage, motor, c, kw);
                                if (!elec) return;
                                results.push({
                                    type: 'HEAT PUMP',
                                    cabinet: name,
                                    family: cab.family,
                                    efficiency: cab.efficiency,
                                    tons: cab.tons,
                                    model: buildModel({ type: 'HEAT PUMP', cabinet: name,
                                                        voltage: voltage, motor: motor }),
                                    voltage: voltage,
                                    motor: motor,
                                    motorLabel: MOTOR_LABELS[motor],
                                    hgrh: 'NO',
                                    cooling: coolingOut,
                                    offGrid: offGrid,
                                    heat: null,
                                    hpHeat: hp.available ? hp : null,
                                    hpHeatNote: hp.available ? null : hp.reason,
                                    kitKw: kw,
                                    electrical: elec,
                                    score: hpScore
                                });
                            });
                    });
                });
                // Listed without heating: say why, once per cabinet.
                if (!hp.available && results.length > before) {
                    skipped.push({ cabinet: name, tons: cab.tons, reason: hp.reason,
                                   partial: true });
                }
                return;
            }

            // Heat sizes Daikin doesn't allow at this airflow (high-stage rise
            // outside the published range). They produce no result, but ride
            // along on the others so the UI can say why they're missing.
            var heatRejected = [];
            (cab.heat || []).forEach(function (h) {
                if (heatAt(h, r.airflow)) return;
                heatRejected.push({ size: h.size, riseHigh: riseFor(h.outputHigh, r.airflow),
                                    range: h.riseHigh, airflow: r.airflow });
            });

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

                        var score = coolScore +
                            deviation(heat.riseHigh, c.heatRise && c.heatRise.value);

                        hgrhOptions.forEach(function (hgrh) {
                            results.push({
                                type: 'GAS',
                                cabinet: name,
                                family: cab.family,
                                efficiency: cab.efficiency,
                                tons: cab.tons,
                                model: buildModel({ cabinet: name, voltage: voltage,
                                                    motor: motor, heat: heat.size }),
                                voltage: voltage,
                                motor: motor,
                                motorLabel: MOTOR_LABELS[motor],
                                hgrh: hgrh,
                                cooling: coolingOut,
                                offGrid: offGrid,
                                heat: heat,
                                heatRejected: heatRejected,
                                hpHeat: null,
                                kitKw: null,
                                electrical: elec,
                                score: score
                            });
                        });
                    });
                });
            });
        });

        results.sort(function (a, b) {
            if (a.score !== b.score) return a.score - b.score;
            if (a.model !== b.model) return a.model < b.model ? -1 : 1;
            // Same heat pump with different heat kits: smallest kit first.
            if (a.kitKw !== b.kitKw) return (a.kitKw || 0) - (b.kitKw || 0);
            // Same cabinet built both ways: plain unit before the reheat one,
            // so the pair is ordered rather than arbitrary.
            return (a.hgrh === b.hgrh) ? 0 : (a.hgrh === 'NO' ? -1 : 1);
        });
        if (notRated.length) {
            skipped.push({ notRated: true, cabinets: notRated.sort() });
        }
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
        hpHeatAt: hpHeatAt,
        electricalFor: electricalFor,
        search: search,
        MOTOR_LABELS: MOTOR_LABELS,
        HEAT_LETTERS: HEAT_LETTERS,
        TYPE_LABELS: TYPE_LABELS,
        EFFICIENCY_LABELS: EFFICIENCY_LABELS,
        HP_WB_DEPRESSION: HP_WB_DEPRESSION
    };

    core.register(PRODUCT, HHpro.GasPackCapacity);
})();
