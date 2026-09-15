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

    var LEVEL_ORDER = ['Super Admin', 'Admin', 'Hoffman', 'Engineer', 'Contractor'];

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
        var helpTab = tabButton('Help', 'help');
        tabs.appendChild(usersTab);
        tabs.appendChild(permsTab);
        tabs.appendChild(helpTab);
        titleBar.appendChild(tabs);
        main.appendChild(titleBar);

        var panel = document.createElement('div');
        panel.className = 'users-panel';
        main.appendChild(panel);
        els.panel = panel;
        els.tabs = { users: usersTab, permissions: permsTab, help: helpTab };

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
        { key: 'location', label: 'Location' },
        { key: 'userLevel', label: 'Level' },
        { key: 'email', label: 'Email' },
        { key: 'status', label: 'Status' },
        { key: 'createdBy', label: 'Added by' }
    ];

    function visibleUsers() {
        var q = query.trim().toLowerCase();
        var list = users.filter(function (u) {
            if (!q) return true;
            var hay = [u.firstName, u.lastName, u.company, u.location, u.userLevel, u.email, u.status, u.createdBy]
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
        var company = textField('Company', 'user-company', existing ? existing.company : '', 'organization');
        var email = textField('Email', 'user-email', existing ? existing.email : '', 'email', 'email');
        var location = selectField('Location', 'user-location', options.locations, existing ? existing.location : '');
        var level = selectField('User level', 'user-level', options.levels, existing ? existing.userLevel : '');

        // Company suggestions keep spelling consistent, which is what
        // ties an Engineer to their firm's schedule template.
        var list = document.createElement('datalist');
        list.id = 'user-company-list';
        (options.companies || []).forEach(function (c) {
            var opt = document.createElement('option');
            opt.value = c;
            list.appendChild(opt);
        });
        company.input.setAttribute('list', list.id);
        company.wrap.appendChild(list);

        grid.appendChild(firstName.wrap);
        grid.appendChild(lastName.wrap);
        grid.appendChild(company.wrap);
        grid.appendChild(email.wrap);
        grid.appendChild(location.wrap);
        grid.appendChild(level.wrap);
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
            warning.textContent = msg;
        }
        [firstName, lastName, email].forEach(function (f) { f.input.addEventListener('input', checkDuplicates); });

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
                company: company.input.value.trim(),
                email: email.input.value.trim(),
                location: location.input.value,
                userLevel: existing && existing.isSelf ? existing.userLevel : level.input.value
            };
        }

        function submit(sendAfter) {
            var p = payload();
            if (!p.firstName || !p.lastName) { error.textContent = 'First and last name are required.'; return; }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) { error.textContent = 'Enter a valid email address.'; return; }
            if (!p.location) { error.textContent = 'Choose a location.'; return; }
            if (!p.userLevel) { error.textContent = 'Choose a user level.'; return; }
            error.textContent = '';
            save.disabled = true;
            if (saveOnly) saveOnly.disabled = true;

            var req = isEdit
                ? HHpro.Api.put('/api/users/' + existing.id, p)
                : HHpro.Api.post('/api/users', p);
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
                error.textContent = err.message;
                if (err.status === 401) HHpro.App.refreshSession();
            });
        }

        function close() {
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }
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
    // Help tab
    // =================================================================

    var HELP = [
        { title: 'User levels', items: [
            'Super Admin: sees every product, manages every user, can make other Super Admins.',
            'Admin: sees products for their location, can add Admin, Hoffman, Engineer and Contractor users, and can edit or delete only the users they added.',
            'Hoffman: sees products for their location and can pick any engineer schedule template.',
            'Engineer: sees products for their location; gets the standard template plus their company\'s, if one exists.',
            'Contractor: same as Engineer but standard template only.'
        ] },
        { title: 'Adding someone', items: [
            'Add user, fill in the form, and choose "Add and send invitation". Your mail program opens with the registration link in the body. Send it.',
            'The link works for 72 hours and once. If it lapses, open the row\'s "Send invitation" again for a fresh one.',
            'Company spelling matters for Engineers: "Refresco" is what ties them to the Refresco schedule template. Pick from the suggestions when you can.',
            'Need a location or level that is not in the dropdown? Email ' + 'eric.creel@hoffman-hoffman.com' + ' and it will be added to the Permissions tab.'
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
