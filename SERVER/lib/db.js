/* ============================================================
   HHpro backend - Database
   ------------------------------------------------------------
   One SQLite file, Users/hhpro.db, using the SQLite build that
   ships inside Node. Two tables:

     users     one row per account. The email is the username.
               password_hash is empty until the person registers.
     sessions  one row per signed-in browser. The browser holds
               only the random session id in a cookie.

   The schema is created on first open and upgraded in place by
   the numbered migrations below, so a new column later never
   needs a manual step on the server.
   ============================================================ */

'use strict';

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const USER_LEVELS = ['Super Admin', 'Admin', 'Hoffman', 'Engineer', 'Contractor'];
const USER_STATUSES = ['invited', 'active'];

// Every migration runs once, in order, tracked in schema_version.
const MIGRATIONS = [
    `
    CREATE TABLE IF NOT EXISTS users (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        email             TEXT    NOT NULL UNIQUE,
        first_name        TEXT    NOT NULL DEFAULT '',
        last_name         TEXT    NOT NULL DEFAULT '',
        company           TEXT    NOT NULL DEFAULT '',
        location          TEXT    NOT NULL DEFAULT '',
        user_level        TEXT    NOT NULL,
        password_hash     TEXT,
        status            TEXT    NOT NULL DEFAULT 'invited',
        created_by        TEXT    NOT NULL,
        created_at        TEXT    NOT NULL,
        registered_at     TEXT,
        invite_token_hash TEXT,
        invite_expires    TEXT,
        project_folder    TEXT    UNIQUE
    );
    CREATE INDEX IF NOT EXISTS users_created_by ON users(created_by);

    CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        last_seen  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    `,
    // v2: a person can belong to several locations. Stored as a JSON
    // array of the names on the Permissions tab; the old single
    // location column is folded in and dropped.
    `
    ALTER TABLE users ADD COLUMN locations TEXT NOT NULL DEFAULT '[]';
    UPDATE users SET locations = CASE WHEN location <> '' THEN json_array(location) ELSE '[]' END;
    ALTER TABLE users DROP COLUMN location;
    `,
    // v3: one managed list of company names, so "Refresco" and
    // "Refresco Engineers" cannot both creep in. Seeded from the
    // companies already on user rows.
    `
    CREATE TABLE IF NOT EXISTS companies (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT    NOT NULL COLLATE NOCASE UNIQUE,
        created_by TEXT    NOT NULL DEFAULT '',
        created_at TEXT    NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO companies (name, created_by, created_at)
        SELECT DISTINCT company, 'import', '' FROM users WHERE company <> '';
    `
];

let db = null;

function open() {
    if (db) return db;
    fs.mkdirSync(config.usersDir, { recursive: true });
    db = new DatabaseSync(config.dbFile);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    let row = db.prepare('SELECT version FROM schema_version').get();
    if (!row) {
        db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
        row = { version: 0 };
    }
    for (let v = row.version; v < MIGRATIONS.length; v++) {
        db.exec('BEGIN');
        db.exec(MIGRATIONS[v]);
        db.prepare('UPDATE schema_version SET version = ?').run(v + 1);
        db.exec('COMMIT');
    }
    return db;
}

