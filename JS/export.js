/* ==========================================================================
   export.js — Document downloads, schedule export (Excel & PDF)

   Supports both Mini Split and Multi Position Split product types.

   Excel export: Loads the appropriate template to inherit exact theme,
   styles, fonts, and column widths. Builds the populated schedule
   in-browser and downloads it.

   PDF export: Mirrors the Excel schedule layout exactly using jsPDF +
   jsPDF-AutoTable with matching borders (medium outer, thin inner).

   Local libraries (in JS/ folder):
     - ExcelJS, jsPDF, jsPDF-AutoTable, JSZip
   ========================================================================== */

const Export = (function () {

    // Template paths per product
    const TEMPLATE_PATHS = {
        "mini-splits":     "DATA/MINI SPLIT SCHEDULE.xlsx",
        "multi-position":  "DATA/MULTI POSITION SPLIT SCHEDULE.xlsx",
        "gas-packs":       "DATA/GAS PACKS SCHEDULE.xlsx",
    };

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------
    function init() {
        document.getElementById("btn-export-csv").addEventListener("click", function () {
            Project.exportCsv();
        });
        document.getElementById("btn-export-schedule-xlsx").addEventListener("click", function () {
            exportScheduleXlsx();
        });
        document.getElementById("btn-export-schedule-pdf").addEventListener("click", function () {
            exportSchedulePdf();
        });
        document.getElementById("btn-download-docs").addEventListener("click", function () {
            downloadAllDocuments();
        });
        console.log("[Export] Initialized");
    }


    // =====================================================================
    //  Detect product type from entries
    // =====================================================================
    function groupEntriesByProduct() {
        var entries = Project.getEntries();
        var groups = {};
        for (var i = 0; i < entries.length; i++) {
            var sys = DataLoader.getSystemById(entries[i].systemId);
            var pk = "mini-splits";
            if (sys && sys.productKey === "multi-position") pk = "multi-position";
            else if (sys && sys.productKey === "gas-packs") pk = "gas-packs";
            if (!groups[pk]) groups[pk] = [];
            groups[pk].push(entries[i]);
        }
        return groups;
    }


    // =====================================================================
    //  DOWNLOAD ALL DOCUMENTS  (bundled into a ZIP)
    // =====================================================================
    async function downloadAllDocuments() {
        var entries = Project.getEntries();
        if (entries.length === 0) return;
        if (typeof JSZip === "undefined") {
            Project.showToast("JSZip library not loaded", "toast-danger"); return;
        }
        Project.showToast("Preparing document bundle…", "toast-success");
        var zip = new JSZip();
        var allDocs = [], seen = {};
        for (var i = 0; i < entries.length; i++) {
            var docs = DataLoader.getSystemDocuments(entries[i].systemId);
            for (var d = 0; d < docs.length; d++) {
                if (!seen[docs[d].path]) { seen[docs[d].path] = true; allDocs.push(docs[d]); }
            }
        }
        if (allDocs.length === 0) { Project.showToast("No documents available", "toast-warning"); return; }
        var fetched = 0, failed = 0;

        for (var j = 0; j < allDocs.length; j++) {
            try {
                var response = await fetch(allDocs[j].path);
                if (!response.ok) throw new Error(response.status);
                var blob = await response.blob();
                // Strip the ASSETS/product/ prefix for cleaner zip paths
                var zipPath = allDocs[j].path
                    .replace(/^ASSETS\/MINI SPLITS\//, "")
                    .replace(/^ASSETS\/MULTI POSITION SPLITS\//, "")
                    .replace(/^ASSETS\/GAS PACKS\//, "");
                zip.file(zipPath, blob);
                fetched++;
            } catch (err) { console.warn("[Export] Failed to fetch: " + allDocs[j].path, err); failed++; }
        }
        if (fetched === 0) { Project.showToast("Could not retrieve any documents", "toast-danger"); return; }
        try {
            var zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
            Project.downloadBlob(zipBlob, "HHpro_Documents.zip");
            var msg = fetched + " document(s) downloaded";
            if (failed > 0) msg += " (" + failed + " unavailable)";
            Project.showToast(msg, "toast-success");
        } catch (err) { console.error("[Export] ZIP failed:", err); Project.showToast("Failed to create ZIP", "toast-danger"); }
    }


    // =====================================================================
    //  BORDER HELPERS
    // =====================================================================
    var _thin  = { style: "thin" };
    var _medium = { style: "medium" };
    var _allMedium = { top: _medium, bottom: _medium, left: _medium, right: _medium };

    function dataBorder(isFirstRow, isLastRow, isLeftEdge, isRightEdge) {
        return {
            top:    isFirstRow ? _medium : _thin,
            bottom: isLastRow  ? _medium : _thin,
            left:   isLeftEdge ? _medium : _thin,
            right:  isRightEdge ? _medium : _thin,
        };
    }


    // =====================================================================
    //  EXPORT SCHEDULE AS EXCEL — Dispatch
    // =====================================================================
    async function exportScheduleXlsx(options) {
        var groups = groupEntriesByProduct();
        var hasMs = groups["mini-splits"] && groups["mini-splits"].length > 0;
        var hasMps = groups["multi-position"] && groups["multi-position"].length > 0;
        var hasGp = groups["gas-packs"] && groups["gas-packs"].length > 0;

        // Return array of { name, blob } for ZIP bundle
        if (options && options.returnBlobs) {
            var blobs = [];
            if (hasMs) {
                var msBlob = await exportMsScheduleXlsx({ returnBlob: true, entries: groups["mini-splits"] });
                if (msBlob) blobs.push({ name: "Mini Split Schedule.xlsx", blob: msBlob });
            }
            if (hasMps) {
                var mpsBlob = await exportMpsScheduleXlsx({ returnBlob: true, entries: groups["multi-position"] });
                if (mpsBlob) blobs.push({ name: "Multi Position Split Schedule.xlsx", blob: mpsBlob });
            }
            if (hasGp) {
                var gpBlob = await exportGpScheduleXlsx({ returnBlob: true, entries: groups["gas-packs"] });
                if (gpBlob) blobs.push({ name: "Gas Pack RTU Schedule.xlsx", blob: gpBlob });
            }
            return blobs;
        }

        // Return single blob (legacy)
        if (options && options.returnBlob) {
            if (hasGp && !hasMs && !hasMps) return exportGpScheduleXlsx(options);
            if (hasMps && !hasMs) return exportMpsScheduleXlsx(options);
            return exportMsScheduleXlsx(options);
        }

        // Direct download — download each product separately
        if (hasMs) await exportMsScheduleXlsx({ entries: groups["mini-splits"] });
        if (hasMps) await exportMpsScheduleXlsx({ entries: groups["multi-position"] });
        if (hasGp) await exportGpScheduleXlsx({ entries: groups["gas-packs"] });
    }


    // =====================================================================
    //  MINI SPLITS — EXCEL EXPORT
    // =====================================================================
    async function exportMsScheduleXlsx(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        if (typeof ExcelJS === "undefined") {
            Project.showToast("ExcelJS library not loaded", "toast-danger"); return;
        }

        Project.showToast("Generating Excel schedule…", "toast-success");

        try {
            var resp = await fetch(TEMPLATE_PATHS["mini-splits"]);
            if (!resp.ok) throw new Error("Template not found");
            var buf = await resp.arrayBuffer();
            var wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf);
            var tws = wb.getWorksheet(1);
            var styles = extractStyles(tws);
            var colWidths = [];
            for (var ci = 1; ci <= 17; ci++) {
                var col = tws.getColumn(ci);
                colWidths.push(col.width || 8.43);
            }
            var templateId = tws.id;
            wb.removeWorksheet(templateId);

            var ws = wb.addWorksheet("Split System Schedule", {
                pageSetup: { orientation: "landscape", paperSize: 17, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            for (var wi = 0; wi < colWidths.length; wi++) ws.getColumn(wi + 1).width = colWidths[wi];

            var row = 1;

            // TITLE
            ws.mergeCells(row, 2, row, 17);
            var titleCell = ws.getCell(row, 2);
            titleCell.value = "SPLIT SYSTEM SCHEDULE";
            titleCell.font = styles.title.font;
            titleCell.alignment = styles.title.alignment;
            for (var tc = 2; tc <= 17; tc++) {
                var tBdr = { top: _medium, bottom: _medium };
                if (tc === 2) tBdr.left = _medium;
                if (tc === 17) tBdr.right = _medium;
                ws.getCell(row, tc).border = tBdr;
            }
            ws.getCell(row, 1).border = { right: _medium };
            ws.getRow(row).height = 22;
            row++;

            // INDOOR UNIT LABEL
            ws.mergeCells(row, 2, row, 17);
            var iduLabelCell = ws.getCell(row, 2);
            iduLabelCell.value = "INDOOR UNIT";
            iduLabelCell.font = styles.sectionLabel.font;
            iduLabelCell.alignment = styles.sectionLabel.alignment;
            for (var sc = 2; sc <= 17; sc++) {
                var sBdr = { top: _medium, bottom: _medium };
                if (sc === 2) sBdr.left = _medium;
                if (sc === 17) sBdr.right = _medium;
                ws.getCell(row, sc).border = sBdr;
            }
            ws.getCell(row, 1).border = { right: _medium };
            ws.getRow(row).height = 20;
            row++;

            // INDOOR HEADERS
            var h1 = row, h2 = row + 1;
            ws.mergeCells(h1, 2, h2, 2); applyStyle(ws.getCell(h1, 2), "SYMBOL", styles.headerOuter);
            ws.mergeCells(h1, 3, h2, 3); applyStyle(ws.getCell(h1, 3), "SYMBOL\n(OUTDOOR UNIT)", styles.headerInnerWrap);
            ws.mergeCells(h1, 4, h2, 4); applyStyle(ws.getCell(h1, 4), "CFM", styles.headerInner);
            ws.mergeCells(h1, 5, h1, 8); applyStyle(ws.getCell(h1, 5), "COOLING CAPACITY", styles.headerInner);
            ws.mergeCells(h1, 9, h1, 10); applyStyle(ws.getCell(h1, 9), "HEAT PUMP HEATING CAPACITY", styles.headerInner);
            ws.mergeCells(h1, 11, h2, 11); applyStyle(ws.getCell(h1, 11), "OPERATING\nWEIGHT", styles.headerInnerWrap);
            ws.mergeCells(h1, 12, h2, 12); applyStyle(ws.getCell(h1, 12), "INDOOR UNIT\nTYPE", styles.headerInnerWrap);
            ws.mergeCells(h1, 13, h1, 15); applyStyle(ws.getCell(h1, 13), "ELECTRICAL", styles.headerInner);
            applyStyle(ws.getCell(h1, 16), "MANUFACTURER", styles.headerInner);
            ws.mergeCells(h1, 17, h2, 17); applyStyle(ws.getCell(h1, 17), "NOTES", styles.headerOuter);
            applyStyle(ws.getCell(h2, 5), "EDB", styles.headerSub);
            applyStyle(ws.getCell(h2, 6), "EWB", styles.headerSub);
            applyStyle(ws.getCell(h2, 7), "TOTAL\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 8), "SENSIBLE\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 9), "EDB", styles.headerSub);
            applyStyle(ws.getCell(h2, 10), "TOTAL\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 13), "Voltage", styles.headerSub);
            applyStyle(ws.getCell(h2, 14), "MCA", styles.headerSub);
            applyStyle(ws.getCell(h2, 15), "MOP", styles.headerSub);
            applyStyle(ws.getCell(h2, 16), "DAIKIN", styles.headerSub);
            ws.getRow(h1).height = 16; ws.getRow(h2).height = 31;
            row = h2 + 1;

            // INDOOR DATA ROWS
            var totalIndoorRows = 0;
            for (var ci2 = 0; ci2 < entries.length; ci2++) { var cSys = DataLoader.getSystemById(entries[ci2].systemId); if (cSys) totalIndoorRows += cSys.indoorUnits.length; }
            var indoorRowIndex = 0;
            for (var ei = 0; ei < entries.length; ei++) {
                var entry = entries[ei];
                var sys = DataLoader.getSystemById(entry.systemId);
                if (!sys) continue;
                for (var j = 0; j < sys.indoorUnits.length; j++) {
                    var idu = sys.indoorUnits[j];
                    var r = row;
                    var iduTag = (j < entry.iduTags.length) ? entry.iduTags[j] : "IDU-";
                    var isFirst = (indoorRowIndex === 0); var isLast = (indoorRowIndex === totalIndoorRows - 1);
                    applyDataCell(ws.getCell(r, 2), iduTag, styles, isFirst, isLast, true, false);
                    applyDataCell(ws.getCell(r, 3), entry.oduTag || "ODU-", styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 4), idu.cfm, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 5), idu.coolingEdb, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 6), idu.coolingEwb, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 7), idu.coolingTotal, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 8), idu.coolingSensible, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 9), idu.heatingEdb, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 10), idu.heatingTotal, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 11), idu.weight, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 12), idu.type || "", styles, isFirst, isLast, false, false);
                    if (idu.poweredFromOutdoor) {
                        ws.mergeCells(r, 13, r, 15);
                        applyDataCell(ws.getCell(r, 13), "Indoor Powered From Outdoor Unit", styles, isFirst, isLast, false, false);
                    } else {
                        applyDataCell(ws.getCell(r, 13), idu.voltage || "", styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 14), idu.mca, styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 15), idu.mop, styles, isFirst, isLast, false, false);
                    }
                    applyDataCell(ws.getCell(r, 16), idu.manufacturer || "", styles, isFirst, isLast, false, false);
                    var accVal = (entry.iduAccessories && j < entry.iduAccessories.length) ? (entry.iduAccessories[j] || "") : "";
                    applyDataCell(ws.getCell(r, 17), accVal, styles, isFirst, isLast, false, true);
                    indoorRowIndex++; row++;
                }
            }
            ws.getRow(row - 1).height = 15.75;

            // OUTDOOR UNIT LABEL
            ws.mergeCells(row, 2, row, 13);
            var oduLabelCell = ws.getCell(row, 2);
            oduLabelCell.value = "OUTDOOR UNIT";
            oduLabelCell.font = styles.sectionLabel.font;
            oduLabelCell.alignment = styles.sectionLabel.alignment;
            for (var oc = 2; oc <= 13; oc++) {
                var oBdr = { top: _medium, bottom: _medium };
                if (oc === 2) oBdr.left = _medium; if (oc === 13) oBdr.right = _medium;
                ws.getCell(row, oc).border = oBdr;
            }
            ws.getCell(row, 1).border = { right: _medium };
            ws.getRow(row).height = 20; row++;

            // OUTDOOR HEADERS
            var oh1 = row, oh2 = row + 1;
            ws.mergeCells(oh1, 2, oh2, 2); applyStyle(ws.getCell(oh1, 2), "SYMBOL", styles.headerOuter);
            ws.mergeCells(oh1, 3, oh2, 3); applyStyle(ws.getCell(oh1, 3), "OA AMBIENT\n(COOLING)", styles.headerInnerWrap);
            ws.mergeCells(oh1, 4, oh2, 4); applyStyle(ws.getCell(oh1, 4), "OA AMBIENT\n(HEATING)", styles.headerInnerWrap);
            ws.mergeCells(oh1, 5, oh2, 5); applyStyle(ws.getCell(oh1, 5), "OPERATING\nWEIGHT", styles.headerInnerWrap);
            ws.mergeCells(oh1, 6, oh2, 6); applyStyle(ws.getCell(oh1, 6), "SEER2/EER2/\nHSPF2", styles.headerInnerWrap);
            ws.mergeCells(oh1, 7, oh1, 9); applyStyle(ws.getCell(oh1, 7), "ELECTRICAL", styles.headerInner);
            applyStyle(ws.getCell(oh1, 10), "MANUFACTURER", styles.headerInner);
            ws.mergeCells(oh1, 11, oh2, 11); applyStyle(ws.getCell(oh1, 11), "REFRIGERANT", styles.headerInnerWrap);
            ws.mergeCells(oh1, 12, oh2, 12); applyStyle(ws.getCell(oh1, 12), "MAX ALLOWABLE\nLINE-SET LENGTHS", styles.headerInnerWrap);
            ws.mergeCells(oh1, 13, oh2, 13); applyStyle(ws.getCell(oh1, 13), "NOTES", styles.headerOuterOdu);
            applyStyle(ws.getCell(oh2, 7), "Voltage", styles.headerSub);
            applyStyle(ws.getCell(oh2, 8), "MCA", styles.headerSub);
            applyStyle(ws.getCell(oh2, 9), "MOP", styles.headerSub);
            applyStyle(ws.getCell(oh2, 10), "DAIKIN", styles.headerSub);
            ws.getRow(oh1).height = 16; ws.getRow(oh2).height = 16;
            row = oh2 + 1;

            // OUTDOOR DATA ROWS
            var totalOutdoorRows = entries.length; var outdoorRowIndex = 0;
            for (var oi = 0; oi < entries.length; oi++) {
                var oEntry = entries[oi]; var oSys = DataLoader.getSystemById(oEntry.systemId);
                if (!oSys) continue; var odu = oSys.outdoorUnit;
                var oIsFirst = (outdoorRowIndex === 0); var oIsLast = (outdoorRowIndex === totalOutdoorRows - 1);
                applyDataCell(ws.getCell(row, 2), oEntry.oduTag || "ODU-", styles, oIsFirst, oIsLast, true, false);
                applyDataCell(ws.getCell(row, 3), odu.coolingAmbient, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 4), odu.heatingAmbient, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 5), odu.weight, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 6), odu.seer || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 7), odu.voltage || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 8), odu.mca, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 9), odu.mop, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 10), odu.manufacturer || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 11), odu.refrigerant || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 12), odu.lineSet || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 13), oEntry.outdoorAccessories || "", styles, oIsFirst, oIsLast, false, true);
                outdoorRowIndex++; row++;
            }
            ws.getRow(row - 1).height = 15.75;

            // NOTES SECTION
            writeAccessoriesNotes(ws, row, styles, "mini-splits");

            // GENERATE
            var buffer = await wb.xlsx.writeBuffer();
            var blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            if (options && options.returnBlob) return blob;
            Project.downloadBlob(blob, "Mini Split Schedule.xlsx");
            Project.showToast("Schedule exported as Excel", "toast-success");
        } catch (err) {
            console.error("[Export] Excel generation failed:", err);
            Project.showToast("Excel export failed — see console", "toast-danger");
        }
    }


    // =====================================================================
    //  MULTI POSITION SPLITS — EXCEL EXPORT
    // =====================================================================
    async function exportMpsScheduleXlsx(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        if (typeof ExcelJS === "undefined") {
            Project.showToast("ExcelJS library not loaded", "toast-danger"); return;
        }

        Project.showToast("Generating Excel schedule…", "toast-success");

        try {
            var resp = await fetch(TEMPLATE_PATHS["multi-position"]);
            if (!resp.ok) throw new Error("MPS Template not found");
            var buf = await resp.arrayBuffer();
            var wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf);
            var tws = wb.getWorksheet(1);
            var styles = extractStyles(tws);
            var colWidths = [];
            for (var ci = 1; ci <= 19; ci++) {
                var col = tws.getColumn(ci);
                colWidths.push(col.width || 8.43);
            }
            var templateId = tws.id;
            wb.removeWorksheet(templateId);

            var ws = wb.addWorksheet("Multi Position Split Schedule", {
                pageSetup: { orientation: "landscape", paperSize: 17, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            for (var wi = 0; wi < colWidths.length; wi++) ws.getColumn(wi + 1).width = colWidths[wi];

            var row = 1;

            // TITLE
            ws.mergeCells(row, 2, row, 19);
            var titleCell = ws.getCell(row, 2);
            titleCell.value = "MULTI POSITION SPLIT SYSTEM SCHEDULE";
            titleCell.font = styles.title.font;
            titleCell.alignment = styles.title.alignment;
            for (var tc = 2; tc <= 19; tc++) {
                var tBdr = { top: _medium, bottom: _medium };
                if (tc === 2) tBdr.left = _medium;
                if (tc === 19) tBdr.right = _medium;
                ws.getCell(row, tc).border = tBdr;
            }
            ws.getRow(row).height = 22; row++;

            // INDOOR AIR HANDLING UNIT LABEL
            ws.mergeCells(row, 2, row, 19);
            var iduLabelCell = ws.getCell(row, 2);
            iduLabelCell.value = "INDOOR AIR HANDLING UNIT";
            iduLabelCell.font = styles.sectionLabel.font;
            iduLabelCell.alignment = styles.sectionLabel.alignment;
            for (var sc = 2; sc <= 19; sc++) {
                var sBdr = { top: _medium, bottom: _medium };
                if (sc === 2) sBdr.left = _medium;
                if (sc === 19) sBdr.right = _medium;
                ws.getCell(row, sc).border = sBdr;
            }
            ws.getRow(row).height = 20; row++;

            // INDOOR HEADERS (rows 3-4)
            var h1 = row, h2 = row + 1;
            ws.mergeCells(h1, 2, h2, 2); applyStyle(ws.getCell(h1, 2), "TAG", styles.headerOuter);
            ws.mergeCells(h1, 3, h2, 3); applyStyle(ws.getCell(h1, 3), "MODEL\n(DAIKIN)", styles.headerInnerWrap);
            ws.mergeCells(h1, 4, h1, 6); applyStyle(ws.getCell(h1, 4), "SUPPLY FAN", styles.headerInner);
            ws.mergeCells(h1, 7, h1, 11); applyStyle(ws.getCell(h1, 7), "COOLING", styles.headerInner);
            ws.mergeCells(h1, 12, h2, 12); applyStyle(ws.getCell(h1, 12), "HEAT PUMP\nTOTAL CAPACITY", styles.headerInnerWrap);
            ws.mergeCells(h1, 13, h1, 14); applyStyle(ws.getCell(h1, 13), "AUX. ELECTRIC HEAT", styles.headerInner);
            ws.mergeCells(h1, 15, h1, 17); applyStyle(ws.getCell(h1, 15), "ELECTRICAL DATA", styles.headerInner);
            ws.mergeCells(h1, 18, h2, 18); applyStyle(ws.getCell(h1, 18), "WEIGHT", styles.headerInnerWrap);
            ws.mergeCells(h1, 19, h2, 19); applyStyle(ws.getCell(h1, 19), "NOTES", styles.headerOuter);
            applyStyle(ws.getCell(h2, 4), "AIRFLOW\n(CFM)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 5), "MOTOR\n(HP)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 6), "MOTOR\nTYPE", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 7), "EAT\n(DB)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 8), "EAT\n(WB)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 9), "LAT\n(DB)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 10), "TOTAL\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 11), "SENSIBLE\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 13), "kW", styles.headerSub);
            applyStyle(ws.getCell(h2, 14), "TEMPERATURE\nRISE (DB)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 15), "VOLTAGE\n/ PHASE", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 16), "MCA", styles.headerSub);
            applyStyle(ws.getCell(h2, 17), "MOP", styles.headerSub);
            ws.getRow(h1).height = 16; ws.getRow(h2).height = 31;
            row = h2 + 1;

            // INDOOR DATA ROWS
            var totalRows = entries.length;
            for (var ei = 0; ei < entries.length; ei++) {
                var entry = entries[ei];
                var sys = DataLoader.getSystemById(entry.systemId);
                if (!sys) continue;
                var idu = sys.indoorUnits[0];
                var r = row;
                var iduTag = (entry.iduTags.length > 0) ? entry.iduTags[0] : "AHU-";
                var isFirst = (ei === 0); var isLast = (ei === totalRows - 1);

                applyDataCell(ws.getCell(r, 2), iduTag, styles, isFirst, isLast, true, false);
                applyDataCell(ws.getCell(r, 3), idu.model || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 4), idu.airflow, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 5), idu.motorHp, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 6), idu.motorType || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 7), idu.coolingEatDb, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 8), idu.coolingEatWb, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 9), idu.coolingLatDb, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 10), idu.coolingTotal, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 11), idu.coolingSensible, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 12), idu.heatPumpTotalCapacity, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 13), idu.auxHeatKw || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 14), idu.auxHeatTempRise || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 15), idu.voltage || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 16), idu.mca, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 17), idu.mop, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 18), idu.weight, styles, isFirst, isLast, false, false);
                var accVal = (entry.iduAccessories && entry.iduAccessories.length > 0) ? (entry.iduAccessories[0] || "") : "";
                applyDataCell(ws.getCell(r, 19), accVal, styles, isFirst, isLast, false, true);
                row++;
            }
            ws.getRow(row - 1).height = 15.75;

            // OUTDOOR CONDENSING UNIT LABEL
            ws.mergeCells(row, 2, row, 15);
            var oduLabelCell2 = ws.getCell(row, 2);
            oduLabelCell2.value = "OUTDOOR CONDENSING UNIT";
            oduLabelCell2.font = styles.sectionLabel.font;
            oduLabelCell2.alignment = styles.sectionLabel.alignment;
            for (var oc = 2; oc <= 15; oc++) {
                var oBdr = { top: _medium, bottom: _medium };
                if (oc === 2) oBdr.left = _medium; if (oc === 15) oBdr.right = _medium;
                ws.getCell(row, oc).border = oBdr;
            }
            ws.getRow(row).height = 20; row++;

            // OUTDOOR HEADERS
            var oh1 = row, oh2 = row + 1;
            ws.mergeCells(oh1, 2, oh2, 2); applyStyle(ws.getCell(oh1, 2), "TAG", styles.headerOuter);
            ws.mergeCells(oh1, 3, oh2, 3); applyStyle(ws.getCell(oh1, 3), "MODEL\n(DAIKIN)", styles.headerInnerWrap);
            ws.mergeCells(oh1, 4, oh1, 6); applyStyle(ws.getCell(oh1, 4), "HEAT PUMP HEATING DATA", styles.headerInner);
            ws.mergeCells(oh1, 7, oh1, 9); applyStyle(ws.getCell(oh1, 7), "ELECTRICAL DATA", styles.headerInner);
            ws.mergeCells(oh1, 10, oh2, 10); applyStyle(ws.getCell(oh1, 10), "OUTDOOR\nAMBIENT\n(COOLING)", styles.headerInnerWrap);
            ws.mergeCells(oh1, 11, oh2, 11); applyStyle(ws.getCell(oh1, 11), "REFRIGERANT", styles.headerInnerWrap);
            ws.mergeCells(oh1, 12, oh2, 12); applyStyle(ws.getCell(oh1, 12), "EFFICIENCY", styles.headerInnerWrap);
            ws.mergeCells(oh1, 13, oh2, 13); applyStyle(ws.getCell(oh1, 13), "WEIGHT", styles.headerInnerWrap);
            ws.mergeCells(oh1, 14, oh2, 14); applyStyle(ws.getCell(oh1, 14), "COMPRESSOR\nSTAGES", styles.headerInnerWrap);
            ws.mergeCells(oh1, 15, oh2, 15); applyStyle(ws.getCell(oh1, 15), "NOTES", styles.headerOuterOdu || styles.headerOuter);
            applyStyle(ws.getCell(oh2, 4), "OUTDOOR\nAMBIENT (DB)", styles.headerSubWrap);
            applyStyle(ws.getCell(oh2, 5), "TOTAL\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(oh2, 6), "EFFICIENCY", styles.headerSub);
            applyStyle(ws.getCell(oh2, 7), "VOLTAGE\n/ PHASE", styles.headerSubWrap);
            applyStyle(ws.getCell(oh2, 8), "MCA", styles.headerSub);
            applyStyle(ws.getCell(oh2, 9), "MOP", styles.headerSub);
            ws.getRow(oh1).height = 16; ws.getRow(oh2).height = 16;
            row = oh2 + 1;

            // OUTDOOR DATA ROWS
            for (var oi = 0; oi < entries.length; oi++) {
                var oEntry = entries[oi];
                var oSys = DataLoader.getSystemById(oEntry.systemId);
                if (!oSys) continue;
                var odu = oSys.outdoorUnit;
                var oIsFirst = (oi === 0); var oIsLast = (oi === entries.length - 1);

                applyDataCell(ws.getCell(row, 2), oEntry.oduTag || "CU-", styles, oIsFirst, oIsLast, true, false);
                applyDataCell(ws.getCell(row, 3), odu.model || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 4), odu.heatingAmbient, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 5), odu.heatingTotal, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 6), odu.heatingEfficiency || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 7), odu.voltage || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 8), odu.mca, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 9), odu.mop, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 10), odu.coolingAmbient, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 11), odu.refrigerant || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 12), odu.efficiency || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 13), odu.weight, styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 14), odu.compressorStages || "", styles, oIsFirst, oIsLast, false, false);
                applyDataCell(ws.getCell(row, 15), oEntry.outdoorAccessories || "", styles, oIsFirst, oIsLast, false, true);
                row++;
            }
            ws.getRow(row - 1).height = 15.75;

            // NOTES SECTION
            writeAccessoriesNotes(ws, row, styles, "multi-position");

            // GENERATE
            var buffer = await wb.xlsx.writeBuffer();
            var blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            if (options && options.returnBlob) return blob;
            Project.downloadBlob(blob, "Multi Position Split Schedule.xlsx");
            Project.showToast("Schedule exported as Excel", "toast-success");
        } catch (err) {
            console.error("[Export] MPS Excel generation failed:", err);
            Project.showToast("Excel export failed — see console", "toast-danger");
        }
    }


    // =====================================================================
    //  NOTES SECTION WRITER (shared)
    // =====================================================================
    function writeAccessoriesNotes(ws, row, styles, productKey) {
        var pNotes = Project.getProductActiveNotes(productKey);
        var activeIndoor = pNotes.indoor.length > 0 ? pNotes.indoor : Project.getActiveIndoorNotes();
        var activeOutdoor = pNotes.outdoor.length > 0 ? pNotes.outdoor : Project.getActiveOutdoorNotes();
        var maxNotes = Math.max(activeIndoor.length, activeOutdoor.length, 0);

        if (maxNotes > 0) {
            applyStyle(ws.getCell(row, 2), "NOTES (INDOOR UNIT):", styles.notesHeader);
            ws.getCell(row, 2).border = { top: _medium, left: _medium };
            for (var nh = 3; nh <= 7; nh++) ws.getCell(row, nh).border = { top: _medium };
            ws.getCell(row, 8).border = { top: _medium, right: _medium };
            applyStyle(ws.getCell(row, 9), "NOTES (OUTDOOR UNIT):", styles.notesHeader);
            ws.getCell(row, 9).border = { top: _medium, left: _medium };
            for (var nh2 = 10; nh2 <= 12; nh2++) ws.getCell(row, nh2).border = { top: _medium };
            ws.getCell(row, 13).border = { top: _medium, right: _medium };
            row++;
            for (var ni = 0; ni < maxNotes; ni++) {
                if (ni < activeIndoor.length) {
                    applyStyle(ws.getCell(row, 2), (ni + 1) + "-", styles.notesNum);
                    applyStyle(ws.getCell(row, 3), activeIndoor[ni], styles.notesText);
                }
                ws.getCell(row, 2).border = { left: _medium }; ws.getCell(row, 8).border = { right: _medium };
                if (ni < activeOutdoor.length) {
                    applyStyle(ws.getCell(row, 9), (ni + 1) + "-", styles.notesNum);
                    applyStyle(ws.getCell(row, 10), activeOutdoor[ni], styles.notesText);
                }
                ws.getCell(row, 9).border = { left: _medium }; ws.getCell(row, 13).border = { right: _medium };
                row++;
            }
            ws.getCell(row, 2).border = { bottom: _medium, left: _medium };
            for (var nb = 3; nb <= 7; nb++) ws.getCell(row, nb).border = { bottom: _medium };
            ws.getCell(row, 8).border = { bottom: _medium, right: _medium };
            ws.getCell(row, 9).border = { bottom: _medium, left: _medium };
            for (var nb2 = 10; nb2 <= 12; nb2++) ws.getCell(row, nb2).border = { bottom: _medium };
            ws.getCell(row, 13).border = { bottom: _medium, right: _medium };
            ws.getRow(row).height = 15.75;
        }
    }


    // =====================================================================
    //  CELL HELPERS
    // =====================================================================
    function applyDataCell(cell, value, styles, isFirstRow, isLastRow, isLeftEdge, isRightEdge) {
        if (value !== null && value !== undefined) cell.value = value;
        cell.font = styles.data.font;
        cell.alignment = styles.data.alignment;
        cell.border = dataBorder(isFirstRow, isLastRow, isLeftEdge, isRightEdge);
    }


    // =====================================================================
    //  STYLE EXTRACTION
    // =====================================================================
    function extractStyles(tws) {
        var titleCell = tws.getCell("B1");
        var sectionCell = tws.getCell("B2");
        var headerB3 = tws.getCell("B3");
        var headerE3 = tws.getCell("E3") || tws.getCell("D3");
        var headerC3 = tws.getCell("C3");
        var dataC5 = tws.getCell("C5");
        // Try to get notes cells — they may be at different rows for different templates
        var notesB52 = tws.getCell("B52");
        var notesB53 = tws.getCell("B53");
        // Try to get outdoor header cell
        var headerM28 = tws.getCell("M28") || tws.getCell("B28");

        return {
            title: {
                font: cloneObj(titleCell.font),
                alignment: { horizontal: "center", vertical: "middle" },
            },
            sectionLabel: {
                font: cloneObj(sectionCell.font),
                alignment: { horizontal: "center", vertical: "middle" },
            },
            headerOuter: {
                font: cloneObj(headerB3.font),
                alignment: { horizontal: "center", vertical: "middle", wrapText: true },
                border: cloneBorder(headerB3.border),
            },
            headerOuterOdu: {
                font: cloneObj(headerM28 ? headerM28.font : headerB3.font),
                alignment: { horizontal: "center", vertical: "middle", wrapText: true },
                border: cloneBorder(headerM28 ? headerM28.border : headerB3.border),
            },
            headerInner: {
                font: cloneObj(headerE3.font),
                alignment: { horizontal: "center", vertical: "middle" },
                border: cloneBorder(headerE3.border),
            },
            headerInnerWrap: {
                font: cloneObj(headerC3.font),
                alignment: { horizontal: "center", vertical: "middle", wrapText: true },
                border: cloneBorder(headerC3.border),
            },
            headerSub: {
                font: cloneObj(headerE3.font),
                alignment: { horizontal: "center", vertical: "middle" },
                border: { top: _medium, left: _medium, right: _medium },
            },
            headerSubWrap: {
                font: cloneObj(headerC3.font),
                alignment: { horizontal: "center", vertical: "middle", wrapText: true },
                border: { top: _medium, left: _medium, right: _medium },
            },
            data: {
                font: cloneObj(dataC5.font),
                alignment: { horizontal: "center", vertical: "middle" },
            },
            notesHeader: {
                font: cloneObj(notesB52.font),
                alignment: { horizontal: "left", vertical: "bottom" },
            },
            notesNum: {
                font: cloneObj(notesB53.font),
                alignment: { horizontal: "right", vertical: "bottom" },
            },
            notesText: {
                font: cloneObj(notesB53.font),
                alignment: { horizontal: "left", vertical: "bottom" },
            },
        };
    }

    function cloneObj(obj) {
        if (!obj) return {};
        return JSON.parse(JSON.stringify(obj));
    }

    function cloneBorder(border) {
        if (!border) return {};
        var result = {};
        ["top", "bottom", "left", "right"].forEach(function (side) {
            if (border[side]) { result[side] = cloneObj(border[side]); }
        });
        return result;
    }

    function applyStyle(cell, value, style) {
        if (value !== null && value !== undefined) cell.value = value;
        if (style.font) cell.font = style.font;
        if (style.fill) cell.fill = style.fill;
        if (style.alignment) cell.alignment = style.alignment;
        if (style.border) cell.border = style.border;
    }


    // =====================================================================
    //  EXPORT SCHEDULE AS PDF — Dispatch
    // =====================================================================
    function exportSchedulePdf(options) {
        var groups = groupEntriesByProduct();
        var hasMs = groups["mini-splits"] && groups["mini-splits"].length > 0;
        var hasMps = groups["multi-position"] && groups["multi-position"].length > 0;
        var hasGp = groups["gas-packs"] && groups["gas-packs"].length > 0;

        // Return array of { name, blob } for ZIP bundle
        if (options && options.returnBlobs) {
            var blobs = [];
            if (hasMs) {
                var msBlob = exportMsSchedulePdf({ returnBlob: true, entries: groups["mini-splits"] });
                if (msBlob) blobs.push({ name: "Mini Split Schedule.pdf", blob: msBlob });
            }
            if (hasMps) {
                var mpsBlob = exportMpsSchedulePdf({ returnBlob: true, entries: groups["multi-position"] });
                if (mpsBlob) blobs.push({ name: "Multi Position Split Schedule.pdf", blob: mpsBlob });
            }
            if (hasGp) {
                var gpBlob = exportGpSchedulePdf({ returnBlob: true, entries: groups["gas-packs"] });
                if (gpBlob) blobs.push({ name: "Gas Pack RTU Schedule.pdf", blob: gpBlob });
            }
            return blobs;
        }

        // Return single blob (legacy)
        if (options && options.returnBlob) {
            if (hasGp && !hasMs && !hasMps) return exportGpSchedulePdf(options);
            if (hasMps && !hasMs) return exportMpsSchedulePdf(options);
            return exportMsSchedulePdf(options);
        }

        // Direct download — download each product separately
        if (hasMs) exportMsSchedulePdf({ entries: groups["mini-splits"] });
        if (hasMps) exportMpsSchedulePdf({ entries: groups["multi-position"] });
        if (hasGp) exportGpSchedulePdf({ entries: groups["gas-packs"] });
    }


    // =====================================================================
    //  MINI SPLITS — PDF EXPORT
    // =====================================================================
    function exportMsSchedulePdf(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        if (typeof window.jspdf === "undefined" && typeof jsPDF === "undefined") {
            Project.showToast("jsPDF library not loaded", "toast-danger"); return;
        }

        var C = (typeof window.jspdf !== "undefined") ? window.jspdf.jsPDF : jsPDF;
        var doc = new C({ orientation: "landscape", unit: "pt", format: "tabloid" });
        var pw = doc.internal.pageSize.getWidth();
        var lm = 20; var M = 1.0; var T = 0.25;

        // Indoor column widths
        var iColWidths = [46,56,30,28,28,52,52,28,52,42,62,220,28,28,74,46];
        var iTableW = 0; for (var iw = 0; iw < iColWidths.length; iw++) iTableW += iColWidths[iw];
        var iColW = {}; for (var iw2 = 0; iw2 < iColWidths.length; iw2++) iColW[iw2] = iColWidths[iw2];

        var iHeadRow1 = [
            { content: "SYMBOL", rowSpan: 2 },
            { content: "SYMBOL\n(OUTDOOR\nUNIT)", rowSpan: 2 },
            { content: "CFM", rowSpan: 2 },
            { content: "COOLING CAPACITY", colSpan: 4 },
            { content: "HEAT PUMP HEATING CAPACITY", colSpan: 2 },
            { content: "OPERATING\nWEIGHT", rowSpan: 2 },
            { content: "INDOOR UNIT\nTYPE", rowSpan: 2 },
            { content: "ELECTRICAL", colSpan: 3 },
            { content: "MANUFACTURER", rowSpan: 1 },
            { content: "NOTES", rowSpan: 2 },
        ];
        var iHeadRow2 = ["EDB","EWB","TOTAL\nCAPACITY","SENSIBLE\nCAPACITY","EDB","TOTAL\nCAPACITY","Voltage","MCA","MOP","DAIKIN"];

        var iduRows = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i], s = DataLoader.getSystemById(e.systemId);
            if (!s) continue;
            for (var j = 0; j < s.indoorUnits.length; j++) {
                var u = s.indoorUnits[j];
                var iduAcc = (e.iduAccessories && j < e.iduAccessories.length) ? (e.iduAccessories[j] || "") : "";
                var row = [];
                row.push(e.iduTags[j] || "IDU-"); row.push(e.oduTag || "ODU-"); row.push(fp(u.cfm));
                row.push(fp(u.coolingEdb)); row.push(fp(u.coolingEwb)); row.push(fp(u.coolingTotal)); row.push(fp(u.coolingSensible));
                row.push(fp(u.heatingEdb)); row.push(fp(u.heatingTotal)); row.push(fp(u.weight));
                row.push(u.type || "");
                if (u.poweredFromOutdoor) { row.push({ content: "Indoor Powered From Outdoor Unit", colSpan: 3 }); }
                else { row.push(u.voltage || ""); row.push(fp(u.mca)); row.push(fp(u.mop)); }
                row.push(u.manufacturer || ""); row.push(iduAcc);
                iduRows.push(row);
            }
        }

        // Outdoor columns
        var oColWidths = [50,54,54,48,84,50,32,32,80,48,104,64];
        var oTableW = 0; for (var ow = 0; ow < oColWidths.length; ow++) oTableW += oColWidths[ow];
        var oColW = {}; for (var ow2 = 0; ow2 < oColWidths.length; ow2++) oColW[ow2] = oColWidths[ow2];

        var oHeadRow1 = [
            { content: "SYMBOL", rowSpan: 2 },
            { content: "OA AMBIENT\n(COOLING)", rowSpan: 2 },
            { content: "OA AMBIENT\n(HEATING)", rowSpan: 2 },
            { content: "OPERATING\nWEIGHT", rowSpan: 2 },
            { content: "SEER2/EER2/\nHSPF2", rowSpan: 2 },
            { content: "ELECTRICAL", colSpan: 3 },
            { content: "MANUFACTURER", rowSpan: 1 },
            { content: "REFRIGERANT", rowSpan: 2 },
            { content: "MAX ALLOWABLE\nLINE-SET LENGTHS", rowSpan: 2 },
            { content: "NOTES", rowSpan: 2 },
        ];
        var oHeadRow2 = ["Voltage","MCA","MOP","DAIKIN"];

        var oduRows = [];
        for (var k = 0; k < entries.length; k++) {
            var oe = entries[k], os = DataLoader.getSystemById(oe.systemId);
            if (!os) continue; var od = os.outdoorUnit;
            oduRows.push([oe.oduTag || "ODU-", fp(od.coolingAmbient), fp(od.heatingAmbient), fp(od.weight), od.seer || "",
                od.voltage || "", fp(od.mca), fp(od.mop), od.manufacturer || "", od.refrigerant || "", od.lineSet || "", oe.outdoorAccessories || ""]);
        }

        var curY = 20;
        renderPdfSchedule(doc, "SPLIT SYSTEM SCHEDULE", "INDOOR UNIT", "OUTDOOR UNIT",
            iHeadRow1, iHeadRow2, iduRows, iColW, iTableW,
            oHeadRow1, oHeadRow2, oduRows, oColW, oTableW,
            lm, M, T, pw, curY, "mini-splits");

        if (options && options.returnBlob) return doc.output("blob");
        doc.save("Mini Split Schedule.pdf");
        Project.showToast("Schedule exported as PDF", "toast-success");
    }


    // =====================================================================
    //  MULTI POSITION SPLITS — PDF EXPORT
    // =====================================================================
    function exportMpsSchedulePdf(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        if (typeof window.jspdf === "undefined" && typeof jsPDF === "undefined") {
            Project.showToast("jsPDF library not loaded", "toast-danger"); return;
        }

        var C = (typeof window.jspdf !== "undefined") ? window.jspdf.jsPDF : jsPDF;
        var doc = new C({ orientation: "landscape", unit: "pt", format: "tabloid" });
        var pw = doc.internal.pageSize.getWidth();
        var lm = 20; var M = 1.0; var T = 0.25;

        // Indoor AHU columns
        var iColWidths = [40,70,36,30,52,28,28,28,48,48,48,28,40,40,28,28,36,40];
        var iTableW = 0; for (var iw = 0; iw < iColWidths.length; iw++) iTableW += iColWidths[iw];
        var iColW = {}; for (var iw2 = 0; iw2 < iColWidths.length; iw2++) iColW[iw2] = iColWidths[iw2];

        var iHeadRow1 = [
            { content: "TAG", rowSpan: 2 },
            { content: "MODEL\n(DAIKIN)", rowSpan: 2 },
            { content: "SUPPLY FAN", colSpan: 3 },
            { content: "COOLING", colSpan: 5 },
            { content: "HEAT PUMP\nTOTAL CAP.", rowSpan: 2 },
            { content: "AUX. ELECTRIC\nHEAT", colSpan: 2 },
            { content: "ELECTRICAL DATA", colSpan: 3 },
            { content: "WEIGHT", rowSpan: 2 },
            { content: "ACC.", rowSpan: 2 },
        ];
        var iHeadRow2 = ["CFM","HP","MOTOR\nTYPE","EAT\n(DB)","EAT\n(WB)","LAT\n(DB)","TOTAL\nCAP.","SENSIBLE\nCAP.","kW","TEMP\nRISE","V/PH","MCA","MOP"];

        var iduRows = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i], s = DataLoader.getSystemById(e.systemId);
            if (!s) continue;
            var u = s.indoorUnits[0];
            var iduAcc = (e.iduAccessories && e.iduAccessories.length > 0) ? (e.iduAccessories[0] || "") : "";
            iduRows.push([
                e.iduTags[0] || "AHU-", u.model || "",
                fp(u.airflow), fp(u.motorHp), u.motorType || "",
                fp(u.coolingEatDb), fp(u.coolingEatWb), fp(u.coolingLatDb), fp(u.coolingTotal), fp(u.coolingSensible),
                fp(u.heatPumpTotalCapacity),
                u.auxHeatKw || "", u.auxHeatTempRise || "",
                u.voltage || "", fp(u.mca), fp(u.mop),
                fp(u.weight), iduAcc
            ]);
        }

        // Outdoor condensing unit columns
        var oColWidths = [40,70,48,48,52,42,28,28,48,52,80,36,52,40];
        var oTableW = 0; for (var ow = 0; ow < oColWidths.length; ow++) oTableW += oColWidths[ow];
        var oColW = {}; for (var ow2 = 0; ow2 < oColWidths.length; ow2++) oColW[ow2] = oColWidths[ow2];

        var oHeadRow1 = [
            { content: "TAG", rowSpan: 2 },
            { content: "MODEL\n(DAIKIN)", rowSpan: 2 },
            { content: "HEAT PUMP\nHEATING DATA", colSpan: 3 },
            { content: "ELECTRICAL DATA", colSpan: 3 },
            { content: "OA AMBIENT\n(COOLING)", rowSpan: 2 },
            { content: "REFRIG.", rowSpan: 2 },
            { content: "EFFICIENCY", rowSpan: 2 },
            { content: "WEIGHT", rowSpan: 2 },
            { content: "COMP.\nSTAGES", rowSpan: 2 },
            { content: "ACC.", rowSpan: 2 },
        ];
        var oHeadRow2 = ["OA\nAMB (DB)","TOTAL\nCAP.","EFF.","V/PH","MCA","MOP"];

        var oduRows = [];
        for (var k = 0; k < entries.length; k++) {
            var oe = entries[k], os = DataLoader.getSystemById(oe.systemId);
            if (!os) continue; var od = os.outdoorUnit;
            oduRows.push([
                oe.oduTag || "CU-", od.model || "",
                fp(od.heatingAmbient), fp(od.heatingTotal), od.heatingEfficiency || "",
                od.voltage || "", fp(od.mca), fp(od.mop),
                fp(od.coolingAmbient), od.refrigerant || "", od.efficiency || "",
                fp(od.weight), od.compressorStages || "", oe.outdoorAccessories || ""
            ]);
        }

        var curY = 20;
        renderPdfSchedule(doc, "MULTI POSITION SPLIT SYSTEM SCHEDULE", "INDOOR AIR HANDLING UNIT", "OUTDOOR CONDENSING UNIT",
            iHeadRow1, iHeadRow2, iduRows, iColW, iTableW,
            oHeadRow1, oHeadRow2, oduRows, oColW, oTableW,
            lm, M, T, pw, curY, "multi-position");

        if (options && options.returnBlob) return doc.output("blob");
        doc.save("Multi Position Split Schedule.pdf");
        Project.showToast("Schedule exported as PDF", "toast-success");
    }


    // =====================================================================
    //  SHARED PDF RENDERING
    // =====================================================================
    function renderPdfSchedule(doc, title, iduLabel, oduLabel,
        iHeadRow1, iHeadRow2, iduRows, iColW, iTableW,
        oHeadRow1, oHeadRow2, oduRows, oColW, oTableW,
        lm, M, T, pw, curY, productKey) {

        // TITLE BAR
        doc.setDrawColor(0); doc.setLineWidth(M);
        doc.rect(lm, curY, iTableW, 18, "S");
        doc.setFontSize(14); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
        doc.text(title, lm + iTableW / 2, curY + 13, { align: "center" });
        curY += 18;

        // INDOOR UNIT LABEL
        doc.setLineWidth(M); doc.rect(lm, curY, iTableW, 16, "S");
        doc.setFontSize(11); doc.setFont("helvetica", "bold");
        doc.text(iduLabel, lm + iTableW / 2, curY + 12, { align: "center" });
        curY += 16;

        // INDOOR TABLE
        var iBodyStartY = null;
        doc.autoTable({
            head: [iHeadRow1, iHeadRow2], body: iduRows, startY: curY, theme: "grid",
            tableWidth: iTableW,
            styles: { fontSize: 6.5, cellPadding: 2, halign: "center", valign: "middle",
                textColor: [0,0,0], overflow: "linebreak", lineWidth: T, lineColor: [0,0,0] },
            headStyles: { fillColor: [255,255,255], textColor: [0,0,0], fontStyle: "bold", fontSize: 6,
                lineWidth: M, lineColor: [0,0,0], overflow: "linebreak" },
            alternateRowStyles: { fillColor: [255,255,255] },
            columnStyles: iColW,
            margin: { left: lm, right: lm },
            didDrawCell: function (data) {
                if (data.section === "body" && data.row.index === 0 && data.column.index === 0) iBodyStartY = data.cell.y;
            },
        });
        var iFinalY = doc.lastAutoTable.finalY;
        if (iBodyStartY !== null) { doc.setDrawColor(0); doc.setLineWidth(M); doc.rect(lm, iBodyStartY, iTableW, iFinalY - iBodyStartY, "S"); }
        curY = iFinalY;

        // OUTDOOR UNIT LABEL
        doc.setDrawColor(0); doc.setLineWidth(M);
        doc.rect(lm, curY, oTableW, 16, "S");
        doc.setFontSize(11); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
        doc.text(oduLabel, lm + oTableW / 2, curY + 12, { align: "center" });
        curY += 16;

        // OUTDOOR TABLE
        var oBodyStartY = null;
        doc.autoTable({
            head: [oHeadRow1, oHeadRow2], body: oduRows, startY: curY, theme: "grid",
            tableWidth: oTableW,
            styles: { fontSize: 6.5, cellPadding: 2, halign: "center", valign: "middle",
                textColor: [0,0,0], overflow: "linebreak", lineWidth: T, lineColor: [0,0,0] },
            headStyles: { fillColor: [255,255,255], textColor: [0,0,0], fontStyle: "bold", fontSize: 6,
                lineWidth: M, lineColor: [0,0,0], overflow: "linebreak" },
            alternateRowStyles: { fillColor: [255,255,255] },
            columnStyles: oColW,
            margin: { left: lm, right: lm },
            didDrawCell: function (data) {
                if (data.section === "body" && data.row.index === 0 && data.column.index === 0) oBodyStartY = data.cell.y;
            },
        });
        var oFinalY = doc.lastAutoTable.finalY;
        if (oBodyStartY !== null) { doc.setDrawColor(0); doc.setLineWidth(M); doc.rect(lm, oBodyStartY, oTableW, oFinalY - oBodyStartY, "S"); }
        curY = oFinalY;

        // NOTES SECTION
        var pNotes = productKey ? Project.getProductActiveNotes(productKey) : { indoor: [], outdoor: [] };
        var aI = pNotes.indoor.length > 0 ? pNotes.indoor : Project.getActiveIndoorNotes();
        var aO = pNotes.outdoor.length > 0 ? pNotes.outdoor : Project.getActiveOutdoorNotes();
        if (aI.length > 0 || aO.length > 0) {
            var maxN = Math.max(aI.length, aO.length);
            var noteLineH = 12; var noteHeaderH = 16;
            var boxH = noteHeaderH + (maxN * noteLineH) + 6;
            var accTotalW = oTableW; var boxW = accTotalW / 2;
            if (curY + boxH > doc.internal.pageSize.getHeight() - 30) { doc.addPage(); curY = 20; }
            doc.setLineWidth(M); doc.setDrawColor(0); doc.rect(lm, curY, boxW, boxH, "S");
            doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
            doc.text("NOTES (INDOOR UNIT):", lm + 4, curY + 12);
            doc.setFont("helvetica", "normal"); doc.setFontSize(7);
            for (var ai = 0; ai < aI.length; ai++) doc.text((ai+1) + "-  " + aI[ai], lm + 8, curY + noteHeaderH + 4 + (ai * noteLineH));
            var oBoxX = lm + boxW;
            doc.setLineWidth(M); doc.rect(oBoxX, curY, boxW, boxH, "S");
            doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
            doc.text("NOTES (OUTDOOR UNIT):", oBoxX + 4, curY + 12);
            doc.setFont("helvetica", "normal"); doc.setFontSize(7);
            for (var ao = 0; ao < aO.length; ao++) doc.text((ao+1) + "-  " + aO[ao], oBoxX + 8, curY + noteHeaderH + 4 + (ao * noteLineH));
        }

        // PAGE FOOTERS
        var pc = doc.internal.getNumberOfPages();
        for (var p = 1; p <= pc; p++) {
            doc.setPage(p); doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.setTextColor(140);
            doc.text("HHpro HVAC — Page " + p + " of " + pc, pw / 2, doc.internal.pageSize.getHeight() - 15, { align: "center" });
        }
    }

    function fp(v) {
        if (v === null || v === undefined || v === "") return "";
        if (typeof v === "number") { if (Number.isInteger(v) && v >= 1000) return v.toLocaleString("en-US"); return v.toString(); }
        return String(v);
    }

    // =====================================================================
    //  EXPORT SCHEDULE AS DXF — Dispatch
    // =====================================================================
    function exportScheduleDxf(options) {
        var groups = groupEntriesByProduct();
        var hasMs = groups["mini-splits"] && groups["mini-splits"].length > 0;
        var hasMps = groups["multi-position"] && groups["multi-position"].length > 0;

        if (options && options.returnBlobs) {
            var blobs = [];
            if (hasMs) {
                var msBlob = exportMsScheduleDxf({ returnBlob: true, entries: groups["mini-splits"] });
                if (msBlob) blobs.push({ name: "Mini Split Schedule.dxf", blob: msBlob });
            }
            if (hasMps) {
                var mpsBlob = exportMpsScheduleDxf({ returnBlob: true, entries: groups["multi-position"] });
                if (mpsBlob) blobs.push({ name: "Multi Position Split Schedule.dxf", blob: mpsBlob });
            }
            return blobs;
        }

        if (options && options.returnBlob) {
            if (hasMps && !hasMs) return exportMpsScheduleDxf(options);
            return exportMsScheduleDxf(options);
        }

        if (hasMs) exportMsScheduleDxf({ entries: groups["mini-splits"] });
        if (hasMps) exportMpsScheduleDxf({ entries: groups["multi-position"] });
    }


    // =====================================================================
    //  MINI SPLITS — DXF EXPORT
    // =====================================================================
    function exportMsScheduleDxf(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;

        var headers = ["SYMBOL","SYMBOL\n(ODU)","CFM","EDB","EWB","TOTAL\nCAP.","SENSIBLE\nCAP.","EDB","TOTAL\nCAP.","OP.\nWEIGHT","INDOOR\nTYPE","VOLTAGE","MCA","MOP","MFG\nDAIKIN","ACC."];
        var colWidths = [14,16,10,8,8,14,14,8,14,12,18,14,8,8,20,14];

        var groupHeaders = [
            { text: "SYMBOL", start: 0, span: 1 },
            { text: "SYMBOL (OUTDOOR UNIT)", start: 1, span: 1 },
            { text: "CFM", start: 2, span: 1 },
            { text: "COOLING CAPACITY", start: 3, span: 4 },
            { text: "HEAT PUMP HEATING", start: 7, span: 2 },
            { text: "OP. WEIGHT", start: 9, span: 1 },
            { text: "INDOOR TYPE", start: 10, span: 1 },
            { text: "ELECTRICAL", start: 11, span: 3 },
            { text: "MFG DAIKIN", start: 14, span: 1 },
            { text: "NOTES", start: 15, span: 1 },
        ];

        var rows = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i], s = DataLoader.getSystemById(e.systemId);
            if (!s) continue;
            for (var j = 0; j < s.indoorUnits.length; j++) {
                var u = s.indoorUnits[j];
                var iduAcc = (e.iduAccessories && j < e.iduAccessories.length) ? (e.iduAccessories[j] || "") : "";
                rows.push([e.iduTags[j] || "IDU-", e.oduTag || "ODU-", fp(u.cfm), fp(u.coolingEdb), fp(u.coolingEwb), fp(u.coolingTotal), fp(u.coolingSensible), fp(u.heatingEdb), fp(u.heatingTotal), fp(u.weight), u.type || "", u.voltage || "", fp(u.mca), fp(u.mop), u.manufacturer || "", iduAcc]);
            }
        }

        // Outdoor
        var oHeaders = ["SYMBOL","OA AMB\n(COOL)","OA AMB\n(HEAT)","OP.\nWEIGHT","SEER2/EER2\n/HSPF2","VOLTAGE","MCA","MOP","MFG\nDAIKIN","REFRIG.","LINE-SET\nLENGTHS","ACC."];
        var oColWidths = [14,14,14,12,22,14,8,8,22,12,28,16];
        var oGroupHeaders = [
            { text: "SYMBOL", start: 0, span: 1 },
            { text: "OA AMBIENT (COOLING)", start: 1, span: 1 },
            { text: "OA AMBIENT (HEATING)", start: 2, span: 1 },
            { text: "OP. WEIGHT", start: 3, span: 1 },
            { text: "SEER2/EER2/HSPF2", start: 4, span: 1 },
            { text: "ELECTRICAL", start: 5, span: 3 },
            { text: "MFG DAIKIN", start: 8, span: 1 },
            { text: "REFRIGERANT", start: 9, span: 1 },
            { text: "LINE-SET LENGTHS", start: 10, span: 1 },
            { text: "NOTES", start: 11, span: 1 },
        ];

        var oRows = [];
        for (var k = 0; k < entries.length; k++) {
            var oe = entries[k], os = DataLoader.getSystemById(oe.systemId);
            if (!os) continue; var od = os.outdoorUnit;
            oRows.push([oe.oduTag || "ODU-", fp(od.coolingAmbient), fp(od.heatingAmbient), fp(od.weight), od.seer || "", od.voltage || "", fp(od.mca), fp(od.mop), od.manufacturer || "", od.refrigerant || "", od.lineSet || "", oe.outdoorAccessories || ""]);
        }

        var pNotes = Project.getProductActiveNotes("mini-splits");
        var aI = pNotes.indoor.length > 0 ? pNotes.indoor : Project.getActiveIndoorNotes();
        var aO = pNotes.outdoor.length > 0 ? pNotes.outdoor : Project.getActiveOutdoorNotes();

        var dxf = renderDxfSchedule("SPLIT SYSTEM SCHEDULE", "INDOOR UNIT",
            groupHeaders, headers, colWidths, rows,
            "OUTDOOR UNIT", oGroupHeaders, oHeaders, oColWidths, oRows,
            aI, aO);

        var blob = new Blob([dxf], { type: "application/dxf" });
        if (options && options.returnBlob) return blob;
        Project.downloadBlob(blob, "Mini Split Schedule.dxf");
        Project.showToast("Schedule exported as DXF", "toast-success");
    }


    // =====================================================================
    //  MULTI POSITION SPLITS — DXF EXPORT
    // =====================================================================
    function exportMpsScheduleDxf(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;

        var headers = ["TAG","MODEL\n(DAIKIN)","CFM","HP","MOTOR\nTYPE","EAT\n(DB)","EAT\n(WB)","LAT\n(DB)","TOTAL\nCAP.","SENSIBLE\nCAP.","HP TOTAL\nCAP.","kW","TEMP\nRISE","VOLTAGE","MCA","MOP","WEIGHT","ACC."];
        var colWidths = [10,18,10,8,16,8,8,8,14,14,14,8,10,12,8,8,10,12];

        var groupHeaders = [
            { text: "TAG", start: 0, span: 1 },
            { text: "MODEL (DAIKIN)", start: 1, span: 1 },
            { text: "SUPPLY FAN", start: 2, span: 3 },
            { text: "COOLING", start: 5, span: 5 },
            { text: "HP TOTAL CAP.", start: 10, span: 1 },
            { text: "AUX. ELECTRIC HEAT", start: 11, span: 2 },
            { text: "ELECTRICAL DATA", start: 13, span: 3 },
            { text: "WEIGHT", start: 16, span: 1 },
            { text: "NOTES", start: 17, span: 1 },
        ];

        var rows = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i], s = DataLoader.getSystemById(e.systemId);
            if (!s) continue;
            var u = s.indoorUnits[0];
            var iduAcc = (e.iduAccessories && e.iduAccessories.length > 0) ? (e.iduAccessories[0] || "") : "";
            rows.push([e.iduTags[0] || "AHU-", u.model || "", fp(u.airflow), fp(u.motorHp), u.motorType || "", fp(u.coolingEatDb), fp(u.coolingEatWb), fp(u.coolingLatDb), fp(u.coolingTotal), fp(u.coolingSensible), fp(u.heatPumpTotalCapacity), u.auxHeatKw || "", u.auxHeatTempRise || "", u.voltage || "", fp(u.mca), fp(u.mop), fp(u.weight), iduAcc]);
        }

        var oHeaders = ["TAG","MODEL\n(DAIKIN)","OA AMB\n(DB)","TOTAL\nCAP.","EFF.","VOLTAGE","MCA","MOP","OA AMB\n(COOL)","REFRIG.","EFFICIENCY","WEIGHT","COMP.\nSTAGES","ACC."];
        var oColWidths = [10,18,12,12,14,12,8,8,12,12,22,10,14,12];
        var oGroupHeaders = [
            { text: "TAG", start: 0, span: 1 },
            { text: "MODEL (DAIKIN)", start: 1, span: 1 },
            { text: "HEAT PUMP HEATING DATA", start: 2, span: 3 },
            { text: "ELECTRICAL DATA", start: 5, span: 3 },
            { text: "OA AMB (COOLING)", start: 8, span: 1 },
            { text: "REFRIGERANT", start: 9, span: 1 },
            { text: "EFFICIENCY", start: 10, span: 1 },
            { text: "WEIGHT", start: 11, span: 1 },
            { text: "COMP. STAGES", start: 12, span: 1 },
            { text: "NOTES", start: 13, span: 1 },
        ];

        var oRows = [];
        for (var k = 0; k < entries.length; k++) {
            var oe = entries[k], os = DataLoader.getSystemById(oe.systemId);
            if (!os) continue; var od = os.outdoorUnit;
            oRows.push([oe.oduTag || "CU-", od.model || "", fp(od.heatingAmbient), fp(od.heatingTotal), od.heatingEfficiency || "", od.voltage || "", fp(od.mca), fp(od.mop), fp(od.coolingAmbient), od.refrigerant || "", od.efficiency || "", fp(od.weight), od.compressorStages || "", oe.outdoorAccessories || ""]);
        }

        var pNotes = Project.getProductActiveNotes("multi-position");
        var aI = pNotes.indoor.length > 0 ? pNotes.indoor : [];
        var aO = pNotes.outdoor.length > 0 ? pNotes.outdoor : [];

        var dxf = renderDxfSchedule("MULTI POSITION SPLIT SYSTEM SCHEDULE", "INDOOR AIR HANDLING UNIT",
            groupHeaders, headers, colWidths, rows,
            "OUTDOOR CONDENSING UNIT", oGroupHeaders, oHeaders, oColWidths, oRows,
            aI, aO);

        var blob = new Blob([dxf], { type: "application/dxf" });
        if (options && options.returnBlob) return blob;
        Project.downloadBlob(blob, "Multi Position Split Schedule.dxf");
        Project.showToast("Schedule exported as DXF", "toast-success");
    }


    // =====================================================================
    //  SHARED DXF RENDERING
    //
    //  Generates a complete DXF string with proper table layout.
    //  Uses LINE entities for borders and MTEXT for cell text.
    //  Scale: 1 unit = 1mm. Text heights in mm.
    // =====================================================================
    function renderDxfSchedule(title, iduLabel,
        iGroupHeaders, iHeaders, iColWidths, iRows,
        oduLabel, oGroupHeaders, oHeaders, oColWidths, oRows,
        accIndoor, accOutdoor) {

        var ROW_H = 8;          // data row height (mm)
        var HDR_H = 10;         // header row height
        var GRP_H = 8;          // group header row height
        var TITLE_H = 12;       // title bar height
        var LABEL_H = 10;       // section label height
        var TXT_DATA = 2.0;     // data text height
        var TXT_HDR = 2.0;      // header text height
        var TXT_GRP = 2.5;      // group header text height
        var TXT_TITLE = 4.0;    // title text height
        var TXT_LABEL = 3.0;    // section label text height
        var TXT_NOTE = 2.0;     // accessory note text height
        var NOTE_H = 5;         // note line height
        var PAD = 1.5;          // cell padding

        var entities = [];
        var handle = 100;
        function nextHandle() { handle++; return handle.toString(16).toUpperCase(); }

        // DXF entity builders
        function line(x1, y1, x2, y2, layer) {
            return "0\nLINE\n5\n" + nextHandle() + "\n8\n" + (layer || "BORDERS") + "\n10\n" + x1.toFixed(4) + "\n20\n" + y1.toFixed(4) + "\n30\n0.0\n11\n" + x2.toFixed(4) + "\n21\n" + y2.toFixed(4) + "\n31\n0.0\n";
        }

        function mtext(x, y, h, text, layer, align) {
            // align: 1=left, 2=center, 3=right
            var a = align || 2;
            var attachPt = a === 1 ? 4 : a === 3 ? 6 : 5;  // middle-left, middle-center, middle-right
            var cleanText = String(text).replace(/\n/g, "\\P");
            return "0\nMTEXT\n5\n" + nextHandle() + "\n8\n" + (layer || "DATA") + "\n10\n" + x.toFixed(4) + "\n20\n" + y.toFixed(4) + "\n30\n0.0\n40\n" + h.toFixed(2) + "\n71\n" + attachPt + "\n1\n" + cleanText + "\n";
        }

        // Draw a filled rectangle outline
        function rect(x, y, w, h, layer) {
            return line(x, y, x + w, y, layer) + line(x + w, y, x + w, y - h, layer) + line(x + w, y - h, x, y - h, layer) + line(x, y - h, x, y, layer);
        }

        // Compute table width
        function tableWidth(widths) {
            var w = 0; for (var i = 0; i < widths.length; i++) w += widths[i]; return w;
        }

        // Draw a table section (group header row + sub-header row + data rows)
        function drawTable(startX, startY, colWidths, groupHeaders, headers, dataRows) {
            var tw = tableWidth(colWidths);
            var y = startY;

            // Group header row
            entities.push(rect(startX, y, tw, GRP_H, "HEADERS"));
            for (var g = 0; g < groupHeaders.length; g++) {
                var gh = groupHeaders[g];
                var gx = startX;
                for (var gi = 0; gi < gh.start; gi++) gx += colWidths[gi];
                var gw = 0;
                for (var gj = 0; gj < gh.span; gj++) gw += colWidths[gh.start + gj];
                // Vertical dividers
                if (gh.start > 0) entities.push(line(gx, y, gx, y - GRP_H, "HEADERS"));
                entities.push(mtext(gx + gw / 2, y - GRP_H / 2, TXT_GRP, gh.text, "HEADERS", 2));
            }
            y -= GRP_H;

            // Sub-header row
            entities.push(rect(startX, y, tw, HDR_H, "HEADERS"));
            var hx = startX;
            for (var hi = 0; hi < headers.length; hi++) {
                if (hi > 0) entities.push(line(hx, y, hx, y - HDR_H, "HEADERS"));
                entities.push(mtext(hx + colWidths[hi] / 2, y - HDR_H / 2, TXT_HDR, headers[hi], "HEADERS", 2));
                hx += colWidths[hi];
            }
            y -= HDR_H;

            // Data rows
            for (var ri = 0; ri < dataRows.length; ri++) {
                var row = dataRows[ri];
                entities.push(rect(startX, y, tw, ROW_H, "BORDERS"));
                var rx = startX;
                var ci = 0;
                for (var c = 0; c < row.length; c++) {
                    var cellVal = row[c];
                    var cellText = "";
                    var cellSpan = 1;

                    if (cellVal && typeof cellVal === "object" && cellVal.content) {
                        cellText = cellVal.content;
                        cellSpan = cellVal.colSpan || 1;
                    } else {
                        cellText = String(cellVal || "");
                    }

                    var cellW = 0;
                    for (var cs = 0; cs < cellSpan; cs++) cellW += colWidths[ci + cs];

                    if (ci > 0) entities.push(line(rx, y, rx, y - ROW_H, "BORDERS"));
                    if (cellText) entities.push(mtext(rx + cellW / 2, y - ROW_H / 2, TXT_DATA, cellText, "DATA", 2));

                    rx += cellW;
                    ci += cellSpan;
                }
                y -= ROW_H;
            }

            return y;
        }

        // ---- BUILD DXF ----
        var X0 = 10;     // left margin
        var Y0 = 290;    // start near top of A3 landscape
        var y = Y0;

        // Title bar
        var iTW = tableWidth(iColWidths);
        entities.push(rect(X0, y, iTW, TITLE_H, "TITLE"));
        entities.push(mtext(X0 + iTW / 2, y - TITLE_H / 2, TXT_TITLE, title, "TITLE", 2));
        y -= TITLE_H;

        // Indoor section label
        entities.push(rect(X0, y, iTW, LABEL_H, "HEADERS"));
        entities.push(mtext(X0 + iTW / 2, y - LABEL_H / 2, TXT_LABEL, iduLabel, "HEADERS", 2));
        y -= LABEL_H;

        // Indoor table
        y = drawTable(X0, y, iColWidths, iGroupHeaders, iHeaders, iRows);

        // Gap
        y -= 4;

        // Outdoor section label
        var oTW = tableWidth(oColWidths);
        entities.push(rect(X0, y, oTW, LABEL_H, "HEADERS"));
        entities.push(mtext(X0 + oTW / 2, y - LABEL_H / 2, TXT_LABEL, oduLabel, "HEADERS", 2));
        y -= LABEL_H;

        // Outdoor table
        y = drawTable(X0, y, oColWidths, oGroupHeaders, oHeaders, oRows);

        // Accessories notes
        if ((accIndoor && accIndoor.length > 0) || (accOutdoor && accOutdoor.length > 0)) {
            y -= 4;
            var noteBoxW = oTW / 2;
            var maxNotes = Math.max(accIndoor ? accIndoor.length : 0, accOutdoor ? accOutdoor.length : 0);
            var noteBoxH = 6 + maxNotes * NOTE_H;

            // Indoor accessories box
            entities.push(rect(X0, y, noteBoxW, noteBoxH, "BORDERS"));
            entities.push(mtext(X0 + PAD, y - 3, TXT_HDR, "NOTES (INDOOR UNIT):", "HEADERS", 1));
            if (accIndoor) {
                for (var ai = 0; ai < accIndoor.length; ai++) {
                    entities.push(mtext(X0 + PAD, y - 6 - (ai * NOTE_H) - NOTE_H / 2, TXT_NOTE, (ai + 1) + "- " + accIndoor[ai], "DATA", 1));
                }
            }

            // Outdoor accessories box
            var oNoteX = X0 + noteBoxW;
            entities.push(rect(oNoteX, y, noteBoxW, noteBoxH, "BORDERS"));
            entities.push(mtext(oNoteX + PAD, y - 3, TXT_HDR, "NOTES (OUTDOOR UNIT):", "HEADERS", 1));
            if (accOutdoor) {
                for (var ao = 0; ao < accOutdoor.length; ao++) {
                    entities.push(mtext(oNoteX + PAD, y - 6 - (ao * NOTE_H) - NOTE_H / 2, TXT_NOTE, (ao + 1) + "- " + accOutdoor[ao], "DATA", 1));
                }
            }
        }

        // ---- ASSEMBLE DXF FILE ----
        var dxf = "";

        // HEADER
        dxf += "0\nSECTION\n2\nHEADER\n";
        dxf += "9\n$ACADVER\n1\nAC1027\n";
        dxf += "9\n$INSUNITS\n70\n4\n";   // millimeters
        dxf += "0\nENDSEC\n";

        // TABLES (layers + text style)
        dxf += "0\nSECTION\n2\nTABLES\n";

        // Layer table
        dxf += "0\nTABLE\n2\nLAYER\n70\n4\n";
        var layers = [
            { name: "BORDERS", color: 7 },   // white
            { name: "HEADERS", color: 5 },   // blue
            { name: "DATA", color: 7 },       // white
            { name: "TITLE", color: 1 },      // red
        ];
        for (var li = 0; li < layers.length; li++) {
            dxf += "0\nLAYER\n5\n" + nextHandle() + "\n2\n" + layers[li].name + "\n70\n0\n62\n" + layers[li].color + "\n6\nContinuous\n";
        }
        dxf += "0\nENDTAB\n";

        // Text style
        dxf += "0\nTABLE\n2\nSTYLE\n70\n1\n";
        dxf += "0\nSTYLE\n5\n" + nextHandle() + "\n2\nSTANDARD\n70\n0\n40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n";
        dxf += "0\nENDTAB\n";

        dxf += "0\nENDSEC\n";

        // ENTITIES
        dxf += "0\nSECTION\n2\nENTITIES\n";
        dxf += entities.join("");
        dxf += "0\nENDSEC\n";

        // EOF
        dxf += "0\nEOF\n";

        return dxf;
    }


    // =====================================================================
    //  GAS PACKS — EXCEL EXPORT (template-based)
    // =====================================================================
    async function exportGpScheduleXlsx(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        if (typeof ExcelJS === "undefined") {
            Project.showToast("ExcelJS library not loaded", "toast-danger"); return;
        }

        Project.showToast("Generating Excel schedule…", "toast-success");

        try {
            var resp = await fetch(TEMPLATE_PATHS["gas-packs"]);
            if (!resp.ok) throw new Error("Gas Packs Template not found");
            var buf = await resp.arrayBuffer();
            var wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf);
            var tws = wb.getWorksheet(1);
            var styles = extractStyles(tws);
            var colWidths = [];
            var numCols = 25; // A through Y
            for (var ci = 1; ci <= numCols; ci++) {
                var col = tws.getColumn(ci);
                colWidths.push(col.width || 8.43);
            }
            var templateId = tws.id;
            wb.removeWorksheet(templateId);

            var ws = wb.addWorksheet("Gas Pack RTU Schedule", {
                pageSetup: { orientation: "landscape", paperSize: 17, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            for (var wi = 0; wi < colWidths.length; wi++) {
                ws.getColumn(wi + 1).width = colWidths[wi];
            }

            // Row 1: Title
            var row = 1;
            ws.mergeCells(row, 1, row, numCols);
            applyStyle(ws.getCell(row, 1), "PACKAGED ROOFTOP UNITS", styles.headerOuter);
            ws.getRow(row).height = 20;
            row++;

            // Row 2: Group headers
            var h1 = row;
            ws.mergeCells(h1, 1, h1 + 1, 1); applyStyle(ws.getCell(h1, 1), "TAG", styles.headerOuter);
            ws.mergeCells(h1, 2, h1 + 1, 2); applyStyle(ws.getCell(h1, 2), "MAKE", styles.headerOuter);
            ws.mergeCells(h1, 3, h1 + 1, 3); applyStyle(ws.getCell(h1, 3), "MODEL NUMBER", styles.headerOuter);
            ws.mergeCells(h1, 4, h1 + 1, 4); applyStyle(ws.getCell(h1, 4), "NOM TONS", styles.headerOuter);
            ws.mergeCells(h1, 5, h1, 7); applyStyle(ws.getCell(h1, 5), "Fan Data", styles.headerInner);
            ws.mergeCells(h1, 8, h1, 14); applyStyle(ws.getCell(h1, 8), "Cooling Performance", styles.headerInner);
            ws.mergeCells(h1, 15, h1, 18); applyStyle(ws.getCell(h1, 15), "Heating Performance", styles.headerInner);
            ws.mergeCells(h1, 19, h1 + 1, 19); applyStyle(ws.getCell(h1, 19), "MODULATING\nHOT GAS\nREHEAT", styles.headerInnerWrap);
            ws.mergeCells(h1, 20, h1 + 1, 20); applyStyle(ws.getCell(h1, 20), "COOLING\nSTAGES", styles.headerInnerWrap);
            ws.mergeCells(h1, 21, h1, 24); applyStyle(ws.getCell(h1, 21), "Electrical Data", styles.headerInner);
            ws.mergeCells(h1, 25, h1 + 1, 25); applyStyle(ws.getCell(h1, 25), "NOTES", styles.headerOuter);

            // Row 3: Sub headers
            var h2 = h1 + 1;
            applyStyle(ws.getCell(h2, 5), "CFM", styles.headerSub);
            applyStyle(ws.getCell(h2, 6), "ESP (IWG)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 7), "TESP (IWG)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 8), "TOTAL CAPACITY\n(BTU/h)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 9), "SENSIBLE CAPACITY\n(BTU/h)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 10), "EFFICIENCY\n(AT AHRI)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 11), "EDB (°F)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 12), "EWB (°F)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 13), "LDB (°F)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 14), "LWB (°F)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 15), "INPUT (MBH)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 16), "OUTPUT (MBH)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 17), "EAT (°F)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 18), "LAT (°F)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 21), "VOLT/PH", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 22), "INDOOR\nMOTOR HP", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 23), "Unit MCA", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 24), "Unit MOCP", styles.headerSubWrap);
            ws.getRow(h1).height = 16; ws.getRow(h2).height = 31;
            row = h2 + 1;

            // DATA ROWS
            for (var ei = 0; ei < entries.length; ei++) {
                var entry = entries[ei];
                var sys = DataLoader.getSystemById(entry.systemId);
                if (!sys) continue;
                var sc = sys.schedule;
                var r = row;
                var isFirst = true; var isLast = true;

                applyDataCell(ws.getCell(r, 1), entry.oduTag || "RTU-", styles, isFirst, isLast, true, false);
                applyDataCell(ws.getCell(r, 2), sc.manufacturer, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 3), sc.model, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 4), sc.nomTons, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 5), sc.cfm, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 6), sc.esp, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 7), sc.tesp, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 8), sc.coolingTotalCapacity, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 9), sc.coolingSensibleCapacity, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 10), sc.efficiency, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 11), sc.edb, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 12), sc.ewb, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 13), sc.ldb, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 14), sc.lwb, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 15), sc.heatingInput, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 16), sc.heatingOutput, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 17), sc.heatingEat, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 18), sc.heatingLat, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 19), sc.hgrh, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 20), sc.coolingStages, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 21), sc.voltage, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 22), sc.motorHp, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 23), sc.mca, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 24), sc.mocp, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 25), entry.outdoorAccessories || "", styles, isFirst, isLast, false, true);
                ws.getRow(r).height = 15.75;
                row++;
            }

            // NOTES SECTION
            row++;
            var gpNotes = Project.getProductActiveNotes("gas-packs");
            var unitNotes = gpNotes.indoor || [];
            if (unitNotes.length > 0) {
                ws.getCell(row, 1).value = "NOTES:";
                ws.getCell(row, 1).font = styles.notesHeader.font;
                ws.getCell(row, 1).alignment = styles.notesHeader.alignment;
                row++;
                for (var ni = 0; ni < unitNotes.length; ni++) {
                    ws.getCell(row, 1).value = (ni + 1) + "-";
                    ws.getCell(row, 1).font = styles.notesNum.font;
                    ws.getCell(row, 1).alignment = styles.notesNum.alignment;
                    ws.mergeCells(row, 2, row, numCols);
                    ws.getCell(row, 2).value = unitNotes[ni];
                    ws.getCell(row, 2).font = styles.notesText.font;
                    ws.getCell(row, 2).alignment = styles.notesText.alignment;
                    row++;
                }
            }

            // GENERATE
            var buffer = await wb.xlsx.writeBuffer();
            var blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            if (options && options.returnBlob) return blob;
            Project.downloadBlob(blob, "Gas Pack RTU Schedule.xlsx");
            Project.showToast("Schedule exported as Excel", "toast-success");
        } catch (err) {
            console.error("[Export] Gas Pack Excel generation failed:", err);
            Project.showToast("Excel export failed — see console", "toast-danger");
        }
    }


    // =====================================================================
    //  GAS PACKS — PDF EXPORT
    // =====================================================================
    function exportGpSchedulePdf(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        if (typeof window.jspdf === "undefined" && typeof jsPDF === "undefined") {
            Project.showToast("jsPDF library not loaded", "toast-danger"); return;
        }

        var C = (typeof window.jspdf !== "undefined") ? window.jspdf.jsPDF : jsPDF;
        var doc = new C({ orientation: "landscape", unit: "pt", format: "tabloid" });
        var pw = doc.internal.pageSize.getWidth();
        var lm = 20; var M = 1.0; var T = 0.25;

        var colWidths = [40,40,55,28,35,28,28,50,50,60,28,28,28,28,35,35,28,28,28,28,38,35,35,35];
        var tableW = 0; for (var cw = 0; cw < colWidths.length; cw++) tableW += colWidths[cw];
        var colW = {}; for (var cw2 = 0; cw2 < colWidths.length; cw2++) colW[cw2] = colWidths[cw2];

        var headRow1 = [
            { content: "TAG", rowSpan: 2 },
            { content: "MAKE", rowSpan: 2 },
            { content: "MODEL\nNUMBER", rowSpan: 2 },
            { content: "NOM\nTONS", rowSpan: 2 },
            { content: "FAN DATA", colSpan: 3 },
            { content: "COOLING PERFORMANCE", colSpan: 7 },
            { content: "HEATING\nPERFORMANCE", colSpan: 4 },
            { content: "HGRH", rowSpan: 2 },
            { content: "COOLING\nSTAGES", rowSpan: 2 },
            { content: "ELECTRICAL DATA", colSpan: 4 },
        ];

        var headRow2 = [
            "CFM","ESP\n(IWG)","TESP\n(IWG)",
            "TOTAL\nCAP.","SENS.\nCAP.","EFF.","EDB","EWB","LDB","LWB",
            "INPUT\n(MBH)","OUTPUT\n(MBH)","EAT","LAT",
            "VOLT/\nPH","MOTOR\nHP","MCA","MOCP"
        ];

        var rows = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i], s = DataLoader.getSystemById(e.systemId);
            if (!s) continue;
            var sc = s.schedule;
            rows.push([
                e.oduTag || "RTU-", sc.manufacturer || "", sc.model || "", fp(sc.nomTons),
                fp(sc.cfm), fp(sc.esp), fp(sc.tesp),
                fp(sc.coolingTotalCapacity), fp(sc.coolingSensibleCapacity), sc.efficiency || "",
                fp(sc.edb), fp(sc.ewb), fp(sc.ldb), fp(sc.lwb),
                fp(sc.heatingInput), fp(sc.heatingOutput), fp(sc.heatingEat), fp(sc.heatingLat),
                sc.hgrh || "", fp(sc.coolingStages),
                sc.voltage || "", fp(sc.motorHp), fp(sc.mca), fp(sc.mocp)
            ]);
        }

        var sx = (pw - tableW) / 2; if (sx < lm) sx = lm;
        doc.setFontSize(9);
        doc.text("PACKAGED ROOFTOP UNITS", pw / 2, 30, { align: "center" });

        doc.autoTable({
            startY: 40,
            margin: { left: sx },
            head: [headRow1, headRow2],
            body: rows,
            theme: "grid",
            styles: { font: "helvetica", fontSize: 6, cellPadding: 2, halign: "center", valign: "middle", lineWidth: T, lineColor: [0, 0, 0] },
            headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: "bold", lineWidth: T },
            columnStyles: colW,
            tableLineWidth: M, tableLineColor: [0, 0, 0],
            didParseCell: function (data) {
                if (data.section === "body") {
                    data.cell.styles.lineWidth = T;
                    if (data.row.index === 0) data.cell.styles.lineWidth = { top: M, bottom: T, left: T, right: T };
                    if (data.row.index === rows.length - 1) data.cell.styles.lineWidth = { top: T, bottom: M, left: T, right: T };
                    if (data.column.index === 0) { data.cell.styles.lineWidth = typeof data.cell.styles.lineWidth === "object" ? Object.assign({}, data.cell.styles.lineWidth, { left: M }) : { top: T, bottom: T, left: M, right: T }; }
                    if (data.column.index === colWidths.length - 1) { data.cell.styles.lineWidth = typeof data.cell.styles.lineWidth === "object" ? Object.assign({}, data.cell.styles.lineWidth, { right: M }) : { top: T, bottom: T, left: T, right: M }; }
                }
            }
        });

        // Notes
        var gpNotes = Project.getProductActiveNotes("gas-packs");
        var unitNotes = gpNotes.indoor || [];
        if (unitNotes.length > 0) {
            var nY = doc.lastAutoTable.finalY + 14;
            doc.setFontSize(7); doc.setFont("helvetica", "bold");
            doc.text("NOTES:", sx, nY); nY += 10;
            doc.setFont("helvetica", "normal");
            for (var ni = 0; ni < unitNotes.length; ni++) {
                doc.text((ni + 1) + "- " + unitNotes[ni], sx + 15, nY); nY += 9;
            }
        }

        if (options && options.returnBlob) return doc.output("blob");
        doc.save("Gas Pack RTU Schedule.pdf");
        Project.showToast("Schedule exported as PDF", "toast-success");
    }


    // -----------------------------------------------------------------------
    return {
        init: init,
        downloadAllDocuments: downloadAllDocuments,
        exportScheduleXlsx: exportScheduleXlsx,
        exportSchedulePdf: exportSchedulePdf,
        exportScheduleDxf: exportScheduleDxf,
    };
})();