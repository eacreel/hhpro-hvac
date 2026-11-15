/* ============================================================
   HHpro - MINI & MULTI SPLITS product extension
   ------------------------------------------------------------
   One product for the 1:1 mini splits (MINI SPLITS tab) and the
   multi splits (MULTI SPLITS tab, ~28,000 systems stored compactly
   and rebuilt by data.js expandCompactSelections). Multi-row
   (multi-indoor-unit) rendering is handled generically by base.js
   via computeCellLayout.

   afterLoad moves saved items off pre-Nov-2026 multi split ids
   (the old ...AVJU9 outdoor models) onto their new systems, using
   the JSON's selectionAliases (see convert_to_json.py).

   System type switch (browse page, above the photo cards):
   - prepareData adds a SYSTEM TYPE filter to every system,
     "1:1 Mini Splits" (one indoor unit) or "Multi Splits" (2-5).
     It has no dropdown (data.js galleryOnlyFilters); the two
     buttons are its control.
   - Picking NUMBER OF INDOOR UNITS > 1 leaves only multi splits,
     so base.js auto-selects SYSTEM TYPE = Multi Splits: the
     button lights up and the photo cards hide, as if clicked.
   - The photo cards (TYPE (INDOOR UNIT #1)) are 1:1 indoor unit
     types: they show unless Multi Splits is selected, and picking
     one also selects 1:1 Mini Splits.

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
    var UNIT_COUNT_FILTER = 'NUMBER OF INDOOR UNITS';

    // The site-made system type filter and its two values (also listed in
    // data.js galleryOnlyFilters).
    var SYSTEM_FILTER = 'SYSTEM TYPE';
    var SINGLE = '1:1 Mini Splits';
    var MULTI = 'Multi Splits';
    var SYSTEM_BUTTONS = [
        { value: SINGLE, sub: 'One indoor unit per outdoor unit' },
        { value: MULTI,  sub: '2 to 5 indoor units on one outdoor unit' }
    ];

    HHpro.ProductExtensions.mini_splits = {
        // Once per load: tag every system with its SYSTEM TYPE. The filter
        // goes last so the cart label still leads with SIZE (OUTDOOR UNIT).
        prepareData: function (data) {
            var cols = data.filterColumns || (data.filterColumns = []);
            if (!cols.some(function (fc) { return fc.name === SYSTEM_FILTER; })) {
                cols.push({ name: SYSTEM_FILTER, col: null });
            }
            (data.selections || []).forEach(function (sel) {
                var row0 = sel.rows && sel.rows[0];
                if (!row0) return;
                if (!row0.filterData) row0.filterData = {};
                row0.filterData[SYSTEM_FILTER] = sel.rows.length > 1 ? MULTI : SINGLE;
            });
        },

        // Every time the JSON is handed out: an open cart / project item on
        // a retired selection id moves to the system it was aliased to, and
        // its cart label is rebuilt (it named the old outdoor model).
        afterLoad: function (data) {
            var aliases = data && data.selectionAliases;
            if (!aliases || !HHpro.Cart || !HHpro.Cart.migrateItems) return;
            var product = HHpro.Data.getProduct('mini_splits');
            HHpro.Cart.migrateItems(function (it) {
                if (!it || it.productKey !== 'mini_splits') return false;
                var to = aliases[it.selectionId];
                if (!to) return false;
                it.selectionId = to;
                var sel = findSelection(data, to);
                if (sel && HHpro.Cart.computeLabel) {
                    it.label = HHpro.Cart.computeLabel(product, sel, data);
                }
                return true;
            });
        },

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
            var n = currentFilters[UNIT_COUNT_FILTER];
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
         * Above the filter bar: the system type switch (1:1 Mini Splits /
         * Multi Splits) over the indoor unit type photo cards (same look
         * and mechanics as the diffuser model gallery, compact size).
         * Clicking a photo card sets TYPE (INDOOR UNIT #1) to that type;
         * clicking the active card clears it.
         */
        buildIntroSection: function (product, data, api) {
            var wrap = document.createElement('div');
            wrap.className = 'ms-intro';

            wrap.appendChild(buildSystemSwitch(data, api));

            var cards = (product && product.typeGallery) || [];
            if (!cards.length) return wrap;

            var gallery = document.createElement('div');
            gallery.className = 'model-gallery model-gallery-compact';

            cards.forEach(function (cardDef) {
                var type = String(cardDef.type);

                var card = document.createElement('button');
                card.type = 'button';
                card.className = 'model-card';
                card.title = 'Show only 1:1 mini splits with a ' + type + ' indoor unit';

                var imgBox = document.createElement('div');
                imgBox.className = 'model-card-image';
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
                    if (current === type) {
                        api.setFilter(TYPE_1_FILTER, null);
                        return;
                    }
                    // The cards are 1:1 indoor unit types: picking one also
                    // picks 1:1 Mini Splits when no system type is set.
                    var values = {};
                    values[TYPE_1_FILTER] = type;
                    if (systemValue(api) !== SINGLE) values[SYSTEM_FILTER] = SINGLE;
                    api.setFilters(values);
                });

                gallery.appendChild(card);
            });

            // The photo cards go away while Multi Splits is selected,
            // whether by its button or by picking 2+ indoor units.
            function syncGallery() {
                gallery.hidden = systemValue(api) === MULTI;
            }
            syncGallery();
            api.onFilterChange(syncGallery);

            wrap.appendChild(gallery);
            return wrap;
        }
    };

    function systemValue(api) {
        var v = api.getFilterValue(SYSTEM_FILTER);
        return (v === null || v === undefined) ? null : String(v);
    }

    // The two system type buttons. Choosing one keeps the outdoor unit
    // filters the user picked (when the new type has a match for them) and
    // clears the indoor unit ones (NUMBER OF INDOOR UNITS, the per-unit
    // SIZE / TYPE filters), since those differ between 1:1 and multi.
    // Clicking the selected button clears the system type and the indoor
    // unit filters, so it can't be re-picked automatically.
    function buildSystemSwitch(data, api) {
        var group = document.createElement('div');
        group.className = 'ms-system-switch';
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', 'System type');

        SYSTEM_BUTTONS.forEach(function (def) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ms-system-btn';

            var title = document.createElement('span');
            title.className = 'ms-system-title';
            title.textContent = def.value;
            btn.appendChild(title);

            var sub = document.createElement('span');
            sub.className = 'ms-system-sub';
            sub.textContent = def.sub;
            btn.appendChild(sub);

            function sync() {
                var active = systemValue(api) === def.value;
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            }
            sync();
            api.onFilterChange(sync);

            btn.addEventListener('click', function () {
                var current = systemValue(api);
                var values = indoorUnitResets(data);
                if (current === def.value) {
                    values[SYSTEM_FILTER] = null;
                    api.setFilters(values);
                    return;
                }
                values[SYSTEM_FILTER] = def.value;
                // Outdoor unit filters the user set: keep each one only if
                // systems of the new type still match it.
                var kept = {};
                kept[SYSTEM_FILTER] = def.value;
                (data.filterColumns || []).forEach(function (fc) {
                    if (fc.name in values) return;
                    var v = api.getFilterValue(fc.name);
                    if (v === null || v === undefined || api.isAutoFilter(fc.name)) return;
                    var test = {};
                    Object.keys(kept).forEach(function (k) { test[k] = kept[k]; });
                    test[fc.name] = v;
                    if (HHpro.Schedule.applyFilters(data.selections || [], test).length) {
                        kept[fc.name] = v;
                    } else {
                        values[fc.name] = null;
                    }
                });
                api.setFilters(values);
            });

            group.appendChild(btn);
        });
        return group;
    }

    // { filterName: null } for NUMBER OF INDOOR UNITS and every per-unit
    // filter.
    function indoorUnitResets(data) {
        var out = {};
        (data.filterColumns || []).forEach(function (fc) {
            if (fc.name === UNIT_COUNT_FILTER || PER_UNIT_FILTER_RE.test(fc.name)) {
                out[fc.name] = null;
            }
        });
        return out;
    }

    function findSelection(data, id) {
        var sels = (data && data.selections) || [];
        for (var i = 0; i < sels.length; i++) {
            if (sels[i].id === id) return sels[i];
        }
        return null;
    }

    function findFilter(filters, name) {
        for (var i = 0; i < filters.length; i++) {
            if (filters[i].name === name) return filters[i];
        }
        return null;
    }
})();
