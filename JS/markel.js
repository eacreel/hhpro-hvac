/* ============================================================
   HHpro - Markel Electric Heaters product extension
   ------------------------------------------------------------
   markel.json is built from two workbooks with different columns
   (3320 wall heaters, 5100 suspended unit heaters) into two
   sub-schedules, the same shape as the GPS payload, so the GPS
   helpers (HHpro.GPS) drive the project view and the exports.

   This module only adds the page the product opens on: one photo
   card per heater type (data.js typePicker). Clicking a card opens
   the standard schedule page (base.js renderStandardPage) with the
   Type filter preset to that heater. There the filter bar works as
   usual: clearing Type stacks both schedules, picking the other
   Type switches to it, and the back button returns to the photos.
   Arrivals that target rows (quick lookup's model search) skip the
   photos and open the schedule directly.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};

    HHpro.ProductExtensions.markel = {
        renderProductPage: function (root, product, data, params) {
            params = params || {};
            var picker = product.typePicker;
            var toSchedule = !picker || params.initialFilters ||
                (typeof params.modelQuery === 'string' && params.modelQuery.trim()) ||
                params.focusSelectionId;
            if (toSchedule) {
                HHpro.Views.product.renderStandardPage(root, product, data, params);
                return;
            }
            renderPicker(root, product, picker);
        }
    };

    function renderPicker(root, product, picker) {
        root.innerHTML = '';
        root.appendChild(HHpro.UI.buildHeader(product.displayName));
        if (HHpro.Cart && typeof HHpro.Cart.init === 'function') {
            HHpro.Cart.init();
        }

        var main = document.createElement('main');
        main.className = 'product-view';
        var inner = document.createElement('div');
        // Full page width so the card grid can center (see gps.js).
        inner.className = 'product-view-inner gps-inner-gallery';
        main.appendChild(inner);

        var header = document.createElement('div');
        header.className = 'product-header';
        var titleArea = document.createElement('div');
        var title = document.createElement('h1');
        title.className = 'product-title';
        title.textContent = product.displayName;
        titleArea.appendChild(title);
        if (picker.prompt) {
            var meta = document.createElement('p');
            meta.className = 'product-meta';
            meta.textContent = picker.prompt;
            titleArea.appendChild(meta);
        }
        header.appendChild(titleArea);

        var backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'product-back-btn';
        backBtn.appendChild(HHpro.UI.icon('arrow-left'));
        var backText = document.createElement('span');
        backText.textContent = 'Back to Products';
        backBtn.appendChild(backText);
        backBtn.addEventListener('click', function () { HHpro.App.showView('main'); });
        header.appendChild(backBtn);
        inner.appendChild(header);

        var gallery = document.createElement('div');
        gallery.className = 'gps-gallery type-picker-gallery';
        (picker.cards || []).forEach(function (cardDef) {
            gallery.appendChild(buildCard(product, picker, cardDef));
        });
        inner.appendChild(gallery);

        root.appendChild(main);
    }

    function buildCard(product, picker, cardDef) {
        var caption = cardDef.label || String(cardDef.value);

        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'gps-type-card';
        card.title = 'Open the ' + caption + ' heater schedule';

        var imgBox = document.createElement('div');
        imgBox.className = 'gps-type-card-image';
        // Text placeholder until (unless) the photo loads.
        imgBox.textContent = caption;
        if (cardDef.picture) {
            var img = new Image();
            img.alt = caption;
            img.onload = function () {
                imgBox.textContent = '';
                imgBox.appendChild(img);
            };
            img.src = cardDef.picture;
        }
        card.appendChild(imgBox);

        var label = document.createElement('div');
        label.className = 'gps-type-card-label';
        label.textContent = caption;
        card.appendChild(label);

        card.addEventListener('click', function () {
            var preset = {};
            preset[picker.filter] = cardDef.value;
            HHpro.App.showView('product', {
                productKey: product.productKey,
                initialFilters: preset
            });
        });
        return card;
    }
})();
