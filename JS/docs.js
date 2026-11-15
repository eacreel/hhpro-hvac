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

   Example:  ASSETS/MARVAIR/SUBMITTALS/MARVAIR MGH DATASHEET.pdf
   A filename may carry a subfolder (docSubfolders in the converter):
             ASSETS/DAIKIN LIGHT COMMERCIAL RTU/SUBMITTALS/Gas Pack/DSG0363DM.pdf

   Public API:
     HHpro.Docs.openSubmittal(product, selection, data)
         Opens every available submittal PDF for the selection,
         each in its own tab. For 1:1 systems this is a single
         SYSTEM submittal; for multi-split / multi-position-split
         systems this is the outdoor unit submittal plus one
         submittal per distinct indoor unit.

     HHpro.Docs.openDocsModal(product, selection, data)
         Opens a popup with every available document for the
         selection, deduplicated across rows.

     HHpro.Docs.hasSubmittal(selection, data)
         True when at least one submittal filename exists in the
         selection's documentation data. Lets the schedule mark
         the Submittal button as unavailable at render time.

   openSubmittal and openDocsModal take an optional 4th argument
   { generated: [{ name, filename, generate }] }: documents built in
   the browser (the LC RTU "performance at design conditions" sheet).
   generate() returns a PDF Blob; it opens in a new tab beside the
   submittal(s), and is listed first in the popup.

   Missing files (Nov 2026)
   ------------------------
   The workbooks can name a document before its file is in ASSETS.
   On Cloudflare a missing file doesn't 404: the site's own page
   comes back instead, so a broken Submittal opened the home page
   and a ZIP could hold an HTML page named ".pdf". Every document
   is now checked before it's offered:
     - DATA/asset_index.json lists every file under ASSETS. It is
       written at deploy time by DATA/DATA FILES/build_asset_index.js
       (Cloudflare build command) and is never committed.
     - A file the index doesn't list - or every file, when there is
       no index (local testing, or before the build step is set
       up) - is checked with a HEAD request: missing when it fails
       or answers with an HTML page. Results are cached per page
       load, a few requests at a time.
   checkUrls(urls) -> Promise<{ url: true | false }>
   isAvailable(url) -> true / false, or undefined until checked
   Submittal / Docs buttons strike through once every file they
   would open is known to be missing; the popup greys missing
   files out; openSubmittal opens only files that exist.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    HHpro.Docs = {
        openSubmittal: openSubmittal,
        openDocsModal: openDocsModal,
        hasSubmittal: hasSubmittal,
        // Document availability (see the header).
        checkUrls: checkUrls,
        isAvailable: isAvailable,
        // Resolves once the asset index has loaded (or proved absent).
        ready: function () { return loadIndex(); },
        isMissingResponse: isMissingResponse,
        buildDocUrl: buildDocUrl,
        submittalUrls: submittalUrls,
        docUrls: docUrls,
        collectSelectionDocs: function (sel, data) {
            return collectSelectionDocs(sel, (data && data.documentationColumns) || []);
        },
        collectSelectionSubmittals: function (sel, data) {
            return collectSelectionSubmittals(sel, (data && data.documentationColumns) || []);
        }
    };

    // =================================================================
    // Availability: asset index + HEAD checks
    // =================================================================

    var INDEX_URL = 'DATA/asset_index.json';
    var MAX_IN_FLIGHT = 6;

    var indexPromise = null;
    var indexSet = null;      // decoded paths ("ASSETS/.../x.pdf") or null
    var known = {};           // decoded path -> true / false
    var waiting = {};         // decoded path -> Promise<boolean>
    var queue = [];
    var inFlight = 0;

    function loadIndex() {
        if (indexPromise) return indexPromise;
        indexPromise = fetch(INDEX_URL, { cache: 'no-cache' })
            .then(function (r) {
                if (!r.ok || isHtml(r)) return null;
                return r.json();
            })
            .then(function (json) {
                var folders = json && json.folders;
                if (!folders) return null;
                var set = {};
                Object.keys(folders).forEach(function (dir) {
                    (folders[dir] || []).forEach(function (name) {
                        set[dir + '/' + name] = true;
                    });
                });
                indexSet = set;
                return set;
            })
            .catch(function () { return null; });
        return indexPromise;
    }

    function isHtml(resp) {
        return /text\/html/i.test((resp.headers && resp.headers.get('content-type')) || '');
    }

    // A fetch/HEAD response for a document that isn't really there: an
    // error status, or the site's HTML page served in its place.
    function isMissingResponse(resp, url) {
        if (!resp || !resp.ok) return true;
        return isHtml(resp) && !/\.html?$/i.test(String(url || '').split('?')[0]);
    }

    function pathOf(url) {
        try { return decodeURI(String(url)); } catch (e) { return String(url); }
    }

    // The index is written from the very files being deployed, so with it
    // loaded a path it doesn't list is missing - no request needed.
    function isAvailable(url) {
        var p = pathOf(url);
        if (indexSet) return !!indexSet[p];
        if (known[p] !== undefined) return known[p];
        return undefined;
    }

    function headCheck(url) {
        var p = pathOf(url);
        if (waiting[p]) return waiting[p];
        waiting[p] = new Promise(function (resolve) {
            queue.push({ url: url, resolve: resolve });
            pump();
        }).then(function (ok) {
            known[p] = ok;
            delete waiting[p];
            return ok;
        });
        return waiting[p];
    }

    function pump() {
        while (inFlight < MAX_IN_FLIGHT && queue.length) {
            var job = queue.shift();
            inFlight++;
            (function (job) {
                fetch(job.url, { method: 'HEAD', cache: 'no-cache' })
                    .then(function (r) { return !isMissingResponse(r, job.url); })
                    .catch(function () { return false; })
                    .then(function (ok) {
                        inFlight--;
                        job.resolve(ok);
                        pump();
                    });
            })(job);
        }
    }

    // { url: true | false } for every url, once each one is known.
    function checkUrls(urls) {
        var list = (urls || []).filter(Boolean);
        return loadIndex().then(function () {
            return Promise.all(list.map(function (url) {
                var now = isAvailable(url);
                if (now !== undefined) return now;
                return headCheck(url);
            })).then(function (results) {
                var out = {};
                list.forEach(function (url, i) { out[url] = results[i]; });
                return out;
            });
        });
    }

    function submittalUrls(product, sel, data) {
        return collectSelectionSubmittals(sel, (data && data.documentationColumns) || [])
            .map(function (it) { return buildDocUrl(product, it.docColumn, it.filename); });
    }

    function docUrls(product, sel, data) {
        return collectSelectionDocs(sel, (data && data.documentationColumns) || [])
            .map(function (it) { return buildDocUrl(product, it.docColumn, it.filename); });
    }

    // Start loading the index straight away: by the time a schedule's
    // buttons ask, it's usually there.
    loadIndex();

    // =================================================================
    // Public: open every submittal PDF for a selection
    // =================================================================

    function openSubmittal(product, sel, data, opts) {
        var docColumns = (data && data.documentationColumns) || [];
        var submittals = collectSelectionSubmittals(sel, docColumns);
        var generated = (opts && opts.generated) || [];
        var urls = submittals.map(function (item) {
            return buildDocUrl(product, item.docColumn, item.filename);
        });

        function finish(found) {
            var opened = urls.filter(function (url) { return found[url] !== false; });
            opened.forEach(openInNewTab);
            generated.forEach(openGenerated);
            if (!opened.length) {
                HHpro.UI.alert((submittals.length
                        ? 'The submittal for this item isn\'t available yet.'
                        : 'No submittal is available for this item.') +
                    (generated.length ? ' Its performance sheet opened in a new tab.' : ''));
            } else if (opened.length < urls.length) {
                HHpro.UI.alert((urls.length - opened.length) + ' of ' + urls.length +
                    ' submittals for this item aren\'t available yet; the others opened in new tabs.');
            }
        }

        // Already known (the usual case - the asset index, or the check
        // the button ran when it was drawn): open now, inside the click,
        // so no popup blocker objects.
        var allKnown = urls.every(function (url) { return isAvailable(url) !== undefined; });
        if (allKnown) {
            var found = {};
            urls.forEach(function (url) { found[url] = isAvailable(url); });
            finish(found);
            return;
        }
        checkUrls(urls).then(finish);
    }

    // A generated document's PDF in a new tab. The object URL outlives the
    // tab's load, then is released.
    function openGenerated(doc) {
        var blob;
        try { blob = doc.generate(); } catch (e) {
            HHpro.UI.alert('Could not build ' + (doc.filename || 'the document') + ': ' + ((e && e.message) || e));
            return;
        }
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        openInNewTab(url);
        setTimeout(function () { URL.revokeObjectURL(url); }, 120000);
    }

    /**
     * True when the selection has at least one submittal filename in its
     * documentation data. Same check openSubmittal uses before alerting,
     * so button state and click behavior can never disagree.
     */
    function hasSubmittal(sel, data) {
        var docColumns = (data && data.documentationColumns) || [];
        return collectSelectionSubmittals(sel, docColumns).length > 0;
    }

    /**
     * Collect every unique submittal (column, filename) pair across all
     * rows of the selection. Deduplicates so the outdoor unit submittal
     * doesn't open once per indoor-unit row in a multi-split system.
     */
    function collectSelectionSubmittals(sel, docColumns) {
        var submittalCols = docColumns.filter(function (dc) {
            return /SUBMITTAL/i.test(dc.name);
        });
        return collectSelectionDocs(sel, submittalCols);
    }

    // =================================================================
    // Public: open the all-documents popup
    // =================================================================

    function openDocsModal(product, sel, data, opts) {
        var docColumns = (data && data.documentationColumns) || [];
        var items = ((opts && opts.generated) || []).map(function (doc) {
            return { generated: doc };
        }).concat(collectSelectionDocs(sel, docColumns));

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
        closeBtn.appendChild(HHpro.UI.icon('x'));
        closeBtn.addEventListener('click', function () { closeModal(backdrop); });

        header.appendChild(title);
        header.appendChild(closeBtn);
        modal.appendChild(header);

        if (items.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'hh-empty docs-empty';
            empty.appendChild(HHpro.UI.icon('file-text'));
            var emptyTitle = document.createElement('div');
            emptyTitle.className = 'hh-empty-title';
            emptyTitle.textContent = 'No documents';
            var emptyHint = document.createElement('div');
            emptyHint.className = 'hh-empty-hint';
            emptyHint.textContent = 'No documents are available for this item.';
            empty.appendChild(emptyTitle);
            empty.appendChild(emptyHint);
            modal.appendChild(empty);
        } else {
            var list = document.createElement('div');
            list.className = 'docs-list';
            var rowsByUrl = {};
            items.forEach(function (item) {
                var rowEl = buildDocListItem(product, item);
                list.appendChild(rowEl);
                if (!item.generated) {
                    var url = buildDocUrl(product, item.docColumn, item.filename);
                    (rowsByUrl[url] = rowsByUrl[url] || []).push(rowEl);
                }
            });
            modal.appendChild(list);
            // Grey out the files that aren't on the site yet.
            checkUrls(Object.keys(rowsByUrl)).then(function (found) {
                Object.keys(found).forEach(function (url) {
                    if (found[url] !== false) return;
                    rowsByUrl[url].forEach(markMissingRow);
                });
            });
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
        if (item.generated) return buildGeneratedListItem(item.generated);
        var row = document.createElement('div');
        row.className = 'docs-item';

        var info = document.createElement('div');
        info.className = 'docs-item-info';

        var name = document.createElement('div');
        name.className = 'docs-item-name';
        name.textContent = HHpro.Format ? HHpro.Format.label(item.docColumn.name) : item.docColumn.name;

        var filename = document.createElement('div');
        filename.className = 'docs-item-file';
        filename.textContent = item.filename + '.' + item.docColumn.fileExtension;

        info.appendChild(name);
        info.appendChild(filename);

        var isZip = String(item.docColumn.fileExtension || '').toLowerCase() === 'zip';
        var actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'docs-item-action ' + (isZip ? 'docs-item-action-download' : 'docs-item-action-view');
        // Icon distinguishes viewable PDFs from ZIP downloads at a glance
        actionBtn.appendChild(HHpro.UI.icon(isZip ? 'download' : 'file-text'));
        actionBtn.appendChild(document.createTextNode(isZip ? 'Download' : 'View'));

        var url = buildDocUrl(product, item.docColumn, item.filename);
        actionBtn.addEventListener('click', function () {
            if (isZip) triggerDownload(url);
            else openInNewTab(url);
        });

        row.appendChild(info);
        row.appendChild(actionBtn);
        return row;
    }

    // A popup row whose file isn't on the site: muted, its button off.
    function markMissingRow(rowEl) {
        rowEl.classList.add('docs-item-missing');
        var btn = rowEl.querySelector('.docs-item-action');
        if (btn) {
            btn.disabled = true;
            btn.title = 'This file isn\'t available yet';
        }
        var file = rowEl.querySelector('.docs-item-file');
        if (file && !file.querySelector('.docs-item-missing-note')) {
            var note = document.createElement('span');
            note.className = 'docs-item-missing-note';
            note.textContent = 'Not available yet';
            file.appendChild(note);
        }
    }

    // A generated document's row: same look, View builds it.
    function buildGeneratedListItem(doc) {
        var row = document.createElement('div');
        row.className = 'docs-item';
        var info = document.createElement('div');
        info.className = 'docs-item-info';
        var name = document.createElement('div');
        name.className = 'docs-item-name';
        name.textContent = doc.name;
        var filename = document.createElement('div');
        filename.className = 'docs-item-file';
        filename.textContent = doc.filename;
        info.appendChild(name);
        info.appendChild(filename);
        var actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'docs-item-action docs-item-action-view';
        actionBtn.appendChild(HHpro.UI.icon('file-text'));
        actionBtn.appendChild(document.createTextNode('View'));
        actionBtn.addEventListener('click', function () { openGenerated(doc); });
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
        // the slash separators. Local file paths like "ASSETS/GRILLES/..."
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
