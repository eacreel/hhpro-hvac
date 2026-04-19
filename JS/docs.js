/* ============================================================
   HHpro - Documents module
   ------------------------------------------------------------
   Handles:
     - Opening a single submittal PDF in a new tab
       (wired to the "Submittal" button in the schedule)
     - Opening a popup listing every available document for a
       selection, with per-item View / Download buttons
       (wired to the "Docs" button in the schedule)

   File path convention used everywhere:

       <product.assetsFolder>/<docColumn.folder>/<filename>.<docColumn.fileExtension>

   Example:  ASSETS/GAS PACKS/SUBMITTALS/DSG0363DM.pdf

   Public API:
     HHpro.Docs.openSubmittal(product, selection, data)
         Opens the best-available submittal PDF in a new tab.
         Preference order: SYSTEM > OUTDOOR UNIT > any other.

     HHpro.Docs.openDocsModal(product, selection, data)
         Opens a popup with every available document for the
         selection, deduplicated across rows.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    HHpro.Docs = {
        openSubmittal: openSubmittal,
        openDocsModal: openDocsModal
    };

    // =================================================================
    // Public: open the "best" submittal for a selection
    // =================================================================

    function openSubmittal(product, sel, data) {
        var docColumns = (data && data.documentationColumns) || [];
        var best = findBestSubmittal(sel, docColumns);
        if (!best) {
            alert('No submittal is available for this item.');
            return;
        }
        var url = buildDocUrl(product, best.docColumn, best.filename);
        openInNewTab(url);
    }

    /**
     * Pick the submittal to open when the user clicks the Submittal button.
     * Priority: system-level > outdoor-unit > any submittal column found.
     * Returns { docColumn, filename } or null if none available.
     */
    function findBestSubmittal(sel, docColumns) {
        var submittalCols = docColumns.filter(function (dc) {
            return /SUBMITTAL/i.test(dc.name);
        });
        if (!submittalCols.length) return null;

        var ranked = submittalCols.slice().sort(function (a, b) {
            return submittalRank(a.name) - submittalRank(b.name);
        });

        for (var i = 0; i < ranked.length; i++) {
            var dc = ranked[i];
            for (var r = 0; r < sel.rows.length; r++) {
                var docData = sel.rows[r].documentationData || {};
                var filename = docData[dc.name];
                if (filename) {
                    return { docColumn: dc, filename: String(filename) };
                }
            }
        }
        return null;
    }

    function submittalRank(name) {
        var up = String(name || '').toUpperCase();
        if (up.indexOf('SYSTEM') !== -1) return 0;
        if (up.indexOf('OUTDOOR') !== -1) return 1;
        return 2;
    }

    // =================================================================
    // Public: open the all-documents popup
    // =================================================================

    function openDocsModal(product, sel, data) {
        var docColumns = (data && data.documentationColumns) || [];
        var items = collectSelectionDocs(sel, docColumns);

        var backdrop = buildModalBackdrop();
        var modal = buildModalBox();
        modal.classList.add('docs-modal');

        var header = document.createElement('div');
        header.className = 'docs-modal-header';

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = 'Available documents';

        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'docs-modal-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', function () { closeModal(backdrop); });

        header.appendChild(title);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        if (items.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'modal-desc';
            empty.textContent = 'No documents are available for this item.';
            modal.appendChild(empty);
        } else {
            var list = document.createElement('div');
            list.className = 'docs-list';
            items.forEach(function (item) {
                list.appendChild(buildDocListItem(product, item));
            });
            modal.appendChild(list);
        }

        var actions = document.createElement('div');
        actions.className = 'modal-actions';
        var doneBtn = document.createElement('button');
        doneBtn.type = 'button';
        doneBtn.className = 'modal-btn modal-btn-secondary';
        doneBtn.textContent = 'Close';
        doneBtn.addEventListener('click', function () { closeModal(backdrop); });
        actions.appendChild(doneBtn);
        modal.appendChild(actions);

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
    }

    /**
     * Walk every row of the selection and collect { docColumn, filename }
     * pairs for each doc that has a value. Deduplicates so identical
     * (column, filename) pairs across rows appear once.
     *
     * Order: preserves documentationColumns order; within a column, rows
     * are walked in order so indoor-unit #1's docs come before #2's.
     */
    function collectSelectionDocs(sel, docColumns) {
        var out = [];
        var seen = {};
        docColumns.forEach(function (dc) {
            sel.rows.forEach(function (row) {
                var docData = row.documentationData || {};
                var value = docData[dc.name];
                if (!value) return;
                var key = dc.name + '|' + value;
                if (seen[key]) return;
                seen[key] = true;
                out.push({ docColumn: dc, filename: String(value) });
            });
        });
        return out;
    }

    function buildDocListItem(product, item) {
        var row = document.createElement('div');
        row.className = 'docs-item';

        var info = document.createElement('div');
        info.className = 'docs-item-info';

        var name = document.createElement('div');
        name.className = 'docs-item-name';
        name.textContent = item.docColumn.name;

        var filename = document.createElement('div');
        filename.className = 'docs-item-file';
        filename.textContent = item.filename + '.' + item.docColumn.fileExtension;

        info.appendChild(name);
        info.appendChild(filename);

        var isZip = String(item.docColumn.fileExtension || '').toLowerCase() === 'zip';
        var actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'docs-item-action ' + (isZip ? 'docs-item-action-download' : 'docs-item-action-view');
        actionBtn.textContent = isZip ? 'Download' : 'View';

        var url = buildDocUrl(product, item.docColumn, item.filename);
        actionBtn.addEventListener('click', function () {
            if (isZip) triggerDownload(url);
            else openInNewTab(url);
        });

        row.appendChild(info);
        row.appendChild(actionBtn);
        return row;
    }

    // =================================================================
    // URL construction + open / download
    // =================================================================

    function buildDocUrl(product, docColumn, filename) {
        var assets = (product && product.assetsFolder) || '';
        var folder = (docColumn && docColumn.folder) || '';
        var ext = (docColumn && docColumn.fileExtension) || '';
        var path = assets + '/' + folder + '/' + filename + '.' + ext;
        // Encode spaces and other URL-unsafe characters while preserving
        // the slash separators. Local file paths like "ASSETS/GAS PACKS/..."
        // must be encoded or the browser will fail to fetch them.
        return encodeURI(path);
    }

    function openInNewTab(url) {
        // 'noopener' is a security best-practice for target=_blank links;
        // also prevents the new window from having access to window.opener.
        window.open(url, '_blank', 'noopener');
    }

    /**
     * Force a download. Using an anchor with the `download` attribute lets
     * us trigger the save dialog for ZIPs that the browser might otherwise
     * try to navigate to. Works for same-origin files (which these are,
     * since the site hosts the PDFs/ZIPs from its own directory).
     */
    function triggerDownload(url) {
        var a = document.createElement('a');
        a.href = url;
        // Extract a sensible default filename from the URL
        var decoded = decodeURI(url);
        var filename = decoded.split('/').pop();
        if (filename) a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            if (a.parentNode) a.parentNode.removeChild(a);
        }, 100);
    }

    // =================================================================
    // Shared modal helpers (same structure as cart.js uses)
    // =================================================================

    function buildModalBackdrop() {
        var bd = document.createElement('div');
        bd.className = 'modal-backdrop';
        bd.addEventListener('click', function (e) {
            if (e.target === bd) closeModal(bd);
        });
        return bd;
    }

    function buildModalBox() {
        var m = document.createElement('div');
        m.className = 'modal';
        return m;
    }

    function closeModal(backdrop) {
        if (backdrop && backdrop.parentNode) {
            backdrop.parentNode.removeChild(backdrop);
        }
    }
})();
