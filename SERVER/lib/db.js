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

// ---- users -------------------------------------------------------

function listUsers() {
    return open().prepare(
        'SELECT * FROM users ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE'
    ).all();
}

function countUsers() {
    return open().prepare('SELECT COUNT(*) AS c FROM users').get().c;
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
        INSERT INTO users (email, first_name, last_name, company, location, user_level,
                           status, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'invited', ?, ?)
    `).run(
        email,
        String(u.firstName || '').trim(),
        String(u.lastName || '').trim(),
        String(u.company || '').trim(),
        String(u.location || '').trim(),
        u.userLevel,
        normalizeEmail(u.createdBy),
        now()
    );
    return getUserById(Number(result.lastInsertRowid));
}

module.exports = {
    open,
    now,
    normalizeEmail,
    USER_LEVELS,
    USER_STATUSES,
    listUsers,
    countUsers,
    getUserByEmail,
    getUserById,
    insertUser
};
