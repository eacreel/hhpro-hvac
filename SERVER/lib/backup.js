/* ============================================================
   HHpro backend - Backups and housekeeping
   ------------------------------------------------------------
   Two jobs, run by the scheduler in server.js (or by hand with
   `npm run backup -- daily|weekly`):

     daily   (02:00)  the data that changes every day:
                        - the users database (a consistent copy
                          made with VACUUM INTO, safe while live)
                        - the Users & Permissions spreadsheet
                        - every project folder under Users/Projects
                      -> <BACKUP_DIR>/daily/hhpro-data-YYYY-MM-DD.zip
                      keeps the newest 30.
                      Also tidies up: project files in _trash and
                      _deleted_ user folders older than 30 days are
                      removed, as the privacy page promises.

     weekly  (Sunday 03:00)  the site itself (index.html, CSS, JS,
                      DATA, SERVER code) -> <BACKUP_DIR>/weekly/
                      hhpro-site-YYYY-MM-DD.zip, keeps the newest 4.
                      ASSETS (3 GB of CAD and PDFs) is left out
                      unless BACKUP_SITE_INCLUDE_ASSETS=true; every
                      site file is also in the GitHub repo.

   BACKUP_DIR defaults to Users/backups on this machine. Point it
   at a network share in .env to get copies off the server.

   Zips are made with the tar.exe that ships with Windows.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');
const db = require('./db');
const log = require('./log');

const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const DAILY_KEEP = 30;
const WEEKLY_KEEP = 4;
const TRASH_DAYS = 30;

const backupDir = process.env.BACKUP_DIR
    ? path.resolve(process.env.BACKUP_DIR)
    : config.backupsDir;
const includeAssets = /^(1|true|yes)$/i.test(process.env.BACKUP_SITE_INCLUDE_ASSETS || '');
const stateFile = path.join(config.backupsDir, 'backup-state.json');

function readState() {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (e) { return {}; }
}

function writeState(patch) {
    const next = Object.assign(readState(), patch);
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(next, null, 2));
    return next;
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function zipDirectory(sourceDir, zipFile, excludes) {
    fs.mkdirSync(path.dirname(zipFile), { recursive: true });
    if (fs.existsSync(zipFile)) fs.unlinkSync(zipFile);
    const args = ['-a', '-c', '-f', zipFile];
    (excludes || []).forEach((e) => args.push('--exclude', e));
    args.push('-C', sourceDir, '.');
    execFileSync(TAR, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    return fs.statSync(zipFile).size;
}

function prune(dir, prefix, keep) {
    if (!fs.existsSync(dir)) return 0;
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.zip')).sort();
    let removed = 0;
    while (files.length > keep) {
        fs.unlinkSync(path.join(dir, files.shift()));
        removed++;
    }
    return removed;
}

function copyDir(from, to) {
    fs.cpSync(from, to, { recursive: true });
}

// ---- daily ---------------------------------------------------------

function runDaily() {
    const started = Date.now();
    const stamp = today();
    const staging = path.join(config.backupsDir, `_staging-daily-${process.pid}`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
        // Consistent copy of the live database.
        const dbCopy = path.join(staging, 'hhpro.db');
        db.open().exec(`VACUUM INTO '${dbCopy.replace(/'/g, "''")}'`);

        if (fs.existsSync(config.excelFile)) {
            fs.copyFileSync(config.excelFile, path.join(staging, path.basename(config.excelFile)));
        }
        if (fs.existsSync(config.projectsDir)) {
            copyDir(config.projectsDir, path.join(staging, 'Projects'));
        }

        const zip = path.join(backupDir, 'daily', `hhpro-data-${stamp}.zip`);
        const bytes = zipDirectory(staging, zip);
        const pruned = prune(path.join(backupDir, 'daily'), 'hhpro-data-', DAILY_KEEP);
        const tidied = tidyTrash();

        const result = { at: new Date().toISOString(), file: zip, bytes, pruned, tidied, ok: true };
        writeState({ lastDaily: result });
        log.info('Daily backup done', { file: zip, mb: +(bytes / 1048576).toFixed(1), pruned, tidied, ms: Date.now() - started });
        return result;
    } catch (e) {
        const result = { at: new Date().toISOString(), ok: false, error: e.message };
        writeState({ lastDaily: result });
        log.error(`Daily backup failed: ${e.message}`);
        return result;
    } finally {
        fs.rmSync(staging, { recursive: true, force: true });
    }
}

/**
 * Remove trashed projects and set-aside user folders older than
 * TRASH_DAYS. Walks the whole Projects tree, so it finds every
 * person's _trash whether they sit under Hoffman/, Engineers/<Company>/
 * or Contractors/<Company>/.
 */