function now() {
    return new Date().toISOString();
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function clean(s) {
    return String(s || '').trim();
}

/** Accepts an array, a JSON string, or a "; "-joined string; returns a clean array. */
function normalizeLocations(value) {
    let list = value;
    if (typeof list === 'string') {
        const t = list.trim();
        if (t.startsWith('[')) {
            try { list = JSON.parse(t); } catch (e) { list = []; }
        } else {
            list = t.split(';');
        }
    }
    if (!Array.isArray(list)) list = [];
    const out = [];
    list.forEach((v) => {
        const s = clean(v);
        if (s && !out.includes(s)) out.push(s);
    });
    return out;
}

/** The locations array for a users row (the column holds JSON). */
function locationsOf(user) {
    return user ? normalizeLocations(user.locations) : [];
}

// ---- users -------------------------------------------------------

function listUsers() {
    return open().prepare(
        'SELECT * FROM users ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE'
    ).all();
}

function countUsers() {
    return open().prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

// ---- companies ---------------------------------------------------

function listCompanies() {
    return open().prepare('SELECT name FROM companies ORDER BY name COLLATE NOCASE').all().map((r) => r.name);
}

/** Companies with how many users each has. */
function listCompaniesWithCounts() {
    return open().prepare(`
        SELECT c.id, c.name, c.created_by, c.created_at,
               (SELECT COUNT(*) FROM users u WHERE u.company = c.name COLLATE NOCASE) AS users
        FROM companies c ORDER BY c.name COLLATE NOCASE
    `).all();
}

function getCompanyByName(name) {
    return open().prepare('SELECT * FROM companies WHERE name = ? COLLATE NOCASE').get(clean(name)) || null;
}

function getCompanyById(id) {
    return open().prepare('SELECT * FROM companies WHERE id = ?').get(id) || null;
}

function insertCompany(name, createdBy) {
    const result = open().prepare('INSERT INTO companies (name, created_by, created_at) VALUES (?, ?, ?)')
        .run(clean(name), normalizeEmail(createdBy), now());
    return getCompanyById(Number(result.lastInsertRowid));
}

/** Rename a company and carry every user on it across. */
function renameCompany(id, newName) {
    const company = getCompanyById(id);
    if (!company) return null;
    const d = open();
    d.exec('BEGIN');
    try {
        d.prepare('UPDATE companies SET name = ? WHERE id = ?').run(clean(newName), id);
        d.prepare('UPDATE users SET company = ? WHERE company = ? COLLATE NOCASE').run(clean(newName), company.name);
        d.exec('COMMIT');
    } catch (e) {
        d.exec('ROLLBACK');
        throw e;
    }
    return getCompanyById(id);
}

function deleteCompany(id) {
    open().prepare('DELETE FROM companies WHERE id = ?').run(id);
}

function getUserByEmail(email) {
    return open().prepare('SELECT * FROM users WHERE email = ?').get(normalizeEmail(email)) || null;
}

function getUserById(id) {
    return open().prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

/**
 * Insert a new account in the Invited state. Throws if the email is
 * already taken or the level is not one of USER_LEVELS.
 */
function insertUser(u) {
    const email = normalizeEmail(u.email);
    if (!email || !email.includes('@')) throw new Error(`Invalid email: "${u.email}"`);
    if (!USER_LEVELS.includes(u.userLevel)) throw new Error(`Unknown user level: "${u.userLevel}"`);
    if (getUserByEmail(email)) throw new Error(`Email already exists: ${email}`);

    const result = open().prepare(`
        INSERT INTO users (email, first_name, last_name, company, locations, user_level,
                           status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'invited', ?, ?)
    `).run(
        email, clean(u.firstName), clean(u.lastName), clean(u.company),
        JSON.stringify(normalizeLocations(u.locations !== undefined ? u.locations : u.location)),
        u.userLevel, normalizeEmail(u.createdBy), now()
    );
    return getUserById(Number(result.lastInsertRowid));
}

/** Update the editable profile fields. Email changes keep the same account and folder. */
function updateUser(id, u) {
    const email = normalizeEmail(u.email);
    if (!email || !email.includes('@')) throw new Error(`Invalid email: "${u.email}"`);
    if (!USER_LEVELS.includes(u.userLevel)) throw new Error(`Unknown user level: "${u.userLevel}"`);
    const existing = getUserByEmail(email);
    if (existing && existing.id !== id) throw new Error(`Email already exists: ${email}`);

    open().prepare(`
        UPDATE users SET email = ?, first_name = ?, last_name = ?, company = ?, locations = ?, user_level = ?
        WHERE id = ?
    `).run(email, clean(u.firstName), clean(u.lastName), clean(u.company),
        JSON.stringify(normalizeLocations(u.locations !== undefined ? u.locations : u.location)), u.userLevel, id);
    return getUserById(id);
}

function deleteUser(id) {
    open().prepare('DELETE FROM users WHERE id = ?').run(id);
}

function setInviteToken(id, tokenHash, expiresIso) {
    open().prepare('UPDATE users SET invite_token_hash = ?, invite_expires = ? WHERE id = ?')
        .run(tokenHash, expiresIso, id);
}

function getUserByInviteHash(tokenHash) {
    if (!tokenHash) return null;
    return open().prepare('SELECT * FROM users WHERE invite_token_hash = ?').get(tokenHash) || null;
}

/** Set (or reset) the password, activate the account, and clear the token. */
function activateUser(id, passwordHash, projectFolder) {
    const user = getUserById(id);
    open().prepare(`
        UPDATE users SET password_hash = ?, status = 'active',
                         registered_at = COALESCE(registered_at, ?),
                         project_folder = COALESCE(project_folder, ?),
                         invite_token_hash = NULL, invite_expires = NULL
        WHERE id = ?
    `).run(passwordHash, now(), projectFolder || user.project_folder || null, id);
    return getUserById(id);
}

function setProjectFolder(id, folder) {
    open().prepare('UPDATE users SET project_folder = ? WHERE id = ?').run(folder, id);
}

function projectFolderTaken(folder) {
    return !!open().prepare('SELECT 1 FROM users WHERE project_folder = ?').get(folder);
}

// ---- sessions ----------------------------------------------------

function createSession(id, userId) {
    const t = now();
    open().prepare('INSERT INTO sessions (id, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .run(id, userId, t, t);
}

/** Session row joined with its user, or null. */
function getSession(id) {
    if (!id) return null;
    return open().prepare(`
        SELECT s.id AS session_id, s.last_seen, u.*
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?
    `).get(id) || null;
}

function touchSession(id) {
    open().prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(now(), id);
}

function deleteSession(id) {
    open().prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

function deleteSessionsForUser(userId) {
    open().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

module.exports = {
    open,
    now,
    normalizeEmail,
    normalizeLocations,
    locationsOf,
    USER_LEVELS,
    USER_STATUSES,
    listUsers,
    countUsers,
    listCompanies,
    listCompaniesWithCounts,
    getCompanyByName,
    getCompanyById,
    insertCompany,
    renameCompany,
    deleteCompany,
    getUserByEmail,
    getUserById,
    insertUser,
    updateUser,
    deleteUser,
    setInviteToken,
    getUserByInviteHash,
    activateUser,
    setProjectFolder,
    projectFolderTaken,
    createSession,
    getSession,
    touchSession,
    deleteSession,
    deleteSessionsForUser
};
