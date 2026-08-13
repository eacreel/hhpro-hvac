/* ============================================================
   HHpro - Multi Position Split capacity tables (HHpro.Capacity)
   ------------------------------------------------------------
   Drives the cooling + heat-pump capacity dropdowns on the Multi
   Position Split schedule. A system whose outdoor-condenser +
   air-handler pair matches a tab in the capacity workbook gets:

     - cooling dropdowns: EAT (DB), EAT (WB), Outdoor Ambient
       (Cooling), Airflow (CFM). Changing any of them looks up the
       table and fills Total / Sensible / LAT.
     - a heat-pump dropdown: Outdoor Ambient (DB), which fills the
       Heat Pump Total Capacity.

   The dropdowns are constrained to valid combinations only: each
   menu offers just the values that form a valid combo with the
   other three current selections, so an invalid combo can never be
   picked. (A saved combo that becomes invalid after a table edit is
   shown but flagged - see the .capacity-invalid styling.)

   Data: DATA/JSON/multi_position_split_capacity.json (built by
   convert_to_json.py). Columns are resolved by header NAME, not a
   fixed letter, so the feature survives schedule column edits.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var CAPACITY_URL = 'DATA/JSON/multi_position_split_capacity.json';
    var CAPACITY_PRODUCT = 'multi_position_splits';

    var cache = null;        // loaded JSON ({ matchups: {...} })
    var loadPromise = null;

    var COOL_AXES = ['eatDb', 'eatWb', 'oaCooling', 'airflow'];
    var ARIA = {
        eatDb:     'Entering air dry bulb (°F)',
        eatWb:     'Entering air wet bulb (°F)',
        oaCooling: 'Outdoor ambient, cooling (°F)',
        airflow:   'Airflow (CFM)',
        hpAmbient: 'Heat-pump outdoor ambient (°F)'
    };

    // -----------------------------------------------------------------
    // Loading
    // -----------------------------------------------------------------
    function load() {
        if (cache) return Promise.resolve(cache);
        if (loadPromise) return loadPromise;
        loadPromise = fetch(CAPACITY_URL)
            .then(function (r) {
                if (!r.ok) throw new Error('capacity tables ' + r.status);
                return r.json();
            })
            .then(function (json) { cache = json || { matchups: {} }; return cache; })
            .catch(function () {
                // Missing/unreadable: degrade to "no matchups" so the
                // schedule just renders its static values.
                cache = { matchups: {} };
                return cache;
            });
        return loadPromise;
    }

    // Resolve before rendering a product whose schedule may use capacity
    // dropdowns. No-op (already resolved) for every other product.
    function ensureFor(productKey) {
        return (productKey === CAPACITY_PRODUCT) ? load() : Promise.resolve(cache);
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------
    function numStr(v) {
        var n = Number(v);
        return isFinite(n) ? String(n) : String(v);
    }
    function el(tag, cls) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        return e;
    }

    // ----- Cooling-combo helpers (shared by the row controller and the
    // single-field control used inside engineer templates) -----
    function coolKeyOf(s) {
        return [s.eatDb, s.eatWb, s.oaCooling, s.airflow].map(numStr).join('|');
    }
    function seedCapacityState(matchup, cols, scheduleData, initial) {
        function seed(field) {
            if (initial && initial[field] != null) return Number(initial[field]);
            var col = cols[field];
            var v = (col != null) ? scheduleData[col] : undefined;
            return (v != null && isFinite(Number(v))) ? Number(v) : null;
        }
        var st = {
            eatDb: seed('eatDb'), eatWb: seed('eatWb'),
            oaCooling: seed('oaCooling'), airflow: seed('airflow'),
            hpAmbient: seed('hpAmbient')
        };
        // Snap to a valid combo if the seeded one doesn't resolve.
        if (!matchup.cooling[coolKeyOf(st)]) {
            var first = Object.keys(matchup.cooling)[0];
            if (first) {
                var p = first.split('|').map(Number);
                st.eatDb = p[0]; st.eatWb = p[1]; st.oaCooling = p[2]; st.airflow = p[3];
            }
        }
        return st;
    }
    // Values of `field` that form a valid combo with the other three.
    function validAxisValues(matchup, st, field) {
        if (field === 'hpAmbient') return (matchup.hpAxis || []).map(Number);
        var trial = {
            eatDb: st.eatDb, eatWb: st.eatWb,
            oaCooling: st.oaCooling, airflow: st.airflow
        };
        var out = [];
        (matchup.axes[field] || []).forEach(function (v) {
            trial[field] = v;
            if (matchup.cooling[coolKeyOf(trial)]) out.push(v);
        });
        return out;
    }

    // Column letter for each capacity field, resolved from the schedule
    // header by LABEL (cached on the product data object). "TOTAL
    // CAPACITY" is disambiguated by its parent group (COOLING vs HEAT
    // PUMP HEATING DATA); heat-pump total may live in one or two columns.
    function resolveColumns(data) {
        if (data.__capacityCols) return data.__capacityCols;
        var header = (data && data.scheduleHeader) || {};
        var letters = header.columnLetters || [];
        var letterToIdx = {};
        letters.forEach(function (l, i) { letterToIdx[l] = i; });

        var trail = {};
        (header.rows || []).forEach(function (row) {
            row.forEach(function (cell) {
                var start = letterToIdx[cell.col];
                if (start === undefined) return;
                var span = cell.colspan || 1;
                var val = (cell.value == null) ? '' : String(cell.value).trim();
                for (var k = 0; k < span; k++) {
                    var L = letters[start + k];
                    if (L) (trail[L] = trail[L] || []).push(val);
                }
            });
        });
        function find(leaf, group) {
            for (var i = 0; i < letters.length; i++) {
                var t = trail[letters[i]] || [];
                if (t[t.length - 1] !== leaf) continue;
                if (group && t.indexOf(group) < 0) continue;
                return letters[i];
            }
            return null;
        }
        function findAll(leaf, group) {
            var out = [];
            letters.forEach(function (L) {
                var t = trail[L] || [];
                if (t[t.length - 1] !== leaf) return;
                if (group && t.indexOf(group) < 0) return;
                out.push(L);
            });
            return out;
        }
        // Every heat-pump column: the indoor "HEAT PUMP TOTAL CAPACITY"
        // summary plus the whole outdoor "HEAT PUMP HEATING DATA" block
        // (outdoor ambient, total, efficiency). Dropped when a schedule
        // has no heat-pump systems (see scheduleHiddenColumns).
        var heatPumpCols = [];
        letters.forEach(function (L) {
            var t = trail[L] || [];
            if (t.indexOf('HEAT PUMP HEATING DATA') >= 0 ||
                (t.length && t[t.length - 1] === 'HEAT PUMP TOTAL CAPACITY')) {
                heatPumpCols.push(L);
            }
        });
        // Heat-pump total capacity appears twice: a summary in the INDOOR
        // AIR HANDLING UNIT block ("HEAT PUMP TOTAL CAPACITY") and the same
        // value inside the outdoor "HEAT PUMP HEATING DATA" block ("TOTAL
        // CAPACITY"). The dropdowns fill BOTH; the outdoor duplicate is
        // tracked separately so it can be hidden even when heat-pump
        // systems are present (see scheduleHiddenColumns).
        var hpHeatingTotal = findAll('TOTAL CAPACITY', 'HEAT PUMP HEATING DATA');
        var hpTotal = [];
        var k = find('HEAT PUMP TOTAL CAPACITY');
        if (k) hpTotal.push(k);
        hpHeatingTotal.forEach(function (c) {
            if (hpTotal.indexOf(c) < 0) hpTotal.push(c);
        });

        var cols = {
            eatDb:        find('EAT (DB)'),
            eatWb:        find('EAT (WB)'),
            lat:          find('LAT (DB)'),
            coolTotal:    find('TOTAL CAPACITY', 'COOLING'),
            coolSensible: find('SENSIBLE CAPACITY'),
            airflow:      find('AIRFLOW (CFM)'),
            oaCooling:    find('OUTDOOR AMBIENT (COOLING)'),
            hpAmbient:    find('OUTDOOR AMBIENT (DB)', 'HEAT PUMP HEATING DATA'),
            hpTotalCols:  hpTotal,
            hpHeatingTotalCols: hpHeatingTotal,
            heatPumpCols: heatPumpCols,
            outdoorModel: find('MODEL', 'OUTDOOR CONDENSING UNIT'),
            airHandler:   find('MODEL', 'INDOOR AIR HANDLING UNIT')
        };
        data.__capacityCols = cols;
        return cols;
    }

    function matchupFor(scheduleData, cols) {
        if (!cache || !cols.outdoorModel || !cols.airHandler) return null;
        var odu = scheduleData[cols.outdoorModel];
        var ahu = scheduleData[cols.airHandler];
        if (!odu || !ahu) return null;
        var key = String(odu).trim() + ' - ' + String(ahu).trim();
        return (cache.matchups && cache.matchups[key]) || null;
    }

    // -----------------------------------------------------------------
    // Condition-aware lookups (Design Search)
    // -----------------------------------------------------------------
    // Where a Design Search input lands between two rated points, the
    // policy is WORST-CASE: evaluate at every bracketing rated point and
    // keep the one delivering the least capacity, so a system only
    // passes if it meets the load even at the harsher rated condition.
    // Values outside the table range are never extrapolated - they come
    // back flagged outOfRange instead.

    // Bracketing rated points for x on an axis. One of:
    //   { exact: x } | { lo, hi } | { outOfRange: true, min, max } | null
    function bracketOn(axis, x) {
        var vals = (axis || []).map(Number).filter(isFinite)
            .sort(function (a, b) { return a - b; });
        if (!vals.length || !isFinite(x)) return null;
        if (x < vals[0] || x > vals[vals.length - 1]) {
            return { outOfRange: true, min: vals[0], max: vals[vals.length - 1] };
        }
        var lo = null;
        for (var i = 0; i < vals.length; i++) {
            if (vals[i] === x) return { exact: x };
            if (vals[i] < x) lo = vals[i];
            else return { lo: lo, hi: vals[i] };
        }
        return null;
    }

    // Some heat-pump tables hold text like "15900 (standard), 22500
    // (boost)" (DH6VSA wall mounts). For search math the leading number
    // -- the standard, non-boost rating -- is the conservative pick; the
    // schedule cell still displays the full string.
    function capNum(v) {
        if (v == null) return NaN;
        return parseFloat(String(v).replace(/,/g, ''));
    }

    // Heat-pump heating capacity at an outdoor ambient (tables rated at
    // 70F coil EAT). Returns { applicable: false } when the matchup has
    // no heat-pump table; otherwise ambientUsed/capacity hold the
    // worst-case rated point, with lo/hi both reported when off-grid.
    function hpAt(matchup, ambient) {
        if (!matchup || !matchup.hp) return { applicable: false };
        var br = bracketOn(matchup.hpAxis, ambient);
        if (!br) return { applicable: false };
        if (br.outOfRange) {
            return { applicable: true, outOfRange: true, min: br.min, max: br.max };
        }
        function point(a) { return { ambient: a, capacity: capNum(matchup.hp[numStr(a)]) }; }
        if (br.exact != null) {
            var p = point(br.exact);
            if (!isFinite(p.capacity)) return { applicable: true, noData: true };
            return { applicable: true, ambientUsed: p.ambient, capacity: p.capacity };
        }
        var lo = point(br.lo), hi = point(br.hi);
        if (!isFinite(lo.capacity) || !isFinite(hi.capacity)) {
            var only = isFinite(lo.capacity) ? lo : (isFinite(hi.capacity) ? hi : null);
            if (!only) return { applicable: true, noData: true };
            return {
                applicable: true, offGrid: true, lo: only, hi: only,
                ambientUsed: only.ambient, capacity: only.capacity
            };
        }
        var worst = (lo.capacity <= hi.capacity) ? lo : hi;
        return {
            applicable: true, offGrid: true, lo: lo, hi: hi,
            ambientUsed: worst.ambient, capacity: worst.capacity
        };
    }

    // Cooling performance at design conditions. cond = { oa, eatDb,
    // eatWb }; targets = { total, sensible } (either may be null) steer
    // which rated airflow is chosen - the CFM whose worst-case corner
    // best matches the targets wins, ties going to the higher capacity
    // (so with no targets the max-capacity airflow is reported).
    function coolingAt(matchup, cond, targets) {
        if (!matchup || !matchup.cooling) return { applicable: false };
        var axes = matchup.axes || {};
        var br = {
            eatDb: bracketOn(axes.eatDb, cond.eatDb),
            eatWb: bracketOn(axes.eatWb, cond.eatWb),
            oaCooling: bracketOn(axes.oaCooling, cond.oa)
        };
        if (!br.eatDb || !br.eatWb || !br.oaCooling) return { applicable: false };
        var ranges = {};
        var out = false;
        ['eatDb', 'eatWb', 'oaCooling'].forEach(function (f) {
            if (br[f].outOfRange) { out = true; ranges[f] = br[f]; }
        });
        if (out) return { applicable: true, outOfRange: true, ranges: ranges };

        function pts(b) { return (b.exact != null) ? [b.exact] : [b.lo, b.hi]; }
        var dbs = pts(br.eatDb), wbs = pts(br.eatWb), oas = pts(br.oaCooling);
        var offGrid = {};
        ['eatDb', 'eatWb', 'oaCooling'].forEach(function (f) {
            if (br[f].exact == null) offGrid[f] = { lo: br[f].lo, hi: br[f].hi };
        });

        var best = null;
        ((axes.airflow || []).map(Number)).forEach(function (cfm) {
            // Worst-case corner (lowest total) among the rated combos
            // that exist for this airflow. Sparse tables: corners that
            // aren't valid rated combos are skipped, and partial=true
            // records that not every bracket corner was available.
            var worst = null, found = 0, corners = 0;
            dbs.forEach(function (db) {
                wbs.forEach(function (wb) {
                    oas.forEach(function (oa) {
                        corners++;
                        var r = matchup.cooling[[db, wb, oa, cfm].map(numStr).join('|')];
                        if (!r || !isFinite(capNum(r[0]))) return;
                        found++;
                        var c = {
                            eatDb: db, eatWb: wb, oaCooling: oa, airflow: cfm,
                            total: capNum(r[0]), sensible: capNum(r[1]), lat: r[2]
                        };
                        if (!worst || c.total < worst.total) worst = c;
                    });
                });
            });
            if (!worst) return;
            var dev = 0;
            if (targets && targets.total > 0) {
                dev += Math.abs(worst.total - targets.total) / targets.total;
            }
            if (targets && targets.sensible > 0) {
                dev += Math.abs(worst.sensible - targets.sensible) / targets.sensible;
            }
            var cand = { worst: worst, dev: dev, partial: found < corners };
            if (!best || cand.dev < best.dev ||
                (cand.dev === best.dev && cand.worst.total > best.worst.total)) {
                best = cand;
            }
        });
        if (!best) return { applicable: true, noData: true, offGrid: offGrid };
        return {
            applicable: true, offGrid: offGrid, partial: best.partial,
            result: best.worst
        };
    }

    // -----------------------------------------------------------------
    // Per-row controller
    // -----------------------------------------------------------------
    function createController(matchup, cols, scheduleData, initial, onChange) {
        var hasHp = !!(matchup.hp && cols.hpAmbient);

        var st = seedCapacityState(matchup, cols, scheduleData, initial);
        function coolResult() { return matchup.cooling[coolKeyOf(st)]; }

        var selects = {};      // field -> <select>
        var outCells = {};     // field -> [td, ...]

        // Which columns this controller owns.
        var inputCols = {};
        COOL_AXES.forEach(function (f) { if (cols[f]) inputCols[cols[f]] = f; });
        if (hasHp) inputCols[cols.hpAmbient] = 'hpAmbient';
        var outputCols = {};
        if (cols.lat) outputCols[cols.lat] = 'lat';
        if (cols.coolTotal) outputCols[cols.coolTotal] = 'coolTotal';
        if (cols.coolSensible) outputCols[cols.coolSensible] = 'coolSensible';
        if (hasHp) (cols.hpTotalCols || []).forEach(function (c) { outputCols[c] = 'hpTotal'; });

        function validValues(field) {
            return validAxisValues(matchup, st, field);
        }

        function populate(field) {
            var sel = selects[field];
            if (!sel) return;
            var vals = validValues(field);
            // Always keep the current value selectable (covers a saved
            // combo that's no longer valid after a table edit).
            if (st[field] != null && vals.indexOf(st[field]) < 0) vals = vals.concat([st[field]]);
            vals.sort(function (a, b) { return a - b; });
            sel.textContent = '';
            vals.forEach(function (v) {
                var o = el('option');
                o.value = String(v);
                o.textContent = String(v);
                if (v === st[field]) o.selected = true;
                sel.appendChild(o);
            });
        }

        function setOut(field, value) {
            (outCells[field] || []).forEach(function (td) {
                td.textContent = (value == null) ? '-' : String(value);
            });
        }

        function updateCooling() {
            var res = coolResult();
            var invalid = !res;
            setOut('coolTotal', res ? res[0] : '-');
            setOut('coolSensible', res ? res[1] : '-');
            setOut('lat', res ? res[2] : '-');
            COOL_AXES.forEach(function (f) {
                var sel = selects[f];
                if (!sel) return;
                var td = sel.closest('td');
                if (td) td.classList.toggle('capacity-invalid', invalid);
            });
        }

        function updateHp() {
            if (!hasHp) return;
            var cap = matchup.hp[numStr(st.hpAmbient)];
            setOut('hpTotal', cap == null ? '-' : cap);
        }

        function persist() {
            if (typeof onChange === 'function') onChange(getState());
        }

        function onCoolChange() {
            // Other cooling menus' valid options depend on this one.
            COOL_AXES.forEach(populate);
            updateCooling();
            persist();
        }

        function buildSelect(field, td) {
            td.classList.add('kw-variant-cell', 'capacity-input-cell');
            var wrap = el('span', 'kw-variant-control capacity-control');
            var sel = el('select', 'kw-variant-select capacity-select');
            sel.setAttribute('aria-label', ARIA[field] || field);
            selects[field] = sel;
            populate(field);
            sel.addEventListener('change', function () {
                st[field] = Number(sel.value);
                if (field === 'hpAmbient') { updateHp(); persist(); }
                else onCoolChange();
            });
            var chev = el('span', 'kw-variant-chevron');
            chev.setAttribute('aria-hidden', 'true');
            chev.textContent = '▾';
            wrap.appendChild(sel);
            wrap.appendChild(chev);
            td.appendChild(wrap);
        }

        function buildOutput(td, field) {
            td.classList.add('capacity-output-cell');
            (outCells[field] = outCells[field] || []).push(td);
            if (field === 'hpTotal') {
                var cap = matchup.hp[numStr(st.hpAmbient)];
                td.textContent = (cap == null) ? '-' : String(cap);
            } else {
                var res = coolResult();
                var idx = field === 'coolTotal' ? 0 : (field === 'coolSensible' ? 1 : 2);
                td.textContent = res ? String(res[idx]) : '-';
            }
        }

        function getState() {
            return {
                eatDb: st.eatDb, eatWb: st.eatWb,
                oaCooling: st.oaCooling, airflow: st.airflow,
                hpAmbient: st.hpAmbient
            };
        }

        return {
            handles: function (letter) {
                return inputCols[letter] !== undefined || outputCols[letter] !== undefined;
            },
            fillCell: function (td, letter) {
                if (inputCols[letter] !== undefined) buildSelect(inputCols[letter], td);
                else if (outputCols[letter] !== undefined) buildOutput(td, outputCols[letter]);
            },
            // Run once after all cells are placed so initial invalid-state
            // styling reflects the seeded combo.
            finalize: function () { updateCooling(); updateHp(); },
            getState: getState
        };
    }

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------
    HHpro.Capacity = {
        load: load,
        ensureFor: ensureFor,
        isProduct: function (productKey) { return productKey === CAPACITY_PRODUCT; },
        hasTables: function () {
            return !!(cache && cache.matchups && Object.keys(cache.matchups).length);
        },

        // ----- Condition-aware lookups (Design Search) -----
        columnsFor: function (data) { return resolveColumns(data); },
        matchupForRow: function (scheduleData, data) {
            return matchupFor(scheduleData || {}, resolveColumns(data));
        },
        hpAt: hpAt,
        coolingAt: coolingAt,

        /**
         * Native-schedule column letters hidden by DEFAULT, given the
         * selections currently in view. Two rules, resolved by header
         * LABEL so they survive column edits:
         *   - The outdoor "HEAT PUMP HEATING DATA -> TOTAL CAPACITY"
         *     duplicates the indoor "HEAT PUMP TOTAL CAPACITY", so it is
         *     ALWAYS hidden (the HP total shows once, in the AHU section).
         *   - When NONE of the in-view selections is a heat pump, the
         *     whole heat-pump block (indoor HP total + the outdoor HEAT
         *     PUMP HEATING DATA columns) is hidden too - they would all be
         *     "-" anyway.
         * All overridable via "Add / Remove Columns". `selections` is the
         * list of selection objects on screen (browse: the filtered rows;
         * project: the selected units). [] for every other product.
         */
        scheduleHiddenColumns: function (productKey, data, selections) {
            if (productKey !== CAPACITY_PRODUCT || !data || !data.scheduleHeader) {
                return [];
            }
            var cols = resolveColumns(data);
            var hpCols = cols.heatPumpCols || [];
            var anyHeatPump = (selections || []).some(function (sel) {
                var sd = sel && sel.rows && sel.rows[0] && sel.rows[0].scheduleData;
                if (!sd) return false;
                return hpCols.some(function (L) {
                    var v = sd[L];
                    return v != null && v !== '' && v !== '-';
                });
            });
            // Heat pumps present -> drop only the duplicate; otherwise drop
            // the entire (all-"-") heat-pump block.
            return anyHeatPump ? (cols.hpHeatingTotalCols || []).slice()
                               : hpCols.slice();
        },

        /**
         * Build a per-row controller, or null when capacity dropdowns
         * don't apply (wrong product, data not loaded, or no matchup).
         * opts: { productKey, data, scheduleData, initial, onChange }
         */
        rowController: function (opts) {
            if (!opts || opts.productKey !== CAPACITY_PRODUCT || !cache) return null;
            var cols = resolveColumns(opts.data);
            var matchup = matchupFor(opts.scheduleData || {}, cols);
            if (!matchup) return null;
            return createController(matchup, cols, opts.scheduleData || {},
                                    opts.initial || null, opts.onChange || null);
        },

        /**
         * Build ONE constrained capacity dropdown for a single field -
         * used by engineer-template cells, which expose only the subset
         * of capacity inputs that the firm's schedule maps. opts:
         * { field, item, scheduleData, data, onChange }. onChange gets
         * the FULL updated capacityInputs object. Null when N/A.
         */
        fieldControl: function (opts) {
            if (!opts || !cache) return null;
            var cols = resolveColumns(opts.data);
            var matchup = matchupFor(opts.scheduleData || {}, cols);
            if (!matchup) return null;
            var field = opts.field;
            if (field === 'hpAmbient' && !matchup.hp) return null;

            var st = seedCapacityState(matchup, cols, opts.scheduleData || {},
                opts.item && opts.item.capacityInputs);
            var vals = validAxisValues(matchup, st, field);
            var cur = st[field];
            if (cur != null && vals.indexOf(cur) < 0) vals = vals.concat([cur]);
            vals.sort(function (a, b) { return a - b; });

            var wrap = el('span', 'kw-variant-control capacity-control');
            var sel = el('select', 'kw-variant-select capacity-select');
            sel.setAttribute('aria-label', ARIA[field] || field);
            vals.forEach(function (v) {
                var o = el('option');
                o.value = String(v);
                o.textContent = String(v);
                if (v === cur) o.selected = true;
                sel.appendChild(o);
            });
            sel.addEventListener('change', function () {
                var next = {
                    eatDb: st.eatDb, eatWb: st.eatWb, oaCooling: st.oaCooling,
                    airflow: st.airflow, hpAmbient: st.hpAmbient
                };
                next[field] = Number(sel.value);
                if (typeof opts.onChange === 'function') opts.onChange(next);
            });
            var chev = el('span', 'kw-variant-chevron');
            chev.setAttribute('aria-hidden', 'true');
            chev.textContent = '▾';
            wrap.appendChild(sel);
            wrap.appendChild(chev);
            return wrap;
        },

        /**
         * Schedule-cell overrides (letter -> value) for an item's saved
         * capacity conditions, so the Excel/CAD/PDF exports show the
         * chosen inputs + looked-up outputs. {} when not applicable.
         */
        overridesFor: function (item, scheduleData, data) {
            if (!cache || !item || !item.capacityInputs) return {};
            var cols = resolveColumns(data);
            var matchup = matchupFor(scheduleData || {}, cols);
            if (!matchup) return {};
            var ci = item.capacityInputs;
            var out = {};
            function put(col, v) { if (col != null && v != null) out[col] = v; }
            put(cols.eatDb, ci.eatDb);
            put(cols.eatWb, ci.eatWb);
            put(cols.oaCooling, ci.oaCooling);
            put(cols.airflow, ci.airflow);
            var res = matchup.cooling[[ci.eatDb, ci.eatWb, ci.oaCooling, ci.airflow].map(numStr).join('|')];
            if (cols.coolTotal) out[cols.coolTotal] = res ? res[0] : '-';
            if (cols.coolSensible) out[cols.coolSensible] = res ? res[1] : '-';
            if (cols.lat) out[cols.lat] = res ? res[2] : '-';
            if (matchup.hp && ci.hpAmbient != null) {
                put(cols.hpAmbient, ci.hpAmbient);
                var cap = matchup.hp[numStr(ci.hpAmbient)];
                (cols.hpTotalCols || []).forEach(function (c) {
                    if (c) out[c] = (cap == null) ? '-' : cap;
                });
            }
            return out;
        }
    };

    // Warm the cache in the background so the dropdowns are ready by the
    // time the user opens a Multi Position Split schedule.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', load);
    } else {
        load();
    }
})();
