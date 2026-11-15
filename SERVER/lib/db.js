/* ============================================================
   HHpro backend - Database
   ------------------------------------------------------------
   One SQLite file, Users/hhpro.db, using the SQLite build that
   ships inside Node. Main tables:

     users     one row per account. The email is the username.
               password_hash is empty until the person registers.
               prefs holds the person's saved site preferences (JSON).
               login_count / visit_count / last_active_at feed the
               Super Admin Analytics tab: sign-ins, visits (new after
               30 minutes away), and the last time the person used
               the site (to within the 5-minute session refresh).
     sessions  one row per signed-in browser. The browser holds
               only the random session id in a cookie.
     cart_adds one row per item added to a temporary cart (product
               type + time), for the Analytics tab.
     usage_events / daily_active  schedule exports, calculator opens,
               Design Search runs, and the days each person used the
               site, for the Analytics tab.
     project_log  a permanent record of every saved project (name, dates,
               equipment counts, owner details), kept after deletion,
               for the Analytics tab's Projects view.

   The schema is created on first open and upgraded in place by
   the numbered migrations below, so a new column later never
   needs a manual step on the server.
   ============================================================ */

'use strict';

const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const log = require('./log');
const activityBackfill = require('./activity_backfill');

const USER_LEVELS = ['Super Admin', 'Admin', 'Hoffman', 'Engineer', 'Contractor', 'Manufacturer'];
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
    `,

    // v4: each person's saved site preferences, one JSON object
    // (e.g. { "psychroChart": { "show": {...}, "shrRef": {...} } }).
    // Kept off the spreadsheet and the admin lists.
    `
    ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}';
    `,

    // v5: activity for the Super Admin Analytics tab. Kept on the user
    // row because session rows are deleted at sign-out and password
    // reset. Filled in once from the logs (lib/activity_backfill.js),
    // then kept current by createSession / touchSession.
    `
    ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN last_active_at TEXT;
    `,

    // v6: one row per item added to a temporary cart (selections that
    // never reach a saved project), for the Analytics tab. Only the
    // product type and the time; gone with the account.
    `
    CREATE TABLE IF NOT EXISTS cart_adds (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        product_key TEXT    NOT NULL,
        at          TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS cart_adds_user ON cart_adds(user_id);
    `,

    // v7: visits for the Analytics tab - each time someone opens the
    // site, or comes back after VISIT_GAP_MS without using it. Counted
    // from this version on (there is no history to fill it from).
    `
    ALTER TABLE users ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 0;
    `,

    // v8: for the Analytics tab -
    //   usage_events  schedule exports, calculator opens and Design
    //                 Search runs (kind + a short detail + product key)
    //   daily_active  one row per person per day they used the site
    //                 (server local date), for the weekly trend. Days
    //                 before v8 are estimated once from sign-ins in the
    //                 logs and saved project dates (activity_backfill).
    `
    CREATE TABLE IF NOT EXISTS usage_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind        TEXT    NOT NULL,
        detail      TEXT    NOT NULL DEFAULT '',
        product_key TEXT    NOT NULL DEFAULT '',
        at          TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS usage_events_user ON usage_events(user_id);
    CREATE TABLE IF NOT EXISTS daily_active (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day     TEXT    NOT NULL,
        PRIMARY KEY (user_id, day)
    ) WITHOUT ROWID;
    `,

    // v9: project_log, a permanent record of every saved project for the
    // Analytics tab's Projects view: its name, dates, equipment counts
    // and the owner's details as of the last save. Rows are kept after
    // the project is deleted (deleted_at set) and after the account is
    // deleted (person cleared, account_deleted = 1), so user_id has no
    // foreign key. Filled once from the saved and trashed project files.
    `
    CREATE TABLE IF NOT EXISTS project_log (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         INTEGER,
        project_id      TEXT    NOT NULL,
        name            TEXT    NOT NULL DEFAULT '',
        created_at      TEXT,
        updated_at      TEXT,
        items           INTEGER NOT NULL DEFAULT 0,
        types           TEXT    NOT NULL DEFAULT '{}',
        layout          TEXT    NOT NULL DEFAULT '',
        shared_from     TEXT    NOT NULL DEFAULT '',
        deleted_at      TEXT,
        owner_name      TEXT    NOT NULL DEFAULT '',
        owner_email     TEXT    NOT NULL DEFAULT '',
        company         TEXT    NOT NULL DEFAULT '',
        locations       TEXT    NOT NULL DEFAULT '[]',
        user_level      TEXT    NOT NULL DEFAULT '',
        account_deleted INTEGER NOT NULL DEFAULT 0,
        UNIQUE (user_id, project_id)
    );
    `
];

// The migration whose upgrade fills project_log from the project files.
const PROJECT_LOG_VERSION = 9;

// The migration whose upgrade estimates daily_active from before it.
const DAILY_ACTIVE_VERSION = 8;

// A request after this long without activity starts a new visit.
const VISIT_GAP_MS = 30 * 60 * 1000;

// The migration whose upgrade runs the one-time activity back-fill.
const ACTIVITY_VERSION = 5;

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
        if (v + 1 === ACTIVITY_VERSION) {
            // A failed back-fill only leaves the counts at 0; it must
            // never stop the service from starting.
            try {
                const done = activityBackfill.backfill(db, config.logsDir);
                log.info('Activity back-filled from logs and sessions', done);
            } catch (e) {
                log.error(`Activity back-fill failed: ${e.message}`);
            }
        }
        if (v + 1 === DAILY_ACTIVE_VERSION) {
            try {
                const done = activityBackfill.backfillDays(db, config.logsDir, config.projectsDir);
                log.info('Daily activity estimated from logs and saved projects', done);
            } catch (e) {
                log.error(`Daily activity back-fill failed: ${e.message}`);
            }
        }
        if (v + 1 === PROJECT_LOG_VERSION) {
            try {
                const done = activityBackfill.backfillProjectLog(db, config.projectsDir, projectLogUpsert);
                log.info('Project log filled from saved and trashed projects', done);
            } catch (e) {
                log.error(`Project log back-fill failed: ${e.message}`);
            }
        }
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

/** Replace the stored password hash (used to upgrade the work factor at sign-in). */
function setPasswordHash(id, passwordHash) {
    open().prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

/** A user row's saved preferences as an object ({} when none or unreadable). */
function prefsOf(user) {
    try {
        const p = JSON.parse((user && user.prefs) || '{}');
        return (p && typeof p === 'object' && !Array.isArray(p)) ? p : {};
    } catch (e) {
        return {};
    }
}

/** Replace a user's saved preferences (an already validated object). */
function setPrefs(id, prefs) {
    open().prepare('UPDATE users SET prefs = ? WHERE id = ?').run(JSON.stringify(prefs || {}), id);
}

function setProjectFolder(id, folder) {
    open().prepare('UPDATE users SET project_folder = ? WHERE id = ?').run(folder, id);
}

function projectFolderTaken(folder) {
    return !!open().prepare('SELECT 1 FROM users WHERE project_folder = ?').get(folder);
}

// ---- sessions ----------------------------------------------------

// Last active = now, and one more visit when the person had been away
// for VISIT_GAP_MS or more (SQLite reads last_active_at before the SET).
const MARK_ACTIVE_SQL = `
    visit_count = visit_count + (CASE WHEN last_active_at IS NULL OR last_active_at < ? THEN 1 ELSE 0 END),
    last_active_at = ?`;

function visitCutoff() {
    return new Date(Date.now() - VISIT_GAP_MS).toISOString();
}

/** YYYY-MM-DD in the server's local time (the weekly trend's days). */
function localDay(date) {
    const d = date || new Date();
    const two = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** A new session = a sign-in (password, registration or reset): count it. */
function createSession(id, userId) {
    const t = now();
    const d = open();
    d.prepare('INSERT INTO sessions (id, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .run(id, userId, t, t);
    d.prepare(`UPDATE users SET login_count = login_count + 1, ${MARK_ACTIVE_SQL} WHERE id = ?`)
        .run(visitCutoff(), t, userId);
    d.prepare('INSERT OR IGNORE INTO daily_active (user_id, day) VALUES (?, ?)').run(userId, localDay());
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

/** Called at most every 5 minutes per session (lib/auth.js attach). */
function touchSession(id) {
    const t = now();
    const d = open();
    d.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').run(t, id);
    d.prepare(`UPDATE users SET ${MARK_ACTIVE_SQL} WHERE id = (SELECT user_id FROM sessions WHERE id = ?)`)
        .run(visitCutoff(), t, id);
    d.prepare('INSERT OR IGNORE INTO daily_active (user_id, day) SELECT user_id, ? FROM sessions WHERE id = ?')
        .run(localDay(), id);
}

// ---- temporary-cart adds (Analytics) -------------------------------

function recordCartAdd(userId, productKey) {
    open().prepare('INSERT INTO cart_adds (user_id, product_key, at) VALUES (?, ?, ?)')
        .run(userId, productKey, now());
}

/** { userId: { items, last, types: { productKey: count } } } for everyone with cart adds. */
function cartSummaries() {
    const out = {};
    open().prepare(`
        SELECT user_id, product_key, COUNT(*) AS n, MAX(at) AS last
        FROM cart_adds GROUP BY user_id, product_key
    `).all().forEach((r) => {
        const s = out[r.user_id] || (out[r.user_id] = { items: 0, last: null, types: {} });
        s.items += r.n;
        s.types[r.product_key] = r.n;
        if (!s.last || r.last > s.last) s.last = r.last;
    });
    return out;
}

// ---- usage events + daily activity (Analytics) ---------------------

function recordEvent(userId, kind, detail, productKey) {
    open().prepare('INSERT INTO usage_events (user_id, kind, detail, product_key, at) VALUES (?, ?, ?, ?, ?)')
        .run(userId, kind, detail || '', productKey || '', now());
}

/**
 * { userId: { kind: { count, last, details: { detail: count } } } } for
 * every user with usage events.
 */
function eventSummaries() {
    const out = {};
    open().prepare(`
        SELECT user_id, kind, detail, COUNT(*) AS n, MAX(at) AS last
        FROM usage_events GROUP BY user_id, kind, detail
    `).all().forEach((r) => {
        const u = out[r.user_id] || (out[r.user_id] = {});
        const k = u[r.kind] || (u[r.kind] = { count: 0, last: null, details: {} });
        k.count += r.n;
        if (r.detail) k.details[r.detail] = (k.details[r.detail] || 0) + r.n;
        if (!k.last || r.last > k.last) k.last = r.last;
    });
    return out;
}

/** { userId: ['YYYY-MM-DD', ...] } - the days each person used the site. */
function activeDays() {
    const out = {};
    open().prepare('SELECT user_id, day FROM daily_active ORDER BY day').all().forEach((r) => {
        (out[r.user_id] || (out[r.user_id] = [])).push(r.day);
    });
    return out;
}

// ---- project_log (Analytics > Projects) ----------------------------

/**
 * Insert or refresh one project's permanent record from the project as
 * saved, with the owner's details as they are now. A re-save clears
 * deleted_at (the project is back). opts.sharedFrom names the sender of
 * a shared copy; opts.deletedAt records an already-deleted project.
 */
function projectLogUpsert(d, user, project, opts) {
    const o = opts || {};
    const items = Array.isArray(project.items) ? project.items : [];
    const types = {};
    items.forEach((it) => {
        const k = String((it && it.productKey) || 'unknown');
        types[k] = (types[k] || 0) + 1;
    });
    const sharedFrom = o.sharedFrom || (project.sharedBy && project.sharedBy.name) || '';
    d.prepare(`
        INSERT INTO project_log (user_id, project_id, name, created_at, updated_at, items, types, layout,
                                 shared_from, deleted_at, owner_name, owner_email, company, locations, user_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, project_id) DO UPDATE SET
            name = excluded.name,
            created_at = COALESCE(project_log.created_at, excluded.created_at),
            updated_at = excluded.updated_at,
            items = excluded.items,
            types = excluded.types,
            layout = excluded.layout,
            shared_from = CASE WHEN excluded.shared_from <> '' THEN excluded.shared_from ELSE project_log.shared_from END,
            deleted_at = excluded.deleted_at,
            owner_name = excluded.owner_name,
            owner_email = excluded.owner_email,
            company = excluded.company,
            locations = excluded.locations,
            user_level = excluded.user_level
    `).run(
        user.id, String(project.id), String(project.name || ''),
        project.createdAt || null, project.updatedAt || project.createdAt || now(),
        items.length, JSON.stringify(types), String(project.engineer || 'hoffman'),
        sharedFrom, o.deletedAt || null,
        `${user.first_name || ''} ${user.last_name || ''}`.trim(), user.email || '',
        user.company || '', JSON.stringify(locationsOf(user)), user.user_level || ''
    );
}

/** A project was saved (PUT) or arrived as a shared copy. */
function logProjectSave(user, project, opts) {
    projectLogUpsert(open(), user, project, opts);
}

/** A project went to the trash: keep its record, mark it deleted. */
function logProjectDelete(user, project) {
    projectLogUpsert(open(), user, project, { deletedAt: now() });
}

/** An account was deleted: keep its projects' records without the person. */
function anonymizeProjectLog(userId) {
    open().prepare(`UPDATE project_log SET owner_name = '', owner_email = '', account_deleted = 1
                    WHERE user_id = ?`).run(userId);
}

function listProjectLog() {
    return open().prepare('SELECT * FROM project_log ORDER BY updated_at DESC').all();
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
    setPasswordHash,
    prefsOf,
    setPrefs,
    setProjectFolder,
    projectFolderTaken,
    createSession,
    getSession,
    touchSession,
    recordCartAdd,
    cartSummaries,
    recordEvent,
    eventSummaries,
    activeDays,
    localDay,
    logProjectSave,
    logProjectDelete,
    anonymizeProjectLog,
    listProjectLog,
    deleteSession,
    deleteSessionsForUser
};
