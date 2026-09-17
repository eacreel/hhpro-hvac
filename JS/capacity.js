/* ============================================================
   HHpro - Split system capacity tables (HHpro.Capacity)
   ------------------------------------------------------------
   Drives the cooling + heat-pump capacity dropdowns on the Multi
   Position Split AND Mini Split / Sky Air schedules. A system whose
   outdoor-unit + indoor-unit pair matches a tab in a capacity
   workbook gets:

     - cooling dropdowns: EAT (DB), EAT (WB), Outdoor Ambient
       (Cooling) and - where the table rates more than one - Airflow
       (CFM). Changing any of them looks up the table and fills
       Total / Sensible / LAT (DB) / LAT (WB). Mini split and Sky Air
       tables carry ONE rated airflow, so that cell is written as a
       fixed value instead of a dropdown.
     - heat-pump dropdowns: Outdoor Ambient (DB) and, when the
       schedule has a heating EDB column and the table varies by it
       (mini splits / Sky Air), the heating Entering DB. Together
       they fill the Heat Pump Total Capacity.

   The dropdowns are constrained to valid combinations only: each
   menu offers just the values that form a valid combo with the
   other current selections, so an invalid combo can never be
   picked. (A saved combo that becomes invalid after a table edit is
   shown but flagged - see the .capacity-invalid styling.)

   Data (both built by convert_to_json.py):
     DATA/JSON/multi_position_split_capacity.json  - multi position
         splits; heat pump keyed by outdoor ambient only (tables rated
         at 70F coil EAT).
     DATA/JSON/mini_split_sky_air_capacity.json    - mini splits + Sky
         Air; cooling values also carry LAT (WB) and kW, heat pump keyed
         by "outdoor DB|indoor EDB". The FTA Sky Air multi position air
         handlers live in THIS file but sit on the Multi Position Split
         tab, so that product loads both files and folds the FTA tables
         in with their heat pump collapsed to the 70F indoor column.

   Schedule columns are resolved by header NAME, not a fixed letter,
   so the feature survives schedule column edits. The leaving-air
   psychrometrics (LAT (WB) for tables that don't store it, and the
   static LDB / LWB cells on rows without a table) come from
   HHpro.CapacityCore.leavingAir.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var MPS = 'multi_position_splits';
    var MINI = 'mini_splits';
    var URL_MPS = 'DATA/JSON/multi_position_split_capacity.json';
    var URL_MINI = 'DATA/JSON/mini_split_sky_air_capacity.json';

    // Indoor heating EDB the classic (ambient-only) heat-pump tables are
    // rated at, and the column a two-axis table collapses to when the
    // schedule has no heating-EDB dropdown (FTA on the multi position tab).
    var HP_EAT_DEFAULT = 70;

    // Per product: which files feed it, how its schedule header maps to
    // capacity fields, and whether its heat-pump lookup keeps both axes.
    var PRODUCTS = {};
    PRODUCTS[MPS]  = { sources: [URL_MPS, URL_MINI], resolve: resolveMpsColumns,  twoAxisHp: false };
    PRODUCTS[MINI] = { sources: [URL_MINI],          resolve: resolveMiniColumns, twoAxisHp: true  };

    var PRODUCT_TYPES = { 'MULTI POSITION SPLITS': MPS, 'MINI SPLITS': MINI };

    var fileCache = {};      // url -> Promise<raw json>
    var caches = {};         // productKey -> { matchups }
    var loadPromises = {};   // productKey -> Promise<cache>

    var COOL_AXES = ['eatDb', 'eatWb', 'oaCooling', 'airflow'];

    // Aux. electric heat temperature rise. kW is sized from
    //     kW = (CFM x deltaT) / 3193
    // so the rise a row should show is the inverse of that. It has to be
    // computed live because BOTH of its inputs are dropdowns: airflow (a
    // capacity axis, below) and kW (the variant dropdown - see kwVariants
    // in data.js). The value baked into the schedule JSON is only correct
    // at the airflow the source workbook used for that row, so it used to
    // sit unchanged while the user moved the CFM dropdown.
    //
    // Verified against the shipped data: this reproduces the stored
    // TEMPERATURE RISE (DB) for all 491 rows that carry one, so nothing
    // changes at a row's baseline airflow - only off-baseline airflows,
    // which were previously wrong.
    var TEMP_RISE_K = 3193;

    function tempRise(kw, cfm) {
        var k = Number(kw);
        var c = Number(cfm);
        if (!isFinite(k) || !isFinite(c) || c <= 0) return null;
        return k * TEMP_RISE_K / c;
    }

    var ARIA = {
        eatDb:     'Entering air dry bulb (°F)',
        eatWb:     'Entering air wet bulb (°F)',
        oaCooling: 'Outdoor ambient, cooling (°F)',
        airflow:   'Airflow (CFM)',
        hpAmbient: 'Heat-pump outdoor ambient (°F)',
        hpEatDb:   'Heat-pump entering air dry bulb (°F)'
    };

    // Product-neutral table math lives in capacity_core.js so the Gas Pack
    // RTU tables get the identical off-grid policy (see the note there).
    var numStr = HHpro.CapacityCore.numStr;
    var capNum = HHpro.CapacityCore.capNum;
    var bracketOn = HHpro.CapacityCore.bracketOn;

    // -----------------------------------------------------------------
    // Loading
    // -----------------------------------------------------------------
    function fetchFile(url) {
        if (fileCache[url]) return fileCache[url];
        fileCache[url] = fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('capacity tables ' + r.status);
                return r.json();
            })
            .then(function (json) { return (json && json.matchups) ? json : { matchups: {} }; })
            .catch(function () {
                // Missing/unreadable: degrade to "no matchups" so the
                // schedule just renders its static values.
                return { matchups: {} };
            });
        return fileCache[url];
    }

    function nearest(list, target) {
        var best = null;
        (list || []).map(Number).forEach(function (v) {
            if (!isFinite(v)) return;
            if (best === null || Math.abs(v - target) < Math.abs(best - target)) best = v;
        });
        return best;
    }

    function hpValue(v) {
        // Two-axis files store [BTU/h, kW]; classic files a number or the
        // "15900 (standard), 22500 (boost)" text. Keep the capacity only.
        return Array.isArray(v) ? v[0] : v;
    }

    // Bring a raw matchup into the one internal shape the controller
    // understands:
    //   { axes, cooling,                       cooling values [ct, cs, lat, lwb?, kw?]
    //     hpAxis: [...], hp: { "<amb>": cap }                      (classic)
    //     hpAxes: { oaDb, eatDb }, hp: { "<amb>|<edb>": cap }     (two-axis)
    //     hpEatDbFixed: 70 }   // set when a two-axis table was collapsed
    function normalize(raw, twoAxisHp) {
        var m = { axes: raw.axes || {}, cooling: raw.cooling || {} };
        if (!raw.hp) return m;
        if (raw.hpAxes) {
            if (twoAxisHp) {
                m.hpAxes = {
                    oaDb: (raw.hpAxes.oaDb || []).map(Number),
                    eatDb: (raw.hpAxes.eatDb || []).map(Number)
                };
                m.hp = {};
                Object.keys(raw.hp).forEach(function (k) { m.hp[k] = hpValue(raw.hp[k]); });
            } else {
                var edb = nearest(raw.hpAxes.eatDb, HP_EAT_DEFAULT);
                m.hpEatDbFixed = edb;
                m.hpAxis = (raw.hpAxes.oaDb || []).map(Number);
                m.hp = {};
                m.hpAxis.forEach(function (a) {
                    var v = raw.hp[numStr(a) + '|' + numStr(edb)];
                    if (v != null) m.hp[numStr(a)] = hpValue(v);
                });
            }
        } else {
            m.hpAxis = (raw.hpAxis || []).map(Number);
            m.hp = raw.hp;
        }
        return m;
    }

    function load(productKey) {
        if (!productKey) {
            // Warm every product in the background.
            return Promise.all(Object.keys(PRODUCTS).map(load));
        }
        var cfg = PRODUCTS[productKey];
        if (!cfg) return Promise.resolve(null);
        if (caches[productKey]) return Promise.resolve(caches[productKey]);
        if (loadPromises[productKey]) return loadPromises[productKey];
        loadPromises[productKey] = Promise.all(cfg.sources.map(fetchFile))
            .then(function (files) {
                var matchups = {};
                files.forEach(function (json) {
                    Object.keys(json.matchups || {}).forEach(function (key) {
                        // First file wins on a duplicate key.
                        if (matchups[key]) return;
                        matchups[key] = normalize(json.matchups[key], cfg.twoAxisHp);
                    });
                });
                caches[productKey] = { matchups: matchups };
                return caches[productKey];
            });
        return loadPromises[productKey];
    }

    // Resolve before rendering a product whose schedule may use capacity
    // dropdowns. No-op (already resolved) for every other product.
    function ensureFor(productKey) {
        return PRODUCTS[productKey] ? load(productKey) : Promise.resolve(null);
    }

    function cacheFor(productKey) {
        return caches[productKey] || null;
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------
    function el(tag, cls) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        return e;
    }

    function round1(v) {
        return Math.round(Number(v) * 10) / 10;
    }

    function blank(v) {
        return v === null || v === undefined || v === '' || v === '-';
    }

    // Which capacity product a schedule JSON belongs to. The converter
    // stamps productType; fall back to sniffing the header groups.
    function productKeyOf(data) {
        if (!data) return null;
        if (data.__capacityProduct) return data.__capacityProduct;
        var key = PRODUCT_TYPES[String(data.productType || '').trim().toUpperCase()] || null;
        if (!key) {
            var trails = headerTrails(data);
            var all = Object.keys(trails).map(function (L) { return trails[L].join('|'); }).join('|');
            if (all.indexOf('INDOOR AIR HANDLING UNIT') >= 0) key = MPS;
            else if (all.indexOf('OUTDOOR UNIT') >= 0) key = MINI;
        }
        data.__capacityProduct = key;
        return key;
    }

    // ----- Cooling-combo helpers (shared by the row controller and the
    // single-field control used inside engineer templates) -----
    function coolKeyOf(s) {
        return [s.eatDb, s.eatWb, s.oaCooling, s.airflow].map(numStr).join('|');
    }
    function hpKeyOf(matchup, s) {
        return matchup.hpAxes
            ? numStr(s.hpAmbient) + '|' + numStr(s.hpEatDb)
            : numStr(s.hpAmbient);
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
            hpAmbient: seed('hpAmbient'), hpEatDb: seed('hpEatDb')
        };
        // A table rated at ONE airflow always uses it (the schedule's
        // nominal CFM may differ slightly from the table's).
        var af = matchup.axes.airflow || [];
        if (af.length === 1) st.airflow = Number(af[0]);
        // Snap to a valid combo if the seeded one doesn't resolve.
        if (!matchup.cooling[coolKeyOf(st)]) {
            var first = Object.keys(matchup.cooling)[0];
            if (first) {
                var p = first.split('|').map(Number);
                st.eatDb = p[0]; st.eatWb = p[1]; st.oaCooling = p[2]; st.airflow = p[3];
            }
        }
        if (matchup.hp) {
            if (matchup.hpAxes) {
                if (st.hpEatDb == null) st.hpEatDb = nearest(matchup.hpAxes.eatDb, HP_EAT_DEFAULT);
                if (st.hpAmbient == null) st.hpAmbient = nearest(matchup.hpAxes.oaDb, 47);
                if (matchup.hp[hpKeyOf(matchup, st)] == null) {
                    var k = Object.keys(matchup.hp)[0];
                    if (k) {
                        var q = k.split('|').map(Number);
                        st.hpAmbient = q[0]; st.hpEatDb = q[1];
                    }
                }
            } else {
                st.hpEatDb = matchup.hpEatDbFixed != null ? matchup.hpEatDbFixed : HP_EAT_DEFAULT;
                if (st.hpAmbient == null || matchup.hp[numStr(st.hpAmbient)] == null) {
                    var a = nearest(matchup.hpAxis, 47);
                    if (a !== null) st.hpAmbient = a;
                }
            }
        }
        return st;
    }
    // Values of `field` that form a valid combo with the other selections.
    function validAxisValues(matchup, st, field) {
        var out = [];
        if (field === 'hpAmbient' || field === 'hpEatDb') {
            if (!matchup.hp) return out;
            if (!matchup.hpAxes) {
                return field === 'hpAmbient' ? (matchup.hpAxis || []).map(Number) : out;
            }
            var t = { hpAmbient: st.hpAmbient, hpEatDb: st.hpEatDb };
            var axis = field === 'hpAmbient' ? matchup.hpAxes.oaDb : matchup.hpAxes.eatDb;
            (axis || []).forEach(function (v) {
                t[field] = v;
                if (matchup.hp[hpKeyOf(matchup, t)] != null) out.push(v);
            });
            return out;
        }
        var trial = {
            eatDb: st.eatDb, eatWb: st.eatWb,
            oaCooling: st.oaCooling, airflow: st.airflow
        };
        // Entering DB and WB come as PAIRS in the mini split / Sky Air
        // tables (80/67, 72/61, ...), so constraining each strictly to the
        // other would lock both menus. Relax the partner: a DB is offered
        // when ANY rated WB pairs with it (and vice versa); snapPartner()
        // then pulls the partner onto the matching value after a change.
        var partner = field === 'eatDb' ? 'eatWb' : (field === 'eatWb' ? 'eatDb' : null);
        var partnerVals = partner ? (matchup.axes[partner] || []) : [null];
        (matchup.axes[field] || []).forEach(function (v) {
            trial[field] = v;
            for (var i = 0; i < partnerVals.length; i++) {
                if (partner) trial[partner] = partnerVals[i];
                if (matchup.cooling[coolKeyOf(trial)]) { out.push(v); break; }
            }
            if (partner) trial[partner] = st[partner];
        });
        return out;
    }
    // After eatDb / eatWb changes, move its partner onto a value that
    // forms a rated pair (the closest one to the current partner value).
    function snapPartner(matchup, st, field) {
        var partner = field === 'eatDb' ? 'eatWb' : (field === 'eatWb' ? 'eatDb' : null);
        if (!partner || matchup.cooling[coolKeyOf(st)]) return;
        var trial = {
            eatDb: st.eatDb, eatWb: st.eatWb,
            oaCooling: st.oaCooling, airflow: st.airflow
        };
        var best = null;
        (matchup.axes[partner] || []).forEach(function (v) {
            trial[partner] = v;
            if (!matchup.cooling[coolKeyOf(trial)]) return;
            if (best === null || Math.abs(v - st[partner]) < Math.abs(best - st[partner])) best = v;
        });
        if (best !== null) st[partner] = best;
    }

    // Leaving wet bulb for a cooling result: stored in the table when the
    // workbook carried it (mini splits / Sky Air), otherwise computed from
    // the rated point (multi position tables).
    function lwbOf(res, st) {
        if (!res) return null;
        if (res[3] != null && res[3] !== '') return res[3];
        var r = HHpro.CapacityCore.leavingAir(st.eatDb, st.eatWb, st.airflow, res[0], res[1]);
        return r ? round1(r.lwb) : null;
    }

    // -----------------------------------------------------------------
    // Column resolution (by header label)
    // -----------------------------------------------------------------
    // For every column letter, the header labels stacked above it
    // (top group -> leaf), so a field can be found by its leaf label and
    // disambiguated by any group it sits under.
    function headerTrails(data) {
        if (data.__capacityTrails) return data.__capacityTrails;
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
        data.__capacityTrails = { letters: letters, trail: trail };
        return data.__capacityTrails;
    }

    function finders(data) {
        var ht = headerTrails(data);
        var letters = ht.letters, trail = ht.trail;
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
        return { letters: letters, trail: trail, find: find, findAll: findAll };
    }

    // Multi Position Split schedule. "TOTAL CAPACITY" is disambiguated by
    // its parent group (COOLING vs HEAT PUMP HEATING DATA); heat-pump total
    // may live in one or two columns.
    function resolveMpsColumns(data) {
        var f = finders(data);
        var find = f.find, findAll = f.findAll, letters = f.letters, trail = f.trail;
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
        return {
            eatDb:        find('EAT (DB)'),
            eatWb:        find('EAT (WB)'),
            lat:          find('LAT (DB)'),
            lwb:          find('LAT (WB)'),
            coolTotal:    find('TOTAL CAPACITY', 'COOLING'),
            coolSensible: find('SENSIBLE CAPACITY'),
            airflow:      find('AIRFLOW (CFM)'),
            auxKw:        find('kW', 'AUX. ELECTRIC HEAT'),
            tempRise:     find('TEMPERATURE RISE (DB)'),
            oaCooling:    find('OUTDOOR AMBIENT (COOLING)'),
            hpAmbient:    find('OUTDOOR AMBIENT (DB)', 'HEAT PUMP HEATING DATA'),
            hpEatDb:      null,   // no heating-EDB column on this schedule
            hpTotalCols:  hpTotal,
            hpHeatingTotalCols: hpHeatingTotal,
            heatPumpCols: heatPumpCols,
            outdoorModel: find('MODEL', 'OUTDOOR CONDENSING UNIT'),
            airHandler:   find('MODEL', 'INDOOR AIR HANDLING UNIT')
        };
    }

    // Mini Split schedule (one indoor unit per row; outdoor columns on
    // the first row). "EDB" and "TOTAL CAPACITY" each appear under both
    // COOLING CAPACITY and HEAT PUMP HEATING CAPACITY.
    function resolveMiniColumns(data) {
        var f = finders(data);
        var find = f.find;
        var hpTotal = find('TOTAL CAPACITY', 'HEAT PUMP HEATING CAPACITY');
        return {
            eatDb:        find('EDB', 'COOLING CAPACITY'),
            eatWb:        find('EWB', 'COOLING CAPACITY'),
            lat:          find('LDB', 'COOLING CAPACITY'),
            lwb:          find('LWB', 'COOLING CAPACITY'),
            coolTotal:    find('TOTAL CAPACITY', 'COOLING CAPACITY'),
            coolSensible: find('SENSIBLE CAPACITY', 'COOLING CAPACITY'),
            airflow:      find('CFM'),
            auxKw:        null,
            tempRise:     null,
            oaCooling:    find('OA AMBIENT (COOLING)'),
            hpAmbient:    find('OA AMBIENT (HEATING)'),
            hpEatDb:      find('EDB', 'HEAT PUMP HEATING CAPACITY'),
            hpTotalCols:  hpTotal ? [hpTotal] : [],
            hpHeatingTotalCols: [],
            heatPumpCols: [],
            outdoorModel: find('MODEL', 'OUTDOOR UNIT'),
            airHandler:   find('MODEL', 'INDOOR UNIT')
        };
    }

    // Column letter for each capacity field (cached on the product data
    // object).
    function resolveColumns(data, productKey) {
        if (!data) return {};
        if (data.__capacityCols) return data.__capacityCols;
        var key = productKey || productKeyOf(data);
        var cfg = PRODUCTS[key];
        var cols = cfg ? cfg.resolve(data) : {};
        data.__capacityCols = cols;
        return cols;
    }

    function matchupFor(productKey, scheduleData, cols) {
        var cache = cacheFor(productKey);
        if (!cache || !cols.outdoorModel || !cols.airHandler) return null;
        var odu = scheduleData[cols.outdoorModel];
        var ahu = scheduleData[cols.airHandler];
        if (!odu || !ahu) return null;
        var key = String(odu).trim() + ' - ' + String(ahu).trim();
        return (cache.matchups && cache.matchups[key]) || null;
    }

    // -----------------------------------------------------------------
    // Static leaving-air fill
    // -----------------------------------------------------------------
    // Fill blank LDB / LWB (mini splits) and LAT (WB) (multi position)
    // cells on every schedule row from that row's rated point, so rows
    // WITHOUT a capacity table still show leaving conditions. Rows with a
    // table are overwritten live by the dropdown controller. Runs once,
    // right after a product's JSON loads (see HHpro.Data.loadProduct).
    function fillLeavingAir(productKey, data) {
        if (!PRODUCTS[productKey] || !data || !data.selections) return;
        data.__capacityProduct = productKey;
        var cols = resolveColumns(data, productKey);
        if (!cols.lwb && !cols.lat) return;
        if (!cols.eatDb || !cols.eatWb || !cols.airflow || !cols.coolTotal || !cols.coolSensible) return;
        data.selections.forEach(function (sel) {
            (sel.rows || []).forEach(function (row) {
                var sd = row && row.scheduleData;
                if (!sd) return;
                var needLat = cols.lat && blank(sd[cols.lat]);
                var needLwb = cols.lwb && blank(sd[cols.lwb]);
                if (!needLat && !needLwb) return;
                var r = HHpro.CapacityCore.leavingAir(
                    sd[cols.eatDb], sd[cols.eatWb], sd[cols.airflow],
                    sd[cols.coolTotal], sd[cols.coolSensible]);
                if (!r) return;
                if (needLat) sd[cols.lat] = round1(r.ldb);
                if (needLwb) sd[cols.lwb] = round1(r.lwb);
            });
        });
    }

    // -----------------------------------------------------------------
    // Condition-aware lookups (Design Search)
    // -----------------------------------------------------------------
    // The worst-case off-grid policy and the cooling lookup itself live in
    // capacity_core.js (bracketOn / capNum / coolingAt, aliased above), so
    // Multi Position Splits and Gas Pack RTUs cannot drift apart. The
    // heat-pump side below stays here - note it snaps the ambient DOWN,
    // the opposite of cooling, because the COLDER bracketing ambient is
    // the harsher heating condition.
    //
    // Some heat-pump tables hold text like "15900 (standard), 22500 (boost)"
    // (DH6VSA wall mounts); capNum takes the leading standard rating for
    // search math while the schedule cell still displays the full string.

    // Ambient-only view of a matchup's heat-pump table (two-axis tables
    // are read at the 70F indoor column, the same rating point the
    // classic tables use).
    function hpClassic(matchup) {
        if (!matchup || !matchup.hp) return null;
        if (!matchup.hpAxes) {
            return {
                axis: matchup.hpAxis || [],
                get: function (a) { return matchup.hp[numStr(a)]; }
            };
        }
        var edb = nearest(matchup.hpAxes.eatDb, HP_EAT_DEFAULT);
        return {
            axis: matchup.hpAxes.oaDb || [],
            get: function (a) { return matchup.hp[numStr(a) + '|' + numStr(edb)]; }
        };
    }

    // Heat-pump heating capacity at an outdoor ambient (tables rated at
    // 70F coil EAT). Returns { applicable: false } when the matchup has
    // no heat-pump table; otherwise ambientUsed/capacity hold the
    // worst-case rated point, with lo/hi both reported when off-grid.
    function hpAt(matchup, ambient) {
        var view = hpClassic(matchup);
        if (!view) return { applicable: false };
        var br = bracketOn(view.axis, ambient);
        if (!br) return { applicable: false };
        if (br.outOfRange) {
            return { applicable: true, outOfRange: true, min: br.min, max: br.max };
        }
        function point(a) { return { ambient: a, capacity: capNum(view.get(a)) }; }
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
        // Worst case for heating = the COLDER bracketing ambient.
        return {
            applicable: true, offGrid: true, lo: lo, hi: hi,
            ambientUsed: lo.ambient, capacity: lo.capacity
        };
    }

    // Cooling performance at design conditions. A matchup already carries
    // { axes, cooling } in the core's shape, so this is the core lookup
    // unchanged - kept as a named alias because it is part of the public API.
    var coolingAt = HHpro.CapacityCore.coolingAt;

    // -----------------------------------------------------------------
    // Per-row controller
    // -----------------------------------------------------------------
    function createController(matchup, cols, scheduleData, initial, onChange) {
        var hasHp = !!(matchup.hp && cols.hpAmbient);
        // Two-axis heat pump with a heating-EDB column on the schedule ->
        // a second dropdown; otherwise the EDB is fixed (see seed).
        var hpTwoAxis = hasHp && !!matchup.hpAxes;
        var hpEatSelect = hpTwoAxis && !!cols.hpEatDb;
        // A table rated at one airflow: the CFM cell is written, not picked.
        var airflowFixed = (matchup.axes.airflow || []).length === 1;

        var st = seedCapacityState(matchup, cols, scheduleData, initial);
        function coolResult() { return matchup.cooling[coolKeyOf(st)]; }
        function hpResult() { return hasHp ? matchup.hp[hpKeyOf(matchup, st)] : null; }

        // Aux electric heat kW. Owned by the kW variant dropdown, which
        // lives in the row renderers (base.js / project_view.js) - they
        // push the new value in via setAuxKw() so the derived temperature
        // rise below follows both dropdowns. Seeded from the current
        // variant's row so the first paint is right.
        var auxKw = cols.auxKw != null ? scheduleData[cols.auxKw] : null;
        // Static fallback: shown when kW is blank or "-" (no aux heat), so
        // those rows render exactly as they always have.
        var staticRise = cols.tempRise != null ? scheduleData[cols.tempRise] : null;

        function riseText() {
            var v = tempRise(auxKw, st.airflow);
            if (v == null) {
                return (staticRise == null || staticRise === '') ? '-' : String(staticRise);
            }
            // Match the 2-decimal rounding the schedule applies to this
            // column (see ProductExtensions.multi_position_splits).
            return String(Number(v.toFixed(2)));
        }

        var selects = {};      // field -> <select>
        var outCells = {};     // field -> [td, ...]

        // Which columns this controller owns.
        var inputCols = {};
        COOL_AXES.forEach(function (f) {
            if (f === 'airflow' && airflowFixed) return;
            if (cols[f]) inputCols[cols[f]] = f;
        });
        if (hasHp) inputCols[cols.hpAmbient] = 'hpAmbient';
        if (hpEatSelect) inputCols[cols.hpEatDb] = 'hpEatDb';
        var outputCols = {};
        if (airflowFixed && cols.airflow) outputCols[cols.airflow] = 'airflow';
        if (cols.lat) outputCols[cols.lat] = 'lat';
        if (cols.lwb) outputCols[cols.lwb] = 'lwb';
        if (cols.coolTotal) outputCols[cols.coolTotal] = 'coolTotal';
        if (cols.coolSensible) outputCols[cols.coolSensible] = 'coolSensible';
        if (hasHp) (cols.hpTotalCols || []).forEach(function (c) { outputCols[c] = 'hpTotal'; });
        // Claiming the temperature-rise column here also takes it OUT of the
        // kW dropdown's "dependent columns" path in the row renderers (they
        // check capCtrl.handles() first), so there's only one writer.
        if (cols.tempRise) outputCols[cols.tempRise] = 'tempRise';

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

        function outValue(field) {
            if (field === 'tempRise') return riseText();
            if (field === 'airflow') return st.airflow;
            if (field === 'hpTotal') {
                var cap = hpResult();
                return (cap == null) ? '-' : cap;
            }
            var res = coolResult();
            if (!res) return '-';
            if (field === 'coolTotal') return res[0];
            if (field === 'coolSensible') return res[1];
            if (field === 'lat') return res[2];
            if (field === 'lwb') { var w = lwbOf(res, st); return (w == null) ? '-' : w; }
            return '-';
        }

        function updateCooling() {
            var invalid = !coolResult();
            ['coolTotal', 'coolSensible', 'lat', 'lwb', 'airflow'].forEach(function (f) {
                setOut(f, outValue(f));
            });
            COOL_AXES.forEach(function (f) {
                var sel = selects[f];
                if (!sel) return;
                var td = sel.closest('td');
                if (td) td.classList.toggle('capacity-invalid', invalid);
            });
        }

        function updateHp() {
            if (!hasHp) return;
            setOut('hpTotal', outValue('hpTotal'));
            var invalid = hpResult() == null;
            ['hpAmbient', 'hpEatDb'].forEach(function (f) {
                var sel = selects[f];
                if (!sel) return;
                var td = sel.closest('td');
                if (td) td.classList.toggle('capacity-invalid', invalid);
            });
        }

        function updateTempRise() {
            setOut('tempRise', riseText());
        }

        function persist() {
            if (typeof onChange === 'function') onChange(getState());
        }

        function onCoolChange() {
            // Other cooling menus' valid options depend on this one.
            COOL_AXES.forEach(populate);
            updateCooling();
            updateTempRise();   // airflow may have moved
            persist();
        }

        function onHpChange() {
            ['hpAmbient', 'hpEatDb'].forEach(populate);
            updateHp();
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
                if (field === 'hpAmbient' || field === 'hpEatDb') onHpChange();
                else { snapPartner(matchup, st, field); onCoolChange(); }
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
            var v = outValue(field);
            td.textContent = (v == null) ? '-' : String(v);
        }

        function getState() {
            return {
                eatDb: st.eatDb, eatWb: st.eatWb,
                oaCooling: st.oaCooling, airflow: st.airflow,
                hpAmbient: st.hpAmbient, hpEatDb: st.hpEatDb
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
            finalize: function () { updateCooling(); updateHp(); updateTempRise(); },
            // Called by the row renderers when the kW variant dropdown
            // changes - the other half of the temperature-rise inputs.
            setAuxKw: function (kw) { auxKw = kw; updateTempRise(); },
            getState: getState
        };
    }

    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------
    HHpro.Capacity = {
        load: load,
        ensureFor: ensureFor,
        isProduct: function (productKey) { return !!PRODUCTS[productKey]; },
        // With a productKey: that product's tables are loaded and non-empty.
        // Without: any product's are (kept for older callers).
        hasTables: function (productKey) {
            var keys = productKey ? [productKey] : Object.keys(caches);
            return keys.some(function (k) {
                var c = caches[k];
                return !!(c && c.matchups && Object.keys(c.matchups).length);
            });
        },
        fillLeavingAir: fillLeavingAir,

        // ----- Condition-aware lookups (Design Search) -----
        columnsFor: function (data) { return resolveColumns(data); },
        matchupForRow: function (scheduleData, data) {
            return matchupFor(productKeyOf(data), scheduleData || {}, resolveColumns(data));
        },
        hpAt: hpAt,
        coolingAt: coolingAt,

        /**
         * Native-schedule column letters hidden by DEFAULT, given the
         * selections currently in view. Multi Position Splits only. Two
         * rules, resolved by header LABEL so they survive column edits:
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
            if (productKey !== MPS || !data || !data.scheduleHeader) {
                return [];
            }
            var cols = resolveColumns(data, productKey);
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
            if (!opts || !PRODUCTS[opts.productKey] || !cacheFor(opts.productKey)) return null;
            var cols = resolveColumns(opts.data, opts.productKey);
            var matchup = matchupFor(opts.productKey, opts.scheduleData || {}, cols);
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
            if (!opts) return null;
            var productKey = productKeyOf(opts.data);
            if (!cacheFor(productKey)) return null;
            var cols = resolveColumns(opts.data, productKey);
            var matchup = matchupFor(productKey, opts.scheduleData || {}, cols);
            if (!matchup) return null;
            var field = opts.field;
            if ((field === 'hpAmbient' || field === 'hpEatDb') && !matchup.hp) return null;
            if (field === 'hpEatDb' && !matchup.hpAxes) return null;

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
                    airflow: st.airflow, hpAmbient: st.hpAmbient, hpEatDb: st.hpEatDb
                };
                next[field] = Number(sel.value);
                snapPartner(matchup, next, field);
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
            if (!item || !item.capacityInputs) return {};
            var productKey = productKeyOf(data);
            if (!cacheFor(productKey)) return {};
            var cols = resolveColumns(data, productKey);
            var matchup = matchupFor(productKey, scheduleData || {}, cols);
            if (!matchup) return {};
            // Re-seed through the same path the controller uses, so a
            // fixed-airflow table and a defaulted heating EDB resolve the
            // same way on export as on screen.
            var ci = seedCapacityState(matchup, cols, scheduleData || {}, item.capacityInputs);
            var out = {};
            function put(col, v) { if (col != null && v != null) out[col] = v; }
            put(cols.eatDb, ci.eatDb);
            put(cols.eatWb, ci.eatWb);
            put(cols.oaCooling, ci.oaCooling);
            put(cols.airflow, ci.airflow);
            var res = matchup.cooling[coolKeyOf(ci)];
            if (cols.coolTotal) out[cols.coolTotal] = res ? res[0] : '-';
            if (cols.coolSensible) out[cols.coolSensible] = res ? res[1] : '-';
            if (cols.lat) out[cols.lat] = res ? res[2] : '-';
            if (cols.lwb) { var w = lwbOf(res, ci); out[cols.lwb] = (w == null) ? '-' : w; }
            if (matchup.hp && ci.hpAmbient != null) {
                put(cols.hpAmbient, ci.hpAmbient);
                if (matchup.hpAxes) put(cols.hpEatDb, ci.hpEatDb);
                var cap = matchup.hp[hpKeyOf(matchup, ci)];
                (cols.hpTotalCols || []).forEach(function (c) {
                    if (c) out[c] = (cap == null) ? '-' : cap;
                });
            }
            // Temperature rise follows the chosen airflow. kW comes from
            // scheduleData because the cart item's selection IS the chosen
            // kW variant. Left alone (static value stands) when there's no
            // aux heat. Rounding is applied downstream by formatCellValue.
            if (cols.tempRise && cols.auxKw) {
                var rise = tempRise(scheduleData[cols.auxKw], ci.airflow);
                if (rise != null) out[cols.tempRise] = rise;
            }
            return out;
        }
    };

    HHpro.CapacityCore.register(MPS, HHpro.Capacity);
    HHpro.CapacityCore.register(MINI, HHpro.Capacity);

    // Warm the caches in the background so the dropdowns are ready by the
    // time the user opens a split system schedule.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { load(); });
    } else {
        load();
    }
})();
