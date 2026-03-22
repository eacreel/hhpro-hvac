/* ==========================================================================
   project.js — Multi-project management, projects page, selection dialog,
   cart, panel sidebar, accessories notes, localStorage persistence, CSV.
   Updated with multi-product support (mini-splits + multi-position).
   Emits project:changed via EventBus when entries change.
   ========================================================================== */

const Project = (function () {

    const STORAGE_KEY_PROJECTS    = "hhpro_projects_list";
    const STORAGE_PREFIX_ENTRIES  = "hhpro_project_entries_";
    const STORAGE_PREFIX_NOTES    = "hhpro_project_notes_";
    const OLD_STORAGE_KEY_ENTRIES = "hhpro_project_entries";
    const OLD_STORAGE_KEY_NOTES   = "hhpro_project_notes";
    const MAX_ACCESSORY_LINES    = 10;

    let _projects = [];
    let _activeTarget = null;
    let _openTarget = null;

    let _entries      = [];
    let _idSet        = new Set();
    let _indoorNotes  = [];
    let _outdoorNotes = [];

    let _cartEntries      = [];
    let _cartIdSet        = new Set();
    let _cartIndoorNotes  = [];
    let _cartOutdoorNotes = [];
    let _cartProductNotes = {};

    function initCartNotes() {
        while (_cartIndoorNotes.length < MAX_ACCESSORY_LINES)  _cartIndoorNotes.push("");
        while (_cartOutdoorNotes.length < MAX_ACCESSORY_LINES) _cartOutdoorNotes.push("");
    }

    let _saveTimeout      = null;
    let _currentView      = "schedule";

    let _panel, _overlay, _listEl, _emptyEl, _badge, _btnToggle, _btnClose;
    let _btnNew, _btnLoadCsv, _csvInput;
    let _btnExportCsv, _btnExportXlsx, _btnExportPdf, _btnDownloadDocs;
    let _btnPreview;
    let _indoorNotesList, _outdoorNotesList;
    let _projectsPage, _projectsGrid, _projectsEmpty;
    let _scheduleView;
    let _panelTitle;
    let _btnActiveTarget, _activeTargetName, _btnClearTarget;
    let _activeTargetIconProject, _activeTargetIconCart;

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------
    function init() {

        _panel           = document.getElementById("project-panel");
        _overlay         = document.getElementById("project-overlay");
        _listEl          = document.getElementById("project-systems-list");
        _emptyEl         = document.getElementById("project-empty");
        _badge           = document.getElementById("project-badge");
        _btnToggle       = document.getElementById("btn-project-toggle");
        _btnClose        = document.getElementById("btn-project-close");
        _btnNew          = document.getElementById("btn-new-project");
        _btnLoadCsv      = document.getElementById("btn-load-csv");
        _csvInput        = document.getElementById("csv-file-input");
        _btnExportCsv    = document.getElementById("btn-export-csv");
        _btnExportXlsx   = document.getElementById("btn-export-schedule-xlsx");
        _btnExportPdf    = document.getElementById("btn-export-schedule-pdf");
        _btnDownloadDocs = document.getElementById("btn-download-docs");
        _btnPreview      = document.getElementById("btn-preview-schedule");
        _indoorNotesList = document.getElementById("accessories-indoor-list");
        _outdoorNotesList = document.getElementById("accessories-outdoor-list");
        _panelTitle      = document.getElementById("project-panel-title");

        _projectsPage  = document.getElementById("projects-page");
        _projectsGrid  = document.getElementById("projects-grid");
        _projectsEmpty = document.getElementById("projects-empty");
        _scheduleView  = document.getElementById("schedule-view");

        _btnActiveTarget         = document.getElementById("btn-active-target");
        _activeTargetName        = document.getElementById("active-target-name");
        _btnClearTarget          = document.getElementById("btn-clear-target");
        _activeTargetIconProject = document.querySelector(".active-target-icon-project");
        _activeTargetIconCart    = document.querySelector(".active-target-icon-cart");

        if (_btnClearTarget) {
            _btnClearTarget.addEventListener("click", function (e) { e.stopPropagation(); clearActiveTarget(); });
        }

        if (_btnActiveTarget) {
            _btnActiveTarget.addEventListener("click", function () {
                if (_activeTarget) {
                    openTargetInPanel(_activeTarget);
                }
            });
        }

        _btnToggle.addEventListener("click", function () {
            if (_currentView === "projects") showScheduleView();
            else showProjectsPage();
        });
        _btnClose.addEventListener("click", closePanel);
        _overlay.addEventListener("click", closePanel);

        document.getElementById("btn-create-project").addEventListener("click", showCreateProjectDialog);
        document.getElementById("btn-back-to-schedule").addEventListener("click", showScheduleView);

        _btnNew.addEventListener("click", handleNewProject);
        _btnLoadCsv.addEventListener("click", function () { _csvInput.click(); });
        _csvInput.addEventListener("change", handleLoadCsv);

        var tabs = document.querySelectorAll(".product-tab");
        for (var t = 0; t < tabs.length; t++) {
            tabs[t].addEventListener("click", function () { if (_currentView === "projects") showScheduleView(); });
        }

        initCartNotes();
        migrateOldData();
        loadProjectsList();
        updateBadge();

        console.log("[Project] Initialized with " + _projects.length + " projects");
    }

    function isSameTarget(a, b) {
        if (!a || !b) return false;
        if (a.type !== b.type) return false;
        if (a.type === "project") return a.projectId === b.projectId;
        return true;
    }

    // -----------------------------------------------------------------------
    // View Navigation
    // -----------------------------------------------------------------------
    function showProjectsPage() {
        _currentView = "projects";
        _scheduleView.classList.add("hidden");
        _projectsPage.classList.remove("hidden");
        closePanel();
        renderProjectsPage();
    }

    function showScheduleView() {
        _currentView = "schedule";
        _projectsPage.classList.add("hidden");
        _scheduleView.classList.remove("hidden");
    }

    function getCurrentView() { return _currentView; }

    // -----------------------------------------------------------------------
    // Projects CRUD
    // -----------------------------------------------------------------------
    function createProject(name) {
        var project = { id: "proj_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5), name: name };
        _projects.push(project); saveProjectsList(); return project;
    }
    function renameProject(id, name) { var p = getProjectById(id); if (p) { p.name = name; saveProjectsList(); } }
    function deleteProject(id) { _projects = _projects.filter(function (p) { return p.id !== id; }); saveProjectsList(); try { localStorage.removeItem(STORAGE_PREFIX_ENTRIES + id); localStorage.removeItem(STORAGE_PREFIX_NOTES + id); } catch (e) {} if (_activeTarget && _activeTarget.projectId === id) clearActiveTarget(); if (_openTarget && _openTarget.projectId === id) { _openTarget = null; loadOpenTarget(); } }
    function getProjectById(id) { for (var i = 0; i < _projects.length; i++) { if (_projects[i].id === id) return _projects[i]; } return null; }
    function getProjectEntryCount(id) { return loadProjectEntries(id).length; }

    // -----------------------------------------------------------------------
    // Projects Page
    // -----------------------------------------------------------------------
    function renderProjectsPage() {
        if (!_projectsGrid) return; _projectsGrid.innerHTML = "";
        if (_projects.length === 0) { _projectsEmpty.classList.remove("hidden"); return; }
        _projectsEmpty.classList.add("hidden");
        for (var i = 0; i < _projects.length; i++) _projectsGrid.appendChild(buildProjectCard(_projects[i]));
    }

    function buildProjectCard(project) {
        var entryCount = getProjectEntryCount(project.id);
        var isActive = _activeTarget && _activeTarget.type === "project" && _activeTarget.projectId === project.id;
        var card = document.createElement("div"); card.className = "projects-card";
        if (isActive) card.classList.add("projects-card-active");

        var header = document.createElement("div"); header.className = "projects-card-header";
        var nameEl = document.createElement("h3"); nameEl.className = "projects-card-name"; nameEl.textContent = project.name;
        var actionsEl = document.createElement("div"); actionsEl.className = "projects-card-actions";

        var renameBtn = document.createElement("button"); renameBtn.type = "button"; renameBtn.className = "projects-card-action-btn"; renameBtn.title = "Rename";
        renameBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        renameBtn.addEventListener("click", function (e) { e.stopPropagation(); showRenameProjectDialog(project.id, project.name); });

        var deleteBtn = document.createElement("button"); deleteBtn.type = "button"; deleteBtn.className = "projects-card-action-btn projects-card-delete-btn"; deleteBtn.title = "Delete";
        deleteBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
        deleteBtn.addEventListener("click", function (e) { e.stopPropagation(); showConfirmDialog("Delete Project", 'Delete "' + project.name + '"? All systems and data will be removed.', "Delete", function () { deleteProject(project.id); renderProjectsPage(); updateBadge(); notifyChange(); }); });

        actionsEl.appendChild(renameBtn); actionsEl.appendChild(deleteBtn);
        header.appendChild(nameEl); header.appendChild(actionsEl);

        var body = document.createElement("div"); body.className = "projects-card-body";
        var countEl = document.createElement("span"); countEl.className = "projects-card-count"; countEl.textContent = entryCount + " system" + (entryCount !== 1 ? "s" : "");
        var statusEl = document.createElement("span"); statusEl.className = "projects-card-status";
        if (isActive) { statusEl.textContent = "Active"; statusEl.classList.add("projects-card-status-active"); }
        body.appendChild(countEl); body.appendChild(statusEl);

        var footer = document.createElement("div"); footer.className = "projects-card-footer";
        var openBtn = document.createElement("button"); openBtn.type = "button"; openBtn.className = "projects-card-open-btn"; openBtn.textContent = "Open Project";
        openBtn.addEventListener("click", function (e) { e.stopPropagation(); openProjectInPanel(project.id); });
        footer.appendChild(openBtn);

        card.appendChild(header); card.appendChild(body); card.appendChild(footer);
        return card;
    }

    // -----------------------------------------------------------------------
    // Create / Rename Dialogs
    // -----------------------------------------------------------------------
    function showCreateProjectDialog() {
        showInputDialog("Create Project", "Project Name", "", "Create", function (name) {
            if (!name || !name.trim()) { showToast("Please enter a project name", "toast-warning"); return false; }
            var project = createProject(name.trim()); renderProjectsPage(); updateBadge();
            showToast('Project "' + project.name + '" created', "toast-success"); return true;
        });
    }

    function showRenameProjectDialog(projectId, currentName) {
        showInputDialog("Rename Project", "Project Name", currentName, "Rename", function (name) {
            if (!name || !name.trim()) { showToast("Please enter a project name", "toast-warning"); return false; }
            renameProject(projectId, name.trim()); renderProjectsPage(); showToast("Project renamed", "toast-success"); return true;
        });
    }

    // -----------------------------------------------------------------------
    // Active Target
    // -----------------------------------------------------------------------
    function setActiveTarget(target) { _activeTarget = target; updateActiveTargetIndicator(); updateBadge(); }
    function clearActiveTarget() { _activeTarget = null; updateActiveTargetIndicator(); updateBadge(); notifyChange(); }
    function getActiveTarget() { return _activeTarget; }

    function updateActiveTargetIndicator() {
        if (!_btnActiveTarget) return;
        if (!_activeTarget) { _btnActiveTarget.classList.add("hidden"); _btnClearTarget.classList.add("hidden"); return; }
        _btnActiveTarget.classList.remove("hidden"); _btnClearTarget.classList.remove("hidden");
        if (_activeTarget.type === "cart") {
            _activeTargetName.textContent = "Cart";
            _activeTargetIconProject.classList.add("hidden"); _activeTargetIconCart.classList.remove("hidden");
        } else {
            var proj = getProjectById(_activeTarget.projectId);
            _activeTargetName.textContent = proj ? proj.name : "Project";
            _activeTargetIconProject.classList.remove("hidden"); _activeTargetIconCart.classList.add("hidden");
        }
    }

    // -----------------------------------------------------------------------
    // Selection Dialog
    // -----------------------------------------------------------------------
    function requestAddSystem(systemId) {
        if (_activeTarget) {
            addSystemToTarget(systemId, _activeTarget); return;
        }
        if (_projects.length === 0) showNoProjectsDialog(systemId);
        else showSelectTargetDialog(systemId);
    }

    function showNoProjectsDialog(systemId) {
        var overlay = document.createElement("div"); overlay.className = "confirm-overlay";
        var dialog = document.createElement("div"); dialog.className = "confirm-dialog selection-dialog";
        var headerDiv = document.createElement("div"); headerDiv.className = "confirm-dialog-header";
        var h3 = document.createElement("h3"); h3.textContent = "Where should this go?"; headerDiv.appendChild(h3);
        var bodyDiv = document.createElement("div"); bodyDiv.className = "confirm-dialog-body";
        var p = document.createElement("p"); p.textContent = "No projects yet. Create one, or use an unsaved cart?"; bodyDiv.appendChild(p);
        var footerDiv = document.createElement("div"); footerDiv.className = "confirm-dialog-footer selection-dialog-footer";

        var cancelBtn = document.createElement("button"); cancelBtn.type = "button"; cancelBtn.className = "confirm-btn confirm-btn-cancel"; cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", function () { document.body.removeChild(overlay); });

        var cartBtn = document.createElement("button"); cartBtn.type = "button"; cartBtn.className = "confirm-btn selection-btn-cart"; cartBtn.textContent = "Use Cart";
        cartBtn.addEventListener("click", function () { document.body.removeChild(overlay); setActiveTarget({ type: "cart" }); addSystemToTarget(systemId, _activeTarget); });

        var createBtn = document.createElement("button"); createBtn.type = "button"; createBtn.className = "confirm-btn confirm-btn-primary"; createBtn.textContent = "Create Project";
        createBtn.addEventListener("click", function () {
            document.body.removeChild(overlay);
            showInputDialog("Create Project", "Project Name", "", "Create & Add", function (name) {
                if (!name || !name.trim()) { showToast("Please enter a project name", "toast-warning"); return false; }
                var project = createProject(name.trim()); setActiveTarget({ type: "project", projectId: project.id });
                addSystemToTarget(systemId, _activeTarget); updateBadge(); showToast('Project "' + project.name + '" created', "toast-success"); return true;
            });
        });

        footerDiv.appendChild(cancelBtn); footerDiv.appendChild(cartBtn); footerDiv.appendChild(createBtn);
        dialog.appendChild(headerDiv); dialog.appendChild(bodyDiv); dialog.appendChild(footerDiv);
        overlay.appendChild(dialog); document.body.appendChild(overlay);
    }

    function showSelectTargetDialog(systemId) {
        var overlay = document.createElement("div"); overlay.className = "confirm-overlay";
        var dialog = document.createElement("div"); dialog.className = "confirm-dialog selection-dialog";
        var headerDiv = document.createElement("div"); headerDiv.className = "confirm-dialog-header";
        var h3 = document.createElement("h3"); h3.textContent = "Add to which project?"; headerDiv.appendChild(h3);
        var bodyDiv = document.createElement("div"); bodyDiv.className = "confirm-dialog-body selection-dialog-body";
        var p = document.createElement("p"); p.textContent = "Select a project for this and future selections, or use the unsaved cart."; bodyDiv.appendChild(p);
        var optionsList = document.createElement("div"); optionsList.className = "selection-options";
        var selectedValue = null;

        for (var i = 0; i < _projects.length; i++) {
            (function (proj) {
                var option = document.createElement("label"); option.className = "selection-option";
                var radio = document.createElement("input"); radio.type = "radio"; radio.name = "target-selection"; radio.value = proj.id; radio.className = "selection-radio";
                var labelText = document.createElement("span"); labelText.className = "selection-option-label"; labelText.textContent = proj.name;
                var count = getProjectEntryCount(proj.id);
                var countEl = document.createElement("span"); countEl.className = "selection-option-count"; countEl.textContent = count + " system" + (count !== 1 ? "s" : "");
                option.appendChild(radio); option.appendChild(labelText); option.appendChild(countEl); optionsList.appendChild(option);
                radio.addEventListener("change", function () { selectedValue = { type: "project", projectId: proj.id }; });
            })(_projects[i]);
        }

        var cartOption = document.createElement("label"); cartOption.className = "selection-option selection-option-cart";
        var cartRadio = document.createElement("input"); cartRadio.type = "radio"; cartRadio.name = "target-selection"; cartRadio.value = "cart"; cartRadio.className = "selection-radio";
        var cartLabel = document.createElement("span"); cartLabel.className = "selection-option-label"; cartLabel.textContent = "Cart (unsaved)";
        var cartCount = document.createElement("span"); cartCount.className = "selection-option-count"; cartCount.textContent = _cartEntries.length + " system" + (_cartEntries.length !== 1 ? "s" : "");
        cartOption.appendChild(cartRadio); cartOption.appendChild(cartLabel); cartOption.appendChild(cartCount); optionsList.appendChild(cartOption);
        cartRadio.addEventListener("change", function () { selectedValue = { type: "cart" }; });
        bodyDiv.appendChild(optionsList);

        var footerDiv = document.createElement("div"); footerDiv.className = "confirm-dialog-footer";
        var cancelBtn = document.createElement("button"); cancelBtn.type = "button"; cancelBtn.className = "confirm-btn confirm-btn-cancel"; cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", function () { document.body.removeChild(overlay); });
        var confirmBtn = document.createElement("button"); confirmBtn.type = "button"; confirmBtn.className = "confirm-btn confirm-btn-primary"; confirmBtn.textContent = "Add System";
        confirmBtn.addEventListener("click", function () {
            if (!selectedValue) { showToast("Select a project or cart", "toast-warning"); return; }
            document.body.removeChild(overlay);
            setActiveTarget(selectedValue);
            addSystemToTarget(systemId, _activeTarget);
        });
        footerDiv.appendChild(cancelBtn); footerDiv.appendChild(confirmBtn);
        dialog.appendChild(headerDiv); dialog.appendChild(bodyDiv); dialog.appendChild(footerDiv);
        overlay.appendChild(dialog); document.body.appendChild(overlay);
    }

    // -----------------------------------------------------------------------
    // Add / Remove Systems  (duplicates allowed)
    // -----------------------------------------------------------------------
    function addSystemToTarget(systemId, target) {
        if (!target) return;
        var sys = DataLoader.getSystemById(systemId); if (!sys) return;

        // Build entry — works for both mini-splits and multi-position
        var iduTags = [], iduAccessories = [];
        for (var i = 0; i < sys.indoorUnits.length; i++) {
            iduTags.push(sys.indoorUnits[i].symbol || "IDU-");
            iduAccessories.push("");
        }
        var entry = {
            systemId: systemId,
            oduTag: sys.outdoorUnit.symbol || "ODU-",
            iduTags: iduTags,
            iduAccessories: iduAccessories,
            outdoorAccessories: ""
        };

        if (target.type === "cart") {
            _cartEntries.push(entry); _cartIdSet.add(systemId);
            showToast("System added to cart", "toast-success");
        } else if (target.type === "project") {
            var entries = loadProjectEntries(target.projectId);
            entries.push(entry);
            saveProjectEntries(target.projectId, entries);
            showToast("System added to project", "toast-success");
        }

        if (_openTarget && isSameTarget(_openTarget, target)) { loadOpenTarget(); renderList(); renderAccessoriesNotes(); }
        updateBadge(); updateExportButtons(); notifyChange();

        if (_currentView === "schedule") {
            var count = target.type === "cart" ? _cartEntries.length : getProjectEntryCount(target.projectId);
            if (count === 1 && !isPanelOpen()) openTargetInPanel(target);
        }
    }

    function removeSystem(systemId) {
        if (!_openTarget) return;
        if (_openTarget.type === "cart") {
            var idx = _cartEntries.findIndex(function (e) { return e.systemId === systemId; }); if (idx === -1) return;
            _cartEntries.splice(idx, 1); _cartIdSet = new Set(_cartEntries.map(function (e) { return e.systemId; }));
        } else if (_openTarget.type === "project") {
            var entries = loadProjectEntries(_openTarget.projectId);
            var removeIdx = entries.findIndex(function (e) { return e.systemId === systemId; });
            if (removeIdx === -1) return;
            entries.splice(removeIdx, 1);
            saveProjectEntries(_openTarget.projectId, entries);
        }
        loadOpenTarget(); renderList(); updateBadge(); updateExportButtons(); notifyChange();
        showToast("System removed", "toast-warning");
    }

    // -----------------------------------------------------------------------
    // Open Target in Panel
    // -----------------------------------------------------------------------
    function openProjectInPanel(projectId) { openTargetInPanel({ type: "project", projectId: projectId }); showScheduleView(); }

    function openTargetInPanel(target) {
        _openTarget = target; loadOpenTarget();
        if (!_activeTarget || !isSameTarget(_activeTarget, target)) setActiveTarget(target);
        if (target.type === "cart") _panelTitle.textContent = "Cart (Unsaved)";
        else { var proj = getProjectById(target.projectId); _panelTitle.textContent = proj ? proj.name : "Project"; }
        renderList(); renderAccessoriesNotes(); updateBadge(); updateExportButtons(); openPanel();
    }

    function loadOpenTarget() {
        if (!_openTarget) { _entries = []; _idSet = new Set(); _indoorNotes = []; _outdoorNotes = []; return; }
        if (_openTarget.type === "cart") { _entries = _cartEntries; _idSet = _cartIdSet; _indoorNotes = _cartIndoorNotes; _outdoorNotes = _cartOutdoorNotes; }
        else { _entries = loadProjectEntries(_openTarget.projectId); _idSet = new Set(_entries.map(function (e) { return e.systemId; })); var notes = loadProjectNotes(_openTarget.projectId); _indoorNotes = notes.indoor; _outdoorNotes = notes.outdoor; }
        while (_indoorNotes.length < MAX_ACCESSORY_LINES) _indoorNotes.push("");
        while (_outdoorNotes.length < MAX_ACCESSORY_LINES) _outdoorNotes.push("");
        _indoorNotes = _indoorNotes.slice(0, MAX_ACCESSORY_LINES);
        _outdoorNotes = _outdoorNotes.slice(0, MAX_ACCESSORY_LINES);
    }

    // -----------------------------------------------------------------------
    // Panel Open / Close
    // -----------------------------------------------------------------------
    function togglePanel() { if (_panel.classList.contains("open")) closePanel(); else openPanel(); }
    function openPanel() { _panel.classList.add("open"); _panel.classList.remove("closed"); _overlay.classList.remove("hidden"); _overlay.classList.add("visible"); document.body.classList.add("project-open"); }
    function closePanel() { _panel.classList.remove("open"); _panel.classList.add("closed"); _overlay.classList.remove("visible"); _overlay.classList.add("hidden"); document.body.classList.remove("project-open"); }
    function isPanelOpen() { return _panel.classList.contains("open"); }

    // -----------------------------------------------------------------------
    // Get IDs / Entries
    // -----------------------------------------------------------------------
    function getProjectIds() {
        if (!_activeTarget) return new Set();
        if (_activeTarget.type === "cart") return new Set(_cartIdSet);
        if (_activeTarget.type === "project") { var e = loadProjectEntries(_activeTarget.projectId); return new Set(e.map(function (x) { return x.systemId; })); }
        return new Set();
    }
    function getEntries() { return _entries.slice(); }
    function getCount() { return _entries.length; }

    // -----------------------------------------------------------------------
    // Accessories Notes
    // -----------------------------------------------------------------------
    function getIndoorNotes() { return _indoorNotes.slice(); }
    function getOutdoorNotes() { return _outdoorNotes.slice(); }
    function getActiveIndoorNotes() { return _indoorNotes.filter(function (n) { return n.trim() !== ""; }); }
    function getActiveOutdoorNotes() { return _outdoorNotes.filter(function (n) { return n.trim() !== ""; }); }

    function renderAccessoriesNotes() {
        renderNotesList(_indoorNotesList, _indoorNotes, "indoor");
        renderNotesList(_outdoorNotesList, _outdoorNotes, "outdoor");
    }

    function renderNotesList(container, notes, prefix) {
        if (!container) return; container.innerHTML = "";
        while (notes.length < MAX_ACCESSORY_LINES) notes.push("");
        for (var i = 0; i < MAX_ACCESSORY_LINES; i++) {
            var line = document.createElement("div"); line.className = "accessories-line";
            var num = document.createElement("span"); num.className = "accessories-line-number"; num.textContent = (i + 1) + "-";
            var input = document.createElement("input"); input.type = "text"; input.className = "accessories-line-input"; input.value = notes[i] || ""; input.placeholder = "";
            input.dataset.prefix = prefix; input.dataset.lineIndex = i; input.addEventListener("input", handleNoteInput);
            line.appendChild(num); line.appendChild(input); container.appendChild(line);
        }
    }

    function handleNoteInput(e) {
        var el = e.target; var prefix = el.dataset.prefix; var idx = parseInt(el.dataset.lineIndex, 10);
        if (prefix === "indoor") _indoorNotes[idx] = el.value; else _outdoorNotes[idx] = el.value;
        clearTimeout(_saveTimeout); _saveTimeout = setTimeout(function () { saveOpenTarget(); }, 500);
    }

    // -----------------------------------------------------------------------
    // Render Project List (sidebar)
    // -----------------------------------------------------------------------
    function renderList() {
        if (!_listEl) return; _listEl.innerHTML = "";
        if (_entries.length === 0) { _emptyEl.classList.remove("hidden"); return; }
        _emptyEl.classList.add("hidden");
        for (var i = 0; i < _entries.length; i++) _listEl.appendChild(buildCard(_entries[i], i));
    }

    /**
     * Get the display model name for an indoor/outdoor unit,
     * handling both mini-splits (.manufacturer) and MPS (.model) fields.
     */
    function getUnitDisplayModel(unit) {
        return unit.manufacturer || unit.model || "";
    }

    function buildCard(entry, entryIndex) {
        var sys = DataLoader.getSystemById(entry.systemId);
        if (!sys) return document.createElement("div");
        var card = document.createElement("div"); card.className = "project-system-card"; card.dataset.systemId = entry.systemId;

        var header = document.createElement("div"); header.className = "project-card-header";
        var titleWrap = document.createElement("div"); titleWrap.className = "project-card-title-wrap";
        var title = document.createElement("span"); title.className = "project-card-title"; title.textContent = DataLoader.getSystemSummary(entry.systemId);
        var subtitle = document.createElement("span"); subtitle.className = "project-card-subtitle"; subtitle.textContent = "#" + (entryIndex + 1);
        titleWrap.appendChild(title); titleWrap.appendChild(subtitle); header.appendChild(titleWrap);

        var removeBtn = document.createElement("button"); removeBtn.type = "button"; removeBtn.className = "btn-remove-system"; removeBtn.title = "Remove";
        removeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        (function (idx) { removeBtn.addEventListener("click", function () { removeEntryByIndex(idx); }); })(entryIndex);
        header.appendChild(removeBtn); card.appendChild(header);

        var body = document.createElement("div"); body.className = "project-card-body";

        var oduRow = document.createElement("div"); oduRow.className = "project-outdoor-row";
        var oduLabel = document.createElement("span"); oduLabel.className = "project-outdoor-label"; oduLabel.textContent = "Outdoor";
        var oduTagInput = document.createElement("input"); oduTagInput.type = "text"; oduTagInput.className = "project-tag-input"; oduTagInput.value = entry.oduTag;
        oduTagInput.dataset.entryIndex = entryIndex; oduTagInput.dataset.field = "oduTag"; oduTagInput.addEventListener("input", handleTagInput);
        var oduModel = document.createElement("span"); oduModel.className = "project-outdoor-model"; oduModel.textContent = getUnitDisplayModel(sys.outdoorUnit);
        oduRow.appendChild(oduLabel); oduRow.appendChild(oduTagInput); oduRow.appendChild(oduModel); body.appendChild(oduRow);

        for (var i = 0; i < sys.indoorUnits.length; i++) {
            var idu = sys.indoorUnits[i];
            var iduRow = document.createElement("div"); iduRow.className = "project-indoor-row";
            var iduLabel = document.createElement("span"); iduLabel.className = "project-indoor-label"; iduLabel.textContent = "Indoor #" + (i + 1);
            var iduTagInput = document.createElement("input"); iduTagInput.type = "text"; iduTagInput.className = "project-tag-input"; iduTagInput.value = entry.iduTags[i] || "IDU-";
            iduTagInput.dataset.entryIndex = entryIndex; iduTagInput.dataset.field = "iduTag"; iduTagInput.dataset.iduIndex = i; iduTagInput.addEventListener("input", handleTagInput);
            var iduModel = document.createElement("span"); iduModel.className = "project-indoor-model"; iduModel.textContent = getUnitDisplayModel(idu);
            iduRow.appendChild(iduLabel); iduRow.appendChild(iduTagInput); iduRow.appendChild(iduModel); body.appendChild(iduRow);

            var iAccRow = document.createElement("div"); iAccRow.className = "project-accessories-row project-idu-acc-row";
            var iAccLabel = document.createElement("span"); iAccLabel.className = "project-accessories-label"; iAccLabel.textContent = "IDU #" + (i + 1) + " Acc.";
            var iAccInput = document.createElement("textarea"); iAccInput.className = "project-accessories-input"; iAccInput.rows = 1;
            iAccInput.value = (entry.iduAccessories && i < entry.iduAccessories.length) ? (entry.iduAccessories[i] || "") : "";
            iAccInput.placeholder = "Accessories..."; iAccInput.dataset.entryIndex = entryIndex; iAccInput.dataset.field = "iduAccessories"; iAccInput.dataset.iduIndex = i;
            iAccInput.addEventListener("input", handleTagInput);
            iAccRow.appendChild(iAccLabel); iAccRow.appendChild(iAccInput); body.appendChild(iAccRow);
        }

        var oAccRow = document.createElement("div"); oAccRow.className = "project-accessories-row";
        var oAccLabel = document.createElement("span"); oAccLabel.className = "project-accessories-label"; oAccLabel.textContent = "ODU Acc.";
        var oAccInput = document.createElement("textarea"); oAccInput.className = "project-accessories-input"; oAccInput.rows = 1;
        oAccInput.value = entry.outdoorAccessories || ""; oAccInput.placeholder = "Outdoor accessories...";
        oAccInput.dataset.entryIndex = entryIndex; oAccInput.dataset.field = "outdoorAccessories";
        oAccInput.addEventListener("input", handleTagInput);
        oAccRow.appendChild(oAccLabel); oAccRow.appendChild(oAccInput); body.appendChild(oAccRow);

        var docCount = DataLoader.getSystemDocCount(entry.systemId);
        if (docCount > 0) {
            var badge = document.createElement("div"); badge.className = "project-card-docs-badge";
            badge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' + docCount + " documents available";
            body.appendChild(badge);
        }
        card.appendChild(body); return card;
    }

    // Remove entry by array index (supports duplicates)
    function removeEntryByIndex(index) {
        if (!_openTarget || index < 0 || index >= _entries.length) return;
        var removedId = _entries[index].systemId;
        if (_openTarget.type === "cart") {
            _cartEntries.splice(index, 1);
            _cartIdSet = new Set(_cartEntries.map(function (e) { return e.systemId; }));
        } else if (_openTarget.type === "project") {
            var entries = loadProjectEntries(_openTarget.projectId);
            entries.splice(index, 1);
            saveProjectEntries(_openTarget.projectId, entries);
        }
        loadOpenTarget(); renderList(); updateBadge(); updateExportButtons(); notifyChange();
        showToast("System removed", "toast-warning");
    }

    function handleTagInput(e) {
        var el = e.target; var idx = parseInt(el.dataset.entryIndex, 10); var field = el.dataset.field;
        if (idx < 0 || idx >= _entries.length) return;
        if (field === "oduTag") _entries[idx].oduTag = el.value;
        else if (field === "iduTag") { var iduIdx = parseInt(el.dataset.iduIndex, 10); _entries[idx].iduTags[iduIdx] = el.value; }
        else if (field === "iduAccessories") { var accIdx = parseInt(el.dataset.iduIndex, 10); if (!_entries[idx].iduAccessories) _entries[idx].iduAccessories = []; _entries[idx].iduAccessories[accIdx] = el.value; }
        else if (field === "outdoorAccessories") _entries[idx].outdoorAccessories = el.value;
        clearTimeout(_saveTimeout); _saveTimeout = setTimeout(function () { saveOpenTarget(); }, 500);
    }

    // -----------------------------------------------------------------------
    // Badge & Export Buttons
    // -----------------------------------------------------------------------
    function updateBadge() {
        if (!_badge) return; var count = _projects.length; _badge.textContent = count;
        if (count > 0) _badge.classList.remove("hidden"); else _badge.classList.add("hidden");
    }

    function updateExportButtons() {
        var hasEntries = _entries.length > 0;
        if (_btnExportCsv)    _btnExportCsv.disabled = !hasEntries;
        if (_btnExportXlsx)   _btnExportXlsx.disabled = !hasEntries;
        if (_btnExportPdf)    _btnExportPdf.disabled = !hasEntries;
        if (_btnDownloadDocs) _btnDownloadDocs.disabled = !hasEntries;
        if (_btnPreview)      _btnPreview.disabled = !hasEntries;
    }

    // -----------------------------------------------------------------------
    // Save / Refresh
    // -----------------------------------------------------------------------
    function saveOpenTarget() {
        if (!_openTarget) return;
        if (_openTarget.type === "project") {
            saveProjectEntries(_openTarget.projectId, _entries);
            saveProjectNotes(_openTarget.projectId, _indoorNotes, _outdoorNotes);
        }
    }

    function _saveEntriesDirect(entries) {
        _entries = entries;
        if (_openTarget && _openTarget.type === "cart") {
            _cartEntries = entries;
            _cartIdSet = new Set(entries.map(function (e) { return e.systemId; }));
        }
        saveOpenTarget();
        renderList();
    }

    function _saveNotesDirect(indoor, outdoor) {
        _indoorNotes = indoor;
        _outdoorNotes = outdoor;
        saveOpenTarget();
        renderAccessoriesNotes();
    }

    function refreshPanel() {
        if (!_openTarget) return;
        loadOpenTarget();
        renderList();
        renderAccessoriesNotes();
        updateExportButtons();
    }

    // -----------------------------------------------------------------------
    // localStorage
    // -----------------------------------------------------------------------
    function saveProjectsList() { try { localStorage.setItem(STORAGE_KEY_PROJECTS, JSON.stringify(_projects)); } catch (e) { console.warn("[Project] Save list failed:", e); } }
    function loadProjectsList() { try { var j = localStorage.getItem(STORAGE_KEY_PROJECTS); if (j) { var p = JSON.parse(j); if (Array.isArray(p)) _projects = p; } } catch (e) { _projects = []; } }

    function saveProjectEntries(pid, entries) { try { localStorage.setItem(STORAGE_PREFIX_ENTRIES + pid, JSON.stringify(entries)); } catch (e) {} }

    function loadProjectEntries(pid) {
        try {
            var j = localStorage.getItem(STORAGE_PREFIX_ENTRIES + pid);
            if (j) { var p = JSON.parse(j); if (Array.isArray(p)) return p.filter(function (e) { return e.systemId && DataLoader.getSystemById(e.systemId); }).map(function (e) {
                var sys = DataLoader.getSystemById(e.systemId); var n = sys ? sys.indoorUnits.length : 1;
                if (!Array.isArray(e.iduAccessories)) e.iduAccessories = []; while (e.iduAccessories.length < n) e.iduAccessories.push("");
                if (e.outdoorAccessories === undefined) e.outdoorAccessories = ""; return e;
            }); }
        } catch (e) {} return [];
    }

    function saveProjectNotes(pid, indoor, outdoor, productNotes) {
        try {
            var data = { indoor: indoor || [], outdoor: outdoor || [] };
            if (productNotes) data.productNotes = productNotes;
            localStorage.setItem(STORAGE_PREFIX_NOTES + pid, JSON.stringify(data));
        } catch (e) {}
    }

    function loadProjectNotes(pid) {
        var indoor = [], outdoor = [], productNotes = {};
        try {
            var j = localStorage.getItem(STORAGE_PREFIX_NOTES + pid);
            if (j) {
                var p = JSON.parse(j);
                indoor = Array.isArray(p.indoor) ? p.indoor : [];
                outdoor = Array.isArray(p.outdoor) ? p.outdoor : [];
                if (p.productNotes) productNotes = p.productNotes;
            }
        } catch (e) {}
        while (indoor.length < MAX_ACCESSORY_LINES) indoor.push("");
        while (outdoor.length < MAX_ACCESSORY_LINES) outdoor.push("");
        return {
            indoor: indoor.slice(0, MAX_ACCESSORY_LINES),
            outdoor: outdoor.slice(0, MAX_ACCESSORY_LINES),
            productNotes: productNotes
        };
    }

    function getProductNotes() {
        if (!_openTarget) return {};
        if (_openTarget.type === "cart") return _cartProductNotes || {};
        var notes = loadProjectNotes(_openTarget.projectId);
        return notes.productNotes || {};
    }

    function _saveProductNotesDirect(productNotes) {
        if (_openTarget && _openTarget.type === "cart") {
            _cartProductNotes = productNotes;
        }
        if (_openTarget && _openTarget.type === "project") {
            var notes = loadProjectNotes(_openTarget.projectId);
            saveProjectNotes(_openTarget.projectId, notes.indoor, notes.outdoor, productNotes);
        }
    }

    // -----------------------------------------------------------------------
    // Migration
    // -----------------------------------------------------------------------
    function migrateOldData() {
        try {
            var oldEntries = localStorage.getItem(OLD_STORAGE_KEY_ENTRIES); if (!oldEntries) return;
            var entries = JSON.parse(oldEntries); if (!Array.isArray(entries) || entries.length === 0) { localStorage.removeItem(OLD_STORAGE_KEY_ENTRIES); localStorage.removeItem(OLD_STORAGE_KEY_NOTES); return; }
            if (localStorage.getItem(STORAGE_KEY_PROJECTS)) return;
            var project = { id: "proj_migrated_" + Date.now(), name: "My Project" };
            var migrated = [];
            for (var i = 0; i < entries.length; i++) {
                var e = entries[i]; if (!e.systemId) continue; var sys = DataLoader.getSystemById(e.systemId); if (!sys) continue;
                var n = sys.indoorUnits.length;
                if (e.accessories !== undefined && e.iduAccessories === undefined) { e.iduAccessories = [e.accessories || ""]; e.outdoorAccessories = ""; delete e.accessories; }
                if (e.indoorAccessories !== undefined && e.iduAccessories === undefined) { e.iduAccessories = [e.indoorAccessories || ""]; delete e.indoorAccessories; }
                if (!Array.isArray(e.iduAccessories)) e.iduAccessories = []; while (e.iduAccessories.length < n) e.iduAccessories.push("");
                if (e.outdoorAccessories === undefined) e.outdoorAccessories = "";
                migrated.push(e);
            }
            _projects = [project]; saveProjectsList(); saveProjectEntries(project.id, migrated);
            var oldNotes = localStorage.getItem(OLD_STORAGE_KEY_NOTES);
            if (oldNotes) { var np = JSON.parse(oldNotes); saveProjectNotes(project.id, Array.isArray(np.indoor) ? np.indoor : [], Array.isArray(np.outdoor) ? np.outdoor : []); }
            localStorage.removeItem(OLD_STORAGE_KEY_ENTRIES); localStorage.removeItem(OLD_STORAGE_KEY_NOTES);
        } catch (e) { console.warn("[Project] Migration failed:", e); }
    }

    // -----------------------------------------------------------------------
    // Clear All
    // -----------------------------------------------------------------------
    function handleNewProject() {
        if (!_openTarget) return; if (_entries.length === 0 && !hasAnyNotes()) return;
        showConfirmDialog("Clear Systems", "Remove all systems and notes from this view?", "Clear All", function () {
            if (_openTarget.type === "cart") { _cartEntries = []; _cartIdSet = new Set(); _cartIndoorNotes = []; _cartOutdoorNotes = []; initCartNotes(); }
            else { saveProjectEntries(_openTarget.projectId, []); saveProjectNotes(_openTarget.projectId, [], []); }
            loadOpenTarget(); renderList(); renderAccessoriesNotes(); updateBadge(); updateExportButtons(); notifyChange(); showToast("Cleared", "toast-warning");
        });
    }

    function hasAnyNotes() { for (var i = 0; i < MAX_ACCESSORY_LINES; i++) { if (_indoorNotes[i] && _indoorNotes[i].trim()) return true; if (_outdoorNotes[i] && _outdoorNotes[i].trim()) return true; } return false; }

    // -----------------------------------------------------------------------
    // CSV
    // -----------------------------------------------------------------------
    function exportCsv() {
        if (_entries.length === 0) return;
        var lines = [];
        lines.push(["System ID","ODU Tag","ODU Model","System Type","Size","Num Indoor","IDU Tags","IDU Models","IDU Types","IDU Sizes","IDU Accessories","Outdoor Accessories"].join(","));
        for (var i = 0; i < _entries.length; i++) {
            var entry = _entries[i]; var sys = DataLoader.getSystemById(entry.systemId); if (!sys) continue;
            var iduModels = sys.indoorUnits.map(function (u) { return u.manufacturer || u.model || ""; });
            var iduTypes = sys.indoorUnits.map(function (u) { return u.type || ""; });
            var iduSizes = (sys.filters.indoorSizes || (sys.filters.size ? [sys.filters.size] : []));
            var oduModel = sys.outdoorUnit.manufacturer || sys.outdoorUnit.model || "";
            var sysType = sys.filters.systemType || "";
            var sysSize = sys.filters.outdoorSize || sys.filters.size || "";
            lines.push([csvEscape(entry.systemId),csvEscape(entry.oduTag),csvEscape(oduModel),csvEscape(sysType),csvEscape(String(sysSize)),csvEscape(String(sys.indoorUnits.length)),csvEscape(entry.iduTags.join(";")),csvEscape(iduModels.join(";")),csvEscape(iduTypes.join(";")),csvEscape(iduSizes.join(";")),csvEscape((entry.iduAccessories || []).join(";")),csvEscape(entry.outdoorAccessories)].join(","));
        }
        lines.push(""); lines.push("ACCESSORIES (INDOOR UNIT)"); var ai = getActiveIndoorNotes(); for (var j = 0; j < ai.length; j++) lines.push(csvEscape((j+1)+"- "+ai[j]));
        lines.push(""); lines.push("ACCESSORIES (OUTDOOR UNIT)"); var ao = getActiveOutdoorNotes(); for (var k = 0; k < ao.length; k++) lines.push(csvEscape((k+1)+"- "+ao[k]));
        var blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
        var fn = "HHpro_Project.csv";
        if (_openTarget && _openTarget.type === "project") { var proj = getProjectById(_openTarget.projectId); if (proj) fn = "HHpro_" + proj.name.replace(/[^a-zA-Z0-9]/g, "_") + ".csv"; }
        downloadBlob(blob, fn);
    }

    function csvEscape(val) { if (!val) return '""'; var s = String(val); if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) return '"' + s.replace(/"/g, '""') + '"'; return s; }

    function handleLoadCsv(e) {
        var file = e.target.files[0]; if (!file) return; e.target.value = "";
        var reader = new FileReader(); reader.onload = function (evt) { try { importCsv(evt.target.result); } catch (err) { showToast("Failed to load CSV", "toast-danger"); } }; reader.readAsText(file);
    }

    function importCsv(csvText) {
        var lines = csvText.split("\n").filter(function (l) { return l.trim() !== ""; }); if (lines.length < 2) { showToast("CSV is empty", "toast-danger"); return; }
        var imported = 0;
        for (var i = 1; i < lines.length; i++) {
            var line = lines[i].trim(); if (line === "ACCESSORIES (INDOOR UNIT)" || line === "ACCESSORIES (OUTDOOR UNIT)" || line === "") break;
            var cols = parseCsvLine(line); if (cols.length < 7) continue;
            var systemId = cols[0]; if (!DataLoader.getSystemById(systemId)) continue;
            _entries.push({ systemId: systemId, oduTag: cols[1] || "ODU-", iduTags: (cols[6] || "").split(";"), iduAccessories: (cols[10] || "").split(";"), outdoorAccessories: cols[11] || "" });
            _idSet.add(systemId); imported++;
        }
        saveOpenTarget(); renderList(); updateBadge(); updateExportButtons(); notifyChange();
        showToast(imported > 0 ? imported + " system(s) loaded" : "No new systems found", imported > 0 ? "toast-success" : "toast-warning");
    }

    function parseCsvLine(line) {
        var result = [], current = "", inQ = false;
        for (var i = 0; i < line.length; i++) { var ch = line[i]; if (inQ) { if (ch === '"') { if (i+1 < line.length && line[i+1] === '"') { current += '"'; i++; } else inQ = false; } else current += ch; } else { if (ch === '"') inQ = true; else if (ch === ',') { result.push(current); current = ""; } else current += ch; } }
        result.push(current); return result;
    }

    // -----------------------------------------------------------------------
    // Utility
    // -----------------------------------------------------------------------
    function notifyChange() {
        EventBus.emit("project:changed", getProjectIds());
    }

    function showConfirmDialog(title, message, confirmLabel, onConfirm) {
        var ov = document.createElement("div"); ov.className = "confirm-overlay";
        var d = document.createElement("div"); d.className = "confirm-dialog";
        var hd = document.createElement("div"); hd.className = "confirm-dialog-header"; var h3 = document.createElement("h3"); h3.textContent = title; hd.appendChild(h3);
        var bd = document.createElement("div"); bd.className = "confirm-dialog-body"; var p = document.createElement("p"); p.textContent = message; bd.appendChild(p);
        var ft = document.createElement("div"); ft.className = "confirm-dialog-footer";
        var cb = document.createElement("button"); cb.type = "button"; cb.className = "confirm-btn confirm-btn-cancel"; cb.textContent = "Cancel"; cb.addEventListener("click", function () { document.body.removeChild(ov); });
        var cfb = document.createElement("button"); cfb.type = "button"; cfb.className = "confirm-btn confirm-btn-danger"; cfb.textContent = confirmLabel; cfb.addEventListener("click", function () { document.body.removeChild(ov); onConfirm(); });
        ft.appendChild(cb); ft.appendChild(cfb); d.appendChild(hd); d.appendChild(bd); d.appendChild(ft); ov.appendChild(d); document.body.appendChild(ov);
    }

    function showInputDialog(title, label, defaultValue, confirmLabel, onConfirm) {
        var ov = document.createElement("div"); ov.className = "confirm-overlay";
        var d = document.createElement("div"); d.className = "confirm-dialog";
        var hd = document.createElement("div"); hd.className = "confirm-dialog-header"; var h3 = document.createElement("h3"); h3.textContent = title; hd.appendChild(h3);
        var bd = document.createElement("div"); bd.className = "confirm-dialog-body";
        var lbl = document.createElement("label"); lbl.className = "input-dialog-label"; lbl.textContent = label;
        var inp = document.createElement("input"); inp.type = "text"; inp.className = "input-dialog-input"; inp.value = defaultValue || ""; inp.placeholder = "Enter name...";
        bd.appendChild(lbl); bd.appendChild(inp);
        var ft = document.createElement("div"); ft.className = "confirm-dialog-footer";
        var cb = document.createElement("button"); cb.type = "button"; cb.className = "confirm-btn confirm-btn-cancel"; cb.textContent = "Cancel"; cb.addEventListener("click", function () { document.body.removeChild(ov); });
        var cfb = document.createElement("button"); cfb.type = "button"; cfb.className = "confirm-btn confirm-btn-primary"; cfb.textContent = confirmLabel;
        cfb.addEventListener("click", function () { var r = onConfirm(inp.value); if (r !== false) document.body.removeChild(ov); });
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") cfb.click(); });
        ft.appendChild(cb); ft.appendChild(cfb); d.appendChild(hd); d.appendChild(bd); d.appendChild(ft); ov.appendChild(d); document.body.appendChild(ov);
        requestAnimationFrame(function () { inp.focus(); inp.select(); });
    }

    function showToast(message, className) {
        var existing = document.querySelector(".toast"); if (existing) existing.remove();
        var toast = document.createElement("div"); toast.className = "toast"; if (className) toast.classList.add(className); toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(function () { requestAnimationFrame(function () { toast.classList.add("visible"); }); });
        setTimeout(function () { toast.classList.remove("visible"); setTimeout(function () { if (toast.parentNode) toast.remove(); }, 350); }, 2500);
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob); var a = document.createElement("a"); a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    function getProductActiveNotes(productKey) {
        var pn = getProductNotes();
        var notes = pn[productKey];
        if (!notes) return { indoor: [], outdoor: [] };
        return {
            indoor: (notes.indoor || []).filter(function (n) { return n && n.trim() !== ""; }),
            outdoor: (notes.outdoor || []).filter(function (n) { return n && n.trim() !== ""; })
        };
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        init: init,
        requestAddSystem: requestAddSystem,
        addSystem: function (systemId) { requestAddSystem(systemId); },
        removeSystem: removeSystem,
        getProjectIds: getProjectIds,
        getEntries: getEntries,
        getCount: getCount,
        getIndoorNotes: getIndoorNotes,
        getOutdoorNotes: getOutdoorNotes,
        getActiveIndoorNotes: getActiveIndoorNotes,
        getActiveOutdoorNotes: getActiveOutdoorNotes,
        exportCsv: exportCsv,
        openPanel: openPanel,
        closePanel: closePanel,
        togglePanel: togglePanel,
        showToast: showToast,
        downloadBlob: downloadBlob,
        showProjectsPage: showProjectsPage,
        showScheduleView: showScheduleView,
        getCurrentView: getCurrentView,
        getActiveTarget: getActiveTarget,
        refreshPanel: refreshPanel,
        _saveEntriesDirect: _saveEntriesDirect,
        _saveNotesDirect: _saveNotesDirect,
        getProductNotes: getProductNotes,
        getProductActiveNotes: getProductActiveNotes,
        _saveProductNotesDirect: _saveProductNotesDirect,
    };

})();