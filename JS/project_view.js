/* ============================================================
   HHpro - View Project page
   ------------------------------------------------------------
   Shows the active project's contents: one tab per product type
   that has items (plus a "Files" tab), each tab rendering a
   mechanical schedule or a documents tree.

   Per-product-tab features:
     - Auto Tag button     : modal that assigns tags (AHU-1,
                             AHU-2, ...) to items in order
     - Columns button      : checkbox popover to hide/show
                             individual schedule data columns
                             (persisted to project's extra data)
     - Tag cell per row    : shows the assigned tag
     - Remove action       : deletes an item from the project/cart

   Files tab:
     - Left panel: unique doc types across all items with a
                   bulk-select checkbox each
     - Tree: products > items > files, each file checkable,
             defaults to everything selected
     - Download button: packages selected files into a ZIP named
                        "<Project Name> - HHpro - <Date>.zip"
                        (or "Cart - HHpro - <Date>.zip")
     - Missing files are skipped with a summary at the end

   Features still to come:
     - Schedule notes selection UI
     - Schedule export buttons (Excel / CAD / PDF)
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    // Which tab is active. Reset when the view is entered fresh.
    var activeTab = null;

    // Files tab state - persisted only within the view session.
    //   filesSelection: map of file keys to true for every checked file
    //   filesCache:     the resolved data we built on first load, kept
    //                   so switching tabs back is instant
    var filesSelection = null;
    var filesCache = null;

    HHpro.Views.project_view = {
        render: function (root) {
            if (HHpro.Cart && typeof HHpro.Cart.init === 'function') {
                HHpro.Cart.init();
            }

            root.innerHTML = '';
            root.appendChild(HHpro.UI.buildHeader(getActiveName()));

            var main = document.createElement('main');
            main.className = 'project-view-page';
            root.appendChild(main);

            var activeState = HHpro.Cart.getActiveState();

            if (!activeState.mode) {
                main.appendChild(buildNoProjectState());
                return;
            }

            main.appendChild(buildProjectHeader(activeState));

            if (!activeState.items.length) {
                main.appendChild(buildEmptyProjectState());
                return;
            }

            var groups = groupItemsByProduct(activeState.items);
            var productKeys = Object.keys(groups);

            if (activeTab !== 'files' && productKeys.indexOf(activeTab) < 0) {
                activeTab = productKeys[0];
            }

            main.appendChild(buildTabBar(productKeys, groups));
            var bodyContainer = document.createElement('div');
            bodyContainer.className = 'project-tab-body';
            main.appendChild(bodyContainer);

            renderActiveTab(bodyContainer, groups, activeState);
        }
    };

    // =================================================================
    // Page-level layout pieces
    // =================================================================

    function getActiveName() {
        var st = HHpro.Cart.getActiveState();
        return st.name || 'Project';
    }

    function buildNoProjectState() {
        var wrap = document.createElement('div');
        wrap.className = 'project-empty';

        var h = document.createElement('h1');
        h.className = 'project-empty-title';
        h.textContent = 'No active project';
        wrap.appendChild(h);

        var p = document.createElement('p');
        p.className = 'project-empty-hint';
        p.textContent = 'Open a project from the Projects page, or start selecting equipment to create a temporary cart.';
        wrap.appendChild(p);

        var actions = document.createElement('div');
        actions.className = 'project-empty-actions';

        var toProjects = document.createElement('button');
        toProjects.type = 'button';
        toProjects.className = 'projects-btn projects-btn-primary';
        toProjects.textContent = 'Go to Projects';
        toProjects.addEventListener('click', function () { HHpro.App.showView('projects'); });
        actions.appendChild(toProjects);

        var toMain = document.createElement('button');
        toMain.type = 'button';
        toMain.className = 'projects-btn projects-btn-secondary';
        toMain.appendChild(HHpro.UI.icon('arrow-left'));
        var toMainLabel = document.createElement('span');
        toMainLabel.textContent = 'Back to overview';
        toMain.appendChild(toMainLabel);
        toMain.addEventListener('click', function () { HHpro.App.showView('main'); });
        actions.appendChild(toMain);

        wrap.appendChild(actions);
        return wrap;
    }

    function buildEmptyProjectState() {
        var wrap = document.createElement('div');
        wrap.className = 'project-empty';

        var p = document.createElement('p');
        p.className = 'project-empty-hint';
        p.textContent = 'No items in this project yet. Pick a product type from the overview to start adding equipment.';
        wrap.appendChild(p);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'projects-btn projects-btn-primary';
        btn.textContent = 'Browse equipment';
        btn.addEventListener('click', function () { HHpro.App.showView('main'); });
        wrap.appendChild(btn);
        return wrap;
    }

    function buildProjectHeader(activeState) {
        var header = document.createElement('div');
        header.className = 'project-header';

        var left = document.createElement('div');

        var title = document.createElement('h1');
        title.className = 'project-title';
        title.textContent = activeState.name || 'Project';
        left.appendChild(title);

        var meta = document.createElement('p');
        meta.className = 'project-meta';
        var count = activeState.items.length;
        var modeLabel = activeState.mode === 'project' ? 'Project' : 'Temporary cart';
        meta.textContent = modeLabel + ' \u00b7 ' + count + ' item' + (count === 1 ? '' : 's');
        left.appendChild(meta);

        header.appendChild(left);

        // Right-side header buttons. In project mode we show both
        // "Exit Project" (detach the active context so the next item
        // selection prompts the first-select modal again) and
        // "All Projects" (navigate to the project list). In cart mode
        // just show a plain "Back" to main.
        var actionsRight = document.createElement('div');
        actionsRight.className = 'project-header-actions';

        if (activeState.mode === 'project') {
            var exitBtn = document.createElement('button');
            exitBtn.type = 'button';
            exitBtn.className = 'projects-btn projects-btn-secondary';
            exitBtn.textContent = 'Exit Project';
            exitBtn.title = 'Close this project without deleting it; you can reopen from Projects';
            exitBtn.addEventListener('click', function () {
                if (HHpro.Cart && typeof HHpro.Cart.exitProject === 'function') {
                    HHpro.Cart.exitProject();
                }
                HHpro.App.showView('main');
            });
            actionsRight.appendChild(exitBtn);
        }

        var back = document.createElement('button');
        back.type = 'button';
        back.className = 'projects-btn projects-btn-secondary';
        back.textContent = activeState.mode === 'project' ? 'All Projects' : 'Back';
        back.addEventListener('click', function () {
            if (activeState.mode === 'project') HHpro.App.showView('projects');
            else HHpro.App.showView('main');
        });
        actionsRight.appendChild(back);
        header.appendChild(actionsRight);

        return header;
    }

    function groupItemsByProduct(items) {
        var groups = {};
        var order = [];
        items.forEach(function (it) {
            if (!groups[it.productKey]) {
                groups[it.productKey] = [];
                order.push(it.productKey);
            }
            groups[it.productKey].push(it);
        });
        var ordered = {};
        order.forEach(function (k) { ordered[k] = groups[k]; });
        return ordered;
    }

    // =================================================================
    // Tab bar
    // =================================================================

    function buildTabBar(productKeys, groups) {
        var nav = document.createElement('nav');
        nav.className = 'project-tabs';

        productKeys.forEach(function (productKey) {
            var product = HHpro.Data.getProduct(productKey);
            var displayName = product ? product.displayName : productKey.toUpperCase();
            var count = groups[productKey].length;
            nav.appendChild(buildTabButton(
                productKey,
                displayName + ' (' + count + ')'
            ));
        });

        nav.appendChild(buildTabButton('files', 'Files'));
        return nav;
    }

    function buildTabButton(tabKey, label) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'project-tab' + (tabKey === activeTab ? ' project-tab-active' : '');
        btn.textContent = label;
        btn.addEventListener('click', function () {
            if (activeTab === tabKey) return;
            activeTab = tabKey;
            HHpro.App.showView('project_view');
        });
        return btn;
    }

    // =================================================================
    // Tab body dispatcher
    // =================================================================

    function renderActiveTab(container, groups, activeState) {
        container.innerHTML = '';
        if (activeTab === 'files') {
            renderFilesTab(container, activeState);
            return;
        }
        var items = groups[activeTab];
        if (!items) {
            activeTab = Object.keys(groups)[0] || 'files';
            renderActiveTab(container, groups, activeState);
            return;
        }

        var loading = document.createElement('div');
        loading.className = 'project-loading';
        loading.textContent = 'Loading...';
        container.appendChild(loading);

        HHpro.Data.loadProduct(activeTab)
            .then(function (data) {
                container.innerHTML = '';
                container.appendChild(buildProductTabBody(activeTab, items, data));
            })
            .catch(function (err) {
                container.innerHTML = '';
                var errEl = document.createElement('div');
                errEl.className = 'product-message error';
                errEl.textContent = 'Could not load product data: ' +
                    (err && err.message ? err.message : String(err));
                container.appendChild(errEl);
            });
    }

    // =================================================================
    // Product tab body: toolbar + schedule
    // =================================================================

    function buildProductTabBody(productKey, items, data) {
        var wrap = document.createElement('div');
        wrap.className = 'project-product-tab';

        wrap.appendChild(buildProductToolbar(productKey, items, data));

        var extra = HHpro.Cart.getProjectExtra(productKey) || {};
        var hidden = Array.isArray(extra.hiddenColumns) ? extra.hiddenColumns.slice() : [];

        wrap.appendChild(buildProjectSchedule(productKey, items, data, hidden));
        wrap.appendChild(buildScheduleNotesSection(productKey, data));

        return wrap;
    }

    function buildProductToolbar(productKey, items, data) {
        var bar = document.createElement('div');
        bar.className = 'project-toolbar';

        var autoTagBtn = document.createElement('button');
        autoTagBtn.type = 'button';
        autoTagBtn.className = 'projects-btn projects-btn-primary';
        autoTagBtn.textContent = 'Auto Tag';
        autoTagBtn.addEventListener('click', function () {
            openAutoTagModal(productKey, items, data);
        });
        bar.appendChild(autoTagBtn);

        var colsBtn = document.createElement('button');
        colsBtn.type = 'button';
        colsBtn.className = 'projects-btn projects-btn-secondary';
        colsBtn.textContent = 'Add / Remove Columns';
        colsBtn.addEventListener('click', function () {
            openColumnsModal(productKey, data);
        });
        bar.appendChild(colsBtn);

        // Excel / CAD / PDF export buttons. Excel and PDF route through
        // HHpro.Export (new module); CAD stays disabled until we have
        // the schedule-to-DXF pipeline worked out.
        var activeState = HHpro.Cart.getActiveState ? HHpro.Cart.getActiveState() : {};
        var projectName = activeState.name || '';

        var excelBtn = document.createElement('button');
        excelBtn.type = 'button';
        excelBtn.className = 'projects-btn projects-btn-secondary';
        excelBtn.textContent = 'Excel';
        excelBtn.addEventListener('click', function () {
            if (HHpro.Export && typeof HHpro.Export.toExcel === 'function') {
                HHpro.Export.toExcel(productKey, items, data, projectName);
            }
        });
        bar.appendChild(excelBtn);

        var cadBtn = document.createElement('button');
        cadBtn.type = 'button';
        cadBtn.className = 'projects-btn projects-btn-secondary';
        cadBtn.textContent = 'CAD';
        cadBtn.disabled = true;
        cadBtn.title = 'CAD export coming in a later step';
        bar.appendChild(cadBtn);

        var pdfBtn = document.createElement('button');
        pdfBtn.type = 'button';
        pdfBtn.className = 'projects-btn projects-btn-secondary';
        pdfBtn.textContent = 'PDF';
        pdfBtn.addEventListener('click', function () {
            if (HHpro.Export && typeof HHpro.Export.toPDF === 'function') {
                HHpro.Export.toPDF(productKey, items, data, projectName);
            }
        });
        bar.appendChild(pdfBtn);

        return bar;
    }

    // =================================================================
    // Project-schedule table rendering
    // =================================================================

    function buildProjectSchedule(productKey, items, data, hiddenColumns) {
        var wrap = document.createElement('div');
        wrap.className = 'schedule-wrap project-schedule-wrap';

        var selections = resolveSelections(items, data);
        if (!selections.length) {
            var msg = document.createElement('div');
            msg.className = 'zero-results';
            msg.textContent = 'No schedule data found for the items in this tab.';
            wrap.appendChild(msg);
            return wrap;
        }

        var colLetters = (data.scheduleHeader && data.scheduleHeader.columnLetters) || [];
        var hiddenSet = {};
        hiddenColumns.forEach(function (l) { hiddenSet[l] = true; });
        var visibleLetters = colLetters.filter(function (l) { return !hiddenSet[l]; });

        var table = document.createElement('table');
        table.className = 'schedule-table project-schedule-table';
        if (hasIndoorTagColumn(productKey)) {
            table.classList.add('schedule-has-indoor-tag');
        }
        table.appendChild(buildProjectScheduleHead(productKey, data, visibleLetters));
        table.appendChild(buildProjectScheduleBody(productKey, selections, visibleLetters, data));
        wrap.appendChild(table);

        setTimeout(function () { applyStickyHeaderOffsets(table); }, 0);
        // Belt-and-suspenders re-runs after layout/fonts settle, plus a
        // ResizeObserver as a safety net for any dynamic size change that
        // would otherwise drift the offsets. See base.js refreshSchedule
        // for the full rationale.
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

        return wrap;
    }

    function resolveSelections(items, data) {
        var byId = {};
        (data.selections || []).forEach(function (sel) { byId[sel.id] = sel; });
        var out = [];
        items.forEach(function (item) {
            var sel = byId[item.selectionId];
            if (!sel) {
                console.warn('Selection not found:', item.selectionId);
                return;
            }
            out.push({ item: item, selection: sel });
        });
        return out;
    }

    /** Look up a single selection in the product JSON by id. Returns
     *  null if the selection doesn't exist (e.g. the JSON was
     *  regenerated and ids changed). */
    function findSelectionById(data, selectionId) {
        if (!data || !Array.isArray(data.selections)) return null;
        for (var i = 0; i < data.selections.length; i++) {
            if (data.selections[i].id === selectionId) return data.selections[i];
        }
        return null;
    }

    function buildProjectScheduleHead(productKey, data, visibleLetters) {
        var thead = document.createElement('thead');
        var rows = (data.scheduleHeader && data.scheduleHeader.rows) || [];

        var startIdx = 0;
        if (rows.length > 1 && rows[0].length === 1 && rows[0][0].value === data.scheduleTitle) {
            startIdx = 1;
        }
        var displayRows = rows.slice(startIdx);
        var visibleSet = {};
        visibleLetters.forEach(function (l) { visibleSet[l] = true; });
        var allLetters = (data.scheduleHeader && data.scheduleHeader.columnLetters) || [];

        displayRows.forEach(function (row, rowIndex) {
            var tr = document.createElement('tr');

            // LEFT-SIDE sticky columns: Remove, then primary Tag, then
            // Serves (when applicable), then Indoor Tag (when applicable).
            // All span every header row.
            if (rowIndex === 0) {
                var actionsTh = document.createElement('th');
                actionsTh.className = 'project-sched-rm-head';
                actionsTh.rowSpan = displayRows.length;
                actionsTh.textContent = '';
                tr.appendChild(actionsTh);

                var tagTh = document.createElement('th');
                tagTh.className = 'project-sched-tag-head';
                tagTh.rowSpan = displayRows.length;
                tagTh.textContent = getPrimaryTagLabel(productKey);
                tr.appendChild(tagTh);

                if (hasServesColumn(productKey)) {
                    var servesTh = document.createElement('th');
                    servesTh.className = 'project-sched-serves-head';
                    servesTh.rowSpan = displayRows.length;
                    servesTh.textContent = 'Serves';
                    tr.appendChild(servesTh);
                }

                if (hasIndoorTagColumn(productKey)) {
                    var indoorTh = document.createElement('th');
                    indoorTh.className = 'project-sched-indoor-tag-head';
                    indoorTh.rowSpan = displayRows.length;
                    indoorTh.textContent = 'Indoor Tag';
                    tr.appendChild(indoorTh);
                }
            }

            row.forEach(function (cell) {
                var startCol = allLetters.indexOf(cell.col);
                if (startCol < 0) return;
                var origColspan = cell.colspan || 1;
                var visibleSpan = 0;
                for (var i = 0; i < origColspan; i++) {
                    if (visibleSet[allLetters[startCol + i]]) visibleSpan++;
                }
                if (visibleSpan === 0) return;

                var th = document.createElement('th');
                if (visibleSpan > 1) th.colSpan = visibleSpan;
                if (cell.rowspan && cell.rowspan > 1) th.rowSpan = cell.rowspan;
                th.textContent = (cell.value !== null && cell.value !== undefined)
                    ? String(cell.value) : '';
                tr.appendChild(th);
            });

            // RIGHT-SIDE columns: Configuration (Marvair only) and then
            // Accessories (unless the product opts out). Both span the
            // full header height.
            if (rowIndex === 0) {
                if (hasConfigurationColumn(productKey)) {
                    var cfgTh = document.createElement('th');
                    cfgTh.className = 'project-sched-config-head';
                    cfgTh.rowSpan = displayRows.length;
                    cfgTh.textContent = 'Configuration';
                    tr.appendChild(cfgTh);
                }

                if (hasAccessoriesColumn(productKey)) {
                    var accTh = document.createElement('th');
                    accTh.className = 'project-sched-acc-head';
                    accTh.rowSpan = displayRows.length;
                    accTh.textContent = 'Accessories';
                    tr.appendChild(accTh);
                }
            }

            thead.appendChild(tr);
        });

        return thead;
    }

    function buildProjectScheduleBody(productKey, selections, visibleLetters, data) {
        var tbody = document.createElement('tbody');

        selections.forEach(function (entry) {
            var item = entry.item;
            var sel = entry.selection;
            var numRows = sel.rows.length;
            var layout = computeCellLayout(sel, visibleLetters);

            sel.rows.forEach(function (row, rowIndex) {
                var tr = document.createElement('tr');
                if (rowIndex === 0) tr.className = 'selection-boundary';

                // LEFT-SIDE columns: Actions (X + Docs) + Tag (both
                // span every row of a multi-row selection, rendered
                // only on the first row).
                if (rowIndex === 0) {
                    var actionsTd = document.createElement('td');
                    actionsTd.className = 'project-sched-rm-cell';
                    if (numRows > 1) actionsTd.rowSpan = numRows;

                    var actionsWrap = document.createElement('div');
                    actionsWrap.className = 'project-sched-actions';

                    var rmBtn = document.createElement('button');
                    rmBtn.type = 'button';
                    rmBtn.className = 'project-sched-rm-btn';
                    rmBtn.setAttribute('aria-label', 'Remove item');
                    rmBtn.title = 'Remove from project';
                    rmBtn.innerHTML = '&times;';
                    rmBtn.addEventListener('click', function () {
                        HHpro.Cart.removeItem(item.instanceId);
                        filesCache = null;
                        filesSelection = null;
                        HHpro.App.showView('project_view');
                    });
                    actionsWrap.appendChild(rmBtn);

                    // Docs button - opens the same per-selection docs
                    // popup the main product pages use, so people can
                    // grab a submittal/install/etc. for an item that's
                    // already in the schedule without navigating away.
                    var docsBtn = document.createElement('button');
                    docsBtn.type = 'button';
                    docsBtn.className = 'project-sched-docs-btn';
                    docsBtn.textContent = 'Docs';
                    docsBtn.title = 'Documents for this item';
                    docsBtn.addEventListener('click', function () {
                        if (HHpro.Docs && typeof HHpro.Docs.openDocsModal === 'function') {
                            var product = HHpro.Data.getProduct(productKey);
                            HHpro.Docs.openDocsModal(product, sel, data);
                        }
                    });
                    actionsWrap.appendChild(docsBtn);

                    actionsTd.appendChild(actionsWrap);
                    tr.appendChild(actionsTd);

                    tr.appendChild(buildTagCell(item, numRows, productKey));

                    // Serves cell (VFDs and any other product flagged
                    // with hasServesColumn in data.js). Spans all rows
                    // of a multi-row selection.
                    if (hasServesColumn(productKey)) {
                        tr.appendChild(buildServesCell(item, numRows));
                    }
                }

                // Indoor Tag cell: appears on EVERY row (per indoor unit)
                // for products that have an indoor tag column.
                if (hasIndoorTagColumn(productKey)) {
                    tr.appendChild(buildIndoorTagCell(item, rowIndex));
                }

                // Schedule data cells
                visibleLetters.forEach(function (colLetter) {
                    var cell = layout[rowIndex][colLetter];
                    if (cell === null) return;
                    var td = document.createElement('td');
                    td.textContent = formatCellValue(cell.value);
                    if (cell.rowSpan > 1) td.rowSpan = cell.rowSpan;
                    if (cell.colSpan > 1) td.colSpan = cell.colSpan;
                    tr.appendChild(td);
                });

                // RIGHT-SIDE columns: Configuration (Marvair) + Accessories,
                // both spanning every row of a multi-row selection.
                // Accessories can be opted out via data.js flag.
                if (rowIndex === 0) {
                    if (hasConfigurationColumn(productKey)) {
                        tr.appendChild(buildConfigCell(item, data, numRows));
                    }
                    if (hasAccessoriesColumn(productKey)) {
                        tr.appendChild(buildAccessoriesCell(item, numRows));
                    }
                }

                tbody.appendChild(tr);
            });
        });

        return tbody;
    }

    // =================================================================
    // Editable cell builders
    // -----------------------------------------------------------------
    // The Tag, Indoor Tag, Configuration, and Accessories columns are
    // all user-editable. Changes save to the cart state on blur (or on
    // Enter key). These cells look like plain table cells at rest and
    // get a visible border/background on hover or focus.
    // =================================================================

    function buildTagCell(item, numRows, productKey) {
        var td = document.createElement('td');
        td.className = 'project-sched-tag-cell';
        if (numRows > 1) td.rowSpan = numRows;
        td.appendChild(makeScheduleTextInput({
            value: item.tag || '',
            placeholder: getPrimaryTagLabel(productKey),
            onSave: function (val) {
                HHpro.Cart.updateItem(item.instanceId, { tag: val });
            }
        }));
        return td;
    }

    /**
     * Serves column cell - free-text input for "what this item serves"
     * (typically a space / zone / equipment tag the VFD drives).
     * Appears between Tag and Indoor Tag on products flagged with
     * hasServesColumn in data.js. Spans every row of a multi-row
     * selection, same as the primary Tag cell.
     */
    function buildServesCell(item, numRows) {
        var td = document.createElement('td');
        td.className = 'project-sched-serves-cell';
        if (numRows > 1) td.rowSpan = numRows;
        td.appendChild(makeScheduleTextInput({
            value: item.serves || '',
            placeholder: 'Serves',
            onSave: function (val) {
                HHpro.Cart.updateItem(item.instanceId, { serves: val });
            }
        }));
        return td;
    }

    function buildIndoorTagCell(item, rowIndex) {
        var td = document.createElement('td');
        td.className = 'project-sched-indoor-tag-cell';
        td.appendChild(makeScheduleTextInput({
            value: getIndoorTag(item, rowIndex),
            placeholder: 'Indoor Tag',
            onSave: function (val) { setIndoorTag(item, rowIndex, val); }
        }));
        return td;
    }

    function buildAccessoriesCell(item, numRows) {
        var td = document.createElement('td');
        td.className = 'project-sched-acc-cell';
        if (numRows > 1) td.rowSpan = numRows;
        td.appendChild(makeScheduleTextInput({
            value: item.accessories || '',
            placeholder: 'Accessories',
            onSave: function (val) {
                HHpro.Cart.updateItem(item.instanceId, { accessories: val });
            }
        }));
        return td;
    }

    /**
     * Marvair CONFIGURATION cell. If the product's schedule notes are in
     * Marvair format we render a <select> with the configuration options
     * straight from the Excel data; otherwise we fall back to a plain
     * text input so the cell is still editable even for projects with
     * older (pre-regenerated) JSON files.
     */
    function buildConfigCell(item, data, numRows) {
        var td = document.createElement('td');
        td.className = 'project-sched-config-cell';
        if (numRows > 1) td.rowSpan = numRows;

        var options = (data && data.scheduleNotes &&
                       data.scheduleNotes.format === 'marvair')
            ? (data.scheduleNotes.configuration || [])
            : [];

        if (options.length > 0) {
            var sel = document.createElement('select');
            sel.className = 'project-sched-input project-sched-select';
            var empty = document.createElement('option');
            empty.value = '';
            empty.textContent = '\u2014';   // em-dash for "not set"
            sel.appendChild(empty);
            options.forEach(function (opt) {
                var o = document.createElement('option');
                o.value = opt;
                o.textContent = opt;
                sel.appendChild(o);
            });
            sel.value = item.configuration || '';
            sel.addEventListener('change', function () {
                HHpro.Cart.updateItem(item.instanceId, {
                    configuration: sel.value
                });
            });
            td.appendChild(sel);
        } else {
            td.appendChild(makeScheduleTextInput({
                value: item.configuration || '',
                placeholder: 'Configuration',
                onSave: function (val) {
                    HHpro.Cart.updateItem(item.instanceId, {
                        configuration: val
                    });
                }
            }));
        }
        return td;
    }

    /**
     * Build an editable text input styled for use inside a schedule cell.
     * opts = { value, placeholder, onSave: function(value){} }
     *
     * Saves on blur AND on Enter key. Pressing Enter also blurs the
     * field so the user gets confirming visual feedback.
     */
    function makeScheduleTextInput(opts) {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'project-sched-input';
        input.value = opts.value || '';
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.addEventListener('blur', function () {
            if (typeof opts.onSave === 'function') opts.onSave(input.value);
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
        });
        return input;
    }

    // =================================================================
    // Indoor tags helpers (works for Mini Splits + Multi Position Splits)
    // =================================================================

    function getIndoorTag(item, rowIndex) {
        if (!item || !Array.isArray(item.indoorTags)) return '';
        return item.indoorTags[rowIndex] || '';
    }

    function setIndoorTag(item, rowIndex, value) {
        var tags = Array.isArray(item.indoorTags)
            ? item.indoorTags.slice() : [];
        while (tags.length <= rowIndex) tags.push('');
        tags[rowIndex] = value;
        HHpro.Cart.updateItem(item.instanceId, { indoorTags: tags });
    }

    // =================================================================
    // Product-type predicates for column rendering
    // =================================================================

    function hasIndoorTagColumn(productKey) {
        return productKey === 'mini_splits' ||
               productKey === 'multi_position_splits';
    }

    function hasConfigurationColumn(productKey) {
        return productKey === 'marvair';
    }

    /**
     * True if the product should render a manual-input "Serves" column
     * immediately to the right of the primary Tag column in the project
     * schedule creator (and in Excel/PDF export). Driven by the
     * hasServesColumn flag in data.js.
     */
    function hasServesColumn(productKey) {
        var product = HHpro.Data && HHpro.Data.getProduct
            ? HHpro.Data.getProduct(productKey)
            : null;
        return !!(product && product.hasServesColumn);
    }

    /**
     * True if the product should render the free-text "Accessories"
     * column at the right end of the schedule. Default is true; a
     * product can opt out by setting hideAccessoriesColumn in data.js.
     */
    function hasAccessoriesColumn(productKey) {
        var product = HHpro.Data && HHpro.Data.getProduct
            ? HHpro.Data.getProduct(productKey)
            : null;
        return !(product && product.hideAccessoriesColumn);
    }

    function getPrimaryTagLabel(productKey) {
        return (productKey === 'mini_splits' ||
                productKey === 'multi_position_splits')
            ? 'Outdoor Tag' : 'Tag';
    }

    function computeCellLayout(sel, visibleLetters) {
        var numRows = sel.rows.length;
        var layout = [];
        for (var i = 0; i < numRows; i++) layout.push({});

        visibleLetters.forEach(function (colLetter) {
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

        var visibleIdx = {};
        visibleLetters.forEach(function (l, i) { visibleIdx[l] = i; });

        sel.rows.forEach(function (row, rowIndex) {
            var spans = row.scheduleCellSpans;
            if (!spans) return;
            Object.keys(spans).forEach(function (startCol) {
                var colspan = parseInt(spans[startCol], 10);
                if (!colspan || colspan <= 1) return;
                if (!visibleIdx.hasOwnProperty(startCol)) return;
                var anchor = layout[rowIndex][startCol];
                if (anchor === null || anchor === undefined) return;

                var startVisibleIdx = visibleIdx[startCol];
                var reach = 1;
                for (var k = 1; k < colspan; k++) {
                    var nextVisibleLetter = visibleLetters[startVisibleIdx + k];
                    if (!nextVisibleLetter) break;
                    reach++;
                }
                if (reach <= 1) return;
                anchor.colSpan = reach;

                for (var j = 1; j < reach; j++) {
                    var coveredLetter = visibleLetters[startVisibleIdx + j];
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

    function formatCellValue(val) {
        if (val === null || val === undefined) return '';
        return String(val);
    }

    function applyStickyHeaderOffsets(table) {
        var thead = table && table.tHead;
        if (!thead || thead.rows.length === 0) return;

        // See base.js applyStickyHeaderOffsets for the rationale. Briefly:
        // clear every cell's top so the thead falls out of sticky mode,
        // measure each row's natural top, then reapply correct offsets.
        for (var i = 0; i < thead.rows.length; i++) {
            var tr = thead.rows[i];
            for (var j = 0; j < tr.cells.length; j++) {
                tr.cells[j].style.top = '';
            }
        }
        void thead.offsetHeight;

        var headTop = thead.getBoundingClientRect().top;
        for (var i2 = 0; i2 < thead.rows.length; i2++) {
            var row = thead.rows[i2];
            var topPx = Math.floor(row.getBoundingClientRect().top - headTop) + 'px';
            for (var k = 0; k < row.cells.length; k++) {
                row.cells[k].style.top = topPx;
            }
        }
    }

    // =================================================================
    // Auto Tag modal
    // =================================================================

    function openAutoTagModal(productKey, items, data) {
        var extra = HHpro.Cart.getProjectExtra(productKey) || {};
        var last = extra.lastAutoTag || {};
        var defaultPrefix = last.prefix !== undefined ? last.prefix : defaultPrefixFor(productKey);
        var defaultStart = last.start !== undefined ? last.start : 1;

        var supportsIndoor = hasIndoorTagColumn(productKey);
        var defaultIndoorPrefix = last.indoorPrefix !== undefined
            ? last.indoorPrefix
            : (defaultIndoorPrefixFor(productKey) || '');
        var defaultIndoorStart = last.indoorStart !== undefined ? last.indoorStart : 1;

        var backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) close();
        });

        var modal = document.createElement('div');
        modal.className = 'modal';

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = 'Auto Tag items';

        var desc = document.createElement('p');
        desc.className = 'modal-desc';
        desc.textContent = 'Assigns tags to all ' + items.length + ' item' +
            (items.length === 1 ? '' : 's') + ' in this schedule, in their current order. Existing tags will be overwritten.';

        var form = document.createElement('div');
        form.className = 'autotag-form';

        // --- Outdoor / primary tag inputs ----------------------------
        var outdoorSection = document.createElement('div');
        outdoorSection.className = 'autotag-section';
        if (supportsIndoor) {
            var outdoorHeader = document.createElement('div');
            outdoorHeader.className = 'autotag-section-header';
            outdoorHeader.textContent = 'Outdoor Tag';
            outdoorSection.appendChild(outdoorHeader);
        }

        var prefixRow = document.createElement('div');
        prefixRow.className = 'autotag-row';
        var prefixLabel = document.createElement('label');
        prefixLabel.className = 'autotag-label';
        prefixLabel.textContent = 'Prefix';
        var prefixInput = document.createElement('input');
        prefixInput.type = 'text';
        prefixInput.className = 'modal-input';
        prefixInput.placeholder = 'e.g. ' + defaultPrefixFor(productKey);
        prefixInput.value = defaultPrefix;
        prefixInput.maxLength = 20;
        prefixRow.appendChild(prefixLabel);
        prefixRow.appendChild(prefixInput);
        outdoorSection.appendChild(prefixRow);

        var startRow = document.createElement('div');
        startRow.className = 'autotag-row';
        var startLabel = document.createElement('label');
        startLabel.className = 'autotag-label';
        startLabel.textContent = 'Start at';
        var startInput = document.createElement('input');
        startInput.type = 'number';
        startInput.className = 'modal-input';
        startInput.min = '0';
        startInput.value = String(defaultStart);
        startRow.appendChild(startLabel);
        startRow.appendChild(startInput);
        outdoorSection.appendChild(startRow);

        form.appendChild(outdoorSection);

        // --- Indoor tag inputs (Mini Splits & Multi Position Splits) --
        var indoorPrefixInput = null;
        var indoorStartInput = null;
        if (supportsIndoor) {
            var indoorSection = document.createElement('div');
            indoorSection.className = 'autotag-section';

            var indoorHeader = document.createElement('div');
            indoorHeader.className = 'autotag-section-header';
            indoorHeader.textContent = 'Indoor Tag';
            indoorSection.appendChild(indoorHeader);

            var iPrefixRow = document.createElement('div');
            iPrefixRow.className = 'autotag-row';
            var iPrefixLabel = document.createElement('label');
            iPrefixLabel.className = 'autotag-label';
            iPrefixLabel.textContent = 'Prefix';
            indoorPrefixInput = document.createElement('input');
            indoorPrefixInput.type = 'text';
            indoorPrefixInput.className = 'modal-input';
            indoorPrefixInput.placeholder = 'e.g. ' + (defaultIndoorPrefixFor(productKey) || '');
            indoorPrefixInput.value = defaultIndoorPrefix;
            indoorPrefixInput.maxLength = 20;
            iPrefixRow.appendChild(iPrefixLabel);
            iPrefixRow.appendChild(indoorPrefixInput);
            indoorSection.appendChild(iPrefixRow);

            var iStartRow = document.createElement('div');
            iStartRow.className = 'autotag-row';
            var iStartLabel = document.createElement('label');
            iStartLabel.className = 'autotag-label';
            iStartLabel.textContent = 'Start at';
            indoorStartInput = document.createElement('input');
            indoorStartInput.type = 'number';
            indoorStartInput.className = 'modal-input';
            indoorStartInput.min = '0';
            indoorStartInput.value = String(defaultIndoorStart);
            iStartRow.appendChild(iStartLabel);
            iStartRow.appendChild(indoorStartInput);
            indoorSection.appendChild(iStartRow);

            form.appendChild(indoorSection);
        }

        // --- Preview ------------------------------------------------
        var preview = document.createElement('div');
        preview.className = 'autotag-preview';

        var updatePreview = function () {
            var p = prefixInput.value;
            var n = parseInt(startInput.value, 10);
            if (isNaN(n)) n = 1;
            var firstTag = p + n;
            var lastTag = p + (n + items.length - 1);
            var outdoorText = items.length === 1
                ? 'Outdoor: ' + firstTag
                : 'Outdoor: ' + firstTag + ' \u2026 ' + lastTag;

            preview.innerHTML = '';
            var line1 = document.createElement('div');
            line1.textContent = outdoorText;
            preview.appendChild(line1);

            if (supportsIndoor && indoorPrefixInput && indoorStartInput) {
                // Count total sub-rows across all items to know the
                // ending indoor tag.
                var ip = indoorPrefixInput.value;
                var iStart = parseInt(indoorStartInput.value, 10);
                if (isNaN(iStart)) iStart = 1;
                var totalSubRows = 0;
                items.forEach(function (it) {
                    var s = findSelectionById(data, it.selectionId);
                    totalSubRows += (s && s.rows) ? s.rows.length : 1;
                });
                var iFirst = ip + iStart;
                var iLast  = ip + (iStart + totalSubRows - 1);
                var indoorText = totalSubRows === 1
                    ? 'Indoor: ' + iFirst
                    : 'Indoor: ' + iFirst + ' \u2026 ' + iLast;
                var line2 = document.createElement('div');
                line2.textContent = indoorText;
                preview.appendChild(line2);
            }
        };
        prefixInput.addEventListener('input', updatePreview);
        startInput.addEventListener('input', updatePreview);
        if (indoorPrefixInput) indoorPrefixInput.addEventListener('input', updatePreview);
        if (indoorStartInput)  indoorStartInput.addEventListener('input', updatePreview);
        updatePreview();

        form.appendChild(preview);

        // --- Buttons ------------------------------------------------
        var actions = document.createElement('div');
        actions.className = 'modal-actions';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'modal-btn modal-btn-secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', close);

        var applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'modal-btn modal-btn-primary';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', function () {
            var outdoor = {
                prefix: prefixInput.value,
                start: parseInt(startInput.value, 10)
            };
            if (isNaN(outdoor.start)) outdoor.start = 1;

            var indoor = null;
            if (supportsIndoor && indoorPrefixInput && indoorStartInput) {
                indoor = {
                    prefix: indoorPrefixInput.value,
                    start: parseInt(indoorStartInput.value, 10)
                };
                if (isNaN(indoor.start)) indoor.start = 1;
            }

            applyAutoTag(productKey, items, outdoor, indoor, data);
            close();
            HHpro.App.showView('project_view');
        });

        // Enter = apply, Esc = close - works from any input
        [prefixInput, startInput, indoorPrefixInput, indoorStartInput].forEach(function (el) {
            if (!el) return;
            el.addEventListener('keydown', function (e) {
                if (e.key === 'Enter') { e.preventDefault(); applyBtn.click(); }
                else if (e.key === 'Escape') { e.preventDefault(); close(); }
            });
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(applyBtn);

        modal.appendChild(title);
        modal.appendChild(desc);
        modal.appendChild(form);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        setTimeout(function () { prefixInput.focus(); prefixInput.select(); }, 0);

        function close() {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
    }

    /** Default outdoor/primary tag prefix for each product. */
    function defaultPrefixFor(productKey) {
        // Per-product override from data.js (e.g. VFDs use 'VFD-').
        var product = HHpro.Data && HHpro.Data.getProduct
            ? HHpro.Data.getProduct(productKey)
            : null;
        if (product && product.autoTagPrefix) {
            return product.autoTagPrefix;
        }
        switch (productKey) {
            case 'gas_packs':              return 'RTU-';
            case 'marvair':                return 'AC-';
            case 'mini_splits':            return 'ODU-';
            case 'multi_position_splits':  return 'CU-';
            default:                       return 'EQ-';
        }
    }

    /**
     * Default Indoor Tag prefix. Only the split-system products have
     * an Indoor Tag column; everything else returns null so the
     * Auto Tag modal can decide whether to show the indoor-tag row.
     */
    function defaultIndoorPrefixFor(productKey) {
        switch (productKey) {
            case 'mini_splits':            return 'IDU-';
            case 'multi_position_splits':  return 'AHU-';
            default:                       return null;
        }
    }

    /**
     * Apply Auto Tag to every item in the product tab.
     *
     * `outdoor` is the per-item outdoor/primary tag (prefix + running
     * number per item). `indoor` is optional - when provided, every
     * SUB-ROW of every item also gets an indoor tag, with the running
     * number walked globally across all items (so a 1-indoor MS-1
     * plus a 3-indoor MS-2 yields IDU-1, IDU-2, IDU-3, IDU-4).
     */
    function applyAutoTag(productKey, items, outdoor, indoor, data) {
        var outdoorNum = outdoor.start;
        var indoorNum = indoor ? indoor.start : null;

        items.forEach(function (it) {
            var patch = { tag: outdoor.prefix + outdoorNum };
            outdoorNum++;

            if (indoor) {
                var sel = findSelectionById(data, it.selectionId);
                var numRows = (sel && Array.isArray(sel.rows)) ? sel.rows.length : 1;
                var tags = [];
                for (var i = 0; i < numRows; i++) {
                    tags.push(indoor.prefix + indoorNum);
                    indoorNum++;
                }
                patch.indoorTags = tags;
            }

            HHpro.Cart.updateItem(it.instanceId, patch);
        });

        var saved = { prefix: outdoor.prefix, start: outdoor.start };
        if (indoor) {
            saved.indoorPrefix = indoor.prefix;
            saved.indoorStart = indoor.start;
        }
        HHpro.Cart.setProjectExtra(productKey, { lastAutoTag: saved });
    }

    // =================================================================
    // Add/Remove Columns modal
    // =================================================================

    function openColumnsModal(productKey, data) {
        var colLetters = (data.scheduleHeader && data.scheduleHeader.columnLetters) || [];
        var names = getLeafColumnNames(data);
        var extra = HHpro.Cart.getProjectExtra(productKey) || {};
        var hiddenSet = {};
        (extra.hiddenColumns || []).forEach(function (l) { hiddenSet[l] = true; });

        var backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) close();
        });

        var modal = document.createElement('div');
        modal.className = 'modal columns-modal';

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = 'Show / Hide columns';

        var desc = document.createElement('p');
        desc.className = 'modal-desc';
        desc.textContent = 'Check a column to include it in this schedule; uncheck to hide it. These settings are saved per project.';

        var buttonRow = document.createElement('div');
        buttonRow.className = 'columns-bulk';
        var showAllBtn = document.createElement('button');
        showAllBtn.type = 'button';
        showAllBtn.className = 'projects-btn projects-btn-secondary';
        showAllBtn.textContent = 'Show all';
        var hideAllBtn = document.createElement('button');
        hideAllBtn.type = 'button';
        hideAllBtn.className = 'projects-btn projects-btn-secondary';
        hideAllBtn.textContent = 'Hide all';
        buttonRow.appendChild(showAllBtn);
        buttonRow.appendChild(hideAllBtn);

        var list = document.createElement('div');
        list.className = 'columns-list';

        var checkboxes = [];
        colLetters.forEach(function (letter) {
            var row = document.createElement('label');
            row.className = 'columns-row';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = !hiddenSet[letter];
            cb.dataset.letter = letter;
            checkboxes.push(cb);

            var text = document.createElement('span');
            text.className = 'columns-row-label';
            text.textContent = names[letter] || letter;

            row.appendChild(cb);
            row.appendChild(text);
            list.appendChild(row);
        });

        showAllBtn.addEventListener('click', function () {
            checkboxes.forEach(function (cb) { cb.checked = true; });
        });
        hideAllBtn.addEventListener('click', function () {
            checkboxes.forEach(function (cb) { cb.checked = false; });
        });

        var actions = document.createElement('div');
        actions.className = 'modal-actions';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'modal-btn modal-btn-secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.addEventListener('click', close);

        var applyBtn = document.createElement('button');
        applyBtn.type = 'button';
        applyBtn.className = 'modal-btn modal-btn-primary';
        applyBtn.textContent = 'Apply';
        applyBtn.addEventListener('click', function () {
            var hidden = [];
            checkboxes.forEach(function (cb) {
                if (!cb.checked) hidden.push(cb.dataset.letter);
            });
            HHpro.Cart.setProjectExtra(productKey, { hiddenColumns: hidden });
            close();
            HHpro.App.showView('project_view');
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(applyBtn);

        modal.appendChild(title);
        modal.appendChild(desc);
        modal.appendChild(buttonRow);
        modal.appendChild(list);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        function close() {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
    }

    function getLeafColumnNames(data) {
        var colLetters = (data.scheduleHeader && data.scheduleHeader.columnLetters) || [];
        var rows = (data.scheduleHeader && data.scheduleHeader.rows) || [];
        var names = {};
        colLetters.forEach(function (l) { names[l] = l; });

        rows.forEach(function (row) {
            row.forEach(function (cell) {
                var startIdx = colLetters.indexOf(cell.col);
                if (startIdx < 0) return;
                var span = cell.colspan || 1;
                var value = (cell.value !== null && cell.value !== undefined)
                    ? String(cell.value) : '';
                if (!value) return;
                for (var i = 0; i < span; i++) {
                    var letter = colLetters[startIdx + i];
                    if (letter !== undefined) names[letter] = value;
                }
            });
        });
        return names;
    }

    // =================================================================
    // Files tab
    // =================================================================

    function renderFilesTab(container, activeState) {
        var loading = document.createElement('div');
        loading.className = 'project-loading';
        loading.textContent = 'Loading documents...';
        container.appendChild(loading);

        gatherFilesData(activeState.items)
            .then(function (filesData) {
                container.innerHTML = '';
                if (!filesCache || filesCache.signature !== filesData.signature) {
                    filesCache = filesData;
                    filesSelection = buildDefaultSelection(filesData);
                }
                container.appendChild(buildFilesTabBody(filesData, activeState));
            })
            .catch(function (err) {
                container.innerHTML = '';
                var errEl = document.createElement('div');
                errEl.className = 'product-message error';
                errEl.textContent = 'Could not load documents: ' +
                    (err && err.message ? err.message : String(err));
                container.appendChild(errEl);
            });
    }

    /**
     * Resolve every item in the project to the list of documents it
     * references. Deduplicates per-selection docs the same way docs.js
     * does (one entry per {column, filename} pair across all rows).
     *
     * Returns a structure:
     *   {
     *     products: [{ productKey, displayName, assetsFolder, items: [
     *       { instanceId, tag, label, selectionId, files: [
     *         { key, docColumn, filename, filenameWithExt, url,
     *           docTypeName, isZip }
     *       ]}
     *     ]}],
     *     docTypeNames: [...unique sorted names...],
     *     signature: '...'
     *   }
     */
    function gatherFilesData(items) {
        var byProduct = groupItemsByProduct(items);
        var productKeys = Object.keys(byProduct);

        return Promise.all(productKeys.map(function (pk) {
            return HHpro.Data.loadProduct(pk);
        })).then(function (dataList) {
            var products = [];
            var allTypeNames = {};

            productKeys.forEach(function (productKey, idx) {
                var data = dataList[idx];
                var product = HHpro.Data.getProduct(productKey) || {};
                var assetsFolder = product.assetsFolder || '';
                var displayName = product.displayName || productKey.toUpperCase();

                var docColumns = data.documentationColumns || [];
                var byId = {};
                (data.selections || []).forEach(function (sel) { byId[sel.id] = sel; });

                var itemsOut = [];
                byProduct[productKey].forEach(function (item) {
                    var sel = byId[item.selectionId];
                    if (!sel) return;

                    var seen = {};
                    var files = [];
                    docColumns.forEach(function (dc) {
                        (sel.rows || []).forEach(function (row) {
                            var dd = row.documentationData || {};
                            var filename = dd[dc.name];
                            if (!filename) return;
                            var dedupKey = dc.name + '|' + filename;
                            if (seen[dedupKey]) return;
                            seen[dedupKey] = true;

                            var filenameWithExt = filename + '.' + dc.fileExtension;
                            files.push({
                                key: fileKey(item.instanceId, dc.name, filename),
                                docColumn: dc,
                                filename: String(filename),
                                filenameWithExt: filenameWithExt,
                                url: buildDocUrl(assetsFolder, dc, filename),
                                docTypeName: dc.name,
                                isZip: String(dc.fileExtension || '').toLowerCase() === 'zip'
                            });
                            allTypeNames[dc.name] = true;
                        });
                    });

                    itemsOut.push({
                        instanceId: item.instanceId,
                        tag: item.tag || '',
                        label: item.label || item.selectionId,
                        selectionId: item.selectionId,
                        files: files
                    });
                });

                if (itemsOut.length > 0) {
                    products.push({
                        productKey: productKey,
                        displayName: displayName,
                        assetsFolder: assetsFolder,
                        items: itemsOut
                    });
                }
            });

            // Preserve doc-type order as it appears across product JSONs
            var orderedNames = [];
            var seenOrdered = {};
            dataList.forEach(function (data) {
                (data.documentationColumns || []).forEach(function (dc) {
                    if (allTypeNames[dc.name] && !seenOrdered[dc.name]) {
                        seenOrdered[dc.name] = true;
                        orderedNames.push(dc.name);
                    }
                });
            });

            // Signature: changes when items or their file set changes, so
            // we know to reset the selection to "all checked" vs preserving
            // the previous stale selection.
            var sigBits = [];
            products.forEach(function (p) {
                p.items.forEach(function (it) {
                    sigBits.push(it.instanceId + ':' + it.files.length);
                });
            });
            var signature = sigBits.join(',');

            return { products: products, docTypeNames: orderedNames, signature: signature };
        });
    }

    function fileKey(instanceId, docName, filename) {
        return instanceId + '||' + docName + '||' + filename;
    }

    function buildDocUrl(assetsFolder, dc, filename) {
        var path = (assetsFolder || '') + '/' + (dc.folder || '') + '/' +
                   filename + '.' + dc.fileExtension;
        return encodeURI(path);
    }

    function buildDefaultSelection(filesData) {
        var set = {};
        filesData.products.forEach(function (p) {
            p.items.forEach(function (it) {
                it.files.forEach(function (f) { set[f.key] = true; });
            });
        });
        return set;
    }

    function buildFilesTabBody(filesData, activeState) {
        var wrap = document.createElement('div');
        wrap.className = 'files-tab';

        if (filesData.docTypeNames.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'project-empty';
            var p = document.createElement('p');
            p.className = 'project-empty-hint';
            p.textContent = 'The items in this project don\'t have any documents referenced in the Excel data.';
            empty.appendChild(p);
            wrap.appendChild(empty);
            return wrap;
        }

        // Toolbar: selected count + Download
        var toolbar = document.createElement('div');
        toolbar.className = 'files-toolbar';

        var countLabel = document.createElement('div');
        countLabel.className = 'files-count-label';
        toolbar.appendChild(countLabel);

        var downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'projects-btn projects-btn-primary';
        downloadBtn.textContent = 'Download ZIP';
        downloadBtn.addEventListener('click', function () {
            handleDownloadZip(filesData, activeState, downloadBtn);
        });
        toolbar.appendChild(downloadBtn);

        wrap.appendChild(toolbar);

        var body = document.createElement('div');
        body.className = 'files-body';

        // Handles to every rendered checkbox so we can re-sync aggregate
        // states (indeterminate for "some but not all") whenever the
        // selection changes.
        var handles = {
            typeCheckboxes: {},
            productCheckboxes: {},
            itemCheckboxes: {},
            fileCheckboxes: {},
            countLabel: countLabel,
            downloadBtn: downloadBtn
        };

        body.appendChild(buildFilesSidebar(filesData, handles));
        body.appendChild(buildFilesTree(filesData, handles));

        wrap.appendChild(body);

        refreshAllGroupStates(filesData, handles);
        return wrap;
    }

    // -------------------- Sidebar -------------------------------

    function buildFilesSidebar(filesData, handles) {
        var side = document.createElement('aside');
        side.className = 'files-sidebar';

        var title = document.createElement('h3');
        title.className = 'files-sidebar-title';
        title.textContent = 'File types';
        side.appendChild(title);

        filesData.docTypeNames.forEach(function (name) {
            var row = document.createElement('label');
            row.className = 'files-type-row';

            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'files-type-cb';
            cb.addEventListener('change', function () {
                toggleFilesByType(filesData, name, cb.checked);
                refreshAllGroupStates(filesData, handles);
            });
            handles.typeCheckboxes[name] = cb;

            var label = document.createElement('span');
            label.className = 'files-type-label';
            label.textContent = name;

            var count = document.createElement('span');
            count.className = 'files-type-count';
            count.textContent = String(countTypeFiles(filesData, name));

            row.appendChild(cb);
            row.appendChild(label);
            row.appendChild(count);
            side.appendChild(row);
        });

        return side;
    }

    // -------------------- Tree ----------------------------------

    function buildFilesTree(filesData, handles) {
        var tree = document.createElement('div');
        tree.className = 'files-tree';

        filesData.products.forEach(function (product) {
            var productNode = document.createElement('div');
            productNode.className = 'files-product';

            var productHeader = document.createElement('label');
            productHeader.className = 'files-product-header';

            var productCb = document.createElement('input');
            productCb.type = 'checkbox';
            productCb.className = 'files-product-cb';
            productCb.addEventListener('change', function () {
                toggleFilesByProduct(product, productCb.checked);
                refreshAllGroupStates(filesData, handles);
            });
            handles.productCheckboxes[product.productKey] = productCb;

            var productName = document.createElement('span');
            productName.className = 'files-product-name';
            productName.textContent = product.displayName;

            productHeader.appendChild(productCb);
            productHeader.appendChild(productName);
            productNode.appendChild(productHeader);

            product.items.forEach(function (item) {
                productNode.appendChild(buildFilesItem(item, handles, filesData));
            });

            tree.appendChild(productNode);
        });

        return tree;
    }

    function buildFilesItem(item, handles, filesData) {
        var itemNode = document.createElement('div');
        itemNode.className = 'files-item';

        var itemHeader = document.createElement('label');
        itemHeader.className = 'files-item-header';

        var itemCb = document.createElement('input');
        itemCb.type = 'checkbox';
        itemCb.className = 'files-item-cb';
        itemCb.addEventListener('change', function () {
            toggleFilesByItem(item, itemCb.checked);
            refreshAllGroupStates(filesData, handles);
        });
        handles.itemCheckboxes[item.instanceId] = itemCb;

        var itemName = document.createElement('span');
        itemName.className = 'files-item-name';
        var labelText = item.tag ? (item.tag + ' \u00b7 ' + item.label) : item.label;
        itemName.textContent = labelText;

        itemHeader.appendChild(itemCb);
        itemHeader.appendChild(itemName);
        itemNode.appendChild(itemHeader);

        if (item.files.length === 0) {
            var emptyRow = document.createElement('div');
            emptyRow.className = 'files-item-empty';
            emptyRow.textContent = 'No documents referenced for this item.';
            itemNode.appendChild(emptyRow);
            return itemNode;
        }

        var filesList = document.createElement('div');
        filesList.className = 'files-list';
        item.files.forEach(function (file) {
            filesList.appendChild(buildFileRow(file, handles, filesData));
        });
        itemNode.appendChild(filesList);

        return itemNode;
    }

    function buildFileRow(file, handles, filesData) {
        var row = document.createElement('label');
        row.className = 'files-file-row';

        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'files-file-cb';
        cb.checked = !!filesSelection[file.key];
        cb.addEventListener('change', function () {
            if (cb.checked) filesSelection[file.key] = true;
            else delete filesSelection[file.key];
            refreshAllGroupStates(filesData, handles);
        });
        handles.fileCheckboxes[file.key] = cb;

        var name = document.createElement('span');
        name.className = 'files-file-name';
        name.textContent = file.docTypeName;

        var fname = document.createElement('span');
        fname.className = 'files-file-fname';
        fname.textContent = file.filenameWithExt;

        var badge = document.createElement('span');
        badge.className = 'files-file-badge' + (file.isZip ? ' files-file-badge-zip' : '');
        badge.textContent = file.isZip ? 'ZIP' : 'PDF';

        row.appendChild(cb);
        row.appendChild(name);
        row.appendChild(fname);
        row.appendChild(badge);
        return row;
    }

    // -------------------- Selection helpers ----------------------

    function countTypeFiles(filesData, docName) {
        var n = 0;
        filesData.products.forEach(function (p) {
            p.items.forEach(function (it) {
                it.files.forEach(function (f) {
                    if (f.docTypeName === docName) n++;
                });
            });
        });
        return n;
    }

    function toggleFilesByType(filesData, docName, on) {
        filesData.products.forEach(function (p) {
            p.items.forEach(function (it) {
                it.files.forEach(function (f) {
                    if (f.docTypeName !== docName) return;
                    if (on) filesSelection[f.key] = true;
                    else delete filesSelection[f.key];
                });
            });
        });
    }

    function toggleFilesByProduct(product, on) {
        product.items.forEach(function (it) {
            it.files.forEach(function (f) {
                if (on) filesSelection[f.key] = true;
                else delete filesSelection[f.key];
            });
        });
    }

    function toggleFilesByItem(item, on) {
        item.files.forEach(function (f) {
            if (on) filesSelection[f.key] = true;
            else delete filesSelection[f.key];
        });
    }

    function refreshAllGroupStates(filesData, handles) {
        // Per-file
        Object.keys(handles.fileCheckboxes).forEach(function (k) {
            handles.fileCheckboxes[k].checked = !!filesSelection[k];
        });

        // Per-item
        filesData.products.forEach(function (p) {
            p.items.forEach(function (it) {
                var total = it.files.length;
                var on = 0;
                it.files.forEach(function (f) { if (filesSelection[f.key]) on++; });
                var cb = handles.itemCheckboxes[it.instanceId];
                if (!cb) return;
                setAggregateState(cb, total, on);
            });
        });

        // Per-product
        filesData.products.forEach(function (p) {
            var total = 0, on = 0;
            p.items.forEach(function (it) {
                it.files.forEach(function (f) {
                    total++;
                    if (filesSelection[f.key]) on++;
                });
            });
            var cb = handles.productCheckboxes[p.productKey];
            if (!cb) return;
            setAggregateState(cb, total, on);
        });

        // Per-doc-type
        filesData.docTypeNames.forEach(function (name) {
            var total = 0, on = 0;
            filesData.products.forEach(function (p) {
                p.items.forEach(function (it) {
                    it.files.forEach(function (f) {
                        if (f.docTypeName !== name) return;
                        total++;
                        if (filesSelection[f.key]) on++;
                    });
                });
            });
            var cb = handles.typeCheckboxes[name];
            if (!cb) return;
            setAggregateState(cb, total, on);
        });

        // Count label + download enablement
        var total = 0, selected = 0;
        filesData.products.forEach(function (p) {
            p.items.forEach(function (it) {
                it.files.forEach(function (f) {
                    total++;
                    if (filesSelection[f.key]) selected++;
                });
            });
        });
        if (handles.countLabel) {
            handles.countLabel.textContent = selected + ' of ' + total +
                ' file' + (total === 1 ? '' : 's') + ' selected';
        }
        if (handles.downloadBtn) {
            handles.downloadBtn.disabled = selected === 0;
        }
    }

    function setAggregateState(cb, total, on) {
        if (total === 0) {
            cb.checked = false; cb.indeterminate = false; cb.disabled = true;
        } else if (on === 0) {
            cb.checked = false; cb.indeterminate = false; cb.disabled = false;
        } else if (on === total) {
            cb.checked = true; cb.indeterminate = false; cb.disabled = false;
        } else {
            cb.checked = false; cb.indeterminate = true; cb.disabled = false;
        }
    }

    // -------------------- ZIP download ---------------------------

    function handleDownloadZip(filesData, activeState, downloadBtn) {
        if (typeof JSZip === 'undefined') {
            alert('JSZip library is missing. Make sure JS/jszip.min.js is included in the site.');
            return;
        }

        var selectedFiles = [];
        filesData.products.forEach(function (p) {
            p.items.forEach(function (it) {
                it.files.forEach(function (f) {
                    if (filesSelection[f.key]) {
                        selectedFiles.push({ file: f, product: p });
                    }
                });
            });
        });
        if (!selectedFiles.length) {
            alert('Select at least one file to download.');
            return;
        }

        // Deduplicate by (product, folder, filenameWithExt) so identical
        // files referenced by multiple items only appear once in the zip
        var dedupMap = {};
        var dedupedList = [];
        selectedFiles.forEach(function (entry) {
            var path = entry.product.displayName + '/' + entry.file.docColumn.folder +
                       '/' + entry.file.filenameWithExt;
            if (dedupMap[path]) return;
            dedupMap[path] = true;
            dedupedList.push({ entry: entry, path: path });
        });

        var zip = new JSZip();
        var baseName = buildZipBaseName(activeState);
        var rootFolder = zip.folder(baseName);

        var originalText = downloadBtn.textContent;
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Preparing 0 / ' + dedupedList.length + '...';

        var missing = [];
        var completed = 0;

        // Fetch sequentially - keeps the UX predictable and avoids
        // hammering the dev server with dozens of parallel requests
        var chain = Promise.resolve();
        dedupedList.forEach(function (d) {
            chain = chain.then(function () {
                return fetch(d.entry.file.url)
                    .then(function (resp) {
                        if (!resp.ok) throw new Error('HTTP ' + resp.status);
                        return resp.blob();
                    })
                    .then(function (blob) {
                        rootFolder.file(d.path, blob);
                    })
                    .catch(function (err) {
                        missing.push({
                            path: d.path,
                            reason: (err && err.message) ? err.message : String(err)
                        });
                    })
                    .then(function () {
                        completed++;
                        downloadBtn.textContent =
                            'Preparing ' + completed + ' / ' + dedupedList.length + '...';
                    });
            });
        });

        chain.then(function () {
            downloadBtn.textContent = 'Building archive...';
            return zip.generateAsync({ type: 'blob' });
        }).then(function (blob) {
            triggerBlobDownload(blob, baseName + '.zip');
            downloadBtn.disabled = false;
            downloadBtn.textContent = originalText;

            if (missing.length) {
                var summary = missing.length + ' of ' + dedupedList.length +
                    ' file(s) could not be found on disk and were skipped:\n\n';
                summary += missing.slice(0, 15).map(function (m) {
                    return '  - ' + m.path;
                }).join('\n');
                if (missing.length > 15) {
                    summary += '\n  ...and ' + (missing.length - 15) + ' more.';
                }
                summary += '\n\nThe ZIP was still downloaded with the files that were found.';
                alert(summary);
            }
        }).catch(function (err) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = originalText;
            alert('Failed to build ZIP: ' +
                  (err && err.message ? err.message : String(err)));
        });
    }

    function buildZipBaseName(activeState) {
        var dateStr = todayStr();
        var projName = activeState.mode === 'project' ? (activeState.name || 'Project') : 'Cart';
        return safeFilename(projName) + ' - HHpro - ' + dateStr;
    }

    function triggerBlobDownload(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            if (a.parentNode) a.parentNode.removeChild(a);
            URL.revokeObjectURL(url);
        }, 100);
    }

    function todayStr() {
        var d = new Date();
        return (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getFullYear();
    }

    function safeFilename(name) {
        return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'project';
    }

    // =================================================================
    // Schedule notes section
    // -----------------------------------------------------------------
    // Appears below the schedule table on each per-product tab.
    //
    // Marvair layout (three sections stacked vertically):
    //   1. STANDARD OPTIONS/ACCESSORIES  - two internal columns,
    //      notes 1-N/2 left, N/2+1..N right, NOT deletable
    //   2. CONFIGURATION                 - single column,
    //      NOT deletable
    //   3. OPTIONAL ACCESSORIES          - deletable list; numbering
    //      continues through user-added custom notes that come after
    //
    // Simple-list layout (everything else):
    //   SCHEDULE NOTES - single deletable list with custom notes
    //   continuing the numbering
    //
    // Below those, common to every product:
    //   - "Removed notes" pills to restore deleted items (both
    //     built-in and user-added)
    //   - 10 custom-note text rows. Each row has a "+" button on
    //     the left. Clicking the button moves the typed text into
    //     the main notes list above and clears the textbox.
    //
    // State lives in HHpro.Cart.getProjectExtra(productKey).scheduleNotesState:
    //   {
    //     deletedIndices:   [ ... ]   // built-in indices (Marvair OPTIONAL
    //                                 // or simple-list) that are hidden
    //     customDrafts:     [ 10 strings ]   // current textbox contents
    //     customAdded:      [ { id, text }, ... ]   // user-added notes
    //     deletedCustomIds: [ id, ... ]      // ids of customAdded notes
    //                                        // currently hidden
    //   }
    // =================================================================

    function buildScheduleNotesSection(productKey, data) {
        var section = document.createElement('section');
        section.className = 'schedule-notes-section';

        var notes = normalizeScheduleNotes(data.scheduleNotes);
        var nstate = loadNotesState(productKey);
        var readOnly = isScheduleNotesReadOnly(productKey);

        // Main notes area
        if (readOnly) {
            // Read-only: plain numbered list, no delete buttons, no
            // customs, no restore pills. Used for VFDs whose notes
            // are an authoritative fixed list.
            section.appendChild(buildReadOnlyNotesBlock(notes));
            return section;
        }

        if (notes.format === 'marvair') {
            section.appendChild(buildMarvairNotesBlocks(productKey, notes, nstate));
        } else {
            section.appendChild(buildListNotesBlock(productKey, notes, nstate));
        }

        // Removed-notes area (shown only if anything is hidden)
        if (nstate.deletedIndices.length > 0 || nstate.deletedCustomIds.length > 0) {
            section.appendChild(buildRemovedNotesBlock(productKey, notes, nstate));
        }

        // Custom-notes input area (always shown for editable products)
        section.appendChild(buildCustomNotesBlock(productKey, nstate));

        return section;
    }

    /**
     * True if the given product's schedule notes should be displayed
     * as an authoritative, non-editable list. Driven by the
     * `scheduleNotesReadOnly` flag on the product entry in data.js.
     */
    function isScheduleNotesReadOnly(productKey) {
        var product = HHpro.Data && HHpro.Data.getProduct
            ? HHpro.Data.getProduct(productKey)
            : null;
        return !!(product && product.scheduleNotesReadOnly);
    }

    /**
     * Render a schedule-notes block for a read-only product: plain
     * numbered list in the order the notes came out of the Excel
     * SCHEDULE NOTES tab. No delete buttons, no custom-note inputs,
     * no restore area.
     */
    function buildReadOnlyNotesBlock(notes) {
        var block = document.createElement('div');
        block.className = 'notes-block notes-plain notes-readonly';
        block.appendChild(buildBlockHeader('SCHEDULE NOTES:'));

        // For read-only mode we only handle the 'list' notes format.
        // The Marvair layout doesn't apply here (VFDs use a plain
        // list on the SCHEDULE NOTES tab). If a future read-only
        // product used Marvair-format notes, this is where the
        // rendering for that variant would live.
        var lines = [];
        if (notes.format === 'marvair') {
            lines = (notes.standard || []).concat(notes.configuration || []);
            (notes.optional || []).forEach(function (o) {
                lines.push(o.text);
                (o.sub || []).forEach(function (s) { lines.push('\u2014 ' + s); });
            });
        } else {
            lines = notes.notes || [];
        }

        if (!lines.length) {
            block.appendChild(buildEmptyNotesHint('(none)'));
            return block;
        }

        var list = document.createElement('ol');
        list.className = 'notes-list';
        lines.forEach(function (text) {
            var li = document.createElement('li');
            li.className = 'notes-item';
            var span = document.createElement('span');
            span.className = 'notes-item-text';
            span.textContent = String(text);
            li.appendChild(span);
            list.appendChild(li);
        });
        block.appendChild(list);
        return block;
    }

    // -----------------------------------------------------------------
    // State load / save
    // -----------------------------------------------------------------

    /**
     * Load the schedule-notes state for a product. Handles migration
     * from the earlier shape that only had 'customNotes' (now
     * renamed to 'customDrafts') so old projects don't lose data.
     */
    function loadNotesState(productKey) {
        var extra = HHpro.Cart.getProjectExtra(productKey) || {};
        var raw = extra.scheduleNotesState || {};

        // Pull drafts from either the new field name or the old one
        var drafts;
        if (Array.isArray(raw.customDrafts)) {
            drafts = raw.customDrafts.slice();
        } else if (Array.isArray(raw.customNotes)) {
            drafts = raw.customNotes.slice();
        } else {
            drafts = [];
        }
        while (drafts.length < 10) drafts.push('');
        if (drafts.length > 10) drafts = drafts.slice(0, 10);

        return {
            deletedIndices: Array.isArray(raw.deletedIndices) ? raw.deletedIndices.slice() : [],
            customDrafts: drafts,
            customAdded: Array.isArray(raw.customAdded)
                ? raw.customAdded.filter(function (a) {
                    return a && typeof a.id === 'string';
                }).map(function (a) {
                    return { id: a.id, text: String(a.text || '') };
                })
                : [],
            deletedCustomIds: Array.isArray(raw.deletedCustomIds) ? raw.deletedCustomIds.slice() : []
        };
    }

    function saveNotesState(productKey, nstate) {
        HHpro.Cart.setProjectExtra(productKey, { scheduleNotesState: nstate });
    }

    function newCustomId() {
        return 'cn_' + Date.now().toString(36) + '_' +
               Math.floor(Math.random() * 10000).toString(36);
    }

    /**
     * Return the visible (non-deleted) user-added custom notes, in the
     * order they were added. Used to append them to the main deletable
     * notes list with continued numbering.
     */
    function visibleCustomAdded(nstate) {
        var hidden = {};
        nstate.deletedCustomIds.forEach(function (id) { hidden[id] = true; });
        return nstate.customAdded.filter(function (a) { return !hidden[a.id]; });
    }

    // =================================================================
    // Normalization
    // =================================================================

    function normalizeScheduleNotes(raw) {
        if (!raw) return { format: 'list', notes: [] };
        if (Array.isArray(raw)) {
            var clean = raw
                .filter(function (n) { return n !== null && n !== undefined && String(n).trim() !== ''; })
                .map(function (n) { return String(n).trim(); });
            return { format: 'list', notes: clean };
        }
        if (raw.format === 'marvair') {
            return {
                format: 'marvair',
                standard: Array.isArray(raw.standard) ? raw.standard.slice() : [],
                configuration: Array.isArray(raw.configuration) ? raw.configuration.slice() : [],
                optional: Array.isArray(raw.optional)
                    ? raw.optional.map(function (o) {
                        return {
                            text: (o && o.text) ? String(o.text) : '',
                            sub: (o && Array.isArray(o.sub)) ? o.sub.slice() : []
                        };
                    })
                    : []
            };
        }
        if (raw.format === 'list') {
            return {
                format: 'list',
                notes: Array.isArray(raw.notes) ? raw.notes.slice() : []
            };
        }
        return { format: 'list', notes: [] };
    }

    // =================================================================
    // Marvair layout (three stacked sections)
    // =================================================================

    function buildMarvairNotesBlocks(productKey, notes, nstate) {
        var wrap = document.createElement('div');
        wrap.className = 'notes-marvair-wrap';

        // STANDARD (two internal columns)
        var stdBlock = document.createElement('div');
        stdBlock.className = 'notes-block notes-standard';
        stdBlock.appendChild(buildBlockHeader('STANDARD OPTIONS/ACCESSORIES:'));

        if (!notes.standard.length) {
            stdBlock.appendChild(buildEmptyNotesHint('(none)'));
        } else {
            stdBlock.appendChild(buildTwoColumnStaticList(notes.standard));
        }
        wrap.appendChild(stdBlock);

        // CONFIGURATION section used to live here. It's been removed
        // now that the Configuration column on the schedule itself
        // captures per-item config (the `notes.configuration` array
        // is still loaded from the JSON so the column's dropdown has
        // options to show).

        // OPTIONAL (deletable; user-added custom notes continue numbering here)
        wrap.appendChild(buildDeletableOptionalBlock(productKey, notes, nstate));

        return wrap;
    }

    function buildDeletableOptionalBlock(productKey, notes, nstate) {
        var block = document.createElement('div');
        block.className = 'notes-block notes-optional';
        block.appendChild(buildBlockHeader('OPTIONAL ACCESSORIES:'));

        var builtInVisible = notes.optional.filter(function (_, idx) {
            return nstate.deletedIndices.indexOf(idx) < 0;
        });
        var addedVisible = visibleCustomAdded(nstate);

        if (!notes.optional.length && !addedVisible.length) {
            block.appendChild(buildEmptyNotesHint('No optional accessories defined.'));
            return block;
        }
        if (!builtInVisible.length && !addedVisible.length) {
            block.appendChild(buildEmptyNotesHint(
                'All optional notes removed. Click one below to add it back in.'
            ));
            return block;
        }

        var list = document.createElement('ol');
        list.className = 'notes-list';

        // Render built-in OPTIONAL notes (with their original index preserved
        // so the delete button knows which index to hide in deletedIndices).
        notes.optional.forEach(function (opt, originalIdx) {
            if (nstate.deletedIndices.indexOf(originalIdx) >= 0) return;
            list.appendChild(buildOptionalNoteItem(productKey, opt, originalIdx));
        });

        // Append user-added custom notes at the end with continued numbering
        addedVisible.forEach(function (added) {
            list.appendChild(buildCustomAddedNoteItem(productKey, added));
        });

        block.appendChild(list);
        return block;
    }

    function buildOptionalNoteItem(productKey, opt, originalIdx) {
        var li = document.createElement('li');
        li.className = 'notes-item notes-item-deletable';

        var row = document.createElement('div');
        row.className = 'notes-item-row';

        var del = makeDelButton('Remove this note', function () {
            toggleBuiltInDeleted(productKey, originalIdx, true);
            HHpro.App.showView('project_view');
        });
        row.appendChild(del);

        var text = document.createElement('span');
        text.className = 'notes-item-text';
        text.textContent = opt.text || '';
        row.appendChild(text);

        li.appendChild(row);

        if (opt.sub && opt.sub.length) {
            var subUl = document.createElement('ul');
            subUl.className = 'notes-sublist';
            opt.sub.forEach(function (s) {
                var sli = document.createElement('li');
                sli.className = 'notes-subitem';
                sli.textContent = String(s);
                subUl.appendChild(sli);
            });
            li.appendChild(subUl);
        }
        return li;
    }

    function buildCustomAddedNoteItem(productKey, added) {
        var li = document.createElement('li');
        li.className = 'notes-item notes-item-deletable notes-item-custom-added';

        var row = document.createElement('div');
        row.className = 'notes-item-row';

        var del = makeDelButton('Remove this custom note', function () {
            toggleCustomDeleted(productKey, added.id, true);
            HHpro.App.showView('project_view');
        });
        row.appendChild(del);

        var text = document.createElement('span');
        text.className = 'notes-item-text';
        text.textContent = added.text;
        row.appendChild(text);

        li.appendChild(row);
        return li;
    }

    function buildTwoColumnStaticList(items) {
        var half = Math.ceil(items.length / 2);
        var left = items.slice(0, half);
        var right = items.slice(half);

        var grid = document.createElement('div');
        grid.className = 'notes-standard-columns';

        grid.appendChild(buildSingleColumnStaticList(left, 1));
        if (right.length) {
            grid.appendChild(buildSingleColumnStaticList(right, half + 1));
        }
        return grid;
    }

    function buildSingleColumnStaticList(items, startNum) {
        var ol = document.createElement('ol');
        ol.className = 'notes-list';
        if (startNum && startNum !== 1) ol.setAttribute('start', String(startNum));
        items.forEach(function (text) {
            var li = document.createElement('li');
            li.className = 'notes-item notes-item-static';
            var span = document.createElement('span');
            span.className = 'notes-item-text';
            span.textContent = String(text);
            li.appendChild(span);
            ol.appendChild(li);
        });
        return ol;
    }

    // =================================================================
    // Simple-list layout (Gas Packs, Mini Splits, Multi Position Splits)
    // =================================================================

    function buildListNotesBlock(productKey, notes, nstate) {
        var block = document.createElement('div');
        block.className = 'notes-block notes-plain';
        block.appendChild(buildBlockHeader('SCHEDULE NOTES:'));

        var builtInVisible = notes.notes.filter(function (_, idx) {
            return nstate.deletedIndices.indexOf(idx) < 0;
        });
        var addedVisible = visibleCustomAdded(nstate);

        if (!notes.notes.length && !addedVisible.length) {
            block.appendChild(buildEmptyNotesHint(
                'No schedule notes defined for this product yet. Use the custom notes below to add your own.'
            ));
            return block;
        }
        if (!builtInVisible.length && !addedVisible.length) {
            block.appendChild(buildEmptyNotesHint(
                'All notes removed. Click one below to add it back in.'
            ));
            return block;
        }

        var list = document.createElement('ol');
        list.className = 'notes-list';

        notes.notes.forEach(function (text, originalIdx) {
            if (nstate.deletedIndices.indexOf(originalIdx) >= 0) return;

            var li = document.createElement('li');
            li.className = 'notes-item notes-item-deletable';

            var row = document.createElement('div');
            row.className = 'notes-item-row';

            var del = makeDelButton('Remove this note', (function (idx) {
                return function () {
                    toggleBuiltInDeleted(productKey, idx, true);
                    HHpro.App.showView('project_view');
                };
            })(originalIdx));
            row.appendChild(del);

            var span = document.createElement('span');
            span.className = 'notes-item-text';
            span.textContent = String(text);
            row.appendChild(span);

            li.appendChild(row);
            list.appendChild(li);
        });

        addedVisible.forEach(function (added) {
            list.appendChild(buildCustomAddedNoteItem(productKey, added));
        });

        block.appendChild(list);
        return block;
    }

    // =================================================================
    // Removed-notes restore area
    // =================================================================

    function buildRemovedNotesBlock(productKey, notes, nstate) {
        var block = document.createElement('div');
        block.className = 'notes-block notes-removed';
        block.appendChild(buildBlockHeader('Removed notes \u2014 click to add back'));

        var list = document.createElement('div');
        list.className = 'notes-removed-list';

        // Built-in notes first (in original order)
        var sortedBuiltIn = nstate.deletedIndices.slice().sort(function (a, b) { return a - b; });
        sortedBuiltIn.forEach(function (idx) {
            var displayText = '';
            var subHint = '';

            if (notes.format === 'marvair') {
                var opt = notes.optional[idx];
                if (!opt) return;
                displayText = opt.text || '';
                if (opt.sub && opt.sub.length) {
                    subHint = ' (+ ' + opt.sub.length +
                        ' sub-item' + (opt.sub.length === 1 ? '' : 's') + ')';
                }
            } else {
                var t = notes.notes[idx];
                if (t === undefined) return;
                displayText = String(t);
            }

            list.appendChild(buildRestorePill(displayText + subHint, false, function () {
                toggleBuiltInDeleted(productKey, idx, false);
                HHpro.App.showView('project_view');
            }));
        });

        // Then user-added custom notes that were hidden
        nstate.customAdded.forEach(function (added) {
            if (nstate.deletedCustomIds.indexOf(added.id) < 0) return;
            list.appendChild(buildRestorePill(added.text, true, function () {
                toggleCustomDeleted(productKey, added.id, false);
                HHpro.App.showView('project_view');
            }));
        });

        block.appendChild(list);
        return block;
    }

    function buildRestorePill(labelText, isCustom, onClick) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'notes-removed-item' + (isCustom ? ' notes-removed-item-custom' : '');
        btn.title = 'Click to add this note back in';

        var icon = document.createElement('span');
        icon.className = 'notes-restore-icon';
        icon.textContent = '+';
        btn.appendChild(icon);

        var txt = document.createElement('span');
        txt.className = 'notes-removed-text';
        txt.textContent = labelText;
        btn.appendChild(txt);

        btn.addEventListener('click', onClick);
        return btn;
    }

    // =================================================================
    // Custom notes textbox grid (10 rows, each with an "add" button)
    // =================================================================

    function buildCustomNotesBlock(productKey, nstate) {
        var block = document.createElement('div');
        block.className = 'notes-block notes-custom';
        block.appendChild(buildBlockHeader('Custom project notes'));

        var hint = document.createElement('p');
        hint.className = 'notes-custom-hint';
        hint.textContent = 'Type a note, then click the + button to add it to the schedule notes above. '
            + 'Up to 10 text rows.';
        block.appendChild(hint);

        var grid = document.createElement('div');
        grid.className = 'notes-custom-grid';

        for (var i = 0; i < 10; i++) {
            grid.appendChild(buildCustomNoteRow(productKey, i, nstate.customDrafts[i] || ''));
        }

        block.appendChild(grid);
        return block;
    }

    function buildCustomNoteRow(productKey, slot, initialText) {
        var row = document.createElement('div');
        row.className = 'notes-custom-row';

        var num = document.createElement('span');
        num.className = 'notes-custom-number';
        num.textContent = (slot + 1) + '.';
        row.appendChild(num);

        // Add button (on the LEFT of the textbox, per user request)
        var addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'notes-custom-add-btn';
        addBtn.title = 'Add this note to the schedule notes';
        addBtn.setAttribute('aria-label', 'Add custom note to schedule');
        addBtn.textContent = '+';
        addBtn.disabled = !initialText.trim();
        row.appendChild(addBtn);

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'notes-custom-input';
        input.value = initialText;
        input.placeholder = 'Custom note ' + (slot + 1);
        input.maxLength = 250;
        row.appendChild(input);

        // Sync: enable/disable add button as text changes
        input.addEventListener('input', function () {
            addBtn.disabled = !input.value.trim();
        });

        // Persist draft on blur so half-typed notes aren't lost on navigation
        input.addEventListener('blur', function () {
            saveDraftSlot(productKey, slot, input.value);
        });

        // Enter triggers add (if text is present)
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (!addBtn.disabled) addBtn.click();
            }
        });

        // Add button: move text from draft to customAdded list
        addBtn.addEventListener('click', function () {
            var txt = input.value.trim();
            if (!txt) return;
            addCustomNote(productKey, slot, txt);
            HHpro.App.showView('project_view');
        });

        return row;
    }

    function saveDraftSlot(productKey, slot, value) {
        var nstate = loadNotesState(productKey);
        if (nstate.customDrafts[slot] === value) return;
        nstate.customDrafts[slot] = value;
        saveNotesState(productKey, nstate);
    }

    function addCustomNote(productKey, slot, text) {
        var nstate = loadNotesState(productKey);
        nstate.customAdded.push({ id: newCustomId(), text: text });
        nstate.customDrafts[slot] = '';  // clear the draft slot
        saveNotesState(productKey, nstate);
    }

    function toggleBuiltInDeleted(productKey, index, deleted) {
        var nstate = loadNotesState(productKey);
        var list = nstate.deletedIndices;
        if (deleted) {
            if (list.indexOf(index) < 0) list.push(index);
        } else {
            nstate.deletedIndices = list.filter(function (i) { return i !== index; });
        }
        saveNotesState(productKey, nstate);
    }

    function toggleCustomDeleted(productKey, id, deleted) {
        var nstate = loadNotesState(productKey);
        var list = nstate.deletedCustomIds;
        if (deleted) {
            if (list.indexOf(id) < 0) list.push(id);
        } else {
            nstate.deletedCustomIds = list.filter(function (x) { return x !== id; });
        }
        saveNotesState(productKey, nstate);
    }

    // =================================================================
    // Small shared helpers
    // =================================================================

    function buildBlockHeader(text) {
        var hdr = document.createElement('h3');
        hdr.className = 'notes-block-header';
        hdr.textContent = text;
        return hdr;
    }

    function makeDelButton(title, onClick) {
        var del = document.createElement('button');
        del.type = 'button';
        del.className = 'notes-del-btn';
        del.title = title;
        del.setAttribute('aria-label', title);
        del.innerHTML = '&times;';
        del.addEventListener('click', onClick);
        return del;
    }

    function buildEmptyNotesHint(text) {
        var hint = document.createElement('p');
        hint.className = 'notes-empty-hint';
        hint.textContent = text;
        return hint;
    }
})();