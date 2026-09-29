/* ============================================================
   HHpro - GAS SPLITS product extension
   ------------------------------------------------------------
   Three-component split system: outdoor condensing unit + indoor
   coil + gas furnace. Uses the default single-row schedule
   rendering from base.js.

   The GAS HEATING -> TEMP RISE column is left blank in GAS SPLIT
   DATA and calculated here when the JSON loads (HHpro.Data
   postProcess): gas output / (1.08 x CFM), one decimal - the same
   sensible heat formula as the heat pump rises (HHpro.Capacity.heatRise).
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};
    HHpro.ProductExtensions.gas_splits = {
        prepareData: function (data) { fillTempRise(data); }
    };

    // Column letters by header label (leaf, plus a group it sits under),
    // so the fill survives column edits.
    function resolveColumns(data) {
        var header = (data && data.scheduleHeader) || {};
        var letters = header.columnLetters || [];
        var letterToIdx = {};
        letters.forEach(function (l, i) { letterToIdx[l] = i; });
        var trail = {};
        (header.rows || []).forEach(function (row) {
            row.forEach(function (cell) {
                var start = letterToIdx[cell.col];
                if (start === undefined) return;
                var val = String(cell.value == null ? '' : cell.value).trim().toUpperCase();
                for (var k = 0; k < (cell.colspan || 1); k++) {
                    var L = letters[start + k];
                    if (L) (trail[L] = trail[L] || []).push(val);
                }
            });
        });
        function find(leaf, group) {
            for (var i = 0; i < letters.length; i++) {
                var t = trail[letters[i]] || [];
                if (t[t.length - 1] === leaf && (!group || t.indexOf(group) >= 0)) return letters[i];
            }
            return null;
        }
        return {
            cfm: find('AIRFLOW (CFM)'),
            output: find('GAS OUTPUT', 'GAS HEATING'),
            rise: find('TEMP RISE', 'GAS HEATING')
        };
    }

    function fillTempRise(data) {
        var heatRise = HHpro.Capacity && HHpro.Capacity.heatRise;
        var cols = resolveColumns(data);
        if (!heatRise || !cols.cfm || !cols.output || !cols.rise) return;
        (data.selections || []).forEach(function (sel) {
            (sel.rows || []).forEach(function (row) {
                var sd = row.scheduleData;
                if (!sd) return;
                var rise = heatRise(sd[cols.output], sd[cols.cfm]);
                if (typeof rise === 'number') sd[cols.rise] = rise;
            });
        });
    }
})();
