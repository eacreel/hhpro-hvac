/* ==========================================================================
   preview.js — Schedule Preview overlay with tabbed interface.
   Features:
     - Dedicated tab per product type + Project Files tab
     - Combined single-row schedule tables (indoor + outdoor)
     - Schedule notes from JSON with checkboxes (check order preserved)
     - Drag-to-reorder, duplicate/delete, auto-number, undo/redo
     - Column visibility toggles
   ========================================================================== */

const SchedulePreview = (function () {

    let _overlay = null;
    let _isOpen = false;
    let _saveTimeout = null;
    let _activeTab = null;

    // Working copies
    let _entries = [];
    let _notesByProduct = {};  // { "mini-splits": ["note1","note3"], ... } — ordered checked notes
    const MAX_CUSTOM_NOTES = 5;

    // -----------------------------------------------------------------------
    // History (undo / redo)
    // -----------------------------------------------------------------------
    let _history = [];
    let _historyIndex = -1;
    const MAX_HISTORY = 50;

    function pushHistory() {
        _history = _history.slice(0, _historyIndex + 1);
        _history.push({ entries: JSON.parse(JSON.stringify(_entries)), notesByProduct: JSON.parse(JSON.stringify(_notesByProduct)) });
        if (_history.length > MAX_HISTORY) _history.shift();
        _historyIndex = _history.length - 1;
        updateUndoRedoButtons();
    }

    function undo() { if (_historyIndex <= 0) return; collectEditsFromDom(); if (_historyIndex === _history.length - 1) { _history[_historyIndex] = { entries: JSON.parse(JSON.stringify(_entries)), notesByProduct: JSON.parse(JSON.stringify(_notesByProduct)) }; } _historyIndex--; restoreFromHistory(); }
    function redo() { if (_historyIndex >= _history.length - 1) return; _historyIndex++; restoreFromHistory(); }

    function restoreFromHistory() {
        var snap = _history[_historyIndex];
        _entries = JSON.parse(JSON.stringify(snap.entries));
        _notesByProduct = JSON.parse(JSON.stringify(snap.notesByProduct));
        _selectedEntries.clear();
        saveState();
        rebuildContent();
        updateUndoRedoButtons();
    }

    function updateUndoRedoButtons() {
        var undoBtn = document.getElementById("sp-btn-undo");
        var redoBtn = document.getElementById("sp-btn-redo");
        if (undoBtn) undoBtn.disabled = _historyIndex <= 0;
        if (redoBtn) redoBtn.disabled = _historyIndex >= _history.length - 1;
    }

    // -----------------------------------------------------------------------
    // Column Visibility (simplified — always show all for now)
    // -----------------------------------------------------------------------
    let _hiddenColumns = new Set();
    function isColVisible(key) { return !_hiddenColumns.has(key); }
    function getHiddenColumns() { return new Set(_hiddenColumns); }

    // -----------------------------------------------------------------------
    // Multi-Select
    // -----------------------------------------------------------------------
    let _selectedEntries = new Set();

    function toggleSelect(idx) { if (_selectedEntries.has(idx)) _selectedEntries.delete(idx); else _selectedEntries.add(idx); updateSelectionUI(); }

    function updateSelectionUI() {
        if (!_overlay) return;
        var cbs = _overlay.querySelectorAll(".sp-row-checkbox");
        for (var i = 0; i < cbs.length; i++) cbs[i].checked = _selectedEntries.has(parseInt(cbs[i].dataset.entry, 10));
        var bulkBar = document.getElementById("sp-bulk-bar");
        var bulkCount = document.getElementById("sp-bulk-count");
        if (_selectedEntries.size > 0) { bulkBar.classList.remove("hidden"); bulkCount.textContent = _selectedEntries.size + " selected"; }
        else { bulkBar.classList.add("hidden"); }
    }

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------
    function init() {
        _overlay = document.getElementById("schedule-preview-overlay");
        var btn = document.getElementById("btn-preview-schedule");
        if (btn) btn.addEventListener("click", open);
        console.log("[SchedulePreview] Initialized");
    }

    // -----------------------------------------------------------------------
    // Open / Close
    // -----------------------------------------------------------------------
    function open() {
        if (_isOpen) return;
        var entries = Project.getEntries();
        if (entries.length === 0) return;

        _isOpen = true;
        _entries = JSON.parse(JSON.stringify(entries));

        // Load per-product notes (flat arrays of checked note strings)
        var existingNotes = Project.getProductNotes();
        _notesByProduct = {};
        var pks = ["mini-splits", "multi-position", "gas-packs"];
        for (var p = 0; p < pks.length; p++) {
            var pk = pks[p];
            var existing = existingNotes[pk];
            if (Array.isArray(existing)) {
                _notesByProduct[pk] = existing.slice();
            } else if (existing && (existing.indoor || existing.outdoor)) {
                // Migrate old indoor/outdoor format
                var combined = [];
                if (Array.isArray(existing.indoor)) combined = combined.concat(existing.indoor.filter(function (n) { return n && n.trim(); }));
                if (Array.isArray(existing.outdoor)) combined = combined.concat(existing.outdoor.filter(function (n) { return n && n.trim(); }));
                _notesByProduct[pk] = combined;
            } else {
                _notesByProduct[pk] = [];
            }
        }

        _selectedEntries.clear();
        _history = [];
        _historyIndex = -1;
        pushHistory();

        // Determine initial tab
        var groups = groupEntriesByProduct();
        if (groups["mini-splits"] && groups["mini-splits"].length > 0) _activeTab = "mini-splits";
        else if (groups["multi-position"] && groups["multi-position"].length > 0) _activeTab = "multi-position";
        else if (groups["gas-packs"] && groups["gas-packs"].length > 0) _activeTab = "gas-packs";
        else _activeTab = "files";

        buildPreview();
        _overlay.classList.remove("hidden");
        document.body.classList.add("preview-open");
        document.addEventListener("keydown", handleKeyDown);
    }

    function close() {
        if (!_isOpen) return;
        clearTimeout(_saveTimeout);
        collectEditsFromDom();
        saveState();
        _isOpen = false;
        _overlay.classList.add("hidden");
        _overlay.innerHTML = "";
        document.body.classList.remove("preview-open");
        document.removeEventListener("keydown", handleKeyDown);
        Project.refreshPanel();
    }

    function handleKeyDown(e) {
        if (!_isOpen) return;
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
            else if (e.key === "y" || (e.key === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
        }
    }

    // -----------------------------------------------------------------------
    // Group entries by product type
    // -----------------------------------------------------------------------
    function groupEntriesByProduct() {
        var groups = {};
        for (var i = 0; i < _entries.length; i++) {
            var sys = DataLoader.getSystemById(_entries[i].systemId);
            var pk = "mini-splits";
            if (sys && sys.productKey === "multi-position") pk = "multi-position";
            else if (sys && sys.productKey === "gas-packs") pk = "gas-packs";
            if (!groups[pk]) groups[pk] = [];
            groups[pk].push(i);
        }
        return groups;
    }

    // -----------------------------------------------------------------------
    // Tab labels
    // -----------------------------------------------------------------------
    var TAB_LABELS = {
        "mini-splits": "Mini Splits",
        "multi-position": "Multi Position Splits",
        "gas-packs": "Light Commercial RTUs",
        "files": "Project Files"
    };

    // -----------------------------------------------------------------------
    // Build Preview
    // -----------------------------------------------------------------------
    function buildPreview() {
        var html = "";

        // Toolbar
        html += '<div class="sp-toolbar">';
        html += '  <div class="sp-toolbar-left">';
        html += '    <button class="sp-close-btn" id="sp-btn-close" type="button" title="Close preview">';
        html += '      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>';
        html += '      Back';
        html += '    </button>';
        html += '    <h2 class="sp-title">Schedule Preview</h2>';
        html += '  </div>';
        html += '  <div class="sp-toolbar-right">';
        html += '    <button class="sp-tool-btn" id="sp-btn-undo" type="button" title="Undo (Ctrl+Z)" disabled>';
        html += '      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
        html += '    </button>';
        html += '    <button class="sp-tool-btn" id="sp-btn-redo" type="button" title="Redo (Ctrl+Y)" disabled>';
        html += '      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"/></svg>';
        html += '    </button>';
        html += '    <span class="sp-toolbar-sep"></span>';
        html += '    <button class="sp-tool-btn" id="sp-btn-autonumber" type="button" title="Auto-number tags">Auto #</button>';
        html += '    <span class="sp-toolbar-sep"></span>';
        html += '    <button class="sp-dl-btn" id="sp-btn-xlsx" type="button">Download Excel</button>';
        html += '    <button class="sp-dl-btn" id="sp-btn-pdf" type="button">Download PDF</button>';
        html += '  </div>';
        html += '</div>';

        // Tabs
        var groups = groupEntriesByProduct();
        html += '<div class="sp-tabs" id="sp-tabs">';
        var tabOrder = ["mini-splits", "multi-position", "gas-packs"];
        for (var ti = 0; ti < tabOrder.length; ti++) {
            var tk = tabOrder[ti];
            if (groups[tk] && groups[tk].length > 0) {
                var active = (_activeTab === tk) ? " sp-tab-active" : "";
                html += '<button class="sp-tab' + active + '" data-sp-tab="' + tk + '">' + TAB_LABELS[tk] + ' <span class="sp-tab-count">' + groups[tk].length + '</span></button>';
            }
        }
        var filesActive = (_activeTab === "files") ? " sp-tab-active" : "";
        html += '<button class="sp-tab' + filesActive + '" data-sp-tab="files">' + TAB_LABELS["files"] + '</button>';
        html += '</div>';

        // Bulk bar
        html += '<div id="sp-bulk-bar" class="sp-bulk-bar hidden">';
        html += '  <span id="sp-bulk-count">0 selected</span>';
        html += '  <button class="sp-bulk-btn" id="sp-bulk-duplicate" type="button">Duplicate Selected</button>';
        html += '  <button class="sp-bulk-btn sp-bulk-btn-danger" id="sp-bulk-delete" type="button">Delete Selected</button>';
        html += '  <button class="sp-bulk-btn" id="sp-bulk-deselect" type="button">Deselect All</button>';
        html += '</div>';

        // Tab content
        html += '<div class="sp-content" id="sp-content">';
        html += buildTabContent();
        html += '</div>';

        _overlay.innerHTML = html;
        wireEvents();
    }

    function buildTabContent() {
        if (_activeTab === "files") return buildFilesTab();
        return buildScheduleTab(_activeTab);
    }

    // -----------------------------------------------------------------------
    // Schedule Tab Content
    // -----------------------------------------------------------------------
    function buildScheduleTab(productKey) {
        var groups = groupEntriesByProduct();
        var indices = groups[productKey];
        if (!indices || indices.length === 0) return '<div class="sp-empty-tab">No systems of this type.</div>';

        var html = '<div class="sp-schedule-wrap">';

        if (productKey === "mini-splits") {
            html += '<div class="sp-schedule-title">SPLIT SYSTEM SCHEDULE</div>';
            html += buildMsTable(indices);
        } else if (productKey === "multi-position") {
            html += '<div class="sp-schedule-title">MULTI POSITION SPLIT SYSTEM SCHEDULE</div>';
            html += buildMpsTable(indices);
        } else if (productKey === "gas-packs") {
            html += '<div class="sp-schedule-title">PACKAGED ROOFTOP UNIT SCHEDULE</div>';
            html += buildGpTable(indices);
        }

        // Schedule notes section
        html += buildScheduleNotesSection(productKey);

        html += '</div>';
        return html;
    }

    // -----------------------------------------------------------------------
    // Combined Mini Splits Table
    // -----------------------------------------------------------------------
    function buildMsTable(indices) {
        var h = '<div class="sp-table-scroll"><table class="sp-table"><thead>';
        h += '<tr class="sp-hdr-section"><th rowspan="3" class="sp-col-action"><input type="checkbox" id="sp-select-all" title="Select all"></th>';
        h += '<th colspan="13" class="sp-section-indoor">INDOOR UNIT</th>';
        h += '<th colspan="10" class="sp-section-outdoor">OUTDOOR UNIT</th></tr>';
        h += '<tr class="sp-hdr1">';
        h += '<th rowspan="2">CFM</th>';
        h += '<th colspan="4" class="sp-col-group">COOLING CAPACITY</th>';
        h += '<th colspan="2" class="sp-col-group">HEAT PUMP HEATING</th>';
        h += '<th rowspan="2">OP.<br>WEIGHT</th><th rowspan="2">INDOOR<br>UNIT TYPE</th>';
        h += '<th colspan="3" class="sp-col-group">ELECTRICAL</th>';
        h += '<th rowspan="2">MFG<br>DAIKIN</th>';
        h += '<th rowspan="2">OA AMB<br>(COOL)</th><th rowspan="2">OA AMB<br>(HEAT)</th>';
        h += '<th rowspan="2">OP.<br>WEIGHT</th><th rowspan="2">SEER2/EER2/<br>HSPF2</th>';
        h += '<th colspan="3" class="sp-col-group">ELECTRICAL</th>';
        h += '<th rowspan="2">MFG<br>DAIKIN</th><th rowspan="2">REFRIG.</th><th rowspan="2">LINE-SET</th>';
        h += '</tr><tr class="sp-hdr2">';
        h += '<th>EDB</th><th>EWB</th><th>TOTAL<br>CAP.</th><th>SENS.<br>CAP.</th>';
        h += '<th>EDB</th><th>TOTAL<br>CAP.</th>';
        h += '<th>Voltage</th><th>MCA</th><th>MOP</th>';
        h += '<th>Voltage</th><th>MCA</th><th>MOP</th>';
        h += '</tr></thead><tbody>';

        for (var ii = 0; ii < indices.length; ii++) {
            var ei = indices[ii];
            var entry = _entries[ei];
            var sys = DataLoader.getSystemById(entry.systemId);
            if (!sys) continue;
            var numIdu = sys.indoorUnits.length;
            var odu = sys.outdoorUnit;

            for (var j = 0; j < numIdu; j++) {
                var idu = sys.indoorUnits[j];
                var iduTag = (j < entry.iduTags.length) ? entry.iduTags[j] : "IDU-";

                h += '<tr data-entry-idx="' + ei + '" data-idu-idx="' + j + '"' + (j === 0 ? ' draggable="true"' : '') + '>';

                if (j === 0) h += buildActionCell(ei, numIdu, entry);

                // Indoor columns
                h += '<td>' + fmt(idu.cfm) + '</td>';
                h += '<td>' + fmt(idu.coolingEdb) + '</td>';
                h += '<td>' + fmt(idu.coolingEwb) + '</td>';
                h += '<td>' + fmt(idu.coolingTotal) + '</td>';
                h += '<td>' + fmt(idu.coolingSensible) + '</td>';
                h += '<td>' + fmt(idu.heatingEdb) + '</td>';
                h += '<td>' + fmt(idu.heatingTotal) + '</td>';
                h += '<td>' + fmt(idu.weight) + '</td>';
                h += '<td class="sp-cell-text">' + esc(idu.type || "") + '</td>';
                if (idu.poweredFromOutdoor) {
                    h += '<td colspan="3" class="sp-cell-powered">Powered From ODU</td>';
                } else {
                    h += '<td>' + esc(idu.voltage || "") + '</td>';
                    h += '<td>' + fmt(idu.mca) + '</td>';
                    h += '<td>' + fmt(idu.mop) + '</td>';
                }
                h += '<td class="sp-cell-model">' + esc(idu.manufacturer || "") + '</td>';

                // Outdoor columns (only on first indoor row, spans all)
                if (j === 0) {
                    var rs = numIdu > 1 ? ' rowspan="' + numIdu + '"' : '';
                    h += '<td' + rs + '>' + fmt(odu.coolingAmbient) + '</td>';
                    h += '<td' + rs + '>' + fmt(odu.heatingAmbient) + '</td>';
                    h += '<td' + rs + '>' + fmt(odu.weight) + '</td>';
                    h += '<td' + rs + ' class="sp-cell-text">' + esc(odu.seer || "") + '</td>';
                    h += '<td' + rs + '>' + esc(odu.voltage || "") + '</td>';
                    h += '<td' + rs + '>' + fmt(odu.mca) + '</td>';
                    h += '<td' + rs + '>' + fmt(odu.mop) + '</td>';
                    h += '<td' + rs + ' class="sp-cell-model">' + esc(odu.manufacturer || "") + '</td>';
                    h += '<td' + rs + '>' + esc(odu.refrigerant || "") + '</td>';
                    h += '<td' + rs + ' class="sp-cell-text">' + esc(odu.lineSet || "") + '</td>';
                }

                h += '</tr>';
            }
        }
        h += '</tbody></table></div>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Combined MPS Table
    // -----------------------------------------------------------------------
    function buildMpsTable(indices) {
        var h = '<div class="sp-table-scroll"><table class="sp-table"><thead>';
        h += '<tr class="sp-hdr-section"><th rowspan="3" class="sp-col-action"><input type="checkbox" id="sp-select-all-mps" title="Select all"></th>';
        h += '<th colspan="16" class="sp-section-indoor">INDOOR AIR HANDLING UNIT</th>';
        h += '<th colspan="12" class="sp-section-outdoor">OUTDOOR CONDENSING UNIT</th>';
        h += '<th rowspan="3" class="sp-col-acc">NOTES</th></tr>';
        h += '<tr class="sp-hdr1">';
        h += '<th rowspan="2">MODEL<br>(DAIKIN)</th>';
        h += '<th colspan="3" class="sp-col-group">SUPPLY FAN</th>';
        h += '<th colspan="5" class="sp-col-group">COOLING</th>';
        h += '<th rowspan="2">HP TOTAL<br>CAP.</th>';
        h += '<th colspan="2" class="sp-col-group">AUX. HEAT</th>';
        h += '<th colspan="3" class="sp-col-group">ELECTRICAL</th>';
        h += '<th rowspan="2">WEIGHT</th>';
        h += '<th rowspan="2">MODEL<br>(DAIKIN)</th>';
        h += '<th colspan="3" class="sp-col-group">HP HEATING DATA</th>';
        h += '<th colspan="3" class="sp-col-group">ELECTRICAL</th>';
        h += '<th rowspan="2">OA AMB<br>(COOL)</th><th rowspan="2">REFRIG.</th><th rowspan="2">EFF.</th>';
        h += '<th rowspan="2">COMP.<br>STAGES</th><th rowspan="2">WEIGHT</th>';
        h += '</tr><tr class="sp-hdr2">';
        h += '<th>CFM</th><th>HP</th><th>TYPE</th>';
        h += '<th>EAT DB</th><th>EAT WB</th><th>LAT DB</th><th>TOTAL</th><th>SENS.</th>';
        h += '<th>kW</th><th>RISE</th>';
        h += '<th>V/PH</th><th>MCA</th><th>MOP</th>';
        h += '<th>AMB DB</th><th>TOTAL</th><th>EFF.</th>';
        h += '<th>V/PH</th><th>MCA</th><th>MOP</th>';
        h += '</tr></thead><tbody>';

        for (var ii = 0; ii < indices.length; ii++) {
            var ei = indices[ii];
            var entry = _entries[ei];
            var sys = DataLoader.getSystemById(entry.systemId);
            if (!sys) continue;
            var idu = sys.indoorUnits[0];
            var odu = sys.outdoorUnit;
            var iduAcc = (entry.iduAccessories && entry.iduAccessories.length > 0) ? (entry.iduAccessories[0] || "") : "";

            h += '<tr data-entry-idx="' + ei + '" draggable="true">';
            h += buildActionCell(ei, 1, entry);
            h += '<td class="sp-cell-model">' + esc(idu.model || "") + '</td>';
            h += '<td>' + fmt(idu.airflow) + '</td><td>' + fmt(idu.motorHp) + '</td><td class="sp-cell-text">' + esc(idu.motorType || "") + '</td>';
            h += '<td>' + fmt(idu.coolingEatDb) + '</td><td>' + fmt(idu.coolingEatWb) + '</td><td>' + fmt(idu.coolingLatDb) + '</td>';
            h += '<td>' + fmt(idu.coolingTotal) + '</td><td>' + fmt(idu.coolingSensible) + '</td>';
            h += '<td>' + fmt(idu.heatPumpTotalCapacity) + '</td>';
            h += '<td>' + esc(idu.auxHeatKw || "") + '</td><td>' + esc(idu.auxHeatTempRise || "") + '</td>';
            h += '<td>' + esc(idu.voltage || "") + '</td><td>' + fmt(idu.mca) + '</td><td>' + fmt(idu.mop) + '</td>';
            h += '<td>' + fmt(idu.weight) + '</td>';
            h += '<td class="sp-cell-model">' + esc(odu.model || "") + '</td>';
            h += '<td>' + fmt(odu.heatingAmbient) + '</td><td>' + fmt(odu.heatingTotal) + '</td><td class="sp-cell-text">' + esc(odu.heatingEfficiency || "") + '</td>';
            h += '<td>' + esc(odu.voltage || "") + '</td><td>' + fmt(odu.mca) + '</td><td>' + fmt(odu.mop) + '</td>';
            h += '<td>' + fmt(odu.coolingAmbient) + '</td><td>' + esc(odu.refrigerant || "") + '</td><td class="sp-cell-text">' + esc(odu.efficiency || "") + '</td>';
            h += '<td>' + esc(odu.compressorStages || "") + '</td><td>' + fmt(odu.weight) + '</td>';
            h += '<td class="sp-cell-edit"><input class="sp-input sp-input-acc" type="text" value="' + esc(iduAcc) + '" data-entry="' + ei + '" data-field="iduAccessories" data-idu="0"></td>';
            h += '</tr>';
        }
        h += '</tbody></table></div>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Gas Packs Table
    // -----------------------------------------------------------------------
    function buildGpTable(indices) {
        var h = '<div class="sp-table-scroll"><table class="sp-table"><thead>';
        h += '<tr class="sp-hdr1">';
        h += '<th rowspan="2" class="sp-col-action"><input type="checkbox" id="sp-select-all-gp" title="Select all"></th>';
        h += '<th rowspan="2">TAG</th><th rowspan="2">MODEL</th><th rowspan="2">NOM<br>TONS</th>';
        h += '<th colspan="3" class="sp-col-group">FAN DATA</th>';
        h += '<th colspan="7" class="sp-col-group">COOLING PERFORMANCE</th>';
        h += '<th colspan="4" class="sp-col-group">HEATING PERFORMANCE</th>';
        h += '<th rowspan="2">HGRH</th><th rowspan="2">COOL<br>STAGES</th>';
        h += '<th colspan="4" class="sp-col-group">ELECTRICAL</th>';
        h += '<th rowspan="2" class="sp-col-acc">NOTES</th>';
        h += '</tr><tr class="sp-hdr2">';
        h += '<th>CFM</th><th>ESP</th><th>TESP</th>';
        h += '<th>TOTAL</th><th>SENS.</th><th>EFF.</th><th>EDB</th><th>EWB</th><th>LDB</th><th>LWB</th>';
        h += '<th>INPUT</th><th>OUTPUT</th><th>EAT</th><th>LAT</th>';
        h += '<th>V/PH</th><th>HP</th><th>MCA</th><th>MOCP</th>';
        h += '</tr></thead><tbody>';

        for (var ii = 0; ii < indices.length; ii++) {
            var ei = indices[ii];
            var entry = _entries[ei];
            var sys = DataLoader.getSystemById(entry.systemId);
            if (!sys) continue;
            var sc = sys.schedule;

            h += '<tr data-entry-idx="' + ei + '" draggable="true">';
            h += buildActionCell(ei, 1, entry);
            h += '<td class="sp-cell-edit"><input class="sp-input sp-input-tag" type="text" value="' + esc(entry.oduTag || "RTU-") + '" data-entry="' + ei + '" data-field="oduTag"></td>';
            h += '<td class="sp-cell-model">' + esc(sc.model || "") + '</td>';
            h += '<td>' + fmt(sc.nomTons) + '</td>';
            h += '<td>' + fmt(sc.cfm) + '</td><td>' + fmt(sc.esp) + '</td><td>' + fmt(sc.tesp) + '</td>';
            h += '<td>' + fmt(sc.coolingTotalCapacity) + '</td><td>' + fmt(sc.coolingSensibleCapacity) + '</td>';
            h += '<td class="sp-cell-text">' + esc(sc.efficiency || "") + '</td>';
            h += '<td>' + fmt(sc.edb) + '</td><td>' + fmt(sc.ewb) + '</td><td>' + fmt(sc.ldb) + '</td><td>' + fmt(sc.lwb) + '</td>';
            h += '<td>' + fmt(sc.heatingInput) + '</td><td>' + fmt(sc.heatingOutput) + '</td>';
            h += '<td>' + fmt(sc.heatingEat) + '</td><td>' + fmt(sc.heatingLat) + '</td>';
            h += '<td>' + esc(sc.hgrh || "") + '</td><td>' + fmt(sc.coolingStages) + '</td>';
            h += '<td>' + esc(sc.voltage || "") + '</td><td>' + fmt(sc.motorHp) + '</td>';
            h += '<td>' + fmt(sc.mca) + '</td><td>' + fmt(sc.mocp) + '</td>';
            h += '<td class="sp-cell-edit"><input class="sp-input sp-input-acc" type="text" value="' + esc(entry.outdoorAccessories || "") + '" data-entry="' + ei + '" data-field="outdoorAccessories"></td>';
            h += '</tr>';
        }
        h += '</tbody></table></div>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Action Cell Builder
    // -----------------------------------------------------------------------
    function buildActionCell(ei, numIdu, entry) {
        var h = '<td class="sp-cell-action"' + (numIdu > 1 ? ' rowspan="' + numIdu + '"' : '') + '>';
        h += '<div class="sp-action-wrap">';
        h += '<div class="sp-action-top">';
        h += '<input type="checkbox" class="sp-row-checkbox" data-entry="' + ei + '">';
        h += '<span class="sp-entry-num">#' + (ei + 1) + '</span>';
        h += '<span class="sp-drag-handle" title="Drag to reorder">&#9776;</span>';
        h += '</div>';
        h += '<div class="sp-action-ops">';
        h += '<button class="sp-act-btn sp-act-dup" data-action="duplicate" data-entry="' + ei + '" title="Duplicate">Dup</button>';
        h += '<button class="sp-act-btn sp-act-del" data-action="delete" data-entry="' + ei + '" title="Delete">Del</button>';
        h += '</div>';
        h += '</div></td>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Schedule Notes Section (checkbox-based from JSON)
    // -----------------------------------------------------------------------
    function buildScheduleNotesSection(productKey) {
        var availableNotes = DataLoader.getScheduleNotes(productKey);
        var checkedNotes = _notesByProduct[productKey] || [];

        var h = '<div class="sp-sched-notes-section">';

        // Active notes display (ordered list of checked notes)
        h += '<div class="sp-active-notes">';
        h += '<div class="sp-active-notes-heading">SCHEDULE NOTES:</div>';
        if (checkedNotes.length === 0) {
            h += '<div class="sp-active-notes-empty">No notes selected. Check notes below to add them.</div>';
        } else {
            h += '<ol class="sp-active-notes-list">';
            for (var ai = 0; ai < checkedNotes.length; ai++) {
                h += '<li>' + esc(checkedNotes[ai]) + '</li>';
            }
            h += '</ol>';
        }
        h += '</div>';

        // Available notes with checkboxes
        if (availableNotes.length > 0) {
            h += '<div class="sp-avail-notes">';
            h += '<div class="sp-avail-notes-heading">Available Schedule Notes <span class="sp-avail-notes-hint">(check to add, order preserved)</span></div>';
            for (var ni = 0; ni < availableNotes.length; ni++) {
                var noteText = availableNotes[ni];
                var isChecked = checkedNotes.indexOf(noteText) !== -1;
                h += '<label class="sp-note-option">';
                h += '<input type="checkbox" class="sp-note-cb" data-note-product="' + productKey + '" data-note-text="' + esc(noteText) + '"' + (isChecked ? ' checked' : '') + '>';
                h += '<span class="sp-note-text">' + esc(noteText) + '</span>';
                h += '</label>';
            }
            h += '</div>';
        }

        // Custom notes (freeform)
        h += '<div class="sp-custom-notes">';
        h += '<div class="sp-custom-notes-heading">Custom Notes</div>';
        for (var ci = 0; ci < MAX_CUSTOM_NOTES; ci++) {
            h += '<div class="sp-custom-note-line">';
            h += '<input class="sp-input sp-input-custom-note" type="text" placeholder="Custom note..." data-custom-note-product="' + productKey + '" data-custom-note-index="' + ci + '">';
            h += '</div>';
        }
        h += '</div>';

        h += '</div>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Files Tab
    // -----------------------------------------------------------------------
    function buildFilesTab() {
        var h = '<div class="sp-files-tab">';
        h += '<div class="sp-docs-header"><span class="sp-docs-title">Project Files</span>';
        h += '<button class="sp-docs-download-btn" id="sp-btn-download-bundle" type="button">';
        h += '<svg class="sp-dl-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        h += ' Download Selected</button></div>';

        h += '<div class="sp-docs-options">';
        h += '<label class="sp-docs-option"><input type="checkbox" id="sp-doc-include-xlsx" checked> Include Excel Schedule</label>';
        h += '<label class="sp-docs-option"><input type="checkbox" id="sp-doc-include-pdf" checked> Include PDF Schedule</label>';
        h += '<label class="sp-docs-option"><input type="checkbox" id="sp-doc-select-all" checked> Select / Deselect All</label>';
        h += '</div>';

        // Document list per entry
        h += '<div class="sp-docs-list">';
        for (var ei = 0; ei < _entries.length; ei++) {
            var entry = _entries[ei];
            var docs = DataLoader.getSystemDocuments(entry.systemId);
            if (docs.length === 0) continue;

            h += '<div class="sp-doc-card">';
            h += '<div class="sp-doc-card-header"><input type="checkbox" class="sp-doc-card-checkbox" data-doc-system="' + ei + '" checked>';
            h += '<span class="sp-doc-card-title">' + esc(entry.oduTag) + ' — ' + esc(DataLoader.getSystemSummary(entry.systemId)) + '</span>';
            h += '<span class="sp-doc-card-count">' + docs.length + ' files</span></div>';

            h += '<div class="sp-doc-card-body">';
            for (var di = 0; di < docs.length; di++) {
                var doc = docs[di];
                var ext = doc.path.split('.').pop().toUpperCase();
                h += '<div class="sp-doc-row"><input type="checkbox" class="sp-doc-file-cb" data-doc-path="' + esc(doc.path) + '" data-doc-entry="' + ei + '" checked>';
                h += '<span class="sp-doc-row-label">' + esc(doc.label) + '</span>';
                h += '<span class="sp-doc-row-type">' + ext + '</span></div>';
            }
            h += '</div></div>';
        }
        h += '</div></div>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Rebuild Content (after tab switch or data change)
    // -----------------------------------------------------------------------
    function rebuildContent() {
        var el = document.getElementById("sp-content");
        if (el) { el.innerHTML = buildTabContent(); wireContentEvents(); updateSelectionUI(); }
    }

    // -----------------------------------------------------------------------
    // Wire Events
    // -----------------------------------------------------------------------
    function wireEvents() {
        // Close button
        var closeBtn = document.getElementById("sp-btn-close");
        if (closeBtn) closeBtn.addEventListener("click", close);

        // Undo/Redo
        var undoBtn = document.getElementById("sp-btn-undo");
        var redoBtn = document.getElementById("sp-btn-redo");
        if (undoBtn) undoBtn.addEventListener("click", undo);
        if (redoBtn) redoBtn.addEventListener("click", redo);

        // Auto number
        var autoBtn = document.getElementById("sp-btn-autonumber");
        if (autoBtn) autoBtn.addEventListener("click", showAutoNumberDialog);

        // Download
        var xlsxBtn = document.getElementById("sp-btn-xlsx");
        var pdfBtn = document.getElementById("sp-btn-pdf");
        if (xlsxBtn) xlsxBtn.addEventListener("click", function () { collectEditsFromDom(); saveState(); Export.exportScheduleXlsx(); });
        if (pdfBtn) pdfBtn.addEventListener("click", function () { collectEditsFromDom(); saveState(); Export.exportSchedulePdf(); });

        // Bulk actions
        var bulkDup = document.getElementById("sp-bulk-duplicate");
        var bulkDel = document.getElementById("sp-bulk-delete");
        var bulkDesel = document.getElementById("sp-bulk-deselect");
        if (bulkDup) bulkDup.addEventListener("click", function () { bulkDuplicate(); });
        if (bulkDel) bulkDel.addEventListener("click", function () { bulkDelete(); });
        if (bulkDesel) bulkDesel.addEventListener("click", function () { _selectedEntries.clear(); updateSelectionUI(); });

        // Tab clicks
        var tabs = _overlay.querySelectorAll(".sp-tab");
        for (var t = 0; t < tabs.length; t++) {
            tabs[t].addEventListener("click", function () {
                collectEditsFromDom();
                _activeTab = this.dataset.spTab;
                // Update tab active state
                var allTabs = _overlay.querySelectorAll(".sp-tab");
                for (var j = 0; j < allTabs.length; j++) allTabs[j].classList.remove("sp-tab-active");
                this.classList.add("sp-tab-active");
                rebuildContent();
            });
        }

        wireContentEvents();
    }

    function wireContentEvents() {
        if (!_overlay) return;

        // Schedule note checkboxes
        var noteCbs = _overlay.querySelectorAll(".sp-note-cb");
        for (var nc = 0; nc < noteCbs.length; nc++) {
            noteCbs[nc].addEventListener("change", handleNoteCheckbox);
        }

        // Select all checkboxes
        var selAlls = _overlay.querySelectorAll("#sp-select-all, #sp-select-all-mps, #sp-select-all-gp");
        for (var sa = 0; sa < selAlls.length; sa++) {
            selAlls[sa].addEventListener("change", function () {
                var checked = this.checked;
                var groups = groupEntriesByProduct();
                var indices = groups[_activeTab] || [];
                for (var i = 0; i < indices.length; i++) {
                    if (checked) _selectedEntries.add(indices[i]); else _selectedEntries.delete(indices[i]);
                }
                updateSelectionUI();
            });
        }

        // Row checkboxes
        var rowCbs = _overlay.querySelectorAll(".sp-row-checkbox");
        for (var rc = 0; rc < rowCbs.length; rc++) {
            rowCbs[rc].addEventListener("change", function () { toggleSelect(parseInt(this.dataset.entry, 10)); });
        }

        // Action buttons (duplicate, delete)
        var actBtns = _overlay.querySelectorAll(".sp-act-btn");
        for (var ab = 0; ab < actBtns.length; ab++) {
            actBtns[ab].addEventListener("click", handleActionButton);
        }

        // Input change handlers
        var inputs = _overlay.querySelectorAll(".sp-input");
        for (var inp = 0; inp < inputs.length; inp++) {
            inputs[inp].addEventListener("input", handleEdit);
        }

        // Files tab events
        wireFileEvents();

        // Drag and drop
        wireDragEvents();
    }

    function wireFileEvents() {
        var dlBtn = document.getElementById("sp-btn-download-bundle");
        if (dlBtn) dlBtn.addEventListener("click", downloadBundle);

        var selAll = document.getElementById("sp-doc-select-all");
        if (selAll) selAll.addEventListener("change", function () {
            var checked = this.checked;
            var cbs = _overlay.querySelectorAll(".sp-doc-file-cb, .sp-doc-card-checkbox");
            for (var i = 0; i < cbs.length; i++) cbs[i].checked = checked;
        });

        var sysCbs = _overlay.querySelectorAll(".sp-doc-card-checkbox");
        for (var s = 0; s < sysCbs.length; s++) {
            sysCbs[s].addEventListener("change", function () {
                var card = this.closest(".sp-doc-card");
                if (card) { var cbs = card.querySelectorAll(".sp-doc-file-cb"); for (var i = 0; i < cbs.length; i++) cbs[i].checked = this.checked; }
            });
        }
    }

    function wireDragEvents() {
        var rows = _overlay.querySelectorAll("tr[draggable='true']");
        for (var r = 0; r < rows.length; r++) {
            rows[r].addEventListener("dragstart", function (e) {
                e.dataTransfer.setData("text/plain", this.dataset.entryIdx);
                this.classList.add("sp-dragging");
            });
            rows[r].addEventListener("dragend", function () { this.classList.remove("sp-dragging"); });
            rows[r].addEventListener("dragover", function (e) { e.preventDefault(); this.classList.add("sp-drag-over"); });
            rows[r].addEventListener("dragleave", function () { this.classList.remove("sp-drag-over"); });
            rows[r].addEventListener("drop", function (e) {
                e.preventDefault(); this.classList.remove("sp-drag-over");
                var fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
                var toIdx = parseInt(this.dataset.entryIdx, 10);
                if (fromIdx !== toIdx && !isNaN(fromIdx) && !isNaN(toIdx)) {
                    collectEditsFromDom();
                    var item = _entries.splice(fromIdx, 1)[0];
                    _entries.splice(toIdx, 0, item);
                    pushHistory(); saveState(); rebuildContent();
                }
            });
        }
    }

    // -----------------------------------------------------------------------
    // Schedule Note Checkbox Handler
    // -----------------------------------------------------------------------
    function handleNoteCheckbox(e) {
        var cb = e.target;
        var pk = cb.dataset.noteProduct;
        var noteText = cb.dataset.noteText;
        if (!_notesByProduct[pk]) _notesByProduct[pk] = [];

        if (cb.checked) {
            // Add to end of checked list (if not already there)
            if (_notesByProduct[pk].indexOf(noteText) === -1) {
                _notesByProduct[pk].push(noteText);
            }
        } else {
            // Remove from checked list
            var idx = _notesByProduct[pk].indexOf(noteText);
            if (idx !== -1) {
                _notesByProduct[pk].splice(idx, 1);
            }
        }

        pushHistory();
        saveState();
        // Rebuild just the notes section display
        rebuildContent();
    }

    // -----------------------------------------------------------------------
    // Action Button Handler
    // -----------------------------------------------------------------------
    function handleActionButton(e) {
        var btn = e.currentTarget;
        var action = btn.dataset.action;
        var idx = parseInt(btn.dataset.entry, 10);

        collectEditsFromDom();

        if (action === "duplicate") {
            var copy = JSON.parse(JSON.stringify(_entries[idx]));
            _entries.splice(idx + 1, 0, copy);
        } else if (action === "delete") {
            _entries.splice(idx, 1);
            _selectedEntries.delete(idx);
        }

        pushHistory(); saveState(); rebuildContent();
    }

    // -----------------------------------------------------------------------
    // Bulk Operations
    // -----------------------------------------------------------------------
    function bulkDuplicate() {
        collectEditsFromDom();
        var sorted = Array.from(_selectedEntries).sort(function (a, b) { return b - a; });
        for (var i = 0; i < sorted.length; i++) {
            var copy = JSON.parse(JSON.stringify(_entries[sorted[i]]));
            _entries.splice(sorted[i] + 1, 0, copy);
        }
        _selectedEntries.clear();
        pushHistory(); saveState(); rebuildContent();
    }

    function bulkDelete() {
        collectEditsFromDom();
        var sorted = Array.from(_selectedEntries).sort(function (a, b) { return b - a; });
        for (var i = 0; i < sorted.length; i++) _entries.splice(sorted[i], 1);
        _selectedEntries.clear();
        pushHistory(); saveState(); rebuildContent();
    }

    // -----------------------------------------------------------------------
    // Auto Number Dialog
    // -----------------------------------------------------------------------
    function showAutoNumberDialog() {
        collectEditsFromDom();
        var groups = groupEntriesByProduct();

        var ov = document.createElement("div"); ov.className = "confirm-overlay";
        var d = document.createElement("div"); d.className = "confirm-dialog";
        var hd = document.createElement("div"); hd.className = "confirm-dialog-header"; var h3 = document.createElement("h3"); h3.textContent = "Auto-Number Tags"; hd.appendChild(h3);
        var bd = document.createElement("div"); bd.className = "confirm-dialog-body";

        var fields = {};

        function addSection(label, productKey, iduDefault, oduDefault) {
            if (!groups[productKey] || groups[productKey].length === 0) return;
            var title = document.createElement("div"); title.className = "sp-autonumber-section-title"; title.textContent = label; bd.appendChild(title);
            var iduLbl = document.createElement("label"); iduLbl.className = "input-dialog-label"; iduLbl.textContent = "Indoor Prefix";
            var iduInp = document.createElement("input"); iduInp.type = "text"; iduInp.className = "input-dialog-input"; iduInp.value = iduDefault;
            var oduLbl = document.createElement("label"); oduLbl.className = "input-dialog-label"; oduLbl.textContent = "Outdoor/Unit Prefix";
            var oduInp = document.createElement("input"); oduInp.type = "text"; oduInp.className = "input-dialog-input"; oduInp.value = oduDefault;
            var startLbl = document.createElement("label"); startLbl.className = "input-dialog-label"; startLbl.textContent = "Start Number";
            var startInp = document.createElement("input"); startInp.type = "number"; startInp.className = "input-dialog-input"; startInp.value = "1"; startInp.min = "0";
            bd.appendChild(iduLbl); bd.appendChild(iduInp); bd.appendChild(oduLbl); bd.appendChild(oduInp); bd.appendChild(startLbl); bd.appendChild(startInp);
            fields[productKey] = { idu: iduInp, odu: oduInp, start: startInp };
        }

        addSection("Mini Splits", "mini-splits", "IDU-", "ODU-");
        addSection("Multi Position Splits", "multi-position", "AHU-", "CU-");
        addSection("Light Commercial RTUs", "gas-packs", "", "RTU-");

        var ft = document.createElement("div"); ft.className = "confirm-dialog-footer";
        var cb = document.createElement("button"); cb.type = "button"; cb.className = "confirm-btn confirm-btn-cancel"; cb.textContent = "Cancel";
        cb.addEventListener("click", function () { document.body.removeChild(ov); });
        var cfb = document.createElement("button"); cfb.type = "button"; cfb.className = "confirm-btn confirm-btn-primary"; cfb.textContent = "Apply";
        cfb.addEventListener("click", function () {
            document.body.removeChild(ov);
            for (var pk in fields) {
                var f = fields[pk];
                var start = parseInt(f.start.value, 10) || 1;
                if (pk === "gas-packs") {
                    applyAutoNumberGp(groups[pk], f.odu.value, start);
                } else {
                    applyAutoNumber(groups[pk], f.idu.value, f.odu.value, start);
                }
            }
            pushHistory(); saveState(); rebuildContent();
        });
        ft.appendChild(cb); ft.appendChild(cfb);
        d.appendChild(hd); d.appendChild(bd); d.appendChild(ft);
        ov.appendChild(d); document.body.appendChild(ov);
    }

    function applyAutoNumber(entryIndices, iduPrefix, oduPrefix, startNum) {
        var iduCount = startNum, oduCount = startNum;
        for (var i = 0; i < entryIndices.length; i++) {
            var ei = entryIndices[i];
            var sys = DataLoader.getSystemById(_entries[ei].systemId);
            if (!sys) continue;
            _entries[ei].oduTag = oduPrefix + String(oduCount).padStart(2, "0");
            oduCount++;
            var numIdu = (sys.indoorUnits) ? sys.indoorUnits.length : 0;
            for (var j = 0; j < numIdu; j++) {
                _entries[ei].iduTags[j] = iduPrefix + String(iduCount).padStart(2, "0");
                iduCount++;
            }
        }
    }

    function applyAutoNumberGp(entryIndices, unitPrefix, startNum) {
        var count = startNum;
        for (var i = 0; i < entryIndices.length; i++) {
            _entries[entryIndices[i]].oduTag = unitPrefix + String(count).padStart(2, "0");
            count++;
        }
    }

    // -----------------------------------------------------------------------
    // Download Bundle
    // -----------------------------------------------------------------------
    async function downloadBundle() {
        if (typeof JSZip === "undefined") { Project.showToast("JSZip not loaded", "toast-danger"); return; }
        collectEditsFromDom(); saveState();

        var zip = new JSZip();
        var fetched = 0;

        // Schedule exports
        var inclXlsx = document.getElementById("sp-doc-include-xlsx");
        var inclPdf = document.getElementById("sp-doc-include-pdf");

        if (inclXlsx && inclXlsx.checked) {
            try {
                var xlsxBlobs = await Export.exportScheduleXlsx({ returnBlobs: true });
                if (xlsxBlobs) { for (var x = 0; x < xlsxBlobs.length; x++) { zip.file(xlsxBlobs[x].name, xlsxBlobs[x].blob); fetched++; } }
            } catch (e) { console.warn("[Preview] XLSX export failed:", e); }
        }

        if (inclPdf && inclPdf.checked) {
            try {
                var pdfBlobs = await Export.exportSchedulePdf({ returnBlobs: true });
                if (pdfBlobs) { for (var p2 = 0; p2 < pdfBlobs.length; p2++) { zip.file(pdfBlobs[p2].name, pdfBlobs[p2].blob); fetched++; } }
            } catch (e) { console.warn("[Preview] PDF export failed:", e); }
        }

        // Document files
        var fileCbs = _overlay.querySelectorAll(".sp-doc-file-cb:checked");
        for (var fc = 0; fc < fileCbs.length; fc++) {
            var path = fileCbs[fc].dataset.docPath;
            try {
                var resp = await fetch(path);
                if (resp.ok) {
                    var blob = await resp.blob();
                    var zipPath = path.replace(/^ASSETS\/[^/]+\//, "");
                    zip.file(zipPath, blob);
                    fetched++;
                }
            } catch (e) { console.warn("[Preview] Fetch failed:", path); }
        }

        if (fetched === 0) { Project.showToast("No files to download", "toast-warning"); return; }

        try {
            var zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
            Project.downloadBlob(zipBlob, "HHpro_Project_Files.zip");
            Project.showToast(fetched + " file(s) downloaded", "toast-success");
        } catch (e) { Project.showToast("ZIP failed", "toast-danger"); }
    }

    // -----------------------------------------------------------------------
    // Edit Handling
    // -----------------------------------------------------------------------
    function handleEdit() {
        clearTimeout(_saveTimeout);
        _saveTimeout = setTimeout(function () { collectEditsFromDom(); pushHistory(); saveState(); }, 600);
    }

    function collectEditsFromDom() {
        if (!_isOpen || !_overlay || _overlay.innerHTML === "") return;
        var tagInputs = _overlay.querySelectorAll("[data-entry][data-field]");
        for (var i = 0; i < tagInputs.length; i++) {
            var el = tagInputs[i], idx = parseInt(el.dataset.entry, 10), field = el.dataset.field;
            if (idx < 0 || idx >= _entries.length) continue;
            if (field === "oduTag") _entries[idx].oduTag = el.value;
            else if (field === "iduTag") _entries[idx].iduTags[parseInt(el.dataset.idu, 10)] = el.value;
            else if (field === "iduAccessories") {
                if (!_entries[idx].iduAccessories) _entries[idx].iduAccessories = [];
                _entries[idx].iduAccessories[parseInt(el.dataset.idu, 10)] = el.value;
            } else if (field === "outdoorAccessories") _entries[idx].outdoorAccessories = el.value;
        }
    }

    function saveState() {
        Project._saveEntriesDirect(JSON.parse(JSON.stringify(_entries)));
        Project._saveProductNotesDirect(JSON.parse(JSON.stringify(_notesByProduct)));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    function fmt(val) {
        if (val === null || val === undefined || val === "") return '<span class="sp-empty">&mdash;</span>';
        if (typeof val === "number" && Number.isInteger(val) && val >= 1000) return esc(val.toLocaleString("en-US"));
        return esc(String(val));
    }

    function esc(str) {
        if (!str) return "";
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        init: init,
        open: open,
        close: close,
        getHiddenColumns: getHiddenColumns,
    };

})();
