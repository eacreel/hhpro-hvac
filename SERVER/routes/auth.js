/* ============================================================
   HHpro backend - Sign-in routes (/api/auth)
   ------------------------------------------------------------
     POST /login            email + password -> session cookie
     POST /logout           ends the session
     GET  /me               who am I, and what may I see
     POST /forgot           who registered this user (for the
                            "Forgot password" email the browser
                            opens; the server sends no mail)
     GET  /invite/:token    check a registration / reset link
     POST /register         set a password with a valid link
     PUT  /me/prefs         save the person's own site preferences
                            (e.g. psychrometric chart checkboxes);
                            /me returns them as `prefs`

   Wrong email and wrong password get the same answer, so the
   login screen never reveals whether an address exists.
   ============================================================ */

'use strict';

const express = require('express');
const config = require('../lib/config');
const db = require('../lib/db');
const auth = require('../lib/auth');
const templates = require('../lib/templates');
const permissions = require('../lib/permissions');
const folders = require('../lib/folders');
const usersExcel = require('../lib/users_excel');
const log = require('../lib/log');

const router = express.Router();

/** Everything the site needs to know about the signed-in person. */
function profile(user) {
    const locations = db.locationsOf(user);
    const blocked = db.isSuperAdminLevel(user.user_level) ? [] : permissions.blockedProductsFor(locations);
    return {
        user: {
            id: user.id,
            email: user.email,
            firstName: user.first_name,
            lastName: user.last_name,
            company: user.company,
            locations: locations,
            location: locations.join('; '),
            userLevel: user.user_level
        },
        allowedEngineers: templates.allowedEngineersFor(user),
        defaultEngineer: templates.defaultEngineerFor(user),
        blockedProducts: blocked,
        // Manufacturer: the site shows only the Calculators.
        calculatorsOnly: auth.isCalculatorsOnly(user.user_level),
        canManageUsers: auth.isAdminLevel(user.user_level),
        contactEmail: config.superAdminEmail,
        // Saved site preferences, e.g. { psychroChart: { show, shrRef } }.
        prefs: db.prefsOf(user)
    };
}

// Saved preferences: only known keys, each cleaned to known fields, so
// the column can only ever hold what the site saves.
const CHART_SHOW_KEYS = ['rh', 'wb', 'h', 'v', 'prot', 'shr', 'rscale'];

function cleanPsychroChart(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const show = {};
    const s = (v.show && typeof v.show === 'object') ? v.show : {};
    CHART_SHOW_KEYS.forEach((k) => { if (typeof s[k] === 'boolean') show[k] = s[k]; });
    const out = { show };
    const r = v.shrRef;
    if (r && typeof r === 'object') {
        const dbF = Number(r.db), rh = Number(r.rh);
        // Reference point: dry bulb degF, RH percent.
        if (Number.isFinite(dbF) && Number.isFinite(rh) && dbF >= -40 && dbF <= 200 && rh > 0 && rh <= 100) {
            out.shrRef = { db: dbF, rh: rh };
        }
    }
    return out;
}

const PREF_CLEANERS = { psychroChart: cleanPsychroChart };

router.post('/login', (req, res) => {
    const email = db.normalizeEmail(req.body && req.body.email);
    const password = (req.body && req.body.password) || '';
    if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });

    if (auth.loginBlocked(req, email)) {
        return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });
    }

    const user = db.getUserByEmail(email);
    if (user && !user.password_hash) {
        return res.status(403).json({
            error: 'not_registered',
            message: 'Your account is waiting for you to set a password. Check your email for the registration link, or ask your administrator to resend it.'
        });
    }
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
        auth.recordLoginFailure(req, email);
        log.warn('Login failed', { email, ip: req.ip });
        return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    auth.clearLoginFailures(req, email);
    // A hash made under an older, lighter setting is replaced now that
    // we have the password in hand. Invisible to the person signing in.
    if (auth.needsRehash(user.password_hash)) {
        db.setPasswordHash(user.id, auth.hashPassword(password));
        log.info('Password hash upgraded', { email });
    }
    auth.startSession(res, user.id);
    log.info('Login', { email, ip: req.ip });
    res.json(profile(user));
});

router.post('/logout', (req, res) => {
    if (req.user) log.info('Logout', { email: req.user.email });
    auth.endSession(req, res);
    res.json({ ok: true });
});

router.get('/me', auth.requireUser, (req, res) => {
    res.json(profile(req.user));
});

// Any signed-in person, Manufacturer accounts included (the chart is a
// calculator). Each key in the body replaces that preference.
router.put('/me/prefs', auth.requireUser, (req, res) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length) {
        return res.status(400).json({ error: 'Nothing to save.' });
    }
    const prefs = db.prefsOf(req.user);
    for (const key of Object.keys(body)) {
        const clean = PREF_CLEANERS[key];
        const value = clean ? clean(body[key]) : null;
        if (!value) return res.status(400).json({ error: 'That preference could not be saved.' });
        prefs[key] = value;
    }
    db.setPrefs(req.user.id, prefs);
    log.info('Preferences saved', { email: req.user.email, keys: Object.keys(body) });
    res.json({ ok: true, prefs });
});

router.post('/forgot', (req, res) => {
    const email = db.normalizeEmail(req.body && req.body.email);
    if (!email) return res.status(400).json({ error: 'Enter your email address.' });
    const user = db.getUserByEmail(email);
    if (!user) {
        return res.json({ found: false, contact: config.superAdminEmail });
    }
    const creator = db.getUserByEmail(user.created_by);
    const to = creator ? creator.email : config.superAdminEmail;
    res.json({
        found: true,
        user: { firstName: user.first_name, lastName: user.last_name, email: user.email },
        to,
        toName: creator ? `${creator.first_name} ${creator.last_name}`.trim() : '',
        cc: to === config.superAdminEmail ? '' : config.superAdminEmail,
        registered: !!user.password_hash
    });
});

router.get('/invite/:token', (req, res) => {
    const found = auth.lookupInvite(req.params.token);
    if (found.error === 'invalid') {
        return res.status(404).json({ error: 'This link is not valid. Ask your administrator to send a new one.' });
    }
    if (found.error === 'expired') {
        return res.status(410).json({ error: 'This link has expired. Ask your administrator to send a new one.' });
    }
    const u = found.user;
    res.json({
        firstName: u.first_name,
        lastName: u.last_name,
        email: u.email,
        kind: u.password_hash ? 'reset' : 'invite'
    });
});

router.post('/register', (req, res) => {
    const token = req.body && req.body.token;
    const password = req.body && req.body.password;
    const found = auth.lookupInvite(token);
    if (found.error) {
        return res.status(found.error === 'expired' ? 410 : 404).json({
            error: found.error === 'expired'
                ? 'This link has expired. Ask your administrator to send a new one.'
                : 'This link is not valid. Ask your administrator to send a new one.'
        });
    }
    const problem = auth.passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });

    const user = found.user;
    const wasReset = !!user.password_hash;
    const folder = folders.ensureFolder(user);
    const updated = db.activateUser(user.id, auth.hashPassword(password), folder);

    // A reset signs the person out everywhere else.
    db.deleteSessionsForUser(user.id);
    auth.startSession(res, user.id);
    usersExcel.syncUsersTab();

    log.info(wasReset ? 'Password reset' : 'Registered', { email: user.email, folder });
    res.json(profile(updated));
});

module.exports = router;
