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
    //  Column Visibility + Width Helpers for Export
    // =====================================================================
    function getExportVisibility() {
        var hidden = SchedulePreview.getHiddenColumns();
        return function(key) { return !hidden.has(key); };
    }

    function getExportWidths() {
        return SchedulePreview.getColumnWidths();
    }

    // Convert pixel widths to PDF points (approximate: 1px ≈ 0.75pt)
    function pxToPt(px) { return Math.round(px * 0.75); }

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
    //  Generic PDF Table Renderer (column-visibility & width aware)
    // =====================================================================
    function renderPdfTable(doc, title, sectionLabels, colDefs, groupDefs, dataRowBuilder, entries, productKey) {
        var pw = doc.internal.pageSize.getWidth();
        var M = 1.0; var T = 0.25; var lm = 15;
        var v = getExportVisibility();
        var visCols = colDefs.filter(function(c) { return c.always || v(c.key); });

        // Title bar
        doc.setDrawColor(0); doc.setLineWidth(M);
        var titleW = pw - 2 * lm;
        doc.rect(lm, 15, titleW, 18, "S");
        doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
        doc.text(title, pw / 2, 28, { align: "center" });
        var startY = 33;

        // Build header rows
        var headRows = [];

        // Section label row — as part of autoTable so it aligns with columns
        if (sectionLabels && sectionLabels.length === 2) {
            var indoorCount = 0, outdoorCount = 0, notesCount = 0;
            for (var si = 0; si < visCols.length; si++) {
                var k = visCols[si].key;
                if (k.indexOf("-notes") !== -1) notesCount++;
                else if (k.indexOf("-odu-") !== -1) outdoorCount++;
                else indoorCount++;
            }
            var secRow = [];
            if (indoorCount > 0) secRow.push({ content: sectionLabels[0], colSpan: indoorCount });
            if (outdoorCount > 0) secRow.push({ content: sectionLabels[1], colSpan: outdoorCount });
            if (notesCount > 0) secRow.push({ content: "", colSpan: notesCount });
            headRows.push(secRow);
        }

        // Group header row + sub-header row
        var headRow1 = [], headRow2 = [];
        for (var gi = 0; gi < groupDefs.length; gi++) {
            var grp = groupDefs[gi];
            var grpVisCols = grp.cols.filter(function(gk) {
                for (var ci = 0; ci < visCols.length; ci++) { if (visCols[ci].key === gk) return true; }
                return false;
            });
            if (grpVisCols.length === 0) continue;
            if (grp.sub) {
                headRow1.push({ content: grp.label, colSpan: grpVisCols.length });
                for (var sj = 0; sj < grpVisCols.length; sj++) {
                    var colDef2 = null;
                    for (var cj = 0; cj < visCols.length; cj++) { if (visCols[cj].key === grpVisCols[sj]) { colDef2 = visCols[cj]; break; } }
                    headRow2.push(colDef2 ? colDef2.subHeader : "");
                }
            } else {
                headRow1.push({ content: grp.label, rowSpan: 2 });
            }
        }
        headRows.push(headRow1);
        headRows.push(headRow2);

        // Build data rows
        var rows = [];
        for (var ri = 0; ri < entries.length; ri++) {
            var vals = dataRowBuilder(entries[ri]);
            if (!vals) continue;
            var row = [];
            for (var vi2 = 0; vi2 < visCols.length; vi2++) {
                row.push(vals[visCols[vi2].key] || "");
            }
            rows.push(row);
        }

        doc.autoTable({
            startY: startY, head: headRows, body: rows, theme: "grid",
            styles: { font: "helvetica", fontSize: 5.5, cellPadding: 1.5, halign: "center", valign: "middle", lineWidth: T, lineColor: [0,0,0], textColor: [0,0,0] },
            headStyles: { fillColor: [255,255,255], textColor: [0,0,0], fontStyle: "bold", lineWidth: M, lineColor: [0,0,0] },
            alternateRowStyles: { fillColor: [255,255,255] },
            tableLineWidth: M, tableLineColor: [0,0,0],
            margin: { left: lm, right: lm },
        });

        writePdfNotes(doc, productKey, lm, pw - 2 * lm);
    }

    // =====================================================================
    //  MINI SPLITS — PDF (simplified single-table)
    // =====================================================================
    function exportMsSchedulePdf(options) {
        var entries = (options && options.entries) ? options.entries : Project.getEntries();
        if (entries.length === 0) return;
        var C = (typeof window.jspdf !== "undefined") ? window.jspdf.jsPDF : jsPDF;
        var doc = new C({ orientation: "landscape", unit: "pt", format: "tabloid" });

        var colDefs = [
            {key:"ms-idu-sym",subHeader:"SYMBOL",always:true},{key:"ms-idu-cfm",subHeader:"CFM",always:true},
            {key:"ms-idu-cool-edb",subHeader:"EDB"},{key:"ms-idu-cool-ewb",subHeader:"EWB"},
            {key:"ms-idu-cool-total",subHeader:"TOTAL\nCAP.",always:true},{key:"ms-idu-cool-sens",subHeader:"SENS.\nCAP.",always:true},
            {key:"ms-idu-heat-edb",subHeader:"EDB"},{key:"ms-idu-heat-total",subHeader:"TOTAL\nCAP."},
            {key:"ms-idu-weight",subHeader:"OP.\nWEIGHT"},{key:"ms-idu-type",subHeader:"INDOOR\nTYPE"},
            {key:"ms-idu-voltage",subHeader:"Voltage"},{key:"ms-idu-mca",subHeader:"MCA"},{key:"ms-idu-mop",subHeader:"MOP"},
            {key:"ms-idu-mfg",subHeader:"MFG\nDAIKIN"},
            {key:"ms-odu-sym",subHeader:"SYMBOL",always:true},
            {key:"ms-odu-cool-amb",subHeader:"OA AMB\n(COOL)"},{key:"ms-odu-heat-amb",subHeader:"OA AMB\n(HEAT)"},
            {key:"ms-odu-weight",subHeader:"OP.\nWEIGHT"},{key:"ms-odu-seer",subHeader:"SEER2/EER2/\nHSPF2"},
            {key:"ms-odu-voltage",subHeader:"Voltage"},{key:"ms-odu-mca",subHeader:"MCA"},{key:"ms-odu-mop",subHeader:"MOP"},
            {key:"ms-odu-mfg",subHeader:"MFG\nDAIKIN"},{key:"ms-odu-refrig",subHeader:"REFRIG."},{key:"ms-odu-lineset",subHeader:"MAX LINE-SET"},
            {key:"ms-notes",subHeader:"NOTES",always:true},
        ];
        var groupDefs = [
            {label:"SYMBOL",cols:["ms-idu-sym"]},{label:"CFM",cols:["ms-idu-cfm"]},
            {label:"COOLING CAPACITY",cols:["ms-idu-cool-edb","ms-idu-cool-ewb","ms-idu-cool-total","ms-idu-cool-sens"],sub:true},
            {label:"HP HEATING",cols:["ms-idu-heat-edb","ms-idu-heat-total"],sub:true},
            {label:"OP.\nWEIGHT",cols:["ms-idu-weight"]},{label:"INDOOR\nTYPE",cols:["ms-idu-type"]},
            {label:"ELECTRICAL",cols:["ms-idu-voltage","ms-idu-mca","ms-idu-mop"],sub:true},
            {label:"MFG\nDAIKIN",cols:["ms-idu-mfg"]},
            {label:"SYMBOL",cols:["ms-odu-sym"]},
            {label:"OA AMB\n(COOL)",cols:["ms-odu-cool-amb"]},{label:"OA AMB\n(HEAT)",cols:["ms-odu-heat-amb"]},
            {label:"OP.\nWEIGHT",cols:["ms-odu-weight"]},{label:"SEER2/EER2/\nHSPF2",cols:["ms-odu-seer"]},
            {label:"ELECTRICAL",cols:["ms-odu-voltage","ms-odu-mca","ms-odu-mop"],sub:true},
            {label:"MFG\nDAIKIN",cols:["ms-odu-mfg"]},{label:"REFRIG.",cols:["ms-odu-refrig"]},{label:"LINE-SET",cols:["ms-odu-lineset"]},
            {label:"NOTES",cols:["ms-notes"]},
        ];
        var allRows = [];
        for (var i=0;i<entries.length;i++) {
            var e=entries[i], s=DataLoader.getSystemById(e.systemId); if (!s) continue;
            for (var j=0;j<s.indoorUnits.length;j++) {
                var u=s.indoorUnits[j], odu=s.outdoorUnit;
                var iduAcc=(e.iduAccessories&&j<e.iduAccessories.length)?(e.iduAccessories[j]||""):"";
                allRows.push(e);
            }
        }
        renderPdfTable(doc, "SPLIT SYSTEM SCHEDULE", ["INDOOR UNIT","OUTDOOR UNIT"], colDefs, groupDefs,
            function(entry) {
                var s=DataLoader.getSystemById(entry.systemId); if (!s) return null;
                var vals = {};
                for (var j=0;j<s.indoorUnits.length;j++) {
                    var u=s.indoorUnits[j], odu=s.outdoorUnit;
                    vals["ms-idu-sym"]=entry.iduTags[j]||"IDU-";vals["ms-idu-cfm"]=fp(u.cfm);
                    vals["ms-idu-cool-edb"]=fp(u.coolingEdb);vals["ms-idu-cool-ewb"]=fp(u.coolingEwb);vals["ms-idu-cool-total"]=fp(u.coolingTotal);vals["ms-idu-cool-sens"]=fp(u.coolingSensible);
                    vals["ms-idu-heat-edb"]=fp(u.heatingEdb);vals["ms-idu-heat-total"]=fp(u.heatingTotal);
                    vals["ms-idu-weight"]=fp(u.weight);vals["ms-idu-type"]=u.type||"";
                    vals["ms-idu-voltage"]=u.poweredFromOutdoor?"Powered From ODU":(u.voltage||"");vals["ms-idu-mca"]=u.poweredFromOutdoor?"":fp(u.mca);vals["ms-idu-mop"]=u.poweredFromOutdoor?"":fp(u.mop);
                    vals["ms-idu-mfg"]=u.manufacturer||"";
                    vals["ms-odu-sym"]=entry.oduTag||"ODU-";vals["ms-odu-cool-amb"]=fp(odu.coolingAmbient);vals["ms-odu-heat-amb"]=fp(odu.heatingAmbient);
                    vals["ms-odu-weight"]=fp(odu.weight);vals["ms-odu-seer"]=odu.seer||"";
                    vals["ms-odu-voltage"]=odu.voltage||"";vals["ms-odu-mca"]=fp(odu.mca);vals["ms-odu-mop"]=fp(odu.mop);
                    vals["ms-odu-mfg"]=odu.manufacturer||"";vals["ms-odu-refrig"]=odu.refrigerant||"";vals["ms-odu-lineset"]=odu.lineSet||"";
                    vals["ms-notes"]=(entry.iduAccessories&&j<entry.iduAccessories.length)?(entry.iduAccessories[j]||""):"";
                }
                return vals;
            }, entries, "mini-splits");

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
        var colDefs = [
            {key:"mps-idu-tag",subHeader:"TAG",always:true},{key:"mps-idu-model",subHeader:"MODEL",always:true},
            {key:"mps-idu-cfm",subHeader:"CFM"},{key:"mps-idu-hp",subHeader:"HP"},{key:"mps-idu-fan-type",subHeader:"TYPE"},
            {key:"mps-idu-eat-db",subHeader:"EAT DB"},{key:"mps-idu-eat-wb",subHeader:"EAT WB"},{key:"mps-idu-lat-db",subHeader:"LAT DB"},
            {key:"mps-idu-cool-total",subHeader:"TOTAL"},{key:"mps-idu-cool-sens",subHeader:"SENS."},
            {key:"mps-idu-hp-total",subHeader:"HP TOTAL\nCAP."},{key:"mps-idu-aux-kw",subHeader:"kW"},{key:"mps-idu-aux-rise",subHeader:"RISE"},
            {key:"mps-idu-voltage",subHeader:"V/PH"},{key:"mps-idu-mca",subHeader:"MCA"},{key:"mps-idu-mop",subHeader:"MOP"},
            {key:"mps-idu-weight",subHeader:"WEIGHT"},
            {key:"mps-odu-tag",subHeader:"TAG",always:true},{key:"mps-odu-model",subHeader:"MODEL",always:true},
            {key:"mps-odu-heat-amb",subHeader:"AMB DB"},{key:"mps-odu-heat-total",subHeader:"TOTAL"},{key:"mps-odu-heat-eff",subHeader:"EFF."},
            {key:"mps-odu-voltage",subHeader:"V/PH"},{key:"mps-odu-mca",subHeader:"MCA"},{key:"mps-odu-mop",subHeader:"MOP"},
            {key:"mps-odu-cool-amb",subHeader:"OA AMB\n(COOL)"},{key:"mps-odu-refrig",subHeader:"REFRIG."},
            {key:"mps-odu-eff",subHeader:"EFF."},{key:"mps-odu-comp",subHeader:"COMP."},{key:"mps-odu-weight",subHeader:"WEIGHT"},
            {key:"mps-notes",subHeader:"NOTES",always:true},
        ];
        var groupDefs = [
            {label:"TAG",cols:["mps-idu-tag"]},{label:"MODEL\n(DAIKIN)",cols:["mps-idu-model"]},
            {label:"SUPPLY FAN",cols:["mps-idu-cfm","mps-idu-hp","mps-idu-fan-type"],sub:true},
            {label:"COOLING",cols:["mps-idu-eat-db","mps-idu-eat-wb","mps-idu-lat-db","mps-idu-cool-total","mps-idu-cool-sens"],sub:true},
            {label:"HP TOTAL\nCAP.",cols:["mps-idu-hp-total"]},
            {label:"AUX. HEAT",cols:["mps-idu-aux-kw","mps-idu-aux-rise"],sub:true},
            {label:"ELECTRICAL",cols:["mps-idu-voltage","mps-idu-mca","mps-idu-mop"],sub:true},
            {label:"WEIGHT",cols:["mps-idu-weight"]},
            {label:"TAG",cols:["mps-odu-tag"]},{label:"MODEL\n(DAIKIN)",cols:["mps-odu-model"]},
            {label:"HP HEATING",cols:["mps-odu-heat-amb","mps-odu-heat-total","mps-odu-heat-eff"],sub:true},
            {label:"ELECTRICAL",cols:["mps-odu-voltage","mps-odu-mca","mps-odu-mop"],sub:true},
            {label:"OA AMB\n(COOL)",cols:["mps-odu-cool-amb"]},{label:"REFRIG.",cols:["mps-odu-refrig"]},
            {label:"EFF.",cols:["mps-odu-eff"]},{label:"COMP.",cols:["mps-odu-comp"]},{label:"WEIGHT",cols:["mps-odu-weight"]},
            {label:"NOTES",cols:["mps-notes"]},
        ];
        renderPdfTable(doc, "MULTI POSITION SPLIT SYSTEM SCHEDULE", ["INDOOR AIR HANDLING UNIT","OUTDOOR CONDENSING UNIT"], colDefs, groupDefs,
            function(entry) {
                var s=DataLoader.getSystemById(entry.systemId); if (!s) return null;
                var u=s.indoorUnits[0], od=s.outdoorUnit;
                var iduAcc=(entry.iduAccessories&&entry.iduAccessories.length>0)?(entry.iduAccessories[0]||""):"";
                return {"mps-idu-tag":entry.iduTags[0]||"AHU-","mps-idu-model":u.model||"","mps-idu-cfm":fp(u.airflow),"mps-idu-hp":fp(u.motorHp),"mps-idu-fan-type":u.motorType||"",
                    "mps-idu-eat-db":fp(u.coolingEatDb),"mps-idu-eat-wb":fp(u.coolingEatWb),"mps-idu-lat-db":fp(u.coolingLatDb),"mps-idu-cool-total":fp(u.coolingTotal),"mps-idu-cool-sens":fp(u.coolingSensible),
                    "mps-idu-hp-total":fp(u.heatPumpTotalCapacity),"mps-idu-aux-kw":u.auxHeatKw||"","mps-idu-aux-rise":u.auxHeatTempRise||"",
                    "mps-idu-voltage":u.voltage||"","mps-idu-mca":fp(u.mca),"mps-idu-mop":fp(u.mop),"mps-idu-weight":fp(u.weight),
                    "mps-odu-tag":entry.oduTag||"CU-","mps-odu-model":od.model||"","mps-odu-heat-amb":fp(od.heatingAmbient),"mps-odu-heat-total":fp(od.heatingTotal),"mps-odu-heat-eff":od.heatingEfficiency||"",
                    "mps-odu-voltage":od.voltage||"","mps-odu-mca":fp(od.mca),"mps-odu-mop":fp(od.mop),
                    "mps-odu-cool-amb":fp(od.coolingAmbient),"mps-odu-refrig":od.refrigerant||"","mps-odu-eff":od.efficiency||"","mps-odu-comp":od.compressorStages||"","mps-odu-weight":fp(od.weight),
                    "mps-notes":iduAcc};
            }, entries, "multi-position");
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
        var colDefs = [
            {key:"gp-tag",subHeader:"TAG",always:true},{key:"gp-model",subHeader:"MODEL",always:true},{key:"gp-tons",subHeader:"NOM\nTONS",always:true},
            {key:"gp-cfm",subHeader:"CFM"},{key:"gp-esp",subHeader:"ESP"},{key:"gp-tesp",subHeader:"TESP"},
            {key:"gp-cool-total",subHeader:"TOTAL\nCAP."},{key:"gp-cool-sens",subHeader:"SENS.\nCAP."},
            {key:"gp-eff",subHeader:"EFF."},{key:"gp-edb",subHeader:"EDB"},{key:"gp-ewb",subHeader:"EWB"},{key:"gp-ldb",subHeader:"LDB"},{key:"gp-lwb",subHeader:"LWB"},
            {key:"gp-heat-input",subHeader:"INPUT"},{key:"gp-heat-output",subHeader:"OUTPUT"},{key:"gp-heat-eat",subHeader:"EAT"},{key:"gp-heat-lat",subHeader:"LAT"},
            {key:"gp-hgrh",subHeader:"HGRH"},{key:"gp-cool-stages",subHeader:"COOL\nSTAGES"},
            {key:"gp-voltage",subHeader:"V/PH"},{key:"gp-hp",subHeader:"HP"},{key:"gp-mca",subHeader:"MCA"},{key:"gp-mocp",subHeader:"MOCP"},
            {key:"gp-notes",subHeader:"NOTES",always:true},
        ];
        var groupDefs = [
            {label:"TAG",cols:["gp-tag"]},{label:"MODEL",cols:["gp-model"]},{label:"NOM\nTONS",cols:["gp-tons"]},
            {label:"FAN DATA",cols:["gp-cfm","gp-esp","gp-tesp"],sub:true},
            {label:"COOLING PERFORMANCE",cols:["gp-cool-total","gp-cool-sens","gp-eff","gp-edb","gp-ewb","gp-ldb","gp-lwb"],sub:true},
            {label:"HEATING PERFORMANCE",cols:["gp-heat-input","gp-heat-output","gp-heat-eat","gp-heat-lat"],sub:true},
            {label:"HGRH",cols:["gp-hgrh"]},{label:"COOL\nSTAGES",cols:["gp-cool-stages"]},
            {label:"ELECTRICAL",cols:["gp-voltage","gp-hp","gp-mca","gp-mocp"],sub:true},
            {label:"NOTES",cols:["gp-notes"]},
        ];
        renderPdfTable(doc, "PACKAGED ROOFTOP UNITS", null, colDefs, groupDefs,
            function(entry) {
                var s=DataLoader.getSystemById(entry.systemId); if (!s) return null; var sc=s.schedule;
                return {"gp-tag":entry.oduTag||"RTU-","gp-model":sc.model||"","gp-tons":fp(sc.nomTons),
                    "gp-cfm":fp(sc.cfm),"gp-esp":fp(sc.esp),"gp-tesp":fp(sc.tesp),
                    "gp-cool-total":fp(sc.coolingTotalCapacity),"gp-cool-sens":fp(sc.coolingSensibleCapacity),
                    "gp-eff":sc.efficiency||"","gp-edb":fp(sc.edb),"gp-ewb":fp(sc.ewb),"gp-ldb":fp(sc.ldb),"gp-lwb":fp(sc.lwb),
                    "gp-heat-input":fp(sc.heatingInput),"gp-heat-output":fp(sc.heatingOutput),"gp-heat-eat":fp(sc.heatingEat),"gp-heat-lat":fp(sc.heatingLat),
                    "gp-hgrh":sc.hgrh||"","gp-cool-stages":fp(sc.coolingStages),
                    "gp-voltage":sc.voltage||"","gp-hp":fp(sc.motorHp),"gp-mca":fp(sc.mca),"gp-mocp":fp(sc.mocp),
                    "gp-notes":entry.outdoorAccessories||""};
            }, entries, "gas-packs");
        if (options && options.returnBlob) return doc.output("blob");
        doc.save("Gas Pack RTU Schedule.pdf");
        Project.showToast("Schedule exported as PDF", "toast-success");
    }


    // =====================================================================
    //  PDF Notes Writer (unified single section)
    // =====================================================================
    function writePdfNotes(doc, productKey, leftMargin, tableWidth) {
        var notes = Project.getProductActiveNotes(productKey);
        if (notes.length === 0) return;

        // Use actual table dimensions for perfect alignment
        var at = doc.lastAutoTable;
        var nY = at.finalY;
        var tblX = at.settings.margin.left || leftMargin;
        var tblW = at.table ? at.table.width : (tableWidth || 400);
        var noteLineH = 9;
        var boxH = 14 + (notes.length * noteLineH) + 4;

        // Draw only left, right, bottom borders (table's bottom border is the top)
        doc.setDrawColor(0); doc.setLineWidth(1.0);
        doc.line(tblX, nY, tblX, nY + boxH);                   // left
        doc.line(tblX + tblW, nY, tblX + tblW, nY + boxH);     // right
        doc.line(tblX, nY + boxH, tblX + tblW, nY + boxH);     // bottom

        doc.setFontSize(8); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
        doc.text("NOTES:", tblX + 4, nY + 10);
        doc.setFont("helvetica", "normal"); doc.setFontSize(7);
        for (var ni = 0; ni < notes.length; ni++) {
            doc.text((ni + 1) + "- " + notes[ni], tblX + 20, nY + 14 + 4 + (ni * noteLineH));
        }
    }


    // =====================================================================
    //  DXF EXPORT — Dispatch
    // =====================================================================
    function exportScheduleDxf(options) {
        var groups = groupEntriesByProduct();
        var hasMs = groups["mini-splits"] && groups["mini-splits"].length > 0;
        var hasMps = groups["multi-position"] && groups["multi-position"].length > 0;
        var hasGp = groups["gas-packs"] && groups["gas-packs"].length > 0;

        if (options && options.returnBlobs) {
            var blobs = [];
            if (hasMs) { var b = buildMsDxf(groups["mini-splits"]); if (b) blobs.push({ name: "Mini Split Schedule.dxf", blob: b }); }
            if (hasMps) { var b2 = buildMpsDxf(groups["multi-position"]); if (b2) blobs.push({ name: "Multi Position Split Schedule.dxf", blob: b2 }); }
            if (hasGp) { var b3 = buildGpDxf(groups["gas-packs"]); if (b3) blobs.push({ name: "Gas Pack RTU Schedule.dxf", blob: b3 }); }
            return blobs;
        }

        if (hasMs) { var msB = buildMsDxf(groups["mini-splits"]); if (msB) Project.downloadBlob(msB, "Mini Split Schedule.dxf"); }
        if (hasMps) { var mpsB = buildMpsDxf(groups["multi-position"]); if (mpsB) Project.downloadBlob(mpsB, "Multi Position Split Schedule.dxf"); }
        if (hasGp) { var gpB = buildGpDxf(groups["gas-packs"]); if (gpB) Project.downloadBlob(gpB, "Gas Pack RTU Schedule.dxf"); }
        Project.showToast("DXF schedule exported", "toast-success");
    }

    // =====================================================================
    //  DXF Rendering Engine
    // =====================================================================
    function renderDxf(title, sectionLabels, groupHeaders, subHeaders, colWidths, dataRows, notes) {
        var ROW_H = 15, HDR_H = 18, GRP_H = 16, TITLE_H = 22, LABEL_H = 18, NOTE_H = 10;
        var TXT_DATA = 3.5, TXT_HDR = 3.5, TXT_GRP = 4.5, TXT_TITLE = 7.0, TXT_LABEL = 5.0, TXT_NOTE = 3.0;
        var entities = [], handle = 100;
        function nh() { handle++; return handle.toString(16).toUpperCase(); }
        function ln(x1,y1,x2,y2,layer) { return "0\nLINE\n5\n"+nh()+"\n8\n"+(layer||"BORDERS")+"\n10\n"+x1.toFixed(4)+"\n20\n"+y1.toFixed(4)+"\n30\n0.0\n11\n"+x2.toFixed(4)+"\n21\n"+y2.toFixed(4)+"\n31\n0.0\n"; }
        function mt(x,y,h,text,layer,align) { var a=align||2; var ap=a===1?4:a===3?6:5; var ct=String(text).replace(/\n/g,"\\P"); return "0\nMTEXT\n5\n"+nh()+"\n8\n"+(layer||"DATA")+"\n10\n"+x.toFixed(4)+"\n20\n"+y.toFixed(4)+"\n30\n0.0\n40\n"+h.toFixed(2)+"\n71\n"+ap+"\n1\n"+ct+"\n"; }
        function rc(x,y,w,h,layer) { return ln(x,y,x+w,y,layer)+ln(x+w,y,x+w,y-h,layer)+ln(x+w,y-h,x,y-h,layer)+ln(x,y-h,x,y,layer); }
        function tw(widths) { var w=0; for(var i=0;i<widths.length;i++) w+=widths[i]; return w; }

        var X0=10, Y0=580, y=Y0;
        var tableW = tw(colWidths);

        // Title bar
        entities.push(rc(X0,y,tableW,TITLE_H,"TITLE"));
        entities.push(mt(X0+tableW/2, y-TITLE_H/2, TXT_TITLE, title, "TITLE", 2));
        y -= TITLE_H;

        // Section labels
        if (sectionLabels && sectionLabels.length === 2) {
            var halfW = tableW / 2;
            entities.push(rc(X0,y,halfW,LABEL_H,"HEADERS"));
            entities.push(mt(X0+halfW/2, y-LABEL_H/2, TXT_LABEL, sectionLabels[0], "HEADERS", 2));
            entities.push(rc(X0+halfW,y,halfW,LABEL_H,"HEADERS"));
            entities.push(mt(X0+halfW+halfW/2, y-LABEL_H/2, TXT_LABEL, sectionLabels[1], "HEADERS", 2));
            y -= LABEL_H;
        }

        // Group header row
        entities.push(rc(X0,y,tableW,GRP_H,"HEADERS"));
        for (var g=0; g<groupHeaders.length; g++) {
            var gh=groupHeaders[g], gx=X0;
            for (var gi=0; gi<gh.start; gi++) gx+=colWidths[gi];
            var gw=0; for (var gj=0; gj<gh.span; gj++) gw+=colWidths[gh.start+gj];
            if (gh.start > 0) entities.push(ln(gx,y,gx,y-GRP_H,"HEADERS"));
            entities.push(mt(gx+gw/2, y-GRP_H/2, TXT_GRP, gh.text, "HEADERS", 2));
        }
        y -= GRP_H;

        // Sub-header row
        entities.push(rc(X0,y,tableW,HDR_H,"HEADERS"));
        var hx=X0;
        for (var hi=0; hi<subHeaders.length; hi++) {
            if (hi > 0) entities.push(ln(hx,y,hx,y-HDR_H,"HEADERS"));
            entities.push(mt(hx+colWidths[hi]/2, y-HDR_H/2, TXT_HDR, subHeaders[hi], "HEADERS", 2));
            hx += colWidths[hi];
        }
        y -= HDR_H;

        // Data rows
        for (var ri=0; ri<dataRows.length; ri++) {
            var row=dataRows[ri];
            entities.push(rc(X0,y,tableW,ROW_H,"BORDERS"));
            var rx=X0, ci=0;
            for (var c=0; c<row.length; c++) {
                var cv=row[c], ct2="", cs=1;
                if (cv && typeof cv==="object" && cv.content) { ct2=cv.content; cs=cv.colSpan||1; } else { ct2=String(cv||""); }
                var cw=0; for(var s=0;s<cs;s++) cw+=colWidths[ci+s];
                if (ci > 0) entities.push(ln(rx,y,rx,y-ROW_H,"BORDERS"));
                if (ct2) entities.push(mt(rx+cw/2, y-ROW_H/2, TXT_DATA, ct2, "DATA", 2));
                rx+=cw; ci+=cs;
            }
            y -= ROW_H;
        }

        // Notes section (attached to bottom of table, no top border)
        if (notes && notes.length > 0) {
            var noteBoxH = 8 + notes.length * NOTE_H + 6;
            // Left, right, bottom only (top is last data row's bottom)
            entities.push(ln(X0, y, X0, y - noteBoxH, "BORDERS"));
            entities.push(ln(X0 + tableW, y, X0 + tableW, y - noteBoxH, "BORDERS"));
            entities.push(ln(X0, y - noteBoxH, X0 + tableW, y - noteBoxH, "BORDERS"));
            entities.push(mt(X0+4, y-6, TXT_HDR, "NOTES:", "HEADERS", 1));
            for (var ni=0; ni<notes.length; ni++) {
                entities.push(mt(X0+10, y-10-(ni*NOTE_H)-NOTE_H/2, TXT_NOTE, (ni+1)+"- "+notes[ni], "DATA", 1));
            }
        }

        // Assemble DXF file
        var dxf = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1027\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n";
        dxf += "0\nSECTION\n2\nTABLES\n0\nTABLE\n2\nLAYER\n70\n4\n";
        var layers = [{name:"BORDERS",color:7},{name:"HEADERS",color:7},{name:"DATA",color:7},{name:"TITLE",color:7}];
        for (var li=0;li<layers.length;li++) dxf += "0\nLAYER\n5\n"+nh()+"\n2\n"+layers[li].name+"\n70\n0\n62\n"+layers[li].color+"\n6\nContinuous\n";
        dxf += "0\nENDTAB\n0\nTABLE\n2\nSTYLE\n70\n1\n0\nSTYLE\n5\n"+nh()+"\n2\nSTANDARD\n70\n0\n40\n0.0\n41\n1.0\n50\n0.0\n71\n0\n42\n2.5\n3\ntxt\n4\n\n0\nENDTAB\n0\nENDSEC\n";
        dxf += "0\nSECTION\n2\nENTITIES\n" + entities.join("") + "0\nENDSEC\n0\nEOF\n";
        return new Blob([dxf], { type: "application/dxf" });
    }

    // =====================================================================
    //  MINI SPLITS — DXF
    // =====================================================================
    function buildMsDxf(entries) {
        var v = getExportVisibility(); var W = getExportWidths();
        var cols = [
            {k:"ms-idu-sym",h:"SYMBOL",a:true},{k:"ms-idu-cfm",h:"CFM",a:true},
            {k:"ms-idu-cool-edb",h:"EDB"},{k:"ms-idu-cool-ewb",h:"EWB"},
            {k:"ms-idu-cool-total",h:"TOTAL\nCAP.",a:true},{k:"ms-idu-cool-sens",h:"SENS.\nCAP.",a:true},
            {k:"ms-idu-heat-edb",h:"EDB"},{k:"ms-idu-heat-total",h:"TOTAL\nCAP."},
            {k:"ms-idu-weight",h:"OP.\nWEIGHT"},{k:"ms-idu-type",h:"INDOOR\nTYPE"},
            {k:"ms-idu-voltage",h:"VOLTAGE"},{k:"ms-idu-mca",h:"MCA"},{k:"ms-idu-mop",h:"MOP"},
            {k:"ms-idu-mfg",h:"MFG\nDAIKIN"},
            {k:"ms-odu-sym",h:"SYMBOL",a:true},
            {k:"ms-odu-cool-amb",h:"OA AMB\n(COOL)"},{k:"ms-odu-heat-amb",h:"OA AMB\n(HEAT)"},
            {k:"ms-odu-weight",h:"OP.\nWEIGHT"},{k:"ms-odu-seer",h:"SEER2/EER2\n/HSPF2"},
            {k:"ms-odu-voltage",h:"VOLTAGE"},{k:"ms-odu-mca",h:"MCA"},{k:"ms-odu-mop",h:"MOP"},
            {k:"ms-odu-mfg",h:"MFG\nDAIKIN"},{k:"ms-odu-refrig",h:"REFRIG."},{k:"ms-odu-lineset",h:"LINE-SET"},
            {k:"ms-notes",h:"NOTES",a:true},
        ];
        var vc = cols.filter(function(c){ return c.a || v(c.k); });
        var headers = vc.map(function(c){ return c.h; });
        var colWidths = vc.map(function(c){ return pxToPt(W[c.k]||60)/1.5; });
        var groupHeaders = [{text:"SPLIT SYSTEM SCHEDULE",start:0,span:vc.length}];
        var rows = [];
        for (var i=0;i<entries.length;i++) {
            var e=entries[i], s=DataLoader.getSystemById(e.systemId); if (!s) continue;
            for (var j=0;j<s.indoorUnits.length;j++) {
                var u=s.indoorUnits[j], odu=s.outdoorUnit;
                var iduAcc=(e.iduAccessories&&j<e.iduAccessories.length)?(e.iduAccessories[j]||""):"";
                var allVals={
                    "ms-idu-sym":e.iduTags[j]||"IDU-","ms-idu-cfm":fp(u.cfm),
                    "ms-idu-cool-edb":fp(u.coolingEdb),"ms-idu-cool-ewb":fp(u.coolingEwb),"ms-idu-cool-total":fp(u.coolingTotal),"ms-idu-cool-sens":fp(u.coolingSensible),
                    "ms-idu-heat-edb":fp(u.heatingEdb),"ms-idu-heat-total":fp(u.heatingTotal),
                    "ms-idu-weight":fp(u.weight),"ms-idu-type":u.type||"",
                    "ms-idu-voltage":u.voltage||"","ms-idu-mca":fp(u.mca),"ms-idu-mop":fp(u.mop),"ms-idu-mfg":u.manufacturer||"",
                    "ms-odu-sym":e.oduTag||"ODU-","ms-odu-cool-amb":fp(odu.coolingAmbient),"ms-odu-heat-amb":fp(odu.heatingAmbient),
                    "ms-odu-weight":fp(odu.weight),"ms-odu-seer":odu.seer||"",
                    "ms-odu-voltage":odu.voltage||"","ms-odu-mca":fp(odu.mca),"ms-odu-mop":fp(odu.mop),
                    "ms-odu-mfg":odu.manufacturer||"","ms-odu-refrig":odu.refrigerant||"","ms-odu-lineset":odu.lineSet||"",
                    "ms-notes":iduAcc,
                };
                rows.push(vc.map(function(c){ return allVals[c.k]||""; }));
            }
        }
        var notes = Project.getProductActiveNotes("mini-splits");
        return renderDxf("SPLIT SYSTEM SCHEDULE", ["INDOOR UNIT","OUTDOOR UNIT"], groupHeaders, headers, colWidths, rows, notes);
    }

    // =====================================================================
    //  MPS — DXF
    // =====================================================================
    function buildMpsDxf(entries) {
        var v = getExportVisibility(); var W = getExportWidths();
        var cols = [
            {k:"mps-idu-tag",h:"TAG",a:true},{k:"mps-idu-model",h:"MODEL",a:true},
            {k:"mps-idu-cfm",h:"CFM"},{k:"mps-idu-hp",h:"HP"},{k:"mps-idu-fan-type",h:"TYPE"},
            {k:"mps-idu-eat-db",h:"EAT DB"},{k:"mps-idu-eat-wb",h:"EAT WB"},{k:"mps-idu-lat-db",h:"LAT DB"},
            {k:"mps-idu-cool-total",h:"TOTAL"},{k:"mps-idu-cool-sens",h:"SENS."},
            {k:"mps-idu-hp-total",h:"HP TOTAL\nCAP."},{k:"mps-idu-aux-kw",h:"kW"},{k:"mps-idu-aux-rise",h:"RISE"},
            {k:"mps-idu-voltage",h:"V/PH"},{k:"mps-idu-mca",h:"MCA"},{k:"mps-idu-mop",h:"MOP"},
            {k:"mps-idu-weight",h:"WEIGHT"},
            {k:"mps-odu-tag",h:"TAG",a:true},{k:"mps-odu-model",h:"MODEL",a:true},
            {k:"mps-odu-heat-amb",h:"AMB DB"},{k:"mps-odu-heat-total",h:"TOTAL"},{k:"mps-odu-heat-eff",h:"EFF."},
            {k:"mps-odu-voltage",h:"V/PH"},{k:"mps-odu-mca",h:"MCA"},{k:"mps-odu-mop",h:"MOP"},
            {k:"mps-odu-cool-amb",h:"OA AMB\n(COOL)"},{k:"mps-odu-refrig",h:"REFRIG."},
            {k:"mps-odu-eff",h:"EFF."},{k:"mps-odu-comp",h:"COMP.\nSTAGES"},{k:"mps-odu-weight",h:"WEIGHT"},
            {k:"mps-notes",h:"NOTES",a:true},
        ];
        var vc = cols.filter(function(c){ return c.a || v(c.k); });
        var headers = vc.map(function(c){ return c.h; });
        var colWidths = vc.map(function(c){ return pxToPt(W[c.k]||60)/1.5; });
        var groupHeaders = [{text:"MULTI POSITION SPLIT SYSTEM SCHEDULE",start:0,span:vc.length}];
        var rows = [];
        for (var i=0;i<entries.length;i++) {
            var e=entries[i], s=DataLoader.getSystemById(e.systemId); if (!s) continue;
            var u=s.indoorUnits[0], od=s.outdoorUnit;
            var iduAcc=(e.iduAccessories&&e.iduAccessories.length>0)?(e.iduAccessories[0]||""):"";
            var allVals={
                "mps-idu-tag":e.iduTags[0]||"AHU-","mps-idu-model":u.model||"","mps-idu-cfm":fp(u.airflow),"mps-idu-hp":fp(u.motorHp),"mps-idu-fan-type":u.motorType||"",
                "mps-idu-eat-db":fp(u.coolingEatDb),"mps-idu-eat-wb":fp(u.coolingEatWb),"mps-idu-lat-db":fp(u.coolingLatDb),"mps-idu-cool-total":fp(u.coolingTotal),"mps-idu-cool-sens":fp(u.coolingSensible),
                "mps-idu-hp-total":fp(u.heatPumpTotalCapacity),"mps-idu-aux-kw":u.auxHeatKw||"","mps-idu-aux-rise":u.auxHeatTempRise||"",
                "mps-idu-voltage":u.voltage||"","mps-idu-mca":fp(u.mca),"mps-idu-mop":fp(u.mop),"mps-idu-weight":fp(u.weight),
                "mps-odu-tag":e.oduTag||"CU-","mps-odu-model":od.model||"","mps-odu-heat-amb":fp(od.heatingAmbient),"mps-odu-heat-total":fp(od.heatingTotal),"mps-odu-heat-eff":od.heatingEfficiency||"",
                "mps-odu-voltage":od.voltage||"","mps-odu-mca":fp(od.mca),"mps-odu-mop":fp(od.mop),
                "mps-odu-cool-amb":fp(od.coolingAmbient),"mps-odu-refrig":od.refrigerant||"","mps-odu-eff":od.efficiency||"","mps-odu-comp":od.compressorStages||"","mps-odu-weight":fp(od.weight),
                "mps-notes":iduAcc,
            };
            rows.push(vc.map(function(c){ return allVals[c.k]||""; }));
        }
        var notes = Project.getProductActiveNotes("multi-position");
        return renderDxf("MULTI POSITION SPLIT SYSTEM SCHEDULE", ["INDOOR AIR HANDLING UNIT","OUTDOOR CONDENSING UNIT"], groupHeaders, headers, colWidths, rows, notes);
    }

    // =====================================================================
    //  GAS PACKS — DXF
    // =====================================================================
    function buildGpDxf(entries) {
        var v = getExportVisibility(); var W = getExportWidths();
        var cols = [
            {k:"gp-tag",h:"TAG",a:true},{k:"gp-model",h:"MODEL",a:true},{k:"gp-tons",h:"NOM\nTONS",a:true},
            {k:"gp-cfm",h:"CFM"},{k:"gp-esp",h:"ESP"},{k:"gp-tesp",h:"TESP"},
            {k:"gp-cool-total",h:"TOTAL\nCAP."},{k:"gp-cool-sens",h:"SENS.\nCAP."},
            {k:"gp-eff",h:"EFF."},{k:"gp-edb",h:"EDB"},{k:"gp-ewb",h:"EWB"},{k:"gp-ldb",h:"LDB"},{k:"gp-lwb",h:"LWB"},
            {k:"gp-heat-input",h:"INPUT"},{k:"gp-heat-output",h:"OUTPUT"},{k:"gp-heat-eat",h:"EAT"},{k:"gp-heat-lat",h:"LAT"},
            {k:"gp-hgrh",h:"HGRH"},{k:"gp-cool-stages",h:"COOL\nSTAGES"},
            {k:"gp-voltage",h:"V/PH"},{k:"gp-hp",h:"HP"},{k:"gp-mca",h:"MCA"},{k:"gp-mocp",h:"MOCP"},
            {k:"gp-notes",h:"NOTES",a:true},
        ];
        var vc = cols.filter(function(c){ return c.a || v(c.k); });
        var headers = vc.map(function(c){ return c.h; });
        var colWidths = vc.map(function(c){ return pxToPt(W[c.k]||60)/1.5; });
        var groupHeaders = [{text:"PACKAGED ROOFTOP UNITS",start:0,span:vc.length}];
        var rows = [];
        for (var i=0;i<entries.length;i++) {
            var e=entries[i], s=DataLoader.getSystemById(e.systemId); if (!s) continue; var sc=s.schedule;
            var allVals={
                "gp-tag":e.oduTag||"RTU-","gp-model":sc.model||"","gp-tons":fp(sc.nomTons),
                "gp-cfm":fp(sc.cfm),"gp-esp":fp(sc.esp),"gp-tesp":fp(sc.tesp),
                "gp-cool-total":fp(sc.coolingTotalCapacity),"gp-cool-sens":fp(sc.coolingSensibleCapacity),
                "gp-eff":sc.efficiency||"","gp-edb":fp(sc.edb),"gp-ewb":fp(sc.ewb),"gp-ldb":fp(sc.ldb),"gp-lwb":fp(sc.lwb),
                "gp-heat-input":fp(sc.heatingInput),"gp-heat-output":fp(sc.heatingOutput),"gp-heat-eat":fp(sc.heatingEat),"gp-heat-lat":fp(sc.heatingLat),
                "gp-hgrh":sc.hgrh||"","gp-cool-stages":fp(sc.coolingStages),
                "gp-voltage":sc.voltage||"","gp-hp":fp(sc.motorHp),"gp-mca":fp(sc.mca),"gp-mocp":fp(sc.mocp),
                "gp-notes":e.outdoorAccessories||"",
            };
            rows.push(vc.map(function(c){ return allVals[c.k]||""; }));
        }
        var notes = Project.getProductActiveNotes("gas-packs");
        return renderDxf("PACKAGED ROOFTOP UNITS", null, groupHeaders, headers, colWidths, rows, notes);
    }


    // =====================================================================
    //  SINGLE-PRODUCT EXPORT FUNCTIONS (for per-tab download buttons)
    // =====================================================================
    async function exportSingleProductXlsx(productKey) {
        var groups = groupEntriesByProduct();
        var entries = groups[productKey];
        if (!entries || entries.length === 0) { Project.showToast("No entries for this tab", "toast-warning"); return; }
        if (productKey === "mini-splits") await exportMsScheduleXlsx({ entries: entries });
        else if (productKey === "multi-position") await exportMpsScheduleXlsx({ entries: entries });
        else if (productKey === "gas-packs") await exportGpScheduleXlsx({ entries: entries });
    }

    function exportSingleProductPdf(productKey) {
        var groups = groupEntriesByProduct();
        var entries = groups[productKey];
        if (!entries || entries.length === 0) { Project.showToast("No entries for this tab", "toast-warning"); return; }
        if (productKey === "mini-splits") exportMsSchedulePdf({ entries: entries });
        else if (productKey === "multi-position") exportMpsSchedulePdf({ entries: entries });
        else if (productKey === "gas-packs") exportGpSchedulePdf({ entries: entries });
    }

    function exportSingleProductDxf(productKey) {
        var groups = groupEntriesByProduct();
        var entries = groups[productKey];
        if (!entries || entries.length === 0) { Project.showToast("No entries for this tab", "toast-warning"); return; }
        var blob = null;
        var filename = "";
        if (productKey === "mini-splits") { blob = buildMsDxf(entries); filename = "Mini Split Schedule.dxf"; }
        else if (productKey === "multi-position") { blob = buildMpsDxf(entries); filename = "Multi Position Split Schedule.dxf"; }
        else if (productKey === "gas-packs") { blob = buildGpDxf(entries); filename = "Gas Pack RTU Schedule.dxf"; }
        if (blob) { Project.downloadBlob(blob, filename); Project.showToast("DXF schedule exported", "toast-success"); }
    }


    // -----------------------------------------------------------------------
    return {
        init: init,
        downloadAllDocuments: downloadAllDocuments,
        exportScheduleXlsx: exportScheduleXlsx,
        exportSchedulePdf: exportSchedulePdf,
        exportScheduleDxf: exportScheduleDxf,
        exportSingleProductXlsx: exportSingleProductXlsx,
        exportSingleProductPdf: exportSingleProductPdf,
        exportSingleProductDxf: exportSingleProductDxf,
    };
})();