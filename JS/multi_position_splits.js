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
        // Column N ("TEMPERATURE RISE (DB)") values come out of the
        // converter with up to 6 decimals of float precision -- show
        // them rounded to 2 decimals for readability. (Was column M
        // before LAT (WB) was inserted at column I in Sept 2026.)
        formatScheduleCellValue: function (colLetter, value) {
            if (colLetter === 'N' && typeof value === 'number') {
                return Number(value.toFixed(2)).toString();
            }
            return undefined;
        }
    };
})();
