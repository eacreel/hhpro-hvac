/* ==========================================================================
   export.js — Document downloads, schedule export (Excel & PDF)

   All product types use combined single-row format (indoor + outdoor).
   Notes section is a single unified section per product.

   Local libraries (in JS/ folder):
     - ExcelJS, jsPDF, jsPDF-AutoTable, JSZip
   ========================================================================== */

const Export = (function () {

    const TEMPLATE_PATHS = {
        "mini-splits":     "DATA/MINI SPLIT SCHEDULE.xlsx",
        "multi-position":  "DATA/MULTI POSITION SPLIT SCHEDULE.xlsx",
        "gas-packs":       "DATA/GAS PACKS SCHEDULE.xlsx",
    };

    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------
    function init() {
        document.getElementById("btn-export-csv").addEventListener("click", function () { Project.exportCsv(); });
        document.getElementById("btn-export-schedule-xlsx").addEventListener("click", function () { exportScheduleXlsx(); });
        document.getElementById("btn-export-schedule-pdf").addEventListener("click", function () { exportSchedulePdf(); });
        document.getElementById("btn-download-docs").addEventListener("click", function () { downloadAllDocuments(); });
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
    //  DOWNLOAD ALL DOCUMENTS
    // =====================================================================
    async function downloadAllDocuments() {
        var entries = Project.getEntries();
        if (entries.length === 0) return;
        if (typeof JSZip === "undefined") { Project.showToast("JSZip library not loaded", "toast-danger"); return; }
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
                var zipPath = allDocs[j].path.replace(/^ASSETS\/[^/]+\//, "");
                zip.file(zipPath, blob);
                fetched++;
            } catch (err) { failed++; }
        }
        if (fetched === 0) { Project.showToast("Could not retrieve any documents", "toast-danger"); return; }
        try {
            var zipBlob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
            Project.downloadBlob(zipBlob, "HHpro_Documents.zip");
            var msg = fetched + " document(s) downloaded";
            if (failed > 0) msg += " (" + failed + " unavailable)";
            Project.showToast(msg, "toast-success");
        } catch (err) { Project.showToast("Failed to create ZIP", "toast-danger"); }
    }


    // =====================================================================
    //  BORDER HELPERS
    // =====================================================================
    var _thin  = { style: "thin" };
    var _medium = { style: "medium" };

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

        if (options && options.returnBlobs) {
            var blobs = [];
            if (hasMs) { var b = await exportMsScheduleXlsx({ returnBlob: true, entries: groups["mini-splits"] }); if (b) blobs.push({ name: "Mini Split Schedule.xlsx", blob: b }); }
            if (hasMps) { var b2 = await exportMpsScheduleXlsx({ returnBlob: true, entries: groups["multi-position"] }); if (b2) blobs.push({ name: "Multi Position Split Schedule.xlsx", blob: b2 }); }
            if (hasGp) { var b3 = await exportGpScheduleXlsx({ returnBlob: true, entries: groups["gas-packs"] }); if (b3) blobs.push({ name: "Gas Pack RTU Schedule.xlsx", blob: b3 }); }
            return blobs;
        }

        if (options && options.returnBlob) {
            if (hasGp && !hasMs && !hasMps) return exportGpScheduleXlsx(options);
            if (hasMps && !hasMs) return exportMpsScheduleXlsx(options);
            return exportMsScheduleXlsx(options);
        }

        if (hasMs) await exportMsScheduleXlsx({ entries: groups["mini-splits"] });
        if (hasMps) await exportMpsScheduleXlsx({ entries: groups["multi-position"] });
        if (hasGp) await exportGpScheduleXlsx({ entries: groups["gas-packs"] });
    }


    // =====================================================================
    //  MINI SPLITS — EXCEL EXPORT (combined single-row)
    // =====================================================================
    async function exportMsScheduleXlsx(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        if (typeof ExcelJS === "undefined") { Project.showToast("ExcelJS library not loaded", "toast-danger"); return; }

        Project.showToast("Generating Excel schedule…", "toast-success");

        try {
            var resp = await fetch(TEMPLATE_PATHS["mini-splits"]);
            if (!resp.ok) throw new Error("Template not found");
            var buf = await resp.arrayBuffer();
            var wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf);
            var tws = wb.getWorksheet(1);
            var styles = extractStyles(tws);
            var numCols = 26; // A through Z
            var colWidths = [];
            for (var ci = 1; ci <= numCols; ci++) colWidths.push(tws.getColumn(ci).width || 8.43);
            wb.removeWorksheet(tws.id);

            var ws = wb.addWorksheet("Split System Schedule", {
                pageSetup: { orientation: "landscape", paperSize: 17, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            for (var wi = 0; wi < colWidths.length; wi++) ws.getColumn(wi + 1).width = colWidths[wi];

            var row = 1;

            // TITLE
            ws.mergeCells(row, 1, row, numCols);
            applyStyle(ws.getCell(row, 1), "SPLIT SYSTEM SCHEDULE", styles.title);
            ws.getRow(row).height = 22; row++;

            // Section labels: INDOOR UNIT | OUTDOOR UNIT
            ws.mergeCells(row, 1, row, 14);
            applyStyle(ws.getCell(row, 1), "INDOOR UNIT", styles.sectionLabel);
            ws.mergeCells(row, 15, row, numCols);
            applyStyle(ws.getCell(row, 15), "OUTDOOR UNIT", styles.sectionLabel);
            ws.getRow(row).height = 20; row++;

            // Headers — copy structure from template rows 3-4
            // Row 3 (h1) and Row 4 (h2) match the template
            var h1 = row, h2 = row + 1;
            // The template headers are already defined in the template file;
            // we rebuild them here to match
            ws.mergeCells(h1, 1, h2, 1); applyStyle(ws.getCell(h1, 1), "SYMBOL", styles.headerOuter);
            ws.mergeCells(h1, 2, h2, 2); applyStyle(ws.getCell(h1, 2), "CFM", styles.headerInner);
            ws.mergeCells(h1, 3, h1, 6); applyStyle(ws.getCell(h1, 3), "COOLING CAPACITY", styles.headerInner);
            ws.mergeCells(h1, 7, h1, 8); applyStyle(ws.getCell(h1, 7), "HEAT PUMP HEATING CAPACITY", styles.headerInner);
            ws.mergeCells(h1, 9, h2, 9); applyStyle(ws.getCell(h1, 9), "OPERATING\nWEIGHT", styles.headerInnerWrap);
            ws.mergeCells(h1, 10, h2, 10); applyStyle(ws.getCell(h1, 10), "INDOOR UNIT\nTYPE", styles.headerInnerWrap);
            ws.mergeCells(h1, 11, h1, 13); applyStyle(ws.getCell(h1, 11), "ELECTRICAL", styles.headerInner);
            ws.mergeCells(h1, 14, h2, 14); applyStyle(ws.getCell(h1, 14), "MANUFACTURER\nDAIKIN", styles.headerInnerWrap);
            ws.mergeCells(h1, 15, h2, 15); applyStyle(ws.getCell(h1, 15), "SYMBOL", styles.headerOuter);
            ws.mergeCells(h1, 16, h2, 16); applyStyle(ws.getCell(h1, 16), "OA AMBIENT\n(COOLING)", styles.headerInnerWrap);
            ws.mergeCells(h1, 17, h2, 17); applyStyle(ws.getCell(h1, 17), "OA AMBIENT\n(HEATING)", styles.headerInnerWrap);
            ws.mergeCells(h1, 18, h2, 18); applyStyle(ws.getCell(h1, 18), "OPERATING\nWEIGHT", styles.headerInnerWrap);
            ws.mergeCells(h1, 19, h2, 19); applyStyle(ws.getCell(h1, 19), "SEER2/EER2/\nHSPF2", styles.headerInnerWrap);
            ws.mergeCells(h1, 20, h1, 22); applyStyle(ws.getCell(h1, 20), "ELECTRICAL", styles.headerInner);
            ws.mergeCells(h1, 23, h2, 23); applyStyle(ws.getCell(h1, 23), "MANUFACTURER\nDAIKIN", styles.headerInnerWrap);
            ws.mergeCells(h1, 24, h2, 24); applyStyle(ws.getCell(h1, 24), "REFRIGERANT", styles.headerInnerWrap);
            ws.mergeCells(h1, 25, h2, 25); applyStyle(ws.getCell(h1, 25), "MAX ALLOWABLE\nLINE-SET LENGTHS", styles.headerInnerWrap);
            ws.mergeCells(h1, 26, h2, 26); applyStyle(ws.getCell(h1, 26), "NOTES", styles.headerOuter);

            applyStyle(ws.getCell(h2, 3), "EDB", styles.headerSub);
            applyStyle(ws.getCell(h2, 4), "EWB", styles.headerSub);
            applyStyle(ws.getCell(h2, 5), "TOTAL\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 6), "SENSIBLE\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 7), "EDB", styles.headerSub);
            applyStyle(ws.getCell(h2, 8), "TOTAL\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 11), "Voltage", styles.headerSub);
            applyStyle(ws.getCell(h2, 12), "MCA", styles.headerSub);
            applyStyle(ws.getCell(h2, 13), "MOP", styles.headerSub);
            applyStyle(ws.getCell(h2, 20), "Voltage", styles.headerSub);
            applyStyle(ws.getCell(h2, 21), "MCA", styles.headerSub);
            applyStyle(ws.getCell(h2, 22), "MOP", styles.headerSub);
            ws.getRow(h1).height = 16; ws.getRow(h2).height = 31;
            row = h2 + 1;

            // DATA ROWS — each indoor unit is a row, outdoor cols span
            var totalRows = 0;
            for (var ci2 = 0; ci2 < entries.length; ci2++) { var cSys = DataLoader.getSystemById(entries[ci2].systemId); if (cSys) totalRows += cSys.indoorUnits.length; }
            var rowIndex = 0;

            for (var ei = 0; ei < entries.length; ei++) {
                var entry = entries[ei];
                var sys = DataLoader.getSystemById(entry.systemId);
                if (!sys) continue;
                var odu = sys.outdoorUnit;
                var numIdu = sys.indoorUnits.length;

                for (var j = 0; j < numIdu; j++) {
                    var idu = sys.indoorUnits[j];
                    var r = row;
                    var iduTag = (j < entry.iduTags.length) ? entry.iduTags[j] : "IDU-";
                    var isFirst = (rowIndex === 0); var isLast = (rowIndex === totalRows - 1);

                    applyDataCell(ws.getCell(r, 1), iduTag, styles, isFirst, isLast, true, false);
                    applyDataCell(ws.getCell(r, 2), idu.cfm, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 3), idu.coolingEdb, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 4), idu.coolingEwb, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 5), idu.coolingTotal, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 6), idu.coolingSensible, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 7), idu.heatingEdb, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 8), idu.heatingTotal, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 9), idu.weight, styles, isFirst, isLast, false, false);
                    applyDataCell(ws.getCell(r, 10), idu.type || "", styles, isFirst, isLast, false, false);
                    if (idu.poweredFromOutdoor) {
                        ws.mergeCells(r, 11, r, 13);
                        applyDataCell(ws.getCell(r, 11), "Indoor Powered From Outdoor Unit", styles, isFirst, isLast, false, false);
                    } else {
                        applyDataCell(ws.getCell(r, 11), idu.voltage || "", styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 12), idu.mca, styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 13), idu.mop, styles, isFirst, isLast, false, false);
                    }
                    applyDataCell(ws.getCell(r, 14), idu.manufacturer || "", styles, isFirst, isLast, false, false);

                    // Outdoor columns (first indoor row only, with merge for multi-zone)
                    if (j === 0) {
                        var oduTag = entry.oduTag || "ODU-";
                        if (numIdu > 1) {
                            for (var oc = 15; oc <= 26; oc++) {
                                ws.mergeCells(r, oc, r + numIdu - 1, oc);
                            }
                        }
                        applyDataCell(ws.getCell(r, 15), oduTag, styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 16), odu.coolingAmbient, styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 17), odu.heatingAmbient, styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 18), odu.weight, styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 19), odu.seer || "", styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 20), odu.voltage || "", styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 21), odu.mca, styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 22), odu.mop, styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 23), odu.manufacturer || "", styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 24), odu.refrigerant || "", styles, isFirst, isLast, false, false);
                        applyDataCell(ws.getCell(r, 25), odu.lineSet || "", styles, isFirst, isLast, false, false);
                        var accVal = (entry.iduAccessories && j < entry.iduAccessories.length) ? (entry.iduAccessories[j] || "") : "";
                        applyDataCell(ws.getCell(r, 26), accVal, styles, isFirst, isLast, false, true);
                    }

                    ws.getRow(r).height = 15.75;
                    rowIndex++; row++;
                }
            }

            // NOTES SECTION
            writeNotesSection(ws, row, styles, numCols, "mini-splits");

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
    //  MPS — EXCEL EXPORT (combined single-row)
    // =====================================================================
    async function exportMpsScheduleXlsx(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        if (typeof ExcelJS === "undefined") { Project.showToast("ExcelJS library not loaded", "toast-danger"); return; }

        Project.showToast("Generating Excel schedule…", "toast-success");

        try {
            var resp = await fetch(TEMPLATE_PATHS["multi-position"]);
            if (!resp.ok) throw new Error("MPS Template not found");
            var buf = await resp.arrayBuffer();
            var wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf);
            var tws = wb.getWorksheet(1);
            var styles = extractStyles(tws);
            var numCols = 32; // A through AF
            var colWidths = [];
            for (var ci = 1; ci <= numCols; ci++) colWidths.push(tws.getColumn(ci).width || 8.43);
            wb.removeWorksheet(tws.id);

            var ws = wb.addWorksheet("Multi Position Split Schedule", {
                pageSetup: { orientation: "landscape", paperSize: 17, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            for (var wi = 0; wi < colWidths.length; wi++) ws.getColumn(wi + 1).width = colWidths[wi];

            var row = 1;

            // TITLE
            ws.mergeCells(row, 2, row, numCols);
            applyStyle(ws.getCell(row, 2), "MULTI POSITION SPLIT SYSTEM SCHEDULE", styles.title);
            ws.getRow(row).height = 22; row++;

            // Section labels
            ws.mergeCells(row, 2, row, 18);
            applyStyle(ws.getCell(row, 2), "INDOOR AIR HANDLING UNIT", styles.sectionLabel);
            ws.mergeCells(row, 19, row, numCols);
            applyStyle(ws.getCell(row, 19), "OUTDOOR CONDENSING UNIT", styles.sectionLabel);
            ws.getRow(row).height = 20; row++;

            // Headers (matching template rows 3-4)
            var h1 = row, h2 = row + 1;

            // Indoor headers
            ws.mergeCells(h1, 2, h2, 2); applyStyle(ws.getCell(h1, 2), "TAG", styles.headerOuter);
            ws.mergeCells(h1, 3, h2, 3); applyStyle(ws.getCell(h1, 3), "MODEL\n(DAIKIN)", styles.headerInnerWrap);
            ws.mergeCells(h1, 4, h1, 6); applyStyle(ws.getCell(h1, 4), "SUPPLY FAN", styles.headerInner);
            ws.mergeCells(h1, 7, h1, 11); applyStyle(ws.getCell(h1, 7), "COOLING", styles.headerInner);
            ws.mergeCells(h1, 12, h2, 12); applyStyle(ws.getCell(h1, 12), "HEAT PUMP\nTOTAL CAPACITY", styles.headerInnerWrap);
            ws.mergeCells(h1, 13, h1, 14); applyStyle(ws.getCell(h1, 13), "AUX. ELECTRIC HEAT", styles.headerInner);
            ws.mergeCells(h1, 15, h1, 17); applyStyle(ws.getCell(h1, 15), "ELECTRICAL DATA", styles.headerInner);
            ws.mergeCells(h1, 18, h2, 18); applyStyle(ws.getCell(h1, 18), "WEIGHT", styles.headerInnerWrap);

            // Outdoor headers
            ws.mergeCells(h1, 19, h2, 19); applyStyle(ws.getCell(h1, 19), "TAG", styles.headerOuter);
            ws.mergeCells(h1, 20, h2, 20); applyStyle(ws.getCell(h1, 20), "MODEL\n(DAIKIN)", styles.headerInnerWrap);
            ws.mergeCells(h1, 21, h1, 23); applyStyle(ws.getCell(h1, 21), "HEAT PUMP HEATING DATA", styles.headerInner);
            ws.mergeCells(h1, 24, h1, 26); applyStyle(ws.getCell(h1, 24), "ELECTRICAL DATA", styles.headerInner);
            ws.mergeCells(h1, 27, h2, 27); applyStyle(ws.getCell(h1, 27), "OUTDOOR\nAMBIENT\n(COOLING)", styles.headerInnerWrap);
            ws.mergeCells(h1, 28, h2, 28); applyStyle(ws.getCell(h1, 28), "REFRIGERANT", styles.headerInnerWrap);
            ws.mergeCells(h1, 29, h2, 29); applyStyle(ws.getCell(h1, 29), "EFFICIENCY", styles.headerInnerWrap);
            ws.mergeCells(h1, 30, h2, 30); applyStyle(ws.getCell(h1, 30), "COMPRESSOR\nSTAGES", styles.headerInnerWrap);
            ws.mergeCells(h1, 31, h2, 31); applyStyle(ws.getCell(h1, 31), "WEIGHT", styles.headerInnerWrap);
            ws.mergeCells(h1, 32, h2, 32); applyStyle(ws.getCell(h1, 32), "NOTES", styles.headerOuter);

            // Sub-headers
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
            applyStyle(ws.getCell(h2, 21), "OUTDOOR\nAMBIENT (DB)", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 22), "TOTAL\nCAPACITY", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 23), "EFFICIENCY", styles.headerSub);
            applyStyle(ws.getCell(h2, 24), "VOLTAGE\n/ PHASE", styles.headerSubWrap);
            applyStyle(ws.getCell(h2, 25), "MCA", styles.headerSub);
            applyStyle(ws.getCell(h2, 26), "MOP", styles.headerSub);
            ws.getRow(h1).height = 16; ws.getRow(h2).height = 31;
            row = h2 + 1;

            // DATA ROWS
            for (var ei = 0; ei < entries.length; ei++) {
                var entry = entries[ei];
                var sys = DataLoader.getSystemById(entry.systemId);
                if (!sys) continue;
                var idu = sys.indoorUnits[0];
                var odu = sys.outdoorUnit;
                var r = row;
                var isFirst = (ei === 0); var isLast = (ei === entries.length - 1);
                var iduTag = (entry.iduTags.length > 0) ? entry.iduTags[0] : "AHU-";

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

                applyDataCell(ws.getCell(r, 19), entry.oduTag || "CU-", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 20), odu.model || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 21), odu.heatingAmbient, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 22), odu.heatingTotal, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 23), odu.heatingEfficiency || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 24), odu.voltage || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 25), odu.mca, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 26), odu.mop, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 27), odu.coolingAmbient, styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 28), odu.refrigerant || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 29), odu.efficiency || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 30), odu.compressorStages || "", styles, isFirst, isLast, false, false);
                applyDataCell(ws.getCell(r, 31), odu.weight, styles, isFirst, isLast, false, false);
                var accVal = (entry.iduAccessories && entry.iduAccessories.length > 0) ? (entry.iduAccessories[0] || "") : "";
                applyDataCell(ws.getCell(r, 32), accVal, styles, isFirst, isLast, false, true);
                ws.getRow(r).height = 15.75;
                row++;
            }

            // NOTES SECTION
            writeNotesSection(ws, row, styles, numCols, "multi-position");

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
    //  GAS PACKS — EXCEL EXPORT (unchanged from before — template-based)
    // =====================================================================
    async function exportGpScheduleXlsx(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        if (typeof ExcelJS === "undefined") { Project.showToast("ExcelJS library not loaded", "toast-danger"); return; }
        Project.showToast("Generating Excel schedule…", "toast-success");

        try {
            var resp = await fetch(TEMPLATE_PATHS["gas-packs"]);
            if (!resp.ok) throw new Error("Gas Packs Template not found");
            var buf = await resp.arrayBuffer();
            var wb = new ExcelJS.Workbook();
            await wb.xlsx.load(buf);
            var tws = wb.getWorksheet(1);
            var styles = extractStyles(tws);
            var numCols = 25;
            var colWidths = [];
            for (var ci = 1; ci <= numCols; ci++) colWidths.push(tws.getColumn(ci).width || 8.43);
            wb.removeWorksheet(tws.id);

            var ws = wb.addWorksheet("Gas Pack RTU Schedule", {
                pageSetup: { orientation: "landscape", paperSize: 17, fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
            });
            for (var wi = 0; wi < colWidths.length; wi++) ws.getColumn(wi + 1).width = colWidths[wi];

            var row = 1;
            ws.mergeCells(row, 1, row, numCols);
            applyStyle(ws.getCell(row, 1), "PACKAGED ROOFTOP UNITS", styles.headerOuter);
            ws.getRow(row).height = 20; row++;

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

            for (var ei = 0; ei < entries.length; ei++) {
                var entry = entries[ei];
                var sys = DataLoader.getSystemById(entry.systemId);
                if (!sys) continue;
                var sc = sys.schedule;
                var r = row;
                var isFirst = (ei === 0); var isLast = (ei === entries.length - 1);

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

            writeNotesSection(ws, row, styles, numCols, "gas-packs");

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
    //  NOTES SECTION WRITER (unified single section)
    // =====================================================================
    function writeNotesSection(ws, row, styles, numCols, productKey) {
        var activeNotes = Project.getProductActiveNotes(productKey);
        if (activeNotes.length === 0) return;

        row++;
        ws.getCell(row, 1).value = "NOTES:";
        ws.getCell(row, 1).font = styles.notesHeader ? styles.notesHeader.font : { bold: true, size: 9 };
        ws.getCell(row, 1).alignment = styles.notesHeader ? styles.notesHeader.alignment : { horizontal: "left" };
        row++;

        for (var ni = 0; ni < activeNotes.length; ni++) {
            ws.getCell(row, 1).value = (ni + 1) + "-";
            ws.getCell(row, 1).font = styles.notesNum ? styles.notesNum.font : { size: 8 };
            ws.getCell(row, 1).alignment = styles.notesNum ? styles.notesNum.alignment : { horizontal: "right" };
            ws.mergeCells(row, 2, row, Math.min(numCols, 15));
            ws.getCell(row, 2).value = activeNotes[ni];
            ws.getCell(row, 2).font = styles.notesText ? styles.notesText.font : { size: 8 };
            ws.getCell(row, 2).alignment = styles.notesText ? styles.notesText.alignment : { horizontal: "left", wrapText: true };
            row++;
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

    function applyStyle(cell, value, style) {
        if (value !== undefined) cell.value = value;
        if (style) {
            if (style.font) cell.font = style.font;
            if (style.alignment) cell.alignment = style.alignment;
            if (style.fill) cell.fill = style.fill;
            if (style.border) cell.border = style.border;
        }
    }


    // =====================================================================
    //  STYLE EXTRACTION
    // =====================================================================
    function extractStyles(tws) {
        var titleCell = tws.getCell("B1");
        var sectionCell = tws.getCell("B2");
        var headerB3 = tws.getCell("B3");
        var headerE3 = tws.getCell("E3") || tws.getCell("D3");
        var subHeader = tws.getCell("E4") || tws.getCell("D4");
        var dataCell = tws.getCell("B5");

        return {
            title: { font: titleCell.font || { bold: true, size: 14 }, alignment: titleCell.alignment || { horizontal: "center", vertical: "middle" } },
            sectionLabel: { font: sectionCell.font || { bold: true, size: 11 }, alignment: sectionCell.alignment || { horizontal: "center", vertical: "middle" } },
            headerOuter: { font: headerB3.font || { bold: true, size: 9, color: { argb: "FFFFFFFF" } }, alignment: headerB3.alignment || { horizontal: "center", vertical: "middle", wrapText: true }, fill: headerB3.fill },
            headerInner: { font: (headerE3 && headerE3.font) || { bold: true, size: 9 }, alignment: { horizontal: "center", vertical: "middle", wrapText: false }, fill: (headerE3 && headerE3.fill) || headerB3.fill },
            headerInnerWrap: { font: (headerE3 && headerE3.font) || { bold: true, size: 9 }, alignment: { horizontal: "center", vertical: "middle", wrapText: true }, fill: (headerE3 && headerE3.fill) || headerB3.fill },
            headerSub: { font: (subHeader && subHeader.font) || { size: 8 }, alignment: { horizontal: "center", vertical: "middle" }, fill: (subHeader && subHeader.fill) },
            headerSubWrap: { font: (subHeader && subHeader.font) || { size: 8 }, alignment: { horizontal: "center", vertical: "middle", wrapText: true }, fill: (subHeader && subHeader.fill) },
            headerOuterOdu: { font: headerB3.font || { bold: true, size: 9, color: { argb: "FFFFFFFF" } }, alignment: headerB3.alignment || { horizontal: "center", vertical: "middle", wrapText: true }, fill: headerB3.fill },
            data: { font: dataCell.font || { size: 9 }, alignment: dataCell.alignment || { horizontal: "center", vertical: "middle" } },
            notesHeader: { font: { bold: true, size: 9 }, alignment: { horizontal: "left", vertical: "middle" } },
            notesNum: { font: { size: 8 }, alignment: { horizontal: "right", vertical: "middle" } },
            notesText: { font: { size: 8 }, alignment: { horizontal: "left", vertical: "middle", wrapText: true } },
        };
    }


    // =====================================================================
    //  PDF EXPORT — Dispatch
    // =====================================================================
    function exportSchedulePdf(options) {
        var groups = groupEntriesByProduct();
        var hasMs = groups["mini-splits"] && groups["mini-splits"].length > 0;
        var hasMps = groups["multi-position"] && groups["multi-position"].length > 0;
        var hasGp = groups["gas-packs"] && groups["gas-packs"].length > 0;

        if (options && options.returnBlobs) {
            var blobs = [];
            if (hasMs) { var b = exportMsSchedulePdf({ returnBlob: true, entries: groups["mini-splits"] }); if (b) blobs.push({ name: "Mini Split Schedule.pdf", blob: b }); }
            if (hasMps) { var b2 = exportMpsSchedulePdf({ returnBlob: true, entries: groups["multi-position"] }); if (b2) blobs.push({ name: "Multi Position Split Schedule.pdf", blob: b2 }); }
            if (hasGp) { var b3 = exportGpSchedulePdf({ returnBlob: true, entries: groups["gas-packs"] }); if (b3) blobs.push({ name: "Gas Pack RTU Schedule.pdf", blob: b3 }); }
            return blobs;
        }

        if (options && options.returnBlob) {
            if (hasGp && !hasMs && !hasMps) return exportGpSchedulePdf(options);
            if (hasMps && !hasMs) return exportMpsSchedulePdf(options);
            return exportMsSchedulePdf(options);
        }

        if (hasMs) exportMsSchedulePdf({ entries: groups["mini-splits"] });
        if (hasMps) exportMpsSchedulePdf({ entries: groups["multi-position"] });
        if (hasGp) exportGpSchedulePdf({ entries: groups["gas-packs"] });
    }

    function fp(val) { if (val === null || val === undefined) return ""; if (typeof val === "number" && Number.isInteger(val) && val >= 1000) return val.toLocaleString("en-US"); return String(val); }


    // =====================================================================
    //  MINI SPLITS — PDF (simplified single-table)
    // =====================================================================
    function exportMsSchedulePdf(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        var C = (typeof window.jspdf !== "undefined") ? window.jspdf.jsPDF : jsPDF;
        var doc = new C({ orientation: "landscape", unit: "pt", format: "tabloid" });
        var pw = doc.internal.pageSize.getWidth();
        var M = 1.0; var T = 0.25;

        doc.setFontSize(12); doc.setFont("helvetica", "bold");
        doc.text("SPLIT SYSTEM SCHEDULE", pw / 2, 30, { align: "center" });

        var headRow1 = [
            { content: "SYMBOL", rowSpan: 2 }, { content: "CFM", rowSpan: 2 },
            { content: "COOLING CAPACITY", colSpan: 4 }, { content: "HP HEATING", colSpan: 2 },
            { content: "WEIGHT", rowSpan: 2 }, { content: "TYPE", rowSpan: 2 },
            { content: "ELECTRICAL", colSpan: 3 }, { content: "MFG", rowSpan: 2 },
            { content: "SYMBOL", rowSpan: 2 }, { content: "OA\nCOOL", rowSpan: 2 }, { content: "OA\nHEAT", rowSpan: 2 },
            { content: "WEIGHT", rowSpan: 2 }, { content: "SEER2/EER2\n/HSPF2", rowSpan: 2 },
            { content: "ELECTRICAL", colSpan: 3 }, { content: "MFG", rowSpan: 2 },
            { content: "REFRIG.", rowSpan: 2 }, { content: "LINE-SET", rowSpan: 2 },
        ];
        var headRow2 = ["EDB","EWB","TOTAL","SENS.","EDB","TOTAL","V","MCA","MOP","V","MCA","MOP"];

        var rows = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i], s = DataLoader.getSystemById(e.systemId);
            if (!s) continue;
            for (var j = 0; j < s.indoorUnits.length; j++) {
                var u = s.indoorUnits[j];
                var odu = s.outdoorUnit;
                var row = [e.iduTags[j] || "IDU-", fp(u.cfm), fp(u.coolingEdb), fp(u.coolingEwb), fp(u.coolingTotal), fp(u.coolingSensible),
                    fp(u.heatingEdb), fp(u.heatingTotal), fp(u.weight), u.type || "",
                    u.poweredFromOutdoor ? { content: "Powered From ODU", colSpan: 3 } : (u.voltage || "")];
                if (!u.poweredFromOutdoor) { row.push(fp(u.mca)); row.push(fp(u.mop)); }
                row.push(u.manufacturer || "");
                if (j === 0) {
                    row.push(e.oduTag || "ODU-"); row.push(fp(odu.coolingAmbient)); row.push(fp(odu.heatingAmbient));
                    row.push(fp(odu.weight)); row.push(odu.seer || "");
                    row.push(odu.voltage || ""); row.push(fp(odu.mca)); row.push(fp(odu.mop));
                    row.push(odu.manufacturer || ""); row.push(odu.refrigerant || ""); row.push(odu.lineSet || "");
                }
                rows.push(row);
            }
        }

        doc.autoTable({
            startY: 45, head: [headRow1, headRow2], body: rows, theme: "grid",
            styles: { font: "helvetica", fontSize: 5.5, cellPadding: 1.5, halign: "center", valign: "middle", lineWidth: T, lineColor: [0,0,0] },
            headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: "bold", lineWidth: T },
            tableLineWidth: M, tableLineColor: [0,0,0],
            margin: { left: 15, right: 15 },
        });

        writePdfNotes(doc, "mini-splits", 15);

        if (options && options.returnBlob) return doc.output("blob");
        doc.save("Mini Split Schedule.pdf");
        Project.showToast("Schedule exported as PDF", "toast-success");
    }


    // =====================================================================
    //  MPS — PDF (simplified single-table)
    // =====================================================================
    function exportMpsSchedulePdf(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        var C = (typeof window.jspdf !== "undefined") ? window.jspdf.jsPDF : jsPDF;
        var doc = new C({ orientation: "landscape", unit: "pt", format: "tabloid" });
        var pw = doc.internal.pageSize.getWidth();
        var M = 1.0; var T = 0.25;

        doc.setFontSize(12); doc.setFont("helvetica", "bold");
        doc.text("MULTI POSITION SPLIT SYSTEM SCHEDULE", pw / 2, 30, { align: "center" });

        var headRow1 = [
            { content: "TAG", rowSpan: 2 }, { content: "MODEL\n(DAIKIN)", rowSpan: 2 },
            { content: "SUPPLY FAN", colSpan: 3 }, { content: "COOLING", colSpan: 5 },
            { content: "HP TOTAL\nCAP.", rowSpan: 2 }, { content: "AUX. HEAT", colSpan: 2 },
            { content: "ELECTRICAL", colSpan: 3 }, { content: "WEIGHT", rowSpan: 2 },
            { content: "TAG", rowSpan: 2 }, { content: "MODEL\n(DAIKIN)", rowSpan: 2 },
            { content: "HP HEATING", colSpan: 3 }, { content: "ELECTRICAL", colSpan: 3 },
            { content: "OA\nCOOL", rowSpan: 2 }, { content: "REFRIG.", rowSpan: 2 },
            { content: "EFF.", rowSpan: 2 }, { content: "COMP.", rowSpan: 2 }, { content: "WEIGHT", rowSpan: 2 },
            { content: "NOTES", rowSpan: 2 },
        ];
        var headRow2 = ["CFM","HP","TYPE","EAT DB","EAT WB","LAT DB","TOTAL","SENS.","kW","RISE","V/PH","MCA","MOP","AMB DB","TOTAL","EFF.","V/PH","MCA","MOP"];

        var rows = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i], s = DataLoader.getSystemById(e.systemId);
            if (!s) continue;
            var u = s.indoorUnits[0]; var od = s.outdoorUnit;
            var iduAcc = (e.iduAccessories && e.iduAccessories.length > 0) ? (e.iduAccessories[0] || "") : "";
            rows.push([
                e.iduTags[0] || "AHU-", u.model || "", fp(u.airflow), fp(u.motorHp), u.motorType || "",
                fp(u.coolingEatDb), fp(u.coolingEatWb), fp(u.coolingLatDb), fp(u.coolingTotal), fp(u.coolingSensible),
                fp(u.heatPumpTotalCapacity), u.auxHeatKw || "", u.auxHeatTempRise || "",
                u.voltage || "", fp(u.mca), fp(u.mop), fp(u.weight),
                e.oduTag || "CU-", od.model || "", fp(od.heatingAmbient), fp(od.heatingTotal), od.heatingEfficiency || "",
                od.voltage || "", fp(od.mca), fp(od.mop), fp(od.coolingAmbient), od.refrigerant || "", od.efficiency || "",
                od.compressorStages || "", fp(od.weight), iduAcc
            ]);
        }

        doc.autoTable({
            startY: 45, head: [headRow1, headRow2], body: rows, theme: "grid",
            styles: { font: "helvetica", fontSize: 5.5, cellPadding: 1.5, halign: "center", valign: "middle", lineWidth: T, lineColor: [0,0,0] },
            headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: "bold", lineWidth: T },
            tableLineWidth: M, tableLineColor: [0,0,0],
            margin: { left: 15, right: 15 },
        });

        writePdfNotes(doc, "multi-position", 15);

        if (options && options.returnBlob) return doc.output("blob");
        doc.save("Multi Position Split Schedule.pdf");
        Project.showToast("Schedule exported as PDF", "toast-success");
    }


    // =====================================================================
    //  GAS PACKS — PDF
    // =====================================================================
    function exportGpSchedulePdf(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        var C = (typeof window.jspdf !== "undefined") ? window.jspdf.jsPDF : jsPDF;
        var doc = new C({ orientation: "landscape", unit: "pt", format: "tabloid" });
        var pw = doc.internal.pageSize.getWidth();
        var M = 1.0; var T = 0.25;

        doc.setFontSize(12); doc.setFont("helvetica", "bold");
        doc.text("PACKAGED ROOFTOP UNITS", pw / 2, 30, { align: "center" });

        var headRow1 = [
            { content: "TAG", rowSpan: 2 }, { content: "MAKE", rowSpan: 2 }, { content: "MODEL", rowSpan: 2 },
            { content: "NOM\nTONS", rowSpan: 2 }, { content: "FAN DATA", colSpan: 3 },
            { content: "COOLING PERFORMANCE", colSpan: 7 }, { content: "HEATING", colSpan: 4 },
            { content: "HGRH", rowSpan: 2 }, { content: "COOL\nSTAGES", rowSpan: 2 },
            { content: "ELECTRICAL", colSpan: 4 },
        ];
        var headRow2 = ["CFM","ESP","TESP","TOTAL","SENS.","EFF.","EDB","EWB","LDB","LWB","INPUT","OUTPUT","EAT","LAT","V/PH","HP","MCA","MOCP"];

        var rows = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i], s = DataLoader.getSystemById(e.systemId);
            if (!s) continue; var sc = s.schedule;
            rows.push([e.oduTag || "RTU-", sc.manufacturer || "", sc.model || "", fp(sc.nomTons),
                fp(sc.cfm), fp(sc.esp), fp(sc.tesp), fp(sc.coolingTotalCapacity), fp(sc.coolingSensibleCapacity),
                sc.efficiency || "", fp(sc.edb), fp(sc.ewb), fp(sc.ldb), fp(sc.lwb),
                fp(sc.heatingInput), fp(sc.heatingOutput), fp(sc.heatingEat), fp(sc.heatingLat),
                sc.hgrh || "", fp(sc.coolingStages), sc.voltage || "", fp(sc.motorHp), fp(sc.mca), fp(sc.mocp)]);
        }

        doc.autoTable({
            startY: 45, head: [headRow1, headRow2], body: rows, theme: "grid",
            styles: { font: "helvetica", fontSize: 6, cellPadding: 2, halign: "center", valign: "middle", lineWidth: T, lineColor: [0,0,0] },
            headStyles: { fillColor: [30, 80, 140], textColor: 255, fontStyle: "bold", lineWidth: T },
            tableLineWidth: M, tableLineColor: [0,0,0],
            margin: { left: 15, right: 15 },
        });

        writePdfNotes(doc, "gas-packs", 15);

        if (options && options.returnBlob) return doc.output("blob");
        doc.save("Gas Pack RTU Schedule.pdf");
        Project.showToast("Schedule exported as PDF", "toast-success");
    }


    // =====================================================================
    //  PDF Notes Writer (unified single section)
    // =====================================================================
    function writePdfNotes(doc, productKey, leftMargin) {
        var notes = Project.getProductActiveNotes(productKey);
        if (notes.length === 0) return;

        var nY = doc.lastAutoTable.finalY + 14;
        doc.setFontSize(8); doc.setFont("helvetica", "bold");
        doc.text("NOTES:", leftMargin, nY); nY += 10;
        doc.setFont("helvetica", "normal"); doc.setFontSize(7);
        for (var ni = 0; ni < notes.length; ni++) {
            doc.text((ni + 1) + "- " + notes[ni], leftMargin + 15, nY); nY += 9;
        }
    }


    // =====================================================================
    //  DXF EXPORT — Dispatch (simplified — removed for brevity,
    //  can be re-added later)
    // =====================================================================
    function exportScheduleDxf(options) {
        // DXF export temporarily simplified — PDF/Excel are the primary formats
        Project.showToast("DXF export coming soon", "toast-warning");
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
