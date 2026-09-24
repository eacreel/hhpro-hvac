/* ============================================================
   HHpro backend - User management routes (/api/users)
   ------------------------------------------------------------
   Only Super Admins and Admins reach these.

     GET    /               every user, with a canManage flag
                            telling the caller which rows they
                            may edit, delete, invite or reset
     GET    /options        dropdown values: locations from the
                            Permissions tab, levels the caller may
                            assign, known company names
     GET    /permissions    the Permissions tab, for display
     GET    /export.xlsx    the user list as a spreadsheet download
     GET    /status         backup and spreadsheet-sync status (Help tab)
     GET    /companies      the managed company list with user counts
     POST   /companies      add a company (refuses look-alikes unless
                            force is set)
     PUT    /companies/:id  rename (Super Admin); users move with it
     DELETE /companies/:id  remove an unused company (Super Admin)

   Rules:
     Only @hoffman-hoffman.com addresses may be Super Admin, Admin
     or Hoffman. A user's company must be on the company list.
     POST   /               add a user (Invited)
     PUT    /:id            edit a user
     DELETE /:id            delete a user; folder is set aside
     POST   /:id/invite     new registration link
     POST   /:id/reset      new reset link; signs them out

   Rules:
     Super Admin   everything, except deleting themselves
     Admin         may add Admin / Hoffman / Engineer / Contractor /
                   Manufacturer;
                   may edit, delete, invite or reset only users
                   they added, and never a Super Admin
   ============================================================ */

'use strict';

const express = require('express');
const config = require('../lib/config');
const db = require('../lib/db');
const auth = require('../lib/auth');
const permissions = require('../lib/permissions');
const folders = require('../lib/folders');
const usersExcel = require('../lib/users_excel');
const backup = require('../lib/backup');
const log = require('../lib/log');
const ExcelJS = require('exceljs');

const router = express.Router();
router.use(auth.requireAdmin);

const ADMIN_ASSIGNABLE = ['Admin', 'Hoffman', 'Engineer', 'Contractor', 'Manufacturer'];
const HOFFMAN_LEVELS = ['Super Admin', 'Admin', 'Hoffman'];
const HOFFMAN_DOMAIN = '@hoffman-hoffman.com';

function isHoffmanEmail(email) {
    return String(email || '').toLowerCase().endsWith(HOFFMAN_DOMAIN);
}

// Words that do not distinguish one firm from another when checking
// for look-alike company names.
const COMPANY_NOISE = ['inc', 'llc', 'llp', 'pa', 'pc', 'co', 'company', 'corp', 'corporation',
    'engineers', 'engineer', 'engineering', 'associates', 'assoc', 'group', 'and', 'the', 'of'];

