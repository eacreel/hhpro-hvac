/* ============================================================
   HHpro - Cart / Project state + panel UI
   ------------------------------------------------------------
   Manages the active selection of items the user is building up.

   Two modes, managed by the same data shape:
     - 'cart'    : a temporary list, lost on tab close
     - 'project' : backed by an entry in localStorage under
                   'hhpro_projects'

   Persistence:
     sessionStorage 'hhpro_active_cart'    -> the active cart/project
     localStorage   'hhpro_projects'       -> map of projectId -> project data

   Data shapes:
     project = {
       id, name, createdAt, updatedAt,
       items: [{
         instanceId, productKey, selectionId, label, addedAt,
         tag        // optional - set by Auto Tag on the View Project page
       }],
       extra: {     // per-product settings persisted with the project
         <productKey>: {
           hiddenColumns: [...],        // schedule column letters to hide
           lastAutoTag: { prefix, start } // remembered for convenience
         }
       }
     }

   Public API:
     -- Cart / panel --
     HHpro.Cart.init()
     HHpro.Cart.addItem(productKey, selectionId, label)
     HHpro.Cart.duplicateItem(instanceId)
     HHpro.Cart.moveItemBefore(instanceId, beforeInstanceId)
     HHpro.Cart.removeItem(instanceId)
     HHpro.Cart.updateItem(instanceId, patch)
     HHpro.Cart.computeLabel(product, selection, data)
     HHpro.Cart.openPanel() / closePanel() / togglePanel()

     -- Active-state reads --
     HHpro.Cart.getActiveState()         -> snapshot of { mode, projectId, name, items, extra }
     HHpro.Cart.hasUnsavedCartItems()    -> true iff mode=cart with items

     -- Per-project extra data (column visibility etc.) --
     HHpro.Cart.getProjectExtra(productKey)        -> object
     HHpro.Cart.setProjectExtra(productKey, patch) -> merges patch into extra[productKey]

     -- Project management --
     HHpro.Cart.listProjects()
     HHpro.Cart.getCurrentProjectId()
     HHpro.Cart.activateProject(id)
     HHpro.Cart.deleteProject(id)
     HHpro.Cart.createAndActivateProject(name)
     HHpro.Cart.promptProjectName(onDone)
     HHpro.Cart.mergeImportedProjects(list, options)
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    // --- storage keys ------------------------------------------------
    var SESSION_KEY = 'hhpro_active_cart';
    var PROJECTS_KEY = 'hhpro_projects';
    // Manual display order for the Projects list (array of project ids).
    // Empty until the user drags to reorder, so listProjects keeps its
    // original "newest first" default until then.
    var PROJECTS_ORDER_KEY = 'hhpro_projects_order';

    // --- in-memory state (mirror of sessionStorage) ------------------
    var state = {
        mode: null,      // null | 'cart' | 'project'
        projectId: null,
        name: null,
        items: [],       // [{ instanceId, productKey, selectionId, label, addedAt, tag? }]
        extra: {},       // { <productKey>: { hiddenColumns, lastAutoTag } }
        engineer: 'hoffman', // project-level schedule-layout template key
        nextInstanceNum: 1
    };

    // Default engineer template key used whenever a project/cart hasn't
    // picked one yet (the original Hoffman & Hoffman layout).
    var DEFAULT_ENGINEER = 'hoffman';

    // The engineer layout a fresh cart/project should adopt: the firm tied
    // to the current login (its non-standard allowed engineer), falling back
    // to the standard layout. So a Saber login lands on the Saber layout by
    // default, while a standard (Mellon) login stays on Hoffman & Hoffman.
    // An explicitly saved project.engineer still wins over this default.
    function defaultEngineer() {
        if (HHpro.State && typeof HHpro.State.getAllowedEngineers === 'function') {
            var allowed = HHpro.State.getAllowedEngineers();
            for (var i = 0; i < allowed.length; i++) {
                if (allowed[i] && allowed[i] !== DEFAULT_ENGINEER) return allowed[i];
            }
        }
        return DEFAULT_ENGINEER;
    }

    // --- DOM refs (set during init) ----------------------------------
    var toggleBtn = null;
    var toggleLabel = null;
    var toggleText = null;
    var toggleCount = null;
    var panel = null;
    var panelTitle = null;
    var panelItemsList = null;
    var panelEmpty = null;

    // =================================================================
    // Public API
    // =================================================================

    HHpro.Cart = {
        init: init,
        addItem: addItem,
        duplicateItem: duplicateItem,
        moveItemBefore: moveItemBefore,
        removeItem: removeItem,
        updateItem: updateItem,
        computeLabel: computeLabel,
        openPanel: openPanel,
        closePanel: closePanel,
        togglePanel: togglePanel,

        getActiveState: getActiveState,
        hasUnsavedCartItems: hasUnsavedCartItems,

        getProjectExtra: getProjectExtra,
        setProjectExtra: setProjectExtra,

        getProjectEngineer: getProjectEngineer,
        setProjectEngineer: setProjectEngineer,

        listProjects: listProjects,
        setProjectsOrder: setProjectsOrder,
        getCurrentProjectId: getCurrentProjectId,
        activateProject: activateProject,
        deleteProject: deleteProject,
        createAndActivateProject: createAndActivateProject,
        exitProject: clearActiveState,
        promptProjectName: promptProjectName,
        mergeImportedProjects: mergeImportedProjects,

        undo: undo,
        redo: redo,
        canUndo: canUndo,
        canRedo: canRedo
    };

    // =================================================================
    // Undo / redo history
    // -----------------------------------------------------------------
    // Every mutating function that touches `state` once a mode is set
    // pushes a deep-cloned snapshot onto the undo stack via pushUndo()
    // BEFORE applying its change. Tracked in BOTH cart and project
    // modes so the same buttons work on either view.
    // =================================================================

    var UNDO_LIMIT = 50;
    var undoStack = [];
    var redoStack = [];

    function snapshotState() {
        return JSON.parse(JSON.stringify(state));
    }

    function pushUndo() {
        // No mode = no work in progress, nothing meaningful to undo to.
        if (!state.mode) return;
        undoStack.push(snapshotState());
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        // A new mutation invalidates any forward branch -- standard
        // undo/redo semantics. Keeping the redo stack here would let
        // the user redo into a state that no longer agrees with the
        // current items, which is more confusing than helpful.
        redoStack = [];
    }

    function clearHistory() {
        undoStack = [];
        redoStack = [];
    }

    function applyHistorySnapshot(snap) {
        // The engineer (schedule-layout) selection is intentionally NOT
        // part of undo/redo - it's a view preference, not project data -
        // so carry the live value across instead of restoring the
        // snapshot's. (setProjectEngineer also skips pushUndo.)
        var liveEngineer = state.engineer;
        // Reassigning `state` (rather than mutating it in place) is fine
        // because every other function in this module looks up `state`
        // through the closure each call -- they all see the new object.
        state = snap;
        state.engineer = liveEngineer;
        saveStateToSession();
        renderPanel();
        renderToggle();
    }

    function undo() {
        if (!undoStack.length) return false;
        redoStack.push(snapshotState());
        if (redoStack.length > UNDO_LIMIT) redoStack.shift();
        applyHistorySnapshot(undoStack.pop());
        return true;
    }

    function redo() {
        if (!redoStack.length) return false;
        undoStack.push(snapshotState());
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        applyHistorySnapshot(redoStack.pop());
        return true;
    }

    function canUndo() { return undoStack.length > 0; }
    function canRedo() { return redoStack.length > 0; }

    // =================================================================
    // Initialization
    // =================================================================

    // Set to true once the first init() has run in this page's
    // lifetime. Used so subsequent init() calls (each view's render
    // does one) don't clobber the in-memory state.
    var initialized = false;

    function init() {
        if (!initialized) {
            // Fresh page load: start in a neutral state, regardless of
            // whether there's a project in sessionStorage from a
            // previous session. The user has to explicitly reopen a
            // project (or add something to the cart) to get going.
            try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
            state = {
                mode: null, projectId: null, name: null,
                items: [], extra: {}, engineer: defaultEngineer(), nextInstanceNum: 1
            };
            initialized = true;
        }
        buildUI();
        renderPanel();
        renderToggle();
    }

    // Kept available in case other code ever wants to manually
    // restore - not called from init() any more.
    function loadStateFromSession() {
        try {
            var raw = sessionStorage.getItem(SESSION_KEY);
            if (!raw) return;
            var parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                state.mode = parsed.mode || null;
                state.projectId = parsed.projectId || null;
                state.name = parsed.name || null;
                state.items = Array.isArray(parsed.items) ? parsed.items : [];
                state.extra = (parsed.extra && typeof parsed.extra === 'object') ? parsed.extra : {};
                state.engineer = parsed.engineer || defaultEngineer();
                state.nextInstanceNum = parsed.nextInstanceNum || (state.items.length + 1);
            }
        } catch (e) {
            state = {
                mode: null, projectId: null, name: null,
                items: [], extra: {}, engineer: defaultEngineer(), nextInstanceNum: 1
            };
        }
    }

    function saveStateToSession() {
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
        } catch (e) { /* non-fatal */ }
        if (state.mode === 'project' && state.projectId) {
            syncProjectRecord();
        }
    }

    // =================================================================
    // Project persistence (localStorage)
    // =================================================================

    function loadProjects() {
        try {
            var raw = localStorage.getItem(PROJECTS_KEY);
            if (!raw) return {};
            var parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function saveProjects(projects) {
        try {
            localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
        } catch (e) {
            alert('Could not save project - browser storage is unavailable or full.');
        }
    }

    function newProjectId() {
        return 'proj_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    }

    function createProject(name) {
        var id = newProjectId();
        var projects = loadProjects();
        var now = new Date().toISOString();
        projects[id] = {
            id: id,
            name: name,
            items: [],
            extra: {},
            engineer: defaultEngineer(),
            createdAt: now,
            updatedAt: now
        };
        saveProjects(projects);
        return projects[id];
    }

    /**
     * Push the full active state (items + extra) back to the project record
     * in localStorage. Called after any mutation so the project is always
     * up to date on disk.
     */
    function syncProjectRecord() {
        var projects = loadProjects();
        var existing = projects[state.projectId];
        if (!existing) return;
        existing.items = state.items.slice();
        existing.extra = deepClone(state.extra);
        existing.engineer = state.engineer || defaultEngineer();
        existing.updatedAt = new Date().toISOString();
        saveProjects(projects);
    }

    function deepClone(obj) {
        try {
            return JSON.parse(JSON.stringify(obj));
        } catch (e) {
            return {};
        }
    }

    // =================================================================
    // Project management - public
    // =================================================================

    function loadProjectOrder() {
        try {
            var raw = localStorage.getItem(PROJECTS_ORDER_KEY);
            if (!raw) return [];
            var parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    // Persist the manual project order (array of ids). Ids that no longer
    // exist are harmless - listProjects intersects against live projects.
    function setProjectsOrder(ids) {
        if (!Array.isArray(ids)) return;
        try {
            localStorage.setItem(PROJECTS_ORDER_KEY, JSON.stringify(ids));
        } catch (e) { /* non-fatal: the order just won't persist */ }
    }

    function listProjects() {
        var projects = loadProjects();
        var ids = Object.keys(projects);
        var order = loadProjectOrder();
        var pos = {};
        order.forEach(function (id, i) { pos[id] = i; });

        // Projects present in the saved order follow it; any not in it
        // (created since the last manual reorder) sort first by recency.
        // With no saved order this reduces to the original newest-first.
        var ordered = ids.filter(function (id) { return pos[id] !== undefined; });
        var unordered = ids.filter(function (id) { return pos[id] === undefined; });
        unordered.sort(function (a, b) {
            return String(projects[b].updatedAt || '')
                .localeCompare(String(projects[a].updatedAt || ''));
        });
        ordered.sort(function (a, b) { return pos[a] - pos[b]; });

        return unordered.concat(ordered).map(function (id) { return projects[id]; });
    }

    function getCurrentProjectId() {
        return state.mode === 'project' ? state.projectId : null;
    }

    function activateProject(id) {
        var projects = loadProjects();
        if (!projects[id]) return false;
        clearHistory();
        startProjectMode(projects[id]);
        renderPanel();
        renderToggle();
        return true;
    }

    function deleteProject(id) {
        var projects = loadProjects();
        if (!projects[id]) return false;
        delete projects[id];
        saveProjects(projects);
        if (state.mode === 'project' && state.projectId === id) {
            clearActiveState();
        }
        return true;
    }

    function createAndActivateProject(name) {
        var proj = createProject(name);
        clearHistory();
        startProjectMode(proj);
        renderPanel();
        renderToggle();
        return proj;
    }

    function hasUnsavedCartItems() {
        return state.mode === 'cart' && state.items.length > 0;
    }

    function clearActiveState() {
        clearHistory();
        state.mode = null;
        state.projectId = null;
        state.name = null;
        state.items = [];
        state.extra = {};
        state.engineer = defaultEngineer();
        state.nextInstanceNum = 1;
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
        renderPanel();
        renderToggle();
    }

    function mergeImportedProjects(projectsArray, options) {
        var opts = options || {};
        var onConflict = opts.onConflict || 'rename';
        var projects = loadProjects();

        var existingByName = {};
        Object.keys(projects).forEach(function (id) {
            existingByName[(projects[id].name || '').toLowerCase()] = id;
        });

        var counts = { imported: 0, renamed: 0, replaced: 0, skipped: 0 };
        var nowIso = new Date().toISOString();

        projectsArray.forEach(function (incoming) {
            if (!incoming || !incoming.name) {
                counts.skipped++;
                return;
            }
            var existingId = existingByName[(incoming.name || '').toLowerCase()];
            var finalName = incoming.name;
            var finalId = newProjectId();

            if (existingId !== undefined) {
                if (onConflict === 'skip') {
                    counts.skipped++;
                    return;
                } else if (onConflict === 'replace') {
                    finalId = existingId;
                    counts.replaced++;
                } else {
                    finalName = makeUniqueName(incoming.name, projects);
                    counts.renamed++;
                }
            } else {
                counts.imported++;
            }

            projects[finalId] = {
                id: finalId,
                name: finalName,
                items: Array.isArray(incoming.items) ? incoming.items.slice() : [],
                extra: (incoming.extra && typeof incoming.extra === 'object') ? incoming.extra : {},
                engineer: incoming.engineer || defaultEngineer(),
                createdAt: incoming.createdAt || nowIso,
                updatedAt: incoming.updatedAt || nowIso
            };
            existingByName[finalName.toLowerCase()] = finalId;
        });

        saveProjects(projects);
        return counts;
    }

    function makeUniqueName(baseName, projects) {
        var used = {};
        Object.keys(projects).forEach(function (id) {
            used[(projects[id].name || '').toLowerCase()] = true;
        });
        var candidate = baseName + ' (imported)';
        var n = 2;
        while (used[candidate.toLowerCase()]) {
            candidate = baseName + ' (imported ' + n + ')';
            n++;
        }
        return candidate;
    }

    // =================================================================
    // Active-state reads & writes
    // =================================================================

    function getActiveState() {
        return {
            mode: state.mode,
            projectId: state.projectId,
            name: state.name,
            items: state.items.slice(),
            extra: deepClone(state.extra),
            engineer: state.engineer || defaultEngineer()
        };
    }

    /**
     * Project-level engineer schedule-layout template. Determines which
     * firm's schedule layout (Hoffman & Hoffman, Refresco, ...) the
     * on-screen schedule and the Excel/CAD/PDF exports use.
     */
    function getProjectEngineer() {
        return state.engineer || defaultEngineer();
    }

    function setProjectEngineer(key) {
        var next = key || defaultEngineer();
        if (next === state.engineer) return;
        // Layout selection is excluded from undo/redo (see
        // applyHistorySnapshot) - no pushUndo here.
        state.engineer = next;
        saveStateToSession();
    }

    /**
     * Patch a single field (or several) on an item by instance id.
     * Skips silently if the item no longer exists.
     */
    function updateItem(instanceId, patch) {
        var idx = indexOfItem(instanceId);
        if (idx < 0 || !patch || typeof patch !== 'object') return;
        pushUndo();
        var it = state.items[idx];
        Object.keys(patch).forEach(function (k) {
            it[k] = patch[k];
        });
        saveStateToSession();
        renderPanel();
        renderToggle();
    }

    function getProjectExtra(productKey) {
        if (!productKey) return {};
        return deepClone(state.extra && state.extra[productKey] ? state.extra[productKey] : {});
    }

    /**
     * Shallow-merge a patch into state.extra[productKey] and persist.
     */
    function setProjectExtra(productKey, patch) {
        if (!productKey || !patch || typeof patch !== 'object') return;
        pushUndo();
        if (!state.extra[productKey]) state.extra[productKey] = {};
        Object.keys(patch).forEach(function (k) {
            state.extra[productKey][k] = patch[k];
        });
        saveStateToSession();
    }

    // =================================================================
    // Mode setup (internal)
    // =================================================================

    function ensureModeChosen(onReady) {
        if (state.mode !== null) {
            onReady();
            return;
        }
        openFirstSelectPrompt(onReady);
    }

    function startCartMode() {
        clearHistory();
        state.mode = 'cart';
        state.projectId = null;
        state.name = 'Cart';
        state.extra = {};
        // A brand-new temporary cart adopts this login's firm layout (e.g.
        // Saber), not whatever the pre-login init() seeded. The user can
        // still switch layouts via the project header dropdown.
        state.engineer = defaultEngineer();
        saveStateToSession();
    }

    function startProjectMode(project) {
        state.mode = 'project';
        state.projectId = project.id;
        state.name = project.name;
        state.items = Array.isArray(project.items) ? project.items.slice() : [];
        state.extra = (project.extra && typeof project.extra === 'object')
            ? deepClone(project.extra) : {};
        state.engineer = project.engineer || defaultEngineer();
        var maxNum = 0;
        state.items.forEach(function (it) {
            var n = parseInt((it.instanceId || '').replace(/\D/g, ''), 10);
            if (!isNaN(n) && n > maxNum) maxNum = n;
        });
        state.nextInstanceNum = maxNum + 1;
        saveStateToSession();
    }

    // =================================================================
    // Adding / removing / duplicating items
    // =================================================================

    function addItem(productKey, selectionId, label, extra) {
        ensureModeChosen(function () {
            // Snapshot AFTER mode is settled so a brand-new project's
            // very first add still has a meaningful "before" entry on
            // the undo stack (the empty project).
            pushUndo();
            var instanceId = 'item_' + String(state.nextInstanceNum).padStart(4, '0');
            state.nextInstanceNum++;
            var item = {
                instanceId: instanceId,
                productKey: productKey,
                selectionId: selectionId,
                label: label || selectionId,
                addedAt: new Date().toISOString(),
                tag: ''
            };
            // Optional extra fields merged onto the new item (e.g.
            // capacityInputs carried over from the browse schedule's
            // capacity dropdowns).
            if (extra && typeof extra === 'object') {
                Object.keys(extra).forEach(function (k) {
                    if (extra[k] != null) item[k] = extra[k];
                });
            }
            // Products can pre-fill the Accessories text box (GPS: "All")
            // via defaultAccessories in data.js. The user can still edit
            // or clear it per item on the project view.
            if (item.accessories == null) {
                var prod = HHpro.Data && HHpro.Data.getProduct
                    ? HHpro.Data.getProduct(productKey) : null;
                if (prod && prod.defaultAccessories) {
                    item.accessories = prod.defaultAccessories;
                }
            }
            state.items.push(item);
            saveStateToSession();
            renderPanel();
            renderToggle();
            flashToggle();
        });
    }

    function duplicateItem(instanceId) {
        var idx = indexOfItem(instanceId);
        if (idx < 0) return;
        pushUndo();
        var orig = state.items[idx];
        var newInstanceId = 'item_' + String(state.nextInstanceNum).padStart(4, '0');
        state.nextInstanceNum++;

        // Deep-copy the original so optional array/object fields (like
        // indoorTags) don't get shared by reference, then override the
        // identity fields.
        var duplicate;
        try {
            duplicate = JSON.parse(JSON.stringify(orig));
        } catch (e) {
            duplicate = {};
        }
        duplicate.instanceId = newInstanceId;
        duplicate.addedAt = new Date().toISOString();
        // Don't copy the tag - each item should get its own tag so the
        // user doesn't accidentally end up with two items sharing one
        duplicate.tag = '';

        state.items.splice(idx + 1, 0, duplicate);
        saveStateToSession();
        renderPanel();
        renderToggle();
    }

    function removeItem(instanceId) {
        var idx = indexOfItem(instanceId);
        if (idx < 0) return;
        pushUndo();
        state.items.splice(idx, 1);
        saveStateToSession();
        renderPanel();
        renderToggle();
    }

    /**
     * Move an item so it sits immediately before another item, or --
     * when beforeInstanceId is null -- after the last item that shares
     * its productKey (i.e. the end of that product's schedule tab).
     * Used by the project schedule's drag-to-reorder handle. Reorders
     * are undoable like any other item mutation.
     */
    function moveItemBefore(instanceId, beforeInstanceId) {
        var fromIdx = indexOfItem(instanceId);
        if (fromIdx < 0 || instanceId === beforeInstanceId) return;

        var toIdx;
        if (beforeInstanceId == null) {
            var pk = state.items[fromIdx].productKey;
            toIdx = -1;
            for (var i = 0; i < state.items.length; i++) {
                if (state.items[i].productKey === pk) toIdx = i;
            }
            toIdx = toIdx + 1;
        } else {
            toIdx = indexOfItem(beforeInstanceId);
            if (toIdx < 0) return;
        }

        // Removing the item first shifts everything after it left one.
        if (fromIdx < toIdx) toIdx--;
        if (toIdx === fromIdx) return;

        pushUndo();
        var item = state.items.splice(fromIdx, 1)[0];
        state.items.splice(toIdx, 0, item);
        saveStateToSession();
        renderPanel();
        renderToggle();
    }

    function indexOfItem(instanceId) {
        for (var i = 0; i < state.items.length; i++) {
            if (state.items[i].instanceId === instanceId) return i;
        }
        return -1;
    }

    // =================================================================
    // Cart-item label generation
    // =================================================================

    function computeLabel(product, sel, data) {
        var row0 = sel.rows[0] || {};
        var filterData = row0.filterData || {};
        var scheduleData = row0.scheduleData || {};

        var sizeValue = null;
        var filterColumns = (data && data.filterColumns) || [];
        for (var i = 0; i < filterColumns.length; i++) {
            var v = filterData[filterColumns[i].name];
            if (v !== null && v !== undefined && v !== '' && v !== '-') {
                sizeValue = v;
                break;
            }
        }

        var modelCol = findModelColumn(data);
        var modelValue = (modelCol && scheduleData[modelCol] !== undefined)
            ? scheduleData[modelCol] : null;

        var parts = [];
        if (sizeValue !== null) {
            var numeric = parseFloat(sizeValue);
            if (!isNaN(numeric) && isFinite(numeric) && String(numeric) === String(sizeValue).trim()) {
                parts.push(String(sizeValue) + ' TON');
            } else {
                parts.push(String(sizeValue));
            }
        }
        if (modelValue !== null && modelValue !== undefined && modelValue !== '') {
            parts.push(String(modelValue));
        }
        if (sel.rows.length > 1) {
            parts.push('(' + sel.rows.length + ' indoor units)');
        }
        return parts.length ? parts.join(' / ') : sel.id;
    }

    function findModelColumn(data) {
        var headerRows = (data && data.scheduleHeader && data.scheduleHeader.rows) || [];
        var found = null;
        for (var ri = 0; ri < headerRows.length; ri++) {
            var row = headerRows[ri];
            for (var ci = 0; ci < row.length; ci++) {
                var cell = row[ci];
                var val = (cell && cell.value !== undefined && cell.value !== null)
                    ? String(cell.value).trim().toUpperCase() : '';
                if (val === 'MODEL' || val === 'MODEL NUMBER' || val === 'MODEL#' ||
                    val === 'MODEL #' || val === 'GPS MODEL') {
                    found = cell.col;
                }
            }
        }
        return found;
    }

    // =================================================================
    // DOM construction (cart toggle + slide-in panel)
    // =================================================================

    function buildUI() {
        if (document.getElementById('cart-root')) return;

        var root = document.createElement('div');
        root.id = 'cart-root';

        toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.id = 'cart-toggle';
        toggleBtn.className = 'cart-toggle';
        toggleBtn.setAttribute('aria-label', 'Open cart');
        toggleBtn.addEventListener('click', togglePanel);

        toggleLabel = document.createElement('span');
        toggleLabel.className = 'cart-toggle-label';
        toggleLabel.appendChild(HHpro.UI.icon('shopping-cart'));

        // Text lives in its own span so renderToggle() can update it
        // without wiping the icon node next to it.
        toggleText = document.createElement('span');
        toggleText.className = 'cart-toggle-text';
        toggleText.textContent = 'Cart';
        toggleLabel.appendChild(toggleText);

        toggleCount = document.createElement('span');
        toggleCount.className = 'cart-toggle-count';
        toggleCount.textContent = '0';

        toggleBtn.appendChild(toggleLabel);
        toggleBtn.appendChild(toggleCount);

        panel = document.createElement('aside');
        panel.id = 'cart-panel';
        panel.className = 'cart-panel';

        var panelHeader = document.createElement('div');
        panelHeader.className = 'cart-panel-header';

        panelTitle = document.createElement('h2');
        panelTitle.className = 'cart-panel-title';
        panelTitle.textContent = 'Cart';

        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'cart-panel-close';
        closeBtn.setAttribute('aria-label', 'Close cart');
        closeBtn.appendChild(HHpro.UI.icon('x'));
        closeBtn.addEventListener('click', closePanel);

        panelHeader.appendChild(panelTitle);
        panelHeader.appendChild(closeBtn);

        var viewProjectBtn = document.createElement('button');
        viewProjectBtn.type = 'button';
        viewProjectBtn.className = 'cart-view-project';
        viewProjectBtn.textContent = 'View Project';
        viewProjectBtn.addEventListener('click', function () {
            closePanel();
            if (state.mode === null) {
                // No project/cart active yet - route to Projects list instead
                HHpro.App.showView('projects');
            } else {
                HHpro.App.showView('project_view');
            }
        });

        panelItemsList = document.createElement('div');
        panelItemsList.className = 'cart-items-list';

        // Empty state composes the shared .hh-empty primitives from
        // base.css: icon first, then title + hint lines.
        panelEmpty = document.createElement('div');
        panelEmpty.className = 'cart-items-empty hh-empty';
        panelEmpty.appendChild(HHpro.UI.icon('shopping-cart'));

        var emptyTitle = document.createElement('div');
        emptyTitle.className = 'hh-empty-title';
        emptyTitle.textContent = 'No items yet';
        panelEmpty.appendChild(emptyTitle);

        var emptyHint = document.createElement('div');
        emptyHint.className = 'hh-empty-hint';
        emptyHint.textContent = 'Select units from a schedule to add them here.';
        panelEmpty.appendChild(emptyHint);

        panel.appendChild(panelHeader);
        panel.appendChild(viewProjectBtn);
        panel.appendChild(panelEmpty);
        panel.appendChild(panelItemsList);

        root.appendChild(toggleBtn);
        root.appendChild(panel);
        document.body.appendChild(root);
    }

    function openPanel() {
        if (!panel) return;
        panel.classList.add('open');
        toggleBtn.classList.add('cart-toggle-hidden');
    }

    function closePanel() {
        if (!panel) return;
        panel.classList.remove('open');
        toggleBtn.classList.remove('cart-toggle-hidden');
    }

    function togglePanel() {
        if (!panel) return;
        if (panel.classList.contains('open')) closePanel();
        else openPanel();
    }

    function flashToggle() {
        if (!toggleBtn) return;
        toggleBtn.classList.remove('cart-toggle-flash');
        void toggleBtn.offsetWidth;
        toggleBtn.classList.add('cart-toggle-flash');
    }

    // =================================================================
    // Panel rendering
    // =================================================================

    function renderPanel() {
        if (!panel) return;
        panelTitle.textContent = state.name || 'Cart';

        if (!state.items.length) {
            panelEmpty.style.display = '';
            panelItemsList.innerHTML = '';
            return;
        }
        panelEmpty.style.display = 'none';

        var groups = {};
        var order = [];
        state.items.forEach(function (it) {
            if (!groups[it.productKey]) {
                groups[it.productKey] = [];
                order.push(it.productKey);
            }
            groups[it.productKey].push(it);
        });

        panelItemsList.innerHTML = '';
        order.forEach(function (productKey) {
            var product = HHpro.Data && HHpro.Data.getProduct
                ? HHpro.Data.getProduct(productKey) : null;
            var productName = product ? product.displayName : productKey.toUpperCase();

            var groupEl = document.createElement('div');
            groupEl.className = 'cart-group';

            var groupHeader = document.createElement('div');
            groupHeader.className = 'cart-group-header';
            groupHeader.textContent = productName;
            groupEl.appendChild(groupHeader);

            groups[productKey].forEach(function (it) {
                groupEl.appendChild(renderCartItem(it));
            });
            panelItemsList.appendChild(groupEl);
        });
    }

    function renderCartItem(item) {
        var el = document.createElement('div');
        el.className = 'cart-item';

        var label = document.createElement('div');
        label.className = 'cart-item-label';
        label.textContent = item.label || item.selectionId;

        var actions = document.createElement('div');
        actions.className = 'cart-item-actions';

        var dupBtn = document.createElement('button');
        dupBtn.type = 'button';
        dupBtn.className = 'cart-item-btn cart-item-btn-secondary';
        dupBtn.textContent = 'Duplicate';
        dupBtn.addEventListener('click', function () { duplicateItem(item.instanceId); });

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'cart-item-btn cart-item-btn-danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', function () { removeItem(item.instanceId); });

        actions.appendChild(dupBtn);
        actions.appendChild(delBtn);

        el.appendChild(label);
        el.appendChild(actions);
        return el;
    }

    function renderToggle() {
        if (!toggleBtn) return;
        toggleCount.textContent = String(state.items.length);
        toggleBtn.classList.toggle('cart-toggle-has-items', state.items.length > 0);
        // Label follows the active context: project name when working
        // inside a project, "Cart" otherwise. Matches the panel title.
        // Only the text span changes - the icon next to it stays put.
        if (toggleText) {
            toggleText.textContent = (state.mode === 'project' && state.name)
                ? state.name
                : 'Cart';
            toggleBtn.setAttribute('aria-label',
                'Open ' + (state.mode === 'project' ? 'project panel' : 'cart'));
        }
    }

    // =================================================================
    // First-select prompt modal
    // =================================================================

    function openFirstSelectPrompt(onReady) {
        var backdrop = buildModalBackdrop();
        var modal = buildModalBox();

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = 'Where should this item go?';

        var desc = document.createElement('p');
        desc.className = 'modal-desc';
        desc.textContent = 'You can save selections to a named project (recommended) or use a temporary cart that won\'t be saved after you close the browser.';

        var actions = document.createElement('div');
        actions.className = 'modal-actions modal-actions-stacked';

        var createBtn = modalButton('Create new project', 'primary', function () {
            closeModal(backdrop);
            promptProjectName(function (projectName) {
                if (!projectName) return;
                var proj = createProject(projectName);
                startProjectMode(proj);
                renderPanel();
                renderToggle();
                onReady();
            });
        });

        var projects = loadProjects();
        var hasProjects = Object.keys(projects).length > 0;
        var openBtn = modalButton('Open existing project', 'secondary', function () {
            closeModal(backdrop);
            openProjectPicker(function (project) {
                if (!project) return;
                startProjectMode(project);
                renderPanel();
                renderToggle();
                onReady();
            });
        });
        if (!hasProjects) {
            openBtn.disabled = true;
            openBtn.title = 'No projects saved yet';
        }

        var cartBtn = modalButton('Continue with temporary cart', 'secondary', function () {
            closeModal(backdrop);
            startCartMode();
            onReady();
        });

        actions.appendChild(createBtn);
        actions.appendChild(openBtn);
        actions.appendChild(cartBtn);

        modal.appendChild(title);
        modal.appendChild(desc);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
    }

    // =================================================================
    // Project-name modal (public)
    // =================================================================

    function promptProjectName(onDone) {
        var backdrop = buildModalBackdrop();
        var modal = buildModalBox();

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = 'Name your project';

        var desc = document.createElement('p');
        desc.className = 'modal-desc';
        desc.textContent = 'Give this project a name you\'ll recognize later.';

        var inputWrap = document.createElement('div');
        inputWrap.className = 'modal-input-wrap';

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'modal-input';
        input.placeholder = 'e.g. Project Alpha';
        input.maxLength = 80;
        inputWrap.appendChild(input);

        var actions = document.createElement('div');
        actions.className = 'modal-actions';

        var cancelBtn = modalButton('Cancel', 'secondary', function () {
            closeModal(backdrop);
            onDone(null);
        });
        var confirmBtn = modalButton('Create', 'primary', function () {
            var name = input.value.trim();
            if (!name) { input.focus(); return; }
            closeModal(backdrop);
            onDone(name);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        modal.appendChild(title);
        modal.appendChild(desc);
        modal.appendChild(inputWrap);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        setTimeout(function () { input.focus(); }, 0);
    }

    // =================================================================
    // Project picker modal
    // =================================================================

    function openProjectPicker(onDone) {
        var list = listProjects();

        var backdrop = buildModalBackdrop();
        var modal = buildModalBox();

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = 'Open existing project';

        var listEl = document.createElement('div');
        listEl.className = 'modal-project-list';

        list.forEach(function (proj) {
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'modal-project-item';

            var name = document.createElement('div');
            name.className = 'modal-project-name';
            name.textContent = proj.name;

            var meta = document.createElement('div');
            meta.className = 'modal-project-meta';
            var count = (proj.items && proj.items.length) || 0;
            meta.textContent = count + ' item' + (count === 1 ? '' : 's');

            btn.appendChild(name);
            btn.appendChild(meta);
            btn.addEventListener('click', function () {
                closeModal(backdrop);
                onDone(proj);
            });
            listEl.appendChild(btn);
        });

        var actions = document.createElement('div');
        actions.className = 'modal-actions';
        var cancelBtn = modalButton('Cancel', 'secondary', function () {
            closeModal(backdrop);
            onDone(null);
        });
        actions.appendChild(cancelBtn);

        modal.appendChild(title);
        modal.appendChild(listEl);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
    }

    // =================================================================
    // Shared modal helpers
    // =================================================================

    function buildModalBackdrop() {
        var bd = document.createElement('div');
        bd.className = 'modal-backdrop';
        bd.addEventListener('click', function (e) {
            if (e.target === bd) closeModal(bd);
        });
        return bd;
    }

    function buildModalBox() {
        var m = document.createElement('div');
        m.className = 'modal';
        return m;
    }

    function closeModal(backdrop) {
        if (backdrop && backdrop.parentNode) {
            backdrop.parentNode.removeChild(backdrop);
        }
    }

    function modalButton(text, variant, onClick) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'modal-btn modal-btn-' + (variant || 'secondary');
        btn.textContent = text;
        btn.addEventListener('click', onClick);
        return btn;
    }

    // =================================================================
    // Auto-init (after login)
    // =================================================================

    function tryAutoInit() {
        if (!HHpro.State || typeof HHpro.State.isLoggedIn !== 'function') return false;
        if (!HHpro.State.isLoggedIn()) return false;
        init();
        return true;
    }

    function setupAutoInit() {
        if (tryAutoInit()) return;
        var intervalId = setInterval(function () {
            if (tryAutoInit()) clearInterval(intervalId);
        }, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupAutoInit);
    } else {
        setupAutoInit();
    }
})();