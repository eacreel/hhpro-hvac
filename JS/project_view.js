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

    // "Edit Schedule" mode, per product key. When on, that product's
    // schedule renders every cell as an editable input (see
    // buildEditableSchedule). Lives for the view session.
    var editModeByProduct = {};

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
            // The .project-view-root class is what the global Ctrl+Z/Y
            // handler keys off to know we're on the project view.
            main.className = 'project-view-page project-view-root';
            root.appendChild(main);

            bindUndoRedoKeyboard();

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

            // Validate the persisted activeTab against the tabs that
            // exist for the current project content. If the user's last
            // tab was removed (e.g. the only mini split was deleted and
            // they were on the refrigerant tab), fall back to the first
            // available product tab.
            var hasRefrig = hasRefrigerantSystems(groups);
            if (activeTab === 'refrigerant' && !hasRefrig) {
                activeTab = productKeys[0];
            } else if (activeTab !== 'files' && activeTab !== 'refrigerant' &&
                       productKeys.indexOf(activeTab) < 0) {
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

        // Only offer the layout selector when this login can use more
        // than the standard layout (i.e. has an engineer template).
        var selector = buildEngineerSelector();
        if (selector) left.appendChild(selector);

        header.appendChild(left);

        // Right-side header buttons. Undo/redo always appear so the
        // user can recover from a mistake regardless of cart vs project
        // mode. Project-only buttons (Exit Project, All Projects) sit
        // beside them.
        var actionsRight = document.createElement('div');
        actionsRight.className = 'project-header-actions';

        actionsRight.appendChild(buildUndoButton());
        actionsRight.appendChild(buildRedoButton());

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

    // Project-level engineer schedule-layout selector. Switching it
    // re-renders the whole project view so every product tab's schedule
    // (and the Excel/CAD/PDF exports) pick up the chosen firm's layout.
    function buildEngineerSelector() {
        var engineers = (HHpro.Templates && HHpro.Templates.listEngineers)
            ? HHpro.Templates.listEngineers()
            : [{ key: 'hoffman', label: 'Hoffman & Hoffman' }];

        // Nothing to choose when only the standard layout is available.
        if (engineers.length <= 1) return null;

        var wrap = document.createElement('div');
        wrap.className = 'project-engineer-select';

        var sel = document.createElement('select');
        sel.className = 'project-engineer-dropdown';
        var selId = 'engineer-select';
        sel.id = selId;

        var label = document.createElement('label');
        label.className = 'project-engineer-label';
        label.htmlFor = selId;
        label.textContent = 'Schedule layout:';

        var current = (HHpro.Cart && HHpro.Cart.getProjectEngineer)
            ? HHpro.Cart.getProjectEngineer() : 'hoffman';
        // Clamp to an allowed engineer so the control never shows a
        // selection this login can't actually use.
        var allowedKeys = engineers.map(function (e) { return e.key; });
        if (allowedKeys.indexOf(current) === -1) current = 'hoffman';

        engineers.forEach(function (e) {
            var opt = document.createElement('option');
            opt.value = e.key;
            opt.textContent = e.label;
            if (e.key === current) opt.selected = true;
            sel.appendChild(opt);
        });

        sel.addEventListener('change', function () {
            if (HHpro.Cart && HHpro.Cart.setProjectEngineer) {
                HHpro.Cart.setProjectEngineer(sel.value);
            }
            HHpro.App.showView('project_view');
        });

        wrap.appendChild(label);
        wrap.appendChild(sel);
        return wrap;
    }

    // Resolve the engineer template for a product under the active
    // project's selected firm. Null -> native scheduleHeader layout.
    function activeTemplate(productKey) {
        if (!(HHpro.Templates && HHpro.Templates.getTemplate)) return null;
        var eng = (HHpro.Cart && HHpro.Cart.getProjectEngineer)
            ? HHpro.Cart.getProjectEngineer() : 'hoffman';
        return HHpro.Templates.getTemplate(eng, productKey);
    }

    // -----------------------------------------------------------------
    // Undo / redo
    // -----------------------------------------------------------------

    function buildUndoButton() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'projects-btn projects-btn-secondary project-undo-btn';
        btn.appendChild(HHpro.UI.icon('undo'));
        var label = document.createElement('span');
        label.textContent = 'Undo';
        btn.appendChild(label);
        var canUndo = !!(HHpro.Cart && HHpro.Cart.canUndo && HHpro.Cart.canUndo());
        btn.disabled = !canUndo;
        btn.title = canUndo ? 'Undo (Ctrl+Z)' : 'Nothing to undo';
        btn.addEventListener('click', function () {
            if (HHpro.Cart.undo()) HHpro.App.showView('project_view');
        });
        return btn;
    }

    function buildRedoButton() {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'projects-btn projects-btn-secondary project-redo-btn';
        btn.appendChild(HHpro.UI.icon('redo'));
        var label = document.createElement('span');
        label.textContent = 'Redo';
        btn.appendChild(label);
        var canRedo = !!(HHpro.Cart && HHpro.Cart.canRedo && HHpro.Cart.canRedo());
        btn.disabled = !canRedo;
        btn.title = canRedo ? 'Redo (Ctrl+Shift+Z)' : 'Nothing to redo';
        btn.addEventListener('click', function () {
            if (HHpro.Cart.redo()) HHpro.App.showView('project_view');
        });
        return btn;
    }

    // Keyboard shortcuts for undo/redo while the project view is showing.
    // Registered once globally; the handler checks the current view so
    // shortcuts don't fire when the user is on the products list, etc.
    // Ignored when focus is in a text input so editing stays normal.
    var keyboardBound = false;
    function bindUndoRedoKeyboard() {
        if (keyboardBound) return;
        keyboardBound = true;
        document.addEventListener('keydown', function (e) {
            if (!isProjectViewActive()) return;
            if (isTypingInField(e.target)) return;
            var meta = e.ctrlKey || e.metaKey;
            if (!meta) return;
            var key = (e.key || '').toLowerCase();
            if (key === 'z' && !e.shiftKey) {
                e.preventDefault();
                if (HHpro.Cart && HHpro.Cart.undo && HHpro.Cart.undo()) {
                    HHpro.App.showView('project_view');
                }
            } else if ((key === 'z' && e.shiftKey) || key === 'y') {
                e.preventDefault();
                if (HHpro.Cart && HHpro.Cart.redo && HHpro.Cart.redo()) {
                    HHpro.App.showView('project_view');
                }
            }
        });
    }

    function isProjectViewActive() {
        // The view's root element wraps everything we render. If it's
        // still in the document we're "on" the project view.
        var root = document.querySelector('.project-view-root');
        return !!root && document.body.contains(root);
    }

    function isTypingInField(target) {
        if (!target) return false;
        var tag = (target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
        if (target.isContentEditable) return true;
        return false;
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

        // Refrigerant tab only appears when the project has at least
        // one item from a product that uses refrigerant calculations
        // (mini splits or multi position splits today). Sits between
        // the product tabs and Files so it stays grouped with the
        // schedule-data views. Label style mirrors the product tabs:
        // UPPERCASE with a parenthesized count (system count for
        // Refrigerant).
        if (hasRefrigerantSystems(groups)) {
            var refCount = countRefrigerantSystems(groups);
            nav.appendChild(buildTabButton('refrigerant',
                'REFRIGERANT (' + refCount + ')'));
        }

        nav.appendChild(buildTabButton('files', 'FILES'));
        return nav;
    }

    function countRefrigerantSystems(groups) {
        var n = 0;
        for (var i = 0; i < REFRIGERANT_PRODUCT_KEYS.length; i++) {
            var key = REFRIGERANT_PRODUCT_KEYS[i];
            if (groups[key]) n += groups[key].length;
        }
        return n;
    }

    // Product keys whose JSON files include a refrigerantColumns block.
    // Adding a new product here is the only code change needed when you
    // start emitting refrigerantColumns for a new product type.
    var REFRIGERANT_PRODUCT_KEYS = ['mini_splits', 'multi_position_splits', 'gas_splits'];

    function hasRefrigerantSystems(groups) {
        for (var i = 0; i < REFRIGERANT_PRODUCT_KEYS.length; i++) {
            var key = REFRIGERANT_PRODUCT_KEYS[i];
            if (groups[key] && groups[key].length) return true;
        }
        return false;
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
        if (activeTab === 'refrigerant') {
            renderRefrigerantTab(container, activeState);
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
    // Refrigerant tab
    // -----------------------------------------------------------------
    // One card per mini-split / multi-position-split in the project.
    // Each card shows the system's spec values, takes the engineer's
    // actual line-set / vertical-separation measurements, validates
    // against the system's maxima, and computes the additional + total
    // refrigerant charge using the manufacturer-standard formula:
    //
    //   added_oz = max(0, actual_total - pre_charge) * additional_oz_per_ft
    //   total_oz = added_oz + factory_oz
    //
    // Field inputs are persisted on every change via Cart.updateItem so
    // they survive page reloads / project reopens.
    //
    // Systems whose Excel rows had "-" (no spec data) are still listed,
    // but show the "Refer to IOM" note in place of the input form.
    // =================================================================

    // Per-product mapping that says which schedule column letters hold
    // the outdoor unit's MAKE + MODEL and the indoor unit's MAKE + MODEL.
    // This is the only product-specific lookup table the refrigerant tab
    // needs; everything else is schema-driven from refrigerantColumns.
    // Adding a new product here is the only change needed when its
    // refrigerant data lands in JSON.
    var MODEL_COLS_BY_PRODUCT = {
        'mini_splits': {
            indoor:  { make: 'M', model: 'N' },
            outdoor: { make: 'V', model: 'W' }
        },
        'multi_position_splits': {
            indoor:  { make: 'A', model: 'B' },
            outdoor: { make: 'R', model: 'S' }
        },
        'gas_splits': {
            indoor:  { make: 'A', model: 'B' },
            outdoor: { make: 'Q', model: 'R' }
        }
    };

    function renderRefrigerantTab(container, activeState) {
        // Group applicable items by product key so we know which JSON
        // files we need to fetch.
        var byProduct = {};
        activeState.items.forEach(function (it) {
            if (REFRIGERANT_PRODUCT_KEYS.indexOf(it.productKey) < 0) return;
            if (!byProduct[it.productKey]) byProduct[it.productKey] = [];
            byProduct[it.productKey].push(it);
        });

        var loading = document.createElement('div');
        loading.className = 'project-loading';
        loading.textContent = 'Loading...';
        container.appendChild(loading);

        Promise.all(Object.keys(byProduct).map(function (key) {
            return HHpro.Data.loadProduct(key).then(function (data) {
                return { key: key, data: data };
            });
        })).then(function (results) {
            var dataByKey = {};
            results.forEach(function (r) { dataByKey[r.key] = r.data; });
            container.innerHTML = '';
            container.appendChild(renderRefrigerantContent(
                activeState.items, dataByKey, activeState.name || ''));
        }).catch(function (err) {
            container.innerHTML = '';
            var errEl = document.createElement('div');
            errEl.className = 'product-message error';
            errEl.textContent = 'Could not load product data: ' +
                (err && err.message ? err.message : String(err));
            container.appendChild(errEl);
        });
    }

    // Non-identification columns in the refrigerant table when the
    // optional "Actual Vert IDU→IDU" field is hidden vs. shown:
    //   factory values (7) + field measurements (2 or 3) + calc (2)
    // Used for the colspan of the "Refer to IOM" cell on no-data rows.
    function refrigerantNonIdColspan(showActualVertIdu) {
        return 7 + (showActualVertIdu ? 3 : 2) + 2;
    }

    // Tooltip copy for the field-measurement column headers. Keyed by
    // the joined label so the header builder can look them up after
    // creating the th -- adding a key here is the only change needed
    // to add help to a new column.
    var REFRIGERANT_COLUMN_HELP = {
        'Actual Vert ODU→IDU':
            'This is the vertical height difference (in feet) between the ' +
            'outdoor unit and the indoor unit. For multi-splits, use the ' +
            'largest value out of each of the indoor units.',
        'Actual Total':
            'This is the total line-set length (in feet) for the system ' +
            'including the vertical line set lengths.',
        'Actual Vert IDU→IDU':
            'This is the vertical height difference (in feet) from one ' +
            'indoor unit to another. Applies to multi-split systems only. ' +
            'If more than 2 indoor units on a system, use the largest value.'
    };

    function buildHelpIcon(text) {
        var wrap = document.createElement('span');
        wrap.className = 'refrigerant-help';
        // tabindex makes the icon keyboard-focusable so the tooltip can
        // be reached without a pointing device.
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'button');
        wrap.setAttribute('aria-label', 'Help: ' + text);

        var icon = document.createElement('span');
        icon.className = 'refrigerant-help-icon';
        icon.textContent = '?';
        // Hidden from assistive tech -- the wrap's aria-label already
        // names the element. The icon is purely visual.
        icon.setAttribute('aria-hidden', 'true');
        wrap.appendChild(icon);

        var tip = document.createElement('span');
        tip.className = 'refrigerant-help-tooltip';
        tip.textContent = text;
        wrap.appendChild(tip);

        return wrap;
    }

    function hasAnyMultiSplit(allItems, dataByKey) {
        for (var i = 0; i < allItems.length; i++) {
            var item = allItems[i];
            if (item.productKey !== 'mini_splits') continue;
            var data = dataByKey[item.productKey];
            if (!data) continue;
            var sel = findSelection(data, item.selectionId);
            if (sel && sel.rows && sel.rows.length > 1) return true;
        }
        return false;
    }

    function renderRefrigerantContent(allItems, dataByKey, projectName) {
        var wrap = document.createElement('div');
        wrap.className = 'refrigerant-tab';

        var intro = document.createElement('p');
        intro.className = 'refrigerant-intro';
        intro.textContent = 'Enter the actual line-set distances for each split system in the ' +
            '"Field Measurements" columns. The site validates against each system’s allowable ' +
            'maximums and computes the refrigerant charge to add (line-set length minus the ' +
            'factory pre-charge length, multiplied by the manufacturer’s oz/ft) plus the total ' +
            'system charge.';
        wrap.appendChild(intro);

        // Toolbar (Refrigerant Report download). Sits above the table so
        // the engineer can pull the PDF without scrolling past the data.
        var toolbar = document.createElement('div');
        toolbar.className = 'refrigerant-toolbar';

        var reportBtn = document.createElement('button');
        reportBtn.type = 'button';
        reportBtn.className = 'projects-btn projects-btn-secondary';
        reportBtn.textContent = 'PDF Report';
        reportBtn.title = 'Open a printable refrigerant report for this project';
        reportBtn.addEventListener('click', function () {
            openRefrigerantReport(allItems, dataByKey, projectName);
        });
        toolbar.appendChild(reportBtn);
        wrap.appendChild(toolbar);

        // Whether to render the optional "Actual Vert IDU→IDU" field
        // measurement column. Only meaningful for multi-zone mini split
        // systems (1:N indoor units), so when no such system is in the
        // project we hide the column entirely.
        var showActualVertIdu = hasAnyMultiSplit(allItems, dataByKey);

        // Project-totals tracker: each row registers a recalc()
        // function. We sum the returned total-charge oz on every
        // change so the project total updates live.
        var trackers = [];
        var totalsEl = buildProjectTotalsCard();

        function recomputeTotals() {
            var totalOz = 0;
            var hasAny = false;
            trackers.forEach(function (t) {
                var oz = t.recalc();
                if (oz !== null && !isNaN(oz)) {
                    totalOz += oz;
                    hasAny = true;
                }
            });
            updateTotalsCard(totalsEl, hasAny ? totalOz : null);
        }

        var tableWrap = document.createElement('div');
        tableWrap.className = 'refrigerant-table-wrap';

        var table = document.createElement('table');
        table.className = 'refrigerant-table';
        table.appendChild(buildRefrigerantTableHeader(showActualVertIdu));

        var tbody = document.createElement('tbody');
        // Render rows in project order so the user sees systems in
        // the same sequence as on the schedule tabs.
        allItems.forEach(function (item) {
            if (REFRIGERANT_PRODUCT_KEYS.indexOf(item.productKey) < 0) return;
            var data = dataByKey[item.productKey];
            if (!data) return;
            var row = buildSystemRow(item, data, recomputeTotals, showActualVertIdu);
            tbody.appendChild(row.element);
            trackers.push(row);
        });
        table.appendChild(tbody);

        tableWrap.appendChild(table);
        wrap.appendChild(tableWrap);
        wrap.appendChild(totalsEl);
        recomputeTotals();
        return wrap;
    }

    function buildRefrigerantTableHeader(showActualVertIdu) {
        var thead = document.createElement('thead');

        // Tier 1: column groups. Field Measurements is 3 columns when
        // the project includes a multi-zone mini-split (so the
        // Actual Vert IDU→IDU input is shown), otherwise 2. The trailing
        // Reference group always adds 1 column (link to the long-line-
        // set application guide or outdoor-unit IOM).
        var tier1 = document.createElement('tr');
        appendGroupHeader(tier1, 'System',             2);
        appendGroupHeader(tier1, 'Factory Values',     7);
        appendGroupHeader(tier1, 'Field Measurements', showActualVertIdu ? 3 : 2);
        appendGroupHeader(tier1, 'Calculated Charge',  2);
        appendGroupHeader(tier1, 'Reference',          1);
        thead.appendChild(tier1);

        // Tier 2: individual column labels. Units live in the cell
        // values (e.g. "66 ft") not the headers, so the headers stay
        // narrow. Multi-element arrays force a line break -- used on
        // headers whose body content is much shorter than the header
        // text (e.g. "Max Vert ODU→IDU" over a "66 ft" body) so the
        // column shrinks to fit the body width.
        var labels = [
            // System (2)
            ['Outdoor'], ['Indoor(s)'],
            // Factory values (7) -- Factory Charge cell now also shows
            // the pre-charge piping length as a third line, so the
            // standalone Pre-charge column has been removed.
            ['Refrigerant'], ['Line Sizes'],
            ['Max Vert', 'ODU→IDU'], ['Max Vert', 'IDU→IDU'], ['Max Total'],
            ['Factory', 'Charge'], ['Additional'],
            // Field measurements (2 or 3)
            ['Actual Vert', 'ODU→IDU'], ['Actual Total']
        ];
        if (showActualVertIdu) {
            labels.push(['Actual Vert', 'IDU→IDU']);
        }
        // Calculated (2) + Reference (1)
        labels.push(['To Add']);
        labels.push(['Total', 'Charge']);
        labels.push(['Application', 'Guide']);

        var tier2 = document.createElement('tr');
        labels.forEach(function (lines) {
            var th = document.createElement('th');
            lines.forEach(function (line, idx) {
                if (idx > 0) th.appendChild(document.createElement('br'));
                th.appendChild(document.createTextNode(line));
            });
            var helpText = REFRIGERANT_COLUMN_HELP[lines.join(' ')];
            if (helpText) {
                th.appendChild(buildHelpIcon(helpText));
            }
            tier2.appendChild(th);
        });
        thead.appendChild(tier2);
        return thead;
    }

    function appendGroupHeader(tr, label, span) {
        var th = document.createElement('th');
        th.colSpan = span;
        th.className = 'refrigerant-table-group';
        th.textContent = label;
        tr.appendChild(th);
    }

    function buildSystemRow(item, data, onRecalc, showActualVertIdu) {
        var selection = findSelection(data, item.selectionId);
        var refData = readRefrigerantData(selection);
        var hasData = refrigerantHasData(refData);
        var isMultiSplit = !!(selection && selection.rows && selection.rows.length > 1 &&
                              item.productKey === 'mini_splits');

        var tr = document.createElement('tr');
        tr.className = 'refrigerant-row' + (hasData ? '' : ' refrigerant-row-no-data');

        // Identification cells (always rendered)
        appendIdCells(tr, item, selection);

        // The Reference column always renders, even on no-data rows
        // (where the link to the IOM is exactly what the "Refer to IOM"
        // message is pointing at).
        var refCell = buildReferenceCell(item, selection, data);

        if (!hasData) {
            // Single message cell spans every non-identification column
            // EXCEPT the Reference column, which still shows its link.
            var noDataTd = document.createElement('td');
            noDataTd.className = 'refrigerant-no-data-cell';
            noDataTd.colSpan = refrigerantNonIdColspan(showActualVertIdu);
            noDataTd.textContent = 'Refer to outdoor unit installation manual for refrigerant calculations.';
            tr.appendChild(noDataTd);
            tr.appendChild(refCell);
            return { element: tr, recalc: function () { return null; } };
        }

        // Factory value cells (7 in fixed order)
        appendFactoryCells(tr, refData, isMultiSplit);

        // Field measurement input cells (2 or 3 depending on showActualVertIdu)
        var savedInputs = item.refrigerantInputs || {};
        var maxOdu   = parseFloatOrNull(refData['MAX VERTICAL SEPARATION (ODU TO IDU) (FT)']);
        var maxTotal = parseFloatOrNull(refData['MAX TOTAL LINE SET (FT)']);
        var maxIdu   = parseFloatOrNull(refData['MAX VERTICAL SEPARATION (IDU TO IDU) (FT)']);
        var inOdu   = makeInputCell('actualVertOdu', maxOdu,   false,         savedInputs.actualVertOdu);
        var inTotal = makeInputCell('actualTotal',   maxTotal, false,         savedInputs.actualTotal);
        var inIdu   = null;
        if (showActualVertIdu) {
            inIdu = makeInputCell('actualVertIdu', maxIdu, !isMultiSplit, savedInputs.actualVertIdu);
        }
        tr.appendChild(inOdu.cell);
        tr.appendChild(inTotal.cell);
        if (inIdu) tr.appendChild(inIdu.cell);

        // Calculated cells (2): combined oz/lbs each, stacked.
        var calcAdd = makeCalcStackedCell();
        var calcTotal = makeCalcStackedCell('refrigerant-calc-cell-emphasize');
        tr.appendChild(calcAdd.cell);
        tr.appendChild(calcTotal.cell);

        // Reference cell (always last)
        tr.appendChild(refCell);

        function recalc() {
            // If any field measurement exceeds its system maximum, the
            // entered length is invalid for this unit -- show "—" for
            // To Add / Total Charge instead of a misleading number, and
            // exclude this row from the project total.
            var anyOverMax = inOdu.isOverMax() || inTotal.isOverMax() ||
                             (inIdu && inIdu.isOverMax());
            if (anyOverMax) {
                calcAdd.update(null, null);
                calcTotal.update(null, null);
                return null;
            }

            var actualTotal = parseFloatOrNull(inTotal.input.value);
            var preCharge   = parseFloatOrNull(refData['PRE-CHARGE PIPING LENGTH (FT)']);
            var addCharge   = parseFloatOrNull(refData['ADDITIONAL CHARGE (OZ/FT)']);
            var factoryOz   = parseFloatOrNull(refData['FACTORY CHARGE (OZ)']);

            if (actualTotal === null || preCharge === null ||
                addCharge === null || factoryOz === null) {
                calcAdd.update(null, null);
                calcTotal.update(null, null);
                return null;
            }

            var addedOz = Math.max(0, actualTotal - preCharge) * addCharge;
            var totalOz = addedOz + factoryOz;
            calcAdd.update(addedOz, addedOz / 16);
            calcTotal.update(totalOz, totalOz / 16);
            return totalOz;
        }

        function persistAndBubble() {
            // When the IDU column is hidden we still preserve any
            // previously-saved value so the user can re-enable the
            // column (by adding a multi-zone system) without losing data.
            var actualVertIdu = inIdu
                ? parseFloatOrNull(inIdu.input.value)
                : (savedInputs.actualVertIdu == null ? null : savedInputs.actualVertIdu);
            HHpro.Cart.updateItem(item.instanceId, {
                refrigerantInputs: {
                    actualVertOdu: parseFloatOrNull(inOdu.input.value),
                    actualTotal:   parseFloatOrNull(inTotal.input.value),
                    actualVertIdu: actualVertIdu
                }
            });
            onRecalc();
        }

        var inputs = [inOdu, inTotal];
        if (inIdu) inputs.push(inIdu);
        inputs.forEach(function (ic) {
            if (ic.input.disabled) return;
            ic.input.addEventListener('input', function () {
                ic.checkWarning();
                persistAndBubble();
            });
        });

        // Initial pass: warning state only -- no persist (no user input
        // has happened) and no recalc (the explicit recomputeTotals at
        // the end of renderRefrigerantContent handles the first pass).
        inOdu.checkWarning();
        inTotal.checkWarning();
        if (inIdu) inIdu.checkWarning();

        return { element: tr, recalc: recalc };
    }

    function appendIdCells(tr, item, selection) {
        var cols = MODEL_COLS_BY_PRODUCT[item.productKey];
        var rows = (selection && selection.rows) || [];

        // Outdoor cell -- system tag stacked over outdoor model.
        // Outdoor data is system-level so we read from row 0.
        var outdoorTag   = (item.tag && String(item.tag).trim()) || '';
        var outdoorModel = cols && rows.length ? readCell(rows[0], cols.outdoor.model) : '';
        tr.appendChild(makeUnitIdCell([{ tag: outdoorTag, model: outdoorModel }]));

        // Indoor cell -- one tag/model pair per row of the selection.
        // For 1:1 systems this is one pair; for multi-zone mini splits
        // it's one pair per zone, stacked vertically inside the cell.
        var indoorPairs = rows.map(function (row, idx) {
            return {
                tag:   (item.indoorTags && item.indoorTags[idx]) || '',
                model: cols ? readCell(row, cols.indoor.model) : ''
            };
        }).filter(function (p) {
            return p.tag || p.model;
        });
        if (!indoorPairs.length) indoorPairs.push({ tag: '', model: '' });
        tr.appendChild(makeUnitIdCell(indoorPairs));
    }

    /**
     * Build a "unit identification" cell -- one or more {tag, model}
     * pairs stacked vertically. Tag renders bold/blue on its own line;
     * the model sits beneath it. Multiple pairs (multi-zone indoor
     * units) get a small visual gap between them.
     */
    function makeUnitIdCell(pairs) {
        var td = document.createElement('td');
        td.className = 'refrigerant-id-cell';
        if (!pairs.length) {
            td.textContent = '—';
            return td;
        }
        pairs.forEach(function (p, idx) {
            var block = document.createElement('div');
            block.className = 'refrigerant-id-block';
            if (idx > 0) block.classList.add('refrigerant-id-block-divider');

            var tagEl = document.createElement('div');
            tagEl.className = 'refrigerant-id-tag';
            tagEl.textContent = p.tag || '—';
            block.appendChild(tagEl);

            var modelEl = document.createElement('div');
            modelEl.className = 'refrigerant-id-model';
            modelEl.textContent = p.model || '—';
            block.appendChild(modelEl);

            td.appendChild(block);
        });
        return td;
    }

    function appendFactoryCells(tr, refData, isMultiSplit) {
        // 1. Refrigerant
        tr.appendChild(makeFactoryCell(refData['REFRIGERANT']));

        // 2. Line Sizes -- combined liquid + suction, stacked.
        tr.appendChild(makeStackedFactoryCell([
            { label: 'Liquid:',  value: refData['LIQUID LINE CONNECTION (IN)'],  unit: '"' },
            { label: 'Suction:', value: refData['SUCTION LINE CONNECTION (IN)'], unit: '"' }
        ]));

        // 3. Max Vert ODU→IDU
        tr.appendChild(makeFactoryCell(refData['MAX VERTICAL SEPARATION (ODU TO IDU) (FT)'], 'ft'));

        // 4. Max Vert IDU→IDU (N/A on 1:1 systems so the table stays
        //    rectangular but the cell reads as not-applicable).
        if (isMultiSplit) {
            tr.appendChild(makeFactoryCell(refData['MAX VERTICAL SEPARATION (IDU TO IDU) (FT)'], 'ft'));
        } else {
            tr.appendChild(makeNaCell());
        }

        // 5. Max Total Line-set
        tr.appendChild(makeFactoryCell(refData['MAX TOTAL LINE SET (FT)'], 'ft'));

        // 6. Factory Charge -- combined oz / lbs / pre-charge length,
        //    stacked. The third line is the pre-charge piping length
        //    (the line-set length the factory charge already covers),
        //    which used to live in its own column.
        tr.appendChild(makeStackedFactoryCell([
            { value: refData['FACTORY CHARGE (OZ)'],         unit: 'oz' },
            { value: refData['FACTORY CHARGE (LBS)'],        unit: 'lbs' },
            { value: refData['PRE-CHARGE PIPING LENGTH (FT)'], unit: 'ft' }
        ]));

        // 7. Additional Charge
        tr.appendChild(makeFactoryCell(refData['ADDITIONAL CHARGE (OZ/FT)'], 'oz/ft'));
    }

    // -----------------------------------------------------------------
    // Reference column
    // -----------------------------------------------------------------
    // Last cell in each refrigerant row -- a link to the most relevant
    // PDF for the selected system:
    //
    //   Multi Position Splits:
    //     - Long Line Set Guide (Light Commercial Three Phase) when the
    //       outdoor unit is 208/3 or 460/3.
    //     - Long Line Set Guide (Unitary Single Phase) when the outdoor
    //       unit is 208/1, the system is 1.5-5 ton, AND the compressor
    //       is NOT an inverter (the guide doesn't apply to inverter-
    //       driven systems).
    //     - Otherwise: outdoor unit Installation Manual.
    //
    //   Gas Splits:
    //     Same rules as Multi Position Splits, but the outdoor electrical
    //     column is S (vs W) and includes a frequency segment in the
    //     middle of the string (e.g. "208/60/1" vs "208/1"); compressor
    //     stages are in column Z (vs AD). Phase is matched off the last
    //     "/N" segment so both formats are handled consistently.
    //
    //   Mini Splits:
    //     The long-line-set guides don't apply -- always link to the
    //     outdoor unit's installation manual.
    // -----------------------------------------------------------------

    function buildReferenceCell(item, selection, data) {
        var td = document.createElement('td');
        td.className = 'refrigerant-reference-cell';

        var ref = resolveReferencePdf(item, selection, data);
        if (!ref) {
            td.textContent = '—';
            return td;
        }

        var link = document.createElement('a');
        link.href = ref.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.className = 'refrigerant-reference-link';
        link.textContent = ref.label;
        if (ref.title) link.title = ref.title;
        td.appendChild(link);
        return td;
    }

    function resolveReferencePdf(item, selection, data) {
        var product = (HHpro.Data && HHpro.Data.getProduct)
            ? HHpro.Data.getProduct(item.productKey) : null;
        var assetsFolder = (product && product.assetsFolder) || '';

        if (item.productKey === 'multi_position_splits' ||
            item.productKey === 'gas_splits') {
            var rows = (selection && selection.rows) || [];
            var firstRow = rows[0] || {};
            var sched = firstRow.scheduleData || {};
            var filterData = firstRow.filterData || {};

            // Per-product source columns. Multi Position writes voltage
            // as "208/1" in W and stages in AD; Gas Splits writes
            // "208/60/1" in S and stages in Z.
            var elecCol = item.productKey === 'gas_splits' ? 'S' : 'W';
            var stagesCol = item.productKey === 'gas_splits' ? 'Z' : 'AD';

            var outdoorElectrical = String(sched[elecCol] || '').trim();
            var stages = String(sched[stagesCol] || '').trim().toLowerCase();
            var size = parseFloat(filterData['SIZE']);

            // Voltage = first "/" segment; phase = last "/" segment. This
            // handles both "208/1" (Multi Position) and "208/60/1" (Gas
            // Splits) without product-specific string equality checks.
            var parts = outdoorElectrical.split('/');
            var voltage = parts[0] || '';
            var phase = parts.length > 1 ? parts[parts.length - 1] : '';

            var isThreePhase = phase === '3' && (voltage === '208' || voltage === '460');
            var isUnitarySinglePhase = phase === '1' && voltage === '208' &&
                                        !isNaN(size) && size >= 1.5 && size <= 5 &&
                                        stages !== 'inverter';

            if (isThreePhase) {
                return {
                    url: encodeURI(assetsFolder +
                        '/Long Line Set Application Guide - Light Commercial Three Phase.pdf'),
                    label: 'Long Line Set Guide',
                    title: 'Long Line Set Application Guide — Light Commercial Three Phase'
                };
            }
            if (isUnitarySinglePhase) {
                return {
                    url: encodeURI(assetsFolder +
                        '/Long Line Set Application Guide - Unitary Single Phase.pdf'),
                    label: 'Long Line Set Guide',
                    title: 'Long Line Set Application Guide — Unitary Single Phase'
                };
            }
        }

        return resolveOutdoorIomLink(assetsFolder, selection, data);
    }

    function resolveOutdoorIomLink(assetsFolder, selection, data) {
        var docColumns = (data && data.documentationColumns) || [];
        var iomColumn = null;
        for (var i = 0; i < docColumns.length; i++) {
            if (docColumns[i].name === 'INSTALLATION MANUAL (OUTDOOR)') {
                iomColumn = docColumns[i];
                break;
            }
        }
        if (!iomColumn) return null;

        var rows = (selection && selection.rows) || [];
        var firstRow = rows[0] || {};
        var docData = firstRow.documentationData || {};
        var filename = docData[iomColumn.name];
        if (!filename) return null;

        var url = (assetsFolder || '') + '/' + (iomColumn.folder || '') +
                  '/' + filename + '.' + iomColumn.fileExtension;
        return {
            url: encodeURI(url),
            label: 'Outdoor Unit IOM',
            title: filename + '.' + iomColumn.fileExtension
        };
    }

    function makeFactoryCell(raw, unit) {
        var td = document.createElement('td');
        td.className = 'refrigerant-factory-cell';
        if (raw === null || raw === undefined || raw === '' || raw === '-') {
            td.textContent = '—';
        } else {
            td.textContent = unit ? String(raw) + ' ' + unit : String(raw);
        }
        return td;
    }

    function makeNaCell() {
        var td = document.createElement('td');
        td.className = 'refrigerant-factory-cell refrigerant-cell-na';
        td.textContent = 'N/A';
        return td;
    }

    /**
     * Cell with multiple stacked lines, each line being either a
     * "value unit" pair (e.g. "39.2 oz") or a "label value unit"
     * triple (e.g. "L: 0.25\""). Used for combined oz/lbs cells and
     * the combined Line Sizes cell. Lines whose value is missing or
     * "-" render as a single-line em-dash to keep the cell compact.
     */
    function makeStackedFactoryCell(lines) {
        var td = document.createElement('td');
        td.className = 'refrigerant-factory-cell refrigerant-stacked-cell';
        var hasAny = false;
        lines.forEach(function (l) {
            var v = l.value;
            if (v === null || v === undefined || v === '' || v === '-') return;
            hasAny = true;
            var line = document.createElement('span');
            line.className = 'refrigerant-stacked-line';
            var parts = [];
            if (l.label) parts.push(l.label);
            parts.push(String(v) + (l.unit ? (l.unit === '"' ? l.unit : ' ' + l.unit) : ''));
            line.textContent = parts.join(' ');
            td.appendChild(line);
        });
        if (!hasAny) td.textContent = '—';
        return td;
    }

    function makeInputCell(key, max, disabled, savedValue) {
        var td = document.createElement('td');
        td.className = 'refrigerant-input-cell';

        var input = document.createElement('input');
        input.type = 'number';
        input.step = 'any';
        input.min = '0';
        input.className = 'refrigerant-row-input';
        input.placeholder = disabled ? 'N/A' : '—';
        if (disabled) {
            input.disabled = true;
            td.classList.add('refrigerant-cell-na');
        }
        if (savedValue !== null && savedValue !== undefined && savedValue !== '') {
            input.value = String(savedValue);
        }
        td.appendChild(input);

        function isOverMax() {
            if (disabled) return false;
            var v = parseFloatOrNull(input.value);
            return v !== null && max !== null && v > max;
        }

        function checkWarning() {
            if (disabled) return;
            if (isOverMax()) {
                td.classList.add('refrigerant-input-cell-warn');
                td.title = '⚠  Exceeds the system’s maximum of ' + max + ' ft.';
            } else {
                td.classList.remove('refrigerant-input-cell-warn');
                td.title = '';
            }
        }

        return { cell: td, input: input, checkWarning: checkWarning, isOverMax: isOverMax };
    }

    /**
     * Calc cell with two stacked lines: oz on top, lbs below. Returns
     * the cell + an `update(oz, lbs)` function that fills both lines
     * (or shows "—" when null is passed for either).
     */
    function makeCalcStackedCell(extraClass) {
        var td = document.createElement('td');
        td.className = 'refrigerant-calc-cell refrigerant-stacked-cell' +
            (extraClass ? ' ' + extraClass : '');

        var ozLine  = document.createElement('span');
        ozLine.className = 'refrigerant-stacked-line';
        ozLine.textContent = '—';
        td.appendChild(ozLine);

        var lbsLine = document.createElement('span');
        lbsLine.className = 'refrigerant-stacked-line';
        lbsLine.textContent = '';
        td.appendChild(lbsLine);

        function update(oz, lbs) {
            if (oz === null || oz === undefined || isNaN(oz)) {
                ozLine.textContent  = '—';
                lbsLine.textContent = '';
                return;
            }
            ozLine.textContent  = oz.toFixed(2)  + ' oz';
            lbsLine.textContent = lbs.toFixed(3) + ' lbs';
        }
        return { cell: td, update: update };
    }

    function findSelection(data, selectionId) {
        var sels = (data && data.selections) || [];
        for (var i = 0; i < sels.length; i++) {
            if (sels[i].id === selectionId) return sels[i];
        }
        return null;
    }

    function readRefrigerantData(selection) {
        // Refrigerant data is system-level (outdoor unit), so it's the
        // same on every row of a multi-row selection. Pull from row 0.
        if (!selection || !selection.rows || !selection.rows.length) return {};
        return selection.rows[0].refrigerantData || {};
    }

    function isNumericRefValue(v) {
        if (v === null || v === undefined) return false;
        if (typeof v === 'number') return !isNaN(v);
        var s = String(v).trim();
        if (!s || s === '-') return false;
        return !isNaN(parseFloat(s));
    }

    function refrigerantHasData(refData) {
        // System has actionable data only if all the fields needed for
        // the calc are present and numeric. If any are missing or "-",
        // we direct the engineer to the IOM instead.
        if (!refData) return false;
        return isNumericRefValue(refData['FACTORY CHARGE (OZ)']) &&
               isNumericRefValue(refData['ADDITIONAL CHARGE (OZ/FT)']) &&
               isNumericRefValue(refData['PRE-CHARGE PIPING LENGTH (FT)']);
    }

    function parseFloatOrNull(v) {
        if (v === null || v === undefined || v === '') return null;
        var n = parseFloat(v);
        return isNaN(n) ? null : n;
    }

    function readCell(row, col) {
        if (!row || !row.scheduleData) return '';
        var v = row.scheduleData[col];
        return (v === null || v === undefined) ? '' : String(v).trim();
    }

    function buildProjectTotalsCard() {
        var card = document.createElement('div');
        card.className = 'refrigerant-totals-card';

        var hdr = document.createElement('h3');
        hdr.className = 'refrigerant-totals-header';
        hdr.textContent = 'Project Total Refrigerant';
        card.appendChild(hdr);

        var ozEl = document.createElement('div');
        ozEl.className = 'refrigerant-totals-value';
        ozEl.dataset.unit = 'oz';
        ozEl.textContent = '—';

        var lbsEl = document.createElement('div');
        lbsEl.className = 'refrigerant-totals-value';
        lbsEl.dataset.unit = 'lbs';
        lbsEl.textContent = 'Enter line-set distances above to calculate.';
        lbsEl.classList.add('refrigerant-totals-hint');

        card.appendChild(ozEl);
        card.appendChild(lbsEl);
        return card;
    }

    function updateTotalsCard(card, totalOz) {
        var ozEl = card.querySelector('[data-unit="oz"]');
        var lbsEl = card.querySelector('[data-unit="lbs"]');
        if (totalOz === null) {
            ozEl.textContent = '—';
            lbsEl.textContent = 'Enter line-set distances above to calculate.';
            lbsEl.classList.add('refrigerant-totals-hint');
        } else {
            ozEl.textContent = totalOz.toFixed(2) + ' oz';
            lbsEl.textContent = (totalOz / 16).toFixed(3) + ' lbs';
            lbsEl.classList.remove('refrigerant-totals-hint');
        }
    }

    // =================================================================
    // Refrigerant Report PDF
    // -----------------------------------------------------------------
    // Opens a clean, printable HTML document in a new window showing
    // every refrigerant system, its factory specs, the engineer's
    // entered field measurements, and the calculated charge to add /
    // total charge. Uses the browser's "Save as PDF" print option.
    // =================================================================

    /**
     * Public entry point for the Refrigerant Report PDF. Loads the
     * product JSONs as needed (gracefully handles the Files tab where
     * the data is not pre-loaded) and pops up the report window.
     */
    function openRefrigerantReport(allItems, dataByKey, projectName) {
        var refItems = (allItems || []).filter(function (it) {
            return REFRIGERANT_PRODUCT_KEYS.indexOf(it.productKey) >= 0;
        });
        if (!refItems.length) {
            alert('No refrigerant systems in this project.');
            return;
        }

        if (dataByKey) {
            renderRefrigerantReportWindow(refItems, dataByKey, projectName);
            return;
        }

        // Fallback: load product data ourselves (Files-tab entry point).
        var keys = {};
        refItems.forEach(function (it) { keys[it.productKey] = true; });
        var keyList = Object.keys(keys);
        Promise.all(keyList.map(function (k) {
            return HHpro.Data.loadProduct(k).then(function (d) {
                return { key: k, data: d };
            });
        })).then(function (results) {
            var loaded = {};
            results.forEach(function (r) { loaded[r.key] = r.data; });
            renderRefrigerantReportWindow(refItems, loaded, projectName);
        }).catch(function (err) {
            alert('Could not build refrigerant report: ' +
                  (err && err.message ? err.message : String(err)));
        });
    }

    function renderRefrigerantReportWindow(refItems, dataByKey, projectName) {
        var w = window.open('', '_blank');
        if (!w) {
            alert('Please allow popups from this site to use the PDF report.');
            return;
        }

        var docTitle = (projectName ? projectName + ' - ' : '') + 'Refrigerant Report';
        w.document.open();
        w.document.write(buildRefrigerantReportHtml(docTitle, projectName,
                                                    refItems, dataByKey));
        w.document.close();
        w.focus();
        setTimeout(function () {
            try { w.print(); } catch (e) { /* window may have closed */ }
        }, 300);
    }

    function buildRefrigerantReportHtml(docTitle, projectName, refItems, dataByKey) {
        var showActualVertIdu = hasAnyMultiSplit(refItems, dataByKey);
        var rowsHtml = [];
        var totalOz = 0;
        var totalHasAny = false;

        refItems.forEach(function (item) {
            var data = dataByKey[item.productKey];
            if (!data) return;
            var built = buildReportRow(item, data, showActualVertIdu);
            rowsHtml.push(built.html);
            if (built.totalOz !== null && !isNaN(built.totalOz)) {
                totalOz += built.totalOz;
                totalHasAny = true;
            }
        });

        var dateStr = (function () {
            var d = new Date();
            return (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
        })();

        var totalsLine = totalHasAny
            ? totalOz.toFixed(2) + ' oz / ' + (totalOz / 16).toFixed(3) + ' lbs'
            : 'Enter line-set distances on the Refrigerant tab to calculate.';

        return '<!DOCTYPE html>\n<html><head>' +
            '<meta charset="UTF-8">' +
            '<title>' + reportEscape(docTitle) + '</title>' +
            '<style>' + refrigerantReportCss() + '</style>' +
          '</head><body>' +
            '<header class="rep-header">' +
              '<div class="rep-title">REFRIGERANT REPORT</div>' +
              '<div class="rep-meta">' +
                (projectName ? '<span><strong>Project:</strong> ' +
                    reportEscape(projectName) + '</span>' : '') +
                '<span><strong>Date:</strong> ' + reportEscape(dateStr) + '</span>' +
              '</div>' +
            '</header>' +
            buildRefrigerantReportTable(rowsHtml, showActualVertIdu) +
            '<div class="rep-totals">' +
              '<span class="rep-totals-label">Project Total Refrigerant:</span> ' +
              '<span class="rep-totals-value">' + reportEscape(totalsLine) + '</span>' +
            '</div>' +
            '<footer class="rep-footer">Created with HHpro-HVAC.com</footer>' +
          '</body></html>';
    }

    function buildRefrigerantReportTable(rowsHtml, showActualVertIdu) {
        var fieldSpan = showActualVertIdu ? 3 : 2;
        var head =
            '<table class="rep-table">' +
              '<colgroup>' +
                '<col><col>' +                                   // System (2)
                '<col><col><col><col><col><col><col>' +          // Factory (7)
                (showActualVertIdu
                    ? '<col><col><col>'                           // Field (3)
                    : '<col><col>') +                             // Field (2)
                '<col><col>' +                                   // Calc (2)
                '<col>' +                                        // Reference (1)
              '</colgroup>' +
              '<thead>' +
                '<tr class="rep-tier1">' +
                  '<th colspan="2">System</th>' +
                  '<th colspan="7">Factory Values</th>' +
                  '<th colspan="' + fieldSpan + '">Field Measurements</th>' +
                  '<th colspan="2">Calculated Charge</th>' +
                  '<th>Reference</th>' +
                '</tr>' +
                '<tr class="rep-tier2">' +
                  '<th>Outdoor</th><th>Indoor(s)</th>' +
                  '<th>Refrigerant</th><th>Line Sizes</th>' +
                  '<th>Max Vert<br>ODU→IDU</th>' +
                  '<th>Max Vert<br>IDU→IDU</th>' +
                  '<th>Max Total</th>' +
                  '<th>Factory<br>Charge</th><th>Additional</th>' +
                  '<th>Actual Vert<br>ODU→IDU</th>' +
                  '<th>Actual Total</th>' +
                  (showActualVertIdu ? '<th>Actual Vert<br>IDU→IDU</th>' : '') +
                  '<th>To Add</th>' +
                  '<th>Total<br>Charge</th>' +
                  '<th>Application<br>Guide</th>' +
                '</tr>' +
              '</thead>' +
              '<tbody>' + rowsHtml.join('') + '</tbody>' +
            '</table>';
        return head;
    }

    /**
     * Build one <tr> for the report: identification cells, then either
     * a "no data" message cell or the full set of factory / field /
     * calc cells. Field measurement values come from the saved cart
     * item, so any inputs the engineer entered on the Refrigerant tab
     * are reflected. Returns { html, totalOz } so the caller can add
     * the row to the project total.
     */
    function buildReportRow(item, data, showActualVertIdu) {
        var selection = findSelection(data, item.selectionId);
        var refData = readRefrigerantData(selection);
        var hasData = refrigerantHasData(refData);
        var isMultiSplit = !!(selection && selection.rows && selection.rows.length > 1 &&
                              item.productKey === 'mini_splits');
        var inputs = item.refrigerantInputs || {};

        var idHtml = reportIdCell(item, selection, 'outdoor') +
                     reportIdCell(item, selection, 'indoor');

        var ref = resolveReferencePdf(item, selection, data);
        var refHtml = ref
            ? '<td class="rep-ref"><a href="' + reportEscape(ref.url) +
              '" target="_blank" rel="noopener">' + reportEscape(ref.label) + '</a></td>'
            : '<td class="rep-ref">—</td>';

        if (!hasData) {
            var noDataSpan = refrigerantNonIdColspan(showActualVertIdu);
            var html = '<tr>' + idHtml +
                '<td class="rep-no-data" colspan="' + noDataSpan + '">' +
                  'Refer to outdoor unit installation manual for refrigerant calculations.' +
                '</td>' + refHtml + '</tr>';
            return { html: html, totalOz: null };
        }

        var refCells = '';
        // Factory values (7)
        refCells += '<td>' + reportFactoryValue(refData['REFRIGERANT']) + '</td>';
        refCells += '<td>' + reportLineSizesValue(refData) + '</td>';
        refCells += '<td>' + reportFactoryValue(refData['MAX VERTICAL SEPARATION (ODU TO IDU) (FT)'], 'ft') + '</td>';
        refCells += '<td' + (isMultiSplit ? '' : ' class="rep-na"') + '>' +
                    (isMultiSplit
                        ? reportFactoryValue(refData['MAX VERTICAL SEPARATION (IDU TO IDU) (FT)'], 'ft')
                        : 'N/A') + '</td>';
        refCells += '<td>' + reportFactoryValue(refData['MAX TOTAL LINE SET (FT)'], 'ft') + '</td>';
        refCells += '<td>' + reportFactoryChargeStack(refData) + '</td>';
        refCells += '<td>' + reportFactoryValue(refData['ADDITIONAL CHARGE (OZ/FT)'], 'oz/ft') + '</td>';

        // Field measurements (2 or 3) -- match the on-screen behavior:
        // any value above the system's maximum highlights the cell red
        // and suppresses the calculated charge for the row.
        var maxOduFt   = parseFloatOrNull(refData['MAX VERTICAL SEPARATION (ODU TO IDU) (FT)']);
        var maxTotalFt = parseFloatOrNull(refData['MAX TOTAL LINE SET (FT)']);
        var maxIduFt   = parseFloatOrNull(refData['MAX VERTICAL SEPARATION (IDU TO IDU) (FT)']);
        var oduFt      = parseFloatOrNull(inputs.actualVertOdu);
        var totalFt    = parseFloatOrNull(inputs.actualTotal);
        var iduFt      = parseFloatOrNull(inputs.actualVertIdu);
        var oduOver    = oduFt   !== null && maxOduFt   !== null && oduFt   > maxOduFt;
        var totalOver  = totalFt !== null && maxTotalFt !== null && totalFt > maxTotalFt;
        var iduOver    = isMultiSplit && iduFt !== null && maxIduFt !== null && iduFt > maxIduFt;
        var anyOverMax = oduOver || totalOver || iduOver;

        refCells += '<td' + (oduOver ? ' class="rep-warn"' : '') + '>' +
                    reportFieldValue(inputs.actualVertOdu) + '</td>';
        refCells += '<td' + (totalOver ? ' class="rep-warn"' : '') + '>' +
                    reportFieldValue(inputs.actualTotal) + '</td>';
        if (showActualVertIdu) {
            if (isMultiSplit) {
                refCells += '<td' + (iduOver ? ' class="rep-warn"' : '') + '>' +
                            reportFieldValue(inputs.actualVertIdu) + '</td>';
            } else {
                refCells += '<td class="rep-na">N/A</td>';
            }
        }

        // Calculated charge (2)
        var actualTotal = parseFloatOrNull(inputs.actualTotal);
        var preCharge   = parseFloatOrNull(refData['PRE-CHARGE PIPING LENGTH (FT)']);
        var addCharge   = parseFloatOrNull(refData['ADDITIONAL CHARGE (OZ/FT)']);
        var factoryOz   = parseFloatOrNull(refData['FACTORY CHARGE (OZ)']);

        var totalOz = null;
        if (!anyOverMax && actualTotal !== null && preCharge !== null &&
            addCharge !== null && factoryOz !== null) {
            var addedOz = Math.max(0, actualTotal - preCharge) * addCharge;
            totalOz = addedOz + factoryOz;
            refCells += '<td>' + reportOzLbsStack(addedOz) + '</td>';
            refCells += '<td class="rep-emph">' + reportOzLbsStack(totalOz) + '</td>';
        } else {
            refCells += '<td>—</td><td class="rep-emph">—</td>';
        }

        return {
            html: '<tr>' + idHtml + refCells + refHtml + '</tr>',
            totalOz: totalOz
        };
    }

    function reportIdCell(item, selection, which) {
        var cols = MODEL_COLS_BY_PRODUCT[item.productKey];
        var rows = (selection && selection.rows) || [];
        if (!cols || !rows.length) return '<td class="rep-id">—</td>';

        if (which === 'outdoor') {
            var oTag = (item.tag && String(item.tag).trim()) || '';
            var oModel = readCell(rows[0], cols.outdoor.model) || '';
            return '<td class="rep-id">' +
                   '<div class="rep-id-tag">' + reportEscape(oTag || '—') + '</div>' +
                   '<div class="rep-id-model">' + reportEscape(oModel || '—') + '</div>' +
                   '</td>';
        }

        // Indoor cell: one tag/model pair per row of the selection.
        var pairs = rows.map(function (row, idx) {
            return {
                tag:   (item.indoorTags && item.indoorTags[idx]) || '',
                model: readCell(row, cols.indoor.model) || ''
            };
        }).filter(function (p) { return p.tag || p.model; });
        if (!pairs.length) pairs.push({ tag: '', model: '' });

        return '<td class="rep-id">' +
               pairs.map(function (p, idx) {
                   return '<div class="rep-id-block' +
                          (idx > 0 ? ' rep-id-block-divider' : '') + '">' +
                          '<div class="rep-id-tag">' + reportEscape(p.tag || '—') + '</div>' +
                          '<div class="rep-id-model">' + reportEscape(p.model || '—') + '</div>' +
                          '</div>';
               }).join('') +
               '</td>';
    }

    function reportFactoryValue(raw, unit) {
        if (raw === null || raw === undefined || raw === '' || raw === '-') return '—';
        return reportEscape(unit ? (String(raw) + ' ' + unit) : String(raw));
    }

    function reportLineSizesValue(refData) {
        var liquid  = refData['LIQUID LINE CONNECTION (IN)'];
        var suction = refData['SUCTION LINE CONNECTION (IN)'];
        var lines = [];
        if (liquid && liquid !== '-') lines.push('Liquid: ' + liquid + '"');
        if (suction && suction !== '-') lines.push('Suction: ' + suction + '"');
        if (!lines.length) return '—';
        return lines.map(reportEscape).join('<br>');
    }

    function reportFactoryChargeStack(refData) {
        var oz  = refData['FACTORY CHARGE (OZ)'];
        var lbs = refData['FACTORY CHARGE (LBS)'];
        var ft  = refData['PRE-CHARGE PIPING LENGTH (FT)'];
        var lines = [];
        if (oz != null && oz !== '' && oz !== '-') lines.push(oz + ' oz');
        if (lbs != null && lbs !== '' && lbs !== '-') lines.push(lbs + ' lbs');
        if (ft != null && ft !== '' && ft !== '-') lines.push(ft + ' ft');
        if (!lines.length) return '—';
        return lines.map(reportEscape).join('<br>');
    }

    function reportFieldValue(v) {
        if (v === null || v === undefined || v === '') return '—';
        return reportEscape(String(v) + ' ft');
    }

    function reportOzLbsStack(oz) {
        if (oz === null || oz === undefined || isNaN(oz)) return '—';
        return reportEscape(oz.toFixed(2) + ' oz') + '<br>' +
               reportEscape((oz / 16).toFixed(3) + ' lbs');
    }

    function reportEscape(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function refrigerantReportCss() {
        return '' +
            '@page { size: letter landscape; margin: 0.4in; }' +
            'html, body { margin: 0; padding: 0; background: #fff; color: #000;' +
                  ' font-family: Calibri, Arial, sans-serif; font-size: 9pt; }' +
            '.rep-header { display: flex; justify-content: space-between;' +
                  ' align-items: flex-end; margin-bottom: 8px;' +
                  ' border-bottom: 2px solid #000; padding-bottom: 4px; }' +
            '.rep-title { font-size: 16pt; font-weight: 700;' +
                  ' letter-spacing: 0.04em; }' +
            '.rep-meta { font-size: 9pt; }' +
            '.rep-meta span { margin-left: 16px; }' +
            'table.rep-table { border-collapse: collapse; width: 100%;' +
                  ' table-layout: auto; font-size: 8pt; }' +
            '.rep-table th, .rep-table td { border: 1px solid #000;' +
                  ' padding: 4px 6px; text-align: center; vertical-align: middle;' +
                  ' background: #fff; color: #000; }' +
            '.rep-table thead th { font-weight: 700; }' +
            '.rep-tier1 th { background: #222 !important; color: #fff !important;' +
                  ' text-transform: uppercase; letter-spacing: 0.05em;' +
                  ' font-size: 8pt; }' +
            '.rep-tier2 th { background: #f0f0f0 !important; font-size: 7.5pt;' +
                  ' text-transform: uppercase; letter-spacing: 0.03em;' +
                  ' line-height: 1.2; }' +
            '.rep-table td.rep-id { text-align: left; min-width: 110px; }' +
            '.rep-id-tag { font-weight: 700; font-size: 8.5pt; }' +
            '.rep-id-model { font-size: 7.5pt; word-break: break-all; }' +
            '.rep-id-block + .rep-id-block-divider { margin-top: 3px;' +
                  ' padding-top: 3px; border-top: 1px dotted #888; }' +
            '.rep-na { color: #888; font-style: italic; }' +
            '.rep-no-data { text-align: left; font-style: italic; color: #555; }' +
            // Field-measurement cell whose value exceeds the system\'s
            // maximum -- mirrors the on-screen red highlight so the
            // engineer can see the same flag on the printed report.
            '.rep-warn { background: #fde2e2 !important;' +
                  ' color: #b91c1c !important; font-weight: 700; }' +
            '.rep-emph { font-weight: 700; }' +
            '.rep-ref a { color: #0a4a8a; text-decoration: underline; }' +
            '.rep-totals { margin-top: 12px; padding: 8px 12px;' +
                  ' border: 1.5px solid #000; font-size: 11pt; }' +
            '.rep-totals-label { font-weight: 700; text-transform: uppercase;' +
                  ' letter-spacing: 0.04em; }' +
            '.rep-totals-value { font-weight: 700; margin-left: 6px; }' +
            '.rep-footer { margin-top: 14px; text-align: right;' +
                  ' font-size: 7pt; color: #888; font-style: italic; }' +
            '@media print {' +
                ' * { -webkit-print-color-adjust: exact !important;' +
                '     print-color-adjust: exact !important; } }';
    }

    // Expose so the Files-tab toolbar (which renders independently of
    // the refrigerant data load) can launch the report.
    HHpro.Views.project_view.openRefrigerantReport = openRefrigerantReport;

    // =================================================================
    // Product tab body: toolbar + schedule
    // =================================================================

    function buildProductTabBody(productKey, items, data) {
        var wrap = document.createElement('div');
        wrap.className = 'project-product-tab';

        // Engineer templates carry their own fixed columns + notes, so
        // the native column-hiding and notes-editor controls don't apply.
        var tplActive = !!activeTemplate(productKey);
        var editing = !!editModeByProduct[productKey];

        wrap.appendChild(buildProductToolbar(productKey, items, data, tplActive, editing));

        if (editing) {
            // Edit mode replaces the normal schedule with a fully
            // editable grid (every cell). Notes live inside that grid.
            wrap.appendChild(buildEditableSchedule(productKey, items, data));
            return wrap;
        }

        var extra = HHpro.Cart.getProjectExtra(productKey) || {};
        var hidden = Array.isArray(extra.hiddenColumns) ? extra.hiddenColumns.slice() : [];

        wrap.appendChild(buildProjectSchedule(productKey, items, data, hidden));
        if (!tplActive) {
            wrap.appendChild(buildScheduleNotesSection(productKey, data));
        }

        return wrap;
    }

    function buildProductToolbar(productKey, items, data, tplActive, editing) {
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

        // Column hiding only applies to the native layout; an engineer
        // template defines a fixed column set.
        if (!tplActive) {
            var colsBtn = document.createElement('button');
            colsBtn.type = 'button';
            colsBtn.className = 'projects-btn projects-btn-secondary';
            colsBtn.textContent = 'Add / Remove Columns';
            colsBtn.addEventListener('click', function () {
                openColumnsModal(productKey, data);
            });
            bar.appendChild(colsBtn);
        }

        // Excel / CAD / PDF export buttons - all route through HHpro.Export.
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
        cadBtn.addEventListener('click', function () {
            if (HHpro.Export && typeof HHpro.Export.toCAD === 'function') {
                HHpro.Export.toCAD(productKey, items, data, projectName);
            }
        });
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

        // Edit Schedule: toggle a fully-editable grid where any cell's
        // text can be overridden. Edits flow to the Excel/CAD/PDF output.
        var editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'projects-btn ' +
            (editing ? 'projects-btn-primary' : 'projects-btn-secondary');
        editBtn.textContent = editing ? 'Done Editing' : 'Edit Schedule';
        editBtn.addEventListener('click', function () {
            editModeByProduct[productKey] = !editing;
            HHpro.App.showView('project_view');
        });
        bar.appendChild(editBtn);

        return bar;
    }

    // Fully-editable schedule grid. Renders the same grid the exports
    // use (so structure/labels match) with every non-merged cell as an
    // input. Edits persist as per-cell overrides and are re-applied by
    // HHpro.Export.buildScheduleGrid to both this view and the downloads.
    function buildEditableSchedule(productKey, items, data) {
        var wrap = document.createElement('div');
        wrap.className = 'schedule-wrap project-schedule-wrap';

        var grid = (HHpro.Export && HHpro.Export.buildScheduleGrid)
            ? HHpro.Export.buildScheduleGrid(productKey, items, data) : null;
        if (!grid || !grid.rows.length) {
            var msg = document.createElement('div');
            msg.className = 'zero-results';
            msg.textContent = 'No schedule data found for the items in this tab.';
            wrap.appendChild(msg);
            return wrap;
        }

        var hint = document.createElement('div');
        hint.className = 'tpl-edit-hint';
        hint.textContent = 'Editing every cell — changes save automatically and appear in the '
            + 'Excel/CAD/PDF downloads. Click "Done Editing" when finished.';
        wrap.appendChild(hint);

        wrap.appendChild(renderEditableGridToDom(grid, productKey));
        return wrap;
    }

    function renderEditableGridToDom(grid, productKey) {
        var table = document.createElement('table');
        table.className = 'schedule-table project-schedule-table template-schedule tpl-editing';
        var numHeaderRows = grid.numHeaderRows || 0;

        for (var r = 0; r < grid.rows.length; r++) {
            var row = grid.rows[r];
            if (!row) continue;
            var tr = document.createElement('tr');
            for (var c = 0; c < grid.colCount; c++) {
                var cell = row[c];
                if (!cell || cell.covered) continue;

                var isHeader = cell.title || (r < numHeaderRows && cell.bold);
                var el = document.createElement(isHeader ? 'th' : 'td');
                if (cell.rowSpan > 1) el.rowSpan = cell.rowSpan;
                if (cell.colSpan > 1) el.colSpan = cell.colSpan;

                var cls = [];
                if (cell.title) cls.push('tpl-title');
                else if (isHeader) cls.push('tpl-header');
                if (cell.notesRow) cls.push('tpl-notes');
                if (cell.watermark) cls.push('tpl-watermark');
                if (cell.bold && !isHeader && !cell.notesRow) cls.push('tpl-rowhead');
                if (cell.align === 'left') cls.push('tpl-left');
                if (cls.length) el.className = cls.join(' ');

                el.appendChild(buildCellOverrideInput(productKey, r, c, cell.value));
                tr.appendChild(el);
            }
            table.appendChild(tr);
        }
        return table;
    }

    function buildCellOverrideInput(productKey, r, c, value) {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'tpl-field-input tpl-edit-input';
        var str = (value == null) ? '' : String(value);
        input.value = str;
        // Size the input to its current text so the existing value stays
        // readable (the schedule has many narrow columns; a fixed-width
        // input would clip everything). The table then grows/scrolls
        // horizontally like the normal schedule view.
        input.size = Math.min(Math.max(str.length, 3), 30);
        input.addEventListener('change', function () {
            updateCellOverride(productKey, r, c, input.value);
        });
        return input;
    }

    // Persist a single cell override under the current engineer layout.
    function updateCellOverride(productKey, r, c, value) {
        var engineer = (HHpro.Cart && HHpro.Cart.getProjectEngineer)
            ? HHpro.Cart.getProjectEngineer() : 'hoffman';
        var extra = HHpro.Cart.getProjectExtra(productKey) || {};
        var all = extra.cellOverrides || {};
        var map = all[engineer] || {};
        map[r + ',' + c] = value;
        all[engineer] = map;
        HHpro.Cart.setProjectExtra(productKey, { cellOverrides: all });
    }

    // =================================================================
    // Project-schedule table rendering
    // =================================================================

    // Render a generic export grid (from HHpro.Export.buildScheduleGrid
    // under an engineer template) into a DOM table. Mirrors the grid
    // shape used by the xlsx/dxf/pdf emitters so the screen matches the
    // downloads; cells flagged `editable` become in-place inputs whose
    // values persist on the item as templateFields.
    function renderTemplateGridToDom(grid) {
        var table = document.createElement('table');
        table.className = 'schedule-table project-schedule-table template-schedule';
        var numHeaderRows = grid.numHeaderRows || 0;

        for (var r = 0; r < grid.rows.length; r++) {
            var row = grid.rows[r];
            if (!row) continue;
            var tr = document.createElement('tr');
            for (var c = 0; c < grid.colCount; c++) {
                var cell = row[c];
                if (!cell || cell.covered) continue;

                var isHeader = cell.title || (r < numHeaderRows && cell.bold);
                var el = document.createElement(isHeader ? 'th' : 'td');
                if (cell.rowSpan > 1) el.rowSpan = cell.rowSpan;
                if (cell.colSpan > 1) el.colSpan = cell.colSpan;

                var cls = [];
                if (cell.title) cls.push('tpl-title');
                else if (isHeader) cls.push('tpl-header');
                if (cell.notesRow) cls.push('tpl-notes');
                if (cell.watermark) cls.push('tpl-watermark');
                // Bold non-header cells = transposed attribute row labels.
                if (cell.bold && !isHeader && !cell.notesRow) cls.push('tpl-rowhead');
                if (cell.align === 'left') cls.push('tpl-left');
                if (cls.length) el.className = cls.join(' ');

                if (cell.editable) {
                    el.appendChild(buildTemplateFieldInput(cell));
                } else {
                    el.textContent = (cell.value == null) ? '' : String(cell.value);
                }
                tr.appendChild(el);
            }
            table.appendChild(tr);
        }
        return table;
    }

    function buildTemplateFieldInput(cell) {
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'tpl-field-input';
        input.value = cell.editValue || '';
        input.placeholder = '-';
        input.addEventListener('change', function () {
            updateTemplateField(cell.instanceId, cell.fieldKey, input.value);
        });
        return input;
    }

    // Merge one template field value into the item's templateFields bag
    // and persist via the standard item-patch path.
    function updateTemplateField(instanceId, fieldKey, value) {
        if (!instanceId || !fieldKey) return;
        var item = findLiveItem(instanceId);
        var tf = {};
        if (item && item.templateFields) {
            Object.keys(item.templateFields).forEach(function (k) {
                tf[k] = item.templateFields[k];
            });
        }
        tf[fieldKey] = value;
        if (HHpro.Cart && HHpro.Cart.updateItem) {
            HHpro.Cart.updateItem(instanceId, { templateFields: tf });
        }
    }

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

        // Engineer template active: render the exact grid the exports
        // use (built by HHpro.Export from the template) so the on-screen
        // schedule matches the downloaded Excel/CAD/PDF byte-for-intent.
        if (activeTemplate(productKey) && HHpro.Export && HHpro.Export.buildScheduleGrid) {
            var tplGrid = HHpro.Export.buildScheduleGrid(productKey, items, data);
            wrap.appendChild(renderTemplateGridToDom(tplGrid));
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

    /** Look up the live cart item by instanceId. Used by per-row
     *  click handlers (Docs, etc.) so they read the latest
     *  selectionId after a kW dropdown change rather than the
     *  closure-captured one from build time. */
    function findLiveItem(instanceId) {
        if (!HHpro.Cart || typeof HHpro.Cart.getActiveState !== 'function') return null;
        var st = HHpro.Cart.getActiveState();
        var items = (st && st.items) || [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].instanceId === instanceId) return items[i];
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

        // kW-variant family lookup is needed for the dropdown -- one
        // call per render covers the whole tab. Null when the product
        // doesn't merge kW variants.
        var kwVariants = (HHpro.Schedule && HHpro.Schedule.getKwVariants)
            ? HHpro.Schedule.getKwVariants(productKey) : null;

        selections.forEach(function (entry) {
            var item = entry.item;
            var sel = entry.selection;
            var numRows = sel.rows.length;
            var layout = computeCellLayout(sel, visibleLetters);

            // For kW-merging products, find the family + variant index
            // for this cart item so the dropdown starts on the saved
            // variant and the dependent cells render its values.
            var kwFamilyInfo = null;
            if (kwVariants && HHpro.Schedule && HHpro.Schedule.findKwFamilyForSelection) {
                kwFamilyInfo = HHpro.Schedule.findKwFamilyForSelection(
                    data, productKey, item.selectionId);
            }

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
                    // Look up the selection at click time -- for
                    // kW-merging products the cart item's selectionId
                    // changes when the engineer picks a different kW
                    // from the row's dropdown, and the documentation
                    // varies per variant (different submittal per kW).
                    var docsBtn = document.createElement('button');
                    docsBtn.type = 'button';
                    docsBtn.className = 'project-sched-docs-btn';
                    docsBtn.textContent = 'Docs';
                    docsBtn.title = 'Documents for this item';
                    docsBtn.addEventListener('click', function () {
                        if (HHpro.Docs && typeof HHpro.Docs.openDocsModal === 'function') {
                            var product = HHpro.Data.getProduct(productKey);
                            var liveItem = findLiveItem(item.instanceId) || item;
                            var liveSel = findSelectionById(data, liveItem.selectionId) || sel;
                            HHpro.Docs.openDocsModal(product, liveSel, data);
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
                var depCells = {};
                var depColSet = {};
                if (kwVariants && rowIndex === 0) {
                    (kwVariants.dependentColumns || []).forEach(function (c) {
                        depColSet[c] = true;
                    });
                }

                visibleLetters.forEach(function (colLetter) {
                    var cell = layout[rowIndex][colLetter];
                    if (cell === null) return;
                    var td = document.createElement('td');

                    if (kwVariants && rowIndex === 0 && kwFamilyInfo &&
                        colLetter === kwVariants.variantColumn) {
                        td.classList.add('kw-variant-cell');
                        td.appendChild(buildProjectKwSelect(
                            kwFamilyInfo, item, productKey, data,
                            depCells, kwVariants));
                    } else {
                        td.textContent = formatCellValue(cell.value, colLetter, productKey);
                        if (depColSet[colLetter]) depCells[colLetter] = td;
                    }

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

    /**
     * kW dropdown for the project schedule. Same shape as the browse
     * page (select + chevron) but on change the new variant's
     * selection.id is persisted to the cart item, the dependent
     * cells (Temp Rise / MCA / MOP / etc.) update in place, and the
     * cart-panel label is recomputed.
     */
    function buildProjectKwSelect(familyInfo, item, productKey, data, depCells, kwVariants) {
        var family = familyInfo.family;
        var variants = family.variants;
        var currentIdx = familyInfo.variantIdx;

        var wrap = document.createElement('span');
        wrap.className = 'kw-variant-control';

        var select = document.createElement('select');
        select.className = 'kw-variant-select';
        select.setAttribute('aria-label', 'Aux electric heat (kW)');

        variants.forEach(function (v, idx) {
            var opt = document.createElement('option');
            opt.value = String(idx);
            var kw = v.kw;
            opt.textContent = (kw === null || kw === undefined || kw === '') ? '' : String(kw);
            if (idx === currentIdx) opt.selected = true;
            select.appendChild(opt);
        });

        select.addEventListener('change', function () {
            var idx = parseInt(select.value, 10);
            if (isNaN(idx) || idx < 0 || idx >= variants.length) return;
            currentIdx = idx;
            var newSel = variants[idx].sel;

            // Update dependent cell text in place using the new
            // variant's scheduleData (so the user sees the change
            // immediately without re-rendering the whole table).
            var sd = (newSel.rows[0] && newSel.rows[0].scheduleData) || {};
            (kwVariants.dependentColumns || []).forEach(function (col) {
                var td = depCells[col];
                if (td) td.textContent = formatCellValue(sd[col], col, productKey);
            });

            // Persist the new variant on the cart item. Recompute the
            // label so the cart panel stays in sync.
            var product = HHpro.Data.getProduct(productKey);
            var label = (HHpro.Cart && HHpro.Cart.computeLabel)
                ? HHpro.Cart.computeLabel(product, newSel, data)
                : (item.label || newSel.id);
            HHpro.Cart.updateItem(item.instanceId, {
                selectionId: newSel.id,
                label: label
            });
        });

        var chevron = document.createElement('span');
        chevron.className = 'kw-variant-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '▾';

        wrap.appendChild(select);
        wrap.appendChild(chevron);
        return wrap;
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
               productKey === 'multi_position_splits' ||
               productKey === 'gas_splits';
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
                productKey === 'multi_position_splits' ||
                productKey === 'gas_splits')
            ? 'Outdoor Tag' : 'Tag';
    }

    // Delegates to the single implementation in export.js so the
    // on-screen schedule and the xlsx/dxf/pdf exports share one
    // grid/merge layout routine.
    function computeCellLayout(sel, visibleLetters) {
        return HHpro.Export.computeCellLayout(sel, visibleLetters);
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
            case 'gas_splits':             return 'CU-';
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
            case 'gas_splits':             return 'AHU-';
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
                var rawItemsForProduct = [];
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
                    rawItemsForProduct.push(item);
                });

                if (itemsOut.length > 0) {
                    products.push({
                        productKey: productKey,
                        displayName: displayName,
                        assetsFolder: assetsFolder,
                        items: itemsOut,
                        // Captured for the combined-schedule generator; not
                        // used by the UI rendering path.
                        _data: data,
                        _rawItems: rawItemsForProduct
                    });
                }
            });

            // Preserve doc-type order as it appears across product JSONs;
            // schedule types are appended at the end so the natural
            // documentation column order stays intact at the top of the
            // sidebar.
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
            SCHEDULE_DOC_TYPES.forEach(function (name) {
                if (allTypeNames[name] && !seenOrdered[name]) {
                    seenOrdered[name] = true;
                    orderedNames.push(name);
                }
            });

            // Combined schedules - one project-level file per format. Built
            // only when at least one product has items; otherwise the FILES
            // tab is empty anyway and there's nothing to combine.
            var projectFiles = buildProjectScheduleFiles(products);
            projectFiles.forEach(function (f) {
                if (!seenOrdered[f.docTypeName]) {
                    seenOrdered[f.docTypeName] = true;
                    orderedNames.push(f.docTypeName);
                }
                allTypeNames[f.docTypeName] = true;
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
            sigBits.push('proj:' + projectFiles.length);
            var signature = sigBits.join(',');

            return {
                products: products,
                projectFiles: projectFiles,
                docTypeNames: orderedNames,
                signature: signature
            };
        });
    }

    // -------- Synthetic schedule files (per-unit + combined) --------

    // Only project-level "full" schedules are offered in the FILES
    // section; per-unit schedule files were removed at the user's
    // request (the full schedule covers every unit already).
    var SCHEDULE_DOC_TYPES = [
        'FULL SCHEDULE (EXCEL)',
        'FULL SCHEDULE (CAD)',
        'FULL SCHEDULE (PDF)'
    ];

    var FULL_SCHEDULE_FORMATS = [
        { docType: 'FULL SCHEDULE (EXCEL)', ext: 'xlsx', blobFn: 'xlsxBlobFromSections' },
        { docType: 'FULL SCHEDULE (CAD)',   ext: 'dxf',  blobFn: 'dxfBlobFromSections' },
        { docType: 'FULL SCHEDULE (PDF)',   ext: 'pdf',  blobFn: 'pdfBlobFromSections' }
    ];

    function buildProjectScheduleFiles(products) {
        if (!window.HHpro || !window.HHpro.Export || !products.length) return [];

        // Sections = the per-product full schedules, built lazily so the
        // generator captures the latest state at download time rather
        // than what was current when the FILES tab was opened.
        function buildAllSections() {
            var sections = [];
            products.forEach(function (p) {
                var grid = HHpro.Export.buildScheduleGrid(p.productKey, p._rawItems, p._data);
                if (grid && grid.rows.length) {
                    sections.push({
                        // Short tab label for xlsx sheet names; the
                        // bigger "MINI SPLIT SCHEDULE" title still
                        // renders inside the grid itself.
                        title: HHpro.Export.productTabLabel(p.productKey),
                        grid: grid
                    });
                }
            });
            return sections;
        }

        return FULL_SCHEDULE_FORMATS.map(function (fmt) {
            var baseName = 'Full Schedule';
            var filenameWithExt = baseName + '.' + fmt.ext;
            return {
                key: 'project||' + fmt.docType,
                docColumn: { name: fmt.docType, folder: '', fileExtension: fmt.ext },
                filename: baseName,
                filenameWithExt: filenameWithExt,
                url: null,
                generator: function () {
                    var sections = buildAllSections();
                    if (!sections.length) {
                        return Promise.reject(new Error('No schedule data to combine.'));
                    }
                    return HHpro.Export[fmt.blobFn](sections);
                },
                docTypeName: fmt.docType,
                isZip: false
            };
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
        (filesData.projectFiles || []).forEach(function (f) { set[f.key] = true; });
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

        // Refrigerant Report PDF -- only relevant when the project
        // contains at least one refrigerant-bearing system. The button
        // lives next to Download ZIP so the engineer can grab the
        // report without switching tabs.
        var hasRefrig = (activeState.items || []).some(function (it) {
            return REFRIGERANT_PRODUCT_KEYS.indexOf(it.productKey) >= 0;
        });
        if (hasRefrig) {
            var refReportBtn = document.createElement('button');
            refReportBtn.type = 'button';
            refReportBtn.className = 'projects-btn projects-btn-secondary';
            refReportBtn.textContent = 'Refrigerant Report PDF';
            refReportBtn.title = 'Open a printable refrigerant report for this project';
            refReportBtn.addEventListener('click', function () {
                openRefrigerantReport(activeState.items, null,
                                      activeState.name || '');
            });
            toolbar.appendChild(refReportBtn);
        }

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

        // Project-level synthetic files (combined schedules) live at the
        // top of the tree as their own section, since they aren't tied
        // to any one product or unit.
        if (filesData.projectFiles && filesData.projectFiles.length) {
            tree.appendChild(buildProjectFilesSection(filesData, handles));
        }

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

    // Project-level synthetic files (combined schedules). Renders as a
    // single "Project Schedules" group at the top of the tree, mirroring
    // the per-product / per-item visual hierarchy so the checkbox states
    // and aggregate roll-ups read the same way.
    function buildProjectFilesSection(filesData, handles) {
        var node = document.createElement('div');
        node.className = 'files-product';

        var header = document.createElement('label');
        header.className = 'files-product-header';

        var headerCb = document.createElement('input');
        headerCb.type = 'checkbox';
        headerCb.className = 'files-product-cb';
        headerCb.addEventListener('change', function () {
            filesData.projectFiles.forEach(function (f) {
                if (headerCb.checked) filesSelection[f.key] = true;
                else delete filesSelection[f.key];
            });
            refreshAllGroupStates(filesData, handles);
        });
        handles.projectFilesHeaderCb = headerCb;

        var name = document.createElement('span');
        name.className = 'files-product-name';
        name.textContent = 'Project Schedules';

        header.appendChild(headerCb);
        header.appendChild(name);
        node.appendChild(header);

        var list = document.createElement('div');
        list.className = 'files-list';
        filesData.projectFiles.forEach(function (file) {
            list.appendChild(buildFileRow(file, handles, filesData));
        });
        node.appendChild(list);

        return node;
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
        var ext = String((file.docColumn && file.docColumn.fileExtension) || 'PDF').toUpperCase();
        badge.className = 'files-file-badge' + (file.isZip ? ' files-file-badge-zip' : '');
        badge.textContent = file.isZip ? 'ZIP' : ext;

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
        (filesData.projectFiles || []).forEach(function (f) {
            if (f.docTypeName === docName) n++;
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
        (filesData.projectFiles || []).forEach(function (f) {
            if (f.docTypeName !== docName) return;
            if (on) filesSelection[f.key] = true;
            else delete filesSelection[f.key];
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
            (filesData.projectFiles || []).forEach(function (f) {
                if (f.docTypeName !== name) return;
                total++;
                if (filesSelection[f.key]) on++;
            });
            var cb = handles.typeCheckboxes[name];
            if (!cb) return;
            setAggregateState(cb, total, on);
        });

        // Project-schedules group header (the "Project Schedules" row
        // at the top of the tree). Roll up just the projectFiles.
        if (handles.projectFilesHeaderCb && filesData.projectFiles) {
            var pTotal = filesData.projectFiles.length, pOn = 0;
            filesData.projectFiles.forEach(function (f) {
                if (filesSelection[f.key]) pOn++;
            });
            setAggregateState(handles.projectFilesHeaderCb, pTotal, pOn);
        }

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
        (filesData.projectFiles || []).forEach(function (f) {
            total++;
            if (filesSelection[f.key]) selected++;
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
        // Project-level synthetic files live at the zip root (no product
        // folder prefix), so they get their own entry shape.
        (filesData.projectFiles || []).forEach(function (f) {
            if (filesSelection[f.key]) {
                selectedFiles.push({ file: f, product: null });
            }
        });
        if (!selectedFiles.length) {
            alert('Select at least one file to download.');
            return;
        }

        // Deduplicate by full zip path so identical files referenced by
        // multiple items only appear once in the archive.
        var dedupMap = {};
        var dedupedList = [];
        selectedFiles.forEach(function (entry) {
            var path;
            if (entry.product) {
                path = entry.product.displayName + '/' + entry.file.docColumn.folder +
                       '/' + entry.file.filenameWithExt;
            } else {
                // Project-root file (combined schedules, etc.)
                path = entry.file.filenameWithExt;
            }
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

        // Fetch / generate sequentially - keeps the UX predictable and
        // avoids hammering the dev server with dozens of parallel requests
        var chain = Promise.resolve();
        dedupedList.forEach(function (d) {
            chain = chain.then(function () {
                var file = d.entry.file;
                var source = (typeof file.generator === 'function')
                    ? file.generator()
                    : fetch(file.url).then(function (resp) {
                          if (!resp.ok) throw new Error('HTTP ' + resp.status);
                          return resp.blob();
                      });
                return Promise.resolve(source)
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