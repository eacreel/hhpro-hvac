/* ============================================================
   HHpro - Users view (administrators only)
   ------------------------------------------------------------
   Reached from the "Users" header button, shown to Super Admins
   and Admins. Two tabs:

     Users        searchable, sortable table of every account.
                  Add, edit, delete, send an invitation, send a
                  password reset. Which rows a person may change
                  is decided by the backend (row.canManage).
     Permissions  the Permissions tab of Eric's Excel file, read
                  only, so admins can see which products each
                  location gets.
     Help         how the levels, invitations and the spreadsheet
                  work, plus backup status from the server.

   Emails are never sent by the site: "Send invitation" and
   "Reset password" get a one-time link from the backend, then
   open a ready-to-send message in the admin's mail program.
   The link is also shown so it can be copied if the mail
   program does not open.
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    var LEVEL_ORDER = ['Super Admin', 'Admin', 'Hoffman', 'Engineer', 'Contractor', 'Manufacturer'];
    // Email domains each Hoffman level is limited to (the server enforces
    // the same list, LEVEL_DOMAINS in SERVER/routes/users.js). Hoffman
    // Hydronics staff may be Hoffman users, never administrators.
    var HOFFMAN_DOMAIN = '@hoffman-hoffman.com';
    var LEVEL_DOMAINS = {
        'Super Admin': [HOFFMAN_DOMAIN],
        'Admin': [HOFFMAN_DOMAIN],
        'Hoffman': [HOFFMAN_DOMAIN, '@hoffmanhydronics.com']
    };

    /** '' when the address may hold the level, else the reason it may not. */
    function levelDomainProblem(email, level) {
        var domains = LEVEL_DOMAINS[level];
        var e = String(email || '').toLowerCase();
        if (!domains || domains.some(function (d) { return e.slice(-d.length) === d; })) return '';
        return 'Only ' + domains.join(' or ') + ' addresses can be ' + level + '.';
    }

    // Per-render state
    var users = [];
    var options = null;
    var query = '';
    var sortKey = 'lastName';
    var sortDir = 1;
    var els = {};

    HHpro.Views.users = {
        render: function (root, params) {
            if (!HHpro.State.canManageUsers()) {
                HHpro.App.showView('main');
                return;
            }
            root.innerHTML = '';
            document.body.classList.remove('login-active');
            if (HHpro.Cart && typeof HHpro.Cart.init === 'function') HHpro.Cart.init();
            root.appendChild(HHpro.UI.buildHeader('Users'));
            root.appendChild(buildBody((params && params.tab) || 'users'));
        }
    };

    // =================================================================
    // Layout
    // =================================================================

    function buildBody(activeTab) {
        var main = document.createElement('main');
        main.className = 'app-main users-view';

        var titleBar = document.createElement('div');
        titleBar.className = 'users-titlebar';
        var title = document.createElement('h2');
        title.className = 'users-title';
        title.textContent = 'Users';
        titleBar.appendChild(title);

        var tabs = document.createElement('div');
        tabs.className = 'users-tabs';
        tabs.setAttribute('role', 'tablist');
        var usersTab = tabButton('Users', 'users');
        var permsTab = tabButton('Permissions', 'permissions');
        var companiesTab = tabButton('Companies', 'companies');
        var helpTab = tabButton('Help', 'help');
        tabs.appendChild(usersTab);
        tabs.appendChild(permsTab);
        tabs.appendChild(companiesTab);
        tabs.appendChild(helpTab);
        titleBar.appendChild(tabs);
        main.appendChild(titleBar);

        var panel = document.createElement('div');
        panel.className = 'users-panel';
        main.appendChild(panel);
        els.panel = panel;
        els.tabs = { users: usersTab, permissions: permsTab, companies: companiesTab, help: helpTab };

        showTab(activeTab);
        return main;
    }

    function tabButton(label, key) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'users-tab';
        btn.setAttribute('role', 'tab');
        btn.textContent = label;
        btn.addEventListener('click', function () { showTab(key); });
        return btn;
    }

    function showTab(key) {
        Object.keys(els.tabs).forEach(function (k) {
            els.tabs[k].classList.toggle('users-tab-active', k === key);
            els.tabs[k].setAttribute('aria-selected', k === key ? 'true' : 'false');
        });
        els.panel.innerHTML = '';
        if (key === 'permissions') renderPermissions(els.panel);
        else if (key === 'companies') renderCompanies(els.panel);
        else if (key === 'help') renderHelp(els.panel);
        else renderUsers(els.panel);
    }

    // =================================================================
    // Users tab
    // =================================================================

    function renderUsers(panel) {
        var toolbar = document.createElement('div');
        toolbar.className = 'users-toolbar';

        var searchWrap = document.createElement('div');
        searchWrap.className = 'users-search';
        searchWrap.appendChild(HHpro.UI.icon('search'));
        var search = document.createElement('input');
        search.type = 'search';
        search.id = 'users-search';
        search.className = 'users-search-input';
        search.placeholder = 'Search name, company, location, email...';
        search.setAttribute('aria-label', 'Search users');
        search.value = query;
        search.addEventListener('input', function () {
            query = search.value;
            drawTable();
        });
        searchWrap.appendChild(search);
        toolbar.appendChild(searchWrap);

        var count = document.createElement('span');
        count.className = 'users-count';
        toolbar.appendChild(count);
        els.count = count;

        var download = document.createElement('button');
        download.type = 'button';
        download.className = 'users-action users-download-btn';
        download.appendChild(HHpro.UI.icon('download'));
        var dlLabel = document.createElement('span');
        dlLabel.textContent = 'Download as Excel';
        download.appendChild(dlLabel);
        download.addEventListener('click', function () {
            download.disabled = true;
            var stamp = new Date().toISOString().slice(0, 10);
            HHpro.Api.download('/api/users/export.xlsx', 'HHpro Users ' + stamp + '.xlsx').then(function () {
                download.disabled = false;
                toast('Spreadsheet downloaded.');
            }, function (err) {
                download.disabled = false;
                toast(err.message, true);
            });
        });
        toolbar.appendChild(download);

        var add = document.createElement('button');
        add.type = 'button';
        add.className = 'btn btn-primary users-add-btn';
        add.appendChild(HHpro.UI.icon('plus'));
        var addLabel = document.createElement('span');
        addLabel.textContent = 'Add user';
        add.appendChild(addLabel);
        add.addEventListener('click', function () { openUserModal(null); });
        toolbar.appendChild(add);

        panel.appendChild(toolbar);

        var wrap = document.createElement('div');
        wrap.className = 'users-table-wrap';
        panel.appendChild(wrap);
        els.tableWrap = wrap;

        wrap.appendChild(spinner('Loading users...'));

        Promise.all([
            HHpro.Api.get('/api/users'),
            options ? Promise.resolve(options) : HHpro.Api.get('/api/users/options')
        ]).then(function (results) {
            users = results[0].users;
            options = results[1];
            drawTable();
        }, function (err) {
            wrap.innerHTML = '';
            wrap.appendChild(problem(err));
            if (err.status === 401) HHpro.App.refreshSession();
        });
    }

    function reloadUsers() {
        return HHpro.Api.get('/api/users').then(function (res) {
            users = res.users;
            drawTable();
        }, function (err) {
            toast(err.message, true);
        });
    }

    var COLUMNS = [
        { key: 'lastName', label: 'Name', get: function (u) { return u.firstName + ' ' + u.lastName; } },
        { key: 'company', label: 'Company' },
        { key: 'location', label: 'Locations', get: function (u) { return (u.locations || []).join('; '); } },
        { key: 'userLevel', label: 'Level' },
        { key: 'email', label: 'Email' },
        { key: 'status', label: 'Status' },
        { key: 'createdBy', label: 'Added by' },
        { key: 'createdAt', label: 'Date added', get: function (u) { return shortDate(u.createdAt); } }
    ];

    // Column filters chosen in the dropdown row under the headers.
    var filters = {};

    function shortDate(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
    }

    /** The value(s) a column filter compares against for one user. */
    function filterValue(u, key) {
        switch (key) {
            case 'lastName': return u.firstName + ' ' + u.lastName;
            case 'location': return u.locations || [];
            case 'status': return u.status === 'active' ? 'Active' : 'Invited';
            case 'createdBy': return nameForEmail(u.createdBy);
            case 'createdAt': return shortDate(u.createdAt);
            default: return String(u[key] || '');
        }
    }

    function filterMatches(u, key, wanted) {
        var v = filterValue(u, key);
        return Array.isArray(v) ? v.indexOf(wanted) !== -1 : v === wanted;
    }

    /** Distinct choices for a column's dropdown, from every user (not just the visible ones). */
    function filterChoices(key) {
        var seen = {};
        var out = [];
        users.forEach(function (u) {
            var v = filterValue(u, key);
            (Array.isArray(v) ? v : [v]).forEach(function (x) {
                if (x && !seen[x]) { seen[x] = true; out.push(x); }
            });
        });
        if (key === 'userLevel') {
            out.sort(function (a, b) { return LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b); });
        } else if (key === 'createdAt') {
            out.sort(function (a, b) { return new Date(b) - new Date(a); });
        } else {
            out.sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
        }
        return out;
    }

    function activeFilterKeys() {
        return Object.keys(filters).filter(function (k) { return filters[k]; });
    }

    function visibleUsers() {
        var q = query.trim().toLowerCase();
        var active = activeFilterKeys();
        var list = users.filter(function (u) {
            for (var i = 0; i < active.length; i++) {
                if (!filterMatches(u, active[i], filters[active[i]])) return false;
            }
            if (!q) return true;
            var hay = [u.firstName, u.lastName, u.company, u.location, u.userLevel, u.email,
                u.status, nameForEmail(u.createdBy), shortDate(u.createdAt)]
                .join(' ').toLowerCase();
            return hay.indexOf(q) !== -1;
        });
        list.sort(function (a, b) {
            var av, bv;
            if (sortKey === 'userLevel') {
                av = LEVEL_ORDER.indexOf(a.userLevel); bv = LEVEL_ORDER.indexOf(b.userLevel);
            } else if (sortKey === 'lastName') {
                av = (a.lastName + ' ' + a.firstName).toLowerCase(); bv = (b.lastName + ' ' + b.firstName).toLowerCase();
            } else {
                av = String(a[sortKey] || '').toLowerCase(); bv = String(b[sortKey] || '').toLowerCase();
            }
            if (av < bv) return -sortDir;
            if (av > bv) return sortDir;
            return 0;
        });
        return list;
    }

    function drawTable() {
        var wrap = els.tableWrap;
        if (!wrap) return;
        wrap.innerHTML = '';
        var list = visibleUsers();
        if (els.count) {
            els.count.textContent = list.length === users.length
                ? users.length + ' user' + (users.length === 1 ? '' : 's')
                : list.length + ' of ' + users.length;
        }

        var table = document.createElement('table');
        table.className = 'users-table';
        var thead = document.createElement('thead');
        var hr = document.createElement('tr');
        COLUMNS.forEach(function (col) {
            var th = document.createElement('th');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'users-sort' + (sortKey === col.key ? ' users-sort-active' : '');
            btn.textContent = col.label + (sortKey === col.key ? (sortDir > 0 ? ' ▴' : ' ▾') : '');
            btn.addEventListener('click', function () {
                if (sortKey === col.key) sortDir = -sortDir; else { sortKey = col.key; sortDir = 1; }
                drawTable();
            });
            th.appendChild(btn);
            hr.appendChild(th);
        });
        var thActions = document.createElement('th');
        thActions.textContent = 'Actions';
        thActions.className = 'users-th-actions';
        hr.appendChild(thActions);
        thead.appendChild(hr);

        // Filter row: one dropdown per column. Choices come from the
        // whole list so a filter can always be widened again.
        var fr = document.createElement('tr');
        fr.className = 'users-filter-row';
        COLUMNS.forEach(function (col) {
            var td = document.createElement('th');
            var sel = document.createElement('select');
            sel.className = 'users-filter';
            sel.id = 'users-filter-' + col.key;
            sel.setAttribute('aria-label', 'Filter by ' + col.label.toLowerCase());
            var all = document.createElement('option');
            all.value = '';
            all.textContent = 'All';
            sel.appendChild(all);
            filterChoices(col.key).forEach(function (v) {
                var opt = document.createElement('option');
                opt.value = v;
                opt.textContent = v;
                sel.appendChild(opt);
            });
            sel.value = filters[col.key] || '';
            if (sel.value) sel.classList.add('users-filter-active');
            sel.addEventListener('change', function () {
                filters[col.key] = sel.value;
                drawTable();
            });
            td.appendChild(sel);
            fr.appendChild(td);
        });
        var clearTd = document.createElement('th');
        clearTd.className = 'users-th-actions';
        if (activeFilterKeys().length) {
            var clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'users-action';
            clearBtn.textContent = 'Clear filters';
            clearBtn.addEventListener('click', function () {
                filters = {};
                drawTable();
            });
            clearTd.appendChild(clearBtn);
        }
        fr.appendChild(clearTd);
        thead.appendChild(fr);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        if (!list.length) {
            var tr = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = COLUMNS.length + 1;
            td.className = 'users-empty';
            td.textContent = users.length ? 'No users match that search.' : 'No users yet.';
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
        list.forEach(function (u) {
            tbody.appendChild(userRow(u));
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
    }

    function userRow(u) {
        var tr = document.createElement('tr');
        if (u.isSelf) tr.className = 'users-row-self';

        COLUMNS.forEach(function (col) {
            var td = document.createElement('td');
            if (col.key === 'status') {
                td.appendChild(statusBadge(u));
            } else if (col.key === 'email') {
                td.className = 'users-td-email';
                td.textContent = u.email;
            } else if (col.key === 'createdBy') {
                td.className = 'users-td-muted';
                td.textContent = nameForEmail(u.createdBy);
            } else if (col.key === 'location') {
                td.appendChild(locationsCell(u));
            } else {
                td.textContent = col.get ? col.get(u) : (u[col.key] || '');
            }
            tr.appendChild(td);
        });

        var actions = document.createElement('td');
        actions.className = 'users-actions';
        if (u.canManage) {
            actions.appendChild(actionButton('edit', 'Edit', function () { openUserModal(u); }));
            actions.appendChild(actionButton('mail',
                u.status === 'active' ? 'Reset password' : 'Send invitation',
                function () { u.status === 'active' ? confirmReset(u) : sendInvite(u); }));
            if (!u.isSelf) {
                actions.appendChild(actionButton('trash', 'Delete', function () { confirmDelete(u); }, true));
            }
        } else {
            var lock = document.createElement('span');
            lock.className = 'users-td-muted';
            lock.textContent = u.userLevel === 'Super Admin' ? '—' : 'Added by someone else';
            actions.appendChild(lock);
        }
        tr.appendChild(actions);
        return tr;
    }

    function actionButton(iconName, label, onClick, danger) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'users-action' + (danger ? ' users-action-danger' : '');
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.appendChild(HHpro.UI.icon(iconName));
        var text = document.createElement('span');
        text.textContent = label;
        btn.appendChild(text);
        btn.addEventListener('click', onClick);
        return btn;
    }

    function statusBadge(u) {
        var badge = document.createElement('span');
        if (u.status === 'active') {
            badge.className = 'users-badge users-badge-active';
            badge.textContent = 'Active';
        } else {
            badge.className = 'users-badge users-badge-invited';
            badge.textContent = 'Invited';
            if (u.inviteExpires) {
                var ms = new Date(u.inviteExpires).getTime() - Date.now();
                badge.title = ms > 0
                    ? 'Registration link expires in ' + Math.max(1, Math.round(ms / 3600000)) + ' hours'
                    : 'Registration link has expired. Send a new invitation.';
                if (ms <= 0) badge.classList.add('users-badge-expired');
            } else {
                badge.title = 'No registration link sent yet';
            }
        }
        return badge;
    }

    /**
     * Locations, kept short: "All locations" when they have every one on
     * the Permissions tab, the first two plus "+N more" when the list is
     * long, and the full list on hover either way.
     */
    function locationsCell(u) {
        var list = u.locations || [];
        var all = options && options.locations ? options.locations : [];
        var span = document.createElement('span');
        span.className = 'users-locations';
        span.title = list.join('\n');
        if (all.length && list.length >= all.length && all.every(function (l) { return list.indexOf(l) !== -1; })) {
            span.textContent = 'All locations';
            span.className += ' users-locations-all';
        } else if (list.length > 2) {
            span.textContent = list.slice(0, 2).join('; ');
            var more = document.createElement('span');
            more.className = 'users-locations-more';
            more.textContent = '+' + (list.length - 2) + ' more';
            span.appendChild(more);
        } else {
            span.textContent = list.join('; ');
        }
        return span;
    }

    function nameForEmail(email) {
        for (var i = 0; i < users.length; i++) {
            if (users[i].email === email) return users[i].firstName + ' ' + users[i].lastName;
        }
        return email || '';
    }

    // =================================================================
    // Add / edit modal
    // =================================================================

    function openUserModal(existing) {
        var isEdit = !!existing;
        var backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        var modal = document.createElement('div');
        modal.className = 'modal users-modal';

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = isEdit ? 'Edit user' : 'Add user';
        modal.appendChild(title);

        var form = document.createElement('form');
        form.className = 'users-form';
        form.noValidate = true;

        var grid = document.createElement('div');
        grid.className = 'users-form-grid';

        var firstName = textField('First name', 'user-first', existing ? existing.firstName : '', 'given-name');
        var lastName = textField('Last name', 'user-last', existing ? existing.lastName : '', 'family-name');
        var company = companyField(existing ? existing.company : '');
        var email = textField('Email', 'user-email', existing ? existing.email : '', 'email', 'email');
        var level = selectField('User level', 'user-level', options.levels, existing ? existing.userLevel : '');
        // One or more locations. An engineer who covers several
        // territories sees the products any of them allows.
        var locations = checkField('Locations', 'user-location', options.locations,
            existing ? (existing.locations || []) : []);

        grid.appendChild(firstName.wrap);
        grid.appendChild(lastName.wrap);
        grid.appendChild(company.wrap);
        grid.appendChild(email.wrap);
        grid.appendChild(level.wrap);
        grid.appendChild(locations.wrap);
        form.appendChild(grid);

        // A level the caller may not assign (an Admin editing... a Super
        // Admin cannot happen, the backend hides that row's controls) -
        // still, keep the current value visible if it is outside the list.
        if (existing && options.levels.indexOf(existing.userLevel) === -1) {
            var keep = document.createElement('option');
            keep.value = existing.userLevel;
            keep.textContent = existing.userLevel;
            level.input.appendChild(keep);
            level.input.value = existing.userLevel;
        }
        if (existing && existing.isSelf) level.input.disabled = true;

        var help = document.createElement('p');
        help.className = 'users-form-help';
        help.textContent = 'Need a location or user level that isn\'t listed? Email ' +
            options.contactEmail + ' and Eric will add it.';
        form.appendChild(help);

        var warning = document.createElement('p');
        warning.className = 'users-form-warning';
        form.appendChild(warning);

        var error = document.createElement('p');
        error.className = 'users-form-error';
        error.setAttribute('role', 'alert');
        form.appendChild(error);

        function checkDuplicates() {
            var f = firstName.input.value.trim().toLowerCase();
            var l = lastName.input.value.trim().toLowerCase();
            var e = email.input.value.trim().toLowerCase();
            var msg = '';
            users.forEach(function (u) {
                if (existing && u.id === existing.id) return;
                if (e && u.email === e) msg = 'That email already belongs to ' + u.firstName + ' ' + u.lastName + '.';
                else if (!msg && f && l && u.firstName.toLowerCase() === f && u.lastName.toLowerCase() === l) {
                    msg = 'There is already a ' + u.firstName + ' ' + u.lastName + ' (' + u.email + '). ' +
                        'Make sure this is a different person.';
                }
            });
            var lvl = level.input.value;
            if (!msg && e && levelDomainProblem(e, lvl)) {
                msg = levelDomainProblem(e, lvl) + ' Use Engineer, Contractor or Manufacturer for people at other companies.';
            }
            warning.textContent = msg;
        }
        [firstName, lastName, email].forEach(function (f) { f.input.addEventListener('input', checkDuplicates); });
        level.input.addEventListener('change', checkDuplicates);

        var actions = document.createElement('div');
        actions.className = 'modal-actions';

        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'modal-btn modal-btn-secondary';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', close);
        actions.appendChild(cancel);

        var saveOnly = null;
        if (!isEdit) {
            saveOnly = document.createElement('button');
            saveOnly.type = 'button';
            saveOnly.className = 'modal-btn modal-btn-secondary';
            saveOnly.textContent = 'Add without sending';
            saveOnly.addEventListener('click', function () { submit(false); });
            actions.appendChild(saveOnly);
        }

        var save = document.createElement('button');
        save.type = 'submit';
        save.className = 'modal-btn modal-btn-primary';
        save.textContent = isEdit ? 'Save' : 'Add and send invitation';
        actions.appendChild(save);
        form.appendChild(actions);

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            submit(!isEdit);
        });

        modal.appendChild(form);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
        window.setTimeout(function () { firstName.input.focus(); }, 0);

        function payload() {
            return {
                firstName: firstName.input.value.trim(),
                lastName: lastName.input.value.trim(),
                company: company.value(),
                email: email.input.value.trim(),
                locations: locations.values(),
                userLevel: existing && existing.isSelf ? existing.userLevel : level.input.value
            };
        }

        var forceCompany = false;

        function submit(sendAfter) {
            var p = payload();
            if (!p.firstName || !p.lastName) { error.textContent = 'First and last name are required.'; return; }
            if (!p.company) { error.textContent = company.isNew() ? 'Type the new company\'s name.' : 'Choose a company.'; return; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) { error.textContent = 'Enter a valid email address.'; return; }
            if (!p.locations.length) { error.textContent = 'Choose at least one location.'; return; }
            if (!p.userLevel) { error.textContent = 'Choose a user level.'; return; }
            if (levelDomainProblem(p.email, p.userLevel)) {
                error.textContent = levelDomainProblem(p.email, p.userLevel);
                return;
            }
            error.textContent = '';
            save.disabled = true;
            if (saveOnly) saveOnly.disabled = true;

            // A brand-new company is registered first, so the list stays
            // the single source of spellings. A look-alike name comes back
            // as a warning; saving again adds it anyway.
            var ready = company.isNew()
                ? HHpro.Api.post('/api/users/companies', { name: p.company, force: forceCompany }).then(function (res) {
                    p.company = res.company.name;
                    options.companies = res.companies;
                })
                : Promise.resolve();

            var req = ready.then(function () {
                return isEdit
                    ? HHpro.Api.put('/api/users/' + existing.id, p)
                    : HHpro.Api.post('/api/users', p);
            });
            req.then(function (res) {
                close();
                toast(isEdit ? 'Saved ' + res.user.firstName + ' ' + res.user.lastName + '.'
                    : 'Added ' + res.user.firstName + ' ' + res.user.lastName + '.');
                reloadUsers().then(function () {
                    if (sendAfter) sendInvite(res.user);
                });
            }, function (err) {
                save.disabled = false;
                if (saveOnly) saveOnly.disabled = false;
                if (err.status === 409 && err.data && err.data.similar) {
                    forceCompany = true;
                    error.textContent = '';
                    warning.textContent = err.message + ' Pick it from the Company list, or click "' +
                        (isEdit ? 'Save' : 'Add') + '" again to add "' + p.company + '" as a separate company.';
                    return;
                }
                error.textContent = err.message;
                if (err.status === 401) HHpro.App.refreshSession();
            });
        }

        function close() {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
    }

    /**
     * Company picker: the managed list plus a "New company" choice that
     * reveals a text box. Keeps one spelling per firm, which is also
     * what ties an Engineer to their firm's schedule template.
     */
    function companyField(current) {
        var wrap = document.createElement('div');
        wrap.className = 'users-field';
        var label = document.createElement('label');
        label.className = 'users-label';
        label.htmlFor = 'user-company';
        label.textContent = 'Company';
        wrap.appendChild(label);

        var select = document.createElement('select');
        select.id = 'user-company';
        select.name = 'user-company';
        select.className = 'users-input users-select';
        function opt(value, text) {
            var o = document.createElement('option');
            o.value = value;
            o.textContent = text;
            return o;
        }
        select.appendChild(opt('', 'Choose...'));
        var names = (options.companies || []).slice();
        if (current && names.indexOf(current) === -1) names.push(current);
        names.forEach(function (c) { select.appendChild(opt(c, c)); });
        select.appendChild(opt('__new__', '+ New company...'));
        select.value = current || '';
        wrap.appendChild(select);

        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'user-company-new';
        input.className = 'users-input';
        input.placeholder = 'New company name';
        input.autocomplete = 'organization';
        input.hidden = true;
        wrap.appendChild(input);

        select.addEventListener('change', function () {
            input.hidden = select.value !== '__new__';
            if (!input.hidden) input.focus();
        });

        return {
            wrap: wrap,
            select: select,
            input: input,
            isNew: function () { return select.value === '__new__'; },
            value: function () {
                return select.value === '__new__' ? input.value.trim().replace(/\s+/g, ' ') : select.value;
            }
        };
    }

    function textField(labelText, id, value, autocomplete, type) {
        var wrap = document.createElement('div');
        wrap.className = 'users-field';
        var label = document.createElement('label');
        label.className = 'users-label';
        label.htmlFor = id;
        label.textContent = labelText;
        var input = document.createElement('input');
        input.type = type || 'text';
        input.id = id;
        input.name = id;
        input.className = 'users-input';
        input.value = value || '';
        if (autocomplete) input.autocomplete = autocomplete;
        wrap.appendChild(label);
        wrap.appendChild(input);
        return { wrap: wrap, input: input };
    }

    /**
     * A group of checkboxes laid out as a grid, for picking several
     * locations. .values() returns the checked ones in list order.
     */
    function checkField(labelText, idPrefix, values, checked) {
        var wrap = document.createElement('fieldset');
        wrap.className = 'users-field users-field-full users-checkfield';
        var legend = document.createElement('legend');
        legend.className = 'users-label';
        legend.textContent = labelText;
        wrap.appendChild(legend);

        // Quick picks: everything, or start over.
        var quick = document.createElement('span');
        quick.className = 'users-check-quick';
        var pickAll = document.createElement('button');
        pickAll.type = 'button';
        pickAll.className = 'users-check-link';
        pickAll.textContent = 'Select all';
        pickAll.addEventListener('click', function () { boxes.forEach(function (b) { b.checked = true; }); });
        var pickNone = document.createElement('button');
        pickNone.type = 'button';
        pickNone.className = 'users-check-link';
        pickNone.textContent = 'Clear';
        pickNone.addEventListener('click', function () { boxes.forEach(function (b) { b.checked = false; }); });
        quick.appendChild(pickAll);
        quick.appendChild(pickNone);
        legend.appendChild(quick);

        var grid = document.createElement('div');
        grid.className = 'users-checks';
        var boxes = [];
        (values || []).forEach(function (v, i) {
            var label = document.createElement('label');
            label.className = 'users-check';
            var box = document.createElement('input');
            box.type = 'checkbox';
            box.id = idPrefix + '-' + i;
            box.value = v;
            box.checked = (checked || []).indexOf(v) !== -1;
            label.appendChild(box);
            var text = document.createElement('span');
            text.textContent = v;
            label.appendChild(text);
            grid.appendChild(label);
            boxes.push(box);
        });
        // A location on file that is no longer on the Permissions tab
        // still shows, checked, so editing does not silently drop it.
        (checked || []).forEach(function (v, i) {
            if ((values || []).indexOf(v) !== -1) return;
            var label = document.createElement('label');
            label.className = 'users-check users-check-stale';
            var box = document.createElement('input');
            box.type = 'checkbox';
            box.id = idPrefix + '-old-' + i;
            box.value = v;
            box.checked = true;
            label.appendChild(box);
            var text = document.createElement('span');
            text.textContent = v + ' (not on the Permissions tab)';
            label.appendChild(text);
            grid.appendChild(label);
            boxes.push(box);
        });
        wrap.appendChild(grid);

        return {
            wrap: wrap,
            values: function () {
                return boxes.filter(function (b) { return b.checked; }).map(function (b) { return b.value; });
            }
        };
    }

    function selectField(labelText, id, values, value) {
        var wrap = document.createElement('div');
        wrap.className = 'users-field';
        var label = document.createElement('label');
        label.className = 'users-label';
        label.htmlFor = id;
        label.textContent = labelText;
        var select = document.createElement('select');
        select.id = id;
        select.name = id;
        select.className = 'users-input users-select';
        var blank = document.createElement('option');
        blank.value = '';
        blank.textContent = 'Choose...';
        select.appendChild(blank);
        (values || []).forEach(function (v) {
            var opt = document.createElement('option');
            opt.value = v;
            opt.textContent = v;
            select.appendChild(opt);
        });
        select.value = value || '';
        wrap.appendChild(label);
        wrap.appendChild(select);
        return { wrap: wrap, input: select };
    }

    // =================================================================
    // Invitation, reset, delete
    // =================================================================

    function adminSignature() {
        var me = HHpro.State.getUser();
        var name = HHpro.State.getUserName();
        var company = me && me.company ? me.company : 'Hoffman & Hoffman';
        if (/^hoffman$/i.test(company)) company = 'Hoffman & Hoffman';
        return name + '\n' + company;
    }

    function sendInvite(u) {
        HHpro.Api.post('/api/users/' + u.id + '/invite').then(function (res) {
            var body = 'Hi ' + u.firstName + ',\n\n' +
                (res.kind === 'reset'
                    ? 'Here is a link to choose a new password for HHpro. It works for ' + options.inviteHours + ' hours.\n\n'
                    : 'An HHpro account has been set up for you. Use the link below to choose a password. ' +
                      'The link works for ' + options.inviteHours + ' hours.\n\n') +
                res.link + '\n\n' +
                'HHpro is at https://hhpro-hvac.com. Sign in with this email address.\n\n' +
                adminSignature();
            openLinkModal({
                title: res.kind === 'reset' ? 'Reset link ready' : 'Invitation ready',
                intro: 'An email to ' + u.email + ' will open in your mail program. If it doesn\'t, copy the link and send it yourself.',
                link: res.link,
                mail: { to: u.email, subject: res.kind === 'reset' ? 'Your HHpro password reset' : 'Your HHpro account', body: body }
            });
            reloadUsers();
        }, function (err) {
            toast(err.message, true);
        });
    }

    function confirmReset(u) {
        confirmModal({
            title: 'Reset password for ' + u.firstName + ' ' + u.lastName + '?',
            body: 'They will be signed out everywhere and will need the new link to choose a password. ' +
                'Their projects are not affected.',
            confirmLabel: 'Create reset link',
            onConfirm: function () {
                HHpro.Api.post('/api/users/' + u.id + '/reset').then(function (res) {
                    var body = 'Hi ' + u.firstName + ',\n\n' +
                        'Here is a link to choose a new password for HHpro. It works for ' + options.inviteHours + ' hours.\n\n' +
                        res.link + '\n\n' +
                        'If you did not ask for this, you can ignore this email.\n\n' +
                        adminSignature();
                    openLinkModal({
                        title: 'Reset link ready',
                        intro: 'An email to ' + u.email + ' will open in your mail program. If it doesn\'t, copy the link and send it yourself.',
                        link: res.link,
                        mail: { to: u.email, subject: 'Your HHpro password reset', body: body }
                    });
                    reloadUsers();
                }, function (err) {
                    toast(err.message, true);
                });
            }
        });
    }

    function confirmDelete(u) {
        confirmModal({
            title: 'Delete ' + u.firstName + ' ' + u.lastName + '?',
            body: 'They will no longer be able to sign in. Their project folder is kept on the server, set aside, ' +
                'so nothing is lost by accident.',
            confirmLabel: 'Delete user',
            confirmVariant: 'danger',
            onConfirm: function () {
                HHpro.Api.del('/api/users/' + u.id).then(function () {
                    toast('Deleted ' + u.firstName + ' ' + u.lastName + '.');
                    reloadUsers();
                }, function (err) {
                    toast(err.message, true);
                });
            }
        });
    }

    function openLinkModal(opts) {
        var backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        var modal = document.createElement('div');
        modal.className = 'modal users-modal';

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = opts.title;
        modal.appendChild(title);

        var desc = document.createElement('p');
        desc.className = 'modal-desc';
        desc.textContent = opts.intro;
        modal.appendChild(desc);

        var linkBox = document.createElement('input');
        linkBox.type = 'text';
        linkBox.id = 'users-link-box';
        linkBox.className = 'users-input users-link';
        linkBox.readOnly = true;
        linkBox.value = opts.link;
        linkBox.addEventListener('focus', function () { linkBox.select(); });
        modal.appendChild(linkBox);

        var actions = document.createElement('div');
        actions.className = 'modal-actions';

        var copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'modal-btn modal-btn-secondary';
        copy.textContent = 'Copy link';
        copy.addEventListener('click', function () {
            var done = function () { copy.textContent = 'Copied'; };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(opts.link).then(done, function () { linkBox.focus(); });
            } else {
                linkBox.focus();
                try { document.execCommand('copy'); done(); } catch (e) { /* leave selected */ }
            }
        });
        actions.appendChild(copy);

        var open = document.createElement('button');
        open.type = 'button';
        open.className = 'modal-btn modal-btn-secondary';
        open.textContent = 'Open email again';
        open.addEventListener('click', function () { HHpro.UI.openMailto(opts.mail); });
        actions.appendChild(open);

        var done = document.createElement('button');
        done.type = 'button';
        done.className = 'modal-btn modal-btn-primary';
        done.textContent = 'Done';
        done.addEventListener('click', close);
        actions.appendChild(done);

        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });

        HHpro.UI.openMailto(opts.mail);

        function close() {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
    }

    function confirmModal(opts) {
        var backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        var modal = document.createElement('div');
        modal.className = 'modal';

        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = opts.title;
        var desc = document.createElement('p');
        desc.className = 'modal-desc';
        desc.textContent = opts.body || '';
        var actions = document.createElement('div');
        actions.className = 'modal-actions';

        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'modal-btn modal-btn-secondary';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', close);

        var confirm = document.createElement('button');
        confirm.type = 'button';
        confirm.className = 'modal-btn modal-btn-' + (opts.confirmVariant === 'danger' ? 'danger' : 'primary');
        confirm.textContent = opts.confirmLabel || 'Confirm';
        confirm.addEventListener('click', function () { close(); opts.onConfirm(); });

        actions.appendChild(cancel);
        actions.appendChild(confirm);
        modal.appendChild(title);
        modal.appendChild(desc);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });

        function close() {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
    }

    // =================================================================
    // Permissions tab
    // =================================================================

    function renderPermissions(panel) {
        var wrap = document.createElement('div');
        wrap.className = 'users-table-wrap';
        wrap.appendChild(spinner('Loading permissions...'));
        panel.appendChild(wrap);

        HHpro.Api.get('/api/users/permissions').then(function (p) {
            wrap.innerHTML = '';

            var note = document.createElement('p');
            note.className = 'users-perm-note';
            note.textContent = 'Which products each location sees. Blank cells in the spreadsheet count as Yes. ' +
                'To change permissions or add a location, email ' + p.contactEmail + '.';
            wrap.appendChild(note);

            if (p.error) {
                var warn = document.createElement('p');
                warn.className = 'users-form-error';
                warn.textContent = 'The Permissions tab could not be read: ' + p.error + '. Showing the last good copy.';
                wrap.appendChild(warn);
            }

            var table = document.createElement('table');
            table.className = 'users-table users-perm-table';
            var thead = document.createElement('thead');
            var hr = document.createElement('tr');
            var th0 = document.createElement('th');
            th0.textContent = 'Product line';
            th0.className = 'users-perm-product';
            hr.appendChild(th0);
            p.locations.forEach(function (loc) {
                var th = document.createElement('th');
                th.textContent = loc;
                hr.appendChild(th);
            });
            thead.appendChild(hr);
            table.appendChild(thead);

            var tbody = document.createElement('tbody');
            p.products.forEach(function (prod) {
                var tr = document.createElement('tr');
                var name = document.createElement('td');
                name.className = 'users-perm-product';
                name.textContent = prod.name;
                tr.appendChild(name);
                p.locations.forEach(function (loc) {
                    var td = document.createElement('td');
                    var yes = prod.byLocation[loc] !== false;
                    td.className = yes ? 'users-perm-yes' : 'users-perm-no';
                    td.textContent = yes ? 'Yes' : 'No';
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            wrap.appendChild(table);

            var when = document.createElement('p');
            when.className = 'users-td-muted users-perm-when';
            when.textContent = p.loadedAt
                ? 'Last read from the spreadsheet ' + new Date(p.loadedAt).toLocaleString() + '.'
                : 'The spreadsheet has not been read yet.';
            wrap.appendChild(when);
        }, function (err) {
            wrap.innerHTML = '';
            wrap.appendChild(problem(err));
        });
    }

    // =================================================================
    // Companies tab
    // =================================================================

    function renderCompanies(panel) {
        var wrap = document.createElement('div');
        wrap.className = 'users-table-wrap';
        panel.appendChild(wrap);
        wrap.appendChild(spinner('Loading companies...'));

        HHpro.Api.get('/api/users/companies').then(function (res) {
            wrap.innerHTML = '';

            var note = document.createElement('p');
            note.className = 'users-perm-note';
            note.textContent = 'Every user is tied to one company from this list, so a firm is only ever spelled one way. ' +
                (res.canEdit
                    ? 'Renaming a company moves its users with it. A company can be removed once nobody is on it.'
                    : 'Anyone can add a company; renaming or removing one is up to a Super Admin.');
            wrap.appendChild(note);

            var addRow = document.createElement('form');
            addRow.className = 'users-company-add';
            addRow.noValidate = true;
            var input = document.createElement('input');
            input.type = 'text';
            input.id = 'company-new-name';
            input.className = 'users-input';
            input.placeholder = 'Add a company...';
            addRow.appendChild(input);
            var addBtn = document.createElement('button');
            addBtn.type = 'submit';
            addBtn.className = 'btn btn-primary';
            addBtn.textContent = 'Add company';
            addRow.appendChild(addBtn);
            var addMsg = document.createElement('p');
            addMsg.className = 'users-form-warning';
            addRow.appendChild(addMsg);
            var force = false;
            addRow.addEventListener('submit', function (e) {
                e.preventDefault();
                var name = input.value.trim();
                if (!name) return;
                HHpro.Api.post('/api/users/companies', { name: name, force: force }).then(function (r) {
                    toast(r.created ? 'Added ' + r.company.name + '.' : r.company.name + ' is already on the list.');
                    options = null;
                    showTab('companies');
                }, function (err) {
                    if (err.status === 409 && err.data && err.data.similar) {
                        force = true;
                        addMsg.textContent = err.message + ' Click "Add company" again to add it anyway.';
                        return;
                    }
                    toast(err.message, true);
                });
            });
            input.addEventListener('input', function () { force = false; addMsg.textContent = ''; });
            wrap.appendChild(addRow);

            var table = document.createElement('table');
            table.className = 'users-table';
            var thead = document.createElement('thead');
            var hr = document.createElement('tr');
            ['Company', 'Users', 'Added by', ''].forEach(function (h, i) {
                var th = document.createElement('th');
                th.textContent = h;
                if (i === 3) th.className = 'users-th-actions';
                hr.appendChild(th);
            });
            thead.appendChild(hr);
            table.appendChild(thead);
            var tbody = document.createElement('tbody');
            res.companies.forEach(function (c) {
                var tr = document.createElement('tr');
                var name = document.createElement('td');
                name.textContent = c.name;
                tr.appendChild(name);
                var count = document.createElement('td');
                count.textContent = String(c.users);
                tr.appendChild(count);
                var by = document.createElement('td');
                by.className = 'users-td-muted';
                by.textContent = c.created_by === 'import' ? 'Original list' : nameForEmail(c.created_by);
                tr.appendChild(by);
                var actions = document.createElement('td');
                actions.className = 'users-actions';
                if (res.canEdit) {
                    actions.appendChild(actionButton('edit', 'Rename', function () {
                        promptModal({
                            title: 'Rename ' + c.name,
                            body: c.users ? 'The ' + c.users + ' user' + (c.users === 1 ? '' : 's') + ' on this company move with it.' : '',
                            value: c.name,
                            confirmLabel: 'Rename',
                            onConfirm: function (newName) {
                                HHpro.Api.put('/api/users/companies/' + c.id, { name: newName }).then(function () {
                                    toast('Renamed to ' + newName + '.');
                                    options = null;
                                    showTab('companies');
                                }, function (err) { toast(err.message, true); });
                            }
                        });
                    }));
                    if (!c.users) {
                        actions.appendChild(actionButton('trash', 'Remove', function () {
                            confirmModal({
                                title: 'Remove ' + c.name + '?',
                                body: 'No users are on it. It disappears from the company list.',
                                confirmLabel: 'Remove',
                                confirmVariant: 'danger',
                                onConfirm: function () {
                                    HHpro.Api.del('/api/users/companies/' + c.id).then(function () {
                                        toast('Removed ' + c.name + '.');
                                        options = null;
                                        showTab('companies');
                                    }, function (err) { toast(err.message, true); });
                                }
                            });
                        }, true));
                    }
                }
                tr.appendChild(actions);
                tbody.appendChild(tr);
            });
            table.appendChild(tbody);
            wrap.appendChild(table);
        }, function (err) {
            wrap.innerHTML = '';
            wrap.appendChild(problem(err));
        });
    }

    /** Small modal with one text box. */
    function promptModal(opts) {
        var backdrop = document.createElement('div');
        backdrop.className = 'modal-backdrop';
        var modal = document.createElement('div');
        modal.className = 'modal';
        var title = document.createElement('h2');
        title.className = 'modal-title';
        title.textContent = opts.title;
        modal.appendChild(title);
        if (opts.body) {
            var desc = document.createElement('p');
            desc.className = 'modal-desc';
            desc.textContent = opts.body;
            modal.appendChild(desc);
        }
        var input = document.createElement('input');
        input.type = 'text';
        input.id = 'users-prompt-input';
        input.className = 'users-input';
        input.value = opts.value || '';
        modal.appendChild(input);
        var actions = document.createElement('div');
        actions.className = 'modal-actions';
        var cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'modal-btn modal-btn-secondary';
        cancel.textContent = 'Cancel';
        cancel.addEventListener('click', close);
        var ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'modal-btn modal-btn-primary';
        ok.textContent = opts.confirmLabel || 'OK';
        ok.addEventListener('click', function () {
            var v = input.value.trim();
            if (!v) { input.focus(); return; }
            close();
            opts.onConfirm(v);
        });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
        actions.appendChild(cancel);
        actions.appendChild(ok);
        modal.appendChild(actions);
        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
        window.setTimeout(function () { input.focus(); input.select(); }, 0);
        function close() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
    }

    // =================================================================
    // Help tab
    // =================================================================

    var HELP = [
        { title: 'User levels', items: [
            'Super Admin: sees every product, manages every user, can make other Super Admins.',
            'Admin: sees products for their locations, can add Admin, Hoffman, Engineer, Contractor and Manufacturer users, and can edit or delete only the users they added.',
            'Hoffman: sees products for their locations and can pick any engineer schedule template.',
            'Engineer: sees products for their locations; gets the standard template plus their company\'s, if one exists.',
            'A person can have several locations. They see every product that any one of their locations allows.',
            'Contractor: same as Engineer but standard template only.',
            'Manufacturer: sees only the Calculators. No products, model lookup, Projects or Design Search, and no saving to a project; Export PDF still works. Their locations do not matter.'
        ] },
        { title: 'Adding someone', items: [
            'Add user, fill in the form, and choose "Add and send invitation". Your mail program opens with the registration link in the body. Send it.',
            'The link works for 72 hours and once. If it lapses, open the row\'s "Send invitation" again for a fresh one.',
            'Company spelling matters for Engineers: "Refresco" is what ties them to the Refresco schedule template. Pick from the suggestions when you can.',
            'Need a location or level that is not in the dropdown? Email ' + 'eric.creel@hoffman-hoffman.com' + ' and it will be added to the Permissions tab.'
        ] },
        { title: 'Companies', items: [
            'Every user is on exactly one company from the Companies tab, so a firm is only ever spelled one way. Pick it from the list when adding someone.',
            'If the firm is new, choose "+ New company" in the form. A name that looks like one already on the list is flagged first so "Refresco" and "Refresco Engineers" do not both end up there.',
            'Only @hoffman-hoffman.com addresses can be Super Admin or Admin. Hoffman is open to @hoffman-hoffman.com and @hoffmanhydronics.com. Everyone else is an Engineer, a Contractor or a Manufacturer.'
        ] },
        { title: 'Passwords', items: [
            'The site never sees or stores a password in readable form, so nobody can look one up. "Reset password" on a row makes a new link and signs that person out everywhere.',
            'When someone uses "Forgot password?" on the sign-in screen, an email comes to whoever added them, copying Eric. Reply by using Reset password on their row.'
        ] },
        { title: 'The spreadsheet', items: [
            'The Users tab of "HHpro - Users & Permissions.xlsx" is rewritten from this screen after every change. Do not edit that tab by hand; it will be overwritten.',
            'The Permissions tab is the other way round: Eric edits it in Excel and the site reads it within about 15 seconds. Blank cells mean Yes.'
        ] },
        { title: 'Projects and backups', items: [
            'Projects live on the Hoffman & Hoffman server, one folder per person. Deleting a project sets it aside for 30 days before it is removed for good.',
            'The server backs up the database, the spreadsheet and all project folders every night, and the site files once a week. The latest backup times are shown below.'
        ] }
    ];

    function renderHelp(panel) {
        var wrap = document.createElement('div');
        wrap.className = 'users-help';

        HELP.forEach(function (section) {
            var h = document.createElement('h3');
            h.className = 'users-help-title';
            h.textContent = section.title;
            wrap.appendChild(h);
            var ul = document.createElement('ul');
            ul.className = 'users-help-list';
            section.items.forEach(function (text) {
                var li = document.createElement('li');
                li.textContent = text;
                ul.appendChild(li);
            });
            wrap.appendChild(ul);
        });

        var statusTitle = document.createElement('h3');
        statusTitle.className = 'users-help-title';
        statusTitle.textContent = 'Server status';
        wrap.appendChild(statusTitle);

        var status = document.createElement('dl');
        status.className = 'users-status';
        wrap.appendChild(status);
        status.appendChild(spinner('Checking...'));

        HHpro.Api.get('/api/users/status').then(function (s) {
            status.innerHTML = '';
            function row(label, value, bad) {
                var dt = document.createElement('dt');
                dt.textContent = label;
                var dd = document.createElement('dd');
                dd.textContent = value;
                if (bad) dd.className = 'users-status-bad';
                status.appendChild(dt);
                status.appendChild(dd);
            }
            function when(job) {
                if (!job || !job.at) return { text: 'Not yet', bad: false };
                var d = new Date(job.at);
                var size = !job.bytes ? '' : job.bytes < 1048576
                    ? ' · ' + Math.max(1, Math.round(job.bytes / 1024)) + ' KB'
                    : ' · ' + (job.bytes / 1048576).toFixed(1) + ' MB';
                return job.ok
                    ? { text: d.toLocaleString() + size, bad: false }
                    : { text: 'Failed ' + d.toLocaleString() + (job.error ? ': ' + job.error : ''), bad: true };
            }
            var daily = when(s.lastDaily);
            var weekly = when(s.lastWeekly);
            var excel = s.excelSync || {};
            row('Users on file', String(s.users));
            row('Last nightly data backup', daily.text, daily.bad);
            row('Last weekly site backup', weekly.text, weekly.bad);
            row('Backups are kept in', s.backupDir);
            row('Spreadsheet Users tab', excel.pending
                ? 'Waiting to write (is the file open in Excel?)'
                : (excel.at ? 'Written ' + new Date(excel.at).toLocaleString() : 'Not written since the service started'),
                !!excel.pending);
        }, function (err) {
            status.innerHTML = '';
            status.appendChild(problem(err));
        });

        panel.appendChild(wrap);
    }

    // =================================================================
    // Small helpers
    // =================================================================

    function spinner(text) {
        var box = document.createElement('div');
        box.className = 'users-loading';
        var s = document.createElement('span');
        s.className = 'hh-spinner hh-spinner-sm';
        box.appendChild(s);
        var t = document.createElement('span');
        t.textContent = text;
        box.appendChild(t);
        return box;
    }

    function problem(err) {
        var box = document.createElement('div');
        box.className = 'hh-empty';
        box.appendChild(HHpro.UI.icon('alert-triangle'));
        var t = document.createElement('p');
        t.className = 'hh-empty-title';
        t.textContent = 'Couldn\'t load this';
        box.appendChild(t);
        var h = document.createElement('p');
        h.className = 'hh-empty-hint';
        h.textContent = err.message;
        box.appendChild(h);
        return box;
    }

    var toastTimer = null;
    function toast(message, isError) {
        var el = document.getElementById('users-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'users-toast';
            el.className = 'users-toast';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.classList.toggle('users-toast-error', !!isError);
        el.classList.add('users-toast-show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('users-toast-show'); }, isError ? 6000 : 3500);
    }
})();
