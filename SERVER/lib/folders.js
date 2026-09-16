/* ============================================================
   HHpro backend - Per-user project folders
   ------------------------------------------------------------
   Every registered user gets a folder for the projects they
   save, organised under Users/Projects like this:

     Projects/
       Hoffman/<person>/                 Super Admin, Admin, Hoffman
       Engineers/<Company>/<person>/     Engineer
       Contractors/<Company>/<person>/   Contractor
       _deleted_<person>_<date>/         set aside when an account
                                         is removed (30 days)

   The <person> part is stored on the user row (project_folder)
   and never changes: it comes from the part of their email
   before the "@". If two people share that part (dylan@ref-eng.com
   and dylan@gmail.com) the second one gets the domain appended:
   dylan.ref-eng.com.

   The group and company parts are worked out from the user row
   each time, so when someone's level or company changes their
   folder is moved to match (see moveFolder). Folders created
   before this layout, flat under Projects/, are moved into place
   the first time they are touched (ensureFolder) and in one pass
   at service start (reorganizeAll).
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');
const log = require('./log');

const HOFFMAN_LEVELS = ['Super Admin', 'Admin', 'Hoffman'];

function safeLeaf(part) {
    return String(part || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
}

/** A company name as a Windows-safe folder name, readable as typed. */
function safeCompany(name) {
    const s = String(name || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
    return s || 'Unknown company';
}

/** "Hoffman", "Engineers/<Company>" or "Contractors/<Company>" for a level + company. */
function groupFor(level, company) {
    if (HOFFMAN_LEVELS.includes(level)) return 'Hoffman';
    if (level === 'Engineer') return path.join('Engineers', safeCompany(company));
    if (level === 'Contractor') return path.join('Contractors', safeCompany(company));
    return 'Other';
}

function relativePathFor(level, company, leaf) {
    return path.join(groupFor(level, company), leaf);
}

/** Folder path relative to Projects/ for this user, or null if they have none yet. */
function relativePath(user) {
    return user.project_folder ? relativePathFor(user.user_level, user.company, user.project_folder) : null;
}

function folderPath(user) {
    const rel = relativePath(user);
    return rel ? path.join(config.projectsDir, rel) : null;
}

/** Pick a <person> name for an email that nobody else has. */
function chooseFolderName(email) {
    const [local, domain] = String(email).toLowerCase().split('@');
    const candidates = [safeLeaf(local), `${safeLeaf(local)}.${safeLeaf(domain)}`];
    for (const name of candidates) {
        if (name && !db.projectFolderTaken(name) && !fs.existsSync(path.join(config.projectsDir, name))) {
            return name;
        }
    }
    let n = 2;
    while (true) {
        const name = `${candidates[1]}-${n++}`;
        if (!db.projectFolderTaken(name) && !fs.existsSync(path.join(config.projectsDir, name))) return name;
    }
}

function moveDir(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
}

/**
 * Make sure the user's folder exists at its proper place. A folder left
 * flat under Projects/ from the old layout is moved in. Returns the
 * <person> name (the value to store on the user row).
 */
function ensureFolder(user) {
    const leaf = user.project_folder || chooseFolderName(user.email);
    const target = path.join(config.projectsDir, relativePathFor(user.user_level, user.company, leaf));
    if (!fs.existsSync(target)) {
        const legacy = path.join(config.projectsDir, leaf);
        if (fs.existsSync(legacy) && fs.statSync(legacy).isDirectory()) {
            moveDir(legacy, target);
            log.info('Project folder moved into the new layout', { from: leaf, to: relativePathFor(user.user_level, user.company, leaf) });
        } else {
            fs.mkdirSync(target, { recursive: true });
        }
    }
    return leaf;
}

/** Full path of the user's folder, creating or relocating it as needed. */
function dirFor(user) {
    const leaf = ensureFolder(user);
    return path.join(config.projectsDir, relativePathFor(user.user_level, user.company, leaf));
}

/**
 * After a user's level or company changed: move their folder from where
 * it was (fromRel, relative to Projects/) to where it now belongs.
 */
function moveFolder(user, fromRel) {
    if (!user.project_folder || !fromRel) return false;
    const from = path.join(config.projectsDir, fromRel);
    const to = folderPath(user);
    if (from === to || !fs.existsSync(from)) return false;
    if (fs.existsSync(to)) {
        log.warn('Project folder not moved: destination already exists', { from: fromRel, to: relativePath(user) });
        return false;
    }
    moveDir(from, to);
    removeIfEmpty(path.dirname(from));
    log.info('Project folder moved', { email: user.email, from: fromRel, to: relativePath(user) });
    return true;
}

/** Remove an empty company folder left behind by a move. Never removes the group folders. */
function removeIfEmpty(dir) {
    try {
        const rel = path.relative(config.projectsDir, dir);
        if (!rel || rel.split(path.sep).length < 2) return;   // Projects/ or a group folder
        if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
    } catch (e) { /* leave it */ }
}

/** Set a deleted user's folder aside (top level, so the 30-day cleanup finds it). */
function retireFolder(user) {
    const from = folderPath(user);
    if (!from || !fs.existsSync(from)) return null;
    const stamp = new Date().toISOString().slice(0, 10);
    let to = path.join(config.projectsDir, `_deleted_${user.project_folder}_${stamp}`);
    let n = 2;
    while (fs.existsSync(to)) to = path.join(config.projectsDir, `_deleted_${user.project_folder}_${stamp}-${n++}`);
    fs.renameSync(from, to);
    removeIfEmpty(path.dirname(from));
    return path.basename(to);
}

/** One pass over every user: move any folder still in the old flat layout. Run at service start. */
function reorganizeAll() {
    let moved = 0;
    for (const user of db.listUsers()) {
        if (!user.project_folder) continue;
        const legacy = path.join(config.projectsDir, user.project_folder);
        const target = folderPath(user);
        if (fs.existsSync(legacy) && fs.statSync(legacy).isDirectory() && !fs.existsSync(target)) {
            moveDir(legacy, target);
            moved++;
        }
    }
    if (moved) log.info(`Reorganised ${moved} project folder(s) into Hoffman / Engineers / Contractors`);
    return moved;
}

module.exports = {
    HOFFMAN_LEVELS,
    groupFor,
    relativePathFor,
    relativePath,
    folderPath,
    chooseFolderName,
    ensureFolder,
    dirFor,
    moveFolder,
    retireFolder,
    reorganizeAll
};
