/* ============================================================
   HHpro backend - Users tab of the Excel file
   ------------------------------------------------------------
   Two jobs, each one direction:

     readUsersTab()   used once, by scripts/import_users.js, to
                      bring the spreadsheet into the database.

     syncUsersTab()   rewrites the "Users" tab from the database
                      so the file always matches the site. Called
                      after every user change. Hand edits to that
                      tab are overwritten; the Permissions tab is
                      never touched.

   Windows locks the file while it is open in Excel. A blocked
   write is retried every minute until it succeeds. The database
   stays correct the whole time; only the file copy lags.

   Before every write the current file is copied to
   Users/backups/excel/ and the newest 10 copies are kept.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const config = require('./config');
const log = require('./log');
const db = require('./db');

const HEADERS = ['FIRST NAME', 'LAST NAME', 'COMPANY', 'LOCATION', 'USER LEVEL', 'USERNAME', 'STATUS', 'ADDED BY'];
const BACKUPS_TO_KEEP = 10;
const RETRY_MS = 60 * 1000;

function cellText(cell) {
    const v = cell && cell.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && v.richText) return v.richText.map((r) => r.text).join('').trim();
    if (typeof v === 'object' && v.text !== undefined) return String(v.text).trim();   // hyperlink cells
    if (typeof v === 'object' && v.result !== undefined) return String(v.result).trim();
    return String(v).trim();
}

/**
 * Read the Users tab as it was laid out by hand:
 *   FIRST NAME | LAST NAME | COMPANY | LOCATION | USER LEVEL | USERNAME
 * Columns are located by header text, so column order does not matter.
 */
async function readUsersTab() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(config.excelFile);
    const ws = wb.getWorksheet(config.usersSheet);
    if (!ws) throw new Error(`Sheet "${config.usersSheet}" not found in ${config.excelFile}`);

    const header = ws.getRow(1);
    const col = {};
    for (let c = 1; c <= ws.columnCount; c++) {
        const name = cellText(header.getCell(c)).toUpperCase();
        if (name) col[name] = c;
    }
    for (const needed of ['FIRST NAME', 'LAST NAME', 'COMPANY', 'LOCATION', 'USER LEVEL', 'USERNAME']) {
        if (!col[needed]) throw new Error(`Users tab is missing a "${needed}" column`);
    }

    const rows = [];
    for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const email = cellText(row.getCell(col['USERNAME']));
        if (!email) continue;
        rows.push({
            firstName: cellText(row.getCell(col['FIRST NAME'])),
            lastName: cellText(row.getCell(col['LAST NAME'])),
            company: cellText(row.getCell(col['COMPANY'])),
            location: cellText(row.getCell(col['LOCATION'])),
            userLevel: cellText(row.getCell(col['USER LEVEL'])),
            email: email
        });
    }
    return rows;
}

function backupExcel() {
    const dir = path.join(config.backupsDir, 'excel');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(config.excelFile, path.join(dir, `Users & Permissions ${stamp}.xlsx`));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.xlsx')).sort();
    while (files.length > BACKUPS_TO_KEEP) {
        fs.unlinkSync(path.join(dir, files.shift()));
    }
}

function statusLabel(status) {
    return status === 'active' ? 'Active' : 'Invited';
}

async function writeUsersTab() {
    const users = db.listUsers();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(config.excelFile);
    let ws = wb.getWorksheet(config.usersSheet);
    if (!ws) ws = wb.addWorksheet(config.usersSheet);

    // Header row. Bold, like the hand-made sheet.
    const header = ws.getRow(1);
    HEADERS.forEach((h, i) => {
        const cell = header.getCell(i + 1);
        cell.value = h;
        cell.font = Object.assign({}, cell.font || {}, { bold: true });
    });
    for (let c = HEADERS.length + 1; c <= ws.columnCount; c++) header.getCell(c).value = null;

    // Data rows.
    users.forEach((u, i) => {
        const row = ws.getRow(i + 2);
        const values = [u.first_name, u.last_name, u.company, u.location, u.user_level,
            u.email, statusLabel(u.status), u.created_by];
        values.forEach((v, c) => { row.getCell(c + 1).value = v; });
        for (let c = HEADERS.length + 1; c <= ws.columnCount; c++) row.getCell(c).value = null;
    });

    // Clear anything left over from a longer previous list.
    for (let r = users.length + 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= ws.columnCount; c++) row.getCell(c).value = null;
    }

    // Widen columns so the sheet reads well when opened.
    const widths = [14, 14, 18, 20, 14, 38, 10, 38];
    widths.forEach((w, i) => {
        const column = ws.getColumn(i + 1);
        if (!column.width || column.width < w) column.width = w;
    });

    backupExcel();
    await wb.xlsx.writeFile(config.excelFile);
    return users.length;
}

// ---- retrying sync ------------------------------------------------

let dirty = false;
let running = false;
let retryTimer = null;
let lastSync = { at: null, ok: null, error: null };

function isLockError(e) {
    return e && (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES');
}

async function runSync() {
    if (running) return;
    running = true;
    clearTimeout(retryTimer);
    try {
        while (dirty) {
            dirty = false;
            const n = await writeUsersTab();
            lastSync = { at: new Date().toISOString(), ok: true, error: null };
            log.info(`Users tab written (${n} users)`);
        }
    } catch (e) {
        dirty = true;
        lastSync = { at: new Date().toISOString(), ok: false, error: e.message };
        if (isLockError(e)) {
            log.warn(`Users tab write blocked (file open in Excel?); retrying in ${RETRY_MS / 1000}s`);
        } else {
            log.error(`Users tab write failed: ${e.message}; retrying in ${RETRY_MS / 1000}s`);
        }
        retryTimer = setTimeout(runSync, RETRY_MS);
    } finally {
        running = false;
    }
}

/** Mark the Users tab out of date and write it as soon as the file is free. */
function syncUsersTab() {
    dirty = true;
    return runSync();
}

function getSyncStatus() {
    return Object.assign({ pending: dirty }, lastSync);
}

module.exports = {
    HEADERS,
    readUsersTab,
    writeUsersTab,
    syncUsersTab,
    getSyncStatus
};
