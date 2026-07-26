/* ============================================================
   HHpro - Diffusers product extension
   ------------------------------------------------------------
   Price ceiling diffusers (SPD / SCD / SPD (Return) / SCDA /
   SMD/AMD / SMD w/ SR / PDDR). Two product-specific behaviors
   live here:

   1. Model gallery (buildIntroSection)
      A row of picture cards - one per model family - rendered
      above the filters on the browse page. Clicking a card
      filters the schedule to that model via the DESCRIPTION
      filter; clicking the active card clears it.

   2. Model-mapped schedule notes (HHpro.ModelNotes)
      The diffuser SCHEDULE NOTES tab maps every note to the
      models it applies to ("ALL" or a list like "SPD, SCD").
      The project view + exports use the helpers here to:
        - show only the notes that apply to the models actually
          in the project (numbered union, in sheet order), and
        - auto-number each schedule row's applicable notes in
          its Accessories column (e.g. "1, 2, 5, 6").
      User-deleted notes and user-added custom notes reuse the
      standard scheduleNotesState machinery; custom notes are
      numbered after the built-ins but are not auto-cited in
      the Accessories column.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};

    // ---------------------------------------------------------------
    // Model gallery (browse page intro section)
    // ---------------------------------------------------------------

    HHpro.ProductExtensions.diffusers = {
        /**
         * Build the model-card gallery shown above the filter bar.
         * `api.setFilter(name, value)` applies a filter exactly like
         * the dropdowns do; `api.getFilterValue(name)` reads the
         * current value so the active card can highlight + toggle.
         */
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
                    ? 'Show only ' + cardDef.model + ' selections'
                    : cardDef.model;

                var imgBox = document.createElement('div');
                imgBox.className = 'model-card-image';
                var img = new Image();
                img.alt = cardDef.model;
                img.src = cardDef.picture;
                imgBox.appendChild(img);
                card.appendChild(imgBox);

                var label = document.createElement('div');
                label.className = 'model-card-label';
                label.textContent = cardDef.model;
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
     * scanning the data (so the gallery cards never go stale if the
     * Excel descriptions change).
     */
    function descriptionForModel(data, model) {
        var modelCol = findModelColumn(data);
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

    function findModelColumn(data) {
        if (HHpro.Schedule && HHpro.Schedule.findModelColumns) {
            var cols = HHpro.Schedule.findModelColumns(data);
            if (cols.length) return cols[0].col;
        }
        return null;
    }

    // ---------------------------------------------------------------
    // Model-mapped schedule notes helpers
    // ---------------------------------------------------------------

    function isModelMap(data) {
        return !!(data && data.scheduleNotes &&
                  data.scheduleNotes.format === 'modelmap');
    }

    function noteApplies(note, model) {
        var models = (note && note.models) || [];
        for (var i = 0; i < models.length; i++) {
            if (models[i] === 'ALL') return true;
            if (String(models[i]) === String(model)) return true;
        }
        return false;
    }

    function findSelectionById(data, selectionId) {
        var sels = (data && data.selections) || [];
        for (var i = 0; i < sels.length; i++) {
            if (sels[i].id === selectionId) return sels[i];
        }
        return null;
    }

    HHpro.ModelNotes = {
        isModelMap: isModelMap,

        /** MODEL column value for a selection ('SPD', 'PDDR', ...). */
        modelOfSelection: function (data, sel) {
            var col = findModelColumn(data);
            if (!col || !sel || !sel.rows || !sel.rows[0]) return null;
            var v = sel.rows[0].scheduleData && sel.rows[0].scheduleData[col];
            return (v === undefined || v === null) ? null : String(v);
        },

        /**
         * Build the numbering context for one product tab.
         *
         * items - the cart items on the tab (their selections determine
         * which models are "in the project").
         *
         * Returns:
         *   {
         *     selectedModels: ['SPD', ...],
         *     list: [{ num, text, models, originalIdx }, ...]  // visible,
         *            // numbered union of applicable non-deleted notes
         *     customStartNum,          // first number for custom notes
         *     numbersForModel(model),  // -> [1, 2, 5, ...]
         *     accessoriesText(model, freeText) // -> "1, 2, 5, BN"
         *   }
         */
        buildContext: function (productKey, data, items) {
            var allNotes = (data && data.scheduleNotes &&
                            data.scheduleNotes.notes) || [];

            var modelSeen = {};
            var selectedModels = [];
            (items || []).forEach(function (item) {
                var sel = findSelectionById(data, item.selectionId);
                var m = HHpro.ModelNotes.modelOfSelection(data, sel);
                if (m && !modelSeen[m]) {
                    modelSeen[m] = true;
                    selectedModels.push(m);
                }
            });

            var extra = (HHpro.Cart && HHpro.Cart.getProjectExtra)
                ? HHpro.Cart.getProjectExtra(productKey) || {} : {};
            var nstate = extra.scheduleNotesState || {};
            var deleted = {};
            (Array.isArray(nstate.deletedIndices) ? nstate.deletedIndices : [])
                .forEach(function (i) { deleted[i] = true; });

            var list = [];
            var num = 1;
            allNotes.forEach(function (note, originalIdx) {
                if (deleted[originalIdx]) return;
                var applies = selectedModels.some(function (m) {
                    return noteApplies(note, m);
                });
                if (!applies) return;
                list.push({
                    num: num,
                    text: String(note.text || ''),
                    models: note.models || [],
                    originalIdx: originalIdx
                });
                num++;
            });

            return {
                selectedModels: selectedModels,
                list: list,
                customStartNum: num,
                numbersForModel: function (model) {
                    return list.filter(function (entry) {
                        return noteApplies(entry, model);
                    }).map(function (entry) { return entry.num; });
                },
                accessoriesText: function (model, freeText) {
                    var parts = this.numbersForModel(model).join(', ');
                    var txt = (freeText === undefined || freeText === null)
                        ? '' : String(freeText).trim();
                    if (parts && txt) return parts + ', ' + txt;
                    return parts || txt;
                }
            };
        },

        /**
         * True when the notes legend image (e.g. "SMD & AMD Options")
         * should show for the given selected models.
         */
        legendApplies: function (product, selectedModels) {
            var legend = product && product.notesLegend;
            if (!legend || !legend.picture) return false;
            var trigger = legend.models || [];
            return (selectedModels || []).some(function (m) {
                return trigger.indexOf(String(m)) !== -1;
            });
        }
    };
})();
