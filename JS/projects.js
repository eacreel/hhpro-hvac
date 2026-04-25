/* ============================================================
   HHpro - Projects view
   ------------------------------------------------------------
   The landing page for managing saved projects. Reached via the
   "Projects" tile on the main overview.

   Responsibilities:
     - List every saved project (from localStorage)
     - Create a new project (via the name-prompt modal)
     - Open a project (makes it the active cart, then navigates
       to the View Project page so the user can see it)
     - Delete a project (with a confirm modal)
     - Export projects to CSV (backup for if user clears cache)
     - Import projects from CSV (restore from backup)

   CSV format:
     One row per item. Project metadata repeats per row so
     multiple projects can live in one file. An "ExtraJSON"
     column at the end carries the project's extra-data blob
     (column visibility, Auto Tag defaults) as a JSON string.

     Header row:
       ProjectName, CreatedAt, UpdatedAt, instanceId,
       productKey, selectionId, label, addedAt, tag,
       indoorTags, configuration, accessories, ExtraJSON

     indoorTags is pipe-separated (e.g. "IDU-1|IDU-2|IDU-3")
     because arrays don't map cleanly into a CSV cell.

     Empty projects (no items) still get one row with blank
     item fields so round-tripping doesn't lose them.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    HHpro.Views.projects = {
        render: function (root) {
            root.innerHTML = '';
            if (HHpro.Cart && typeof HHpro.Cart.init === 'function') {
                HHpro.Cart.init();
            }
            root.appendChild(HHpro.UI.buildHeader('Projects'));
            root.appendChild(buildBody());
        }
    };

    // =================================================================
    // Body
    // =================================================================

    function buildBody() {
        var main = document.createElement('main');
        main.className = 'projects-view';

        main.appendChild(buildTitleBar());
        main.appendChild(buildToolbar());
        main.appendChild(buildProjectsList());

        return main;
    }

    function buildTitleBar() {
        var bar = document.createElement('div');
        bar.className = 'projects-titlebar';

        var title = document.createElement('h1');
        title.className = 'projects-title';
        title.textContent = 'Projects';
        bar.appendChild(title);

        return bar;
    }

    function buildToolbar() {
        var bar = document.createElement('div');
        bar.className = 'projects-toolbar';

        var newBtn = document.createElement('button');
        newBtn.type = 'button';
        newBtn.className = 'projects-btn projects-btn-primary';
        newBtn.appendChild(HHpro.UI.icon('file-plus'));
        var newLabel = document.createElement('span');
        newLabel.textContent = 'New Project';
        newBtn.appendChild(newLabel);
        newBtn.addEventListener('click', handleNewProject);
        bar.appendChild(newBtn);

        var importBtn = document.createElement('button');
        importBtn.type = 'button';
        importBtn.className = 'projects-btn projects-btn-secondary';
        importBtn.appendChild(HHpro.UI.icon('upload'));
        var importLabel = document.createElement('span');
        importLabel.textContent = 'Import from CSV';
        importBtn.appendChild(importLabel);
        importBtn.addEventListener('click', handleImportCSV);
        bar.appendChild(importBtn);

        var exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.className = 'projects-btn projects-btn-secondary';
        exportBtn.appendChild(HHpro.UI.icon('download'));
        var exportLabel = document.createElement('span');
        exportLabel.textContent = 'Export all to CSV';
        exportBtn.appendChild(exportLabel);
        exportBtn.addEventListener('click', handleExportAllCSV);
        if (!HHpro.Cart.listProjects().length) {
            exportBtn.disabled = true;
            exportBtn.title = 'No projects to export yet';
        }
        bar.appendChild(exportBtn);

        return bar;
    }

    function buildProjectsList() {
        var wrap = document.createElement('div');
        wrap.className = 'projects-list-wrap';

        var projects = HHpro.Cart.listProjects();
        if (!projects.length) {
            wrap.appendChild(buildEmptyState());
            return wrap;
        }

        var activeId = HHpro.Cart.getCurrentProjectId();
        var list = document.createElement('div');
        list.className = 'projects-list';

        projects.forEach(function (proj) {
            list.appendChild(buildProjectCard(proj, proj.id === activeId));
        });

        wrap.appendChild(list);
        return wrap;
    }

    function buildEmptyState() {
        var empty = document.createElement('div');
        empty.className = 'projects-empty';

        var msg = document.createElement('p');
        msg.className = 'projects-empty-msg';
        msg.textContent = 'No saved projects yet.';
        empty.appendChild(msg);

        var hint = document.createElement('p');
        hint.className = 'projects-empty-hint';
        hint.textContent = 'Create a new project to start building a schedule, or import from a CSV backup.';
        empty.appendChild(hint);

        return empty;
    }

    function buildProjectCard(proj, isActive) {
        var card = document.createElement('div');
        card.className = 'project-card';
        if (isActive) card.classList.add('project-card-active');

        var header = document.createElement('div');
        header.className = 'project-card-header';

        var nameWrap = document.createElement('div');
        nameWrap.className = 'project-card-name-wrap';

        var name = document.createElement('div');
        name.className = 'project-card-name';
        name.textContent = proj.name;
        nameWrap.appendChild(name);

        if (isActive) {
            var badge = document.createElement('span');
            badge.className = 'project-card-badge';
            badge.textContent = 'Active';
            nameWrap.appendChild(badge);
        }
        header.appendChild(nameWrap);

        var meta = document.createElement('div');
        meta.className = 'project-card-meta';
        var count = (proj.items && proj.items.length) || 0;
        var updated = proj.updatedAt ? relativeTime(proj.updatedAt) : 'never';
        meta.textContent = count + ' item' + (count === 1 ? '' : 's') + ' \u00b7 Updated ' + updated;
        header.appendChild(meta);

        card.appendChild(header);

        var actions = document.createElement('div');
        actions.className = 'project-card-actions';

        var openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'project-card-btn project-card-btn-primary';
        openBtn.textContent = isActive ? 'Continue' : 'Open';
        openBtn.addEventListener('click', function () { handleOpenProject(proj); });
        actions.appendChild(openBtn);

        var exportBtn = document.createElement('button');
        exportBtn.type = 'button';
        exportBtn.className = 'project-card-btn project-card-btn-secondary';
        exportBtn.textContent = 'Export CSV';
        exportBtn.addEventListener('click', function () { handleExportOne(proj); });
        actions.appendChild(exportBtn);

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'project-card-btn project-card-btn-danger';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', function () { handleDeleteProject(proj); });
        actions.appendChild(delBtn);

        card.appendChild(actions);
        return card;
    }

    // =================================================================
    // Action handlers
    // =================================================================

    function handleNewProject() {
        confirmDiscardTempCart(function () {
            HHpro.Cart.promptProjectName(function (name) {
                if (!name) return;
                HHpro.Cart.createAndActivateProject(name);
                // After creating, take the user to the new project page
                HHpro.App.showView('project_view');
            });
        });
    }

    function handleOpenProject(proj) {
        confirmDiscardTempCart(function () {
            var ok = HHpro.Cart.activateProject(proj.id);
            if (!ok) {
                alert('Could not open this project. It may have been deleted.');
                HHpro.App.showView('projects');
                return;
            }
            HHpro.App.showView('project_view');
        });
    }

    function handleDeleteProject(proj) {
        openConfirmModal({
            title: 'Delete this project?',
            body: '"' + proj.name + '" and all ' + (proj.items && proj.items.length || 0) +
                  ' item' + ((proj.items && proj.items.length) === 1 ? '' : 's') +
                  ' in it will be permanently removed from your browser.',
            confirmLabel: 'Delete',
            confirmVariant: 'danger',
            onConfirm: function () {
                HHpro.Cart.deleteProject(proj.id);
                HHpro.App.showView('projects');
            }
        });
    }

    function confirmDiscardTempCart(proceed) {
        if (!HHpro.Cart.hasUnsavedCartItems()) {
            proceed();
            return;
        }
        openConfirmModal({
            title: 'Discard temporary cart?',
            body: 'You have items in a temporary cart that aren\'t saved to a project. Opening or creating a different project will discard them.',
            confirmLabel: 'Discard and continue',
            confirmVariant: 'danger',
            onConfirm: proceed
        });
    }

    // =================================================================
    // CSV export
    // =================================================================

    function handleExportOne(proj) {
        var csv = projectsToCSV([proj]);
        var filename = safeFilename(proj.name || 'project') + ' - HHpro - ' + todayStr() + '.csv';
        downloadCSV(csv, filename);
    }

    function handleExportAllCSV() {
        var list = HHpro.Cart.listProjects();
        if (!list.length) {
            alert('No projects to export.');
            return;
        }
        var csv = projectsToCSV(list);
        var filename = 'HHpro Projects - ' + todayStr() + '.csv';
        downloadCSV(csv, filename);
    }

    /**
     * Build a CSV string from a list of project objects. Each item becomes
     * one row; empty projects still get a single blank-item row so we
     * don't lose them on round-trip.
     *
     * The ExtraJSON column on the FIRST row of each project carries the
     * serialized extra-data blob (hiddenColumns, lastAutoTag per product).
     * Subsequent rows for the same project leave ExtraJSON blank.
     *
     * indoorTags is serialized as a pipe-separated string like
     * "IDU-1|IDU-2|IDU-3" since arrays don't map cleanly to a CSV cell.
     */
    function projectsToCSV(projects) {
        var headers = [
            'ProjectName', 'CreatedAt', 'UpdatedAt',
            'instanceId', 'productKey', 'selectionId', 'label', 'addedAt',
            'tag', 'indoorTags', 'configuration', 'accessories', 'ExtraJSON'
        ];
        var rows = [headers];

        projects.forEach(function (proj) {
            var extraJson = '';
            if (proj.extra && Object.keys(proj.extra).length) {
                try { extraJson = JSON.stringify(proj.extra); } catch (e) { extraJson = ''; }
            }
            var items = proj.items || [];

            if (items.length === 0) {
                rows.push([
                    proj.name || '', proj.createdAt || '', proj.updatedAt || '',
                    '', '', '', '', '', '', '', '', '', extraJson
                ]);
                return;
            }
            items.forEach(function (it, idx) {
                var indoorSerialized = '';
                if (Array.isArray(it.indoorTags)) {
                    indoorSerialized = it.indoorTags
                        .map(function (t) { return String(t || ''); })
                        .join('|');
                }
                rows.push([
                    proj.name || '', proj.createdAt || '', proj.updatedAt || '',
                    it.instanceId || '',
                    it.productKey || '',
                    it.selectionId || '',
                    it.label || '',
                    it.addedAt || '',
                    it.tag || '',
                    indoorSerialized,
                    it.configuration || '',
                    it.accessories || '',
                    idx === 0 ? extraJson : ''
                ]);
            });
        });

        return rows.map(function (row) {
            return row.map(csvEscape).join(',');
        }).join('\r\n');
    }

    function csvEscape(val) {
        if (val === null || val === undefined) return '';
        var s = String(val);
        if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 ||
            s.indexOf('\n') !== -1 || s.indexOf('\r') !== -1) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function downloadCSV(csvText, filename) {
        // UTF-8 BOM so Excel opens the file with the right encoding
        var blob = new Blob(['\ufeff' + csvText], { type: 'text/csv;charset=utf-8;' });
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
        }, 100);
    }

    // =================================================================
    // CSV import
    // =================================================================

    function handleImportCSV() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,text/csv';
        input.style.display = 'none';
        input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    processImportedCSV(reader.result);
                } catch (err) {
                    alert('Could not read this CSV file:\n\n' + (err && err.message ? err.message : err));
                }
            };
            reader.onerror = function () { alert('Error reading file.'); };
            reader.readAsText(file);
        });
        document.body.appendChild(input);
        input.click();
        setTimeout(function () {
            if (input.parentNode) input.parentNode.removeChild(input);
        }, 0);
    }

    function processImportedCSV(text) {
        var rows = parseCSV(text);
        if (!rows.length) {
            alert('CSV file is empty.');
            return;
        }
        var headers = rows[0].map(function (h) { return (h || '').trim(); });
        var projectsByName = groupCSVRowsIntoProjects(rows.slice(1), headers);

        var list = Object.keys(projectsByName).map(function (n) { return projectsByName[n]; });
        if (!list.length) {
            alert('No projects found in the CSV.');
            return;
        }
        openImportConflictModal(list);
    }

    function openImportConflictModal(importedProjects) {
        var existing = HHpro.Cart.listProjects();
        var existingNames = {};
        existing.forEach(function (p) {
            existingNames[(p.name || '').toLowerCase()] = true;
        });
        var conflicts = importedProjects.filter(function (p) {
            return existingNames[(p.name || '').toLowerCase()];
        });

        if (!conflicts.length) {
            var result = HHpro.Cart.mergeImportedProjects(importedProjects);
            alert('Imported ' + result.imported + ' project(s) from CSV.');
            HHpro.App.showView('projects');
            return;
        }

        openConfirmModal({
            title: 'Project name conflict',
            body: 'The CSV contains ' + conflicts.length + ' project name' +
                  (conflicts.length === 1 ? '' : 's') + ' that already exist: ' +
                  conflicts.map(function (p) { return '"' + p.name + '"'; }).join(', ') +
                  '. Should the imported ones be renamed, or should they replace the existing projects?',
            confirmLabel: 'Replace existing',
            confirmVariant: 'danger',
            cancelLabel: 'Rename imports',
            onConfirm: function () {
                var r = HHpro.Cart.mergeImportedProjects(importedProjects, { onConflict: 'replace' });
                alert('Imported ' + (r.imported + r.replaced) + ' project(s). ' +
                      r.replaced + ' existing project(s) replaced.');
                HHpro.App.showView('projects');
            },
            onCancel: function () {
                var r = HHpro.Cart.mergeImportedProjects(importedProjects, { onConflict: 'rename' });
                alert('Imported ' + (r.imported + r.renamed) + ' project(s). ' +
                      r.renamed + ' renamed to avoid conflicts.');
                HHpro.App.showView('projects');
            }
        });
    }

    function groupCSVRowsIntoProjects(dataRows, headers) {
        var idx = {};
        headers.forEach(function (h, i) { idx[h] = i; });
        if (idx['ProjectName'] === undefined) {
            throw new Error('CSV is missing required column "ProjectName".');
        }

        var projectsByName = {};
        dataRows.forEach(function (row) {
            var get = function (col) {
                return idx[col] !== undefined ? (row[idx[col]] || '') : '';
            };
            var name = (get('ProjectName') || '').trim();
            if (!name) return;

            var proj = projectsByName[name];
            if (!proj) {
                proj = {
                    name: name,
                    createdAt: get('CreatedAt') || undefined,
                    updatedAt: get('UpdatedAt') || undefined,
                    items: [],
                    extra: {}
                };
                projectsByName[name] = proj;
            }

            // Parse ExtraJSON if present on this row (only first row of
            // each project carries it during export, but we accept it on
            // any row to be tolerant)
            var extraJson = (get('ExtraJSON') || '').trim();
            if (extraJson && !Object.keys(proj.extra).length) {
                try {
                    var parsed = JSON.parse(extraJson);
                    if (parsed && typeof parsed === 'object') proj.extra = parsed;
                } catch (e) {
                    console.warn('Could not parse ExtraJSON for project', name);
                }
            }

            var instanceId = (get('instanceId') || '').trim();
            var productKey = (get('productKey') || '').trim();
            var selectionId = (get('selectionId') || '').trim();
            if (!instanceId && !productKey && !selectionId) return;

            // Parse indoorTags back from pipe-separated string. If the
            // column is missing (importing from an older export) leave
            // the field off entirely rather than setting an empty array,
            // so products that shouldn't have it don't get a stray one.
            var indoorRaw = (get('indoorTags') || '').trim();
            var indoorTags = indoorRaw ? indoorRaw.split('|') : undefined;

            var item = {
                instanceId: instanceId || ('item_' + String(proj.items.length + 1).padStart(4, '0')),
                productKey: productKey,
                selectionId: selectionId,
                label: get('label') || '',
                addedAt: get('addedAt') || '',
                tag: get('tag') || ''
            };
            if (indoorTags !== undefined) item.indoorTags = indoorTags;
            var configVal = (get('configuration') || '').trim();
            if (configVal) item.configuration = configVal;
            var accVal = (get('accessories') || '').trim();
            if (accVal) item.accessories = accVal;

            proj.items.push(item);
        });
        return projectsByName;
    }

    /**
     * Minimal CSV parser - handles quoted fields, escaped quotes, and
     * both \n and \r\n line endings.
     */
    function parseCSV(text) {
        var rows = [];
        var row = [];
        var field = '';
        var inQuotes = false;
        var i = 0;
        var pushField = function () { row.push(field); field = ''; };
        var pushRow = function () {
            if (row.length === 1 && row[0] === '') { row = []; return; }
            rows.push(row);
            row = [];
        };

        while (i < text.length) {
            var c = text.charAt(i);
            if (inQuotes) {
                if (c === '"') {
                    if (text.charAt(i + 1) === '"') { field += '"'; i++; }
                    else { inQuotes = false; }
                } else {
                    field += c;
                }
            } else {
                if (c === '"') {
                    inQuotes = true;
                } else if (c === ',') {
                    pushField();
                } else if (c === '\r') {
                    pushField();
                    pushRow();
                    if (text.charAt(i + 1) === '\n') i++;
                } else if (c === '\n') {
                    pushField();
                    pushRow();
                } else {
                    field += c;
                }
            }
            i++;
        }
        if (field !== '' || row.length > 0) {
            pushField();
            pushRow();
        }
        return rows;
    }

    // =================================================================
    // Confirm modal
    // =================================================================

    function openConfirmModal(opts) {
        var backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';

        var modal = document.createElement('div');
        modal.className = 'modal';

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = opts.title || 'Are you sure?';

        var desc = document.createElement('p');
        desc.className = 'modal-desc';
        desc.textContent = opts.body || '';

        var actions = document.createElement('div');
        actions.className = 'modal-actions';

        var cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'modal-btn modal-btn-secondary';
        cancelBtn.textContent = opts.cancelLabel || 'Cancel';
        cancelBtn.addEventListener('click', function () {
            close();
            if (typeof opts.onCancel === 'function') opts.onCancel();
        });

        var confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'modal-btn modal-btn-' +
            (opts.confirmVariant === 'danger' ? 'danger' : 'primary');
        confirmBtn.textContent = opts.confirmLabel || 'Confirm';
        confirmBtn.addEventListener('click', function () {
            close();
            if (typeof opts.onConfirm === 'function') opts.onConfirm();
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(confirmBtn);

        modal.appendChild(title);
        modal.appendChild(desc);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);

        backdrop.addEventListener('click', function (e) {
            if (e.target === backdrop) {
                close();
                if (typeof opts.onCancel === 'function') opts.onCancel();
            }
        });

        function close() {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
    }

    // =================================================================
    // Small helpers
    // =================================================================

    function relativeTime(isoString) {
        var date = new Date(isoString);
        if (isNaN(date.getTime())) return 'never';
        var ms = Date.now() - date.getTime();
        var s = Math.floor(ms / 1000);
        if (s < 60) return 'just now';
        var m = Math.floor(s / 60);
        if (m < 60) return m + ' minute' + (m === 1 ? '' : 's') + ' ago';
        var h = Math.floor(m / 60);
        if (h < 24) return h + ' hour' + (h === 1 ? '' : 's') + ' ago';
        var d = Math.floor(h / 24);
        if (d < 7) return d + ' day' + (d === 1 ? '' : 's') + ' ago';
        return date.toLocaleDateString();
    }

    function todayStr() {
        var d = new Date();
        return (d.getMonth() + 1) + '-' + d.getDate() + '-' + d.getFullYear();
    }

    function safeFilename(name) {
        return String(name || '').replace(/[\\/:*?"<>|]/g, '_').trim() || 'project';
    }
})();