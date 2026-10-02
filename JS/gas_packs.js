/* ============================================================
   HHpro - DAIKIN LIGHT COMMERCIAL RTUS product extension
   ------------------------------------------------------------
   Product key gas_packs: gas packs plus heat pumps (LC RTU DATA).
   They use the kW-variant schedule rendering from base.js (heat
   pumps collapse per aux heat kW). What lives here is
   HHpro.GasPackDesign: the bridge between a Design Search result
   and the schedule row it maps to. A heat pump result lands on the
   row for its heat kit (the kW dropdown opens on that kit), and
   swaps cooling and electrical plus the design OA heating column
   ("51000 (17°F OA, 3000 CFM, COP 2.25)"). The 47 / 17 F rating
   columns (capacity and COP) show "-" on a design row, and are
   hidden outright when every heat pump on a schedule is one.
   Gas packs land on the row for their heat size (the Input
   dropdown opens on it).

   The heat pump and aux. electric heat Temperature Rise columns
   are calculated here, never typed in the Excel (fillTempRise).

   Every number on the Gas Pack schedule came from a selection run
   by hand in Daikin's software at one condition (80/67 EAT, 95
   ambient, 0.5" ESP). Design Search can now answer for any
   condition Daikin publishes, so a selected result carries a
   "design values" payload back to the schedule. The row then
   offers a toggle between the two:

     Standard  - exactly what was run by hand. Never modified.
     Design    - the values from the capacity tables at the
                 condition that was searched.

   Only the cells the tables actually cover are swapped; ESP,
   efficiency rating, stages, weight and the rest stay put.
   Toggling is per row, survives navigation (sessionStorage), and
   raises a warning the first time it is used on a row, because
   the site's Submittal PDF documents the standard selection only.

   Select on a row showing design values stamps the payload onto
   the project item (item.gasPackDesign), so the project schedule
   and every export show the catalog values for THAT item - and an
   item added from a standard row never picks them up.

   The row's "Configure" button goes the other way: it opens Design
   Search narrowed to that unit (configureFor), where the motor,
   power exhaust, conditions etc. can be changed and the result
   Selected back onto the row.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};
    HHpro.ProductExtensions.gas_packs = {
        // Every other empty cell on this schedule is a "-" in the Excel; a
        // blank one (the heat pump design OA column, filled only by Design
        // Search) reads the same way on screen and in exports.
        formatScheduleCellValue: function (colLetter, val) {
            if (val === null || val === undefined || val === '') return '-';
            return undefined;
        },
        // Run once on the freshly loaded JSON (HHpro.Data postProcess).
        prepareData: function (data) { fillTempRise(data); },
        // Product page only: the airflow "?" beside each row's ESP.
        decorateScheduleCell: function (td, colLetter, ctx) {
            var cols = resolveColumns(ctx.data);
            if (!cols.esp || colLetter !== cols.esp) return;
            var sd = (ctx.selection && ctx.selection.rows && ctx.selection.rows[0] &&
                      ctx.selection.rows[0].scheduleData) || {};
            // A row on design values may show a high-static model.
            var model = (cols.model && ctx.overrides[cols.model] != null)
                ? ctx.overrides[cols.model] : sd[cols.model];
            var parts = HHpro.GasPackCapacity && HHpro.GasPackCapacity.parseModel(model);
            if (!parts) return;
            var kw = cols.auxKw ? parseFloat(sd[cols.auxKw]) : NaN;
            td.appendChild(HHpro.GasPackAirflow.helpButton({
                cabinet: parts.cabinet,
                motor: parts.motor,
                heatSize: parts.heat,
                kitKw: isFinite(kw) ? kw : 0,
                productPage: true
            }));
        },
        // "Configure" beside Select / Submittal / Docs: opens Design Search
        // narrowed to the unit this row is showing (configureFor).
        rowActionButtons: function (getSel, data) {
            if (!HHpro.Views || !HHpro.Views.design_search || !HHpro.App) return null;
            if (!configureFor(data, getSel())) return null;
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'action-btn action-btn-secondary';
            btn.textContent = 'Configure';
            btn.title = 'Open this unit in Design Search to change the motor, power exhaust, ' +
                'entering air or other options.';
            btn.addEventListener('click', function () {
                var cfg = configureFor(data, getSel());
                if (cfg) HHpro.App.showView('design_search', { productKey: PRODUCT, configure: cfg });
            });
            return [btn];
        }
    };

    var PRODUCT = 'gas_packs';
    var STORE_KEY = 'hhpro.gasPackDesign.v1';

    // Schedule columns the toggle writes, resolved by header LABEL so the
    // feature survives column edits (the same approach capacity.js uses).
    // The degree sign is matched loosely because the JSON carries it as a
    // mojibake'd byte pair in some builds.
    var COLUMN_LABELS = {
        model: 'MODEL NUMBER',        // "Model Number (Daikin)"; normalise drops the (...)
        tons: 'NOMINAL TONS',
        cfm: 'CFM',
        esp: 'ESP',                   // "ESP (IWG)"
        total: 'TOTAL CAPACITY (BTU/h)',
        sensible: 'SENSIBLE CAPACITY (BTU/h)',
        edb: 'EDB',
        ewb: 'EWB',
        ldb: 'LDB',
        lwb: 'LWB',
        heatInput: 'INPUT (MBH)',
        heatOutput: 'OUTPUT (MBH)',
        heatEat: 'EAT',
        heatLat: 'LAT',
        hgrh: 'MODULATING HOT GAS REHEAT',
        voltage: 'VOLT/PH',
        hp: 'INDOOR MOTOR HP',
        mca: 'Unit MCA',
        mop: 'Unit MOCP'
    };

    // Columns whose header only differs from a neighbour inside the
    // parentheses ("BTU/h (47°F ...)", "BTU/h (17°F ...)"), so they are
    // matched on the WHOLE label, letters and digits only. Any of the
    // spellings listed resolves the column.
    var FULL_LABELS = {
        // Heat pump heating at the Design Search heating temperature.
        hpDesign: ['BTU/h (Design OA, 70°F Indoor DB)', 'BTU/h (70°F Indoor DB)'],
        // The AHRI 47 / 17 F rating columns: "-" on a design row, and
        // hidden when every heat pump on a schedule is one (hiddenColumnsFor).
        hp47: ['BTU/h (47°F, 70°F Indoor DB)'],
        hp17: ['BTU/h (17°F, 70°F Indoor DB)'],
        cop47: ['COP (47°F)'],
        cop17: ['COP (17°F)']
    };

    // Columns whose own label repeats on the schedule ("kW", "Temperature
    // Rise (°F)"), matched on that label plus the group heading above it.
    var GROUPED_LABELS = {
        auxKw: { group: 'AUX. ELECTRIC HEAT', leaf: 'kW' },
        auxRise: { group: 'AUX. ELECTRIC HEAT', leaf: 'TEMPERATURE RISE' },
        hpRise: { group: 'HEAT PUMP HEATING PERFORMANCE', leaf: 'TEMPERATURE RISE' }
    };

    var WARNING =
        'These values come from Daikin’s published capacity tables at your design ' +
        'condition, not from the selection run in Daikin’s software. The Submittal PDF ' +
        'on this site still shows the STANDARD unit selection — it will not reflect ' +
        'these numbers.';

    // Sensible heat rate for standard air.
    var AIR_CONST = 1.08;

    // Aux. electric heat temperature rise = kW x 3193 / CFM, the split
    // systems' formula (TEMP_RISE_K in capacity.js).
    var AUX_RISE_K = 3193;

    // -----------------------------------------------------------------
    // Column resolution
    // -----------------------------------------------------------------
    function normalise(s) {
        // Strip the degree glyph and any mojibake around it so 'EDB (°F)',
        // 'EDB (Â°F)' and 'EDB' all reduce to the same key.
        return String(s == null ? '' : s)
            .replace(/\(.*?\)/g, '')
            .replace(/[^A-Za-z0-9/ ]+/g, '')
            .trim().toUpperCase();
    }

    function resolveColumns(data) {
        if (data.__gasPackCols) return data.__gasPackCols;
        var header = (data && data.scheduleHeader) || {};
        var letters = header.columnLetters || [];
        var letterToIdx = {};
        letters.forEach(function (l, i) { letterToIdx[l] = i; });

        var leaf = {};   // letter -> last (deepest) header label
        var trail = {};  // letter -> every header label above it, normalised
        (header.rows || []).forEach(function (row) {
            row.forEach(function (cell) {
                var start = letterToIdx[cell.col];
                if (start === undefined) return;
                for (var k = 0; k < (cell.colspan || 1); k++) {
                    var L = letters[start + k];
                    if (!L) continue;
                    leaf[L] = cell.value;
                    (trail[L] = trail[L] || []).push(normalise(cell.value));
                }
            });
        });

        var cols = {};
        Object.keys(COLUMN_LABELS).forEach(function (key) {
            var want = normalise(COLUMN_LABELS[key]);
            for (var i = 0; i < letters.length; i++) {
                if (normalise(leaf[letters[i]]) === want) { cols[key] = letters[i]; return; }
            }
            cols[key] = null;
        });
        Object.keys(FULL_LABELS).forEach(function (key) {
            var wants = FULL_LABELS[key].map(normaliseFull);
            cols[key] = null;
            for (var i = 0; i < letters.length; i++) {
                if (wants.indexOf(normaliseFull(leaf[letters[i]])) >= 0) { cols[key] = letters[i]; return; }
            }
        });
        Object.keys(GROUPED_LABELS).forEach(function (key) {
            var want = GROUPED_LABELS[key];
            var wantLeaf = normalise(want.leaf), wantGroup = normalise(want.group);
            cols[key] = null;
            for (var i = 0; i < letters.length; i++) {
                var L = letters[i];
                if (normalise(leaf[L]) === wantLeaf && (trail[L] || []).indexOf(wantGroup) >= 0) {
                    cols[key] = L;
                    return;
                }
            }
        });
        data.__gasPackCols = cols;
        return cols;
    }

    // Whole-label key: letters and digits only ("BTU/h (70°F Indoor DB)"
    // -> "BTUH70FINDOORDB"), which also drops a mojibake'd degree sign.
    function normaliseFull(s) {
        return String(s == null ? '' : s).toUpperCase().replace(/[^A-Z0-9]+/g, '');
    }

    // The 47 / 17 F rating columns a design row blanks.
    function ratingColumns(cols) {
        return [cols.hp47, cols.hp17, cols.cop47, cols.cop17].filter(Boolean);
    }

    // -----------------------------------------------------------------
    // Temperature rise
    // -----------------------------------------------------------------
    // Both Temperature Rise columns are left blank in LC RTU DATA and
    // worked out here from the row's own numbers when the JSON loads:
    //   Heat pump heating: BTU/h / (1.08 x CFM), one per rated capacity,
    //     "31.3°F (47°F Ambient), 18.2°F (17°F Ambient)".
    //   Aux. electric heat: kW x 3193 / CFM.
    // A design row replaces both from its payload (overridesFor).
    function num(v) {
        var n = (typeof v === 'number') ? v : parseFloat(v);
        return isFinite(n) ? n : null;
    }

    function hpRise(btuh, cfm) {
        var b = num(btuh), c = num(cfm);
        return (b == null || c == null || b <= 0 || c <= 0) ? null : b / (AIR_CONST * c);
    }

    function auxRise(kw, cfm) {
        var k = num(kw), c = num(cfm);
        return (k == null || c == null || k <= 0 || c <= 0) ? null : k * AUX_RISE_K / c;
    }

    // readings = [{ rise, ambient }]; null when none has a rise.
    function hpRiseText(readings) {
        var parts = readings.filter(function (r) { return r.rise != null; }).map(function (r) {
            // toFixed keeps "18.0°F" alongside "25.6°F" in the same cell.
            return Number(r.rise).toFixed(1) + '°F (' + r.ambient + '°F Ambient)';
        });
        return parts.length ? parts.join(', ') : null;
    }

    function fillTempRise(data) {
        var cols = resolveColumns(data);
        if (!cols.cfm) return;
        (data.selections || []).forEach(function (sel) {
            (sel.rows || []).forEach(function (row) {
                var sd = row.scheduleData;
                if (!sd) return;
                var cfm = sd[cols.cfm];
                if (cols.hpRise) {
                    var text = hpRiseText([
                        { rise: cols.hp47 ? hpRise(sd[cols.hp47], cfm) : null, ambient: 47 },
                        { rise: cols.hp17 ? hpRise(sd[cols.hp17], cfm) : null, ambient: 17 }
                    ]);
                    if (text) sd[cols.hpRise] = text;
                }
                if (cols.auxRise && cols.auxKw) {
                    var rise = auxRise(sd[cols.auxKw], cfm);
                    if (rise != null) sd[cols.auxRise] = round1(rise);
                }
            });
        });
    }

    function isHeatPumpSel(data, sel) {
        var cols = resolveColumns(data);
        var sd = sel && sel.rows && sel.rows[0] && sel.rows[0].scheduleData;
        var parts = sd && HHpro.GasPackCapacity && HHpro.GasPackCapacity.parseModel(sd[cols.model]);
        return !!(parts && parts.type === 'HEAT PUMP');
    }

    /**
     * Schedule columns to hide for a set of rows: the 47 / 17 F rating
     * columns, when at least one heat pump is in view and EVERY heat pump
     * is on design values (those rows blank them anyway). [] otherwise.
     * units = [{ selection, design: bool }], one per row shown.
     */
    function hiddenColumnsFor(data, units) {
        if (!data || !Array.isArray(units)) return [];
        var hps = units.filter(function (u) { return isHeatPumpSel(data, u.selection); });
        if (!hps.length || !hps.every(function (u) { return u.design; })) return [];
        return ratingColumns(resolveColumns(data));
    }

    /**
     * The design payload a project item carries, or null. A payload is
     * bound to the schedule row it was selected on; if the item has since
     * moved to another row (another kit or heat size) it no longer applies.
     */
    function itemPayload(item) {
        var p = item && item.gasPackDesign;
        if (!p || typeof p !== 'object') return null;
        if (p.selectionId != null && p.selectionId !== item.selectionId) return null;
        return p;
    }

    // -----------------------------------------------------------------
    // Design payload
    // -----------------------------------------------------------------
    /** Freeze a Design Search result into the shape the schedule needs. */
    function payloadFor(result) {
        var hp = result.hpHeat;
        return {
            type: result.type || 'GAS',
            model: result.model,
            cabinet: result.cabinet,
            tons: result.tons,
            efficiency: result.efficiency,
            voltage: result.voltage,
            motor: result.motor,
            motorLabel: result.motorLabel,
            heatSize: result.heatSize || (result.heat ? result.heat.size : null),
            kitKw: result.kitKw == null ? null : result.kitKw,
            hgrh: result.hgrh,
            cooling: {
                airflow: result.cooling.airflow,
                eatDb: result.cooling.eatDb,
                eatWb: result.cooling.eatWb,
                ambient: result.cooling.ambient,
                total: result.cooling.total,
                sensible: result.cooling.sensible,
                lat: result.cooling.lat,
                lwb: result.cooling.lwb == null ? null : result.cooling.lwb
            },
            heat: result.heat ? {
                inputHigh: result.heat.inputHigh,
                outputHigh: result.heat.outputHigh,
                riseHigh: result.heat.riseHigh,
                thermalEff: result.heat.thermalEff
            } : null,
            // Heat pumps: what Design Search showed for heating, and the
            // airflow the table publishes it at (DSH / DHH: nominal only).
            // Goes to the design OA column.
            hpHeat: hp ? {
                designDb: hp.designDb, oa: hp.oa, basis: hp.basis,
                capacity: hp.capacity, cop: hp.cop, airflow: hp.airflow
            } : null,
            electrical: {
                mca: result.electrical.mca,
                mop: result.electrical.mop,
                hp: result.electrical.hp,
                convOutlet: result.electrical.convOutlet,
                powerExhaust: result.electrical.powerExhaust
            },
            offGrid: result.offGrid || null
        };
    }

    /**
     * The schedule row a Design Search result should land on.
     *
     * Matched on cabinet + voltage + heat size + hot gas reheat, and
     * DELIBERATELY NOT on the motor: the schedule only carries standard-static
     * (D) models, so a high-static result has no row of its own. The toggle
     * rewrites the motor letter in the model number instead - which is why
     * the model shown changes when Design values are on.
     *
     * Heat pumps match on cabinet + voltage + heat kit kW (the row's AUX.
     * ELECTRIC HEAT, "-" = none); no row for that kit -> no match.
     */
    function matchSelection(data, result) {
        var G = HHpro.GasPackCapacity;
        var cols = resolveColumns(data);
        var best = null;
        var isHp = result.type === 'HEAT PUMP';
        (data.selections || []).forEach(function (sel) {
            var sd = sel.rows && sel.rows[0] && sel.rows[0].scheduleData;
            if (!sd) return;
            var parts = G.parseModel(sd[cols.model]);
            if (!parts) return;
            if (parts.cabinet !== result.cabinet) return;
            if (parts.voltage !== result.voltage) return;
            if (isHp) {
                if (parts.type !== 'HEAT PUMP' || !cols.auxKw) return;
                var rowKw = parseFloat(sd[cols.auxKw]);
                if ((isFinite(rowKw) ? rowKw : 0) !== Number(result.kitKw || 0)) return;
                // First matching row wins (LC RTU DATA has a couple of
                // duplicated heat pump rows; they carry the same values).
                if (!best) best = { selection: sel, score: 0, parts: parts };
                return;
            }
            if (parts.heat !== result.heat.size) return;
            var rowHgrh = cols.hgrh ? String(sd[cols.hgrh] || 'NO').toUpperCase() : 'NO';
            var score = (rowHgrh === String(result.hgrh).toUpperCase()) ? 0 : 1;
            // Prefer a row already on the requested motor, though today
            // every row is D.
            if (parts.motor !== result.motor) score += 0.5;
            if (!best || score < best.score) best = { selection: sel, score: score, parts: parts };
        });
        return best;
    }

    /**
     * What the "Configure" button hands Design Search: the unit a schedule
     * row is showing, so the search opens narrowed to it (type, tons,
     * efficiency, voltage, motor, hot gas reheat) on its heat size / heat
     * kit and nearest its CFM. A row showing design values hands over that
     * configuration instead - its motor, conditions and electrical options.
     * token tells one click from a browser back / forward to the same page.
     * null for a row whose model isn't an LC RTU model number.
     */
    function configureFor(data, sel) {
        var G = HHpro.GasPackCapacity;
        var cols = resolveColumns(data);
        var sd = sel && sel.rows && sel.rows[0] && sel.rows[0].scheduleData;
        var parts = sd && G && G.parseModel(sd[cols.model]);
        if (!parts) return null;
        var kw = cols.auxKw ? num(sd[cols.auxKw]) : null;
        var cfg = {
            token: sel.id + '@' + Date.now(),
            model: String(sd[cols.model]).trim(),
            type: parts.type,
            cabinet: parts.cabinet,
            voltage: parts.voltage,
            motor: parts.motor,
            heatSize: parts.heat,
            kitKw: parts.type === 'HEAT PUMP' ? (kw || 0) : null,
            hgrh: cols.hgrh ? String(sd[cols.hgrh] || 'NO').trim().toUpperCase() : 'NO',
            cfm: cols.cfm ? num(sd[cols.cfm]) : null
        };
        var entry = getDesign(sel.id);
        var p = entry && entry.on !== false ? entry.payload : null;
        if (p && p.cabinet === cfg.cabinet) {
            cfg.model = p.model;
            cfg.voltage = p.voltage;
            cfg.motor = p.motor;
            cfg.heatSize = p.heatSize || cfg.heatSize;
            if (p.type === 'HEAT PUMP') cfg.kitKw = p.kitKw || 0;
            cfg.hgrh = p.hgrh || cfg.hgrh;
            cfg.cfm = p.cooling.airflow;
            cfg.ambient = p.cooling.ambient;
            cfg.eatDb = p.cooling.eatDb;
            cfg.eatWb = p.cooling.eatWb;
            if (p.hpHeat && p.hpHeat.designDb != null) cfg.heatAmbient = p.hpHeat.designDb;
            cfg.convOutlet = !!p.electrical.convOutlet;
            cfg.powerExhaust = !!p.electrical.powerExhaust;
        }
        return cfg;
    }

    // -----------------------------------------------------------------
    // Per-row overrides
    // -----------------------------------------------------------------
    /**
     * Column letter -> design value, for one selection. {} when the row has
     * no design payload or the toggle is off.
     *
     * Heating: only the HIGH stage input/output is swapped, and the leaving
     * air temperature is recomputed from the row's own heating EAT plus the
     * rise the chosen heat size produces at the design airflow - so the
     * schedule's heating entering condition is respected rather than replaced.
     */
    function overridesFor(payload, scheduleData, data) {
        if (!payload) return {};
        var cols = resolveColumns(data);
        var out = {};
        function put(key, value) {
            if (cols[key] && value !== undefined && value !== null) out[cols[key]] = value;
        }

        put('model', payload.model);
        put('cfm', payload.cooling.airflow);
        put('total', Math.round(payload.cooling.total));
        put('sensible', Math.round(payload.cooling.sensible));
        put('edb', payload.cooling.eatDb);
        put('ewb', payload.cooling.eatWb);
        put('ldb', round1(payload.cooling.lat));
        // The capacity tables publish no leaving wet bulb; Design Search
        // computes it psychrometrically from the table's own total,
        // sensible and LDB at the rated airflow (CapacityCore.leavingAir).
        // A payload saved before that existed has none, and shows a dash.
        if (cols.lwb) {
            out[cols.lwb] = (payload.cooling.lwb == null) ? '-' : round1(payload.cooling.lwb);
        }

        // Heat pumps: the design OA column gets the capacity Design Search
        // read at the chosen heating temperature, with the airflow the table
        // publishes it at and its COP (DVH publishes none), e.g.
        // "51000 (17°F OA, 3000 CFM, COP 2.25)". The 47 / 17 F columns are
        // AHRI ratings, not catalog values at this condition: blanked.
        if (payload.type === 'HEAT PUMP') {
            var h = payload.hpHeat;
            if (h && cols.hpDesign && h.capacity != null) {
                var bits = [h.designDb + '°F OA'];
                if (h.airflow != null) bits.push(h.airflow + ' CFM');
                if (h.cop != null) bits.push('COP ' + h.cop);
                out[cols.hpDesign] = Math.round(h.capacity) + ' (' + bits.join(', ') + ')';
            }
            ratingColumns(cols).forEach(function (L) { out[L] = '-'; });

            // Both rises at the airflow the heating is published at (the
            // CFM in the design OA cell), falling back to the cooling one.
            var heatCfm = (h && h.airflow != null) ? h.airflow : payload.cooling.airflow;
            if (cols.hpRise) {
                out[cols.hpRise] = (h && hpRiseText([
                    { rise: hpRise(h.capacity, heatCfm), ambient: h.designDb }
                ])) || '-';
            }
            if (cols.auxRise) {
                var aux = auxRise(payload.kitKw, heatCfm);
                out[cols.auxRise] = (aux == null) ? '-' : round1(aux);
            }
        }

        // Gas heat.
        if (payload.heat) {
            put('heatInput', payload.heat.inputHigh);
            put('heatOutput', payload.heat.outputHigh);
            if (cols.heatLat) {
                var eat = cols.heatEat ? parseFloat(scheduleData[cols.heatEat]) : NaN;
                if (isFinite(eat) && payload.heat.riseHigh != null) {
                    out[cols.heatLat] = round1(eat + payload.heat.riseHigh);
                }
            }
        }

        put('voltage', payload.voltage);
        put('mca', payload.electrical.mca);
        // DVH1203W's published MOP is misprinted and left blank in the
        // tables - show a dash rather than the standard row's MOCP.
        if (cols.mop) {
            out[cols.mop] = (payload.electrical.mop == null) ? '-' : payload.electrical.mop;
        }
        // The eight DSG 3-6 ton high-static models have no published indoor
        // motor HP yet (SS-DSG3-R32 was not to hand when the tables were
        // built). Show a dash rather than leave the standard-static value
        // sitting under a high-static model number.
        if (cols.hp) out[cols.hp] = (payload.electrical.hp == null) ? '-' : payload.electrical.hp;

        return out;
    }

    function round1(v) {
        return (v == null || isNaN(v)) ? v : Number(Number(v).toFixed(1));
    }

    // -----------------------------------------------------------------
    // Store (per selection, per session)
    // -----------------------------------------------------------------
    function readStore() {
        try {
            return JSON.parse(sessionStorage.getItem(STORE_KEY)) || {};
        } catch (e) { return {}; }
    }
    function writeStore(store) {
        try { sessionStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* full/blocked */ }
    }

    /**
     * siblingIds: the other kW / heat-size variants on the same schedule
     * row. A new selection replaces whatever was stored on them, so the
     * row opens on the variant just picked rather than an older one.
     */
    function setDesign(selectionId, payload, siblingIds) {
        var store = readStore();
        (siblingIds || []).forEach(function (id) {
            if (id !== selectionId) delete store[id];
        });
        // The payload names the row it belongs to, so a project item that
        // later moves to another row (itemPayload) drops it.
        payload.selectionId = selectionId;
        // A freshly selected result starts ON: the engineer just asked for
        // these numbers, so showing the standard ones would be surprising.
        store[selectionId] = { payload: payload, on: true, warned: false, at: Date.now() };
        writeStore(store);
    }
    function getDesign(selectionId) {
        return readStore()[selectionId] || null;
    }
    function clearDesign(selectionId) {
        var store = readStore();
        delete store[selectionId];
        writeStore(store);
    }
    function clearAll() { writeStore({}); }
    function setFlag(selectionId, key, value) {
        var store = readStore();
        if (!store[selectionId]) return;
        store[selectionId][key] = value;
        writeStore(store);
    }

    // -----------------------------------------------------------------
    // Row controller (used by base.js)
    // -----------------------------------------------------------------
    /**
     * Null unless this is a gas pack row carrying a design payload.
     * Otherwise: { isOn, overrides, itemExtra, button } - the button flips
     * the row and calls back so the renderer can repaint the affected cells;
     * itemExtra() is what Select adds to the project item.
     */
    function rowController(opts) {
        if (!opts || opts.productKey !== PRODUCT) return null;
        var sel = opts.selection;
        if (!sel) return null;
        var entry = getDesign(sel.id);
        if (!entry || !entry.payload) return null;

        var scheduleData = (sel.rows && sel.rows[0] && sel.rows[0].scheduleData) || {};
        var data = opts.data;
        var on = entry.on !== false;

        function overrides() {
            return on ? overridesFor(entry.payload, scheduleData, data) : {};
        }

        function button(onChange) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'action-btn action-btn-design' + (on ? ' is-on' : '');
            paint();
            btn.addEventListener('click', function () {
                on = !on;
                setFlag(sel.id, 'on', on);
                paint();
                notifyWarning();          // banner follows the toggle both ways
                if (typeof onChange === 'function') onChange(on);
            });
            function hpNote() {
                var h = entry.payload.hpHeat;
                if (entry.payload.type !== 'HEAT PUMP') return '';
                return ' The 47/17 °F AHRI rating columns are blank' +
                    (h ? '; the design OA column shows ' + Math.round(h.capacity).toLocaleString() +
                         ' BTU/h at ' + h.designDb + ' °F outdoor' +
                         (h.airflow != null ? ', ' + h.airflow + ' CFM.' : '.') : '.');
            }
            function paint() {
                btn.textContent = on ? 'Design values' : 'Standard values';
                btn.classList.toggle('is-on', on);
                btn.title = on
                    ? 'Showing capacity-table values at ' + entry.payload.cooling.eatDb + '/' +
                      entry.payload.cooling.eatWb + ' °F EAT, ' + entry.payload.cooling.ambient +
                      ' °F ambient.' + hpNote() + ' Click to show the standard selection. ' + WARNING
                    : 'Showing the standard selection run in Daikin’s software. ' +
                      'Click to show your design-condition values.';
            }
            return btn;
        }

        return {
            payload: entry.payload,
            isOn: function () { return on; },
            overrides: overrides,
            // Select carries the design values onto the project item only
            // while the row is showing them.
            itemExtra: function () {
                if (!on) return null;
                var p = JSON.parse(JSON.stringify(entry.payload));
                p.selectionId = sel.id;
                return { gasPackDesign: p };
            },
            handles: function (colLetter) {
                return Object.prototype.hasOwnProperty.call(
                    overridesFor(entry.payload, scheduleData, data), colLetter);
            },
            button: button
        };
    }

    // -----------------------------------------------------------------
    // Warning banner
    // -----------------------------------------------------------------
    var CHANGE_EVENT = 'hhpro:gasPackDesign';

    function anyOn() {
        var store = readStore();
        return Object.keys(store).some(function (k) { return store[k] && store[k].on !== false; });
    }

    function notifyWarning() {
        document.dispatchEvent(new CustomEvent(CHANGE_EVENT));
    }

    /**
     * Banner shown above the Gas Pack schedule whenever at least one row is
     * on design values. A standing banner rather than a dismissable alert:
     * the mismatch with the Submittal PDF lasts as long as the toggle does,
     * so the warning should too.
     */
    function buildWarningBanner() {
        var box = document.createElement('div');
        box.className = 'gp-design-warning';
        box.setAttribute('role', 'status');

        var icon = document.createElement('span');
        icon.className = 'gp-design-warning-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '!';
        box.appendChild(icon);

        var text = document.createElement('div');
        text.className = 'gp-design-warning-text';
        var strong = document.createElement('strong');
        strong.textContent = 'Showing design-condition values. ';
        text.appendChild(strong);
        text.appendChild(document.createTextNode(WARNING));
        box.appendChild(text);

        var reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'projects-btn projects-btn-secondary gp-design-warning-reset';
        reset.textContent = 'Reset all to standard';
        reset.addEventListener('click', function () {
            var store = readStore();
            Object.keys(store).forEach(function (k) { store[k].on = false; });
            writeStore(store);
            document.dispatchEvent(new CustomEvent(CHANGE_EVENT));
            if (HHpro.App && typeof HHpro.App.showView === 'function') {
                HHpro.App.showView('product', { productKey: PRODUCT });
            }
        });
        box.appendChild(reset);

        // Each product render builds a fresh banner, so the listener has to
        // retire with its element or they pile up across navigations.
        function sync() {
            if (!box.isConnected && box.__mounted) {
                document.removeEventListener(CHANGE_EVENT, sync);
                return;
            }
            if (box.isConnected) box.__mounted = true;
            box.hidden = !anyOn();
        }
        sync();
        document.addEventListener(CHANGE_EVENT, sync);
        return box;
    }

    HHpro.GasPackDesign = {
        PRODUCT: PRODUCT,
        WARNING: WARNING,
        resolveColumns: resolveColumns,
        payloadFor: payloadFor,
        itemPayload: itemPayload,
        hiddenColumnsFor: hiddenColumnsFor,
        matchSelection: matchSelection,
        configureFor: configureFor,
        overridesFor: overridesFor,
        set: setDesign,
        get: getDesign,
        clear: clearDesign,
        clearAll: clearAll,
        anyOn: anyOn,
        buildWarningBanner: buildWarningBanner,

        /**
         * Schedule-cell overrides for a PROJECT item (the project schedule,
         * Excel / CAD / PDF / engineer templates): the design values the
         * item was selected with from Design Search. {} for every other
         * product and for items added from a standard row - those show the
         * selection as run by hand.
         */
        exportOverridesFor: function (item, scheduleData, data) {
            if (!item || item.productKey !== PRODUCT) return {};
            var payload = itemPayload(item);
            return payload ? overridesFor(payload, scheduleData || {}, data) : {};
        },
        rowController: rowController,
        riseFor: function (outputMbh, cfm) {
            var o = Number(outputMbh), c = Number(cfm);
            if (!isFinite(o) || !isFinite(c) || c <= 0) return null;
            return o * 1000 / (AIR_CONST * c);
        }
    };

    // -----------------------------------------------------------------
    // Airflow "?" (product page ESP cell, Design Search Motor cell)
    // -----------------------------------------------------------------
    // The external static and airflow each drive can handle, read from
    // the Airflow sheet of the capacity workbook (Daikin's downflow fan
    // tables plus its published airflow limits) via
    // GasPackCapacity.airflowFor. The product page lists Standard Static
    // units only, so there the popup also points to Design Search for
    // High Static. Not shown on the project schedule or any export.
    var MOTORS = [{ key: 'D', label: 'Standard Static' }, { key: 'W', label: 'High Static' }];

    var pop = null, pinned = null;

    function ensurePop() {
        if (pop) return pop;
        pop = document.createElement('div');
        pop.className = 'gp-airflow-pop';
        pop.hidden = true;
        document.body.appendChild(pop);
        document.addEventListener('click', function (e) {
            if (!pinned) return;
            if (e.target === pinned || pop.contains(e.target)) return;
            closePop();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') closePop();
        });
        // A fixed popup would float away from its row on scroll.
        window.addEventListener('scroll', closePop, true);
        return pop;
    }

    function closePop() {
        pinned = null;
        if (pop) pop.hidden = true;
    }

    function fmtCfm(v) { return Math.round(v).toLocaleString(); }
    // 0.1, 0.12, 0.8, 2.0 - at least one decimal, as the manuals print ESP.
    function fmtEsp(v) { return Number(v).toFixed(2).replace(/(\.\d)0$/, '$1'); }

    function line(parent, cls, text) {
        var el = document.createElement('div');
        el.className = cls;
        el.textContent = text;
        parent.appendChild(el);
        return el;
    }

    function fillPop(el, ctx) {
        var G = HHpro.GasPackCapacity;
        el.innerHTML = '';
        var info = G.airflowInfo ? G.airflowInfo(ctx.cabinet) : null;
        if (!info) {
            line(el, 'gp-airflow-note', 'No published airflow data for ' + ctx.cabinet + '.');
            return;
        }
        var head = ctx.cabinet + ' · ' + info.tons + ' ton' +
            (ctx.heatSize ? ' · ' + ctx.heatSize + ' gas heat' : '');
        line(el, 'gp-airflow-title', head);

        MOTORS.forEach(function (m) {
            var r = G.airflowFor(ctx.cabinet, m.key, ctx.heatSize);
            var box = document.createElement('div');
            box.className = 'gp-airflow-motor' + (m.key === ctx.motor ? ' is-current' : '');
            var name = line(box, 'gp-airflow-motor-name', m.label);
            if (m.key === ctx.motor) {
                var tag = document.createElement('span');
                tag.className = 'gp-airflow-tag';
                tag.textContent = 'this unit';
                name.appendChild(tag);
            }
            if (!r) {
                line(box, 'gp-airflow-row', 'No published fan table.');
            } else {
                line(box, 'gp-airflow-row', 'ESP: ' + fmtEsp(r.espMin) + ' – ' + fmtEsp(r.espMax) + ' in. w.c.');
                line(box, 'gp-airflow-row', 'Airflow: ' + fmtCfm(r.cfmMin) + ' – ' + fmtCfm(r.cfmMax) + ' CFM');
                if (r.cfmAtEspMax != null && r.cfmAtEspMax < r.cfmMax) {
                    line(box, 'gp-airflow-row gp-airflow-sub',
                        'At ' + fmtEsp(r.espMax) + ' in.: up to ' + fmtCfm(r.cfmAtEspMax) + ' CFM');
                }
            }
            el.appendChild(box);
        });

        // Heating limits: per gas heat size, or per electric heat kit.
        var heat = G.airflowHeat ? G.airflowHeat(ctx.cabinet, ctx.motor, ctx.heatSize, ctx.kitKw) : null;
        if (heat) {
            var burner = ctx.heatSize && ((G.cabinets()[ctx.cabinet] || {}).heat || [])
                .filter(function (h) { return h.size === ctx.heatSize; })[0];
            var what = ctx.heatSize
                ? ctx.heatSize + ' gas heat' + (burner ? ' (' + burner.inputHigh + ' MBH)' : '')
                : ctx.kitKw + ' kW electric heat';
            line(el, 'gp-airflow-note', (heat.min != null && heat.max != null)
                ? what + ': ' + fmtCfm(heat.min) + ' – ' + fmtCfm(heat.max) + ' CFM.'
                : (heat.min != null
                    ? what + ' needs at least ' + fmtCfm(heat.min) + ' CFM.'
                    : what + ': at most ' + fmtCfm(heat.max) + ' CFM.'));
        }

        if (ctx.productPage && ctx.motor === 'D') {
            var warn = document.createElement('div');
            warn.className = 'gp-airflow-warn';
            warn.appendChild(document.createTextNode(
                'The units on this page are Standard Static. If you need High Static, select the unit in '));
            var link = document.createElement('button');
            link.type = 'button';
            link.className = 'gp-airflow-link';
            link.textContent = 'Design Search';
            link.addEventListener('click', function (e) {
                e.stopPropagation();
                closePop();
                if (HHpro.App && typeof HHpro.App.showView === 'function') {
                    HHpro.App.showView('design_search', { productKey: PRODUCT });
                }
            });
            warn.appendChild(link);
            warn.appendChild(document.createTextNode('.'));
            el.appendChild(warn);
        }

        line(el, 'gp-airflow-source', 'Daikin ' + info.source +
            ' airflow tables (downflow) and published airflow limits.');
    }

    function placePop(btn) {
        var r = btn.getBoundingClientRect();
        var w = Math.min(320, window.innerWidth - 24);
        pop.style.width = w + 'px';
        var left = Math.min(r.left, window.innerWidth - w - 12);
        var top = r.bottom + 6;
        pop.style.left = Math.max(8, left) + 'px';
        pop.style.top = top + 'px';
        var ph = pop.getBoundingClientRect().height;
        if (top + ph > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - ph - 6) + 'px';
    }

    function showFor(btn, ctx) {
        var el = ensurePop();
        var G = HHpro.GasPackCapacity;
        el.hidden = false;
        if (!G) { el.textContent = 'Airflow data unavailable.'; placePop(btn); return; }
        el.textContent = 'Loading airflow data…';
        placePop(btn);
        G.load().then(function () {
            // Still the popup for this button?
            if (el.hidden || el.__owner !== btn) return;
            fillPop(el, ctx);
            placePop(btn);
        }, function () {
            if (el.__owner === btn) el.textContent = 'Airflow data could not be loaded.';
        });
    }

    /** "?" button: hover to peek, click to pin, Escape / click away to close.
     *  ctx = { cabinet, motor, heatSize, kitKw, productPage }. */
    function helpButton(ctx) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gp-airflow-help';
        b.textContent = '?';
        b.setAttribute('aria-label', 'Static pressure and airflow range');
        function open() { ensurePop().__owner = b; showFor(b, ctx); }
        b.addEventListener('mouseenter', function () { if (!pinned) open(); });
        b.addEventListener('mouseleave', function () { if (!pinned && pop) pop.hidden = true; });
        b.addEventListener('focus', function () { if (!pinned) open(); });
        b.addEventListener('blur', function () { if (!pinned && pop) pop.hidden = true; });
        b.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (pinned === b) { closePop(); return; }
            pinned = b;
            open();
        });
        return b;
    }

    HHpro.GasPackAirflow = { helpButton: helpButton };
})();
