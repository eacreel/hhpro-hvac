/* ==========================================================================
   preview.js — Schedule Preview overlay.
   Renders a formatted schedule matching the PDF/Excel output with
   editable tag, accessories, and notes fields. Changes auto-save
   back to the Project entries.

   Features:
     - Drag-to-reorder systems
     - Reorder indoor units within multi-zone groups
     - Duplicate / Delete systems
     - Auto-number tags
     - Multi-select with bulk operations
     - Undo / Redo
     - Column visibility toggles (affects preview + exports)
     - Multi-product support (mini-splits + multi-position)
   ========================================================================== */

const SchedulePreview = (function () {

    let _overlay = null;
    let _isOpen = false;
    let _saveTimeout = null;

    // Working copies (deep-cloned from Project on open)
    let _entries = [];
    let _notesByProduct = {};  // { "mini-splits": { indoor: [], outdoor: [] }, "multi-position": { indoor: [], outdoor: [] } }
    const MAX_NOTES = 10;

    // -----------------------------------------------------------------------
    // History (undo / redo)
    // -----------------------------------------------------------------------
    let _history = [];
    let _historyIndex = -1;
    const MAX_HISTORY = 50;

    function pushHistory() {
        _history = _history.slice(0, _historyIndex + 1);
        _history.push({
            entries: JSON.parse(JSON.stringify(_entries)),
            notesByProduct: JSON.parse(JSON.stringify(_notesByProduct))
        });
        if (_history.length > MAX_HISTORY) _history.shift();
        _historyIndex = _history.length - 1;
        updateUndoRedoButtons();
    }

    function undo() {
        if (_historyIndex <= 0) return;
        collectEditsFromDom();
        if (_historyIndex === _history.length - 1) {
            _history[_historyIndex] = {
                entries: JSON.parse(JSON.stringify(_entries)),
                notesByProduct: JSON.parse(JSON.stringify(_notesByProduct))
            };
        }
        _historyIndex--;
        restoreFromHistory();
    }

    function redo() {
        if (_historyIndex >= _history.length - 1) return;
        _historyIndex++;
        restoreFromHistory();
    }

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
    // Column Visibility
    // -----------------------------------------------------------------------
    let _hiddenColumns = new Set();
    let _colPanelOpen = false;

    // Mini Split column definitions
    const MS_COLUMN_GROUPS = [
        { id: "ms-heating", label: "Heat Pump Heating", cols: ["idu-heatingEdb","idu-heatingTotal","odu-heatingAmbient"] },
        { id: "ms-cooling-detail", label: "Cooling EDB/EWB", cols: ["idu-coolingEdb","idu-coolingEwb"] },
        { id: "ms-electrical", label: "Electrical (V/MCA/MOP)", cols: ["idu-voltage","idu-mca","idu-mop","odu-voltage","odu-mca","odu-mop"] },
    ];

    const MS_INDIVIDUAL_COLUMNS = [
        { key: "idu-coolingTotal", label: "Cooling Total Capacity" },
        { key: "idu-coolingSensible", label: "Sensible Capacity" },
        { key: "idu-weight", label: "Indoor Weight" },
        { key: "idu-type", label: "Indoor Unit Type" },
        { key: "idu-cfm", label: "CFM" },
        { key: "idu-manufacturer", label: "Manufacturer (Indoor)" },
        { key: "odu-coolingAmbient", label: "OA Ambient (Cooling)" },
        { key: "odu-heatingAmbient", label: "OA Ambient (Heating)" },
        { key: "odu-weight", label: "Outdoor Weight" },
        { key: "odu-seer", label: "SEER2/EER2/HSPF2" },
        { key: "odu-manufacturer", label: "Manufacturer (Outdoor)" },
        { key: "odu-refrigerant", label: "Refrigerant" },
        { key: "odu-lineSet", label: "Line-Set Lengths" },
    ];

    // Multi Position Split column definitions
    const MPS_COLUMN_GROUPS = [
        { id: "mps-fan", label: "Supply Fan (HP / Type)", cols: ["mps-idu-motorHp","mps-idu-motorType"] },
        { id: "mps-cooling-detail", label: "Cooling EAT/LAT", cols: ["mps-idu-eatDb","mps-idu-eatWb","mps-idu-latDb"] },
        { id: "mps-aux-heat", label: "Aux. Electric Heat", cols: ["mps-idu-auxKw","mps-idu-auxRise"] },
        { id: "mps-idu-elec", label: "Indoor Electrical (V/MCA/MOP)", cols: ["mps-idu-voltage","mps-idu-mca","mps-idu-mop"] },
        { id: "mps-odu-heat", label: "Heating Data", cols: ["mps-odu-heatAmb","mps-odu-heatTotal","mps-odu-heatEff"] },
        { id: "mps-odu-elec", label: "Outdoor Electrical (V/MCA/MOP)", cols: ["mps-odu-voltage","mps-odu-mca","mps-odu-mop"] },
    ];

    const MPS_INDIVIDUAL_COLUMNS = [
        { key: "mps-idu-airflow", label: "Airflow (CFM)" },
        { key: "mps-idu-coolTotal", label: "Cooling Total Capacity" },
        { key: "mps-idu-coolSensible", label: "Sensible Capacity" },
        { key: "mps-idu-hpTotal", label: "Heat Pump Total Capacity" },
        { key: "mps-idu-weight", label: "Indoor Weight" },
        { key: "mps-odu-coolAmb", label: "Outdoor Ambient (Cooling)" },
        { key: "mps-odu-refrig", label: "Refrigerant" },
        { key: "mps-odu-efficiency", label: "Efficiency" },
        { key: "mps-odu-weight", label: "Outdoor Weight" },
        { key: "mps-odu-compressor", label: "Compressor Stages" },
    ];

    // Combined lookups for legacy compatibility
    var COLUMN_GROUPS = MS_COLUMN_GROUPS;
    var INDIVIDUAL_COLUMNS = MS_INDIVIDUAL_COLUMNS;

    function isColVisible(key) { return !_hiddenColumns.has(key); }
    function getHiddenColumns() { return new Set(_hiddenColumns); }

    function toggleColumnGroup(groupId) {
        var allGroups = MS_COLUMN_GROUPS.concat(MPS_COLUMN_GROUPS);
        var grp = allGroups.find(function (g) { return g.id === groupId; });
        if (!grp) return;
        var cb = document.getElementById("sp-grp-" + groupId);
        var visible = cb && cb.checked;
        for (var i = 0; i < grp.cols.length; i++) {
            if (visible) _hiddenColumns.delete(grp.cols[i]);
            else _hiddenColumns.add(grp.cols[i]);
        }
        updateColPanel(); rebuildContent();
    }

    function toggleSingleColumn(key) {
        var cb = document.getElementById("sp-col-" + key);
        if (cb && cb.checked) _hiddenColumns.delete(key);
        else _hiddenColumns.add(key);
        updateColPanel(); rebuildContent();
    }

    function updateColPanel() {
        var allGroups = MS_COLUMN_GROUPS.concat(MPS_COLUMN_GROUPS);
        for (var gi = 0; gi < allGroups.length; gi++) {
            var grp = allGroups[gi];
            var allVisible = true;
            for (var ci = 0; ci < grp.cols.length; ci++) {
                if (_hiddenColumns.has(grp.cols[ci])) { allVisible = false; break; }
            }
            var gcb = document.getElementById("sp-grp-" + grp.id);
            if (gcb) gcb.checked = allVisible;
        }
        var allCols = MS_INDIVIDUAL_COLUMNS.concat(MPS_INDIVIDUAL_COLUMNS);
        for (var ii = 0; ii < allCols.length; ii++) {
            var ccb = document.getElementById("sp-col-" + allCols[ii].key);
            if (ccb) ccb.checked = !_hiddenColumns.has(allCols[ii].key);
        }
    }

    // -----------------------------------------------------------------------
    // Multi-Select
    // -----------------------------------------------------------------------
    let _selectedEntries = new Set();

    function toggleSelect(idx) {
        if (_selectedEntries.has(idx)) _selectedEntries.delete(idx);
        else _selectedEntries.add(idx);
        updateSelectionUI();
    }

    function toggleSelectAll() {
        var selAll = document.getElementById("sp-select-all");
        if (!selAll) return;
        if (selAll.checked) { for (var i = 0; i < _entries.length; i++) _selectedEntries.add(i); }
        else _selectedEntries.clear();
        updateSelectionUI();
    }

    function updateSelectionUI() {
        var cbs = _overlay.querySelectorAll(".sp-row-checkbox");
        for (var i = 0; i < cbs.length; i++) {
            cbs[i].checked = _selectedEntries.has(parseInt(cbs[i].dataset.entry, 10));
        }
        var bulkBar = document.getElementById("sp-bulk-bar");
        var bulkCount = document.getElementById("sp-bulk-count");
        if (_selectedEntries.size > 0) {
            bulkBar.classList.remove("hidden");
            bulkCount.textContent = _selectedEntries.size + " selected";
        } else {
            bulkBar.classList.add("hidden");
        }
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

        // Initialize per-product notes
        var existingProductNotes = Project.getProductNotes();
        var msNotes = existingProductNotes["mini-splits"];
        var mpsNotes = existingProductNotes["multi-position"];

        // Backward compat: if no per-product notes exist, use the legacy flat notes for mini-splits
        if (!msNotes) {
            msNotes = { indoor: Project.getIndoorNotes(), outdoor: Project.getOutdoorNotes() };
        }
        if (!mpsNotes) {
            mpsNotes = { indoor: [], outdoor: [] };
            while (mpsNotes.indoor.length < MAX_NOTES) mpsNotes.indoor.push("");
            while (mpsNotes.outdoor.length < MAX_NOTES) mpsNotes.outdoor.push("");
        }

        _notesByProduct = {
            "mini-splits": { indoor: msNotes.indoor.slice(), outdoor: msNotes.outdoor.slice() },
            "multi-position": { indoor: mpsNotes.indoor.slice(), outdoor: mpsNotes.outdoor.slice() }
        };

        // Ensure all note arrays are padded to MAX_NOTES
        var pks = Object.keys(_notesByProduct);
        for (var p = 0; p < pks.length; p++) {
            while (_notesByProduct[pks[p]].indoor.length < MAX_NOTES) _notesByProduct[pks[p]].indoor.push("");
            while (_notesByProduct[pks[p]].outdoor.length < MAX_NOTES) _notesByProduct[pks[p]].outdoor.push("");
        }

        _selectedEntries.clear();
        _history = [];
        _historyIndex = -1;
        pushHistory();

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
            var pk = (sys && sys.productKey === "multi-position") ? "multi-position" : "mini-splits";
            if (!groups[pk]) groups[pk] = [];
            groups[pk].push(i);
        }
        return groups;
    }

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
        html += '    <div class="sp-col-btn-wrap">';
        html += '      <button class="sp-tool-btn" id="sp-btn-columns" type="button" title="Show/hide columns">Columns</button>';
        html += '    </div>';
        html += '    <span class="sp-toolbar-sep"></span>';
        html += '    <button class="sp-dl-btn sp-dl-btn-email" id="sp-btn-email" type="button" title="Download CSV and open email client">';
        html += '      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>';
        html += '      Email Project';
        html += '    </button>';
        html += '    <span class="sp-toolbar-sep"></span>';
        html += '    <button class="sp-dl-btn" id="sp-btn-xlsx" type="button">Download Excel</button>';
        html += '    <button class="sp-dl-btn" id="sp-btn-pdf" type="button">Download PDF</button>';
        html += '    <button class="sp-dl-btn" id="sp-btn-dxf" type="button">Download DXF</button>';
        html += '  </div>';
        html += '</div>';

        // Column visibility panel — per schedule type
        var colGroups = groupEntriesByProduct();
        var colHasMs = colGroups["mini-splits"] && colGroups["mini-splits"].length > 0;
        var colHasMps = colGroups["multi-position"] && colGroups["multi-position"].length > 0;

        html += '<div id="sp-col-panel" class="sp-col-panel hidden">';
        html += '  <div class="sp-col-panel-header">Column Visibility</div>';

        if (colHasMs) {
            html += '  <div class="sp-col-panel-schedule-label">Mini Splits</div>';
            html += '  <div class="sp-col-panel-section"><div class="sp-col-panel-label">Group Toggles</div>';
            for (var msgi = 0; msgi < MS_COLUMN_GROUPS.length; msgi++) {
                var msgrp = MS_COLUMN_GROUPS[msgi];
                html += '<label class="sp-col-toggle"><input type="checkbox" id="sp-grp-' + msgrp.id + '" data-group="' + msgrp.id + '" checked> ' + msgrp.label + '</label>';
            }
            html += '  </div><div class="sp-col-panel-section"><div class="sp-col-panel-label">Individual Columns</div>';
            for (var msci = 0; msci < MS_INDIVIDUAL_COLUMNS.length; msci++) {
                var mscol = MS_INDIVIDUAL_COLUMNS[msci];
                html += '<label class="sp-col-toggle"><input type="checkbox" id="sp-col-' + mscol.key + '" data-colkey="' + mscol.key + '" checked> ' + mscol.label + '</label>';
            }
            html += '  </div>';
        }

        if (colHasMps) {
            html += '  <div class="sp-col-panel-schedule-label">Multi Position Splits</div>';
            html += '  <div class="sp-col-panel-section"><div class="sp-col-panel-label">Group Toggles</div>';
            for (var mpsgi = 0; mpsgi < MPS_COLUMN_GROUPS.length; mpsgi++) {
                var mpsgrp = MPS_COLUMN_GROUPS[mpsgi];
                html += '<label class="sp-col-toggle"><input type="checkbox" id="sp-grp-' + mpsgrp.id + '" data-group="' + mpsgrp.id + '" checked> ' + mpsgrp.label + '</label>';
            }
            html += '  </div><div class="sp-col-panel-section"><div class="sp-col-panel-label">Individual Columns</div>';
            for (var mpsci = 0; mpsci < MPS_INDIVIDUAL_COLUMNS.length; mpsci++) {
                var mpscol = MPS_INDIVIDUAL_COLUMNS[mpsci];
                html += '<label class="sp-col-toggle"><input type="checkbox" id="sp-col-' + mpscol.key + '" data-colkey="' + mpscol.key + '" checked> ' + mpscol.label + '</label>';
            }
            html += '  </div>';
        }

        html += '</div>';

        // Bulk bar
        html += '<div id="sp-bulk-bar" class="sp-bulk-bar hidden">';
        html += '  <span id="sp-bulk-count">0 selected</span>';
        html += '  <button class="sp-bulk-btn" id="sp-bulk-duplicate" type="button">Duplicate Selected</button>';
        html += '  <button class="sp-bulk-btn sp-bulk-btn-danger" id="sp-bulk-delete" type="button">Delete Selected</button>';
        html += '  <button class="sp-bulk-btn" id="sp-bulk-deselect" type="button">Deselect All</button>';
        html += '</div>';

        // Content
        html += '<div class="sp-content" id="sp-content">';
        html += buildContentHtml();
        html += '</div>';

        _overlay.innerHTML = html;
        wireEvents();
        updateColPanel();
    }

    function buildContentHtml() {
        var groups = groupEntriesByProduct();
        var html = '<div class="sp-schedules-grid">';

        // Mini Splits schedule
        if (groups["mini-splits"] && groups["mini-splits"].length > 0) {
            html += '<div class="sp-schedule-wrap">';
            html += '<div class="sp-schedule-title">SPLIT SYSTEM SCHEDULE</div>';
            html += '<div class="sp-section-label">INDOOR UNIT</div>';
            html += buildIndoorTable(groups["mini-splits"]);
            html += '<div class="sp-section-label">OUTDOOR UNIT</div>';
            html += buildOutdoorTable(groups["mini-splits"]);
            html += buildNotesSection("mini-splits");
            html += '</div>';
        }

        // Multi Position Splits schedule
        if (groups["multi-position"] && groups["multi-position"].length > 0) {
            html += '<div class="sp-schedule-wrap">';
            html += '<div class="sp-schedule-title">MULTI POSITION SPLIT SYSTEM SCHEDULE</div>';
            html += '<div class="sp-section-label">INDOOR AIR HANDLING UNIT</div>';
            html += buildMpsIndoorTable(groups["multi-position"]);
            html += '<div class="sp-section-label">OUTDOOR CONDENSING UNIT</div>';
            html += buildMpsOutdoorTable(groups["multi-position"]);
            html += buildNotesSection("multi-position");
            html += '</div>';
        }

        html += '</div>'; // close grid
        html += buildDocumentsSection();
        return html;
    }

    function rebuildContent() {
        var el = document.getElementById("sp-content");
        if (el) { el.innerHTML = buildContentHtml(); wireContentEvents(); updateSelectionUI(); }
    }

    // -----------------------------------------------------------------------
    // Indoor Table — Mini Splits
    // -----------------------------------------------------------------------
    function buildIndoorTable(indices) {
        var h = '<table class="sp-table sp-table-indoor"><thead>';
        var coolVis = countVisible(["idu-coolingEdb","idu-coolingEwb","idu-coolingTotal","idu-coolingSensible"]);
        var heatVis = countVisible(["idu-heatingEdb","idu-heatingTotal"]);
        var elecVis = countVisible(["idu-voltage","idu-mca","idu-mop"]);

        h += '<tr class="sp-hdr1">';
        h += '<th rowspan="2" class="sp-col-action"><input type="checkbox" id="sp-select-all" title="Select all"></th>';
        h += '<th rowspan="2" class="sp-col-sym">SYMBOL</th>';
        h += '<th rowspan="2" class="sp-col-odu-sym">SYMBOL<br>(OUTDOOR UNIT)</th>';
        if (isColVisible("idu-cfm")) h += '<th rowspan="2" class="sp-col-cfm">CFM</th>';
        if (coolVis > 0) h += '<th colspan="' + coolVis + '" class="sp-col-group">COOLING CAPACITY</th>';
        if (heatVis > 0) h += '<th colspan="' + heatVis + '" class="sp-col-group">HEAT PUMP HEATING CAPACITY</th>';
        if (isColVisible("idu-weight")) h += '<th rowspan="2" class="sp-col-wt">OPERATING<br>WEIGHT</th>';
        if (isColVisible("idu-type")) h += '<th rowspan="2" class="sp-col-type">INDOOR UNIT<br>TYPE</th>';
        if (elecVis > 0) h += '<th colspan="' + elecVis + '" class="sp-col-group">ELECTRICAL</th>';
        if (isColVisible("idu-manufacturer")) h += '<th rowspan="2" class="sp-col-mfg">MANUFACTURER<br>DAIKIN</th>';
        h += '<th rowspan="2" class="sp-col-acc">NOTES</th>';
        h += '</tr><tr class="sp-hdr2">';
        if (isColVisible("idu-coolingEdb")) h += '<th>EDB</th>';
        if (isColVisible("idu-coolingEwb")) h += '<th>EWB</th>';
        if (isColVisible("idu-coolingTotal")) h += '<th>TOTAL<br>CAPACITY</th>';
        if (isColVisible("idu-coolingSensible")) h += '<th>SENSIBLE<br>CAPACITY</th>';
        if (isColVisible("idu-heatingEdb")) h += '<th>EDB</th>';
        if (isColVisible("idu-heatingTotal")) h += '<th>TOTAL<br>CAPACITY</th>';
        if (isColVisible("idu-voltage")) h += '<th>Voltage</th>';
        if (isColVisible("idu-mca")) h += '<th>MCA</th>';
        if (isColVisible("idu-mop")) h += '<th>MOP</th>';
        h += '</tr></thead><tbody>';

        var entryIndices = indices || [];
        for (var ii = 0; ii < entryIndices.length; ii++) {
            var ei = entryIndices[ii];
            var entry = _entries[ei];
            var sys = DataLoader.getSystemById(entry.systemId);
            if (!sys) continue;
            var numIdu = sys.indoorUnits.length;

            for (var j = 0; j < numIdu; j++) {
                var idu = sys.indoorUnits[j];
                var iduTag = (j < entry.iduTags.length) ? entry.iduTags[j] : "IDU-";
                var iduAcc = (entry.iduAccessories && j < entry.iduAccessories.length) ? (entry.iduAccessories[j] || "") : "";

                h += '<tr data-entry-idx="' + ei + '" data-idu-idx="' + j + '"' + (j === 0 ? ' draggable="true"' : '') + '>';

                if (j === 0) {
                    h += buildActionCell(ei, numIdu, entry);
                }

                h += '<td class="sp-cell-edit"><input class="sp-input sp-input-tag" type="text" value="' + esc(iduTag) + '" data-entry="' + ei + '" data-field="iduTag" data-idu="' + j + '"></td>';
                h += '<td class="sp-cell-edit"><input class="sp-input sp-input-tag" type="text" value="' + esc(entry.oduTag) + '" data-entry="' + ei + '" data-field="oduTag"></td>';
                if (isColVisible("idu-cfm")) h += '<td>' + fmt(idu.cfm) + '</td>';
                if (isColVisible("idu-coolingEdb")) h += '<td>' + fmt(idu.coolingEdb) + '</td>';
                if (isColVisible("idu-coolingEwb")) h += '<td>' + fmt(idu.coolingEwb) + '</td>';
                if (isColVisible("idu-coolingTotal")) h += '<td>' + fmt(idu.coolingTotal) + '</td>';
                if (isColVisible("idu-coolingSensible")) h += '<td>' + fmt(idu.coolingSensible) + '</td>';
                if (isColVisible("idu-heatingEdb")) h += '<td>' + fmt(idu.heatingEdb) + '</td>';
                if (isColVisible("idu-heatingTotal")) h += '<td>' + fmt(idu.heatingTotal) + '</td>';
                if (isColVisible("idu-weight")) h += '<td>' + fmt(idu.weight) + '</td>';
                if (isColVisible("idu-type")) h += '<td class="sp-cell-text">' + esc(idu.type || "") + '</td>';

                if (idu.poweredFromOutdoor) {
                    if (elecVis > 0) h += '<td colspan="' + elecVis + '" class="sp-cell-powered">Indoor Powered From Outdoor Unit</td>';
                } else {
                    if (isColVisible("idu-voltage")) h += '<td>' + esc(idu.voltage || "") + '</td>';
                    if (isColVisible("idu-mca")) h += '<td>' + fmt(idu.mca) + '</td>';
                    if (isColVisible("idu-mop")) h += '<td>' + fmt(idu.mop) + '</td>';
                }
                if (isColVisible("idu-manufacturer")) h += '<td class="sp-cell-model">' + esc(idu.manufacturer || "") + '</td>';
                h += '<td class="sp-cell-edit"><input class="sp-input sp-input-acc" type="text" value="' + esc(iduAcc) + '" data-entry="' + ei + '" data-field="iduAccessories" data-idu="' + j + '"></td>';
                h += '</tr>';
            }
        }
        h += '</tbody></table>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Indoor Table — Multi Position Splits
    // -----------------------------------------------------------------------
    function buildMpsIndoorTable(indices) {
        var v = isColVisible;
        var fanVis = countVisible(["mps-idu-airflow","mps-idu-motorHp","mps-idu-motorType"]);
        var coolVis = countVisible(["mps-idu-eatDb","mps-idu-eatWb","mps-idu-latDb","mps-idu-coolTotal","mps-idu-coolSensible"]);
        var auxVis = countVisible(["mps-idu-auxKw","mps-idu-auxRise"]);
        var elecVis = countVisible(["mps-idu-voltage","mps-idu-mca","mps-idu-mop"]);

        var h = '<table class="sp-table sp-table-indoor"><thead>';
        h += '<tr class="sp-hdr1">';
        h += '<th rowspan="2" class="sp-col-action"><input type="checkbox" id="sp-select-all-mps" title="Select all"></th>';
        h += '<th rowspan="2">TAG</th>';
        h += '<th rowspan="2">MODEL<br>(DAIKIN)</th>';
        if (fanVis > 0) h += '<th colspan="' + fanVis + '" class="sp-col-group">SUPPLY FAN</th>';
        if (coolVis > 0) h += '<th colspan="' + coolVis + '" class="sp-col-group">COOLING</th>';
        if (v("mps-idu-hpTotal")) h += '<th rowspan="2">HEAT PUMP<br>TOTAL<br>CAPACITY</th>';
        if (auxVis > 0) h += '<th colspan="' + auxVis + '" class="sp-col-group">AUX. ELECTRIC HEAT</th>';
        if (elecVis > 0) h += '<th colspan="' + elecVis + '" class="sp-col-group">ELECTRICAL DATA</th>';
        if (v("mps-idu-weight")) h += '<th rowspan="2">WEIGHT</th>';
        h += '<th rowspan="2" class="sp-col-acc">NOTES</th>';
        h += '</tr><tr class="sp-hdr2">';
        if (v("mps-idu-airflow")) h += '<th>AIRFLOW<br>(CFM)</th>';
        if (v("mps-idu-motorHp")) h += '<th>MOTOR<br>(HP)</th>';
        if (v("mps-idu-motorType")) h += '<th>MOTOR<br>TYPE</th>';
        if (v("mps-idu-eatDb")) h += '<th>EAT<br>(DB)</th>';
        if (v("mps-idu-eatWb")) h += '<th>EAT<br>(WB)</th>';
        if (v("mps-idu-latDb")) h += '<th>LAT<br>(DB)</th>';
        if (v("mps-idu-coolTotal")) h += '<th>TOTAL<br>CAPACITY</th>';
        if (v("mps-idu-coolSensible")) h += '<th>SENSIBLE<br>CAPACITY</th>';
        if (v("mps-idu-auxKw")) h += '<th>kW</th>';
        if (v("mps-idu-auxRise")) h += '<th>TEMP<br>RISE (DB)</th>';
        if (v("mps-idu-voltage")) h += '<th>VOLTAGE<br>/ PHASE</th>';
        if (v("mps-idu-mca")) h += '<th>MCA</th>';
        if (v("mps-idu-mop")) h += '<th>MOP</th>';
        h += '</tr></thead><tbody>';

        var entryIndices = indices || [];
        for (var ii = 0; ii < entryIndices.length; ii++) {
            var ei = entryIndices[ii];
            var entry = _entries[ei];
            var sys = DataLoader.getSystemById(entry.systemId);
            if (!sys) continue;
            var idu = sys.indoorUnits[0];
            var iduTag = (entry.iduTags.length > 0) ? entry.iduTags[0] : "AHU-";
            var iduAcc = (entry.iduAccessories && entry.iduAccessories.length > 0) ? (entry.iduAccessories[0] || "") : "";

            h += '<tr data-entry-idx="' + ei + '" data-idu-idx="0" draggable="true">';
            h += buildActionCell(ei, 1, entry);
            h += '<td class="sp-cell-edit"><input class="sp-input sp-input-tag" type="text" value="' + esc(iduTag) + '" data-entry="' + ei + '" data-field="iduTag" data-idu="0"></td>';
            h += '<td class="sp-cell-model">' + esc(idu.model || "") + '</td>';
            if (v("mps-idu-airflow")) h += '<td>' + fmt(idu.airflow) + '</td>';
            if (v("mps-idu-motorHp")) h += '<td>' + fmt(idu.motorHp) + '</td>';
            if (v("mps-idu-motorType")) h += '<td class="sp-cell-text">' + esc(idu.motorType || "") + '</td>';
            if (v("mps-idu-eatDb")) h += '<td>' + fmt(idu.coolingEatDb) + '</td>';
            if (v("mps-idu-eatWb")) h += '<td>' + fmt(idu.coolingEatWb) + '</td>';
            if (v("mps-idu-latDb")) h += '<td>' + fmt(idu.coolingLatDb) + '</td>';
            if (v("mps-idu-coolTotal")) h += '<td>' + fmt(idu.coolingTotal) + '</td>';
            if (v("mps-idu-coolSensible")) h += '<td>' + fmt(idu.coolingSensible) + '</td>';
            if (v("mps-idu-hpTotal")) h += '<td>' + fmt(idu.heatPumpTotalCapacity) + '</td>';
            if (v("mps-idu-auxKw")) h += '<td>' + esc(idu.auxHeatKw || "") + '</td>';
            if (v("mps-idu-auxRise")) h += '<td>' + esc(idu.auxHeatTempRise || "") + '</td>';
            if (v("mps-idu-voltage")) h += '<td>' + esc(idu.voltage || "") + '</td>';
            if (v("mps-idu-mca")) h += '<td>' + fmt(idu.mca) + '</td>';
            if (v("mps-idu-mop")) h += '<td>' + fmt(idu.mop) + '</td>';
            if (v("mps-idu-weight")) h += '<td>' + fmt(idu.weight) + '</td>';
            h += '<td class="sp-cell-edit"><input class="sp-input sp-input-acc" type="text" value="' + esc(iduAcc) + '" data-entry="' + ei + '" data-field="iduAccessories" data-idu="0"></td>';
            h += '</tr>';
        }
        h += '</tbody></table>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Action Cell Builder (shared)
    // -----------------------------------------------------------------------
    function buildActionCell(ei, numIdu, entry) {
        var h = '<td class="sp-cell-action"' + (numIdu > 1 ? ' rowspan="' + numIdu + '"' : '') + '>';
        h += '<div class="sp-action-wrap">';
        h += '<div class="sp-action-top">';
        h += '<input type="checkbox" class="sp-row-checkbox" data-entry="' + ei + '">';
        h += '<span class="sp-entry-num">System #' + (ei + 1) + '</span>';
        h += '<span class="sp-drag-handle" title="Drag to reorder">&#9776;</span>';
        h += '</div>';
        h += '<div class="sp-action-move">';
        if (ei > 0) h += '<button class="sp-act-btn sp-act-move" data-action="move-up" data-entry="' + ei + '" title="Move system up">&#9650; Up</button>';
        if (ei < _entries.length - 1) h += '<button class="sp-act-btn sp-act-move" data-action="move-down" data-entry="' + ei + '" title="Move system down">&#9660; Down</button>';
        h += '</div>';
        h += '<div class="sp-action-ops">';
        h += '<button class="sp-act-btn sp-act-dup" data-action="duplicate" data-entry="' + ei + '" title="Duplicate this system">Dup</button>';
        h += '<button class="sp-act-btn sp-act-del" data-action="delete" data-entry="' + ei + '" title="Delete this system">Del</button>';
        h += '</div>';

        // IDU reorder (multi-zone only, mini-splits)
        if (numIdu > 1) {
            h += '<div class="sp-idu-reorder">';
            h += '<div class="sp-idu-reorder-title">Reorder Indoor Units</div>';
            for (var ri = 0; ri < numIdu; ri++) {
                var riTag = (ri < entry.iduTags.length && entry.iduTags[ri]) ? entry.iduTags[ri] : "IDU-";
                h += '<div class="sp-idu-reorder-row">';
                h += '<span class="sp-idu-reorder-label" title="' + esc(riTag) + '">' + esc(riTag) + '</span>';
                if (ri > 0) h += '<button class="sp-idu-btn" data-action="idu-up" data-entry="' + ei + '" data-idu="' + ri + '" title="Move up">&#9650;</button>';
                else h += '<span class="sp-idu-btn-spacer"></span>';
                if (ri < numIdu - 1) h += '<button class="sp-idu-btn" data-action="idu-down" data-entry="' + ei + '" data-idu="' + ri + '" title="Move down">&#9660;</button>';
                else h += '<span class="sp-idu-btn-spacer"></span>';
                h += '</div>';
            }
            h += '</div>';
        }

        h += '</div></td>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Outdoor Table — Mini Splits
    // -----------------------------------------------------------------------
    function buildOutdoorTable(indices) {
        var h = '<table class="sp-table sp-table-outdoor">';
        var elecVis = countVisible(["odu-voltage","odu-mca","odu-mop"]);

        h += '<thead><tr class="sp-hdr1">';
        h += '<th rowspan="2" class="sp-col-action"><!-- --></th>';
        h += '<th rowspan="2" class="sp-col-sym">SYMBOL</th>';
        if (isColVisible("odu-coolingAmbient")) h += '<th rowspan="2">OA AMBIENT<br>(COOLING)</th>';
        if (isColVisible("odu-heatingAmbient")) h += '<th rowspan="2">OA AMBIENT<br>(HEATING)</th>';
        if (isColVisible("odu-weight")) h += '<th rowspan="2" class="sp-col-wt">OPERATING<br>WEIGHT</th>';
        if (isColVisible("odu-seer")) h += '<th rowspan="2">SEER2/EER2/<br>HSPF2</th>';
        if (elecVis > 0) h += '<th colspan="' + elecVis + '" class="sp-col-group">ELECTRICAL</th>';
        if (isColVisible("odu-manufacturer")) h += '<th rowspan="2" class="sp-col-mfg">MANUFACTURER<br>DAIKIN</th>';
        if (isColVisible("odu-refrigerant")) h += '<th rowspan="2">REFRIGERANT</th>';
        if (isColVisible("odu-lineSet")) h += '<th rowspan="2">MAX ALLOWABLE<br>LINE-SET LENGTHS</th>';
        h += '<th rowspan="2" class="sp-col-acc">NOTES</th>';
        h += '</tr><tr class="sp-hdr2">';
        if (isColVisible("odu-voltage")) h += '<th>Voltage</th>';
        if (isColVisible("odu-mca")) h += '<th>MCA</th>';
        if (isColVisible("odu-mop")) h += '<th>MOP</th>';
        h += '</tr></thead><tbody>';

        var entryIndices = indices || [];
        for (var ii = 0; ii < entryIndices.length; ii++) {
            var ei = entryIndices[ii];
            var entry = _entries[ei];
            var sys = DataLoader.getSystemById(entry.systemId);
            if (!sys) continue;
            var odu = sys.outdoorUnit;

            h += '<tr data-entry-idx="' + ei + '">';
            h += '<td class="sp-cell-action"><span class="sp-entry-num">#' + (ei + 1) + '</span></td>';
            h += '<td class="sp-cell-edit"><input class="sp-input sp-input-tag" type="text" value="' + esc(entry.oduTag) + '" data-entry="' + ei + '" data-field="oduTag"></td>';
            if (isColVisible("odu-coolingAmbient")) h += '<td>' + fmt(odu.coolingAmbient) + '</td>';
            if (isColVisible("odu-heatingAmbient")) h += '<td>' + fmt(odu.heatingAmbient) + '</td>';
            if (isColVisible("odu-weight")) h += '<td>' + fmt(odu.weight) + '</td>';
            if (isColVisible("odu-seer")) h += '<td class="sp-cell-text">' + esc(odu.seer || "") + '</td>';
            if (isColVisible("odu-voltage")) h += '<td class="sp-cell-text">' + esc(odu.voltage || "") + '</td>';
            if (isColVisible("odu-mca")) h += '<td>' + fmt(odu.mca) + '</td>';
            if (isColVisible("odu-mop")) h += '<td>' + fmt(odu.mop) + '</td>';
            if (isColVisible("odu-manufacturer")) h += '<td class="sp-cell-model">' + esc(odu.manufacturer || "") + '</td>';
            if (isColVisible("odu-refrigerant")) h += '<td>' + esc(odu.refrigerant || "") + '</td>';
            if (isColVisible("odu-lineSet")) h += '<td class="sp-cell-text">' + esc(odu.lineSet || "") + '</td>';
            h += '<td class="sp-cell-edit"><input class="sp-input sp-input-acc" type="text" value="' + esc(entry.outdoorAccessories || "") + '" data-entry="' + ei + '" data-field="outdoorAccessories"></td>';
            h += '</tr>';
        }
        h += '</tbody></table>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Outdoor Table — Multi Position Splits
    // -----------------------------------------------------------------------
    function buildMpsOutdoorTable(indices) {
        var v = isColVisible;
        var heatVis = countVisible(["mps-odu-heatAmb","mps-odu-heatTotal","mps-odu-heatEff"]);
        var elecVis = countVisible(["mps-odu-voltage","mps-odu-mca","mps-odu-mop"]);

        var h = '<table class="sp-table sp-table-outdoor"><thead>';
        h += '<tr class="sp-hdr1">';
        h += '<th rowspan="2" class="sp-col-action"><!-- --></th>';
        h += '<th rowspan="2">TAG</th>';
        h += '<th rowspan="2">MODEL<br>(DAIKIN)</th>';
        if (heatVis > 0) h += '<th colspan="' + heatVis + '" class="sp-col-group">HEAT PUMP HEATING DATA</th>';
        if (elecVis > 0) h += '<th colspan="' + elecVis + '" class="sp-col-group">ELECTRICAL DATA</th>';
        if (v("mps-odu-coolAmb")) h += '<th rowspan="2">OUTDOOR<br>AMBIENT<br>(COOLING)</th>';
        if (v("mps-odu-refrig")) h += '<th rowspan="2">REFRIGERANT</th>';
        if (v("mps-odu-efficiency")) h += '<th rowspan="2">EFFICIENCY</th>';
        if (v("mps-odu-weight")) h += '<th rowspan="2">WEIGHT</th>';
        if (v("mps-odu-compressor")) h += '<th rowspan="2">COMPRESSOR<br>STAGES</th>';
        h += '<th rowspan="2" class="sp-col-acc">NOTES</th>';
        h += '</tr><tr class="sp-hdr2">';
        if (v("mps-odu-heatAmb")) h += '<th>OUTDOOR<br>AMBIENT (DB)</th>';
        if (v("mps-odu-heatTotal")) h += '<th>TOTAL<br>CAPACITY</th>';
        if (v("mps-odu-heatEff")) h += '<th>EFFICIENCY</th>';
        if (v("mps-odu-voltage")) h += '<th>VOLTAGE<br>/ PHASE</th>';
        if (v("mps-odu-mca")) h += '<th>MCA</th>';
        if (v("mps-odu-mop")) h += '<th>MOP</th>';
        h += '</tr></thead><tbody>';

        var entryIndices = indices || [];
        for (var ii = 0; ii < entryIndices.length; ii++) {
            var ei = entryIndices[ii];
            var entry = _entries[ei];
            var sys = DataLoader.getSystemById(entry.systemId);
            if (!sys) continue;
            var odu = sys.outdoorUnit;

            h += '<tr data-entry-idx="' + ei + '">';
            h += '<td class="sp-cell-action"><span class="sp-entry-num">#' + (ei + 1) + '</span></td>';
            h += '<td class="sp-cell-edit"><input class="sp-input sp-input-tag" type="text" value="' + esc(entry.oduTag) + '" data-entry="' + ei + '" data-field="oduTag"></td>';
            h += '<td class="sp-cell-model">' + esc(odu.model || "") + '</td>';
            if (v("mps-odu-heatAmb")) h += '<td>' + fmt(odu.heatingAmbient) + '</td>';
            if (v("mps-odu-heatTotal")) h += '<td>' + fmt(odu.heatingTotal) + '</td>';
            if (v("mps-odu-heatEff")) h += '<td class="sp-cell-text">' + esc(odu.heatingEfficiency || "") + '</td>';
            if (v("mps-odu-voltage")) h += '<td>' + esc(odu.voltage || "") + '</td>';
            if (v("mps-odu-mca")) h += '<td>' + fmt(odu.mca) + '</td>';
            if (v("mps-odu-mop")) h += '<td>' + fmt(odu.mop) + '</td>';
            if (v("mps-odu-coolAmb")) h += '<td>' + fmt(odu.coolingAmbient) + '</td>';
            if (v("mps-odu-refrig")) h += '<td>' + esc(odu.refrigerant || "") + '</td>';
            if (v("mps-odu-efficiency")) h += '<td class="sp-cell-text">' + esc(odu.efficiency || "") + '</td>';
            if (v("mps-odu-weight")) h += '<td>' + fmt(odu.weight) + '</td>';
            if (v("mps-odu-compressor")) h += '<td>' + esc(odu.compressorStages || "") + '</td>';
            h += '<td class="sp-cell-edit"><input class="sp-input sp-input-acc" type="text" value="' + esc(entry.outdoorAccessories || "") + '" data-entry="' + ei + '" data-field="outdoorAccessories"></td>';
            h += '</tr>';
        }
        h += '</tbody></table>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Notes Section
    // -----------------------------------------------------------------------
    function buildNotesSection(productKey) {
        var notes = _notesByProduct[productKey] || { indoor: [], outdoor: [] };
        var indoorNotes = notes.indoor || [];
        var outdoorNotes = notes.outdoor || [];

        var h = '<div class="sp-notes"><div class="sp-notes-col"><div class="sp-notes-heading">NOTES (INDOOR UNIT):</div>';
        for (var i = 0; i < MAX_NOTES; i++) {
            h += '<div class="sp-notes-line"><span class="sp-notes-num">' + (i + 1) + '-</span>';
            h += '<input class="sp-input sp-input-note" type="text" value="' + esc(indoorNotes[i] || "") + '" data-note-type="indoor" data-note-product="' + productKey + '" data-note-index="' + i + '"></div>';
        }
        h += '</div><div class="sp-notes-col"><div class="sp-notes-heading">NOTES (OUTDOOR UNIT):</div>';
        for (var j = 0; j < MAX_NOTES; j++) {
            h += '<div class="sp-notes-line"><span class="sp-notes-num">' + (j + 1) + '-</span>';
            h += '<input class="sp-input sp-input-note" type="text" value="' + esc(outdoorNotes[j] || "") + '" data-note-type="outdoor" data-note-product="' + productKey + '" data-note-index="' + j + '"></div>';
        }
        h += '</div></div>';
        return h;
    }

    // -----------------------------------------------------------------------
    // Documents Section
    // -----------------------------------------------------------------------
    function getEntryDocStructure(entry) {
        var sys = DataLoader.getSystemById(entry.systemId);
        if (!sys || !sys.docs) return { oduTag: entry.oduTag, units: [] };
        var d = sys.docs;
        var result = { oduTag: entry.oduTag, units: [] };

        if (sys.productKey === "multi-position") {
            // MPS: flat doc structure — group into outdoor and indoor
            var oduDocs = [];
            if (d.submittalSystem) oduDocs.push({ label: "Submittal (System)", path: d.submittalSystem, folder: "Submittals" });
            if (d.submittalOutdoor) oduDocs.push({ label: "Submittal (Outdoor)", path: d.submittalOutdoor, folder: "Submittals" });
            if (d.engineeringManualSystem) oduDocs.push({ label: "Engineering Manual (System)", path: d.engineeringManualSystem, folder: "Engineering" });
            if (d.engineeringManualOutdoor) oduDocs.push({ label: "Engineering Manual (Outdoor)", path: d.engineeringManualOutdoor, folder: "Engineering" });
            if (d.capacityTable) oduDocs.push({ label: "Capacity Table", path: d.capacityTable, folder: "Engineering" });
            if (d.installManualOutdoor) oduDocs.push({ label: "Installation Manual (Outdoor)", path: d.installManualOutdoor, folder: "Installation Manuals" });
            if (d.revitOutdoor) oduDocs.push({ label: "Revit (Outdoor)", path: d.revitOutdoor, folder: "Revit" });
            if (d.cadOutdoor) oduDocs.push({ label: "CAD (Outdoor)", path: d.cadOutdoor, folder: "CAD" });
            if (oduDocs.length > 0) result.units.push({ tag: entry.oduTag, label: entry.oduTag + " — Outdoor Unit", docs: oduDocs });

            var iduDocs = [];
            if (d.submittalIndoor) iduDocs.push({ label: "Submittal (Indoor)", path: d.submittalIndoor, folder: "Submittals" });
            if (d.engineeringManualIndoor) iduDocs.push({ label: "Engineering Manual (Indoor)", path: d.engineeringManualIndoor, folder: "Engineering" });
            if (d.installManualIndoor) iduDocs.push({ label: "Installation Manual (Indoor)", path: d.installManualIndoor, folder: "Installation Manuals" });
            if (d.revitIndoor) iduDocs.push({ label: "Revit (Indoor)", path: d.revitIndoor, folder: "Revit" });
            if (d.cadIndoor) iduDocs.push({ label: "CAD (Indoor)", path: d.cadIndoor, folder: "CAD" });
            var iduTag = (entry.iduTags.length > 0) ? entry.iduTags[0] : "AHU-";
            if (iduDocs.length > 0) result.units.push({ tag: iduTag, label: iduTag + " — Indoor Unit", docs: iduDocs });
        } else {
            // Mini Splits: nested doc structure
            var oduDocs2 = [];
            if (d.submittalSystem) oduDocs2.push({ label: "Submittal (System)", path: d.submittalSystem, folder: "Submittals" });
            if (d.submittalOutdoor) oduDocs2.push({ label: "Submittal (Outdoor)", path: d.submittalOutdoor, folder: "Submittals" });
            if (d.engineeringManual) oduDocs2.push({ label: "Engineering Manual", path: d.engineeringManual, folder: "Engineering" });
            if (d.capacityTable) oduDocs2.push({ label: "Capacity Table", path: d.capacityTable, folder: "Engineering" });
            if (d.installManualOutdoor) oduDocs2.push({ label: "Installation Manual", path: d.installManualOutdoor, folder: "Installation Manuals" });
            if (d.revitOutdoor) oduDocs2.push({ label: "Revit", path: d.revitOutdoor, folder: "Revit" });
            if (d.cadOutdoor) oduDocs2.push({ label: "CAD", path: d.cadOutdoor, folder: "CAD" });
            if (oduDocs2.length > 0) result.units.push({ tag: entry.oduTag, label: entry.oduTag + " — Outdoor Unit", docs: oduDocs2 });

            for (var i = 0; i < sys.indoorUnits.length; i++) {
                var iduDocs2 = [];
                if (d.indoorDocs && d.indoorDocs[i]) {
                    var id = d.indoorDocs[i];
                    if (id.submittalIndoor) iduDocs2.push({ label: "Submittal (Indoor)", path: id.submittalIndoor, folder: "Submittals" });
                    if (id.installManualIndoor) iduDocs2.push({ label: "Installation Manual", path: id.installManualIndoor, folder: "Installation Manuals" });
                    if (id.operationManual) iduDocs2.push({ label: "Operation Manual", path: id.operationManual, folder: "Operation Manuals" });
                    if (id.revitIndoor) iduDocs2.push({ label: "Revit", path: id.revitIndoor, folder: "Revit" });
                    if (id.cadIndoor) iduDocs2.push({ label: "CAD", path: id.cadIndoor, folder: "CAD" });
                }
                var iduTag2 = (i < entry.iduTags.length) ? entry.iduTags[i] : "IDU-";
                if (iduDocs2.length > 0) result.units.push({ tag: iduTag2, label: iduTag2 + " — Indoor Unit", docs: iduDocs2 });
            }
        }

        return result;
    }

    function buildDocumentsSection() {
        var h = '<div class="sp-docs-section">';

        h += '<div class="sp-docs-header">';
        h += '<div class="sp-docs-header-left"><span class="sp-docs-title">Project Files</span></div>';
        h += '<button class="sp-docs-download-btn" id="sp-btn-download-bundle" type="button">';
        h += '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
        h += ' Download Selected Files</button>';
        h += '</div>';

        h += '<div class="sp-docs-options">';
        h += '<label class="sp-docs-option"><input type="checkbox" id="sp-doc-include-xlsx" checked> Include Excel Schedule</label>';
        h += '<label class="sp-docs-option"><input type="checkbox" id="sp-doc-include-pdf" checked> Include PDF Schedule</label>';
        h += '<label class="sp-docs-option"><input type="checkbox" id="sp-doc-include-dxf" checked> Include DXF Schedule</label>';
        h += '<label class="sp-docs-option"><input type="checkbox" id="sp-doc-include-submittal-pkg" checked> Include Submittal Package</label>';
        h += '<label class="sp-docs-option sp-docs-select-all-wrap"><input type="checkbox" id="sp-doc-select-all" checked> Select / Deselect All Documents</label>';
        h += '</div>';

        // Collect unique doc type labels across all entries
        var docTypesMap = {};
        var docTypesOrder = [];
        for (var ei2 = 0; ei2 < _entries.length; ei2++) {
            var structure2 = getEntryDocStructure(_entries[ei2]);
            for (var u2 = 0; u2 < structure2.units.length; u2++) {
                for (var d2 = 0; d2 < structure2.units[u2].docs.length; d2++) {
                    var typeKey = getDocTypeKey(structure2.units[u2].docs[d2].label);
                    if (!docTypesMap[typeKey]) {
                        docTypesMap[typeKey] = true;
                        docTypesOrder.push(typeKey);
                    }
                }
            }
        }

        h += '<div class="sp-docs-body">';

        // Document type filter pane (left)
        h += '<div class="sp-docs-type-filter">';
        h += '<div class="sp-docs-type-filter-header">Document Types</div>';
        h += '<div class="sp-docs-type-filter-list">';
        for (var dt = 0; dt < docTypesOrder.length; dt++) {
            var dtKey = docTypesOrder[dt];
            h += '<label class="sp-docs-type-option">';
            h += '<input type="checkbox" class="sp-doc-type-cb" data-doc-type-key="' + esc(dtKey) + '" checked>';
            h += ' ' + esc(dtKey);
            h += '</label>';
        }
        h += '</div></div>';

        // System file tree (right)
        h += '<div class="sp-docs-list">';
        for (var ei = 0; ei < _entries.length; ei++) {
            var entry = _entries[ei];
            var structure = getEntryDocStructure(entry);
            var totalDocs = 0;
            for (var u = 0; u < structure.units.length; u++) totalDocs += structure.units[u].docs.length;
            if (totalDocs === 0) continue;

            var sys = DataLoader.getSystemById(entry.systemId);
            var iduTagList = [];
            if (sys) { for (var ti = 0; ti < sys.indoorUnits.length; ti++) iduTagList.push((ti < entry.iduTags.length ? entry.iduTags[ti] : "IDU-")); }

            h += '<div class="sp-doc-card" data-doc-entry="' + ei + '">';
            h += '<div class="sp-doc-card-header" data-doc-toggle="' + ei + '">';
            h += '<input type="checkbox" class="sp-doc-card-checkbox" data-doc-system="' + ei + '" checked>';
            h += '<span class="sp-doc-card-toggle">&#9660;</span>';
            h += '<span class="sp-doc-card-title">' + esc(entry.oduTag) + ' System';
            if (iduTagList.length > 0) h += ' (' + esc(iduTagList.join(", ")) + ')';
            h += '</span>';
            h += '<span class="sp-doc-card-count">' + totalDocs + ' file' + (totalDocs !== 1 ? 's' : '') + '</span>';
            h += '</div>';

            h += '<div class="sp-doc-card-body" id="sp-doc-body-' + ei + '">';
            for (var ui = 0; ui < structure.units.length; ui++) {
                var unit = structure.units[ui];
                h += '<div class="sp-doc-unit">';
                h += '<div class="sp-doc-unit-header">';
                h += '<input type="checkbox" data-doc-unit="' + ei + '-' + ui + '" checked>';
                h += ' ' + esc(unit.label);
                h += '</div>';

                for (var di = 0; di < unit.docs.length; di++) {
                    var doc = unit.docs[di];
                    var ext = doc.path.split('.').pop().toUpperCase();
                    var docTypeKey = getDocTypeKey(doc.label);
                    h += '<div class="sp-doc-row">';
                    h += '<input type="checkbox" class="sp-doc-file-cb" data-doc-path="' + esc(doc.path) + '" data-doc-entry="' + ei + '" data-doc-unit="' + ei + '-' + ui + '" data-doc-folder="' + esc(entry.oduTag + " System/" + unit.tag + "/" + doc.folder) + '" data-doc-type-key="' + esc(docTypeKey) + '" checked>';
                    h += '<span class="sp-doc-row-label">' + esc(doc.label) + '</span>';
                    h += '<span class="sp-doc-row-type">' + ext + '</span>';
                    h += '</div>';
                }
                h += '</div>';
            }
            h += '</div></div>';
        }
        h += '</div>';

        h += '</div>'; // sp-docs-body
        h += '</div>';
        return h;
    }

    /** Map a doc label to a type key for the filter pane */
    function getDocTypeKey(label) {
        if (/^Submittal/i.test(label)) return "Submittals";
        if (/^Engineering Manual/i.test(label)) return "Engineering Manuals";
        if (/^Capacity Table/i.test(label)) return "Capacity Tables";
        if (/^Installation Manual/i.test(label)) return "Installation Manuals";
        if (/^Operation Manual/i.test(label)) return "Operation Manuals";
        if (/^Revit/i.test(label)) return "Revit";
        if (/^CAD/i.test(label)) return "CAD";
        return label;
    }

    // -----------------------------------------------------------------------
    // Document Section Events
    // -----------------------------------------------------------------------
    function wireDocumentEvents() {
        var dlBtn = document.getElementById("sp-btn-download-bundle");
        if (dlBtn) dlBtn.addEventListener("click", downloadBundle);

        var selAll = document.getElementById("sp-doc-select-all");
        if (selAll) selAll.addEventListener("change", function () {
            var checked = this.checked;
            var allCbs = _overlay.querySelectorAll(".sp-doc-file-cb, .sp-doc-card-checkbox, [data-doc-unit]");
            for (var i = 0; i < allCbs.length; i++) allCbs[i].checked = checked;
            // Also sync doc type filter checkboxes
            var typeCbs = _overlay.querySelectorAll(".sp-doc-type-cb");
            for (var j = 0; j < typeCbs.length; j++) typeCbs[j].checked = checked;
        });

        var toggles = _overlay.querySelectorAll("[data-doc-toggle]");
        for (var t = 0; t < toggles.length; t++) {
            toggles[t].addEventListener("click", function (e) {
                if (e.target.tagName === "INPUT") return;
                var idx = this.dataset.docToggle;
                var body = document.getElementById("sp-doc-body-" + idx);
                var arrow = this.querySelector(".sp-doc-card-toggle");
                if (body) body.classList.toggle("sp-collapsed");
                if (arrow) arrow.classList.toggle("sp-collapsed");
            });
        }

        var sysCbs = _overlay.querySelectorAll(".sp-doc-card-checkbox");
        for (var s = 0; s < sysCbs.length; s++) {
            sysCbs[s].addEventListener("change", function () {
                var entryIdx = this.dataset.docSystem;
                var card = _overlay.querySelector('.sp-doc-card[data-doc-entry="' + entryIdx + '"]');
                if (card) {
                    var cbs = card.querySelectorAll(".sp-doc-file-cb, [data-doc-unit]");
                    for (var i = 0; i < cbs.length; i++) cbs[i].checked = this.checked;
                }
            });
        }

        var unitCbs = _overlay.querySelectorAll("[data-doc-unit]:not(.sp-doc-file-cb)");
        for (var u = 0; u < unitCbs.length; u++) {
            unitCbs[u].addEventListener("change", function () {
                var unitKey = this.dataset.docUnit;
                var fileCbs = _overlay.querySelectorAll('.sp-doc-file-cb[data-doc-unit="' + unitKey + '"]');
                for (var i = 0; i < fileCbs.length; i++) fileCbs[i].checked = this.checked;
            });
        }

        // Document type filter checkboxes
        var docTypeCbs = _overlay.querySelectorAll(".sp-doc-type-cb");
        for (var dt = 0; dt < docTypeCbs.length; dt++) {
            docTypeCbs[dt].addEventListener("change", function () {
                var typeKey = this.dataset.docTypeKey;
                var checked = this.checked;
                var matchingCbs = _overlay.querySelectorAll('.sp-doc-file-cb[data-doc-type-key="' + typeKey + '"]');
                for (var i = 0; i < matchingCbs.length; i++) matchingCbs[i].checked = checked;
            });
        }
    }

    // -----------------------------------------------------------------------
    // Generate Combined Submittal Package PDF (using pdf-lib)
    // -----------------------------------------------------------------------
    async function generateSubmittalPackage() {
        if (typeof PDFLib === "undefined") {
            console.warn("[Preview] PDFLib not loaded — skipping submittal package");
            return null;
        }

        // 1. Collect checked submittal PDFs grouped by system/unit tag
        var checkedSubmittals = _overlay.querySelectorAll('.sp-doc-file-cb:checked[data-doc-type-key="Submittals"]');
        if (checkedSubmittals.length === 0) return null;

        // Build ordered list of { tag, path } using the doc structure order
        var orderedDocs = [];
        var seenPaths = {};
        for (var ei = 0; ei < _entries.length; ei++) {
            var entry = _entries[ei];
            var structure = getEntryDocStructure(entry);
            for (var ui = 0; ui < structure.units.length; ui++) {
                var unit = structure.units[ui];
                for (var di = 0; di < unit.docs.length; di++) {
                    var doc = unit.docs[di];
                    if (!/^Submittal/i.test(doc.label)) continue;
                    // Check if this submittal is checked in the UI
                    var matchCb = _overlay.querySelector('.sp-doc-file-cb:checked[data-doc-path="' + doc.path.replace(/"/g, '\\"') + '"][data-doc-type-key="Submittals"]');
                    if (!matchCb) continue;
                    if (seenPaths[doc.path]) continue;
                    seenPaths[doc.path] = true;
                    orderedDocs.push({ tag: unit.tag, path: doc.path, label: doc.label });
                }
            }
        }

        if (orderedDocs.length === 0) return null;

        // 2. Fetch all PDFs as ArrayBuffers
        var fetchedDocs = [];
        for (var f = 0; f < orderedDocs.length; f++) {
            try {
                var resp = await fetch(orderedDocs[f].path);
                if (!resp.ok) throw new Error(resp.status);
                var buf = await resp.arrayBuffer();
                fetchedDocs.push({ tag: orderedDocs[f].tag, label: orderedDocs[f].label, buffer: buf });
            } catch (err) {
                console.warn("[Preview] Submittal fetch failed: " + orderedDocs[f].path, err);
            }
        }

        if (fetchedDocs.length === 0) return null;

        // 3. Merge all PDFs into a single document and track page ranges
        var mergedPdf = await PDFLib.PDFDocument.create();
        var tocEntries = []; // { tag, startPage, endPage }

        for (var m = 0; m < fetchedDocs.length; m++) {
            var srcDoc;
            try {
                srcDoc = await PDFLib.PDFDocument.load(fetchedDocs[m].buffer, { ignoreEncryption: true });
            } catch (loadErr) {
                console.warn("[Preview] Could not load PDF for: " + fetchedDocs[m].tag, loadErr);
                continue;
            }
            var srcPageCount = srcDoc.getPageCount();
            if (srcPageCount === 0) continue;
            var pageIndices = [];
            for (var pi = 0; pi < srcPageCount; pi++) pageIndices.push(pi);
            var copiedPages = await mergedPdf.copyPages(srcDoc, pageIndices);
            var startPage = mergedPdf.getPageCount();
            for (var cp = 0; cp < copiedPages.length; cp++) {
                mergedPdf.addPage(copiedPages[cp]);
            }
            var endPage = mergedPdf.getPageCount() - 1;
            tocEntries.push({ tag: fetchedDocs[m].tag, startPage: startPage, endPage: endPage });
        }

        if (mergedPdf.getPageCount() === 0) return null;

        // 4. Embed fonts for overlay text
        var helvetica = await mergedPdf.embedFont(PDFLib.StandardFonts.Helvetica);
        var helveticaBold = await mergedPdf.embedFont(PDFLib.StandardFonts.HelveticaBold);
        var totalContentPages = mergedPdf.getPageCount();

        // 5. Draw tag labels (top-right) and page numbers (bottom-right) on each content page
        for (var pg = 0; pg < totalContentPages; pg++) {
            var page = mergedPdf.getPage(pg);
            var pageWidth = page.getWidth();
            var pageHeight = page.getHeight();

            // Find the tag for this page
            var pageTag = "";
            for (var te = 0; te < tocEntries.length; te++) {
                if (pg >= tocEntries[te].startPage && pg <= tocEntries[te].endPage) {
                    pageTag = tocEntries[te].tag;
                    break;
                }
            }

            // Draw tag in top-right
            if (pageTag) {
                var tagFontSize = 10;
                var tagWidth = helveticaBold.widthOfTextAtSize(pageTag, tagFontSize);
                page.drawText(pageTag, {
                    x: pageWidth - tagWidth - 36,
                    y: pageHeight - 30,
                    size: tagFontSize,
                    font: helveticaBold,
                    color: PDFLib.rgb(0, 0, 0),
                });
            }

            // Draw page number in bottom-right (page numbering starts at 2 since TOC is page 1)
            var pageNumStr = "Page " + (pg + 2) + " of " + (totalContentPages + 1);
            var numFontSize = 9;
            var numWidth = helvetica.widthOfTextAtSize(pageNumStr, numFontSize);
            page.drawText(pageNumStr, {
                x: pageWidth - numWidth - 36,
                y: 24,
                size: numFontSize,
                font: helvetica,
                color: PDFLib.rgb(0.3, 0.3, 0.3),
            });
        }

        // 6. Create Table of Contents page (letter size: 612 x 792)
        var tocWidth = 612;
        var tocHeight = 792;
        var tocPage = mergedPdf.insertPage(0, [tocWidth, tocHeight]);

        // Title
        var tocTitle = "Table of Contents";
        var titleFontSize = 20;
        var titleWidth = helveticaBold.widthOfTextAtSize(tocTitle, titleFontSize);
        tocPage.drawText(tocTitle, {
            x: (tocWidth - titleWidth) / 2,
            y: tocHeight - 60,
            size: titleFontSize,
            font: helveticaBold,
            color: PDFLib.rgb(0, 0, 0),
        });

        // Draw underline below title
        tocPage.drawLine({
            start: { x: 72, y: tocHeight - 70 },
            end: { x: tocWidth - 72, y: tocHeight - 70 },
            thickness: 1,
            color: PDFLib.rgb(0.6, 0.6, 0.6),
        });

        // TOC entries with dot leaders
        var tocY = tocHeight - 100;
        var tocFontSize = 12;
        var dotLeaderChar = ".";
        var dotWidth = helvetica.widthOfTextAtSize(dotLeaderChar, tocFontSize);
        var leftMargin = 72;
        var rightMargin = tocWidth - 72;
        var pageNumAreaWidth = 30;

        for (var ti = 0; ti < tocEntries.length; ti++) {
            if (tocY < 60) break; // Safety: don't go below page

            var entryTag = tocEntries[ti].tag;
            // Page number displayed is startPage + 2 (because TOC is page 1, content starts at page 2)
            var displayPageNum = String(tocEntries[ti].startPage + 2);
            var tagTextWidth = helveticaBold.widthOfTextAtSize(entryTag, tocFontSize);
            var numTextWidth = helvetica.widthOfTextAtSize(displayPageNum, tocFontSize);

            // Draw tag name (left)
            tocPage.drawText(entryTag, {
                x: leftMargin,
                y: tocY,
                size: tocFontSize,
                font: helveticaBold,
                color: PDFLib.rgb(0, 0, 0),
            });

            // Draw page number (right-aligned)
            tocPage.drawText(displayPageNum, {
                x: rightMargin - numTextWidth,
                y: tocY,
                size: tocFontSize,
                font: helvetica,
                color: PDFLib.rgb(0, 0, 0),
            });

            // Draw dot leaders between tag and page number
            var dotStartX = leftMargin + tagTextWidth + 8;
            var dotEndX = rightMargin - numTextWidth - 8;
            var dotX = dotStartX;
            var dotSpacing = dotWidth + 1.5;
            while (dotX < dotEndX) {
                tocPage.drawText(dotLeaderChar, {
                    x: dotX,
                    y: tocY,
                    size: tocFontSize,
                    font: helvetica,
                    color: PDFLib.rgb(0.5, 0.5, 0.5),
                });
                dotX += dotSpacing;
            }

            tocY -= 22;
        }

        // TOC page number ("Page 1 of X")
        var tocPageNumStr = "Page 1 of " + (totalContentPages + 1);
        var tocNumWidth = helvetica.widthOfTextAtSize(tocPageNumStr, 9);
        tocPage.drawText(tocPageNumStr, {
            x: tocWidth - tocNumWidth - 36,
            y: 24,
            size: 9,
            font: helvetica,
            color: PDFLib.rgb(0.3, 0.3, 0.3),
        });

        // 7. Save and return as blob
        var mergedBytes = await mergedPdf.save();
        return new Blob([mergedBytes], { type: "application/pdf" });
    }

    // -----------------------------------------------------------------------
    // Download Bundle (structured ZIP)
    // -----------------------------------------------------------------------
    async function downloadBundle() {
        if (typeof JSZip === "undefined") { showToast("JSZip library not loaded"); return; }

        collectEditsFromDom();
        saveState();

        var zip = new JSZip();
        var includeXlsx = document.getElementById("sp-doc-include-xlsx");
        var includePdf = document.getElementById("sp-doc-include-pdf");
        var includeDxf = document.getElementById("sp-doc-include-dxf");
        var includeSubmittalPkg = document.getElementById("sp-doc-include-submittal-pkg");
        var wantXlsx = includeXlsx && includeXlsx.checked;
        var wantPdf = includePdf && includePdf.checked;
        var wantDxf = includeDxf && includeDxf.checked;
        var wantSubmittalPkg = includeSubmittalPkg && includeSubmittalPkg.checked;

        var target = Project.getActiveTarget();
        var projectName = "Project";
        if (target && target.type === "project") {
            var titleEl = document.getElementById("project-panel-title");
            if (titleEl) projectName = titleEl.textContent || "Project";
        } else if (target && target.type === "cart") {
            projectName = "Cart";
        }
        var today = new Date();
        var dateStr = (today.getMonth() + 1) + "-" + today.getDate() + "-" + today.getFullYear();
        var zipName = projectName + " - " + dateStr;

        showToast("Preparing download bundle…");

        var checkedCbs = _overlay.querySelectorAll(".sp-doc-file-cb:checked");
        var filesToFetch = [];
        for (var i = 0; i < checkedCbs.length; i++) {
            filesToFetch.push({
                path: checkedCbs[i].dataset.docPath,
                folder: checkedCbs[i].dataset.docFolder
            });
        }

        var fetched = 0, failed = 0;
        for (var f = 0; f < filesToFetch.length; f++) {
            try {
                var response = await fetch(filesToFetch[f].path);
                if (!response.ok) throw new Error(response.status);
                var blob = await response.blob();
                var filename = filesToFetch[f].path.split("/").pop();
                var zipPath = filesToFetch[f].folder + "/" + filename;
                zip.file(zipPath, blob);
                fetched++;
            } catch (err) {
                console.warn("[Preview] Failed to fetch: " + filesToFetch[f].path, err);
                failed++;
            }
        }

        if (wantXlsx && typeof Export !== "undefined" && Export.exportScheduleXlsx) {
            try {
                var xlsxBlobs = await Export.exportScheduleXlsx({ returnBlobs: true });
                if (xlsxBlobs) {
                    for (var xi = 0; xi < xlsxBlobs.length; xi++) {
                        zip.file(xlsxBlobs[xi].name, xlsxBlobs[xi].blob);
                    }
                }
            } catch (e) { console.warn("[Preview] Excel schedule generation failed:", e); }
        }

        if (wantPdf && typeof Export !== "undefined" && Export.exportSchedulePdf) {
            try {
                var pdfBlobs = Export.exportSchedulePdf({ returnBlobs: true });
                if (pdfBlobs) {
                    for (var pi = 0; pi < pdfBlobs.length; pi++) {
                        zip.file(pdfBlobs[pi].name, pdfBlobs[pi].blob);
                    }
                }
            } catch (e) { console.warn("[Preview] PDF schedule generation failed:", e); }
        }

        if (wantDxf && typeof Export !== "undefined" && Export.exportScheduleDxf) {
            try {
                var dxfBlobs = Export.exportScheduleDxf({ returnBlobs: true });
                if (dxfBlobs) {
                    for (var di = 0; di < dxfBlobs.length; di++) {
                        zip.file(dxfBlobs[di].name, dxfBlobs[di].blob);
                    }
                }
            } catch (e) { console.warn("[Preview] DXF schedule generation failed:", e); }
        }

        if (wantSubmittalPkg) {
            try {
                var submittalBlob = await generateSubmittalPackage();
                if (submittalBlob) {
                    zip.file("Submittal Package.pdf", submittalBlob);
                }
            } catch (e) { console.warn("[Preview] Submittal package generation failed:", e); }
        }

        if (fetched === 0 && !wantXlsx && !wantPdf && !wantDxf && !wantSubmittalPkg) { showToast("No files selected"); return; }

        try {
            var zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
            Project.downloadBlob(zipBlob, zipName + ".zip");
            var msg = fetched + " document(s) downloaded";
            if (failed > 0) msg += " (" + failed + " unavailable)";
            if (wantXlsx || wantPdf || wantDxf || wantSubmittalPkg) msg += " + schedule(s)";
            showToast(msg);
        } catch (err) {
            console.error("[Preview] ZIP generation failed:", err);
            showToast("Failed to create ZIP");
        }
    }

    // -----------------------------------------------------------------------
    // Email Project CSV
    // -----------------------------------------------------------------------
    function emailProjectCsv() {
        var csvData = Project.getCsvData();
        if (!csvData) {
            showToast("No systems to export");
            return;
        }

        // 1. Download the CSV file
        Project.downloadBlob(csvData.blob, csvData.filename);

        // 2. Build mailto link
        var subject = encodeURIComponent("HHpro Equipment Selections — " + csvData.filename.replace(/\.csv$/, "").replace(/HHpro_/g, "").replace(/_/g, " "));
        var body = encodeURIComponent(
            "Hi,\n\n" +
            "Please find my HHpro equipment selections attached.\n\n" +
            "File: " + csvData.filename + "\n" +
            "Systems: " + _entries.length + "\n\n" +
            "This CSV file can be loaded into HHpro using the \"Load CSV\" button in the project panel.\n\n" +
            "Thanks"
        );
        var mailto = "mailto:?subject=" + subject + "&body=" + body;

        // 3. Small delay so the download triggers first, then open email
        setTimeout(function () {
            window.location.href = mailto;
        }, 500);

        showToast("CSV downloaded — attach it to the email");
    }

    // -----------------------------------------------------------------------
    // Wire Events
    // -----------------------------------------------------------------------
    function wireEvents() {
        document.getElementById("sp-btn-close").addEventListener("click", close);
        document.getElementById("sp-btn-undo").addEventListener("click", undo);
        document.getElementById("sp-btn-redo").addEventListener("click", redo);
        document.getElementById("sp-btn-autonumber").addEventListener("click", showAutoNumberDialog);
        document.getElementById("sp-btn-xlsx").addEventListener("click", function () { collectEditsFromDom(); saveState(); document.getElementById("btn-export-schedule-xlsx").click(); });
        document.getElementById("sp-btn-pdf").addEventListener("click", function () { collectEditsFromDom(); saveState(); document.getElementById("btn-export-schedule-pdf").click(); });
        document.getElementById("sp-btn-dxf").addEventListener("click", function () { collectEditsFromDom(); saveState(); if (Export.exportScheduleDxf) Export.exportScheduleDxf(); });
        document.getElementById("sp-btn-email").addEventListener("click", function () { collectEditsFromDom(); saveState(); emailProjectCsv(); });

        document.getElementById("sp-btn-columns").addEventListener("click", function (e) {
            e.stopPropagation();
            _colPanelOpen = !_colPanelOpen;
            document.getElementById("sp-col-panel").classList.toggle("hidden", !_colPanelOpen);
        });
        document.getElementById("sp-col-panel").addEventListener("click", function (e) { e.stopPropagation(); });

        var grpCbs = _overlay.querySelectorAll("[data-group]");
        for (var g = 0; g < grpCbs.length; g++) grpCbs[g].addEventListener("change", function () { toggleColumnGroup(this.dataset.group); });
        var colCbs = _overlay.querySelectorAll("[data-colkey]");
        for (var c = 0; c < colCbs.length; c++) colCbs[c].addEventListener("change", function () { toggleSingleColumn(this.dataset.colkey); });

        document.getElementById("sp-bulk-duplicate").addEventListener("click", bulkDuplicate);
        document.getElementById("sp-bulk-delete").addEventListener("click", bulkDelete);
        document.getElementById("sp-bulk-deselect").addEventListener("click", function () { _selectedEntries.clear(); updateSelectionUI(); });

        _overlay.addEventListener("click", function (e) {
            if (_colPanelOpen && !e.target.closest(".sp-col-panel") && !e.target.closest("#sp-btn-columns")) {
                _colPanelOpen = false;
                document.getElementById("sp-col-panel").classList.add("hidden");
            }
        });

        wireContentEvents();
    }

    function wireContentEvents() {
        var inputs = _overlay.querySelectorAll(".sp-input");
        for (var i = 0; i < inputs.length; i++) inputs[i].addEventListener("input", handleEdit);

        var cbs = _overlay.querySelectorAll(".sp-row-checkbox");
        for (var j = 0; j < cbs.length; j++) cbs[j].addEventListener("change", function () { toggleSelect(parseInt(this.dataset.entry, 10)); });

        var selAll = document.getElementById("sp-select-all");
        if (selAll) selAll.addEventListener("change", toggleSelectAll);

        var actBtns = _overlay.querySelectorAll(".sp-act-btn, .sp-idu-btn");
        for (var k = 0; k < actBtns.length; k++) actBtns[k].addEventListener("click", handleActionButton);

        var draggableRows = _overlay.querySelectorAll("tr[draggable='true']");
        for (var d = 0; d < draggableRows.length; d++) {
            draggableRows[d].addEventListener("dragstart", handleDragStart);
            draggableRows[d].addEventListener("dragend", handleDragEnd);
        }
        var indoorTbody = _overlay.querySelector(".sp-table-indoor tbody");
        if (indoorTbody) {
            indoorTbody.addEventListener("dragover", handleDragOver);
            indoorTbody.addEventListener("drop", handleDrop);
            indoorTbody.addEventListener("dragleave", handleDragLeave);
        }

        wireDocumentEvents();
    }

    // -----------------------------------------------------------------------
    // Drag and Drop
    // -----------------------------------------------------------------------
    let _dragEntryIdx = -1;

    function handleDragStart(e) {
        var tr = e.target.closest("tr");
        if (!tr) return;
        _dragEntryIdx = parseInt(tr.dataset.entryIdx, 10);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(_dragEntryIdx));
        setTimeout(function () {
            var rows = _overlay.querySelectorAll('tr[data-entry-idx="' + _dragEntryIdx + '"]');
            for (var i = 0; i < rows.length; i++) rows[i].classList.add("sp-dragging");
        }, 0);
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        var tr = e.target.closest("tr[data-entry-idx]");
        if (!tr) return;
        var overIdx = parseInt(tr.dataset.entryIdx, 10);
        if (overIdx === _dragEntryIdx) return;
        clearDropIndicators();
        var rect = tr.getBoundingClientRect();
        if (e.clientY < rect.top + rect.height / 2) tr.classList.add("sp-drop-above");
        else tr.classList.add("sp-drop-below");
    }

    function handleDragLeave(e) {
        var tr = e.target.closest("tr[data-entry-idx]");
        if (tr) tr.classList.remove("sp-drop-above", "sp-drop-below");
    }

    function handleDrop(e) {
        e.preventDefault();
        clearDropIndicators();
        var tr = e.target.closest("tr[data-entry-idx]");
        if (!tr || _dragEntryIdx < 0) return;
        var dropIdx = parseInt(tr.dataset.entryIdx, 10);
        if (dropIdx === _dragEntryIdx) return;
        var rect = tr.getBoundingClientRect();
        var targetIdx = e.clientY < rect.top + rect.height / 2 ? dropIdx : dropIdx + 1;
        if (targetIdx > _dragEntryIdx) targetIdx--;
        if (targetIdx !== _dragEntryIdx) {
            collectEditsFromDom();
            var moved = _entries.splice(_dragEntryIdx, 1)[0];
            _entries.splice(targetIdx, 0, moved);
            pushHistory(); saveState(); rebuildContent();
        }
        _dragEntryIdx = -1;
    }

    function handleDragEnd() {
        _dragEntryIdx = -1;
        var d = _overlay.querySelectorAll(".sp-dragging");
        for (var i = 0; i < d.length; i++) d[i].classList.remove("sp-dragging");
        clearDropIndicators();
    }

    function clearDropIndicators() {
        var ind = _overlay.querySelectorAll(".sp-drop-above, .sp-drop-below");
        for (var i = 0; i < ind.length; i++) ind[i].classList.remove("sp-drop-above", "sp-drop-below");
    }

    // -----------------------------------------------------------------------
    // Action Buttons
    // -----------------------------------------------------------------------
    function handleActionButton(e) {
        var btn = e.currentTarget;
        var action = btn.dataset.action;
        var ei = parseInt(btn.dataset.entry, 10);
        collectEditsFromDom();

        if (action === "move-up" && ei > 0) {
            var t = _entries[ei]; _entries[ei] = _entries[ei - 1]; _entries[ei - 1] = t;
            pushHistory(); saveState(); rebuildContent();
        } else if (action === "move-down" && ei < _entries.length - 1) {
            var t2 = _entries[ei]; _entries[ei] = _entries[ei + 1]; _entries[ei + 1] = t2;
            pushHistory(); saveState(); rebuildContent();
        } else if (action === "duplicate") {
            _entries.splice(ei + 1, 0, JSON.parse(JSON.stringify(_entries[ei])));
            pushHistory(); saveState(); rebuildContent();
            showToast("System duplicated");
        } else if (action === "delete") {
            _entries.splice(ei, 1); _selectedEntries.delete(ei);
            pushHistory(); saveState(); rebuildContent();
            showToast("System removed");
        } else if (action === "idu-up") {
            swapIndoorUnits(ei, parseInt(btn.dataset.idu, 10), parseInt(btn.dataset.idu, 10) - 1);
        } else if (action === "idu-down") {
            swapIndoorUnits(ei, parseInt(btn.dataset.idu, 10), parseInt(btn.dataset.idu, 10) + 1);
        }
    }

    function swapIndoorUnits(entryIdx, a, b) {
        var entry = _entries[entryIdx];
        var tt = entry.iduTags[a]; entry.iduTags[a] = entry.iduTags[b]; entry.iduTags[b] = tt;
        if (entry.iduAccessories) { var ta = entry.iduAccessories[a]; entry.iduAccessories[a] = entry.iduAccessories[b]; entry.iduAccessories[b] = ta; }
        pushHistory(); saveState(); rebuildContent();
    }

    // -----------------------------------------------------------------------
    // Bulk Operations
    // -----------------------------------------------------------------------
    function bulkDuplicate() {
        if (_selectedEntries.size === 0) return;
        collectEditsFromDom();
        var indices = Array.from(_selectedEntries).sort(function (a, b) { return b - a; });
        for (var i = 0; i < indices.length; i++) _entries.splice(indices[i] + 1, 0, JSON.parse(JSON.stringify(_entries[indices[i]])));
        _selectedEntries.clear();
        pushHistory(); saveState(); rebuildContent();
        showToast(indices.length + " system(s) duplicated");
    }

    function bulkDelete() {
        if (_selectedEntries.size === 0) return;
        collectEditsFromDom();
        var indices = Array.from(_selectedEntries).sort(function (a, b) { return b - a; });
        for (var i = 0; i < indices.length; i++) _entries.splice(indices[i], 1);
        _selectedEntries.clear();
        pushHistory(); saveState(); rebuildContent();
        showToast(indices.length + " system(s) deleted");
    }

    // -----------------------------------------------------------------------
    // Auto-Number Tags
    // -----------------------------------------------------------------------
    function showAutoNumberDialog() {
        var groups = groupEntriesByProduct();
        var hasMps = groups["multi-position"] && groups["multi-position"].length > 0;
        var hasMs = groups["mini-splits"] && groups["mini-splits"].length > 0;

        var ov = document.createElement("div"); ov.className = "confirm-overlay sp-dialog-overlay";
        var d = document.createElement("div"); d.className = "confirm-dialog";
        var hd = document.createElement("div"); hd.className = "confirm-dialog-header";
        var h3 = document.createElement("h3"); h3.textContent = "Auto-Number Tags"; hd.appendChild(h3);
        var bd = document.createElement("div"); bd.className = "confirm-dialog-body";

        function addField(container, labelText, value, placeholder) {
            var lbl = document.createElement("label"); lbl.className = "input-dialog-label sp-autonumber-label"; lbl.textContent = labelText;
            var inp = document.createElement("input"); inp.type = "text"; inp.className = "input-dialog-input"; inp.value = value; inp.placeholder = placeholder;
            container.appendChild(lbl); container.appendChild(inp);
            return inp;
        }

        function addSectionTitle(container, text) {
            var title = document.createElement("div"); title.className = "sp-autonumber-section-title"; title.textContent = text;
            container.appendChild(title);
        }

        var msIduInp, msOduInp, msStartInp;
        var mpsIduInp, mpsOduInp, mpsStartInp;

        if (hasMs) {
            addSectionTitle(bd, "Mini Splits");
            msIduInp = addField(bd, "Indoor Unit Prefix", "IDU-", "IDU-");
            msOduInp = addField(bd, "Outdoor Unit Prefix", "ODU-", "ODU-");
            var msStartLbl = document.createElement("label"); msStartLbl.className = "input-dialog-label sp-autonumber-label"; msStartLbl.textContent = "Start Number";
            msStartInp = document.createElement("input"); msStartInp.type = "number"; msStartInp.className = "input-dialog-input"; msStartInp.value = "1"; msStartInp.min = "0";
            bd.appendChild(msStartLbl); bd.appendChild(msStartInp);
        }

        if (hasMps) {
            addSectionTitle(bd, "Multi Position Splits");
            mpsIduInp = addField(bd, "Indoor Unit Prefix", "AHU-", "AHU-");
            mpsOduInp = addField(bd, "Outdoor Unit Prefix", "CU-", "CU-");
            var mpsStartLbl = document.createElement("label"); mpsStartLbl.className = "input-dialog-label sp-autonumber-label"; mpsStartLbl.textContent = "Start Number";
            mpsStartInp = document.createElement("input"); mpsStartInp.type = "number"; mpsStartInp.className = "input-dialog-input"; mpsStartInp.value = "1"; mpsStartInp.min = "0";
            bd.appendChild(mpsStartLbl); bd.appendChild(mpsStartInp);
        }

        var ft = document.createElement("div"); ft.className = "confirm-dialog-footer";
        var cb = document.createElement("button"); cb.type = "button"; cb.className = "confirm-btn confirm-btn-cancel"; cb.textContent = "Cancel";
        cb.addEventListener("click", function () { document.body.removeChild(ov); });
        var cfb = document.createElement("button"); cfb.type = "button"; cfb.className = "confirm-btn confirm-btn-primary"; cfb.textContent = "Apply";
        cfb.addEventListener("click", function () {
            document.body.removeChild(ov);
            collectEditsFromDom();
            if (hasMs) {
                applyAutoNumberForProduct(groups["mini-splits"], msIduInp.value, msOduInp.value, parseInt(msStartInp.value, 10) || 1);
            }
            if (hasMps) {
                applyAutoNumberForProduct(groups["multi-position"], mpsIduInp.value, mpsOduInp.value, parseInt(mpsStartInp.value, 10) || 1);
            }
            pushHistory(); saveState(); rebuildContent();
            showToast("Tags auto-numbered");
        });
        ft.appendChild(cb); ft.appendChild(cfb);
        d.appendChild(hd); d.appendChild(bd); d.appendChild(ft);
        ov.appendChild(d); document.body.appendChild(ov);
        var firstInput = hasMs ? msIduInp : mpsIduInp;
        if (firstInput) requestAnimationFrame(function () { firstInput.focus(); firstInput.select(); });
    }

    function applyAutoNumberForProduct(entryIndices, iduPrefix, oduPrefix, startNum) {
        var iduCount = startNum, oduCount = startNum;
        for (var i = 0; i < entryIndices.length; i++) {
            var ei = entryIndices[i];
            var sys = DataLoader.getSystemById(_entries[ei].systemId);
            if (!sys) continue;
            _entries[ei].oduTag = oduPrefix + String(oduCount).padStart(2, "0");
            oduCount++;
            for (var j = 0; j < sys.indoorUnits.length; j++) {
                _entries[ei].iduTags[j] = iduPrefix + String(iduCount).padStart(2, "0");
                iduCount++;
            }
        }
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
        var noteInputs = _overlay.querySelectorAll("[data-note-type][data-note-product]");
        for (var j = 0; j < noteInputs.length; j++) {
            var nel = noteInputs[j];
            var pk = nel.dataset.noteProduct;
            var noteType = nel.dataset.noteType;
            var noteIdx = parseInt(nel.dataset.noteIndex, 10);
            if (!_notesByProduct[pk]) _notesByProduct[pk] = { indoor: [], outdoor: [] };
            while (_notesByProduct[pk][noteType].length <= noteIdx) _notesByProduct[pk][noteType].push("");
            _notesByProduct[pk][noteType][noteIdx] = nel.value;
        }
    }

    function saveState() {
        Project._saveEntriesDirect(JSON.parse(JSON.stringify(_entries)));
        // Save legacy flat notes (mini-splits) for backward compat
        var msNotes = _notesByProduct["mini-splits"] || { indoor: [], outdoor: [] };
        Project._saveNotesDirect(msNotes.indoor.slice(), msNotes.outdoor.slice());
        // Save per-product notes
        Project._saveProductNotesDirect(JSON.parse(JSON.stringify(_notesByProduct)));
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------
    function countVisible(keys) { var c = 0; for (var i = 0; i < keys.length; i++) if (isColVisible(keys[i])) c++; return c; }

    function fmt(val) {
        if (val === null || val === undefined || val === "") return '<span class="sp-empty">&mdash;</span>';
        if (typeof val === "number" && Number.isInteger(val) && val >= 1000) return esc(val.toLocaleString("en-US"));
        return esc(String(val));
    }

    function esc(str) {
        if (!str) return "";
        return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function showToast(msg) { if (Project && Project.showToast) Project.showToast(msg, "toast-success"); }

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