function companyKey(name) {
    return String(name || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
        .split(/\s+/).filter((w) => w && !COMPANY_NOISE.includes(w)).join('');
}

/** Existing company names that look like this one (same core words). */
function similarCompanies(name) {
    const key = companyKey(name);
    if (key.length < 3) return [];
    return db.listCompanies().filter((existing) => {
        const k = companyKey(existing);
        return k && (k === key || k.includes(key) || key.includes(k));
    });
}

function assignableLevels(actor) {
    return actor.user_level === 'Super Admin' ? db.USER_LEVELS.slice() : ADMIN_ASSIGNABLE.slice();
}

function canManage(actor, target) {
    if (actor.user_level === 'Super Admin') return true;
    if (target.user_level === 'Super Admin') return false;
    return db.normalizeEmail(target.created_by) === actor.email;
}

function publicRow(u, actor) {
    return {
        id: u.id,
        email: u.email,
        firstName: u.first_name,
        lastName: u.last_name,
        company: u.company,
        locations: db.locationsOf(u),
        location: db.locationsOf(u).join('; '),
        userLevel: u.user_level,
        status: u.status,
        createdBy: u.created_by,
        createdAt: u.created_at,
        registeredAt: u.registered_at,
        inviteExpires: u.invite_expires,
        canManage: canManage(actor, u),
        isSelf: u.id === actor.id
    };
}

/** Validate a submitted user form. Returns { error } or { fields }. */
function readForm(body, actor) {
    const b = body || {};
    const fields = {
        firstName: String(b.firstName || '').trim(),
        lastName: String(b.lastName || '').trim(),
        company: String(b.company || '').trim(),
        locations: db.normalizeLocations(b.locations !== undefined ? b.locations : b.location),
        userLevel: String(b.userLevel || '').trim(),
        email: db.normalizeEmail(b.email)
    };
    if (!fields.firstName || !fields.lastName) return { error: 'First and last name are required.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return { error: 'Enter a valid email address.' };
    if (!assignableLevels(actor).includes(fields.userLevel)) {
        return { error: `You cannot assign the level "${fields.userLevel || '(none)'}".` };
    }
    if (HOFFMAN_LEVELS.includes(fields.userLevel) && !isHoffmanEmail(fields.email)) {
        return { error: `Only ${HOFFMAN_DOMAIN} addresses can be Super Admin, Admin or Hoffman. Use Engineer, Contractor or Manufacturer for people at other companies.` };
    }
    const company = db.getCompanyByName(fields.company);
    if (!company) {
        return { error: `"${fields.company || '(none)'}" is not on the company list. Choose one from the list, or add it with "New company".` };
    }
    fields.company = company.name;   // canonical spelling
    const known = permissions.getLocations();
    if (!fields.locations.length) return { error: 'Choose at least one location.' };
    const unknown = fields.locations.find((loc) => !known.includes(loc));
    if (unknown) {
        return { error: `"${unknown}" is not a location on the Permissions tab. Email ${config.superAdminEmail} to have it added.` };
    }
    return { fields };
}

function registrationLink(token) {
    return `${config.allowedOrigins[0]}/#register/${token}`;
}

// ---- routes --------------------------------------------------------

router.get('/', (req, res) => {
    res.json({
        users: db.listUsers().map((u) => publicRow(u, req.user)),
        me: req.user.email
    });
});

router.get('/options', (req, res) => {
    res.json({
        locations: permissions.getLocations(),
        levels: assignableLevels(req.user),
        allLevels: db.USER_LEVELS.slice(),
        companies: db.listCompanies(),
        contactEmail: config.superAdminEmail,
        inviteHours: auth.INVITE_HOURS
    });
});

router.get('/permissions', (req, res) => {
    const p = permissions.getPermissions();
    res.json({
        loadedAt: p.loadedAt,
        error: p.error,
        locations: p.locations,
        products: p.products,
        contactEmail: config.superAdminEmail
    });
});

router.get('/export.xlsx', async (req, res, next) => {
    try {
        const wb = new ExcelJS.Workbook();
        wb.creator = 'HHpro';
        const ws = wb.addWorksheet('Users');
        ws.columns = [
            { header: 'FIRST NAME', key: 'first', width: 14 },
            { header: 'LAST NAME', key: 'last', width: 14 },
            { header: 'COMPANY', key: 'company', width: 18 },
            { header: 'LOCATION(S)', key: 'location', width: 28 },
            { header: 'USER LEVEL', key: 'level', width: 14 },
            { header: 'USERNAME', key: 'email', width: 38 },
            { header: 'STATUS', key: 'status', width: 10 },
            { header: 'ADDED BY', key: 'by', width: 38 },
            { header: 'ADDED ON', key: 'on', width: 12 },
            { header: 'REGISTERED ON', key: 'reg', width: 14 }
        ];
        ws.getRow(1).font = { bold: true };
        db.listUsers().forEach((u) => {
            ws.addRow({
                first: u.first_name, last: u.last_name, company: u.company, location: db.locationsOf(u).join('; '),
                level: u.user_level, email: u.email, status: u.status === 'active' ? 'Active' : 'Invited',
                by: u.created_by, on: (u.created_at || '').slice(0, 10), reg: (u.registered_at || '').slice(0, 10)
            });
        });
        ws.autoFilter = { from: 'A1', to: 'J1' };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        const stamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="HHpro Users ${stamp}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (e) {
        next(e);
    }
});

router.get('/status', (req, res) => {
    const b = backup.status();
    res.json({
        users: db.countUsers(),
        excelSync: usersExcel.getSyncStatus(),
        backupDir: b.backupDir,
        lastDaily: b.lastDaily,
        lastWeekly: b.lastWeekly,
        includeAssets: b.includeAssets
    });
});

// ---- companies -----------------------------------------------------

router.get('/companies', (req, res) => {
    res.json({ companies: db.listCompaniesWithCounts(), canEdit: req.user.user_level === 'Super Admin' });
});

router.post('/companies', (req, res) => {
    const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ');
    const force = !!(req.body && req.body.force);
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter a company name.' });

    const existing = db.getCompanyByName(name);
    if (existing) {
        return res.json({ company: existing, created: false, companies: db.listCompanies() });
    }
    const similar = similarCompanies(name);
    if (similar.length && !force) {
        return res.status(409).json({
            error: `"${name}" looks like ${similar.map((s) => `"${s}"`).join(', ')}, which is already on the list.`,
            similar
        });
    }
    const company = db.insertCompany(name, req.user.email);
    log.info('Company added', { by: req.user.email, name: company.name, forced: force && similar.length > 0 });
    res.status(201).json({ company, created: true, companies: db.listCompanies() });
});

function requireSuperAdmin(req, res) {
    if (req.user.user_level !== 'Super Admin') {
        res.status(403).json({ error: 'Only a Super Admin can change the company list.' });
        return false;
    }
    return true;
}

router.put('/companies/:id', (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const company = db.getCompanyById(Number(req.params.id));
    if (!company) return res.status(404).json({ error: 'That company no longer exists.' });
    const name = String((req.body && req.body.name) || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter a company name.' });
    const clash = db.getCompanyByName(name);
    if (clash && clash.id !== company.id) {
        return res.status(409).json({ error: `"${clash.name}" is already on the list.` });
    }
    // Remember where each affected user's folder is before the rename,
    // then move them under the new company folder.
    const affected = db.listUsers()
        .filter((u) => u.project_folder && String(u.company).toLowerCase() === company.name.toLowerCase())
        .map((u) => ({ id: u.id, fromRel: folders.relativePath(u) }));
    const renamed = db.renameCompany(company.id, name);
    affected.forEach((a) => folders.moveFolder(db.getUserById(a.id), a.fromRel));
    usersExcel.syncUsersTab();
    log.info('Company renamed', { by: req.user.email, from: company.name, to: renamed.name });
    res.json({ company: renamed, companies: db.listCompanies() });
});

router.delete('/companies/:id', (req, res) => {
    if (!requireSuperAdmin(req, res)) return;
    const company = db.getCompanyById(Number(req.params.id));
    if (!company) return res.status(404).json({ error: 'That company no longer exists.' });
    const inUse = db.listCompaniesWithCounts().find((c) => c.id === company.id);
    if (inUse && inUse.users > 0) {
        return res.status(400).json({ error: `"${company.name}" still has ${inUse.users} user${inUse.users === 1 ? '' : 's'}. Move them first.` });
    }
    db.deleteCompany(company.id);
    log.info('Company removed', { by: req.user.email, name: company.name });
    res.json({ ok: true, companies: db.listCompanies() });
});

router.post('/', (req, res) => {
    const form = readForm(req.body, req.user);
    if (form.error) return res.status(400).json({ error: form.error });
    if (db.getUserByEmail(form.fields.email)) {
        return res.status(409).json({ error: 'A user with that email already exists.' });
    }
    const user = db.insertUser(Object.assign({ createdBy: req.user.email }, form.fields));
    usersExcel.syncUsersTab();
    log.info('User added', { by: req.user.email, email: user.email, level: user.user_level });
    res.status(201).json({ user: publicRow(user, req.user) });
});

function loadTarget(req, res) {
    const target = db.getUserById(Number(req.params.id));
    if (!target) {
        res.status(404).json({ error: 'That user no longer exists.' });
        return null;
    }
    if (!canManage(req.user, target)) {
        res.status(403).json({ error: 'You can only change users you added.' });
        return null;
    }
    return target;
}

router.put('/:id', (req, res) => {
    const target = loadTarget(req, res);
    if (!target) return;
    const form = readForm(req.body, req.user);
    if (form.error) return res.status(400).json({ error: form.error });
    if (target.id === req.user.id && form.fields.userLevel !== req.user.user_level) {
        return res.status(400).json({ error: 'You cannot change your own user level.' });
    }
    const other = db.getUserByEmail(form.fields.email);
    if (other && other.id !== target.id) {
        return res.status(409).json({ error: 'A user with that email already exists.' });
    }
    // Their project folder lives under Hoffman / Engineers/<Company> /
    // Contractors/<Company>; a change of level or company moves it.
    const fromRel = folders.relativePath(target);
    const user = db.updateUser(target.id, form.fields);
    folders.moveFolder(user, fromRel);
    usersExcel.syncUsersTab();
    log.info('User edited', { by: req.user.email, email: user.email });
    res.json({ user: publicRow(user, req.user) });
});

router.delete('/:id', (req, res) => {
    const target = loadTarget(req, res);
    if (!target) return;
    if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
    const retired = folders.retireFolder(target);
    db.deleteUser(target.id);
    usersExcel.syncUsersTab();
    log.info('User deleted', { by: req.user.email, email: target.email, folderSetAside: retired });
    res.json({ ok: true });
});

router.post('/:id/invite', (req, res) => {
    const target = loadTarget(req, res);
    if (!target) return;
    const { token, expires } = auth.issueInvite(target.id);
    log.info('Invitation link issued', { by: req.user.email, email: target.email });
    res.json({
        link: registrationLink(token),
        expires,
        kind: target.password_hash ? 'reset' : 'invite',
        user: publicRow(db.getUserById(target.id), req.user)
    });
});

router.post('/:id/reset', (req, res) => {
    const target = loadTarget(req, res);
    if (!target) return;
    const { token, expires } = auth.issueInvite(target.id);
    db.deleteSessionsForUser(target.id);
    log.info('Password reset link issued', { by: req.user.email, email: target.email });
    res.json({
        link: registrationLink(token),
        expires,
        kind: 'reset',
        user: publicRow(db.getUserById(target.id), req.user)
    });
});

module.exports = router;
