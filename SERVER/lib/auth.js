/* ============================================================
   HHpro backend - Authentication helpers
   ------------------------------------------------------------
     - Password hashing with scrypt (built into Node). The stored
       value is "scrypt$<salt>$<hash>"; the password itself is
       never written anywhere.
     - One-time registration / reset tokens. The database keeps
       only the SHA-256 of the token, so a copy of the database
       cannot be used to take over an account.
     - The session cookie, and middleware that turns it back into
       req.user on every request.
     - A small login rate limit so a password cannot be guessed
       by brute force.
   ============================================================ */

'use strict';

const crypto = require('crypto');
const db = require('./db');
const log = require('./log');

const COOKIE_NAME = 'hhpro_session';
// "Signed in until they log out." Browsers cap cookie lifetime at
// roughly 400 days, so that is the practical ceiling.
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const INVITE_HOURS = 72;
const MIN_PASSWORD_LENGTH = 10;

const LOGIN_MAX_FAILURES = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

// ---- passwords ---------------------------------------------------

function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64);
    return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyPassword(password, stored) {
    if (!stored) return false;
    const parts = String(stored).split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function passwordProblem(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password.length > 200) return 'Password is too long.';
    return null;
}

// ---- one-time tokens ---------------------------------------------

function newToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/** Issue a fresh registration / reset token for a user. Returns the plain token. */
function issueInvite(userId) {
    const token = newToken();
    const expires = new Date(Date.now() + INVITE_HOURS * 60 * 60 * 1000).toISOString();
    db.setInviteToken(userId, hashToken(token), expires);
    return { token, expires };
}

/** Look up a token. Returns { user } or { error: 'invalid' | 'expired' }. */
function lookupInvite(token) {
    if (!token || !/^[A-Za-z0-9_-]{20,}$/.test(token)) return { error: 'invalid' };
    const user = db.getUserByInviteHash(hashToken(token));
    if (!user) return { error: 'invalid' };
    if (!user.invite_expires || new Date(user.invite_expires).getTime() < Date.now()) {
        return { error: 'expired', user };
    }
    return { user };
}

// ---- cookies and sessions ----------------------------------------

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    header.split(';').forEach((part) => {
        const i = part.indexOf('=');
        if (i < 0) return;
        const k = part.slice(0, i).trim();
        const v = part.slice(i + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    });
    return out;
}

// SameSite=None + Secure: the site (hhpro-hvac.com) and the API
// (api.hhpro-hvac.com) are the same site, but the cookie must also
// travel on fetch() calls from any origin listed in ALLOWED_ORIGINS,
// such as a local test copy of the site.
function setSessionCookie(res, sessionId) {
    res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=${sessionId}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=None`);
}

function clearSessionCookie(res) {
    res.setHeader('Set-Cookie',
        `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`);
}

function startSession(res, userId) {
    const id = crypto.randomBytes(32).toString('hex');
    db.createSession(id, userId);
    setSessionCookie(res, id);
    return id;
}

function endSession(req, res) {
    if (req.sessionId) db.deleteSession(req.sessionId);
    clearSessionCookie(res);
}

/**
 * Express middleware: reads the cookie and attaches req.user (the
 * users row) and req.sessionId when the session is valid.
 */
function attach(req, res, next) {
    req.user = null;
    req.sessionId = null;
    const cookies = parseCookies(req.headers.cookie);
    const id = cookies[COOKIE_NAME];
    if (id && /^[a-f0-9]{64}$/.test(id)) {
        const row = db.getSession(id);
        if (row) {
            req.sessionId = row.session_id;
            const lastSeen = new Date(row.last_seen).getTime();
            if (Date.now() - lastSeen > 5 * 60 * 1000) db.touchSession(id);
            delete row.session_id;
            delete row.last_seen;
            req.user = row;
        }
    }
    next();
}

function requireUser(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    next();
}

function isAdminLevel(level) {
    return level === 'Super Admin' || level === 'Admin';
}

function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    if (!isAdminLevel(req.user.user_level)) {
        return res.status(403).json({ error: 'Only administrators can do that.' });
    }
    next();
}

// ---- login rate limit --------------------------------------------

const failures = new Map();   // key -> { count, first }

function limiterKey(req, email) {
    return `${req.ip}|${db.normalizeEmail(email)}`;
}

function loginBlocked(req, email) {
    const entry = failures.get(limiterKey(req, email));
    if (!entry) return false;
    if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
        failures.delete(limiterKey(req, email));
        return false;
    }
    return entry.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(req, email) {
    const key = limiterKey(req, email);
    const entry = failures.get(key);
    if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) {
        failures.set(key, { count: 1, first: Date.now() });
    } else {
        entry.count++;
    }
    if (failures.size > 5000) failures.clear();   // never grow without bound
}

function clearLoginFailures(req, email) {
    failures.delete(limiterKey(req, email));
}

module.exports = {
    COOKIE_NAME,
    INVITE_HOURS,
    MIN_PASSWORD_LENGTH,
    hashPassword,
    verifyPassword,
    passwordProblem,
    issueInvite,
    lookupInvite,
    startSession,
    endSession,
    attach,
    requireUser,
    requireAdmin,
    isAdminLevel,
    loginBlocked,
    recordLoginFailure,
    clearLoginFailures,
    log
};
