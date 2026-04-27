/* ============================================================
   HHpro - Product view (shared base)
   ------------------------------------------------------------
   Renders any product page: header, title, filter bar, and
   schedule table. All four product types share this base; any
   per-product customization lives in HHpro.ProductExtensions[key].

   Call via:
       HHpro.App.showView('product', { productKey: 'gas_packs' });

   Supported per-product extension hooks (in ProductExtensions[key]):
     getVisibleFilters(allFilters, currentFilters)
         Returns the subset of filter columns that should be shown
         right now. Called after every filter change, so filters
         can be added/removed dynamically (used by mini_splits to
         reveal per-indoor-unit filters once the user picks a value
         for NUMBER OF INDOOR UNITS).
     formatScheduleCellValue(colLetter, value)
         Per-column override for how a schedule data cell is
         rendered. Return a string to use that string verbatim, or
         undefined to fall through to the default String(value)
         formatting. Applied identically on the browse schedule,
         the project view schedule, and the XLSX/PDF export so the
         displayed value is consistent everywhere.

   Filter behavior:
     - Cascading dropdowns: each dropdown's options reflect what's
       achievable given the OTHER filters' current values.
     - Auto-select: after every change, if any remaining filter has
       only a single remaining option, that option is auto-picked.
       Auto-picks cascade and reset on any user change.

   Schedule cell merging:
     - Multi-row selections (mini-splits with 2+ indoor units) use
       vertical rowspan where only row 0 has a value for a column.
     - Horizontal colspans come from the JSON's scheduleCellSpans
       map (e.g. Mini Splits row where J:L "Voltage/MCA/MOP" is
       merged for "Indoor Powered From Outdoor Unit").

   Auto-fit:
     - After rendering, if the table's natural width exceeds the
       viewport, a uniform CSS `zoom` is applied so the whole table
       fits the width of the screen. Clamped at 0.6.

   Action buttons (per row):
     - Select:    HHpro.Cart.addItem (first click may show the
                  project-or-cart prompt modal)
     - Submittal: HHpro.Docs.openSubmittal - opens every submittal
                  PDF for the selection (one tab per unique PDF)
     - Docs:      HHpro.Docs.openDocsModal - popup with every
                  available document for the selection
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};
    HHpro.ProductExtensions = HHpro.ProductExtensions || {};

    // Header values (case-insensitive) that mark a column as a model
    // number column. Used by the quick-lookup index, by the schedule
    // rendering, and by the model filter pulled in from the lookup.
    var MODEL_HEADER_SET = {
        'MODEL': true,
        'MODEL NUMBER': true,
        'MODEL#': true,
        'MODEL #': true
    };

    // Reusable schedule pieces. Other views (design_search, etc.) build
    // result tables that should look and behave identically to the main
    // product page schedule, so they share the same builders. Function
    // declarations below are hoisted -- the references here resolve fine.
    HHpro.Schedule = {
        buildTable: function (data, selections, product) { return buildScheduleTable(data, selections, product); },
        applyFilters: function (selections, filterValues) { return applyFilters(selections, filterValues); },
        applyStickyHeaderOffsets: function (table) { return applyStickyHeaderOffsets(table); },
        // Per-product filter visibility logic (mini splits hides per-zone
        // SIZE/TYPE filters until the user picks NUMBER OF INDOOR UNITS,
        // for example). Mirrors the behavior on the main product page.
        getVisibleFilters: function (productKey, data, currentFilters) {
            return getVisibleFilters(productKey, data, currentFilters);
        },
        pruneFilterValues: function (filterValues, visibleFilters) {
            return pruneFilterValues(filterValues, visibleFilters);
        },
        findModelColumns: function (data) { return findModelColumns(data); },
        applyModelFilter: function (selections, query, data) {
            return applyModelFilter(selections, query, data);
        }
    };

    /**
     * Walk a product's scheduleHeader and return every column whose
     * header text identifies it as a model number column. Returns
     * [{ col, label }] de-duplicated by column letter.
     */
    function findModelColumns(data) {
        var rows = (data && data.scheduleHeader && data.scheduleHeader.rows) || [];
        var found = [];
        var seen = {};
        rows.forEach(function (hdrRow) {
            (hdrRow || []).forEach(function (cell) {
                var label = (cell && cell.value !== undefined && cell.value !== null)
                    ? String(cell.value).trim() : '';
                var up = label.toUpperCase();
                if (!MODEL_HEADER_SET[up]) return;
                if (seen[cell.col]) return;
                seen[cell.col] = true;
                found.push({ col: cell.col, label: label });
            });
        });
        return found;
    }

    /**
     * Filter `selections` down to those where at least one row has a
     * value in any model column that contains `query` (case-insensitive
     * substring match). Used when the quick-lookup picks a model and
     * navigates to the product page so the schedule shows just that
     * model's selections.
     */
    function applyModelFilter(selections, query, data) {
        var modelCols = findModelColumns(data);
        if (!modelCols.length || !query) return selections.slice();
        var q = String(query).toLowerCase();
        return selections.filter(function (sel) {
            return (sel.rows || []).some(function (row) {
                if (!row.scheduleData) return false;
                return modelCols.some(function (mc) {
                    var v = row.scheduleData[mc.col];
                    if (v === undefined || v === null) return false;
                    return String(v).toLowerCase().indexOf(q) !== -1;
                });
            });
        });
    }

    HHpro.Views.product = {
        render: function (root, params) {
            var productKey = params && params.productKey;
            var product = productKey ? HHpro.Data.getProduct(productKey) : null;
            if (!product) {
                renderError(root, null, 'Unknown product key: ' + productKey);
                return;
            }

            renderLoading(root, product);

            HHpro.Data.loadProduct(productKey)
                .then(function (data) {
                    renderPage(root, product, data, params);
                })
                .catch(function (err) {
                    var msg = (err && err.message) ? err.message : String(err);
                    renderError(root, product, msg);
                });
        }
    };

    // ---------------------------------------------------------------
    // Loading / error states
    // ---------------------------------------------------------------

    function renderLoading(root, product) {
        root.innerHTML = '';
        root.appendChild(HHpro.UI.buildHeader(product.displayName));

        var main = document.createElement('main');
        main.className = 'product-view';

        var msg = document.createElement('div');
        msg.className = 'product-message';
        var p = document.createElement('p');
        p.textContent = 'Loading ' + product.displayName + '…';
        msg.appendChild(p);

        main.appendChild(msg);
        root.appendChild(main);
    }

    function renderError(root, product, message) {
        root.innerHTML = '';
        root.appendChild(HHpro.UI.buildHeader(product ? product.displayName : 'Error'));

        var main = document.createElement('main');
        main.className = 'product-view';

        var msg = document.createElement('div');
        msg.className = 'product-message error';

        var p1 = document.createElement('p');
        p1.textContent = 'Could not load product data.';

        var p2 = document.createElement('p');
        p2.className = 'product-message-hint';
        p2.textContent = 'Make sure you are running the site through a local web server ' +
            '(such as VS Code\'s Live Server extension), not opening index.html directly.';

        var p3 = document.createElement('p');
        p3.className = 'product-message-details';
        p3.textContent = 'Details: ' + message;

        msg.appendChild(p1);
        msg.appendChild(p2);
        msg.appendChild(p3);
        main.appendChild(msg);
        root.appendChild(main);
    }

    // ---------------------------------------------------------------
    // Main page render
    // ---------------------------------------------------------------

    function renderPage(root, product, data, params) {
        root.innerHTML = '';
        root.appendChild(HHpro.UI.buildHeader(product.displayName));

        // Make sure the cart panel/toggle is initialized. Idempotent - if
        // already built (e.g. cart.js auto-initialized earlier this session),
        // this is a no-op.
        if (HHpro.Cart && typeof HHpro.Cart.init === 'function') {
            HHpro.Cart.init();
        }

        var main = document.createElement('main');
        main.className = 'product-view';

        // Title block (top)
        var header = document.createElement('div');
        header.className = 'product-header';
        var titleArea = document.createElement('div');
        var title = document.createElement('h1');
        title.className = 'product-title';
        title.textContent = product.displayName;
        titleArea.appendChild(title);
        if (data.scheduleTitle) {
            var meta = document.createElement('p');
            meta.className = 'product-meta';
            meta.textContent = data.scheduleTitle;
            titleArea.appendChild(meta);
        }
        header.appendChild(titleArea);

        // "Back to Products" button - more discoverable than the
        // HHpro logo in the top header, and lands the user directly
        // on the product-picker grid so they can pick a different
        // schedule without retracing their steps.
        var backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.className = 'product-back-btn';
        backBtn.appendChild(HHpro.UI.icon('arrow-left'));
        var backLabel = document.createElement('span');
        backLabel.textContent = 'Back to Products';
        backBtn.appendChild(backLabel);
        backBtn.addEventListener('click', function () {
            HHpro.App.showView('main');
        });
        header.appendChild(backBtn);
        main.appendChild(header);

        // --- Shared mutable state ---
        var filterValues = {};
        var autoSelectedNames = {};
        // Optional model-substring filter passed in from the quick-lookup
        // search ("show only selections containing this model"). Cleared
        // by the chip's clear button. Initialized from params, so a
        // direct navigation to /product without params shows everything.
        var modelFilter = (params && typeof params.modelQuery === 'string' && params.modelQuery.trim())
            ? params.modelQuery.trim()
            : null;

        var filterBarContainer = document.createElement('div');
        main.appendChild(filterBarContainer);

        // Container for the active model-filter chip. Empty when there
        // is no active model filter, so it takes no layout space.
        var modelChipContainer = document.createElement('div');
        modelChipContainer.className = 'model-filter-chip-row';
        main.appendChild(modelChipContainer);

        var statusLine = document.createElement('div');
        statusLine.className = 'filter-status';
        main.appendChild(statusLine);

        var scheduleWrap = document.createElement('div');
        scheduleWrap.className = 'schedule-wrap';
        main.appendChild(scheduleWrap);

        root.appendChild(main);

        // --- Initial state ---
        var initialVisible = getVisibleFilters(product.productKey, data, filterValues);
        initialVisible.forEach(function (fc) { filterValues[fc.name] = null; });

        renderModelFilterChip();
        applyFilterChange();

        // Sticky header offsets AND auto-fit zoom both depend on rendered
        // element sizes, which change if the window is resized.
        window.addEventListener('resize', onResize);

        function onResize() {
            var table = scheduleWrap.querySelector('.schedule-table');
            if (!table) return;
            applyStickyHeaderOffsets(table);
        }

        function applyFilterChange() {
            autoSelectSingleOptions();
            renderFilterBar();
            refreshSchedule();
        }

        function onUserFilterChange(filterName, newValue) {
            delete autoSelectedNames[filterName];
            filterValues[filterName] = newValue;

            // All other auto-selected values may no longer be valid; reset
            // them and let auto-select re-evaluate against the new choice.
            Object.keys(autoSelectedNames).forEach(function (name) {
                filterValues[name] = null;
            });
            autoSelectedNames = {};

            applyFilterChange();
        }

        function onClearAllFilters() {
            Object.keys(filterValues).forEach(function (k) { filterValues[k] = null; });
            autoSelectedNames = {};
            applyFilterChange();
        }

        function autoSelectSingleOptions() {
            var changed = true;
            var safety = 0;
            while (changed && safety < 20) {
                changed = false;
                safety++;

                var visible = getVisibleFilters(product.productKey, data, filterValues);
                pruneFilterValues(filterValues, visible);

                for (var i = 0; i < visible.length; i++) {
                    var fc = visible[i];
                    if (filterValues[fc.name] !== null && filterValues[fc.name] !== undefined) {
                        continue;
                    }
                    var options = getUniqueFilterValues(data, fc.name, filterValues, visible);
                    if (options.length === 1) {
                        filterValues[fc.name] = String(options[0]);
                        autoSelectedNames[fc.name] = true;
                        changed = true;
                    }
                }
            }
        }

        function renderFilterBar() {
            var visible = getVisibleFilters(product.productKey, data, filterValues);
            pruneFilterValues(filterValues, visible);
            var bar = buildFilterBar(data, visible, filterValues, onUserFilterChange, onClearAllFilters);
            filterBarContainer.innerHTML = '';
            filterBarContainer.appendChild(bar);
        }

        function renderModelFilterChip() {
            modelChipContainer.innerHTML = '';
            if (!modelFilter) return;

            var chip = document.createElement('div');
            chip.className = 'model-filter-chip';

            var label = document.createElement('span');
            label.className = 'model-filter-chip-label';
            label.textContent = 'Model contains "' + modelFilter + '"';
            chip.appendChild(label);

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
                renderModelFilterChip();
                refreshSchedule();
            });
            chip.appendChild(clear);

            modelChipContainer.appendChild(chip);
        }

        function refreshSchedule() {
            scheduleWrap.innerHTML = '';
            var visible = applyFilters(data.selections || [], filterValues);
            if (modelFilter) {
                visible = applyModelFilter(visible, modelFilter, data);
            }
            updateStatus(visible.length, (data.selections || []).length);
            if (visible.length === 0) {
                var zero = document.createElement('div');
                zero.className = 'zero-results';
                zero.textContent = 'No items match the current filters.';
                scheduleWrap.appendChild(zero);
                return;
            }
            var table = buildScheduleTable(data, visible, product);
            scheduleWrap.appendChild(table);
            applyStickyHeaderOffsets(table);
            scheduleStickyRecomputes(table);
        }

        // Schedule belt-and-suspenders re-runs of the sticky offset pass:
        //   - rAF chain (covers async layout that takes >1 frame to settle)
        //   - document.fonts.ready (covers Inter swapping in after the
        //     fallback font, which shifts row heights by a pixel or two)
        //   - ResizeObserver on each thead row (covers any other dynamic
        //     change that affects header heights -- the most reliable
        //     catch-all for "row heights drifted out from under us")
        // Each callback is guarded by table.isConnected so a filter change
        // that replaced the table doesn't reapply offsets to a detached one.
        function scheduleStickyRecomputes(table) {
            requestAnimationFrame(function () {
                if (!table.isConnected) return;
                applyStickyHeaderOffsets(table);
                requestAnimationFrame(function () {
                    if (!table.isConnected) return;
                    applyStickyHeaderOffsets(table);
                });
            });

            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(function () {
                    if (!table.isConnected) return;
                    applyStickyHeaderOffsets(table);
                });
            }

            if (typeof ResizeObserver !== 'undefined') {
                var thead = table.tHead;
                if (thead && thead.rows.length) {
                    var rafPending = false;
                    var ro = new ResizeObserver(function () {
                        if (!table.isConnected) {
                            ro.disconnect();
                            return;
                        }
                        // Coalesce bursts of size events into one rAF so we
                        // don't trigger nested layout passes.
                        if (rafPending) return;
                        rafPending = true;
                        requestAnimationFrame(function () {
                            rafPending = false;
                            if (!table.isConnected) return;
                            applyStickyHeaderOffsets(table);
                        });
                    });
                    for (var r = 0; r < thead.rows.length; r++) {
                        ro.observe(thead.rows[r]);
                    }
                }
            }
        }

        function updateStatus(shown, total) {
            if (shown === total) {
                statusLine.textContent = 'Showing all ' + total + ' item' + (total === 1 ? '' : 's');
            } else {
                statusLine.textContent = 'Showing ' + shown + ' of ' + total + ' items';
            }
        }
    }

    // ---------------------------------------------------------------
    // Visible-filters resolution (per-product hook)
    // ---------------------------------------------------------------

    function getVisibleFilters(productKey, data, currentFilters) {
        var allFilters = (data.filterColumns || []).slice();
        var ext = HHpro.ProductExtensions && HHpro.ProductExtensions[productKey];
        if (ext && typeof ext.getVisibleFilters === 'function') {
            var result = ext.getVisibleFilters(allFilters, currentFilters);
            return Array.isArray(result) ? result : allFilters;
        }
        return allFilters;
    }

    function pruneFilterValues(filterValues, visibleFilters) {
        var visibleNames = {};
        visibleFilters.forEach(function (fc) { visibleNames[fc.name] = true; });
        Object.keys(filterValues).forEach(function (k) {
            if (!visibleNames[k]) delete filterValues[k];
        });
        visibleFilters.forEach(function (fc) {
            if (!(fc.name in filterValues)) filterValues[fc.name] = null;
        });
    }

    // ---------------------------------------------------------------
    // Filter bar
    // ---------------------------------------------------------------

    function buildFilterBar(data, visibleFilters, filterValues, onChange, onClearAll) {
        var bar = document.createElement('div');
        bar.className = 'filter-bar';

        visibleFilters.forEach(function (fc) {
            var group = document.createElement('div');
            group.className = 'filter-group';

            var label = document.createElement('label');
            label.className = 'filter-label';
            label.textContent = fc.name;

            var select = document.createElement('select');
            select.className = 'filter-select';

            var allOpt = document.createElement('option');
            allOpt.value = '__all__';
            allOpt.textContent = 'All';
            select.appendChild(allOpt);

            getUniqueFilterValues(data, fc.name, filterValues, visibleFilters).forEach(function (v) {
                var opt = document.createElement('option');
                opt.value = String(v);
                opt.textContent = String(v);
                select.appendChild(opt);
            });

            var current = filterValues[fc.name];
            if (current !== null && current !== undefined) {
                select.value = String(current);
            }

            select.addEventListener('change', function () {
                var newValue = (select.value === '__all__') ? null : select.value;
                onChange(fc.name, newValue);
            });

            group.appendChild(label);
            group.appendChild(select);
            bar.appendChild(group);
        });

        var clearGroup = document.createElement('div');
        clearGroup.className = 'filter-group';
        var spacerLabel = document.createElement('div');
        spacerLabel.className = 'filter-label';
        spacerLabel.innerHTML = '&nbsp;';

        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'filter-clear';
        clearBtn.textContent = 'Clear all filters';
        clearBtn.addEventListener('click', onClearAll);

        clearGroup.appendChild(spacerLabel);
        clearGroup.appendChild(clearBtn);
        bar.appendChild(clearGroup);

        return bar;
    }

    function getUniqueFilterValues(data, filterName, filterValues, visibleFilters) {
        var otherValues = {};
        Object.keys(filterValues).forEach(function (k) {
            if (k !== filterName) otherValues[k] = filterValues[k];
        });
        var pool = applyFilters(data.selections || [], otherValues);

        var values = [];
        var seen = {};
        pool.forEach(function (sel) {
            if (!sel.rows || !sel.rows[0] || !sel.rows[0].filterData) return;
            var v = sel.rows[0].filterData[filterName];
            if (v === undefined || v === null) return;
            var key = String(v);
            if (!seen[key]) {
                seen[key] = true;
                values.push(v);
            }
        });
        return values.sort(compareValues);
    }

    function compareValues(a, b) {
        var na = typeof a === 'number' ? a : (isFinite(parseFloat(a)) ? parseFloat(a) : NaN);
        var nb = typeof b === 'number' ? b : (isFinite(parseFloat(b)) ? parseFloat(b) : NaN);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b));
    }

    function applyFilters(selections, filterValues) {
        var activeKeys = [];
        Object.keys(filterValues).forEach(function (k) {
            if (filterValues[k] !== null && filterValues[k] !== undefined) activeKeys.push(k);
        });
        if (activeKeys.length === 0) return selections.slice();

        return selections.filter(function (sel) {
            if (!sel.rows || !sel.rows[0] || !sel.rows[0].filterData) return false;
            var row0Filters = sel.rows[0].filterData;
            return activeKeys.every(function (key) {
                var target = filterValues[key];
                var v = row0Filters[key];
                if (v === undefined || v === null) return false;
                return String(v) === String(target);
            });
        });
    }

    // ---------------------------------------------------------------
    // Schedule table
    // ---------------------------------------------------------------

    function buildScheduleTable(data, selections, product) {
        var table = document.createElement('table');
        table.className = 'schedule-table';
        // Per-product "always hidden" columns (declared in data.js via
        // hiddenSelectionColumns). The project-view schedule creator
        // still shows these; only the browse page hides them.
        var hiddenSet = {};
        var hidden = (product && product.hiddenSelectionColumns) || [];
        hidden.forEach(function (letter) { hiddenSet[letter] = true; });
        table.appendChild(buildScheduleHead(data, hiddenSet));
        table.appendChild(buildScheduleBody(data, selections, product, hiddenSet));
        return table;
    }

    function buildScheduleHead(data, hiddenSet) {
        hiddenSet = hiddenSet || {};
        var thead = document.createElement('thead');
        var rows = (data.scheduleHeader && data.scheduleHeader.rows) || [];

        // Skip the first header row if it's a single merged title cell matching
        // scheduleTitle (we already show that title separately above the table).
        var startIdx = 0;
        if (rows.length > 1 && rows[0].length === 1 && rows[0][0].value === data.scheduleTitle) {
            startIdx = 1;
        }
        var displayRows = rows.slice(startIdx);

        var allLetters = (data.scheduleHeader && data.scheduleHeader.columnLetters) || [];

        displayRows.forEach(function (row, rowIndex) {
            var tr = document.createElement('tr');

            if (rowIndex === 0) {
                var actionsTh = document.createElement('th');
                actionsTh.className = 'actions-head';
                actionsTh.rowSpan = displayRows.length;
                actionsTh.textContent = 'Actions';
                tr.appendChild(actionsTh);
            }

            row.forEach(function (cell) {
                // Recompute colspan taking hidden columns into account.
                // A merged header cell that spans cols A..C where only
                // B is hidden should still render, with colspan 2.
                var startCol = allLetters.indexOf(cell.col);
                var origColspan = cell.colspan || 1;
                var visibleSpan = 0;
                if (startCol < 0) {
                    // Column not in the schedule letter set; fall back to
                    // the original colspan (preserves pre-existing behavior
                    // for any edge-case headers).
                    visibleSpan = origColspan;
                } else {
                    for (var i = 0; i < origColspan; i++) {
                        var letter = allLetters[startCol + i];
                        if (!hiddenSet[letter]) visibleSpan++;
                    }
                }
                if (visibleSpan === 0) return;   // entire merge is hidden

                var th = document.createElement('th');
                if (visibleSpan > 1) th.colSpan = visibleSpan;
                if (cell.rowspan && cell.rowspan > 1) th.rowSpan = cell.rowspan;
                th.textContent = (cell.value !== null && cell.value !== undefined) ? String(cell.value) : '';
                tr.appendChild(th);
            });

            thead.appendChild(tr);
        });

        return thead;
    }

    function buildScheduleBody(data, selections, product, hiddenSet) {
        hiddenSet = hiddenSet || {};
        var tbody = document.createElement('tbody');
        var allLetters = (data.scheduleHeader && data.scheduleHeader.columnLetters) || [];
        var colLetters = allLetters.filter(function (l) { return !hiddenSet[l]; });
        var colIndexMap = {}; // letter -> index in colLetters
        colLetters.forEach(function (l, i) { colIndexMap[l] = i; });

        selections.forEach(function (sel) {
            if (!sel.rows || !sel.rows.length) return;
            var layout = computeCellLayout(sel, colLetters, colIndexMap);

            sel.rows.forEach(function (row, rowIndex) {
                var tr = document.createElement('tr');
                if (rowIndex === 0) tr.className = 'selection-boundary';

                // Actions cell on first row of each selection; multi-row
                // selections use rowSpan to cover all their rows.
                if (rowIndex === 0) {
                    var td = document.createElement('td');
                    td.className = 'actions-cell';
                    if (sel.rows.length > 1) td.rowSpan = sel.rows.length;
                    td.appendChild(buildActionButtons(sel, product, data));
                    tr.appendChild(td);
                }

                colLetters.forEach(function (colLetter) {
                    var cell = layout[rowIndex][colLetter];
                    if (cell === null) return; // covered by rowSpan/colSpan from earlier
                    var td = document.createElement('td');
                    td.textContent = formatCellValue(cell.value, colLetter, product && product.productKey);
                    if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
                    if (cell.colSpan > 1) td.colSpan = cell.colSpan;
                    tr.appendChild(td);
                });

                tbody.appendChild(tr);
            });
        });

        return tbody;
    }

    /**
     * For a selection with N rows and M schedule columns, return a 2D map
     * layout[rowIndex][colLetter] describing what to render in each cell:
     *   - { value, rowSpan, colSpan }  render this cell
     *   - null                          covered by an earlier row/column's span
     *
     * Three span sources:
     *   1. Vertical spans for columns where only row 0 has a value and the
     *      selection has multiple rows (mini-split outdoor columns).
     *   2. Horizontal spans from sel.rows[i].scheduleCellSpans - a map of
     *      {colLetter: colspan} coming from the JSON (merged cells in the
     *      original Excel, such as the Voltage cell spanning J:L for
     *      "Indoor Powered From Outdoor Unit").
     *   3. Default: each cell spans 1x1.
     */
    function computeCellLayout(sel, colLetters, colIndexMap) {
        var numRows = sel.rows.length;
        var layout = [];
        for (var i = 0; i < numRows; i++) layout.push({});

        // Pass 1: vertical span detection (row 0 value, rest blank, N > 1)
        colLetters.forEach(function (colLetter) {
            var rowsWithValue = [];
            sel.rows.forEach(function (row, i) {
                var v = row.scheduleData ? row.scheduleData[colLetter] : undefined;
                if (v !== undefined) rowsWithValue.push(i);
            });

            if (rowsWithValue.length === 0) {
                for (var r = 0; r < numRows; r++) {
                    layout[r][colLetter] = { value: '', rowSpan: 1, colSpan: 1 };
                }
            } else if (rowsWithValue.length === 1 && rowsWithValue[0] === 0 && numRows > 1) {
                layout[0][colLetter] = {
                    value: sel.rows[0].scheduleData[colLetter],
                    rowSpan: numRows,
                    colSpan: 1
                };
                for (var r2 = 1; r2 < numRows; r2++) {
                    layout[r2][colLetter] = null;
                }
            } else {
                sel.rows.forEach(function (row, i) {
                    var v = row.scheduleData ? row.scheduleData[colLetter] : undefined;
                    layout[i][colLetter] = {
                        value: (v !== undefined ? v : ''),
                        rowSpan: 1,
                        colSpan: 1
                    };
                });
            }
        });

        // Pass 2: apply horizontal spans from scheduleCellSpans.
        sel.rows.forEach(function (row, rowIndex) {
            var spans = row.scheduleCellSpans;
            if (!spans) return;
            Object.keys(spans).forEach(function (startCol) {
                var colspan = parseInt(spans[startCol], 10);
                if (!colspan || colspan <= 1) return;
                var startIdx = colIndexMap[startCol];
                if (startIdx === undefined) return;

                var anchor = layout[rowIndex][startCol];
                if (anchor === null || anchor === undefined) return;

                anchor.colSpan = colspan;

                for (var k = 1; k < colspan; k++) {
                    var coveredIdx = startIdx + k;
                    if (coveredIdx >= colLetters.length) break;
                    var coveredLetter = colLetters[coveredIdx];
                    var rowsCovered = anchor.rowSpan || 1;
                    for (var rr = 0; rr < rowsCovered; rr++) {
                        if (layout[rowIndex + rr]) {
                            layout[rowIndex + rr][coveredLetter] = null;
                        }
                    }
                }
            });
        });

        return layout;
    }

    function formatCellValue(val, colLetter, productKey) {
        var ext = productKey && HHpro.ProductExtensions && HHpro.ProductExtensions[productKey];
        if (ext && typeof ext.formatScheduleCellValue === 'function') {
            var override = ext.formatScheduleCellValue(colLetter, val);
            if (override !== undefined) return override;
        }
        if (val === null || val === undefined) return '';
        return String(val);
    }

    // ---------------------------------------------------------------
    // Sticky header offsets
    // ---------------------------------------------------------------

    function applyStickyHeaderOffsets(table) {
        var thead = table && table.tHead;
        if (!thead || thead.rows.length === 0) return;

        // Drop every cell out of sticky mode so the thead snaps back to its
        // natural in-flow layout. Then read each row's actual top relative
        // to the thead -- the browser's own layout is the only source of
        // truth when rowspan>1 cells wrap to multiple lines.
        for (var i = 0; i < thead.rows.length; i++) {
            var tr = thead.rows[i];
            for (var j = 0; j < tr.cells.length; j++) {
                tr.cells[j].style.top = '';
            }
        }
        void thead.offsetHeight; // force sync layout in the natural state

        var headTop = thead.getBoundingClientRect().top;
        for (var i2 = 0; i2 < thead.rows.length; i2++) {
            var row = thead.rows[i2];
            // floor: rounding down by sub-pixel makes the next sticky row
            // overlap the previous by a fraction of a pixel rather than
            // leaving a gap that scrolling content can show through.
            var topPx = Math.floor(row.getBoundingClientRect().top - headTop) + 'px';
            for (var k = 0; k < row.cells.length; k++) {
                row.cells[k].style.top = topPx;
            }
        }
    }

    // ---------------------------------------------------------------
    // Per-row action buttons
    // ---------------------------------------------------------------

    function buildActionButtons(sel, product, data) {
        var row = document.createElement('div');
        row.className = 'actions-row';

        // ----- Select (add to cart / project) -----
        var selectBtn = document.createElement('button');
        selectBtn.type = 'button';
        selectBtn.className = 'action-btn action-btn-select';
        selectBtn.textContent = 'Select';
        selectBtn.addEventListener('click', function () {
            if (!HHpro.Cart || typeof HHpro.Cart.addItem !== 'function') return;
            // Compute a human-readable label for the cart now (so the cart
            // doesn't need access to product data later just to display items).
            var label = HHpro.Cart.computeLabel
                ? HHpro.Cart.computeLabel(product, sel, data)
                : sel.id;
            HHpro.Cart.addItem(product.productKey, sel.id, label);
        });

        // ----- Submittal (open PDF in new tab) -----
        var subBtn = document.createElement('button');
        subBtn.type = 'button';
        subBtn.className = 'action-btn action-btn-secondary';
        subBtn.textContent = 'Submittal';
        subBtn.addEventListener('click', function () {
            if (HHpro.Docs && typeof HHpro.Docs.openSubmittal === 'function') {
                HHpro.Docs.openSubmittal(product, sel, data);
            }
        });

        // ----- Docs (popup with all available documents) -----
        var docsBtn = document.createElement('button');
        docsBtn.type = 'button';
        docsBtn.className = 'action-btn action-btn-secondary';
        docsBtn.textContent = 'Docs';
        docsBtn.addEventListener('click', function () {
            if (HHpro.Docs && typeof HHpro.Docs.openDocsModal === 'function') {
                HHpro.Docs.openDocsModal(product, sel, data);
            }
        });

        row.appendChild(selectBtn);
        row.appendChild(subBtn);
        row.appendChild(docsBtn);
        return row;
    }
})();