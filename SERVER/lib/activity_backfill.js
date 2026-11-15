/* ============================================================
   HHpro backend - One-time activity back-fill
   ------------------------------------------------------------
   Schema v5 added two columns to users:
     login_count     sign-ins (password sign-in, registration or
                     password reset - each starts a new session)
     last_active_at  last time the person used the site, to within
                     the 5-minute session refresh

   From v5 on, db.js keeps both up to date. This fills them in
   once for the time before, from what the server already has:
     - the daily logs (Users/logs/backend-YYYY-MM-DD.log, kept since
       Sept 15, 2026): every "Login", "Registered" and "Password
       reset" line counts as a sign-in
     - the sessions table: the latest last_seen per person
   last_active_at is the later of the two, so someone who signed out
   (their session row is gone) still gets their last sign-in.

   Takes the open database handle rather than requiring db.js, which
   calls it from inside open().
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const LOG_FILE_RE = /^backend-\d{4}-\d{2}-\d{2}\.log$/;
const SIGN_IN_RE = /^(\S+)\s+INFO\s+(?:Login|Registered|Password reset)\s+(\{.*\})\s*$/;

/** { email: { count, last } } from every daily log in logsDir. */
function readSignIns(logsDir) {
    const out = {};
    let files = [];
    try {
        files = fs.readdirSync(logsDir).filter((f) => LOG_FILE_RE.test(f));
    } catch (e) {
        return out;   // no logs folder yet
    }
    files.forEach((f) => {
        let text = '';
        try { text = fs.readFileSync(path.join(logsDir, f), 'utf8'); } catch (e) { return; }
        text.split(/\r?\n/).forEach((line) => {
            const m = SIGN_IN_RE.exec(line);
            if (!m) return;
            let email = '';
            try { email = String(JSON.parse(m[2]).email || '').trim().toLowerCase(); } catch (e) { return; }
            if (!email) return;
            const at = m[1];
            const rec = out[email] || (out[email] = { count: 0, last: null });
            rec.count += 1;
            if (!rec.last || at > rec.last) rec.last = at;
        });
    });
    return out;
}

/** Fill login_count and last_active_at for every user. Returns a short summary. */
function backfill(d, logsDir) {
    const signIns = readSignIns(logsDir);
    const lastSeen = {};
    d.prepare('SELECT user_id, MAX(last_seen) AS t FROM sessions GROUP BY user_id').all()
        .forEach((r) => { lastSeen[r.user_id] = r.t; });

    const update = d.prepare('UPDATE users SET login_count = ?, last_active_at = ? WHERE id = ?');
    let people = 0;
    let total = 0;
    d.prepare('SELECT id, email FROM users').all().forEach((u) => {
        const rec = signIns[String(u.email).toLowerCase()] || { count: 0, last: null };
        const seen = lastSeen[u.id] || null;
        const last = [rec.last, seen].filter(Boolean).sort().pop() || null;
        if (rec.count || last) people += 1;
        total += rec.count;
        update.run(rec.count, last, u.id);
    });
    return { people, signIns: total };
}

// ---- v8: daily_active (the Analytics weekly trend) ------------------
// Days before v8 are estimated: a person counts as active on a day they
// signed in (logs), or created, saved or added an item to a project
// (dates inside their saved project files), plus their current last
// active / session dates. Days they only browsed are missing, so the
// early weeks read low; the Analytics tab says so.

/** YYYY-MM-DD in the server's local time, or null. */
function localDay(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    const two = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** Every saved project file, as { leaf: [project, ...] } by owner folder name. */
function readProjectsByLeaf(projectsDir) {
    const out = {};
    function walk(dir) {
        let entries = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
        entries.forEach((ent) => {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                if (ent.name === '_trash' || ent.name.startsWith('_deleted_')) return;
                walk(full);
            } else if (ent.name.endsWith('.json') && !ent.name.startsWith('_')) {
                try {
                    const p = JSON.parse(fs.readFileSync(full, 'utf8'));
                    const leaf = path.basename(dir);
                    (out[leaf] || (out[leaf] = [])).push(p);
                } catch (e) { /* unreadable: skip */ }
            }
        });
    }
    walk(projectsDir);
    return out;
}

function backfillDays(d, logsDir, projectsDir) {
    const days = {};   // user id -> { day: true }
    function add(userId, iso) {
        const day = iso && localDay(iso);
        if (!day) return;
        (days[userId] || (days[userId] = {}))[day] = true;
    }
    const users = d.prepare('SELECT id, email, project_folder, last_active_at FROM users').all();
    const byEmail = {};
    users.forEach((u) => { byEmail[String(u.email).toLowerCase()] = u.id; add(u.id, u.last_active_at); });

    // Sign-ins, one day per line.
    let files = [];
    try { files = fs.readdirSync(logsDir).filter((f) => LOG_FILE_RE.test(f)); } catch (e) { /* no logs */ }
    files.forEach((f) => {
        let text = '';
        try { text = fs.readFileSync(path.join(logsDir, f), 'utf8'); } catch (e) { return; }
        text.split(/\r?\n/).forEach((line) => {
            const m = SIGN_IN_RE.exec(line);
            if (!m) return;
            let email = '';
            try { email = String(JSON.parse(m[2]).email || '').trim().toLowerCase(); } catch (e) { return; }
            if (byEmail[email]) add(byEmail[email], m[1]);
        });
    });

    // Sessions (created and last seen).
    d.prepare('SELECT user_id, created_at, last_seen FROM sessions').all().forEach((s) => {
        add(s.user_id, s.created_at);
        add(s.user_id, s.last_seen);
    });

    // Saved projects: created, last saved, and each item's added date.
    const projects = readProjectsByLeaf(projectsDir);
    users.forEach((u) => {
        (projects[u.project_folder] || []).forEach((p) => {
            add(u.id, p.createdAt);
            add(u.id, p.updatedAt);
            // A shared copy's items were added by the sender, not the owner.
            if (p.sharedBy) return;
            (Array.isArray(p.items) ? p.items : []).forEach((it) => add(u.id, it && it.addedAt));
        });
    });

    const insert = d.prepare('INSERT OR IGNORE INTO daily_active (user_id, day) VALUES (?, ?)');
    let rows = 0;
    Object.keys(days).forEach((id) => {
        Object.keys(days[id]).forEach((day) => { insert.run(Number(id), day); rows += 1; });
    });
    return { people: Object.keys(days).length, days: rows };
}

module.exports = { backfill, backfillDays, readSignIns };
