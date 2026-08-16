/* ============================================================
   HHpro - GAS PACK RTUS product extension
   ------------------------------------------------------------
   Gas packs use the default single-row schedule rendering from
   base.js. What lives here is HHpro.GasPackDesign: the bridge
   between a Design Search result and the schedule row it maps to.

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
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};
    HHpro.ProductExtensions.gas_packs = {};

    var PRODUCT = 'gas_packs';
    var STORE_KEY = 'hhpro.gasPackDesign.v1';

    // Schedule columns the toggle writes, resolved by header LABEL so the
    // feature survives column edits (the same approach capacity.js uses).
    // The degree sign is matched loosely because the JSON carries it as a
    // mojibake'd byte pair in some builds.
    var COLUMN_LABELS = {
        model: 'MODEL NUMBER',
        tons: 'NOM TONS',
        cfm: 'CFM',
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

    var WARNING =
        'These values come from Daikin’s published capacity tables at your design ' +
        'condition, not from the selection run in Daikin’s software. The Submittal PDF ' +
        'on this site still shows the STANDARD unit selection — it will not reflect ' +
        'these numbers.';

    // Sensible heat rate for standard air.
    var AIR_CONST = 1.08;

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
        (header.rows || []).forEach(function (row) {
            row.forEach(function (cell) {
                var start = letterToIdx[cell.col];
                if (start === undefined) return;
                for (var k = 0; k < (cell.colspan || 1); k++) {
                    var L = letters[start + k];
                    if (L) leaf[L] = cell.value;
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
        data.__gasPackCols = cols;
        return cols;
    }

    // -----------------------------------------------------------------
    // Design payload
    // -----------------------------------------------------------------
    /** Freeze a Design Search result into the shape the schedule needs. */
    function payloadFor(result) {
        return {
            model: result.model,
            cabinet: result.cabinet,
            tons: result.tons,
            efficiency: result.efficiency,
            voltage: result.voltage,
            motor: result.motor,
            motorLabel: result.motorLabel,
            heatSize: result.heat.size,
            hgrh: result.hgrh,
            cooling: {
                airflow: result.cooling.airflow,
                eatDb: result.cooling.eatDb,
                eatWb: result.cooling.eatWb,
                ambient: result.cooling.ambient,
                total: result.cooling.total,
                sensible: result.cooling.sensible,
                lat: result.cooling.lat
            },
            heat: {
                inputHigh: result.heat.inputHigh,
                outputHigh: result.heat.outputHigh,
                riseHigh: result.heat.riseHigh,
                thermalEff: result.heat.thermalEff
            },
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
     */
    function matchSelection(data, result) {
        var G = HHpro.GasPackCapacity;
        var cols = resolveColumns(data);
        var best = null;
        (data.selections || []).forEach(function (sel) {
            var sd = sel.rows && sel.rows[0] && sel.rows[0].scheduleData;
            if (!sd) return;
            var parts = G.parseModel(sd[cols.model]);
            if (!parts) return;
            if (parts.cabinet !== result.cabinet) return;
            if (parts.voltage !== result.voltage) return;
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
        // The capacity tables publish no leaving wet bulb, and inventing one
        // would be the only fabricated number on the row.
        if (cols.lwb) out[cols.lwb] = '-';

        put('heatInput', payload.heat.inputHigh);
        put('heatOutput', payload.heat.outputHigh);
        if (cols.heatLat) {
            var eat = cols.heatEat ? parseFloat(scheduleData[cols.heatEat]) : NaN;
            if (isFinite(eat) && payload.heat.riseHigh != null) {
                out[cols.heatLat] = round1(eat + payload.heat.riseHigh);
            }
        }

        put('voltage', payload.voltage);
        put('mca', payload.electrical.mca);
        put('mop', payload.electrical.mop);
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

    function setDesign(selectionId, payload) {
        var store = readStore();
        // A freshly selected result starts ON: the engineer just asked for
        // these numbers, so showing the standard ones would be surprising.
        store[selectionId] = { payload: payload, on: true, warned: false };
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
     * Otherwise: { isOn, overrides, toggle, button } - the button flips the
     * row and calls back so the renderer can repaint the affected cells.
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
            function paint() {
                btn.textContent = on ? 'Design values' : 'Standard values';
                btn.classList.toggle('is-on', on);
                btn.title = on
                    ? 'Showing capacity-table values at ' + entry.payload.cooling.eatDb + '/' +
                      entry.payload.cooling.eatWb + ' °F EAT, ' + entry.payload.cooling.ambient +
                      ' °F ambient. Click to show the standard selection. ' + WARNING
                    : 'Showing the standard selection run in Daikin’s software. ' +
                      'Click to show your design-condition values.';
            }
            return btn;
        }

        return {
            payload: entry.payload,
            isOn: function () { return on; },
            overrides: overrides,
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
        matchSelection: matchSelection,
        overridesFor: overridesFor,
        set: setDesign,
        get: getDesign,
        clear: clearDesign,
        clearAll: clearAll,
        anyOn: anyOn,
        buildWarningBanner: buildWarningBanner,

        /**
         * Schedule-cell overrides for an EXPORTED item (Excel / CAD / PDF /
         * engineer templates), so a row switched to design values downloads
         * the numbers that are on screen. Without this the export would
         * quietly emit the standard selection instead - the same mismatch
         * the on-screen banner warns about, but invisible.
         * {} for every other product and for rows toggled back to standard.
         */
        exportOverridesFor: function (item, scheduleData, data) {
            if (!item || item.productKey !== PRODUCT) return {};
            var entry = getDesign(item.selectionId);
            if (!entry || !entry.payload || entry.on === false) return {};
            return overridesFor(entry.payload, scheduleData || {}, data);
        },
        rowController: rowController,
        riseFor: function (outputMbh, cfm) {
            var o = Number(outputMbh), c = Number(cfm);
            if (!isFinite(o) || !isFinite(c) || c <= 0) return null;
            return o * 1000 / (AIR_CONST * c);
        }
    };
})();
