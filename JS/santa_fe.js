/* ============================================================
   HHpro - SANTA-FE DEHUMIDIFIERS product extension
   ------------------------------------------------------------
   Uses default single-row schedule rendering from base.js.
   Adds the unit photo cards above the filters. The MODEL filter
   (workbook column W) holds each unit's photo name, e.g.
   "Santa Fe Compact70"; it has no dropdown (galleryOnlyFilters in
   data.js), so these cards are its only control.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};

    var MODEL_FILTER = 'MODEL';

    HHpro.ProductExtensions.santa_fe = {
        /**
         * One card per unit (data.js modelGallery). Clicking a card sets
         * MODEL to its value; clicking the active card clears it.
         */
        buildIntroSection: function (product, data, api) {
            var cards = (product && product.modelGallery) || [];
            if (!cards.length) return null;

            var wrap = document.createElement('div');
            wrap.className = 'model-gallery';

            cards.forEach(function (cardDef) {
                var value = String(cardDef.value);

                var card = document.createElement('button');
                card.type = 'button';
                card.className = 'model-card';
                card.title = 'Show only the ' + cardDef.label;

                var imgBox = document.createElement('div');
                imgBox.className = 'model-card-image';
                var img = new Image();
                img.alt = cardDef.label;
                img.src = cardDef.picture;
                imgBox.appendChild(img);
                card.appendChild(imgBox);

                var label = document.createElement('div');
                label.className = 'model-card-label';
                label.textContent = cardDef.label;
                card.appendChild(label);
                if (cardDef.desc) {
                    var desc = document.createElement('div');
                    desc.className = 'model-card-desc';
                    desc.textContent = cardDef.desc;
                    card.appendChild(desc);
                }

                function syncActive() {
                    var active =
                        String(api.getFilterValue(MODEL_FILTER) || '') === value;
                    card.classList.toggle('is-active', active);
                }
                syncActive();
                api.onFilterChange(syncActive);

                card.addEventListener('click', function () {
                    var current = String(api.getFilterValue(MODEL_FILTER) || '');
                    api.setFilter(MODEL_FILTER, current === value ? null : value);
                });

                wrap.appendChild(card);
            });

            return wrap;
        }
    };
})();
