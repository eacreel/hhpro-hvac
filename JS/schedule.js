/* ==========================================================================
   schedule.js — Render filtered systems into schedule tables.
   Supports: mini-splits, multi-position, and gas-packs product types.
   All products use a single combined table (no indoor/outdoor split).
   Emits system:add via EventBus when user clicks "+".
   ========================================================================== */

const Schedule = (function () {

    // -----------------------------------------------------------------------
    // Active Product
    // -----------------------------------------------------------------------
    let _activeProduct = "mini-splits";

    // -----------------------------------------------------------------------
    // DOM References — Mini Splits (combined single table)
    // -----------------------------------------------------------------------
    let _msTbody = null;
    let _msWrapper = null;
    let _section = null;
    let _emptyState = null;

    // -----------------------------------------------------------------------
    // DOM References — Multi Position Splits (combined single table)
    // -----------------------------------------------------------------------
    let _mpsTbody = null;
    let _mpsWrapper = null;
    let _mpsSection = null;
    let _mpsEmptyState = null;

    // -----------------------------------------------------------------------
    // DOM References — Gas Packs
    // -----------------------------------------------------------------------
    let _gpTbody = null;
    let _gpWrapper = null;
    let _gpSection = null;
    let _gpEmptyState = null;

    // Track current hover for cross-table sync
    let _currentHoverSystemId = null;


    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------
    function init() {

        // Mini Splits DOM (combined table)
        _msTbody    = document.getElementById("ms-schedule-tbody");
        _msWrapper  = document.getElementById("ms-schedule-wrapper");
        _section    = document.getElementById("schedule-section");
        _emptyState = document.getElementById("schedule-empty");

        // Multi Position Splits DOM (combined table)
        _mpsTbody      = document.getElementById("mps-schedule-tbody");
        _mpsWrapper    = document.getElementById("mps-schedule-wrapper");
        _mpsSection    = document.getElementById("mps-schedule-section");
        _mpsEmptyState = document.getElementById("mps-schedule-empty");

        // Gas Packs DOM
        _gpTbody      = document.getElementById("gp-schedule-tbody");
        _gpWrapper    = document.getElementById("gp-schedule-wrapper");
        _gpSection    = document.getElementById("gp-schedule-section");
        _gpEmptyState = document.getElementById("gp-schedule-empty");

        // Bind hover events
        var allTbodies = [_msTbody, _mpsTbody, _gpTbody];
        for (var t = 0; t < allTbodies.length; t++) {
            if (allTbodies[t]) {
                allTbodies[t].addEventListener("mouseover", handleRowHover);
                allTbodies[t].addEventListener("mouseout", handleRowHoverOut);
            }
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
        } else if (_activeProduct === "gas-packs") {
            renderGasPacks(systems, projectIds);
        } else {
            renderMiniSplits(systems, projectIds);
        }
    }


    // -----------------------------------------------------------------------
    // Render — Mini Splits (combined single table)
    // -----------------------------------------------------------------------
    function renderMiniSplits(systems, projectIds) {
        if (!_msTbody) return;

        _msTbody.innerHTML = "";

        if (!systems || systems.length === 0) {
            if (_msWrapper) _msWrapper.classList.add("hidden");
            _emptyState.classList.remove("hidden");
            return;
        }

        if (_msWrapper) _msWrapper.classList.remove("hidden");
        _emptyState.classList.add("hidden");

        var fragment = document.createDocumentFragment();

        for (var s = 0; s < systems.length; s++) {
            var sys = systems[s];
            var isInProject = projectIds && projectIds.has(sys.id);
            var rows = buildMsRows(sys, isInProject);
            for (var i = 0; i < rows.length; i++) {
                fragment.appendChild(rows[i]);
            }
        }

        _msTbody.appendChild(fragment);
    }


    // -----------------------------------------------------------------------
    // Render — Multi Position Splits (combined single table)
    // -----------------------------------------------------------------------
    function renderMps(systems, projectIds) {
        if (!_mpsTbody) return;

        _mpsTbody.innerHTML = "";

        if (!systems || systems.length === 0) {
            if (_mpsWrapper) _mpsWrapper.classList.add("hidden");
            if (_mpsEmptyState) _mpsEmptyState.classList.remove("hidden");
            return;
        }

        if (_mpsWrapper) _mpsWrapper.classList.remove("hidden");
        if (_mpsEmptyState) _mpsEmptyState.classList.add("hidden");

        var fragment = document.createDocumentFragment();

        for (var s = 0; s < systems.length; s++) {
            var sys = systems[s];
            var isInProject = projectIds && projectIds.has(sys.id);
            fragment.appendChild(buildMpsRow(sys, isInProject));
        }

        _mpsTbody.appendChild(fragment);
    }


    // -----------------------------------------------------------------------
    // Render — Gas Packs (single table, no indoor/outdoor split)
    // -----------------------------------------------------------------------
    function renderGasPacks(systems, projectIds) {
        if (!_gpTbody) return;

        _gpTbody.innerHTML = "";

        if (!systems || systems.length === 0) {
            if (_gpWrapper) _gpWrapper.classList.add("hidden");
            if (_gpEmptyState) _gpEmptyState.classList.remove("hidden");
            return;
        }

        if (_gpWrapper) _gpWrapper.classList.remove("hidden");
        if (_gpEmptyState) _gpEmptyState.classList.add("hidden");

        var fragment = document.createDocumentFragment();

        for (var s = 0; s < systems.length; s++) {
            var sys = systems[s];
            var isInProject = projectIds && projectIds.has(sys.id);
            fragment.appendChild(buildGpRow(sys, isInProject));
        }

        _gpTbody.appendChild(fragment);
    }


    // -----------------------------------------------------------------------
    // Build Rows — Mini Splits (combined: indoor + outdoor on same row)
    // For multi-zone systems, outdoor columns use rowSpan.
    // -----------------------------------------------------------------------
    function buildMsRows(sys, isInProject) {
        var rows = [];
        var numIndoor = sys.indoorUnits.length;
        var odu = sys.outdoorUnit;

        for (var i = 0; i < numIndoor; i++) {
            var tr = document.createElement("tr");
            tr.className = "schedule-row";
            tr.dataset.systemId = sys.id;

            if (i === 0) tr.classList.add("system-first-row");
            if (i === numIndoor - 1) tr.classList.add("system-last-row");

            var idu = sys.indoorUnits[i];
            var isAnchorRow = (i === 0);

            // Set unit type data attribute for CSS border color coding
            var unitType = (idu.type || "").toLowerCase();
            if (unitType.indexOf("wall") !== -1) {
                tr.dataset.unitType = "wall";
            } else if (unitType.indexOf("ducted") !== -1) {
                tr.dataset.unitType = "ducted";
            } else if (unitType.indexOf("floor") !== -1) {
                tr.dataset.unitType = "floor";
            } else if (unitType.indexOf("ceiling") !== -1) {
                tr.dataset.unitType = "ceiling";
            }

            // Action column (only on anchor row, spans all indoor rows)
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

            // Indoor unit columns
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

            // Outdoor unit columns (only on anchor row, spans all indoor rows)
            if (isAnchorRow) {
                var span = numIndoor > 1 ? numIndoor : 0;

                appendSpanCell(tr, formatNum(odu.coolingAmbient), "cell-numeric", span);
                appendSpanCell(tr, formatNum(odu.heatingAmbient), "cell-numeric", span);
                appendSpanCell(tr, formatNum(odu.weight), "cell-numeric", span);
                appendSpanCell(tr, odu.seer || "", "cell-text", span);
                appendSpanCell(tr, odu.voltage || "", "cell-text", span);
                appendSpanCell(tr, formatNum(odu.mca), "cell-numeric", span);
                appendSpanCell(tr, formatNum(odu.mop), "cell-numeric", span);
                appendSpanCell(tr, odu.manufacturer || "", "cell-model", span);
                appendSpanCell(tr, odu.refrigerant || "", "cell-text", span);
                appendSpanCell(tr, odu.lineSet || "", "cell-text", span);
            }

            rows.push(tr);
        }

        return rows;
    }

    /** Create a cell and optionally set rowSpan (only if span > 0) */
    function appendSpanCell(tr, content, className, span) {
        var td = createCell(content, className);
        if (span > 0) td.rowSpan = span;
        tr.appendChild(td);
    }


    // -----------------------------------------------------------------------
    // Build Row — Multi Position Splits (combined single row)
    // -----------------------------------------------------------------------
    function buildMpsRow(sys, isInProject) {
        var tr = document.createElement("tr");
        tr.className = "schedule-row system-first-row system-last-row";
        tr.dataset.systemId = sys.id;

        var idu = sys.indoorUnits[0];
        var odu = sys.outdoorUnit;

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

        // Indoor AHU columns
        tr.appendChild(createCell(idu.model || "", "cell-model"));
        tr.appendChild(createCell(formatNum(idu.airflow), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.motorHp), "cell-numeric"));
        tr.appendChild(createCell(idu.motorType || "", "cell-text"));
        tr.appendChild(createCell(formatNum(idu.coolingEatDb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.coolingEatWb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.coolingLatDb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.coolingTotal), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.coolingSensible), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.heatPumpTotalCapacity), "cell-numeric"));
        tr.appendChild(createCell(idu.auxHeatKw || "", "cell-text"));
        tr.appendChild(createCell(idu.auxHeatTempRise || "", "cell-text"));
        tr.appendChild(createCell(idu.voltage || "", "cell-text"));
        tr.appendChild(createCell(formatNum(idu.mca), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.mop), "cell-numeric"));
        tr.appendChild(createCell(formatNum(idu.weight), "cell-numeric"));

        // Outdoor condensing unit columns
        tr.appendChild(createCell(odu.model || "", "cell-model"));
        tr.appendChild(createCell(formatNum(odu.heatingAmbient), "cell-numeric"));
        tr.appendChild(createCell(formatNum(odu.heatingTotal), "cell-numeric"));
        tr.appendChild(createCell(odu.heatingEfficiency || "", "cell-text"));
        tr.appendChild(createCell(odu.voltage || "", "cell-text"));
        tr.appendChild(createCell(formatNum(odu.mca), "cell-numeric"));
        tr.appendChild(createCell(formatNum(odu.mop), "cell-numeric"));
        tr.appendChild(createCell(formatNum(odu.coolingAmbient), "cell-numeric"));
        tr.appendChild(createCell(odu.refrigerant || "", "cell-text"));
        tr.appendChild(createCell(odu.efficiency || "", "cell-text"));
        tr.appendChild(createCell(odu.compressorStages || "", "cell-text"));
        tr.appendChild(createCell(formatNum(odu.weight), "cell-numeric"));

        // Notes column (empty in filter view)
        tr.appendChild(createCell("", "cell-text"));

        return tr;
    }


    // -----------------------------------------------------------------------
    // Build Row — Gas Packs (single row per unit, flat schedule object)
    // -----------------------------------------------------------------------
    function buildGpRow(sys, isInProject) {
        var tr = document.createElement("tr");
        tr.className = "schedule-row system-first-row system-last-row";
        tr.dataset.systemId = sys.id;

        var sc = sys.schedule;

        // Action column
        var actionTd = createCell("", "cell-action");
        var pdfBtn = document.createElement("button");
        pdfBtn.type = "button";
        pdfBtn.className = "btn-view-pdf";
        pdfBtn.dataset.systemId = sys.id;
        pdfBtn.textContent = "PDF";
        pdfBtn.title = "View submittal PDF";
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

        // Schedule data columns
        tr.appendChild(createCell(sc.manufacturer || "", "cell-text"));
        tr.appendChild(createCell(sc.model || "", "cell-model"));
        tr.appendChild(createCell(formatNum(sc.nomTons), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.cfm), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.esp), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.tesp), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.coolingTotalCapacity), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.coolingSensibleCapacity), "cell-numeric"));
        tr.appendChild(createCell(sc.efficiency || "", "cell-text"));
        tr.appendChild(createCell(formatNum(sc.edb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.ewb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.ldb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.lwb), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.heatingInput), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.heatingOutput), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.heatingEat), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.heatingLat), "cell-numeric"));
        tr.appendChild(createCell(sc.hgrh || "", "cell-text"));
        tr.appendChild(createCell(formatNum(sc.coolingStages), "cell-text"));
        tr.appendChild(createCell(sc.voltage || "", "cell-text"));
        tr.appendChild(createCell(formatNum(sc.motorHp), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.mca), "cell-numeric"));
        tr.appendChild(createCell(formatNum(sc.mocp), "cell-numeric"));

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
            var tbodies = [_msTbody, _mpsTbody, _gpTbody];
            for (var i = 0; i < tbodies.length; i++) {
                if (tbodies[i] && tbodies[i].contains(related)) return;
            }
        }

        clearSystemHover();
    }

    function applyHoverToSystem(sysId) {
        var selector = 'tr[data-system-id="' + sysId + '"]';

        var tbodies;
        if (_activeProduct === "multi-position") {
            tbodies = [_mpsTbody];
        } else if (_activeProduct === "gas-packs") {
            tbodies = [_gpTbody];
        } else {
            tbodies = [_msTbody];
        }

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
            if (!path.toLowerCase().endsWith(".pdf")) return;
            seen[path] = true;
            pdfs.push(path);
        }

        if (sys.productKey === "gas-packs") {
            addPdf(d.submittal);
        } else if (sys.productKey === "multi-position") {
            addPdf(d.submittalSystem);
            addPdf(d.submittalOutdoor);
            addPdf(d.submittalIndoor);
        } else {
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
        }

        EventBus.emit("system:add", systemId);
    }


    // -----------------------------------------------------------------------
    // Update Add Buttons
    // -----------------------------------------------------------------------
    function updateAddButtons(projectIds) {
        updateAddButtonsForTbody(_msTbody, projectIds);
        updateAddButtonsForTbody(_mpsTbody, projectIds);
        updateAddButtonsForTbody(_gpTbody, projectIds);
    }

    function updateAddButtonsForTbody(tbody, projectIds) {
        if (!tbody) return;

        var buttons = tbody.querySelectorAll(".btn-add-system");
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
    }


    // -----------------------------------------------------------------------
    // Scroll to Top
    // -----------------------------------------------------------------------
    function scrollToTop() {
        var target;
        if (_activeProduct === "multi-position") target = _mpsSection;
        else if (_activeProduct === "gas-packs") target = _gpSection;
        else target = _section;
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
