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

    var TYPE_1_FILTER = 'TYPE (INDOOR UNIT #1)';

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

            // Step 3: any per-unit filter that already HOLDS a value stays
            // visible even when NUMBER OF INDOOR UNITS is "All" - the type
            // gallery sets TYPE (INDOOR UNIT #1) directly, and hiding a
            // filter would clear its value (base.js prunes hidden filters).
            allFilters.forEach(function (fc) {
                if (!PER_UNIT_FILTER_RE.test(fc.name)) return;
                if (base.indexOf(fc) !== -1) return;
                var v = currentFilters[fc.name];
                if (v !== null && v !== undefined) base.push(fc);
            });

            return base;
        },

        /**
         * Indoor-unit-type picker gallery above the filter bar (same look
         * and mechanics as the diffuser model gallery). Clicking a card
         * sets TYPE (INDOOR UNIT #1) to that type; clicking the active
         * card clears it. Cards use the light image well - the submittal
         * photos are on white, unlike the black-background Price renders.
         */
        buildIntroSection: function (product, data, api) {
            var cards = (product && product.typeGallery) || [];
            if (!cards.length) return null;

            var wrap = document.createElement('div');
            wrap.className = 'model-gallery';

            cards.forEach(function (cardDef) {
                var type = String(cardDef.type);

                var card = document.createElement('button');
                card.type = 'button';
                card.className = 'model-card';
                card.title = 'Show only systems with a ' + type +
                             ' first indoor unit';

                var imgBox = document.createElement('div');
                imgBox.className = 'model-card-image model-card-image-light';
                var img = new Image();
                img.alt = type;
                img.src = cardDef.picture;
                imgBox.appendChild(img);
                card.appendChild(imgBox);

                var label = document.createElement('div');
                label.className = 'model-card-label';
                label.textContent = type;
                card.appendChild(label);

                function syncActive() {
                    var active =
                        String(api.getFilterValue(TYPE_1_FILTER) || '') === type;
                    card.classList.toggle('is-active', active);
                }
                syncActive();
                api.onFilterChange(syncActive);

                card.addEventListener('click', function () {
                    var current = String(api.getFilterValue(TYPE_1_FILTER) || '');
                    api.setFilter(TYPE_1_FILTER, current === type ? null : type);
                });

                wrap.appendChild(card);
            });

            return wrap;
        }
    };

    function findFilter(filters, name) {
        for (var i = 0; i < filters.length; i++) {
            if (filters[i].name === name) return filters[i];
        }
        return null;
    }
})();