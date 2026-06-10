/*
============================================================
  export.js  -  Schedule export (Excel + PDF)
============================================================

Exposes:

  HHpro.Export.toExcel(productKey, items, data, projectName)
  HHpro.Export.toPDF  (productKey, items, data, projectName)

Both build the same internal "grid" from the current schedule
state and then render it out.

EXCEL OUTPUT (.xlsx)
  A valid Office Open XML spreadsheet is built by hand using
  JSZip. No new third-party library is needed - JSZip is
  already vendored for the project's Files tab.

  All cells are white - per the project spec. Headers are
  bold; every cell has a thin black border. Merged cells are
  preserved (rowSpan + colSpan).

PDF OUTPUT
  Opens a clean, print-ready window showing the schedule
  laid out for landscape letter paper. The user's browser
  picks it up from there: File > Print > Save as PDF
  produces a PDF that matches the on-site layout (white
  cells, black text, thin borders).

  The print window is auto-populated and the print dialog
  is triggered automatically, so the workflow is a
  single click for the user.

WHAT'S IN THE GRID
  Column order:
    Tag / Outdoor Tag
    Indoor Tag           (Mini Splits + Multi Position Splits)
    (all visible data columns from the schedule, respecting
     Add/Remove Columns hidden state and horizontal merges)
    Configuration        (Marvair only)
    Accessories

  Header rows mirror the site's multi-row header structure
  (INDOOR UNIT over sub-groups, etc.) with the matching merges.

  The Remove/Docs action column is deliberately NOT exported.
============================================================
*/

