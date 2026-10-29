/* ============================================================
   HHpro - Split system air handler electrical (HHpro.AhuElectrical)
   ------------------------------------------------------------
   "Daikin Unitary & Light Commercial Split Systems" (product key
   multi_position_splits). The SCHEDULE tab has one row per system and
   leaves the air handler's AUX. ELECTRIC HEAT (kW, TEMPERATURE RISE)
   and ELECTRICAL DATA (VOLTAGE / PHASE, MCA, MOP) empty. They come
   from the AHU ELECTRICAL tab, which the converter writes to the JSON
   as `ahuElectrical`:

     { voltages: ['208/1', '230/1', ...],
       models: { 'AMST24BU1300': { '208/1': [{ kitKw, kw, mca, mop }, ...],
                                   '240/1': [...] } } }

   keyed by the air handler model (schedule MODEL under INDOOR AIR
   HANDLING UNIT). kitKw is the heater kit's nominal (model number) kW,
   which identifies the kit; kw is the ADJUSTED KW actually scheduled
   at that voltage.

   Each row gets a VOLTAGE / PHASE dropdown with the voltages the unit
   has. Picking one shows a kW dropdown with that voltage's kits;
   picking a kit fills MCA / MOP and the temperature rise
       rise = kW x 3193 / CFM
   which follows the airflow dropdown (capacity.js) when there is one.
   Changing the voltage clears the kit, so it has to be picked again.
   A unit with one voltage, or one kit at the chosen voltage, has it
   picked automatically and shown as text.

   The choice is saved on the cart / project item as
       ahuElectrical: { voltage: '208/1', kitKw: 5 }
   (kitKw null = not picked yet). Items saved before Oct 2026 point at
   the old per-kW rows: migrateCart moves them onto their system's row
   (data.selectionAliases), opens them at 208/1, 208/3 or 460/3 and
   leaves the kW to be picked again.

   Sky Air (FTA) systems have one submittal per heater kit, named
   "... - 5 kW"; the sheet lists the "... - 0 kW" one and
   selectionForItem / the row controller swap it for the picked kit.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var MPS = 'multi_position_splits';
    var TEMP_RISE_K = 3193;
    // Every pre-Oct-2026 row was rated at one of these. Saved items from
    // then reopen on the first one their air handler has.
    var LEGACY_VOLTAGES = ['208/1', '208/3', '460/3'];
    var ZERO_KW_DOC = / - 0 kW$/i;

    // -----------------------------------------------------------------
    // Table + columns
    // -----------------------------------------------------------------
    function tableOf(data) {
        var t = data && data.ahuElectrical;
        return (t && t.models) ? t : null;
    }

    // Schedule letters, found by header label so column edits don't
    // break them (see HHpro.Capacity.findColumn).
    function colsOf(data) {
        if (data.__ahuElecCols) return data.__ahuElecCols;
        var find = function (leaf, group) {
            return HHpro.Capacity.findColumn(data, leaf, group);
        };
        data.__ahuElecCols = {
            model:   find('MODEL', 'INDOOR AIR HANDLING UNIT'),
            airflow: find('AIRFLOW (CFM)', 'INDOOR AIR HANDLING UNIT'),
            kw:      find('kW', 'AUX. ELECTRIC HEAT'),
            rise:    find('TEMPERATURE RISE (DB)', 'AUX. ELECTRIC HEAT'),
            voltage: find('VOLTAGE / PHASE', 'INDOOR AIR HANDLING UNIT'),
            mca:     find('MCA', 'INDOOR AIR HANDLING UNIT'),
            mop:     find('MOP', 'INDOOR AIR HANDLING UNIT')
        };
        return data.__ahuElecCols;
    }

    // The unit's { voltage: [kits] } entry, or null when the product has
    // no AHU ELECTRICAL data or the model isn't on it.
    function entryFor(data, scheduleData) {
        var t = tableOf(data);
        if (!t || !scheduleData) return null;
        var c = colsOf(data);
        var model = c.model ? scheduleData[c.model] : null;
        if (model == null || model === '') return null;
        return t.models[String(model).trim()] || null;
    }

    function voltagesFor(data, entry) {
        return (tableOf(data).voltages || []).filter(function (v) {
            return entry[v] && entry[v].length;
        });
    }

    function kitsFor(entry, voltage) {
        return (voltage && entry[voltage]) || [];
    }

    function kitOf(entry, st) {
        var kits = kitsFor(entry, st && st.voltage);
        for (var i = 0; i < kits.length; i++) {
            if (st.kitKw != null && Number(kits[i].kitKw) === Number(st.kitKw)) return kits[i];
        }
        return null;
    }

    // Snap a saved / requested state onto what the unit offers, picking
    // the only voltage or the only kit when there is just one.
    function normalize(data, entry, st) {
        var volts = voltagesFor(data, entry);
        var v = (st && volts.indexOf(st.voltage) >= 0) ? st.voltage : null;
        if (v == null && volts.length === 1) v = volts[0];
        var out = { voltage: v, kitKw: null };
        if (v == null) return out;
        var kits = kitsFor(entry, v);
        if (st && st.kitKw != null && st.voltage === v && kitOf(entry, { voltage: v, kitKw: st.kitKw })) {
            out.kitKw = Number(st.kitKw);
        } else if (kits.length === 1) {
            out.kitKw = Number(kits[0].kitKw);
        }
        return out;
    }

    function legacyState(data, entry) {
        var volts = voltagesFor(data, entry);
        for (var i = 0; i < LEGACY_VOLTAGES.length; i++) {
            if (volts.indexOf(LEGACY_VOLTAGES[i]) >= 0) {
                return { voltage: LEGACY_VOLTAGES[i], kitKw: null };
            }
        }
        return { voltage: volts[0] || null, kitKw: null };
    }

    function stateForItem(data, entry, item) {
        var saved = item && item.ahuElectrical;
        return normalize(data, entry, saved || legacyState(data, entry));
    }

    // -----------------------------------------------------------------
    // Values
    // -----------------------------------------------------------------
    // Adjusted kW to at most 2 decimals (4.416 -> 4.42, 3.6 stays 3.6).
    function kwText(kw) {
        return String(Number(Number(kw).toFixed(2)));
    }

    function riseOf(kw, cfm) {
        var k = Number(kw);
        var c = parseFloat(cfm);
        if (!isFinite(k) || !isFinite(c) || c <= 0) return null;
        return k * TEMP_RISE_K / c;
    }

    // Cell values for a state. Blank until a kit is picked; a 0 kW kit
    // shows "0" with "-" for the rise.
    function valuesOf(entry, st, cfm) {
        var kit = kitOf(entry, st);
        var out = { voltage: st.voltage || '', kw: '', rise: '', mca: '', mop: '' };
        if (!kit) return out;
        out.kw = Number(kwText(kit.kw));
        var rise = Number(kit.kw) > 0 ? riseOf(kit.kw, cfm) : null;
        out.rise = (rise == null) ? '-' : rise;
        out.mca = kit.mca;
        out.mop = kit.mop;
        return out;
    }

    function riseText(v) {
        return (typeof v === 'number') ? String(Number(v.toFixed(2))) : String(v);
    }

    // The selection with its "... - 0 kW" documents pointed at the
    // picked kit's file (Sky Air FTA submittals). Unchanged otherwise.
    function docSelection(sel, entry, st) {
        var kit = entry ? kitOf(entry, st) : null;
        if (!sel || !kit || !Number(kit.kitKw)) return sel;
        var changed = false;
        var rows = (sel.rows || []).map(function (row) {
            var dd = row && row.documentationData;
            if (!dd) return row;
            var next = null;
            Object.keys(dd).forEach(function (k) {
                var v = dd[k];
                if (typeof v !== 'string' || !ZERO_KW_DOC.test(v)) return;
                next = next || copy(dd);
                next[k] = v.replace(ZERO_KW_DOC, ' - ' + kit.kitKw + ' kW');
            });
            if (!next) return row;
            changed = true;
            var r = copy(row);
            r.documentationData = next;
            return r;
        });
        if (!changed) return sel;
        var out = copy(sel);
        out.rows = rows;
        return out;
    }

    function copy(obj) {
        var out = {};
        Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
        return out;
    }

    // -----------------------------------------------------------------
    // Dropdowns
    // -----------------------------------------------------------------
    function el(tag, cls) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        return e;
    }

    // A placeholder-first <select> in the shared kW-dropdown styling.
    // options: [{ value, label }]; onPick gets the chosen value ('' for
    // the placeholder).
    function buildSelect(ariaLabel, options, current, onPick) {
        var wrap = el('span', 'kw-variant-control ahu-elec-control');
        var sel = el('select', 'kw-variant-select');
        sel.setAttribute('aria-label', ariaLabel);
        var blank = el('option');
        blank.value = '';
        blank.textContent = 'Select';
        sel.appendChild(blank);
        options.forEach(function (o) {
            var opt = el('option');
            opt.value = String(o.value);
            opt.textContent = o.label;
            if (current != null && String(o.value) === String(current)) opt.selected = true;
            sel.appendChild(opt);
        });
        if (current == null) blank.selected = true;
        sel.addEventListener('change', function () { onPick(sel.value); });
        var chev = el('span', 'kw-variant-chevron');
        chev.setAttribute('aria-hidden', 'true');
        chev.textContent = '▾';
        wrap.appendChild(sel);
        wrap.appendChild(chev);
        return wrap;
    }

    function voltageControl(data, entry, st, onPick) {
        var volts = voltagesFor(data, entry);
        if (volts.length <= 1) return document.createTextNode(st.voltage || '');
        return buildSelect('Air handler voltage / phase',
            volts.map(function (v) { return { value: v, label: v }; }),
            st.voltage, function (v) { onPick(v || null); });
    }

    // Empty until a voltage is picked.
    function kwControl(entry, st, onPick) {
        var kits = kitsFor(entry, st.voltage);
        if (!st.voltage || !kits.length) return document.createTextNode('');
        if (kits.length === 1) return document.createTextNode(kwText(kits[0].kw));
        return buildSelect('Aux. electric heat (kW)',
            kits.map(function (k) { return { value: k.kitKw, label: kwText(k.kw) }; }),
            st.kitKw, function (v) { onPick(v === '' ? null : Number(v)); });
    }

    // -----------------------------------------------------------------
    // Per-row controller (browse schedule, Design Search results and the
    // project schedule)
    // -----------------------------------------------------------------
    function createController(data, entry, scheduleData, initial, onChange) {
        var c = colsOf(data);
        var st = normalize(data, entry, initial || null);
        var cfm = c.airflow ? scheduleData[c.airflow] : null;
        var cells = {};          // letter -> td
        var listeners = [];

        var owned = {};
        ['voltage', 'kw', 'rise', 'mca', 'mop'].forEach(function (f) {
            if (c[f]) owned[c[f]] = f;
        });

        function paint(td, ctl, pending) {
            td.textContent = '';
            td.appendChild(ctl);
            // Dropdown styling only when it is one (a single choice is text).
            td.classList.toggle('kw-variant-cell', ctl.nodeType === 1);
            td.classList.toggle('ahu-elec-pending', pending);
        }

        function paintVoltage() {
            var td = cells[c.voltage];
            if (td) paint(td, voltageControl(data, entry, st, setVoltage), !st.voltage);
        }

        function paintKw() {
            var td = cells[c.kw];
            if (td) paint(td, kwControl(entry, st, setKit), !!st.voltage && st.kitKw == null);
        }

        function paintOutputs() {
            var v = valuesOf(entry, st, cfm);
            [['rise', riseText(v.rise)], ['mca', v.mca], ['mop', v.mop]].forEach(function (p) {
                var td = cells[c[p[0]]];
                if (td) td.textContent = String(p[1]);
            });
        }

        function changed() {
            var s = getState();
            if (typeof onChange === 'function') onChange(s);
            listeners.forEach(function (fn) { fn(s); });
        }

        function setVoltage(v) {
            // A new voltage always clears the kit (unless it has only one).
            st = normalize(data, entry, { voltage: v, kitKw: null });
            paintVoltage();
            paintKw();
            paintOutputs();
            changed();
        }

        function setKit(k) {
            st = normalize(data, entry, { voltage: st.voltage, kitKw: k });
            paintKw();
            paintOutputs();
            changed();
        }

        function getState() {
            return { voltage: st.voltage, kitKw: st.kitKw };
        }

        return {
            handles: function (letter) { return owned[letter] !== undefined; },
            fillCell: function (td, letter) {
                td.classList.add('ahu-elec-cell');
                cells[letter] = td;
                var f = owned[letter];
                if (f === 'voltage') paintVoltage();
                else if (f === 'kw') paintKw();
            },
            finalize: paintOutputs,
            // The capacity controller's airflow (its dropdown, a single
            // rated airflow, or a Design Search seed).
            setAirflow: function (a) {
                if (a == null || a === '') return;
                cfm = a;
                paintOutputs();
            },
            getState: getState,
            isComplete: function () { return st.voltage != null && st.kitKw != null; },
            onChange: function (fn) { listeners.push(fn); },
            docSelection: function (sel) { return docSelection(sel, entry, st); }
        };
    }

    // Template-cell control (engineer layouts): one dropdown for `field`
    // ('voltage' or 'kw'). onChange gets the full new state.
    function fieldControl(opts) {
        if (!opts || !tableOf(opts.data)) return null;
        var entry = entryFor(opts.data, opts.scheduleData || {});
        if (!entry) return null;
        var st = stateForItem(opts.data, entry, opts.item);
        function emit(next) {
            if (typeof opts.onChange === 'function') opts.onChange(normalize(opts.data, entry, next));
        }
        if (opts.field === 'voltage') {
            if (voltagesFor(opts.data, entry).length <= 1) return null;
            return voltageControl(opts.data, entry, st, function (v) {
                emit({ voltage: v, kitKw: null });
            });
        }
        if (opts.field === 'kw') {
            if (!st.voltage || kitsFor(entry, st.voltage).length <= 1) return null;
            return kwControl(entry, st, function (k) {
                emit({ voltage: st.voltage, kitKw: k });
            });
        }
        return null;
    }

    // -----------------------------------------------------------------
    // Items: exports, docs, migration, unfinished warning
    // -----------------------------------------------------------------
    function findSelection(data, id) {
        var sels = (data && data.selections) || [];
        for (var i = 0; i < sels.length; i++) {
            if (sels[i].id === id) return sels[i];
        }
        return null;
    }

    function rowData(sel) {
        return (sel && sel.rows && sel.rows[0] && sel.rows[0].scheduleData) || {};
    }

    // Schedule-cell overrides (letter -> value) for an item, so the
    // Excel / CAD / PDF exports and engineer templates show the picked
    // voltage, kW, rise and MCA / MOP. {} when not applicable.
    function overridesFor(item, scheduleData, data) {
        var entry = entryFor(data, scheduleData);
        if (!entry) return {};
        var c = colsOf(data);
        var st = stateForItem(data, entry, item);
        var cfm = c.airflow ? scheduleData[c.airflow] : null;
        if (HHpro.Capacity && HHpro.Capacity.overridesFor && c.airflow) {
            var capOv = HHpro.Capacity.overridesFor(item, scheduleData, data);
            if (capOv[c.airflow] != null) cfm = capOv[c.airflow];
        }
        var v = valuesOf(entry, st, cfm);
        var out = {};
        ['voltage', 'kw', 'rise', 'mca', 'mop'].forEach(function (f) {
            if (c[f]) out[c[f]] = v[f];
        });
        return out;
    }

    // Move pre-Oct-2026 items (no ahuElectrical yet) onto their system's
    // row and the legacy voltage, kW left to pick. Runs every time the
    // product JSON is handed out (multi_position_splits.js afterLoad),
    // so whichever project is open is fixed before anything reads it.
    function migrateCart(data) {
        if (!tableOf(data) || !HHpro.Cart || !HHpro.Cart.migrateItems) return;
        var aliases = data.selectionAliases || {};
        HHpro.Cart.migrateItems(function (it) {
            if (it.productKey !== MPS || it.ahuElectrical) return false;
            if (aliases[it.selectionId]) it.selectionId = aliases[it.selectionId];
            var entry = entryFor(data, rowData(findSelection(data, it.selectionId)));
            it.ahuElectrical = entry ? legacyState(data, entry) : { voltage: null, kitKw: null };
            return true;
        });
    }

    // Items whose voltage or kW still needs picking (units with no AHU
    // ELECTRICAL data never count).
    function unfinishedItems(items, data) {
        if (!tableOf(data)) return [];
        return (items || []).filter(function (it) {
            if (!it || it.productKey !== MPS) return false;
            var entry = entryFor(data, rowData(findSelection(data, it.selectionId)));
            if (!entry) return false;
            var st = stateForItem(data, entry, it);
            return st.voltage == null || st.kitKw == null;
        });
    }

    // Before an export: if any split system still needs its air handler
    // voltage / kW picked, say which and let them export anyway or go
    // back. proceed() runs straight away when nothing is missing.
    function confirmExport(items, data, proceed) {
        var missing = unfinishedItems(items, data);
        if (!missing.length) { proceed(); return; }

        var backdrop = el('div', 'modal-backdrop');
        var modal = el('div', 'modal');
        var title = el('h2', 'modal-title');
        title.textContent = 'Selections not finished';
        var desc = el('p', 'modal-desc');
        var one = missing.length === 1;
        desc.textContent = missing.length + (one ? ' split system still needs' : ' split systems still need') +
            ' the air handler VOLTAGE / PHASE or electric heat kW picked. ' +
            (one ? 'Its' : 'Their') + ' kW, temperature rise, MCA and MOP will export blank.';
        var list = el('ul', 'modal-desc ahu-elec-missing');
        missing.slice(0, 12).forEach(function (it) {
            var li = el('li');
            var tag = it.tag ? it.tag + ' - ' : '';
            li.textContent = tag + (it.label || it.selectionId);
            list.appendChild(li);
        });
        if (missing.length > 12) {
            var more = el('li');
            more.textContent = '...and ' + (missing.length - 12) + ' more';
            list.appendChild(more);
        }
        var actions = el('div', 'modal-actions');
        var back = el('button', 'modal-btn modal-btn-secondary');
        back.type = 'button';
        back.textContent = 'Go back';
        var go = el('button', 'modal-btn modal-btn-primary');
        go.type = 'button';
        go.textContent = 'Export anyway';

        function close() {
            document.removeEventListener('keydown', onKey);
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
        function onKey(e) { if (e.key === 'Escape') close(); }
        back.addEventListener('click', close);
        go.addEventListener('click', function () { close(); proceed(); });
        backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', onKey);

        actions.appendChild(back);
        actions.appendChild(go);
        modal.appendChild(title);
        modal.appendChild(desc);
        modal.appendChild(list);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        go.focus();
    }

    // -----------------------------------------------------------------
    // Design Search: the "Aux. Electric Heat" (kW) target
    // -----------------------------------------------------------------
    // Best kit for a kW target across every voltage the unit has:
    // { dev (%), voltage, kitKw } or null when none is within tolerance.
    // Ties go to the earlier voltage (208/1 first).
    function bestKwMatch(sel, data, target, tolerance) {
        var entry = entryFor(data, rowData(sel));
        if (!entry) return null;
        var best = null;
        voltagesFor(data, entry).forEach(function (v) {
            kitsFor(entry, v).forEach(function (k) {
                var kw = Number(k.kw);
                var dev = (target === 0) ? (kw === 0 ? 0 : 100)
                    : Math.abs(kw - target) / Math.abs(target) * 100;
                if (dev > tolerance) return;
                if (!best || dev < best.dev) best = { dev: dev, voltage: v, kitKw: Number(k.kitKw) };
            });
        });
        return best;
    }

    HHpro.AhuElectrical = {
        PRODUCT: MPS,
        /** True when the product JSON carries AHU ELECTRICAL data. */
        appliesTo: function (data) { return !!tableOf(data); },
        /** The kW column a Design Search target searches by kit instead. */
        kwColumn: function (data) { return tableOf(data) ? colsOf(data).kw : null; },
        /**
         * Per-row controller, or null when it doesn't apply. opts:
         * { productKey, data, scheduleData, initial, onChange }
         */
        rowController: function (opts) {
            if (!opts || opts.productKey !== MPS || !tableOf(opts.data)) return null;
            var entry = entryFor(opts.data, opts.scheduleData || {});
            if (!entry) return null;
            return createController(opts.data, entry, opts.scheduleData || {},
                opts.initial || null, opts.onChange || null);
        },
        fieldControl: fieldControl,
        overridesFor: overridesFor,
        /** The item's selection with its documents swapped for the kit. */
        selectionForItem: function (sel, item, data) {
            var entry = entryFor(data, rowData(sel));
            return entry ? docSelection(sel, entry, stateForItem(data, entry, item)) : sel;
        },
        migrateCart: migrateCart,
        unfinishedItems: unfinishedItems,
        confirmExport: confirmExport,
        bestKwMatch: bestKwMatch
    };
})();
