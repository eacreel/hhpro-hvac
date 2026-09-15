/* ============================================================
   HHpro backend - Per-user project folders
   ------------------------------------------------------------
   Every registered user gets a folder under Users/Projects/ for
   the projects they save. The folder is named from the part of
   their email before the "@". If two people share that part
   (dylan@ref-eng.com and dylan@gmail.com) the second one gets
   the domain appended: dylan.ref-eng.com.

   Deleted accounts keep their folder, renamed with a _deleted_
   prefix, so nothing is lost by accident.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const db = require('./db');

function safe(part) {
    return String(part || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
}

/** Pick a folder name for an email that is not yet used by anyone. */
function chooseFolderName(email) {
    const [local, domain] = String(email).toLowerCase().split('@');
    const candidates = [safe(local), `${safe(local)}.${safe(domain)}`];
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

/** Create the folder for a user if they do not have one yet. Returns the folder name. */
function ensureFolder(user) {
    const name = user.project_folder || chooseFolderName(user.email);
    fs.mkdirSync(path.join(config.projectsDir, name), { recursive: true });
    return name;
}

function folderPath(user) {
    return user.project_folder ? path.join(config.projectsDir, user.project_folder) : null;
}

/** Set a deleted user's folder aside instead of removing it. */
function retireFolder(user) {
    const from = folderPath(user);
    if (!from || !fs.existsSync(from)) return null;
    const stamp = new Date().toISOString().slice(0, 10);
    let to = path.join(config.projectsDir, `_deleted_${user.project_folder}_${stamp}`);
    let n = 2;
    while (fs.existsSync(to)) to = path.join(config.projectsDir, `_deleted_${user.project_folder}_${stamp}-${n++}`);
    fs.renameSync(from, to);
    return path.basename(to);
}

module.exports = { chooseFolderName, ensureFolder, folderPath, retireFolder };
