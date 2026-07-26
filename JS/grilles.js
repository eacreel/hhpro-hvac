/* ============================================================
   HHpro - Grilles product extension
   ------------------------------------------------------------
   Price supply / return / transfer grilles (13 catalogs, 32
   model groups). The model-mapped SCHEDULE NOTES behavior is
   generic (HHpro.ModelNotes keys off scheduleNotes.format ===
   'modelmap', see JS/diffusers.js), so the only product-specific
   behavior here is the family picker gallery.

   Same mechanics as the diffusers gallery, with one addition:
   cards carry a `label` (family caption) separate from `model`,
   because grille MODEL values are long grouped strings like
   "510/520/610/620/710/720". Clicking a card filters the
   schedule via the DESCRIPTION resolved from that model, so one
   representative model per family covers the whole family.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};

    HHpro.ProductExtensions.grilles = {
        buildIntroSection: function (product, data, api) {
            var cards = (product && product.modelGallery) || [];
            if (!cards.length) return null;

            var wrap = document.createElement('div');
            wrap.className = 'model-gallery';

            cards.forEach(function (cardDef) {
                var descr = descriptionForModel(data, cardDef.model);

                var card = document.createElement('button');
                card.type = 'button';
                card.className = 'model-card';
                card.title = descr
                    ? 'Show only ' + descr + ' selections'
                    : (cardDef.label || cardDef.model);

                var imgBox = document.createElement('div');
                imgBox.className = 'model-card-image';
                var img = new Image();
                img.alt = cardDef.label || cardDef.model;
                img.src = cardDef.picture;
                imgBox.appendChild(img);
                card.appendChild(imgBox);

                var label = document.createElement('div');
                label.className = 'model-card-label';
                label.textContent = cardDef.label || cardDef.model;
                card.appendChild(label);

                if (descr) {
                    var sub = document.createElement('div');
                    sub.className = 'model-card-desc';
                    sub.textContent = descr;
                    card.appendChild(sub);
                }

                function syncActive() {
                    var active = descr &&
                        String(api.getFilterValue('DESCRIPTION') || '') === descr;
                    card.classList.toggle('is-active', !!active);
                }
                syncActive();
                api.onFilterChange(syncActive);

                card.addEventListener('click', function () {
                    if (!descr) return;
                    var current = String(api.getFilterValue('DESCRIPTION') || '');
                    api.setFilter('DESCRIPTION', current === descr ? null : descr);
                });

                wrap.appendChild(card);
            });

            return wrap;
        }
    };

    /**
     * Resolve the DESCRIPTION filter value for a MODEL column value by
     * scanning the data (so gallery cards never go stale if the Excel
     * descriptions change).
     */
    function descriptionForModel(data, model) {
        var modelCol = null;
        if (HHpro.Schedule && HHpro.Schedule.findModelColumns) {
            var cols = HHpro.Schedule.findModelColumns(data);
            if (cols.length) modelCol = cols[0].col;
        }
        if (!modelCol) return null;
        var sels = (data && data.selections) || [];
        for (var i = 0; i < sels.length; i++) {
            var row = sels[i].rows && sels[i].rows[0];
            if (!row || !row.scheduleData) continue;
            if (String(row.scheduleData[modelCol]) === String(model)) {
                var d = row.filterData && row.filterData['DESCRIPTION'];
                return (d === undefined || d === null) ? null : String(d);
            }
        }
        return null;
    }
})();
