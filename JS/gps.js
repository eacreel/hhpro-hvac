/* ============================================================
   HHpro - GPS (Bipolar Ionization) product extension
   ------------------------------------------------------------
   The GPS JSON is unlike every other product: one file holds
   SEVEN independent sub-schedules (subSchedules[]), each with
   its own column set, data rows, and pre-numbered notes block.

   This module:
     - Renders the product page itself (renderProductPage hook in
       base.js): a photo gallery of the seven product types first
       (photo + the schedule's LOCATION filter text), then the
       chosen type's full schedule with its notes underneath.
     - Exposes HHpro.GPS helpers used by project_view.js and
       export.js to render/export one section per sub-schedule:
         isMulti(data)            -> true for the GPS payload
         getSubSchedules(data)    -> subSchedules list
         subData(data, index)     -> standard-shaped product data
                                     scoped to one sub-schedule
         groupItems(items, data)  -> [{ sub, subData, items }] in
                                     sub-schedule order
         buildNotesBlock(notes, title?) -> read-only DOM block of
                                     the verbatim note lines

   Notes are NEVER renumbered: the Excel pre-numbers them and the
   data rows' NOTES column cites those numbers.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};

    // ---------------------------------------------------------------
    // Shared helpers (used here + project_view.js + export.js)
    // ---------------------------------------------------------------

    // Pseudo-data cache: one entry per (data object, sub index). The
    // data object is cached by HHpro.Data, so a plain WeakMap works.
    var subDataCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;

    function isMulti(data) {
        return !!(data && Array.isArray(data.subSchedules) && data.subSchedules.length);
    }

    function getSubSchedules(data) {
        return isMulti(data) ? data.subSchedules : [];
    }

    /**
     * Build (and cache) a standard-shaped product-data object scoped
     * to one sub-schedule, so every generic consumer (schedule table
     * builder, docs modal, cart labels, export grid) works unchanged.
     */
    function subData(data, index) {
        if (!isMulti(data)) return data;
        var cached = subDataCache ? subDataCache.get(data) : null;
        if (cached && cached[index]) return cached[index];

        var sub = data.subSchedules[index];
        if (!sub) return null;

        var byId = {};
        (data.selections || []).forEach(function (sel) { byId[sel.id] = sel; });
        var sels = (sub.selectionIds || []).map(function (id) { return byId[id]; })
            .filter(Boolean);

        var out = {
            productType:                data.productType,
            assetsFolder:               data.assetsFolder,
            scheduleTitle:              sub.title,
            supportsMultiRowSelections: false,
            searchSchema:               data.searchSchema,
            scheduleHeader:             sub.scheduleHeader,
            filterColumns:              data.filterColumns || [],
            documentationColumns:       data.documentationColumns || [],
            refrigerantColumns:         [],
            selections:                 sels,
            // 'preformatted' = verbatim lines, already numbered in the
            // text. project_view/export render them without renumbering.
            scheduleNotes:              { format: 'preformatted', notes: sub.notes || [] }
        };

        if (subDataCache) {
            if (!cached) {
                cached = {};
                subDataCache.set(data, cached);
            }
            cached[index] = out;
        }
        return out;
    }

    /**
     * Group project/cart items by the sub-schedule their selection
     * belongs to. Returns [{ sub, subData, items }] in sub-schedule
     * order, skipping sub-schedules with no items. Items whose
     * selection id no longer exists are dropped (same policy as the
     * generic grid builder).
     */
    function groupItems(items, data) {
        if (!isMulti(data)) return [];
        var subOfSel = {};
        data.subSchedules.forEach(function (sub) {
            (sub.selectionIds || []).forEach(function (id) {
                subOfSel[id] = sub.index;
            });
        });
        var buckets = {};
        (items || []).forEach(function (it) {
            var idx = subOfSel[it.selectionId];
            if (idx === undefined) return;
            if (!buckets[idx]) buckets[idx] = [];
            buckets[idx].push(it);
        });
        return data.subSchedules
            .filter(function (sub) { return buckets[sub.index]; })
            .map(function (sub) {
                return {
                    sub: sub,
                    subData: subData(data, sub.index),
                    items: buckets[sub.index]
                };
            });
    }

    /**
     * Read-only notes block: the verbatim (pre-numbered) note lines
     * in a bordered box, matching the exports' notes section. Used
     * under the browse schedule and under each project sub-schedule.
     */
    function buildNotesBlock(notes, title) {
        var block = document.createElement('div');
        block.className = 'notes-block notes-plain notes-readonly gps-notes-block';

        var header = document.createElement('div');
        header.className = 'notes-block-header';
        header.textContent = title || 'NOTES:';
        block.appendChild(header);

        var list = document.createElement('div');
        list.className = 'gps-notes-list';
        (notes || []).forEach(function (text) {
            var line = document.createElement('div');
            line.className = 'gps-notes-line';
            line.textContent = String(text);
            list.appendChild(line);
        });
        block.appendChild(list);
        return block;
    }

    /** Sub-schedule index containing a model matching `query`, or -1. */
    function findSubForModel(data, query) {
        if (!isMulti(data) || !query) return -1;
        for (var i = 0; i < data.subSchedules.length; i++) {
            var sd = subData(data, i);
            var matches = HHpro.Schedule.applyModelFilter(sd.selections, query, sd);
            if (matches.length) return i;
        }
        return -1;
    }

    HHpro.GPS = {
        isMulti: isMulti,
        getSubSchedules: getSubSchedules,
        subData: subData,
        groupItems: groupItems,
        buildNotesBlock: buildNotesBlock,
        findSubForModel: findSubForModel
    };

    // ---------------------------------------------------------------
    // Product page
    // ---------------------------------------------------------------

    HHpro.ProductExtensions.gps = {
        renderProductPage: function (root, product, data, params) {
            var activeSubIndex = null;
            var modelFilter = null;

            // Arriving from quick-lookup: open the sub-schedule that
            // contains the picked model, pre-filtered to it.
            var q = params && typeof params.modelQuery === 'string'
                ? params.modelQuery.trim() : '';
            if (q) {
                var idx = findSubForModel(data, q);
                if (idx >= 0) {
                    activeSubIndex = idx;
                    modelFilter = q;
                }
            }

            render();

            function render() {
                root.innerHTML = '';
                root.appendChild(HHpro.UI.buildHeader(product.displayName));
                if (HHpro.Cart && typeof HHpro.Cart.init === 'function') {
                    HHpro.Cart.init();
                }

                var main = document.createElement('main');
                main.className = 'product-view';
                var inner = document.createElement('div');
                // The shared inner column shrink-wraps to its content
                // (width: fit-content), which collapses a grid with
                // auto-fill columns to a single track. In gallery mode
                // take the full page width instead so the card grid can
                // flow into multiple centered columns.
                inner.className = 'product-view-inner' +
                    (activeSubIndex === null ? ' gps-inner-gallery' : '');
                main.appendChild(inner);

                if (activeSubIndex === null) {
                    renderGallery(inner);
                } else {
                    renderSubSchedule(inner, activeSubIndex);
                }

                root.appendChild(main);
            }

            function buildHeaderBlock(container, metaText, backLabel, onBack) {
                var header = document.createElement('div');
                header.className = 'product-header';

                var titleArea = document.createElement('div');
                var title = document.createElement('h1');
                title.className = 'product-title';
                title.textContent = product.displayName;
                titleArea.appendChild(title);
                if (metaText) {
                    var meta = document.createElement('p');
                    meta.className = 'product-meta';
                    meta.textContent = metaText;
                    titleArea.appendChild(meta);
                }
                header.appendChild(titleArea);

                var backBtn = document.createElement('button');
                backBtn.type = 'button';
                backBtn.className = 'product-back-btn';
                backBtn.appendChild(HHpro.UI.icon('arrow-left'));
                var backText = document.createElement('span');
                backText.textContent = backLabel;
                backBtn.appendChild(backText);
                backBtn.addEventListener('click', onBack);
                header.appendChild(backBtn);

                container.appendChild(header);
            }

            // ----- Gallery of the seven product types -----
            function renderGallery(container) {
                buildHeaderBlock(container,
                    'Select a product type to open its schedule',
                    'Back to Products',
                    function () { HHpro.App.showView('main'); });

                var gallery = document.createElement('div');
                gallery.className = 'gps-gallery';

                getSubSchedules(data).forEach(function (sub) {
                    gallery.appendChild(buildTypeCard(sub));
                });

                container.appendChild(gallery);
            }

            function buildTypeCard(sub) {
                var caption = sub.filterValue || sub.title || '';

                var card = document.createElement('button');
                card.type = 'button';
                card.className = 'gps-type-card';
                card.title = sub.title || caption;

                var imgBox = document.createElement('div');
                imgBox.className = 'gps-type-card-image';
                // Text placeholder until (unless) the photo loads, same
                // pattern as the home-page product tiles.
                imgBox.textContent = caption;
                if (sub.photoKey && product.photoFolder) {
                    var img = new Image();
                    img.alt = caption;
                    img.onload = function () {
                        imgBox.textContent = '';
                        imgBox.appendChild(img);
                    };
                    img.src = product.photoFolder + '/GPS - ' + sub.photoKey + '.webp';
                }
                card.appendChild(imgBox);

                var label = document.createElement('div');
                label.className = 'gps-type-card-label';
                label.textContent = caption;
                card.appendChild(label);

                card.addEventListener('click', function () {
                    activeSubIndex = sub.index;
                    modelFilter = null;
                    render();
                });

                return card;
            }

            // ----- One sub-schedule: full table + notes -----
            function renderSubSchedule(container, index) {
                var sd = subData(data, index);

                buildHeaderBlock(container, sd.scheduleTitle,
                    'All Product Types',
                    function () {
                        activeSubIndex = null;
                        modelFilter = null;
                        render();
                    });

                var statusLine = document.createElement('div');
                statusLine.className = 'filter-status';
                container.appendChild(statusLine);

                // Active model-filter chip (quick-lookup arrivals).
                if (modelFilter) {
                    var chipRow = document.createElement('div');
                    chipRow.className = 'model-filter-chip-row';
                    var chip = document.createElement('div');
                    chip.className = 'model-filter-chip';
                    var chipLabel = document.createElement('span');
                    chipLabel.className = 'model-filter-chip-label';
                    chipLabel.textContent = 'Model contains "' + modelFilter + '"';
                    chip.appendChild(chipLabel);
                    var clear = document.createElement('button');
                    clear.type = 'button';
                    clear.className = 'model-filter-chip-clear';
                    clear.setAttribute('aria-label', 'Clear model filter');
                    clear.appendChild(HHpro.UI.icon('x'));
                    var clearText = document.createElement('span');
                    clearText.textContent = 'Clear';
                    clear.appendChild(clearText);
                    clear.addEventListener('click', function () {
                        modelFilter = null;
                        render();
                    });
                    chip.appendChild(clear);
                    chipRow.appendChild(chip);
                    container.appendChild(chipRow);
                }

                var visible = sd.selections;
                if (modelFilter) {
                    visible = HHpro.Schedule.applyModelFilter(visible, modelFilter, sd);
                }
                var total = sd.selections.length;
                statusLine.textContent = (visible.length === total)
                    ? 'Showing all ' + total + ' item' + (total === 1 ? '' : 's')
                    : 'Showing ' + visible.length + ' of ' + total + ' items';

                var scheduleWrap = document.createElement('div');
                // gps-schedule-wrap: hug the table's height (notes sit
                // directly below) instead of stretching to fill the page.
                scheduleWrap.className = 'schedule-wrap gps-schedule-wrap';
                var table = HHpro.Schedule.buildTable(sd, visible, product);
                scheduleWrap.appendChild(table);
                container.appendChild(scheduleWrap);

                // Schedule notes (verbatim, pre-numbered) directly below.
                if (sd.scheduleNotes.notes.length) {
                    var notesWrap = document.createElement('div');
                    notesWrap.className = 'gps-notes-wrap';
                    notesWrap.appendChild(buildNotesBlock(sd.scheduleNotes.notes));
                    container.appendChild(notesWrap);
                }

                // Sticky header offsets need rendered sizes; re-run after
                // layout settles (same belt-and-suspenders as base.js).
                requestAnimationFrame(function () {
                    if (!table.isConnected) return;
                    HHpro.Schedule.applyStickyHeaderOffsets(table);
                    requestAnimationFrame(function () {
                        if (!table.isConnected) return;
                        HHpro.Schedule.applyStickyHeaderOffsets(table);
                    });
                });
                if (document.fonts && document.fonts.ready) {
                    document.fonts.ready.then(function () {
                        if (!table.isConnected) return;
                        HHpro.Schedule.applyStickyHeaderOffsets(table);
                    });
                }
            }
        }
    };
})();
