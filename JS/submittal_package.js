/* ============================================================
   HHpro - Submittal package (one combined PDF per project)
   ------------------------------------------------------------
   Project view > FILES > "Submittal Package PDF". The person picks
   which PDF document types to include (equipment schedules,
   submittals and LC RTU performance sheets are ticked; manuals,
   capacity tables and controls sheets aren't), then gets ONE PDF:

     1. Cover      - Hoffman & Hoffman logo, project name, date,
                     prepared by, item / document / page counts
     2. Index      - every section with its tag(s), document type,
                     file and starting page; each row is a link
     3. Equipment schedules (the project's FULL SCHEDULE (PDF))
     4. Each product's documents, item by item in project order.
        A file shared by several items (one outdoor unit submittal
        for a whole multi split) goes in once, listing every tag.

   PDF bookmarks mirror the index (product > document). Files that
   can't be read (an encrypted manufacturer PDF, a failed fetch)
   are left out, marked in the index, and listed afterwards.

   pdf-lib (JS/pdf-lib.min.js, MIT, self-hosted - the site loads
   nothing from other hosts) is fetched only when a package is
   built, so normal page loads don't pay for it.

   Public API:
     HHpro.SubmittalPackage.open(filesData, activeState, opts)
         Shows the options dialog and builds + downloads the PDF.
         opts.button     - toolbar button (progress text goes on it)
         opts.beforeBuild(proceed) - e.g. the split system voltage /
                           kW check before a schedule is generated
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var LIB_URL = 'JS/pdf-lib.min.js?v=1.17.1';
    var LOGO_URL = 'ASSETS/HH_FullLogo_white_header.png';
    var SCHEDULE_TYPE = 'FULL SCHEDULE (PDF)';
    var PERFORMANCE_TYPE = 'PERFORMANCE SHEET';

    // Letter portrait, in points.
    var PAGE_W = 612;
    var PAGE_H = 792;
    var MARGIN = 54;
    var ROW_H = 15;
    var INDEX_TOP = PAGE_H - 132;     // first table row baseline
    var INDEX_BOTTOM = 66;
    var ROWS_PER_PAGE = Math.floor((INDEX_TOP - INDEX_BOTTOM) / ROW_H) + 1;

    var libPromise = null;

    HHpro.SubmittalPackage = {
        open: open,
        pdfTypes: pdfTypes,
        build: build
    };

    // =================================================================
    // Options dialog
    // =================================================================

    function open(filesData, activeState, opts) {
        opts = opts || {};
        var types = pdfTypes(filesData);
        if (!types.length) {
            HHpro.UI.alert('This project has no PDF documents to put in a package yet.');
            return;
        }

        var backdrop = el('div', 'modal-backdrop');
        var modal = el('div', 'modal pkg-modal');
        var title = el('h2', 'modal-title');
        title.textContent = 'Submittal package';
        modal.appendChild(title);

        var desc = el('p', 'modal-desc');
        desc.textContent = 'One PDF with a cover page, a clickable index and the documents ' +
            'below, item by item in project order. Pick what to include:';
        modal.appendChild(desc);

        var list = el('div', 'pkg-type-list');
        var boxes = {};
        types.forEach(function (t) {
            var row = el('label', 'pkg-type-row');
            var cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = t.on;
            boxes[t.name] = cb;
            var name = el('span', 'pkg-type-name');
            name.textContent = t.label;
            var count = el('span', 'pkg-type-count');
            count.textContent = t.count + (t.count === 1 ? ' file' : ' files');
            row.appendChild(cb);
            row.appendChild(name);
            row.appendChild(count);
            list.appendChild(row);
        });
        modal.appendChild(list);

        var note = el('p', 'modal-desc pkg-note');
        note.textContent = 'Large packages (many RTU submittals) can take a minute to build.';
        modal.appendChild(note);

        var actions = el('div', 'modal-actions');
        var cancel = el('button', 'modal-btn modal-btn-secondary');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        var go = el('button', 'modal-btn modal-btn-primary');
        go.type = 'button';
        go.textContent = 'Build PDF';
        actions.appendChild(cancel);
        actions.appendChild(go);
        modal.appendChild(actions);

        function close() {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
        function sync() {
            go.disabled = !Object.keys(boxes).some(function (k) { return boxes[k].checked; });
        }
        Object.keys(boxes).forEach(function (k) { boxes[k].addEventListener('change', sync); });
        sync();

        cancel.addEventListener('click', close);
        backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
        go.addEventListener('click', function () {
            var include = {};
            Object.keys(boxes).forEach(function (k) { include[k] = boxes[k].checked; });
            close();
            var run = function () { runBuild(filesData, activeState, include, opts.button); };
            if (include[SCHEDULE_TYPE] && typeof opts.beforeBuild === 'function') opts.beforeBuild(run);
            else run();
        });

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
    }

    function runBuild(filesData, activeState, include, button) {
        var label = button ? (button.querySelector('span') || button) : null;
        var original = label ? label.textContent : '';
        function progress(text) { if (label) label.textContent = text; }
        if (button) {
            button.disabled = true;
            button.classList.add('projects-btn-busy');
        }
        var projectName = (activeState && activeState.mode === 'project')
            ? (activeState.name || 'Project') : 'Cart';
        build(filesData, {
            include: include,
            projectName: projectName,
            preparedBy: (HHpro.State && HHpro.State.getUserName) ? HHpro.State.getUserName() : '',
            onProgress: progress
        }).then(function (res) {
            downloadBlob(res.blob, safeName(projectName) + ' - Submittal Package - ' + todayStr() + '.pdf');
            if (HHpro.Api && HHpro.Api.usage) HHpro.Api.usage('export', 'pdf', 'submittal_package');
            if (res.skipped.length) {
                HHpro.UI.alert(res.skipped.length + ' file(s) could not be added and are marked ' +
                    '"not included" in the index:\n\n' +
                    res.skipped.slice(0, 15).map(function (s) {
                        return '  - ' + s.filename + ' (' + s.reason + ')';
                    }).join('\n') +
                    (res.skipped.length > 15 ? '\n  ...and ' + (res.skipped.length - 15) + ' more.' : ''));
            }
        }).catch(function (err) {
            HHpro.UI.alert('Could not build the submittal package: ' + ((err && err.message) || err));
        }).then(function () {
            if (button) {
                button.disabled = false;
                button.classList.remove('projects-btn-busy');
            }
            progress(original);
        });
    }

    // =================================================================
    // What can go in
    // =================================================================

    function isPdf(f) {
        return String((f.docColumn && f.docColumn.fileExtension) || '').toLowerCase() === 'pdf';
    }

    function defaultOn(name) {
        return name === SCHEDULE_TYPE || name === PERFORMANCE_TYPE || /SUBMITTAL/i.test(name);
    }

    // [{ name, label, count, on }] for every PDF document type in the
    // Files tab data, schedules first.
    function pdfTypes(filesData) {
        var out = [];
        var schedule = (filesData.projectFiles || []).filter(function (f) {
            return f.docTypeName === SCHEDULE_TYPE;
        })[0];
        if (schedule) out.push({ name: SCHEDULE_TYPE, label: 'Equipment schedules', count: 1, on: true });
        var counts = {};
        var order = [];
        filesData.products.forEach(function (p) {
            p.items.forEach(function (it) {
                it.files.forEach(function (f) {
                    if (!isPdf(f)) return;
                    var t = f.docTypeName;
                    if (!counts[t]) { counts[t] = {}; order.push(t); }
                    counts[t][f.url || f.key] = true;
                });
            });
        });
        // Keep the Files tab's type order (documentation column order).
        var rank = {};
        (filesData.docTypeNames || []).forEach(function (n, i) { rank[n] = i; });
        order.sort(function (a, b) {
            return (rank[a] === undefined ? 999 : rank[a]) - (rank[b] === undefined ? 999 : rank[b]);
        });
        order.forEach(function (t) {
            out.push({ name: t, label: titleCase(t), count: Object.keys(counts[t]).length, on: defaultOn(t) });
        });
        return out;
    }

    // Documents in package order, deduplicated by file.
    function collectEntries(filesData, include) {
        var entries = [];
        var byKey = {};
        filesData.products.forEach(function (p) {
            p.items.forEach(function (it) {
                it.files.forEach(function (f) {
                    if (!isPdf(f) || !include[f.docTypeName]) return;
                    var key = f.url || ('generated|' + f.key);
                    var tag = itemTag(it);
                    if (byKey[key]) {
                        if (byKey[key].tags.indexOf(tag) < 0) byKey[key].tags.push(tag);
                        return;
                    }
                    var entry = {
                        product: p.displayName,
                        docType: f.docTypeName,
                        // Without a docSubfolders prefix ("Gas Pack/...").
                        filename: String(f.filenameWithExt || '').split('/').pop(),
                        url: f.url,
                        generator: f.generator,
                        tags: [tag],
                        label: it.label || ''
                    };
                    byKey[key] = entry;
                    entries.push(entry);
                });
            });
        });
        return entries;
    }

    function itemTag(it) {
        return it.tag ? String(it.tag) : '(untagged)';
    }

    // =================================================================
    // Build
    // =================================================================

    function loadLib() {
        if (window.PDFLib) return Promise.resolve(window.PDFLib);
        if (libPromise) return libPromise;
        libPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = LIB_URL;
            s.onload = function () {
                if (window.PDFLib) resolve(window.PDFLib);
                else reject(new Error('the PDF library did not load'));
            };
            s.onerror = function () {
                libPromise = null;
                reject(new Error('could not load ' + LIB_URL));
            };
            document.head.appendChild(s);
        });
        return libPromise;
    }

    function build(filesData, opts) {
        var include = opts.include || {};
        var progress = opts.onProgress || function () {};
        var entries = collectEntries(filesData, include);
        var schedule = include[SCHEDULE_TYPE] ? (filesData.projectFiles || []).filter(function (f) {
            return f.docTypeName === SCHEDULE_TYPE;
        })[0] : null;
        if (!entries.length && !schedule) {
            return Promise.reject(new Error('nothing was selected to include.'));
        }

        progress('Loading PDF tools...');
        return loadLib().then(function (L) {
            return L.PDFDocument.create().then(function (out) {
                var ctx = {
                    L: L, out: out, entries: entries, schedule: schedule,
                    sections: [], skipped: [], progress: progress, opts: opts
                };
                return Promise.all([
                    out.embedFont(L.StandardFonts.Helvetica),
                    out.embedFont(L.StandardFonts.HelveticaBold),
                    fetchBytes(LOGO_URL).then(function (b) { return out.embedPng(b); })
                        .catch(function () { return null; })
                ]).then(function (assets) {
                    ctx.font = assets[0];
                    ctx.bold = assets[1];
                    ctx.logo = assets[2];
                    return assemble(ctx);
                });
            });
        });
    }

    function assemble(c) {
        var out = c.out;
        // Index rows: the schedule, then a heading row per product + a row
        // per document. Pages are reserved up front (cover + index) and
        // drawn once every document's page number is known.
        var rows = [];
        if (c.schedule) rows.push({ kind: 'doc', section: null, schedule: true });
        var lastProduct = null;
        c.entries.forEach(function (e) {
            if (e.product !== lastProduct) {
                rows.push({ kind: 'heading', text: e.product });
                lastProduct = e.product;
            }
            rows.push({ kind: 'doc', entry: e });
        });
        var indexPageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
        var cover = out.addPage([PAGE_W, PAGE_H]);
        var indexPages = [];
        for (var i = 0; i < indexPageCount; i++) indexPages.push(out.addPage([PAGE_W, PAGE_H]));

        var chain = Promise.resolve();
        var total = c.entries.length + (c.schedule ? 1 : 0);
        var done = 0;

        if (c.schedule) {
            chain = chain.then(function () {
                c.progress('Adding schedules...');
                return Promise.resolve(c.schedule.generator()).then(blobBytes).then(function (bytes) {
                    return addDocument(c, bytes, 'Equipment schedules');
                }).then(function (sec) {
                    c.scheduleSection = sec;
                }, function (err) {
                    c.skipped.push({ filename: 'Equipment schedules', reason: reasonOf(err) });
                }).then(function () { done++; });
            });
        }
        c.entries.forEach(function (e) {
            chain = chain.then(function () {
                c.progress('Adding ' + (done + 1) + ' / ' + total + '...');
                var source = (typeof e.generator === 'function')
                    ? Promise.resolve(e.generator()).then(blobBytes)
                    : fetchBytes(e.url);
                return source.then(function (bytes) {
                    return addDocument(c, bytes, e.filename);
                }).then(function (sec) {
                    e.section = sec;
                }, function (err) {
                    c.skipped.push({ filename: e.filename, reason: reasonOf(err) });
                }).then(function () { done++; });
            });
        });

        return chain.then(function () {
            c.progress('Writing index...');
            drawCover(c, cover);
            drawIndex(c, indexPages, rows);
            addOutline(c, indexPages);
            var title = c.opts.projectName + ' - Submittal Package';
            out.setTitle(sanitize(title));
            out.setAuthor(sanitize(c.opts.preparedBy || 'Hoffman & Hoffman, Inc.'));
            out.setCreator('HHpro-HVAC.com');
            out.setProducer('HHpro');
            c.progress('Saving PDF...');
            return out.save({ useObjectStreams: true });
        }).then(function (bytes) {
            return {
                blob: new Blob([bytes], { type: 'application/pdf' }),
                skipped: c.skipped,
                pages: out.getPageCount()
            };
        });
    }

    // Copy every page of one source PDF onto the end of the package.
    // Returns { startIndex, pageCount } (0-based page index).
    function addDocument(c, bytes, name) {
        return c.L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
            .then(function (src) {
                if (src.isEncrypted) throw new Error('the PDF is encrypted');
                return c.out.copyPages(src, src.getPageIndices()).then(function (pages) {
                    if (!pages.length) throw new Error('the PDF has no pages');
                    var start = c.out.getPageCount();
                    pages.forEach(function (p) { c.out.addPage(p); });
                    return { startIndex: start, pageCount: pages.length, name: name };
                });
            });
    }

    // =================================================================
    // Cover + index pages
    // =================================================================

    var NAVY = [0.059, 0.090, 0.165];
    var TEXT = [0.10, 0.12, 0.16];
    var MUTED = [0.40, 0.44, 0.50];
    var RULE = [0.78, 0.80, 0.84];
    var ACCENT = [0.059, 0.298, 0.459];

    function rgb(c, a) { return c.L.rgb(a[0], a[1], a[2]); }

    function drawCover(c, page) {
        var L = c.L;
        // Navy band with the white logo.
        page.drawRectangle({ x: 0, y: PAGE_H - 132, width: PAGE_W, height: 132, color: rgb(c, NAVY) });
        if (c.logo) {
            var w = 300;
            var h = w * c.logo.height / c.logo.width;
            page.drawImage(c.logo, { x: MARGIN, y: PAGE_H - 66 - h / 2, width: w, height: h });
        } else {
            text(c, page, 'HOFFMAN & HOFFMAN, INC.', MARGIN, PAGE_H - 74, 18, c.bold, [1, 1, 1]);
        }

        var y = PAGE_H - 230;
        text(c, page, 'SUBMITTAL PACKAGE', MARGIN, y, 13, c.bold, ACCENT);
        y -= 40;
        y = wrapText(c, page, c.opts.projectName, MARGIN, y, 30, c.bold, TEXT, PAGE_W - 2 * MARGIN, 36);
        page.drawLine({ start: { x: MARGIN, y: y + 6 }, end: { x: PAGE_W - MARGIN, y: y + 6 },
                        thickness: 1, color: rgb(c, RULE) });
        y -= 30;

        var docCount = c.entries.length;
        var itemCount = {};
        c.entries.forEach(function (e) { e.tags.forEach(function (t) { itemCount[e.product + '|' + t] = true; }); });
        var facts = [
            ['Date', longDate()],
            ['Prepared by', c.opts.preparedBy || '-'],
            ['Documents', String(docCount + (c.schedule ? 1 : 0))],
            ['Pages', String(c.out.getPageCount())]
        ];
        facts.forEach(function (f) {
            text(c, page, f[0].toUpperCase(), MARGIN, y, 9, c.bold, MUTED);
            text(c, page, f[1], MARGIN + 110, y, 12, c.font, TEXT);
            y -= 24;
        });

        // Products in the package, with how many items each covers.
        var products = [];
        var perProduct = {};
        c.entries.forEach(function (e) {
            if (!perProduct[e.product]) { perProduct[e.product] = {}; products.push(e.product); }
            e.tags.forEach(function (t) { perProduct[e.product][t] = true; });
        });
        if (products.length) {
            y -= 16;
            text(c, page, 'EQUIPMENT INCLUDED', MARGIN, y, 9, c.bold, MUTED);
            y -= 22;
            products.forEach(function (p) {
                if (y < 120) return;
                var n = Object.keys(perProduct[p]).length;
                text(c, page, p, MARGIN, y, 12, c.font, TEXT);
                text(c, page, n + (n === 1 ? ' unit' : ' units'), PAGE_W - MARGIN - 70, y, 11, c.font, MUTED);
                y -= 20;
            });
        }

        text(c, page, 'Created with HHpro-HVAC.com', MARGIN, 40, 9, c.font, MUTED);
        void L;
    }

    function drawIndex(c, pages, rows) {
        var colTag = MARGIN;
        var colDoc = MARGIN + 150;
        var colFile = MARGIN + 300;
        var colPage = PAGE_W - MARGIN;
        var tagW = colDoc - colTag - 10;
        var docW = colFile - colDoc - 10;
        var fileW = colPage - 40 - colFile;

        pages.forEach(function (page, pi) {
            text(c, page, 'INDEX' + (pages.length > 1 ? '  (' + (pi + 1) + ' of ' + pages.length + ')' : ''),
                 MARGIN, PAGE_H - 72, 18, c.bold, TEXT);
            text(c, page, c.opts.projectName, MARGIN, PAGE_H - 90, 10, c.font, MUTED);
            var hy = INDEX_TOP + 20;
            text(c, page, 'TAG(S)', colTag, hy, 8, c.bold, MUTED);
            text(c, page, 'DOCUMENT', colDoc, hy, 8, c.bold, MUTED);
            text(c, page, 'FILE', colFile, hy, 8, c.bold, MUTED);
            textRight(c, page, 'PAGE', colPage, hy, 8, c.bold, MUTED);
            page.drawLine({ start: { x: MARGIN, y: hy - 5 }, end: { x: PAGE_W - MARGIN, y: hy - 5 },
                            thickness: 0.75, color: rgb(c, RULE) });
            text(c, page, 'Click a row to jump to that document.', MARGIN, 40, 8, c.font, MUTED);
        });

        rows.forEach(function (row, i) {
            var page = pages[Math.floor(i / ROWS_PER_PAGE)];
            var y = INDEX_TOP - (i % ROWS_PER_PAGE) * ROW_H;
            if (row.kind === 'heading') {
                text(c, page, fit(c, row.text.toUpperCase(), c.bold, 9, PAGE_W - 2 * MARGIN), colTag, y, 9, c.bold, ACCENT);
                return;
            }
            var sec, tags, docType, file;
            if (row.schedule) {
                sec = c.scheduleSection;
                tags = 'All';
                docType = 'Equipment schedules';
                file = 'Full Schedule.pdf';
            } else {
                sec = row.entry.section;
                tags = row.entry.tags.join(', ');
                docType = titleCase(row.entry.docType);
                file = row.entry.filename;
            }
            text(c, page, fit(c, tags, c.font, 9, tagW), colTag, y, 9, c.font, TEXT);
            text(c, page, fit(c, docType, c.font, 9, docW), colDoc, y, 9, c.font, TEXT);
            text(c, page, fit(c, file, c.font, 9, fileW), colFile, y, 9, c.font, MUTED);
            if (sec) {
                textRight(c, page, String(sec.startIndex + 1), colPage, y, 9, c.bold, TEXT);
                addLink(c, page, [MARGIN - 2, y - 4, PAGE_W - MARGIN + 2, y + 10], sec.startIndex);
            } else {
                textRight(c, page, 'not included', colPage, y, 8, c.font, MUTED);
            }
        });
    }

    // =================================================================
    // Bookmarks + links (pdf-lib low-level objects)
    // =================================================================

    function destFor(c, pageIndex) {
        var ctx = c.out.context;
        var ref = c.out.getPage(pageIndex).ref;
        return ctx.obj([ref, 'XYZ', null, null, null]);
    }

    function addLink(c, page, rect, pageIndex) {
        var ctx = c.out.context;
        var annot = ctx.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: rect,
            Border: [0, 0, 0],
            Dest: destFor(c, pageIndex)
        });
        var ref = ctx.register(annot);
        var name = c.L.PDFName.of('Annots');
        var annots = page.node.lookup(name);
        if (annots && typeof annots.push === 'function') annots.push(ref);
        else page.node.set(name, ctx.obj([ref]));
    }

    // Cover, Index, Equipment schedules, then product > document.
    function addOutline(c, indexPages) {
        var top = [
            { title: 'Cover', page: 0 },
            { title: 'Index', page: 1 }
        ];
        if (c.scheduleSection) top.push({ title: 'Equipment schedules', page: c.scheduleSection.startIndex });
        var byProduct = {};
        c.entries.forEach(function (e) {
            if (!e.section) return;
            var node = byProduct[e.product];
            if (!node) {
                node = byProduct[e.product] = { title: e.product, page: e.section.startIndex, children: [] };
                top.push(node);
            }
            node.children.push({
                title: e.tags.join(', ') + ' - ' + titleCase(e.docType) + ' (' + e.filename + ')',
                page: e.section.startIndex
            });
        });
        void indexPages;

        var L = c.L;
        var ctx = c.out.context;
        var rootRef = ctx.nextRef();

        function writeLevel(nodes, parentRef) {
            var refs = nodes.map(function () { return ctx.nextRef(); });
            var count = 0;
            nodes.forEach(function (n, i) {
                var dict = ctx.obj({ Parent: parentRef, Dest: destFor(c, n.page) });
                dict.set(L.PDFName.of('Title'), L.PDFHexString.fromText(n.title));
                if (i > 0) dict.set(L.PDFName.of('Prev'), refs[i - 1]);
                if (i < refs.length - 1) dict.set(L.PDFName.of('Next'), refs[i + 1]);
                count++;
                if (n.children && n.children.length) {
                    var sub = writeLevel(n.children, refs[i]);
                    dict.set(L.PDFName.of('First'), sub.first);
                    dict.set(L.PDFName.of('Last'), sub.last);
                    // Negative count: the product starts collapsed.
                    dict.set(L.PDFName.of('Count'), ctx.obj(-sub.count));
                }
                ctx.assign(refs[i], dict);
            });
            return { first: refs[0], last: refs[refs.length - 1], count: count };
        }

        var lvl = writeLevel(top, rootRef);
        ctx.assign(rootRef, ctx.obj({ Type: 'Outlines', First: lvl.first, Last: lvl.last, Count: lvl.count }));
        c.out.catalog.set(L.PDFName.of('Outlines'), rootRef);
        c.out.catalog.set(L.PDFName.of('PageMode'), L.PDFName.of('UseOutlines'));
    }

    // =================================================================
    // Text helpers (standard fonts: WinAnsi characters only)
    // =================================================================

    function sanitize(s) {
        return String(s == null ? '' : s)
            .replace(/[‘’]/g, '\'')
            .replace(/[“”]/g, '"')
            .replace(/[–—]/g, '-')
            .replace(/…/g, '...')
            .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
    }

    function text(c, page, s, x, y, size, font, color) {
        page.drawText(sanitize(s), { x: x, y: y, size: size, font: font, color: rgb(c, color) });
    }

    function textRight(c, page, s, xRight, y, size, font, color) {
        var t = sanitize(s);
        text(c, page, t, xRight - font.widthOfTextAtSize(t, size), y, size, font, color);
    }

    // Truncate with "..." to fit maxWidth.
    function fit(c, s, font, size, maxWidth) {
        var t = sanitize(s);
        if (font.widthOfTextAtSize(t, size) <= maxWidth) return t;
        while (t.length > 1 && font.widthOfTextAtSize(t + '...', size) > maxWidth) t = t.slice(0, -1);
        return t + '...';
    }

    // Word-wrap a long title; returns the y below the last line.
    function wrapText(c, page, s, x, y, size, font, color, maxWidth, lineH) {
        var words = sanitize(s).split(/\s+/);
        var line = '';
        var lines = 0;
        words.forEach(function (w) {
            var next = line ? line + ' ' + w : w;
            if (line && font.widthOfTextAtSize(next, size) > maxWidth && lines < 2) {
                text(c, page, line, x, y, size, font, color);
                y -= lineH;
                lines++;
                line = w;
            } else {
                line = next;
            }
        });
        if (line) {
            text(c, page, fit(c, line, font, size, maxWidth), x, y, size, font, color);
            y -= lineH;
        }
        return y;
    }

    function titleCase(s) {
        return String(s || '').toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, function (m, p, ch) {
            return p + ch.toUpperCase();
        });
    }

    // =================================================================
    // Small utilities
    // =================================================================

    function fetchBytes(url) {
        return fetch(url).then(function (resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            if (HHpro.Docs && HHpro.Docs.isMissingResponse && HHpro.Docs.isMissingResponse(resp, url)) {
                throw new Error('not on the site yet');
            }
            return resp.arrayBuffer();
        });
    }

    function blobBytes(blob) {
        if (!blob) throw new Error('nothing was generated');
        return blob.arrayBuffer ? blob.arrayBuffer() : new Response(blob).arrayBuffer();
    }

    function reasonOf(err) {
        return (err && err.message) ? err.message : String(err);
    }

    function el(tag, cls) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        return e;
    }

    function downloadBlob(blob, filename) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
            if (a.parentNode) a.parentNode.removeChild(a);
            URL.revokeObjectURL(url);
        }, 1000);
    }

    function safeName(name) {
        return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'project';
    }

    function todayStr() {
        var d = new Date();
        return (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getFullYear();
    }

    function longDate() {
        return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }
})();
