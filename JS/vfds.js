/* ============================================================
   HHpro - VFDs product extension
   ------------------------------------------------------------
   VFDs use the default single-row schedule rendering from
   JS/base.js, with no product-specific overrides.

   This file exists as a reserved slot for future customization.
   If behavior needs to change only for VFDs (e.g. a custom
   filter, a different row label), add handlers to
   HHpro.ProductExtensions.vfds and they will be picked up by
   the base renderer.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};
    HHpro.ProductExtensions.vfds = {};
})();
