/* ==========================================================================
   schedule.js — Render filtered systems into split indoor/outdoor tables.
   Supports: mini-splits and multi-position product types.
   Emits system:add via EventBus when user clicks "+".
   ========================================================================== */

const Schedule = (function () {

    // -----------------------------------------------------------------------
    // Active Product
    // -----------------------------------------------------------------------
    let _activeProduct = "mini-splits";

    // -----------------------------------------------------------------------
    // DOM References — Mini Splits
    // -----------------------------------------------------------------------
    let _indoorTbody = null;
    let _outdoorTbody = null;
    let _indoorWrapper = null;
    let _outdoorWrapper = null;
    let _accessoriesNotes = null;
    let _section = null;
    let _emptyState = null;

    // -----------------------------------------------------------------------
    // DOM References — Multi Position Splits
    // -----------------------------------------------------------------------
    let _mpsIndoorTbody = null;
    let _mpsOutdoorTbody = null;
    let _mpsIndoorWrapper = null;
    let _mpsOutdoorWrapper = null;
    let _mpsAccessoriesNotes = null;
    let _mpsSection = null;
    let _mpsEmptyState = null;

    // Track current hover for cross-table sync
    let _currentHoverSystemId = null;


    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------
    function init() {

        // Mini Splits DOM
        _indoorTbody    = document.getElementById("indoor-schedule-tbody");
        _outdoorTbody   = document.getElementById("outdoor-schedule-tbody");
        _indoorWrapper  = document.getElementById("indoor-schedule-wrapper");
        _outdoorWrapper = document.getElementById("outdoor-schedule-wrapper");
        _accessoriesNotes = document.getElementById("accessories-notes");
        _section        = document.getElementById("schedule-section");
        _emptyState     = document.getElementById("schedule-empty");

        // Multi Position Splits DOM
        _mpsIndoorTbody    = document.getElementById("mps-indoor-schedule-tbody");
        _mpsOutdoorTbody   = document.getElementById("mps-outdoor-schedule-tbody");
        _mpsIndoorWrapper  = document.getElementById("mps-indoor-schedule-wrapper");
        _mpsOutdoorWrapper = document.getElementById("mps-outdoor-schedule-wrapper");
        _mpsAccessoriesNotes = document.getElementById("mps-accessories-notes");
        _mpsSection        = document.getElementById("mps-schedule-section");
        _mpsEmptyState     = document.getElementById("mps-schedule-empty");

        // Bind cross-table hover events — Mini Splits
        if (_indoorTbody) {
            _indoorTbody.addEventListener("mouseover", handleRowHover);
            _indoorTbody.addEventListener("mouseout", handleRowHoverOut);
        }
        if (_outdoorTbody) {
            _outdoorTbody.addEventListener("mouseover", handleRowHover);
            _outdoorTbody.addEventListener("mouseout", handleRowHoverOut);
        }

        // Bind cross-table hover events — MPS
        if (_mpsIndoorTbody) {
            _mpsIndoorTbody.addEventListener("mouseover", handleRowHover);
            _mpsIndoorTbody.addEventListener("mouseout", handleRowHoverOut);
        }
        if (_mpsOutdoorTbody) {
            _mpsOutdoorTbody.addEventListener("mouseover", handleRowHover);
            _mpsOutdoorTbody.addEventListener("mouseout", handleRowHoverOut);
        }

        console.log("[Schedule] Initialized");
    }


    // -----------------------------------------------------------------------
    // Switch Product
    // -----------------------------------------------------------------------
    function switchProduct(productKey) {
        _activeProduct = productKey;
    }


    // -----------------------------------------------------------------------
    // Render — Dispatch to active product
    // -----------------------------------------------------------------------
    function render(systems, projectIds) {
        if (_activeProduct === "multi-position") {
            renderMps(systems, projectIds);
        } else {
            renderMiniSplits(systems, projectIds);
        }
    }


    // -----------------------------------------------------------------------
    // Render — Mini Splits
    // -----------------------------------------------------------------------
    function renderMiniSplits(systems, projectIds) {
        if (!_indoorTbody || !_outdoorTbody) return;

        _indoorTbody.innerHTML = "";
        _outdoorTbody.innerHTML = "";

        if (!systems || systems.length === 0) {
            _indoorWrapper.classList.add("hidden");
            _outdoorWrapper.classList.add("hidden");
            _accessoriesNotes.classList.add("hidden");
            _emptyState.classList.remove("hidden");
            return;
        }

        _indoorWrapper.classList.remove("hidden");
        _outdoorWrapper.classList.remove("hidden");
        _accessoriesNotes.classList.remove("hidden");
        _emptyState.classList.add("hidden");

        var indoorFragment = document.createDocumentFragment();
        var outdoorFragment = document.createDocumentFragment();

        for (var s = 0; s < systems.length; s++) {
            var sys = systems[s];
            var isInProject = projectIds && projectIds.has(sys.id);

            var indoorRows = buildMsIndoorRows(sys, isInProject);
            for (var i = 0; i < indoorRows.length; i++) {
                indoorFragment.appendChild(indoorRows[i]);
            }

            var outdoorRow = buildMsOutdoorRow(sys, isInProject);
            outdoorFragment.appendChild(outdoorRow);
        }

        _indoorTbody.appendChild(indoorFragment);
        _outdoorTbody.appendChild(outdoorFragment);
    }


    // -----------------------------------------------------------------------
    // Render — Multi Position Splits
    // -----------------------------------------------------------------------
    function renderMps(systems, projectIds) {
        if (!_mpsIndoorTbody || !_mpsOutdoorTbody) return;

        _mpsIndoorTbody.innerHTML = "";
        _mpsOutdoorTbody.innerHTML = "";

        if (!systems || systems.length === 0) {
            _mpsIndoorWrapper.classList.add("hidden");
            _mpsOutdoorWrapper.classList.add("hidden");
            _mpsAccessoriesNotes.classList.add("hidden");
            _mpsEmptyState.classList.remove("hidden");
            return;
        }

        _mpsIndoorWrapper.classList.remove("hidden");
        _mpsOutdoorWrapper.classList.remove("hidden");
        _mpsAccessoriesNotes.classList.remove("hidden");
        _mpsEmptyState.classList.add("hidden");

        var indoorFragment = document.createDocumentFragment();
        var outdoorFragment = document.createDocumentFragment();

        for (var s = 0; s < systems.length; s++) {
            var sys = systems[s];
            var isInProject = projectIds && projectIds.has(sys.id);

            indoorFragment.appendChild(buildMpsIndoorRow(sys, isInProject));
            outdoorFragment.appendChild(buildMpsOutdoorRow(sys, isInProject));
        }

        _mpsIndoorTbody.appendChild(indoorFragment);
        _mpsOutdoorTbody.appendChild(outdoorFragment);
    }


    // -----------------------------------------------------------------------
    // Build Indoor Rows — Mini Splits
    // -----------------------------------------------------------------------
    function buildMsIndoorRows(sys, isInProject) {
        var rows = [];
        var numIndoor = sys.indoorUnits.length;

        for (var i = 0; i < numIndoor; i++) {
            var tr = document.createElement("tr");
            tr.className = "schedule-row";
            tr.dataset.systemId = sys.id;

            if (i === 0) tr.classList.add("system-first-row");
            if (i === numIndoor - 1) tr.classList.add("system-last-row");

            var idu = sys.indoorUnits[i];
            var isAnchorRow = (i === 0);

            // Action column
            if (isAnchorRow) {
                var actionTd = createCell("", "cell-action");
                if (numIndoor > 1) {
                    actionTd.classList.add("cell-action-merged");
                    actionTd.rowSpan = numIndoor;
                }

                var pdfBtn = document.createElement("button");
                pdfBtn.type = "button";
                pdfBtn.className = "btn-view-pdf";
                pdfBtn.dataset.systemId = sys.id;
                pdfBtn.textContent = "PDF";
                pdfBtn.title = "View submittal PDF(s)";
                pdfBtn.addEventListener("click", handleViewPdf);
                actionTd.appendChild(pdfBtn);

                var btn = document.createElement("button");
                btn.type = "button";
                btn.className = "btn-add-system";
                btn.dataset.systemId = sys.id;
                btn.title = "Add to project";
                if (isInProject) {
                    btn.classList.add("added");
                    btn.innerHTML = checkIconSvg();
                    btn.title = "In project — click to add again";
                } else {
                    btn.innerHTML = plusIconSvg();
                }
                btn.addEventListener("click", handleAddClick);
                actionTd.appendChild(btn);
                tr.appendChild(actionTd);
            }

            tr.appendChild(createCell(idu.symbol || "IDU-", "cell-editable cell-text"));
            tr.appendChild(createCell(sys.outdoorUnit.symbol || "ODU-", "cell-odu-ref"));
            tr.appendChild(createCell(formatNum(idu.cfm), "cell-numeric"));
            tr.appendChild(createCell(formatNum(idu.coolingEdb), "cell-numeric"));
            tr.appendChild(createCell(formatNum(idu.coolingEwb), "cell-numeric"));
            tr.appendChild(createCell(formatNum(idu.coolingTotal), "cell-numeric"));
            tr.appendChild(createCell(formatNum(idu.coolingSensible), "cell-numeric"));
            tr.appendChild(createCell(formatNum(idu.heatingEdb), "cell-numeric"));
            tr.appendChild(createCell(formatNum(idu.heatingTotal), "cell-numeric"));
            tr.appendChild(createCell(formatNum(idu.weight), "cell-numeric"));
            tr.appendChild(createCell(idu.type || "", "cell-text"));

            if (idu.poweredFromOutdoor) {
                var elecTd = createCell("Indoor Powered From Outdoor Unit", "cell-powered-from-outdoor");
                elecTd.colSpan = 3;
                tr.appendChild(elecTd);
            } else {
                tr.appendChild(createCell(idu.voltage || "", "cell-text"));
                tr.appendChild(createCell(formatNum(idu.mca), "cell-numeric"));
                tr.appendChild(createCell(formatNum(idu.mop), "cell-numeric"));
            }

            tr.appendChild(createCell(idu.manufacturer || "", "cell-model"));

            rows.push(tr);
        }

        return rows;
    }


    // -----------------------------------------------------------------------
    // Build Outdoor Row — Mini Splits
    // -----------------------------------------------------------------------
    function buildMsOutdoorRow(sys, isInProject) {
        var tr = document.createElement("tr");
        tr.className = "schedule-row system-first-row system-last-row";
        tr.dataset.systemId = sys.id;

        var odu = sys.outdoorUnit;

        var actionTd = createCell("", "cell-action");
        if (isInProject) {
            var indicator = document.createElement("span");
            indicator.className = "btn-add-system added";
            indicator.innerHTML = checkIconSvg();
            indicator.title = "In project";
            actionTd.appendChild(indicator);
        }
        tr.appendChild(actionTd);

        tr.appendChild(createCell(odu.symbol || "ODU-", "cell-editable cell-text"));
        tr.appendChild(createCell(formatNum(odu.coolingAmbient), "cell-numeric"));
        tr.appendChild(createCell(formatNum(odu.heatingAmbient), "cell-numeric"));
        tr.appendChild(createCell(formatNum(odu.weight), "cell-numeric"));
        tr.appendChild(createCell(odu.seer || "", "cell-text"));
        tr.appendChild(createCell(odu.voltage || "", "cell-text"));
        tr.appendChild(createCell(formatNum(odu.mca), "cell-numeric"));
        tr.appendChild(createCell(formatNum(odu.mop), "cell-numeric"));
        tr.appendChild(createCell(odu.manufacturer || "", "cell-model"));
        tr.appendChild(createCell(odu.refrigerant || "", "cell-text"));
        tr.appendChild(createCell(odu.lineSet || "", "cell-text"));

        return tr;
    }


    // -----------------------------------------------------------------------
    // Build Indoor Row — Multi Position Splits (one row per system)
    // -----------------------------------------------------------------------
    function buildMpsIndoorRow(sys, isInProject) {
        var tr = document.createElement("tr");
        tr.className = "schedule-row system-first-row system-last-row";
        tr.dataset.systemId = sys.id;

        var idu = sys.indoorUnits[0];

        // Action column
        var actionTd = createCell("", "cell-action");
        var pdfBtn = document.createElement("button");
        pdfBtn.type = "button";
        pdfBtn.className = "btn-view-pdf";
        pdfBtn.dataset.systemId = sys.id;
        pdfBtn.textContent = "PDF";
        pdfBtn.title = "View submittal PDF(s)";
        pdfBtn.addEventListener("click", handleViewPdf);
        actionTd.appendChild(pdfBtn);

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn-add-system";
        btn.dataset.systemId = sys.id;
        btn.title = "Add to project";
        if (isInProject) {
            btn.classList.add("added");
            btn.innerHTML = checkIconSvg();
            btn.title = "In project — click to add again";
        } else {
            btn.innerHTML = plusIconSvg();
        }
        btn.addEventListener("click", handleAddClick);
        actionTd.appendChild(btn);
        tr.appendChild(actionTd);

        // TAG
        tr.appendChild(createCell(idu.symbol || "AHU-", "cell-editable cell-text"));
        // MODEL
        tr.appendChild(createCell(idu.model || "", "cell-model"));
        // Supply Fan: Airflow, Motor HP, Motor Type
        tr.appendChild(createCell(formatNum(idu.airflow), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.motorHp), "cell-numeric"));
        tr.appendChild(createCell(idu.motorType || "", "cell-text"));
        // Cooling: EAT DB, EAT WB, LAT DB, Total Capacity, Sensible Capacity
        tr.appendChild(createCell(formatNum(idu.coolingEatDb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.coolingEatWb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.coolingLatDb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.coolingTotal), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.coolingSensible), "cell-numeric"));
        // Heat Pump Total Capacity
        tr.appendChild(createCell(formatNum(idu.heatPumpTotalCapacity), "cell-numeric"));
        // Aux Electric Heat: kW, Temp Rise
        tr.appendChild(createCell(idu.auxHeatKw || "", "cell-text"));
        tr.appendChild(createCell(idu.auxHeatTempRise || "", "cell-text"));
        // Electrical: Voltage, MCA, MOP
        tr.appendChild(createCell(idu.voltage || "", "cell-text"));
        tr.appendChild(createCell(formatNum(idu.mca), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.mop), "cell-numeric"));
        // Weight
        tr.appendChild(createCell(formatNum(idu.weight), "cell-numeric"));

        return tr;
    }


    // -----------------------------------------------------------------------
    // Build Outdoor Row — Multi Position Splits
    // -----------------------------------------------------------------------
    function buildMpsOutdoorRow(sys, isInProject) {
        var tr = document.createElement("tr");
        tr.className = "schedule-row system-first-row system-last-row";
        tr.dataset.systemId = sys.id;

        var odu = sys.outdoorUnit;

        // Action column
        var actionTd = createCell("", "cell-action");
        if (isInProject) {
            var indicator = document.createElement("span");
            indicator.className = "btn-add-system added";
            indicator.innerHTML = checkIconSvg();
            indicator.title = "In project";
            actionTd.appendChild(indicator);
        }
        tr.appendChild(actionTd);

        // TAG
        tr.appendChild(createCell(odu.symbol || "CU-", "cell-editable cell-text"));
        // MODEL
        tr.appendChild(createCell(odu.model || "", "cell-model"));
        // Heat Pump Heating Data: Ambient DB, Total Capacity, Efficiency
        tr.appendChild(createCell(formatNum(odu.heatingAmbient), "cell-numeric"));
        tr.appendChild(createCell(formatNum(odu.heatingTotal), "cell-numeric"));
        tr.appendChild(createCell(odu.heatingEfficiency || "", "cell-text"));
        // Electrical: Voltage, MCA, MOP
        tr.appendChild(createCell(odu.voltage || "", "cell-text"));
        tr.appendChild(createCell(formatNum(odu.mca), "cell-numeric"));
        tr.appendChild(createCell(formatNum(odu.mop), "cell-numeric"));
        // Outdoor Ambient (Cooling)
        tr.appendChild(createCell(formatNum(odu.coolingAmbient), "cell-numeric"));
        // Refrigerant
        tr.appendChild(createCell(odu.refrigerant || "", "cell-text"));
        // Efficiency (SEER2/EER2)
        tr.appendChild(createCell(odu.efficiency || "", "cell-text"));
        // Weight
        tr.appendChild(createCell(formatNum(odu.weight), "cell-numeric"));
        // Compressor Stages
        tr.appendChild(createCell(odu.compressorStages || "", "cell-text"));

        return tr;
    }


    // -----------------------------------------------------------------------
    // Cell Helpers
    // -----------------------------------------------------------------------
    function createCell(content, className) {
        var td = document.createElement("td");
        if (className) td.className = className;

        if (content === null || content === undefined || content === "") {
            td.classList.add("cell-empty");
            td.textContent = "\u2014";  // em dash
        } else {
            td.textContent = content;
        }

        return td;
    }

    function formatNum(val) {
        if (val === null || val === undefined) return null;
        if (typeof val === "number") {
            if (Number.isInteger(val) && val >= 1000) {
                return val.toLocaleString("en-US");
            }
            return val.toString();
        }
        return val;
    }

    /** SVG plus icon for the add-to-project button */
    function plusIconSvg() {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    }

    /** SVG checkmark icon for the added state */
    function checkIconSvg() {
        return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    }


    // -----------------------------------------------------------------------
    // Cross-Table Hover Grouping
    // -----------------------------------------------------------------------
    function handleRowHover(e) {
        var row = e.target.closest("tr.schedule-row");
        if (!row) return;

        var sysId = row.dataset.systemId;
        if (sysId === _currentHoverSystemId) return;

        clearSystemHover();
        _currentHoverSystemId = sysId;
        applyHoverToSystem(sysId);
    }

    function handleRowHoverOut(e) {
        var related = e.relatedTarget;

        if (related) {
            // Check all possible tbodies
            var tbodies = [_indoorTbody, _outdoorTbody, _mpsIndoorTbody, _mpsOutdoorTbody];
            for (var i = 0; i < tbodies.length; i++) {
                if (tbodies[i] && tbodies[i].contains(related)) return;
            }
        }

        clearSystemHover();
    }

    function applyHoverToSystem(sysId) {
        var selector = 'tr[data-system-id="' + sysId + '"]';

        // Apply across all active tbodies
        var tbodies = _activeProduct === "multi-position"
            ? [_mpsIndoorTbody, _mpsOutdoorTbody]
            : [_indoorTbody, _outdoorTbody];

        for (var t = 0; t < tbodies.length; t++) {
            if (!tbodies[t]) continue;
            var rows = tbodies[t].querySelectorAll(selector);
            for (var i = 0; i < rows.length; i++) {
                rows[i].classList.add("system-hover");
            }
        }
    }

    function clearSystemHover() {
        if (!_currentHoverSystemId) return;

        var hovered = document.querySelectorAll("tr.system-hover");
        for (var i = 0; i < hovered.length; i++) {
            hovered[i].classList.remove("system-hover");
        }

        _currentHoverSystemId = null;
    }


    // -----------------------------------------------------------------------
    // View PDF Handler
    // -----------------------------------------------------------------------
    function handleViewPdf(e) {
        var btn = e.currentTarget;
        var systemId = btn.dataset.systemId;
        if (!systemId) return;

        var sys = DataLoader.getSystemById(systemId);
        if (!sys || !sys.docs) return;

        var d = sys.docs;
        var pdfs = [];
        var seen = {};

        function addPdf(path) {
            if (!path || seen[path]) return;
            // Only add PDF paths (not ZIP)
            if (!path.toLowerCase().endsWith(".pdf")) return;
            seen[path] = true;
            pdfs.push(path);
        }

        if (sys.productKey === "multi-position") {
            // MPS: flat doc structure
            addPdf(d.submittalSystem);
            addPdf(d.submittalOutdoor);
            addPdf(d.submittalIndoor);
        } else {
            // Mini Splits: nested doc structure
            addPdf(d.submittalSystem);
            addPdf(d.submittalOutdoor);
            if (d.indoorDocs) {
                for (var i = 0; i < d.indoorDocs.length; i++) {
                    addPdf(d.indoorDocs[i].submittalIndoor);
                }
            }
        }

        if (pdfs.length === 0) {
            if (typeof Project !== "undefined" && Project.showToast) {
                Project.showToast("No submittal PDFs available", "toast-warning");
            }
            return;
        }

        for (var p = 0; p < pdfs.length; p++) {
            window.open(pdfs[p], "_blank");
        }
    }


    // -----------------------------------------------------------------------
    // Add to Project Handler
    // -----------------------------------------------------------------------
    function handleAddClick(e) {
        var btn = e.currentTarget;
        var systemId = btn.dataset.systemId;

        if (!systemId) return;

        if (!btn.classList.contains("added")) {
            btn.classList.add("added");
            btn.innerHTML = checkIconSvg();
            btn.title = "In project — click to add again";
            updateOutdoorIndicator(systemId, true);
        }

        // Emit via EventBus instead of calling a callback
        EventBus.emit("system:add", systemId);
    }

    function updateOutdoorIndicator(systemId, added) {
        // Check both mini-splits and MPS outdoor tbodies
        var tbodies = [_outdoorTbody, _mpsOutdoorTbody];

        for (var t = 0; t < tbodies.length; t++) {
            if (!tbodies[t]) continue;
            var outdoorRows = tbodies[t].querySelectorAll('tr[data-system-id="' + systemId + '"]');
            for (var i = 0; i < outdoorRows.length; i++) {
                var actionCell = outdoorRows[i].querySelector("td.cell-action");
                if (!actionCell) continue;

                if (added) {
                    if (!actionCell.querySelector(".btn-add-system")) {
                        var indicator = document.createElement("span");
                        indicator.className = "btn-add-system added";
                        indicator.innerHTML = checkIconSvg();
                        indicator.title = "In project";
                        actionCell.textContent = "";
                        actionCell.classList.remove("cell-empty");
                        actionCell.appendChild(indicator);
                    }
                } else {
                    actionCell.innerHTML = "";
                    actionCell.textContent = "\u2014";
                    actionCell.classList.add("cell-empty");
                }
            }
        }
    }


    // -----------------------------------------------------------------------
    // Update Add Buttons
    // -----------------------------------------------------------------------
    function updateAddButtons(projectIds) {
        // Update both product tables
        updateAddButtonsForTbody(_indoorTbody, _outdoorTbody, projectIds);
        updateAddButtonsForTbody(_mpsIndoorTbody, _mpsOutdoorTbody, projectIds);
    }

    function updateAddButtonsForTbody(indoorTbody, outdoorTbody, projectIds) {
        if (!indoorTbody) return;

        var buttons = indoorTbody.querySelectorAll(".btn-add-system");
        for (var i = 0; i < buttons.length; i++) {
            var btn = buttons[i];
            var sysId = btn.dataset.systemId;

            if (projectIds.has(sysId)) {
                btn.classList.add("added");
                btn.innerHTML = checkIconSvg();
                btn.title = "In project — click to add again";
            } else {
                btn.classList.remove("added");
                btn.innerHTML = plusIconSvg();
                btn.title = "Add to project";
            }
            btn.removeEventListener("click", handleAddClick);
            btn.addEventListener("click", handleAddClick);
        }

        if (!outdoorTbody) return;
        var outdoorRows = outdoorTbody.querySelectorAll("tr.schedule-row");
        for (var j = 0; j < outdoorRows.length; j++) {
            var sysId2 = outdoorRows[j].dataset.systemId;
            updateOutdoorIndicator(sysId2, projectIds.has(sysId2));
        }
    }


    // -----------------------------------------------------------------------
    // Scroll to Top
    // -----------------------------------------------------------------------
    function scrollToTop() {
        var target = _activeProduct === "multi-position" ? _mpsSection : _section;
        if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }


    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        init:               init,
        switchProduct:      switchProduct,
        render:             render,
        updateAddButtons:   updateAddButtons,
        scrollToTop:        scrollToTop,
    };

})();