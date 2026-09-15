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
     POST   /               add a user (Invited)
     PUT    /:id            edit a user
     DELETE /:id            delete a user; folder is set aside
     POST   /:id/invite     new registration link
     POST   /:id/reset      new reset link; signs them out

   Rules:
     Super Admin   everything, except deleting themselves
     Admin         may add Admin / Hoffman / Engineer / Contractor;
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
const log = require('../lib/log');

const router = express.Router();
router.use(auth.requireAdmin);

const ADMIN_ASSIGNABLE = ['Admin', 'Hoffman', 'Engineer', 'Contractor'];

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
        location: u.location,
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
        location: String(b.location || '').trim(),
        userLevel: String(b.userLevel || '').trim(),
        email: db.normalizeEmail(b.email)
    };
    if (!fields.firstName || !fields.lastName) return { error: 'First and last name are required.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return { error: 'Enter a valid email address.' };
    if (!assignableLevels(actor).includes(fields.userLevel)) {
        return { error: `You cannot assign the level "${fields.userLevel || '(none)'}".` };
    }
    const locations = permissions.getLocations();
    if (!locations.includes(fields.location)) {
        return { error: `"${fields.location || '(none)'}" is not a location on the Permissions tab. Email ${config.superAdminEmail} to have it added.` };
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
    const user = db.updateUser(target.id, form.fields);
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
