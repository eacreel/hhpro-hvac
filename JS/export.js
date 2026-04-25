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
        toExcel: exportToExcel,
        toPDF:   exportToPDF
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
                            { value: formatCellValue(cell.value), dataRow: true },
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
        var zip = new window.JSZip();
        zip.file('[Content_Types].xml', contentTypesXml());
        zip.file('_rels/.rels', rootRelsXml());
        zip.file('xl/workbook.xml', workbookXml(sanitizeSheetName(sheetTitle)));
        zip.file('xl/_rels/workbook.xml.rels', workbookRelsXml());
        zip.file('xl/styles.xml', stylesXml());
        zip.file('xl/worksheets/sheet1.xml', sheetXml(grid));
        return zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            compression: 'DEFLATE'
        });
    }

    function contentTypesXml() {
        return XML_HEADER +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
              '<Default Extension="xml" ContentType="application/xml"/>' +
              '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
              '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
              '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
              '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
            '</Types>';
    }

    function rootRelsXml() {
        return XML_HEADER +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
            '</Relationships>';
    }

    function workbookXml(sheetName) {
        return XML_HEADER +
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"' +
                     ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
              '<sheets>' +
                '<sheet name="' + xmlEscape(sheetName) + '" sheetId="1" r:id="rId1"/>' +
              '</sheets>' +
            '</workbook>';
    }

    function workbookRelsXml() {
        return XML_HEADER +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
              '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
              '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
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
               productKey === 'multi_position_splits';
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
            productKey === 'multi_position_splits') {
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

    function formatCellValue(val) {
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
            'multi_position_splits': 'Multi Position Splits'
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
})();