(function () {
    'use strict';

    var HHpro = window.HHpro = window.HHpro || {};

    HHpro.Export = {
        // Toolbar entry points (download/print directly)
        toExcel: exportToExcel,
        toPDF:   exportToPDF,
        toCAD:   exportToCAD,

        // Grid + blob factories - used by the Files-tab zip pipeline,
        // which needs schedule files as blobs rather than direct
        // downloads. Each blob factory takes an array of {title, grid}
        // entries so the same path serves a single per-unit schedule
        // and a multi-section combined schedule.
        buildScheduleGrid:        buildScheduleGrid,
        buildScheduleGridForItem: buildScheduleGridForItem,
        getExportScheduleTitle:   getExportScheduleTitle,
        productTabLabel:          productTabLabel,
        xlsxBlobFromSections:     xlsxBlobFromSections,
        dxfBlobFromSections:      dxfBlobFromSections,
        pdfBlobFromSections:      pdfBlobFromSections
    };

    // =================================================================
    // Public entry points
    // =================================================================

    function exportToExcel(productKey, items, data, projectName) {
        if (!window.JSZip) {
            alert('JSZip is not loaded - cannot export Excel.');
            return;
        }
        var grid = buildScheduleGrid(productKey, items, data);
        if (!grid || !grid.rows.length) {
            alert('Nothing to export - this tab has no items yet.');
            return;
        }

        var title = data.scheduleTitle || 'Schedule';
        generateXlsxBlob(title, grid).then(function (blob) {
            var safeName = safeFilename(projectName) + ' - ' +
                           safeFilename(productTabLabel(productKey)) + '.xlsx';
            downloadBlob(blob, safeName);
        }).catch(function (err) {
            alert('Excel export failed: ' + (err && err.message ? err.message : err));
        });
    }

    function exportToPDF(productKey, items, data, projectName) {
        var grid = buildScheduleGrid(productKey, items, data);
        if (!grid || !grid.rows.length) {
            alert('Nothing to export - this tab has no items yet.');
            return;
        }
        openPrintWindow(productTabLabel(productKey), projectName, grid);
    }

    function exportToCAD(productKey, items, data, projectName) {
        var grid = buildScheduleGrid(productKey, items, data);
        if (!grid || !grid.rows.length) {
            alert('Nothing to export - this tab has no items yet.');
            return;
        }
        var sections = [{ title: getExportScheduleTitle(productKey), grid: grid }];
        dxfBlobFromSections(sections).then(function (blob) {
            var safeName = safeFilename(projectName) + ' - ' +
                           safeFilename(productTabLabel(productKey)) + '.dxf';
            downloadBlob(blob, safeName);
        }).catch(function (err) {
            alert('CAD export failed: ' + (err && err.message ? err.message : err));
        });
    }

    // Build a schedule grid containing only a single cart item. Used
    // by the Files tab to produce per-unit schedules.
    function buildScheduleGridForItem(productKey, item, data) {
        return buildScheduleGrid(productKey, [item], data);
    }

    // =================================================================
    // Schedule grid builder
    // -----------------------------------------------------------------
    // Builds a 2D cell grid that can be rendered as either XLSX or
    // HTML for print. Each cell is an object { value, rowSpan,
    // colSpan, bold }. Covered-by-merge positions are left as null.
    //
    // Result shape:
    //   {
    //     rows:        [ [ cell | null, ... ], ... ],
    //     merges:      [ { r1, c1, r2, c2 }, ... ],
    //     numHeaderRows: N,
    //     colCount:    M,
    //     colWidths:   [ characterWidth, ... ]   (for XLSX)
    //   }
    // =================================================================

    function buildScheduleGrid(productKey, items, data) {
        var extra = (HHpro.Cart && HHpro.Cart.getProjectExtra)
            ? HHpro.Cart.getProjectExtra(productKey) || {} : {};
        var hidden = Array.isArray(extra.hiddenColumns) ? extra.hiddenColumns.slice() : [];
        var hiddenSet = {};
        hidden.forEach(function (l) { hiddenSet[l] = true; });

        var allLetters = (data.scheduleHeader && data.scheduleHeader.columnLetters) || [];
        var visibleLetters = allLetters.filter(function (l) { return !hiddenSet[l]; });
        if (!visibleLetters.length) visibleLetters = allLetters.slice();

        // Resolve selections for each item. If a selection can't be
        // matched (e.g. data was regenerated and ids changed) we skip
        // the item entirely - a warning would be noisy here.
        var entries = [];
        items.forEach(function (it) {
            var sel = findSelectionById(data, it.selectionId);
            if (!sel) return;
            entries.push({ item: it, selection: sel });
        });

        if (!entries.length) {
            return { rows: [], merges: [], numHeaderRows: 0, dataEndRow: 0, colCount: 0, colWidths: [] };
        }

        var showIndoor = hasIndoorTagColumn(productKey);
        var showConfig = hasConfigurationColumn(productKey);
        var showServes = hasServesColumn(productKey);
        var showAcc    = hasAccessoriesColumn(productKey);

        // Column layout. Left-to-right:
        //   [Tag] [Serves?] [Indoor Tag?] [...data columns...] [Configuration?] [Accessories?]
        var tagCol = 0;
        var nextLeft = 1;
        var servesCol = showServes ? nextLeft++ : -1;
        var indoorTagCol = showIndoor ? nextLeft++ : -1;
        var dataStartCol = nextLeft;
        var dataEndCol = dataStartCol + visibleLetters.length - 1;
        var nextRight = dataEndCol + 1;
        var configCol = showConfig ? nextRight++ : -1;
        var accCol = showAcc ? nextRight++ : -1;
        var colCount = nextRight;    // one past the last used column

        var letterToCol = {};
        visibleLetters.forEach(function (l, i) { letterToCol[l] = dataStartCol + i; });
        var visibleSet = {};
        visibleLetters.forEach(function (l) { visibleSet[l] = true; });

        // --- Pick displayed header rows from the product JSON --------
        // The first row is always the merged schedule title the
        // converter produced; we skip it here and supply our own
        // canonical title (see getExportScheduleTitle below).
        var headerRows = (data.scheduleHeader && data.scheduleHeader.rows) || [];
        var startIdx = 0;
        if (headerRows.length > 1 &&
            headerRows[0].length === 1 &&
            headerRows[0][0].value === data.scheduleTitle) {
            startIdx = 1;
        }
        var displayHeader = headerRows.slice(startIdx);
        if (!displayHeader.length) displayHeader = [[]];
        var numColHeaderRows = displayHeader.length;

        var rows = [];
        var merges = [];

        // --- Row 0: title row spanning the full schedule width ------
        var titleText = getExportScheduleTitle(productKey);
        putCell(rows, merges, 0, 0,
                { value: titleText, bold: true, title: true },
                1, colCount);
        var titleRowCount = 1;

        // Header rows start right after the title row
        var headerStartRow = titleRowCount;
        var numHeaderRows = titleRowCount + numColHeaderRows;

        // Tag header
        putCell(rows, merges, headerStartRow, tagCol,
                { value: getPrimaryTagLabel(productKey), bold: true },
                numColHeaderRows, 1);

        // Serves header (between Tag and Indoor Tag for flagged products)
        if (showServes) {
            putCell(rows, merges, headerStartRow, servesCol,
                    { value: 'Serves', bold: true },
                    numColHeaderRows, 1);
        }

        // Indoor Tag header
        if (showIndoor) {
            putCell(rows, merges, headerStartRow, indoorTagCol,
                    { value: 'Indoor Tag', bold: true },
                    numColHeaderRows, 1);
        }

        // Data column headers (with their row/col merges)
        displayHeader.forEach(function (hdrRow, rowIdx) {
            hdrRow.forEach(function (cell) {
                var startAll = allLetters.indexOf(cell.col);
                if (startAll < 0) return;
                var origColspan = cell.colspan || 1;
                // Compute the leftmost visible column this merge covers
                // + how many visible columns in total.
                var firstVisibleCol = -1;
                var visibleSpan = 0;
                for (var i = 0; i < origColspan; i++) {
                    var letter = allLetters[startAll + i];
                    if (visibleSet[letter]) {
                        if (firstVisibleCol === -1) firstVisibleCol = letterToCol[letter];
                        visibleSpan++;
                    }
                }
                if (visibleSpan === 0) return;
                var val = (cell.value !== null && cell.value !== undefined)
                    ? String(cell.value) : '';
                var rowspan = cell.rowspan || 1;
                putCell(rows, merges, headerStartRow + rowIdx, firstVisibleCol,
                        { value: val, bold: true },
                        rowspan, visibleSpan);
            });
        });

        // Configuration header
        if (showConfig) {
            putCell(rows, merges, headerStartRow, configCol,
                    { value: 'Configuration', bold: true },
                    numColHeaderRows, 1);
        }

        // Accessories header (unless opted out via data.js)
        if (showAcc) {
            putCell(rows, merges, headerStartRow, accCol,
                    { value: 'Accessories', bold: true },
                    numColHeaderRows, 1);
        }

        // --- Data rows ------------------------------------------------
        var curRow = numHeaderRows;

        entries.forEach(function (entry) {
            var item = entry.item;
            var sel = entry.selection;
            var numItemRows = sel.rows.length;

            // Add the rows to the grid
            for (var rr = 0; rr < numItemRows; rr++) {
                rows.push(new Array(colCount).fill(null));
            }

            // Tag (rowSpan over all sub-rows of the selection)
            putCell(rows, merges, curRow, tagCol,
                    { value: item.tag || '', dataRow: true },
                    numItemRows, 1);

            // Serves (rowSpan over all sub-rows) - free-text value
            // stored on the cart item by the project-view renderer
            if (showServes) {
                putCell(rows, merges, curRow, servesCol,
                        { value: item.serves || '', dataRow: true },
                        numItemRows, 1);
            }

            // Indoor Tag - one per sub-row
            if (showIndoor) {
                for (var ir = 0; ir < numItemRows; ir++) {
                    var tag = '';
                    if (Array.isArray(item.indoorTags)) tag = item.indoorTags[ir] || '';
                    putCell(rows, merges, curRow + ir, indoorTagCol,
                            { value: tag, dataRow: true }, 1, 1);
                }
            }

            // Data cells (use computeCellLayout to preserve the same
            // merge pattern the on-screen schedule shows)
            var layout = computeCellLayout(sel, visibleLetters);
            for (var rIdx = 0; rIdx < numItemRows; rIdx++) {
                visibleLetters.forEach(function (letter) {
                    var cell = layout[rIdx][letter];
                    if (!cell) return;             // covered by a merge above
                    var targetCol = letterToCol[letter];
                    putCell(rows, merges,
                            curRow + rIdx, targetCol,
                            { value: formatCellValue(cell.value, letter, productKey), dataRow: true },
                            cell.rowSpan || 1,
                            cell.colSpan || 1);
                });
            }

            // Configuration (rowSpan over all sub-rows)
            if (showConfig) {
                putCell(rows, merges, curRow, configCol,
                        { value: item.configuration || '', dataRow: true },
                        numItemRows, 1);
            }

            // Accessories (rowSpan over all sub-rows) - centered
            // like every other data cell, not left-aligned.
            if (showAcc) {
                putCell(rows, merges, curRow, accCol,
                        { value: item.accessories || '', dataRow: true },
                        numItemRows, 1);
            }

            curRow += numItemRows;
        });

        var dataEndRow = curRow;   // first row NOT in data (i.e. notes start here)

        // --- Schedule notes section ----------------------------------
        // Notes section now embeds the watermark as the bottom row of
        // the last notes box (it shares the box's border so it reads
        // as part of the notes section rather than a stray footer).
        appendNotesSection(rows, merges, colCount, productKey, data, curRow);

        // Column width heuristics (Excel character units)
        var colWidths = computeColumnWidths(
            rows, colCount, tagCol, servesCol, indoorTagCol, dataStartCol,
            dataEndCol, configCol, accCol, showServes, showIndoor,
            showConfig, showAcc
        );

        return {
            rows: rows,
            merges: merges,
            numHeaderRows: numHeaderRows,       // includes title + col headers
            titleRowCount: titleRowCount,
            dataEndRow: dataEndRow,
            colCount: colCount,
            colWidths: colWidths
        };
    }

    // =================================================================
    // Schedule notes appended after the data rows
    // -----------------------------------------------------------------
    // For Marvair schedules we emit three sections (STANDARD,
    // CONFIGURATION, OPTIONAL) to match the on-screen layout.
    // For everything else we emit a single SCHEDULE NOTES section.
    //
    // User-added custom notes (from the Custom project notes row) are
    // included inline with continued numbering.
    // =================================================================

    function appendNotesSection(rows, merges, colCount, productKey, data, startRow) {
        var notes = collectVisibleNotes(productKey, data);
        var r = startRow;
        // Cell descriptor for the watermark line. Always emitted as the
        // last row of whatever notes box is last so it sits inside the
        // section's outer border rather than below it.
        var watermarkFooter = {
            value: 'Created with HHpro-HVAC.com',
            watermark: true,
            align: 'right'
        };

        if (notes.format === 'marvair') {
            // Build the OPTIONAL list first so we know whether STANDARD
            // is the last box (and thus whether STANDARD takes the
            // watermark or OPTIONAL does).
            var optionalLines = [];
            var optNum = 1;
            notes.optional.forEach(function (opt) {
                optionalLines.push(optNum + '. ' + opt.text);
                optNum++;
                opt.sub.forEach(function (s) {
                    optionalLines.push('    \u2013 ' + s);
                });
            });
            notes.customAdded.forEach(function (text) {
                optionalLines.push(optNum + '. ' + text);
                optNum++;
            });

            var hasStandard = notes.standard.length > 0;
            var hasOptional = optionalLines.length > 0;

            if (hasStandard) {
                r = emitNotesBox(rows, merges, colCount, r,
                    'STANDARD OPTIONS/ACCESSORIES:',
                    notes.standard.map(function (text, i) {
                        return (i + 1) + '. ' + text;
                    }),
                    hasOptional ? null : watermarkFooter);
            }
            if (hasOptional) {
                r = emitNotesBox(rows, merges, colCount, r,
                    'OPTIONAL ACCESSORIES:', optionalLines,
                    watermarkFooter);
            }
            return;
        }

        // Simple list format (Gas Packs, Mini Splits, Multi Position Splits)
        if (notes.notes.length) {
            var lines = notes.notes.map(function (text, i) {
                return (i + 1) + '. ' + text;
            });
            emitNotesBox(rows, merges, colCount, r, 'SCHEDULE NOTES:', lines, watermarkFooter);
        }
    }

    /**
     * Emit one notes section as a single bordered "box": the section
     * header plus each note line share an outer frame (top of the box
     * on the first row, bottom of the box on the last row, left+right
     * on every row); there are no horizontal lines between rows inside
     * the box. This matches the "schedule notes" look the user asked
     * for (one outer border around the whole section, no per-row
     * inner borders).
     *
     * `header` is the bold section title (e.g. "SCHEDULE NOTES:" or
     * "STANDARD OPTIONS/ACCESSORIES:"). Pass null to skip it, in which
     * case the first line becomes the top of the box.
     */
    function emitNotesBox(rows, merges, colCount, r, header, lines, footerCell) {
        var totalRows = (header ? 1 : 0) + lines.length + (footerCell ? 1 : 0);
        if (totalRows === 0) return r;

        var firstRow = r;
        var lastRow = r + totalRows - 1;

        function posFor(rowIdx) {
            if (firstRow === lastRow) return 'only';
            if (rowIdx === firstRow) return 'first';
            if (rowIdx === lastRow) return 'last';
            return 'middle';
        }

        if (header) {
            putCell(rows, merges, r, 0, {
                value: header, bold: true, align: 'left',
                notesRow: true, borderPos: posFor(r)
            }, 1, colCount);
            r++;
        }

        lines.forEach(function (line) {
            putCell(rows, merges, r, 0, {
                value: line, align: 'left',
                notesRow: true, borderPos: posFor(r)
            }, 1, colCount);
            r++;
        });

        if (footerCell) {
            // Caller's flags (watermark, align, etc.) plus the
            // notes-row borders so the footer sits inside the box's
            // outer frame.
            var cellData = {};
            for (var k in footerCell) {
                if (Object.prototype.hasOwnProperty.call(footerCell, k)) {
                    cellData[k] = footerCell[k];
                }
            }
            cellData.notesRow = true;
            cellData.borderPos = posFor(r);
            putCell(rows, merges, r, 0, cellData, 1, colCount);
            r++;
        }

        return r;
    }

    /**
     * Merge data.scheduleNotes with the user's state-level edits
     * (deleted built-ins, added custom notes, removed customs) to
     * produce the notes that should actually print on the schedule.
     */
    function collectVisibleNotes(productKey, data) {
        var sn = data.scheduleNotes;
        var extra = (HHpro.Cart && HHpro.Cart.getProjectExtra)
            ? HHpro.Cart.getProjectExtra(productKey) || {} : {};
        var nstate = extra.scheduleNotesState || {};
        var deletedIndices = Array.isArray(nstate.deletedIndices)
            ? nstate.deletedIndices : [];
        var deletedSet = {};
        deletedIndices.forEach(function (i) { deletedSet[i] = true; });

        var customAdded = Array.isArray(nstate.customAdded)
            ? nstate.customAdded : [];
        var deletedCustomIds = Array.isArray(nstate.deletedCustomIds)
            ? nstate.deletedCustomIds : [];
        var hiddenCustom = {};
        deletedCustomIds.forEach(function (id) { hiddenCustom[id] = true; });
        var visibleCustom = customAdded
            .filter(function (a) { return a && a.id && !hiddenCustom[a.id]; })
            .map(function (a) { return String(a.text || ''); });

        if (sn && sn.format === 'marvair') {
            return {
                format: 'marvair',
                standard: (sn.standard || []).map(function (x) { return String(x); }),
                configuration: (sn.configuration || []).map(function (x) { return String(x); }),
                optional: (sn.optional || [])
                    .map(function (o, idx) {
                        return {
                            text: String(o && o.text || ''),
                            sub: (o && Array.isArray(o.sub) ? o.sub : []).map(String),
                            __hidden: !!deletedSet[idx]
                        };
                    })
                    .filter(function (o) { return !o.__hidden; }),
                customAdded: visibleCustom
            };
        }

        // Legacy / list format
        var rawList = [];
        if (sn && Array.isArray(sn.notes)) rawList = sn.notes;
        else if (Array.isArray(sn)) rawList = sn;
        var visibleBuiltIn = rawList
            .filter(function (_, i) { return !deletedSet[i]; })
            .map(function (n) { return String(n || ''); });
        return {
            format: 'list',
            notes: visibleBuiltIn.concat(visibleCustom)
        };
    }

    /**
     * Canonical schedule title used at the top of the exported
     * schedule (Excel + PDF). Matches the titles the user requested.
     */
    function getExportScheduleTitle(productKey) {
        var titles = {
            'gas_packs':              'PACKAGED ROOFTOP UNIT SCHEDULE',
            'marvair':                'VERTICAL WALL MOUNTED PACKAGED SCHEDULE',
            'mini_splits':            'MINI SPLIT SCHEDULE',
            'multi_position_splits':  'MULTI POSITION SPLIT SCHEDULE',
            'gas_splits':             'GAS SPLIT SCHEDULE',
            'vfds':                   'VFD SCHEDULE'
        };
        return titles[productKey] || 'SCHEDULE';
    }

    // -----------------------------------------------------------------
    // Cell placement helper: writes a cell value at (r, c), marks any
    // covered positions with { covered: true } so the XLSX exporter
    // can emit bordered empty cells for them (otherwise merged ranges
    // look like they have missing borders in Excel).
    // -----------------------------------------------------------------
    function putCell(rows, merges, r, c, cellData, rowSpan, colSpan) {
        rowSpan = rowSpan || 1;
        colSpan = colSpan || 1;
        // Extend rows if needed
        while (rows.length < r + rowSpan) rows.push([]);
        for (var rr = r; rr < r + rowSpan; rr++) {
            while (rows[rr].length < c + colSpan) rows[rr].push(null);
        }
        rows[r][c] = {
            value: (cellData.value === undefined || cellData.value === null)
                    ? '' : cellData.value,
            rowSpan: rowSpan,
            colSpan: colSpan,
            bold: !!cellData.bold,
            title: !!cellData.title,
            align: cellData.align || '',
            notesRow: !!cellData.notesRow,
            dataRow: !!cellData.dataRow,
            borderPos: cellData.borderPos || '',
            watermark: !!cellData.watermark
        };
        // Mark every covered position so neither the XLSX nor the
        // HTML-for-PDF renderer overwrites it later, AND so the XLSX
        // can emit an empty <c> element there with the bordered
        // style (fixes the "missing borders on merged cells" bug).
        for (var rr2 = r; rr2 < r + rowSpan; rr2++) {
            for (var cc2 = c; cc2 < c + colSpan; cc2++) {
                if (rr2 === r && cc2 === c) continue;
                rows[rr2][cc2] = { covered: true };
            }
        }
        if (rowSpan > 1 || colSpan > 1) {
            merges.push({
                r1: r, c1: c,
                r2: r + rowSpan - 1, c2: c + colSpan - 1
            });
        }
    }

    // -----------------------------------------------------------------
    // Pick reasonable column widths (in Excel character units) based
    // on column purpose + longest content. Wide Accessories, narrow
    // numeric columns.
    // -----------------------------------------------------------------
    function computeColumnWidths(rows, colCount, tagCol, servesCol,
                                 indoorTagCol, dataStartCol, dataEndCol,
                                 configCol, accCol, showServes, showIndoor,
                                 showConfig, showAcc) {
        var widths = new Array(colCount).fill(10);
        // Base widths per role
        widths[tagCol] = 11;
        if (showServes) widths[servesCol] = 24;
        if (showIndoor) widths[indoorTagCol] = 11;
        if (showConfig) widths[configCol] = 20;
        if (showAcc) widths[accCol] = 30;

        // Auto-fit data columns to their content's max length,
        // clamped so nothing is ridiculously wide.
        for (var c = dataStartCol; c <= dataEndCol; c++) {
            var maxLen = 6;
            for (var r = 0; r < rows.length; r++) {
                var cell = rows[r] && rows[r][c];
                if (!cell || !cell.value) continue;
                var s = String(cell.value);
                if (s.length > maxLen) maxLen = s.length;
            }
            // Add small margin; cap at 22 chars so even long model
            // numbers don't blow out the whole sheet.
            widths[c] = Math.min(Math.max(maxLen + 1, 7), 22);
        }
        return widths;
    }

    // =================================================================
    // XLSX generation (OOXML + JSZip)
    // =================================================================

    function generateXlsxBlob(sheetTitle, grid) {
        return generateXlsxBlobMulti([{ title: sheetTitle, grid: grid }]);
    }

    /**
     * Build a multi-sheet xlsx blob. sheets = [{title, grid}, ...].
     * Each section becomes its own worksheet in the workbook.
     */
    function generateXlsxBlobMulti(sheets) {
        var zip = new window.JSZip();
        var safeSheets = dedupeSheetNames(sheets.map(function (s) {
            return { title: sanitizeSheetName(s.title || 'Schedule'), grid: s.grid };
        }));

        zip.file('[Content_Types].xml', contentTypesXmlMulti(safeSheets.length));
        zip.file('_rels/.rels', rootRelsXml());
        zip.file('xl/workbook.xml', workbookXmlMulti(safeSheets));
        zip.file('xl/_rels/workbook.xml.rels', workbookRelsXmlMulti(safeSheets.length));
        zip.file('xl/styles.xml', stylesXml());
        safeSheets.forEach(function (s, i) {
            zip.file('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s.grid));
        });
        return zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            compression: 'DEFLATE'
        });
    }

    /** Public blob factory for the Files-tab zip pipeline. */
    function xlsxBlobFromSections(sections) {
        return generateXlsxBlobMulti(sections);
    }

    // Excel disallows duplicate sheet names; append " (2)", " (3)" etc.
    function dedupeSheetNames(sheets) {
        var seen = {};
        return sheets.map(function (s) {
            var base = s.title;
            var name = base;
            var n = 2;
            while (seen[name.toLowerCase()]) {
                var suffix = ' (' + n + ')';
                var room = 31 - suffix.length;
                name = (base.length > room ? base.slice(0, room) : base) + suffix;
                n++;
            }
            seen[name.toLowerCase()] = true;
            return { title: name, grid: s.grid };
        });
    }

    function contentTypesXmlMulti(sheetCount) {
        var overrides = '';
        for (var i = 1; i <= sheetCount; i++) {
            overrides += '<Override PartName="/xl/worksheets/sheet' + i +
                '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }
        return XML_HEADER +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
              '<Default Extension="xml" ContentType="application/xml"/>' +
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
              '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
              overrides +
              '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            '</Types>';
    }

    function workbookXmlMulti(sheets) {
        var sheetTags = sheets.map(function (s, i) {
            return '<sheet name="' + xmlEscape(s.title) + '" sheetId="' + (i + 1) +
                   '" r:id="rId' + (i + 1) + '"/>';
        }).join('');
        return XML_HEADER +
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
                     ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
              '<sheets>' + sheetTags + '</sheets>' +
            '</workbook>';
    }

    function workbookRelsXmlMulti(sheetCount) {
        var rels = '';
        for (var i = 1; i <= sheetCount; i++) {
            rels += '<Relationship Id="rId' + i +
                '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"' +
                ' Target="worksheets/sheet' + i + '.xml"/>';
        }
        // Styles relationship id is one past the last sheet relationship
        var stylesId = sheetCount + 1;
        rels += '<Relationship Id="rId' + stylesId +
            '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
        return XML_HEADER +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              rels +
            '</Relationships>';
    }

    function rootRelsXml() {
        return XML_HEADER +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
            '</Relationships>';
    }

    /**
     * Four cell style indexes referenced from cells in sheet1.xml:
     *   s="0"   default (unused)
     *   s="1"   data cell - border, centered horizontally + vertically, wrap
     *   s="2"   header cell - bold, border, centered, wrap
     *   s="3"   left-aligned text cell - used for Accessories which
     *           is typically longer multi-word text that reads better
     *           left-aligned than centered
     */
    function stylesXml() {
        return XML_HEADER +
            '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
              '<fonts count="4">' +
                // fontId 0 - default body text
                '<font><sz val="10"/><name val="Calibri"/></font>' +
                // fontId 1 - bold body text (column headers, notes section headers)
                '<font><b/><sz val="10"/><name val="Calibri"/></font>' +
                // fontId 2 - bold larger text for the schedule title
                '<font><b/><sz val="14"/><name val="Calibri"/></font>' +
                // fontId 3 - faint italic for the footer watermark
                '<font><i/><sz val="9"/><color rgb="FF999999"/><name val="Calibri"/></font>' +
              '</fonts>' +
              '<fills count="2">' +
                '<fill><patternFill patternType="none"/></fill>' +
                '<fill><patternFill patternType="gray125"/></fill>' +
              '</fills>' +
              // Five border variants used throughout the schedule:
              '<borders count="5">' +
                '<border/>' +                            // 0 - none
                '<border>' +                             // 1 - full (all 4 sides)
                  '<left style="thin"><color auto="1"/></left>' +
                  '<right style="thin"><color auto="1"/></right>' +
                  '<top style="thin"><color auto="1"/></top>' +
                  '<bottom style="thin"><color auto="1"/></bottom>' +
                '</border>' +
                '<border>' +                             // 2 - left+right only (middle of a notes box)
                  '<left style="thin"><color auto="1"/></left>' +
                  '<right style="thin"><color auto="1"/></right>' +
                '</border>' +
                '<border>' +                             // 3 - top+left+right (first row of a notes box)
                  '<left style="thin"><color auto="1"/></left>' +
                  '<right style="thin"><color auto="1"/></right>' +
                  '<top style="thin"><color auto="1"/></top>' +
                '</border>' +
                '<border>' +                             // 4 - bottom+left+right (last row of a notes box)
                  '<left style="thin"><color auto="1"/></left>' +
                  '<right style="thin"><color auto="1"/></right>' +
                  '<bottom style="thin"><color auto="1"/></bottom>' +
                '</border>' +
              '</borders>' +
              '<cellStyleXfs count="1">' +
                '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
              '</cellStyleXfs>' +
              // Cell style indexes referenced from cells in sheet1.xml:
              //   0  default (unused)
              //   1  data cell - full border, centered h+v, wrap
              //   2  column-header cell - bold, full border, centered h+v, wrap
              //   3  left-aligned text cell with full border - Accessories
              //      column, also notes lines in a single-row section
              //   4  title row - large bold, full border, centered, wrap
              //   5  notes-box section header (bold) with full border -
              //      used only when a section has one row total
              //   6  notes-box line (non-bold) with left+right only
              //   7  notes-box line (non-bold) with top+left+right
              //   8  notes-box line (non-bold) with bottom+left+right
              //   9  notes-box section header (bold) with top+left+right -
              //      used for the header row of a multi-row section
              //  10  watermark footer (italic, light gray, right-aligned,
              //      bottom+left+right border so it sits inside the
              //      schedule-notes box as the final row of that section)
              '<cellXfs count="11">' +
                '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>' +
                '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
                '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
                '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
                '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
                '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
                '<xf numFmtId="0" fontId="0" fillId="0" borderId="2" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
                '<xf numFmtId="0" fontId="0" fillId="0" borderId="3" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
                '<xf numFmtId="0" fontId="0" fillId="0" borderId="4" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
                '<xf numFmtId="0" fontId="1" fillId="0" borderId="3" applyFont="1" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="left" vertical="center" wrapText="1"/></xf>' +
                '<xf numFmtId="0" fontId="3" fillId="0" borderId="4" applyFont="1" applyBorder="1" applyAlignment="1">' +
                  '<alignment horizontal="right" vertical="center"/></xf>' +
              '</cellXfs>' +
              '<cellStyles count="1">' +
                '<cellStyle name="Normal" xfId="0" builtinId="0"/>' +
              '</cellStyles>' +
            '</styleSheet>';
    }

    function sheetXml(grid) {
        var parts = [XML_HEADER,
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'];

        // Column widths
        if (grid.colWidths && grid.colWidths.length) {
            parts.push('<cols>');
            grid.colWidths.forEach(function (w, i) {
                parts.push('<col min="' + (i + 1) + '" max="' + (i + 1) +
                           '" width="' + w + '" customWidth="1"/>');
            });
            parts.push('</cols>');
        }

        parts.push('<sheetData>');
        for (var r = 0; r < grid.rows.length; r++) {
            var row = grid.rows[r];
            if (!row) continue;
            var cellXmls = [];
            for (var c = 0; c < row.length; c++) {
                var cell = row[c];
                if (!cell) continue;
                cellXmls.push(buildCellXml(r, c, cell, grid));
            }
            // Row height:
            //   title row (r == 0)        - tall (30pt) to show the big title
            //   column header rows        - a bit taller so wrapped text fits
            //   everything else (data, notes) - default Excel row height
            var heightAttr = '';
            if (r === 0 && grid.titleRowCount) {
                heightAttr = ' ht="30" customHeight="1"';
            } else if (r < grid.numHeaderRows) {
                heightAttr = ' ht="24" customHeight="1"';
            }
            if (!cellXmls.length) {
                // Blank row (spacer between data and notes) - leave it truly empty
                parts.push('<row r="' + (r + 1) + '"/>');
            } else {
                parts.push('<row r="' + (r + 1) + '"' + heightAttr + '>' +
                           cellXmls.join('') + '</row>');
            }
        }
        parts.push('</sheetData>');

        // Merged cells
        if (grid.merges && grid.merges.length) {
            parts.push('<mergeCells count="' + grid.merges.length + '">');
            grid.merges.forEach(function (m) {
                parts.push('<mergeCell ref="' + a1Range(m.r1, m.c1, m.r2, m.c2) + '"/>');
            });
            parts.push('</mergeCells>');
        }

        parts.push('</worksheet>');
        return parts.join('');
    }

    /** Build one <c> element for a cell. */
    function buildCellXml(r, c, cell, grid) {
        var ref = a1(r, c);

        // Covered cell: emit an empty bordered placeholder so Excel
        // renders the merge's perimeter borders correctly. The style
        // depends on whether the covering merge is a data/header row
        // (full border) or a notes-box row (partial border matching
        // the surrounding section).
        if (cell.covered) {
            return '<c r="' + ref + '" s="' + coveredStyleForRow(grid, r, c) + '"/>';
        }

        var value = cell.value;
        var style = pickStyle(cell);

        if (value === '' || value === null || value === undefined) {
            return '<c r="' + ref + '" s="' + style + '"/>';
        }

        // Numeric? Store as number so Excel can use it in formulas.
        // Leave things like "208/60/1" and "21.0 / 12.0 / 10.0" as text.
        var str = String(value);
        if (/^-?\d+(\.\d+)?$/.test(str)) {
            return '<c r="' + ref + '" s="' + style + '"><v>' + str + '</v></c>';
        }
        return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
                xmlEscape(str) + '</t></is></c>';
    }

    /** Pick the cell XF style index that matches this cell's role. */
    function pickStyle(cell) {
        if (cell.watermark) return 10;        // footer watermark (no border)
        if (cell.title) return 4;             // title row

        if (cell.notesRow) {
            var pos = cell.borderPos || 'middle';
            if (cell.bold) {
                // Section header (bold) - top+left+right normally,
                // full frame if it's the only row in its section.
                return (pos === 'only') ? 5 : 9;
            }
            // Regular note line
            if (pos === 'first') return 7;     // top+left+right
            if (pos === 'last')  return 8;     // bottom+left+right
            if (pos === 'only')  return 3;     // full border (left-aligned)
            return 6;                           // middle (left+right only)
        }

        if (cell.bold) return 2;              // column header
        if (cell.align === 'left') return 3;  // accessories / left-aligned
        return 1;                              // default data cell
    }

    /**
     * Style index to use for an empty covered-by-merge cell. For
     * notes rows we need to match the partial-border style of the
     * anchor so the merge's perimeter renders cleanly; for everything
     * else the full-border data style (s="1") works.
     */
    function coveredStyleForRow(grid, r, c) {
        // Find the merge this covered cell belongs to and look at the
        // anchor cell's styling. We only care about picking a border
        // style, so scan the same row's cells for the anchor.
        var row = grid.rows[r];
        if (!row) return 1;
        // Walk leftward to find the anchor (first non-covered cell in
        // this row that is part of our merge). In practice for notes
        // merges the anchor is always at column 0, and notes rows
        // don't have cell-by-cell stylistic changes across the merge,
        // so we can just look at cell (r, 0).
        var anchor = row[0];
        // Watermark must be checked before notesRow because the watermark
        // cell carries both flags (it's the last row of a notes box but
        // styled italic gray instead of as a regular note line).
        if (anchor && !anchor.covered && anchor.watermark) {
            return 10;
        }
        if (anchor && !anchor.covered && anchor.notesRow) {
            // Match the anchor's border position
            var pos = anchor.borderPos || 'middle';
            if (anchor.bold) {
                return (pos === 'only') ? 5 : 9;
            }
            if (pos === 'first') return 7;
            if (pos === 'last')  return 8;
            if (pos === 'only')  return 3;
            return 6;
        }
        // Default: full-border data cell
        return 1;
    }

    // Convert 0-indexed column number to Excel letter (A, B, ..., AA...)
    function colLetter(c) {
        var n = c + 1;
        var s = '';
        while (n > 0) {
            n--;
            s = String.fromCharCode(65 + (n % 26)) + s;
            n = Math.floor(n / 26);
        }
        return s;
    }

    function a1(row, col) { return colLetter(col) + (row + 1); }
    function a1Range(r1, c1, r2, c2) { return a1(r1, c1) + ':' + a1(r2, c2); }

    function xmlEscape(s) {
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /** Excel forbids these characters in sheet names. Cap at 31 chars. */
    function sanitizeSheetName(name) {
        var s = String(name || 'Schedule').replace(/[\\/?*\[\]:]/g, '_').trim();
        if (!s) s = 'Schedule';
        return s.length > 31 ? s.slice(0, 31) : s;
    }

    var XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

    // =================================================================
    // Print-to-PDF
    // -----------------------------------------------------------------
    // Renders the grid as a styled HTML table in a new window and
    // triggers print(). User picks "Save as PDF" in the print dialog
    // (every modern browser has this built in).
    // =================================================================

    function openPrintWindow(productLabel, projectName, grid) {
        var w = window.open('', '_blank');
        if (!w) {
            alert('Please allow popups from this site to use the PDF export.');
            return;
        }
        // Document title (browser-tab / suggested-PDF-filename). The
        // user asked that the project name NOT appear at the top of
        // the schedule itself, but it's still useful as the filename.
        var docTitle = (projectName ? projectName + ' - ' : '') + productLabel;
        w.document.open();
        w.document.write(buildPrintHtml(docTitle, grid));
        w.document.close();

        // Wait for layout, then auto-fit to page width and fire print.
        // The delay gives the new window's stylesheet time to apply;
        // without it Chrome can print a partially-unstyled page.
        w.focus();
        setTimeout(function () {
            fitToPageWidth(w);
            try {
                w.print();
            } catch (e) {
                // Some browsers throw if the window was closed first
            }
        }, 300);
    }

    /**
     * Shrink the document's zoom so the widest element (the schedule
     * table) fits within the printable width of landscape letter.
     * Uses CSS `zoom`, which is respected when printing in Chrome,
     * Edge, Safari. Firefox ignores zoom but its print dialog has a
     * built-in "Scale: Fit to page" option the user can pick.
     */
    function fitToPageWidth(w) {
        try {
            var doc = w.document;
            var table = doc.querySelector('table');
            if (!table) return;
            // Landscape letter minus 0.4" margins on each side:
            //   (11 - 0.8) * 96 = 979 px of usable width at 96 dpi.
            var availableWidth = 979;
            // scrollWidth measures the full rendered width including
            // anything pushing out past the visible viewport.
            var tableWidth = table.scrollWidth;
            if (tableWidth > availableWidth) {
                var scale = availableWidth / tableWidth;
                // Don't shrink below 40% - past that text becomes
                // unreadable and the user is better off accepting a
                // second page from their print dialog.
                if (scale < 0.4) scale = 0.4;
                doc.body.style.zoom = scale;
            }
        } catch (e) {
            // If anything goes wrong just leave the zoom alone; the
            // print dialog's own scaling options will still work.
        }
    }

    function buildPrintHtml(docTitle, grid) {
        return '<!DOCTYPE html>\n<html><head>' +
            '<meta charset="UTF-8">' +
            '<title>' + xmlEscape(docTitle) + '</title>' +
            '<style>' + printCss() + '</style>' +
          '</head><body>' +
            renderGridAsHtmlTable(grid) +
          '</body></html>';
    }

    function printCss() {
        return '' +
            // Landscape letter with small margins so the table has
            // as much printable area as possible.
            '@page { size: letter landscape; margin: 0.4in; }' +

            'html, body { margin: 0; padding: 0;' +
                  ' background: #fff; color: #000;' +
                  ' font-family: Calibri, Arial, sans-serif; }' +

            // Auto layout (NOT fixed) so columns size to their content.
            // Combined with nowrap on data rows, this produces the
            // minimum-necessary column widths - headers & notes still
            // wrap so they never cause the table to get absurdly wide.
            'table { border-collapse: collapse; width: auto;' +
                  ' margin: 0; color: #000; background-color: #fff;' +
                  ' font-size: 8pt; }' +

            'th, td { border: 1px solid #000; padding: 3px 5px;' +
                  ' vertical-align: middle; text-align: center;' +
                  ' background-color: #fff !important;' +
                  ' color: #000 !important; }' +

            // Headers wrap so a long label doesn\'t push column width
            // unnecessarily wide.
            'th { font-weight: bold; white-space: normal;' +
                  ' word-wrap: break-word; overflow-wrap: break-word; }' +

            // The title row: big bold, centered, single line.
            'tr.title-row td, tr.title-row th { font-size: 14pt;' +
                  ' font-weight: bold; white-space: nowrap;' +
                  ' padding: 6px 4px; }' +

            // EVERY data row stays on a single line - no text wraps.
            // This matches the way the schedule looks in the site.
            'tr.data-row td { white-space: nowrap; }' +

            // Notes rows: one outer border around the whole section,
            // no horizontal lines between individual note rows.
            // - every notes cell has left + right borders
            // - top border only on the section-first row
            // - bottom border only on the section-last row
            // - internal rows have no top or bottom border
            'tr.notes-row td { text-align: left; white-space: normal;' +
                  ' word-wrap: break-word; overflow-wrap: break-word;' +
                  ' padding: 3px 6px;' +
                  ' border-top: none; border-bottom: none;' +
                  ' border-left: 1px solid #000; border-right: 1px solid #000; }' +
            'tr.notes-row.notes-first td { border-top: 1px solid #000; }' +
            'tr.notes-row.notes-last td { border-bottom: 1px solid #000; }' +
            'tr.notes-row.notes-only td { border-top: 1px solid #000;' +
                  ' border-bottom: 1px solid #000; }' +
            'tr.notes-row.notes-header td { font-weight: bold; }' +

            // Footer watermark: italic gray line that sits inside the
            // schedule-notes box as its last row. The notes-row /
            // notes-last classes (also applied to this row) handle the
            // box borders; we only need to override text styling here.
            'tr.notes-row.watermark-row td { text-align: right !important;' +
                  ' font-style: italic; font-size: 7pt;' +
                  ' color: #888 !important; padding: 3px 8px;' +
                  ' font-weight: normal !important; }' +

            // Chrome/Edge: force backgrounds through to the print.
            '@media print {' +
                ' * { -webkit-print-color-adjust: exact !important;' +
                '     print-color-adjust: exact !important; }' +
                ' html, body { width: auto; }' +
            '}';
    }

    /**
     * Render the grid as an HTML <table>. Cells that are null or
     * covered by a merge are skipped - rowspan / colspan on the
     * anchor cell already lays out the merged region correctly.
     * Each row gets a class (title-row / header-row / data-row /
     * notes-row) so the print CSS can apply row-level styling. For
     * notes-rows we also add a notes-first / notes-middle / notes-last
     * / notes-only class so only the section's outer border shows
     * (no per-row horizontal lines inside the box).
     */
    function renderGridAsHtmlTable(grid) {
        var out = ['<table>'];
        var titleRowCount = grid.titleRowCount || 0;
        var numHeaderRows = grid.numHeaderRows || 0;
        var dataEndRow = (grid.dataEndRow != null) ? grid.dataEndRow : grid.rows.length;

        for (var r = 0; r < grid.rows.length; r++) {
            var row = grid.rows[r];
            var anchor = rowAnchor(row);
            var rowClass;
            var extraClasses = '';

            // Watermark rows are notes rows with extra .watermark-row
            // styling -- they sit inside the same outer border as the
            // rest of the schedule notes box, just italic + gray + right
            // aligned. Detection uses the cell flag (not a row index)
            // since the watermark is always the last row of a notes box.
            if (anchor && anchor.watermark) {
                rowClass = 'notes-row watermark-row';
                if (anchor.borderPos === 'last') extraClasses += ' notes-last';
                else if (anchor.borderPos === 'only') extraClasses += ' notes-only';
            } else if (r < titleRowCount) {
                rowClass = 'title-row';
            } else if (r < numHeaderRows) {
                rowClass = 'header-row';
            } else if (r < dataEndRow) {
                rowClass = 'data-row';
            } else {
                rowClass = 'notes-row';
                if (anchor) {
                    if (anchor.borderPos === 'first') extraClasses += ' notes-first';
                    else if (anchor.borderPos === 'last')  extraClasses += ' notes-last';
                    else if (anchor.borderPos === 'only')  extraClasses += ' notes-only';
                    if (anchor.bold) extraClasses += ' notes-header';
                }
            }

            out.push('<tr class="' + rowClass + extraClasses + '">');
            for (var c = 0; c < grid.colCount; c++) {
                var cell = row[c];
                if (!cell || cell.covered) continue;
                // Title rows use <th>, header rows use <th>, everything
                // else is <td>. Notes rows are left-aligned prose so
                // they stay <td>.
                var tag = (r < numHeaderRows) ? 'th' : 'td';
                var attrs = '';
                if (cell.rowSpan > 1) attrs += ' rowspan="' + cell.rowSpan + '"';
                if (cell.colSpan > 1) attrs += ' colspan="' + cell.colSpan + '"';
                out.push('<' + tag + attrs + '>' +
                         xmlEscape(String(cell.value || '')) +
                         '</' + tag + '>');
            }
            out.push('</tr>');
        }
        out.push('</table>');
        return out.join('');
    }

    /** Return the first non-null, non-covered cell in a row (its
     *  anchor cell) or null if the row is entirely empty/covered. */
    function rowAnchor(row) {
        if (!row) return null;
        for (var i = 0; i < row.length; i++) {
            var c = row[i];
            if (c && !c.covered) return c;
        }
        return null;
    }

    // =================================================================
    // Shared small helpers (duplicated from project_view.js so this
    // module doesn't need to reach into that one's private closure)
    // =================================================================

    function hasIndoorTagColumn(productKey) {
        return productKey === 'mini_splits' ||
               productKey === 'multi_position_splits' ||
               productKey === 'gas_splits';
    }

    function hasConfigurationColumn(productKey) {
        return productKey === 'marvair';
    }

    function hasServesColumn(productKey) {
        var product = HHpro.Data && HHpro.Data.getProduct
            ? HHpro.Data.getProduct(productKey)
            : null;
        return !!(product && product.hasServesColumn);
    }

    function hasAccessoriesColumn(productKey) {
        var product = HHpro.Data && HHpro.Data.getProduct
            ? HHpro.Data.getProduct(productKey)
            : null;
        return !(product && product.hideAccessoriesColumn);
    }

    function getPrimaryTagLabel(productKey) {
        if (productKey === 'mini_splits' ||
            productKey === 'multi_position_splits' ||
            productKey === 'gas_splits') {
            return 'Outdoor Tag';
        }
        return 'Tag';
    }

    function findSelectionById(data, selectionId) {
        var sels = (data && data.selections) || [];
        for (var i = 0; i < sels.length; i++) {
            if (sels[i].id === selectionId) return sels[i];
        }
        return null;
    }

    function formatCellValue(val, colLetter, productKey) {
        var ext = productKey && HHpro.ProductExtensions && HHpro.ProductExtensions[productKey];
        if (ext && typeof ext.formatScheduleCellValue === 'function') {
            var override = ext.formatScheduleCellValue(colLetter, val);
            if (override !== undefined) return override;
        }
        if (val === null || val === undefined) return '';
        if (typeof val === 'number') {
            // Strip trailing .0 from whole numbers, keep decimals otherwise
            return (val % 1 === 0) ? String(val) : String(val);
        }
        return String(val);
    }

    /** Build the 2D layout of data cells with outdoor-column rowSpans
     *  preserved. Mirrors the logic in project_view.js. */
    function computeCellLayout(sel, visibleLetters) {
        var numRows = sel.rows.length;
        var layout = [];
        for (var i = 0; i < numRows; i++) layout.push({});

        visibleLetters.forEach(function (colLetter) {
            var rowsWithValue = [];
            sel.rows.forEach(function (row, i) {
                var v = row.scheduleData ? row.scheduleData[colLetter] : undefined;
                if (v !== undefined) rowsWithValue.push(i);
            });

            if (rowsWithValue.length === 0) {
                for (var r = 0; r < numRows; r++) {
                    layout[r][colLetter] = { value: '', rowSpan: 1, colSpan: 1 };
                }
            } else if (rowsWithValue.length === 1 && rowsWithValue[0] === 0 && numRows > 1) {
                layout[0][colLetter] = {
                    value: sel.rows[0].scheduleData[colLetter],
                    rowSpan: numRows,
                    colSpan: 1
                };
                for (var r2 = 1; r2 < numRows; r2++) {
                    layout[r2][colLetter] = null;
                }
            } else {
                sel.rows.forEach(function (row, i) {
                    var v = row.scheduleData ? row.scheduleData[colLetter] : undefined;
                    layout[i][colLetter] = {
                        value: (v !== undefined ? v : ''),
                        rowSpan: 1,
                        colSpan: 1
                    };
                });
            }
        });

        // Horizontal colspans from scheduleCellSpans
        var visibleIdx = {};
        visibleLetters.forEach(function (l, i) { visibleIdx[l] = i; });
        sel.rows.forEach(function (row, rowIndex) {
            var spans = row.scheduleCellSpans;
            if (!spans) return;
            Object.keys(spans).forEach(function (startCol) {
                var colspan = parseInt(spans[startCol], 10);
                if (!colspan || colspan <= 1) return;
                if (!visibleIdx.hasOwnProperty(startCol)) return;
                var anchor = layout[rowIndex][startCol];
                if (!anchor) return;

                var startVisibleIdx = visibleIdx[startCol];
                var reach = 1;
                for (var k = 1; k < colspan; k++) {
                    var nextLetter = visibleLetters[startVisibleIdx + k];
                    if (!nextLetter) break;
                    reach++;
                }
                if (reach <= 1) return;
                anchor.colSpan = reach;
                for (var j = 1; j < reach; j++) {
                    var coveredLetter = visibleLetters[startVisibleIdx + j];
                    var rowsCovered = anchor.rowSpan || 1;
                    for (var rr = 0; rr < rowsCovered; rr++) {
                        if (layout[rowIndex + rr]) {
                            layout[rowIndex + rr][coveredLetter] = null;
                        }
                    }
                }
            });
        });

        return layout;
    }

    // Map product key to its user-facing tab label. Mirrors the labels
    // in HHpro.Data.getProducts but kept local so this module doesn't
    // have to depend on that call succeeding.
    function productTabLabel(productKey) {
        var product = (HHpro.Data && HHpro.Data.getProduct)
            ? HHpro.Data.getProduct(productKey) : null;
        if (product && product.name) return product.name;
        var fallback = {
            'gas_packs': 'Gas Pack RTUs',
            'marvair': 'Marvair Vertical Wall Mount',
            'mini_splits': 'Mini Splits',
            'multi_position_splits': 'Multi Position Splits',
            'gas_splits': 'Gas Splits'
        };
        return fallback[productKey] || productKey;
    }

    function safeFilename(name) {
        return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'schedule';
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // =================================================================
    // DXF generation (AutoCAD R12 ASCII)
    // -----------------------------------------------------------------
    // Output is intentionally simple so the file is easy to edit after
    // import: every cell border is a separate LINE entity, every cell
    // value is a separate TEXT entity. Two layers - SCHEDULE_GRID for
    // borders, SCHEDULE_TEXT for text - so the engineer can isolate or
    // freeze whichever they need.
    //
    // The grid sits at the origin going +X to the right and -Y down so
    // the first row reads top-to-bottom in any CAD viewer. Drawing
    // units are nominal "mm" but the file has no $INSUNITS so users
    // can rescale freely on import.
    // =================================================================

    // Tuning constants (drawing units, ~ mm)
    var DXF_CHAR_W       = 2.5;   // approx mm per Excel character-width unit
    var DXF_TITLE_H      = 8;     // title row height
    var DXF_HEADER_H     = 6;     // header / column-header row height
    var DXF_DATA_H       = 5;     // data + notes row height
    var DXF_TXT_TITLE    = 4;     // text height for title row
    var DXF_TXT_HEADER   = 2.5;   // text height for header cells
    var DXF_TXT_BODY     = 2.5;   // text height for body cells
    var DXF_TXT_PAD      = 1.5;   // left padding for left-aligned cells
    var DXF_GAP          = 12;    // vertical gap between stacked tables

    function dxfBlobFromSections(sections) {
        try {
            var text = buildDxfText(sections);
            var blob = new Blob([text], { type: 'application/dxf' });
            return Promise.resolve(blob);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    function buildDxfText(sections) {
        var entities = [];
        var yCursor = 0;  // top of next table (we go downward as we emit)
        var maxX = 0;

        sections.forEach(function (sec, idx) {
            if (!sec || !sec.grid || !sec.grid.rows.length) return;
            var info = emitGridToDxf(sec.grid, -yCursor, entities);
            if (info.width > maxX) maxX = info.width;
            yCursor += info.height;
            if (idx < sections.length - 1) yCursor += DXF_GAP;
        });

        // Pad EXTMIN/EXTMAX a bit so AutoCAD's zoom-extents shows a
        // small margin around the drawing.
        var minX = -5;
        var maxXp = maxX + 5;
        var maxYp = 5;
        var minYp = -yCursor - 5;

        return dxfHeader(minX, minYp, maxXp, maxYp) +
               dxfTables() +
               dxfBlocks() +
               dxfEntities(entities) +
               '  0\nEOF\n';
    }

    // Emit one schedule grid's worth of LINE + TEXT entities, with the
    // top of the table at world Y = topY. Returns the table's overall
    // width and height in drawing units.
    function emitGridToDxf(grid, topY, entities) {
        var rows = grid.rows;
        var colWidths = (grid.colWidths || []).slice();
        var colCount = grid.colCount || (rows[0] ? rows[0].length : 0);
        // Make sure colWidths has an entry for every column
        while (colWidths.length < colCount) colWidths.push(10);

        // Column X edges (left edges + one extra for the right edge)
        var colXs = [0];
        for (var c = 0; c < colCount; c++) {
            colXs.push(colXs[c] + colWidths[c] * DXF_CHAR_W);
        }
        var tableWidth = colXs[colCount];

        // Row Y edges (top edges + one extra for the bottom edge).
        // Y values are absolute; topY is the top of row 0.
        var rowYs = [topY];
        for (var r = 0; r < rows.length; r++) {
            rowYs.push(rowYs[r] - rowHeightFor(grid, r));
        }
        var tableHeight = topY - rowYs[rows.length];

        // For each non-covered anchor cell: emit its border + text.
        for (var rr = 0; rr < rows.length; rr++) {
            var row = rows[rr];
            if (!row) continue;
            for (var cc = 0; cc < colCount; cc++) {
                var cell = row[cc];
                if (!cell || cell.covered) continue;
                var rowSpan = cell.rowSpan || 1;
                var colSpan = cell.colSpan || 1;
                var x1 = colXs[cc];
                var x2 = colXs[Math.min(cc + colSpan, colCount)];
                var y1 = rowYs[rr];
                var y2 = rowYs[Math.min(rr + rowSpan, rows.length)];

                emitCellBordersDxf(cell, x1, y1, x2, y2, entities);
                emitCellTextDxf(cell, x1, y1, x2, y2, entities);
            }
        }

        return { width: tableWidth, height: tableHeight };
    }

    function rowHeightFor(grid, r) {
        var titleRows = grid.titleRowCount || 0;
        var headerRows = grid.numHeaderRows || 0;
        if (r < titleRows) return DXF_TITLE_H;
        if (r < headerRows) return DXF_HEADER_H;
        return DXF_DATA_H;
    }

    // Push 4 border LINEs (or a subset, for notes rows whose borderPos
    // says some sides are open) for a cell that spans (x1,y1) to (x2,y2),
    // where (x1,y1) is the top-left in DXF coords (y2 < y1).
    function emitCellBordersDxf(cell, x1, y1, x2, y2, entities) {
        var pos = cell.notesRow ? (cell.borderPos || 'middle') : 'only';
        // sides we draw: left + right always, top/bottom depend on pos
        var drawTop = (pos === 'only' || pos === 'first');
        var drawBot = (pos === 'only' || pos === 'last');
        var drawLeft = true;
        var drawRight = true;

        if (drawTop)   entities.push(dxfLine('SCHEDULE_GRID', x1, y1, x2, y1));
        if (drawBot)   entities.push(dxfLine('SCHEDULE_GRID', x1, y2, x2, y2));
        if (drawLeft)  entities.push(dxfLine('SCHEDULE_GRID', x1, y1, x1, y2));
        if (drawRight) entities.push(dxfLine('SCHEDULE_GRID', x2, y1, x2, y2));
    }

    function emitCellTextDxf(cell, x1, y1, x2, y2, entities) {
        var value = (cell.value === null || cell.value === undefined) ? '' : String(cell.value);
        if (!value) return;
        // Strip a few control chars that R12 doesn't like
        var clean = value.replace(/[\r\n\t]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '');
        if (!clean) return;

        var height = DXF_TXT_BODY;
        if (cell.title) height = DXF_TXT_TITLE;
        else if (cell.bold && !cell.notesRow) height = DXF_TXT_HEADER + 0.3; // visually
        else if (cell.bold) height = DXF_TXT_BODY;

        var leftAlign = (cell.align === 'left') || (cell.notesRow && !cell.watermark);
        var rightAlign = (cell.watermark);

        var midY = (y1 + y2) / 2;
        if (leftAlign) {
            // 72=0 left, 73=2 middle -> alignment point at (x, midY)
            entities.push(dxfText('SCHEDULE_TEXT', x1 + DXF_TXT_PAD, midY, height, clean, 0, 2));
        } else if (rightAlign) {
            // 72=2 right, 73=2 middle
            entities.push(dxfText('SCHEDULE_TEXT', x2 - DXF_TXT_PAD, midY, height, clean, 2, 2));
        } else {
            // 72=1 center, 73=2 middle
            var midX = (x1 + x2) / 2;
            entities.push(dxfText('SCHEDULE_TEXT', midX, midY, height, clean, 1, 2));
        }
    }

    // -----------------------------------------------------------------
    // DXF group-code primitives. R12 ASCII expects each pair on two
    // lines: <group code>\n<value>\n. AutoCAD also tolerates leading
    // whitespace on the group-code line, which we use for readability.
    // -----------------------------------------------------------------
    function dxfLine(layer, x1, y1, x2, y2) {
        return '  0\nLINE\n  8\n' + layer +
               '\n 10\n' + fmt(x1) +
               '\n 20\n' + fmt(y1) +
               '\n 30\n0.0' +
               '\n 11\n' + fmt(x2) +
               '\n 21\n' + fmt(y2) +
               '\n 31\n0.0\n';
    }

    function dxfText(layer, x, y, height, text, hAlign, vAlign) {
        // R12 TEXT: insertion at (10,20). When 72 or 73 is non-zero,
        // the alignment point (11,21) is used; we set both to the same
        // value (cell anchor) and the renderer aligns from there.
        var safe = dxfEscape(text);
        return '  0\nTEXT\n  8\n' + layer +
               '\n 10\n' + fmt(x) +
               '\n 20\n' + fmt(y) +
               '\n 30\n0.0' +
               '\n 40\n' + fmt(height) +
               '\n  1\n' + safe +
               '\n 50\n0.0' +
               '\n 72\n' + hAlign +
               '\n 11\n' + fmt(x) +
               '\n 21\n' + fmt(y) +
               '\n 31\n0.0' +
               '\n  7\nSTANDARD' +
               '\n 73\n' + vAlign + '\n';
    }

    function fmt(n) {
        if (!isFinite(n)) return '0.0';
        // 4 decimal places is plenty for table layout and keeps the
        // file from getting ridiculously large with floating crud.
        var s = Number(n).toFixed(4);
        // Trim trailing zeros but keep at least one decimal digit
        return s.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0');
    }

    function dxfEscape(s) {
        // R12 TEXT control codes: ^ starts a code, ~ degree, etc. We
        // don't need any of them - just keep the string ASCII-clean
        // and replace anything outside printable ASCII with '?'.
        return String(s).replace(/[^\x20-\x7e]/g, '?');
    }

    function dxfHeader(minX, minY, maxX, maxY) {
        return '  0\nSECTION\n  2\nHEADER\n' +
               '  9\n$ACADVER\n  1\nAC1009\n' +
               '  9\n$INSBASE\n 10\n0.0\n 20\n0.0\n 30\n0.0\n' +
               '  9\n$EXTMIN\n 10\n' + fmt(minX) + '\n 20\n' + fmt(minY) + '\n 30\n0.0\n' +
               '  9\n$EXTMAX\n 10\n' + fmt(maxX) + '\n 20\n' + fmt(maxY) + '\n 30\n0.0\n' +
               '  0\nENDSEC\n';
    }

    function dxfTables() {
        // LAYER table only. Layer 0 is required; SCHEDULE_GRID +
        // SCHEDULE_TEXT are the two layers all our entities live on.
        var layers = [
            { name: '0', color: 7 },
            { name: 'SCHEDULE_GRID', color: 7 },
            { name: 'SCHEDULE_TEXT', color: 7 }
        ];
        var out = '  0\nSECTION\n  2\nTABLES\n' +
                  '  0\nTABLE\n  2\nLAYER\n 70\n' + layers.length + '\n';
        layers.forEach(function (l) {
            out += '  0\nLAYER\n  2\n' + l.name +
                   '\n 70\n0\n 62\n' + l.color +
                   '\n  6\nCONTINUOUS\n';
        });
        out += '  0\nENDTAB\n  0\nENDSEC\n';
        return out;
    }

    function dxfBlocks() {
        // Empty blocks section; required by some readers even though
        // we don't insert any blocks.
        return '  0\nSECTION\n  2\nBLOCKS\n  0\nENDSEC\n';
    }

    function dxfEntities(entityStrings) {
        return '  0\nSECTION\n  2\nENTITIES\n' +
               entityStrings.join('') +
               '  0\nENDSEC\n';
    }

    // =================================================================
    // PDF generation (hand-rolled, no external deps)
    // -----------------------------------------------------------------
    // Builds a minimal PDF 1.4 file directly: one page per section,
    // landscape letter, Helvetica (a built-in font so we don't have to
    // embed anything). Tables are drawn with PDF "re" rectangles for
    // borders and "Tj" text-show operators for cell values.
    //
    // Layout scales the natural table width down to the printable
    // page width when needed, the same idea as the print-window
    // exporter's fitToPageWidth(). Long content overflows visually
    // rather than wrapping - matches the toolbar PDF's nowrap rule
    // on data rows.
    // =================================================================

    var PDF_PAGE_W = 792;    // landscape letter, points
    var PDF_PAGE_H = 612;
    var PDF_MARGIN = 30;
    var PDF_CHAR_W = 6.5;    // approx pt per Excel character-width unit
    var PDF_TITLE_H_PT = 24;
    var PDF_HEADER_H_PT = 18;
    var PDF_DATA_H_PT = 16;
    var PDF_TXT_TITLE = 14;
    var PDF_TXT_HEADER = 9;
    var PDF_TXT_BODY = 8.5;
    var PDF_TXT_NOTES = 8.5;
    var PDF_GAP = 14;        // gap between stacked sections on the same page

    function pdfBlobFromSections(sections) {
        try {
            var bytes = buildPdfBytes(sections);
            var blob = new Blob([bytes], { type: 'application/pdf' });
            return Promise.resolve(blob);
        } catch (e) {
            return Promise.reject(e);
        }
    }

    // Build the entire PDF as a Uint8Array. Object byte offsets are
    // tracked so we can write a correct xref table at the end.
    function buildPdfBytes(sections) {
        // Strategy: each section becomes its own page. If a section is
        // taller than one page at natural size it gets a uniform scale
        // until it fits.
        var pageStreams = sections
            .filter(function (s) { return s && s.grid && s.grid.rows.length; })
            .map(function (s) { return buildPdfPageStream(s.grid); });

        if (!pageStreams.length) {
            // Empty PDF still needs to be valid; emit a single blank page
            pageStreams = [''];
        }

        // Object plan:
        //   1 - Catalog
        //   2 - Pages (parent)
        //   3..(3+N-1) - one Page per section
        //   3+N         - Font /Helvetica
        //   3+N+1..     - one content stream per page
        var pageCount = pageStreams.length;
        var fontId = 3 + pageCount;
        var firstContentId = fontId + 1;
        var pageIds = [];
        for (var i = 0; i < pageCount; i++) pageIds.push(3 + i);

        var objects = [];
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';

        var kids = pageIds.map(function (id) { return id + ' 0 R'; }).join(' ');
        objects[2] = '<< /Type /Pages /Kids [' + kids + '] /Count ' + pageCount + ' >>';

        for (var p = 0; p < pageCount; p++) {
            var contentId = firstContentId + p;
            objects[pageIds[p]] =
                '<< /Type /Page /Parent 2 0 R ' +
                '/MediaBox [0 0 ' + PDF_PAGE_W + ' ' + PDF_PAGE_H + '] ' +
                '/Resources << /Font << /F1 ' + fontId + ' 0 R >> >> ' +
                '/Contents ' + contentId + ' 0 R >>';
        }

        // Helvetica (and Helvetica-Bold) are standard built-in PDF
        // fonts - no font data needs to be embedded.
        objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

        for (var s = 0; s < pageCount; s++) {
            var stream = pageStreams[s];
            objects[firstContentId + s] =
                '<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream';
        }

        return assemblePdf(objects);
    }

    // Convert the objects-by-id map into a final PDF byte sequence with
    // an xref table and trailer. Objects are indexed from 1.
    function assemblePdf(objects) {
        var header = '%PDF-1.4\n%\xff\xff\xff\xff\n';
        var bodyParts = [];
        var offsets = [];
        var pos = header.length;
        // Build each object's serialized form and record its offset.
        for (var id = 1; id < objects.length; id++) {
            var body = objects[id];
            if (body === undefined) continue;
            var serial = id + ' 0 obj\n' + body + '\nendobj\n';
            offsets[id] = pos;
            bodyParts.push(serial);
            pos += serial.length;
        }

        var xrefOffset = pos;
        var xref = 'xref\n0 ' + objects.length + '\n' +
                   '0000000000 65535 f \n';
        for (var id2 = 1; id2 < objects.length; id2++) {
            var off = offsets[id2] || 0;
            xref += zeroPad(off, 10) + ' 00000 n \n';
        }
        var trailer = 'trailer\n<< /Size ' + objects.length +
                      ' /Root 1 0 R >>\nstartxref\n' + xrefOffset + '\n%%EOF\n';

        var all = header + bodyParts.join('') + xref + trailer;
        return stringToUint8(all);
    }

    function zeroPad(n, w) {
        var s = String(n);
        while (s.length < w) s = '0' + s;
        return s;
    }

    function stringToUint8(s) {
        // Every char we write is either ASCII (after pdfEscapeText) or
        // a single 0x80+ byte from the file's binary marker. .length
        // therefore equals the on-disk byte count, which is also the
        // basis for the xref offsets the trailer points at.
        var bytes = new Uint8Array(s.length);
        for (var i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
        return bytes;
    }

    // Build the PDF content stream for one grid. Mirrors the DXF
    // emitter conceptually: walk anchor cells, draw a rectangle for
    // the border (subset for notes rows), draw text inside.
    function buildPdfPageStream(grid) {
        var rows = grid.rows;
        var colWidths = (grid.colWidths || []).slice();
        var colCount = grid.colCount || (rows[0] ? rows[0].length : 0);
        while (colWidths.length < colCount) colWidths.push(10);

        // Natural column edges (no scaling yet)
        var natColXs = [0];
        for (var c = 0; c < colCount; c++) {
            natColXs.push(natColXs[c] + colWidths[c] * PDF_CHAR_W);
        }
        var natWidth = natColXs[colCount];

        // Natural row edges
        var natRowYs = [0];
        for (var r = 0; r < rows.length; r++) {
            natRowYs.push(natRowYs[r] + pdfRowHeightFor(grid, r));
        }
        var natHeight = natRowYs[rows.length];

        // Compute scale to fit both width and height into the printable
        // area. Don't scale up past 1.0 - we want a comfortable size
        // for short tables, only shrinking when needed.
        var maxW = PDF_PAGE_W - 2 * PDF_MARGIN;
        var maxH = PDF_PAGE_H - 2 * PDF_MARGIN;
        var scale = Math.min(1, maxW / natWidth, maxH / natHeight);
        if (!isFinite(scale) || scale <= 0) scale = 1;

        var width = natWidth * scale;
        var height = natHeight * scale;

        // Anchor table at top-left of the printable area (with a small
        // horizontal centering nudge so narrow tables look tidy).
        var leftPad = (maxW - width) / 2;
        var x0 = PDF_MARGIN + Math.max(0, leftPad);
        var topY = PDF_PAGE_H - PDF_MARGIN;

        var colXs = natColXs.map(function (v) { return x0 + v * scale; });
        // PDF Y goes up; rows grow downward so subtract scaled offsets.
        var rowYs = natRowYs.map(function (v) { return topY - v * scale; });

        var parts = [];
        // Set up basic graphics state: thin black borders + black text
        parts.push('q');
        parts.push('0 0 0 RG');         // stroke color = black
        parts.push('0 0 0 rg');         // fill color = black
        parts.push('0.5 w');            // line width 0.5 pt

        // Borders pass
        for (var rr = 0; rr < rows.length; rr++) {
            var row = rows[rr];
            if (!row) continue;
            for (var cc = 0; cc < colCount; cc++) {
                var cell = row[cc];
                if (!cell || cell.covered) continue;
                var rowSpan = cell.rowSpan || 1;
                var colSpan = cell.colSpan || 1;
                var x1 = colXs[cc];
                var x2 = colXs[Math.min(cc + colSpan, colCount)];
                var y1 = rowYs[rr];                // top
                var y2 = rowYs[Math.min(rr + rowSpan, rows.length)]; // bottom

                pushPdfBorder(parts, cell, x1, y2, x2 - x1, y1 - y2);
            }
        }

        // Text pass (separate so all text shares one BT/ET block)
        parts.push('BT');
        var curFontSize = -1;
        var curFontKey = null;
        for (var rr2 = 0; rr2 < rows.length; rr2++) {
            var row2 = rows[rr2];
            if (!row2) continue;
            for (var cc2 = 0; cc2 < colCount; cc2++) {
                var cell2 = row2[cc2];
                if (!cell2 || cell2.covered) continue;
                var value = (cell2.value === null || cell2.value === undefined)
                    ? '' : String(cell2.value);
                if (!value) continue;
                var rowSpan2 = cell2.rowSpan || 1;
                var colSpan2 = cell2.colSpan || 1;

                var bx1 = colXs[cc2];
                var bx2 = colXs[Math.min(cc2 + colSpan2, colCount)];
                var by1 = rowYs[rr2];
                var by2 = rowYs[Math.min(rr2 + rowSpan2, rows.length)];

                var size = pdfFontSizeForCell(cell2, grid, rr2) * scale;
                // PDF font: /F1 = Helvetica (we only registered one font;
                // bold is approximated with the same font - it still
                // reads as a distinct row thanks to size + layout).
                if (size !== curFontSize || curFontKey !== '/F1') {
                    parts.push('/F1 ' + size.toFixed(2) + ' Tf');
                    curFontSize = size;
                    curFontKey = '/F1';
                }

                var leftAlign = (cell2.align === 'left') || (cell2.notesRow && !cell2.watermark);
                var rightAlign = !!cell2.watermark;
                var cellW = bx2 - bx1;
                var textW = approxPdfTextWidth(value, size);
                var tx, ty;
                if (leftAlign) {
                    tx = bx1 + 4;
                } else if (rightAlign) {
                    tx = bx2 - 4 - textW;
                } else {
                    tx = bx1 + (cellW - textW) / 2;
                }
                // Vertical center: PDF Y is the text baseline, so put it
                // just below cell midline by ~30% of font size.
                ty = (by1 + by2) / 2 - size * 0.3;

                parts.push(tx.toFixed(2) + ' ' + ty.toFixed(2) + ' Td');
                parts.push('(' + pdfEscapeText(value) + ') Tj');
                // Reset text position so next absolute Td works correctly
                parts.push((-tx).toFixed(2) + ' ' + (-ty).toFixed(2) + ' Td');
            }
        }
        parts.push('ET');
        parts.push('Q');

        return parts.join('\n');
    }

    function pdfRowHeightFor(grid, r) {
        var titleRows = grid.titleRowCount || 0;
        var headerRows = grid.numHeaderRows || 0;
        if (r < titleRows) return PDF_TITLE_H_PT;
        if (r < headerRows) return PDF_HEADER_H_PT;
        return PDF_DATA_H_PT;
    }

    function pdfFontSizeForCell(cell, grid, r) {
        if (cell.title) return PDF_TXT_TITLE;
        if (r < (grid.numHeaderRows || 0)) return PDF_TXT_HEADER;
        if (cell.notesRow) return PDF_TXT_NOTES;
        return PDF_TXT_BODY;
    }

    // Push PDF operators for the cell's border (with notes-row exceptions
    // matching the on-screen layout: only outer perimeter is drawn).
    function pushPdfBorder(parts, cell, x, y, w, h) {
        var pos = cell.notesRow ? (cell.borderPos || 'middle') : 'only';
        var drawTop = (pos === 'only' || pos === 'first');
        var drawBot = (pos === 'only' || pos === 'last');

        // Four explicit line segments give us fine-grained control over
        // which sides draw. PDF's "re" rectangle is all-or-nothing.
        if (drawTop) {
            parts.push(x.toFixed(2) + ' ' + (y + h).toFixed(2) + ' m');
            parts.push((x + w).toFixed(2) + ' ' + (y + h).toFixed(2) + ' l S');
        }
        if (drawBot) {
            parts.push(x.toFixed(2) + ' ' + y.toFixed(2) + ' m');
            parts.push((x + w).toFixed(2) + ' ' + y.toFixed(2) + ' l S');
        }
        // Left + right always drawn
        parts.push(x.toFixed(2) + ' ' + y.toFixed(2) + ' m');
        parts.push(x.toFixed(2) + ' ' + (y + h).toFixed(2) + ' l S');
        parts.push((x + w).toFixed(2) + ' ' + y.toFixed(2) + ' m');
        parts.push((x + w).toFixed(2) + ' ' + (y + h).toFixed(2) + ' l S');
    }

    // PDF string literals need backslash escaping for (, ), and \. We
    // also strip non-ASCII characters since we're using the built-in
    // WinAnsiEncoding Helvetica without any extra encoding setup.
    function pdfEscapeText(s) {
        return String(s)
            .replace(/[^\x20-\x7e]/g, '?')
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
    }

    // Approx Helvetica width: 0.5 em per character is a workable
    // average across the full character set. Good enough for centering
    // a single-line cell value within a few points.
    function approxPdfTextWidth(text, size) {
        return text.length * size * 0.5;
    }
})();