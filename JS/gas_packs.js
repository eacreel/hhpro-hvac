/* ============================================================
   HHpro - GAS PACK RTUS product extension
   ------------------------------------------------------------
   GAS PACK RTUS uses the default single-row schedule rendering
   from JS/products/_base.js, with no product-specific overrides.

   This file exists as a reserved slot for future customization.
   If behavior needs to change only for gas packs (e.g. a custom
   "View Submittal" path, an extra filter, a different row label),
   add handlers to HHpro.ProductExtensions.gas_packs and they will
   be picked up by the base renderer in later steps.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};
    HHpro.ProductExtensions.gas_packs = {};
})();