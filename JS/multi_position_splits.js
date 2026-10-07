/* ============================================================
   HHpro - MULTI POSITION SPLITS product extension
   ("Daikin Unitary & Light Commercial Split Systems" on screen)
   ------------------------------------------------------------
   Uses default single-row schedule rendering from base.js.
   Adds the air handler style picture gallery above the filters.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};

    var STYLE_FILTER = 'PHOTO FILTER';

    HHpro.ProductExtensions.multi_position_splits = {
        /**
         * Air handler style picker gallery above the filter bar (same
         * look and mechanics as the mini-split type gallery). Clicking a
         * card sets PHOTO FILTER to that style; clicking the active card
         * clears it. PHOTO FILTER has no dropdown (galleryOnlyFilters in
         * data.js), so these cards are its only control.
         */
        buildIntroSection: function (product, data, api) {
            var cards = (product && product.styleGallery) || [];
            if (!cards.length) return null;

            var wrap = document.createElement('div');
            wrap.className = 'model-gallery model-gallery-wide';

            cards.forEach(function (cardDef) {
                var style = String(cardDef.style);

                var card = document.createElement('button');
                card.type = 'button';
                card.className = 'model-card';
                card.title = 'Show only ' + style + ' air handlers';

                var imgBox = document.createElement('div');
                imgBox.className = 'model-card-image';
                var img = new Image();
                img.alt = style;
                img.src = cardDef.picture;
                imgBox.appendChild(img);
                card.appendChild(imgBox);

                // "Multi Position (1.5 to 10.0 Tons)": name on the first
                // line, the tonnage range under it.
                var paren = style.indexOf(' (');
                var label = document.createElement('div');
                label.className = 'model-card-label';
                label.textContent = paren > 0 ? style.slice(0, paren) : style;
                card.appendChild(label);
                if (paren > 0) {
                    var desc = document.createElement('div');
                    desc.className = 'model-card-desc';
                    desc.textContent = style.slice(paren + 1);
                    card.appendChild(desc);
                }

                function syncActive() {
                    var active =
                        String(api.getFilterValue(STYLE_FILTER) || '') === style;
                    card.classList.toggle('is-active', active);
                }
                syncActive();
                api.onFilterChange(syncActive);

                card.addEventListener('click', function () {
                    var current = String(api.getFilterValue(STYLE_FILTER) || '');
                    api.setFilter(STYLE_FILTER, current === style ? null : style);
                });

                wrap.appendChild(card);
            });

            return wrap;
        },

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
