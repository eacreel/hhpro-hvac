/* ============================================================
   HHpro - MULTI POSITION SPLITS product extension
   ------------------------------------------------------------
   Uses default single-row schedule rendering from base.js.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};

    HHpro.ProductExtensions.multi_position_splits = {
        // Column O (aux heat "TEMPERATURE RISE (DB)") values come out of
        // the converter with up to 6 decimals of float precision -- show
        // them rounded to 2 decimals for readability. (Was column M
        // before LAT (WB) was inserted at column I, then N before the
        // heat pump TEMP RISE went in at M, both Sept 2026.)
        formatScheduleCellValue: function (colLetter, value) {
            if (colLetter === 'O' && typeof value === 'number') {
                return Number(value.toFixed(2)).toString();
            }
            return undefined;
        }
    };
})();
