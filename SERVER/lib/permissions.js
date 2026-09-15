/* ============================================================
   HHpro backend - Location permissions
   ------------------------------------------------------------
   Reads the "Permissions" tab of Users/HHpro - Users &
   Permissions.xlsx. Only Eric edits that tab, in Excel. This
   module never writes it.

   Layout of the tab:
     Row 1:  PRODUCT LINE | <location> | <location> | ...
     Rows:   <product display name> | Yes/No | Yes/No | ...
   A blank cell means Yes. A product is hidden for a location
   only where the cell says No.

   The file is re-read whenever it changes on disk (Excel saves
   by writing a temp file and renaming it, so polling is the
   reliable way to notice that on Windows). If the file cannot
   be read, the last good copy stays in effect.
   ============================================================ */

'use strict';

const fs = require('fs');
const ExcelJS = require('exceljs');
const config = require('./config');
const log = require('./log');

let current = {
    loadedAt: null,
    locations: [],
    products: [],        // [{ name, byLocation: { 'Charlotte, NC': true, ... } }]
    error: null
};

function cellText(cell) {
    const v = cell && cell.value;
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && v.richText) return v.richText.map((r) => r.text).join('').trim();
    if (typeof v === 'object' && v.result !== undefined) return String(v.result).trim();
    return String(v).trim();
}

function isNo(text) {
    return /^n(o)?$/i.test(text);
}

async function parse() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(config.excelFile);
    const ws = wb.getWorksheet(config.permissionsSheet);
    if (!ws) throw new Error(`Sheet "${config.permissionsSheet}" not found in ${config.excelFile}`);

    const header = ws.getRow(1);
    const locations = [];
    const columns = [];   // { col, location }
    for (let c = 2; c <= ws.columnCount; c++) {
        const name = cellText(header.getCell(c));
        if (!name) continue;
        if (locations.includes(name)) {
            log.warn(`Permissions tab lists "${name}" twice; using the first column`);
            continue;
        }
        locations.push(name);
        columns.push({ col: c, location: name });
    }

    const products = [];
    for (let r = 2; r <= ws.rowCount; r++) {
        const row = ws.getRow(r);
        const name = cellText(row.getCell(1));
        if (!name) continue;
        const byLocation = {};
        for (const { col, location } of columns) {
            byLocation[location] = !isNo(cellText(row.getCell(col)));
        }
        products.push({ name, byLocation });
    }

    return { loadedAt: new Date().toISOString(), locations, products, error: null };
}

async function reload(reason) {
    try {
        const next = await parse();
        current = next;
        log.info(`Permissions loaded (${reason})`, {
            locations: next.locations.length,
            products: next.products.length
        });
    } catch (e) {
        current = Object.assign({}, current, { error: e.message });
        log.error(`Permissions reload failed (${reason}): ${e.message}`);
    }
    return current;
}

let watching = false;
function watch() {
    if (watching) return;
    watching = true;
    let timer = null;
    fs.watchFile(config.excelFile, { interval: 15000 }, (curr, prev) => {
        if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) return;
        clearTimeout(timer);
        // Give Excel a moment to finish its save-and-rename.
        timer = setTimeout(() => reload('file changed'), 3000);
    });
}

function getPermissions() {
    return current;
}

function getLocations() {
    return current.locations.slice();
}

/** True unless the Permissions tab says No for this product at this location. */
function isProductAllowed(productName, location) {
    const product = current.products.find((p) => p.name === productName);
    if (!product) return true;                       // product not on the tab: visible
    if (!(location in product.byLocation)) return true;  // location not on the tab: visible
    return product.byLocation[location];
}

/**
 * Products hidden for someone who belongs to these locations: a product
 * is hidden only if every one of their locations says No. Someone with
 * no locations on file sees everything, the same as an unknown location.
 */
function blockedProductsFor(locations) {
    const list = Array.isArray(locations) ? locations.filter(Boolean) : [];
    if (!list.length) return [];
    return current.products
        .filter((p) => list.every((loc) => !isProductAllowed(p.name, loc)))
        .map((p) => p.name);
}

/** Product names visible for a location (Super Admins bypass this). */
function allowedProductsFor(location) {
    return current.products.filter((p) => isProductAllowed(p.name, location)).map((p) => p.name);
}

module.exports = {
    reload,
    watch,
    getPermissions,
    getLocations,
    isProductAllowed,
    blockedProductsFor,
    allowedProductsFor
};