function tidyTrash() {
    if (!fs.existsSync(config.projectsDir)) return 0;
    const cutoff = Date.now() - TRASH_DAYS * 24 * 60 * 60 * 1000;
    let removed = 0;

    function walk(dir, depth) {
        let names;
        try { names = fs.readdirSync(dir); } catch (e) { return; }
        for (const name of names) {
            const full = path.join(dir, name);
            let stat;
            try { stat = fs.statSync(full); } catch (e) { continue; }
            if (!stat.isDirectory()) continue;

            if (name.startsWith('_deleted_')) {
                if (stat.mtimeMs < cutoff) {
                    fs.rmSync(full, { recursive: true, force: true });
                    removed++;
                }
                continue;
            }
            if (name === '_trash') {
                for (const f of fs.readdirSync(full)) {
                    const file = path.join(full, f);
                    try {
                        if (fs.statSync(file).mtimeMs < cutoff) { fs.unlinkSync(file); removed++; }
                    } catch (e) { /* skip */ }
                }
                continue;
            }
            if (depth < 4) walk(full, depth + 1);
        }
    }
    walk(config.projectsDir, 0);
    return removed;
}

// ---- weekly --------------------------------------------------------

function runWeekly() {
    const started = Date.now();
    const stamp = today();
    try {
        const excludes = ['./Users', './.git', './.claude', './SERVER/node_modules', './SERVER/.env'];
        if (!includeAssets) excludes.push('./ASSETS');
        const zip = path.join(backupDir, 'weekly', `hhpro-site-${stamp}.zip`);
        const bytes = zipDirectory(config.hhproDir, zip, excludes);
        const pruned = prune(path.join(backupDir, 'weekly'), 'hhpro-site-', WEEKLY_KEEP);
        const result = { at: new Date().toISOString(), file: zip, bytes, pruned, includeAssets, ok: true };
        writeState({ lastWeekly: result });
        log.info('Weekly site backup done', { file: zip, mb: +(bytes / 1048576).toFixed(1), pruned, ms: Date.now() - started });
        return result;
    } catch (e) {
        const result = { at: new Date().toISOString(), ok: false, error: e.message };
        writeState({ lastWeekly: result });
        log.error(`Weekly backup failed: ${e.message}`);
        return result;
    }
}

// ---- scheduler -----------------------------------------------------

const DAILY_HOUR = 2;      // 02:00 local
const WEEKLY_HOUR = 3;     // 03:00 local
const WEEKLY_DAY = 0;      // Sunday

let running = false;

/**
 * Called every few minutes by server.js. Runs a job once its time has
 * passed today (or this week) and it has not run yet, so a server that
 * was off at 02:00 catches up as soon as it is back.
 */
function tick() {
    if (running) return;
    const now = new Date();
    const state = readState();
    const stamp = today();

    const lastDailyDay = state.lastDaily && state.lastDaily.at ? state.lastDaily.at.slice(0, 10) : '';
    if (now.getHours() >= DAILY_HOUR && lastDailyDay !== stamp) {
        running = true;
        try { runDaily(); } finally { running = false; }
    }

    const lastWeeklyAt = state.lastWeekly && state.lastWeekly.at ? new Date(state.lastWeekly.at).getTime() : 0;
    const weekOld = Date.now() - lastWeeklyAt > 6.5 * 24 * 60 * 60 * 1000;
    if (now.getDay() === WEEKLY_DAY && now.getHours() >= WEEKLY_HOUR && weekOld) {
        running = true;
        try { runWeekly(); } finally { running = false; }
    }
}

function status() {
    const s = readState();
    return { backupDir, lastDaily: s.lastDaily || null, lastWeekly: s.lastWeekly || null, includeAssets };
}

module.exports = { runDaily, runWeekly, tidyTrash, tick, status, backupDir };
