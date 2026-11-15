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

module.exports = { backfill, readSignIns };
