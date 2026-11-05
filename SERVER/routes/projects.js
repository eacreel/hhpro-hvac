/* ============================================================
   HHpro backend - Saved projects (/api/projects)
   ------------------------------------------------------------
   Every signed-in person has a folder under Users/Projects/
   (Hoffman/<person>, Engineers/<Company>/<person> or
   Contractors/<Company>/<person>, see lib/folders.js).
   One JSON file per project, named by the project id, holding
   exactly what the browser used to keep in localStorage. A
   small _order.json remembers the manual drag order of the
   Projects page.

     GET    /            all projects + order
     PUT    /order       { ids: [...] }
     PUT    /:id         save (create or replace) one project
     DELETE /:id         move the file to the folder's _trash
     POST   /:id/share   { email, project } copy it to another person

   Only the owner can reach their folder: the folder comes from
   the session, never from the request. Calculators-only levels
   (Manufacturer) get no projects at all. Sharing is the one write
   into someone else's folder, and it only ever adds a new file.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../lib/config');
const db = require('../lib/db');
const auth = require('../lib/auth');
const folders = require('../lib/folders');
const templates = require('../lib/templates');
const log = require('../lib/log');

const router = express.Router();
router.use(auth.requireProjects);

const ID_RE = /^[A-Za-z0-9_-]{4,80}$/;
const ORDER_FILE = '_order.json';
const MAX_BYTES = 2 * 1024 * 1024;

/** The caller's project folder, created (or moved into place) on first use. */
function userDir(req) {
    const name = folders.ensureFolder(req.user);
    if (!req.user.project_folder) {
        db.setProjectFolder(req.user.id, name);
        req.user.project_folder = name;
    }
    return folders.folderPath(req.user);
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Write to a temp file and rename, so a crash mid-write never leaves a half file. */
function writeJsonAtomic(file, data) {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file);
}

router.get('/', (req, res) => {
    const dir = userDir(req);
    const projects = [];
    let order = [];
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        const file = path.join(dir, name);
        try {
            if (name === ORDER_FILE) {
                const o = readJson(file);
                order = Array.isArray(o.ids) ? o.ids.filter((id) => ID_RE.test(String(id))) : [];
            } else {
                const p = readJson(file);
                if (p && p.id && name === p.id + '.json') projects.push(p);
            }
        } catch (e) {
            log.warn(`Unreadable project file skipped: ${file}: ${e.message}`);
        }
    }
    res.json({ projects, order });
});

router.put('/order', (req, res) => {
    const ids = req.body && req.body.ids;
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && ID_RE.test(id))) {
        return res.status(400).json({ error: 'Bad order list.' });
    }
    writeJsonAtomic(path.join(userDir(req), ORDER_FILE), { ids });
    res.json({ ok: true });
});

router.put('/:id', (req, res) => {
    const id = req.params.id;
    const project = req.body;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad project id.' });
    if (!project || typeof project !== 'object' || project.id !== id) {
        return res.status(400).json({ error: 'Project id does not match.' });
    }
    if (typeof project.name !== 'string' || !project.name.trim()) {
        return res.status(400).json({ error: 'Project needs a name.' });
    }
    if (!Array.isArray(project.items)) project.items = [];
    const size = Buffer.byteLength(JSON.stringify(project));
    if (size > MAX_BYTES) return res.status(413).json({ error: 'Project is too large to save.' });

    writeJsonAtomic(path.join(userDir(req), id + '.json'), project);
    res.json({ ok: true, updatedAt: project.updatedAt || null });
});

router.delete('/:id', (req, res) => {
    const id = req.params.id;
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad project id.' });
    const dir = userDir(req);
    const file = path.join(dir, id + '.json');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'Project not found.' });

    const trash = path.join(dir, '_trash');
    fs.mkdirSync(trash, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(file, path.join(trash, `${id}.${stamp}.json`));
    log.info('Project deleted (moved to _trash)', { email: req.user.email, id });
    res.json({ ok: true });
});

// ---- Sharing -------------------------------------------------------
// A share drops a COPY of the project into the other person's folder:
// a new id and file of its own, with no link back, so later edits on
// either side stay apart. The browser sends the project as it has it
// (its saves may still be on the way). The copy carries
//   sharedBy  { name, email, at }  who sent it, shown on its card
//   sharedNew true                 lights the Projects tile badge until
//                                  the recipient opens Projects (the
//                                  site clears it with a normal save)

function displayName(user) {
    return `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;
}

/** A project id like the site's own (proj_<time>_<n>), unused in dir. */
function newProjectId(dir) {
    let id;
    do {
        id = `proj_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    } while (fs.existsSync(path.join(dir, id + '.json')));
    return id;
}

router.post('/:id/share', (req, res) => {
    const id = req.params.id;
    const body = req.body || {};
    const project = body.project;
    const email = db.normalizeEmail(body.email);
    if (!ID_RE.test(id)) return res.status(400).json({ error: 'Bad project id.' });
    if (!project || typeof project !== 'object' || project.id !== id ||
        typeof project.name !== 'string' || !project.name.trim()) {
        return res.status(400).json({ error: 'Project id does not match.' });
    }
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Enter an email address.' });
    if (Buffer.byteLength(JSON.stringify(project)) > MAX_BYTES) {
        return res.status(413).json({ error: 'Project is too large to share.' });
    }

    // Only someone who has finished registering, and whose level has
    // projects at all, can receive one.
    const target = db.getUserByEmail(email);
    if (!target || target.status !== 'active' || auth.isCalculatorsOnly(target.user_level)) {
        return res.status(404).json({
            error: `${email} is not an active HHpro account, so this project can't be shared with them.`,
            code: 'no_account'
        });
    }
    if (target.id === req.user.id) {
        return res.status(400).json({ error: 'That is your own account.', code: 'self' });
    }

    const leaf = folders.ensureFolder(target);
    if (!target.project_folder) {
        db.setProjectFolder(target.id, leaf);
        target.project_folder = leaf;
    }
    const dir = folders.folderPath(target);

    const at = new Date().toISOString();
    const copy = JSON.parse(JSON.stringify(project));
    copy.id = newProjectId(dir);
    if (!Array.isArray(copy.items)) copy.items = [];
    // A firm layout the recipient can't use falls back to their own default.
    if (!templates.allowedEngineersFor(target).includes(copy.engineer)) {
        copy.engineer = templates.defaultEngineerFor(target);
    }
    copy.createdAt = at;
    copy.updatedAt = at;
    copy.sharedBy = { name: displayName(req.user), email: req.user.email, at };
    copy.sharedNew = true;

    writeJsonAtomic(path.join(dir, copy.id + '.json'), copy);
    log.info('Project shared (copied)', { from: req.user.email, to: target.email, id, copy: copy.id });
    res.json({ ok: true });
});

module.exports = router;
