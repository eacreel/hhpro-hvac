/* ============================================================
   HHpro - MINI SPLITS product extension
   ------------------------------------------------------------
   Multi-row (multi-indoor-unit) rendering is handled generically
   by base.js via computeCellLayout.

   Mini splits DO customize which filters are visible:
   - By default, all "(INDOOR UNIT #n)" filters are hidden.
   - Once the user picks a value for NUMBER OF INDOOR UNITS,
     the SIZE and TYPE filters for indoor units 1..N are added
     back to the filter bar automatically.
   - Changing the value of NUMBER OF INDOOR UNITS (or clearing it
     to "All") updates the visible filters again - any extra
     filter values the user had set that no longer apply get
     cleared automatically by base.js.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};

    // Detects filter names like "SIZE (INDOOR UNIT #1)" or "TYPE (INDOOR UNIT #3)"
    var PER_UNIT_FILTER_RE = /INDOOR UNIT #\d/;

    HHpro.ProductExtensions.mini_splits = {
        /**
         * Return the subset of filter columns that should be shown right now
         * based on the current filter values.
         *
         * @param {Array} allFilters     - every filter column defined in the JSON
         * @param {Object} currentFilters - { filterName: value or null } of
         *                                  the filters that already have values
         * @returns {Array} ordered list of filter columns to render
         */
        getVisibleFilters: function (allFilters, currentFilters) {
            // Step 1: always show the filters that aren't per-indoor-unit
            var base = allFilters.filter(function (fc) {
                return !PER_UNIT_FILTER_RE.test(fc.name);
            });

            // Step 2: if NUMBER OF INDOOR UNITS has a value, reveal the
            // matching indoor-unit filters (sizes first, then types)
            var n = currentFilters['NUMBER OF INDOOR UNITS'];
            var count = parseInt(n, 10);
            if (!isNaN(count) && count > 0) {
                for (var i = 1; i <= count; i++) {
                    var size = findFilter(allFilters, 'SIZE (INDOOR UNIT #' + i + ')');
                    if (size) base.push(size);
                }
                for (var j = 1; j <= count; j++) {
                    var type = findFilter(allFilters, 'TYPE (INDOOR UNIT #' + j + ')');
                    if (type) base.push(type);
                }
            }
            return base;
        }
    };

    function findFilter(filters, name) {
        for (var i = 0; i < filters.length; i++) {
            if (filters[i].name === name) return filters[i];
        }
        return null;
    }
})();