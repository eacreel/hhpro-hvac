/* ============================================================
   HHpro - asset index (run by the Cloudflare Pages build)
   ------------------------------------------------------------
   Lists every file under ASSETS/ into DATA/asset_index.json, so
   the site knows which documents really exist before offering
   them (JS/docs.js): the Excel workbooks can name a submittal,
   CAD or manual before its file is added, and on Cloudflare a
   missing file answers with the site's home page, not a 404.

   Cloudflare Pages build command (Settings > Build):
       node "DATA/DATA FILES/build_asset_index.js" && rm -rf "DATA/DATA FILES"
   The index is then written from exactly the files being
   deployed, every deploy. It is git-ignored - never commit it
   (a stale copy would hide newly added files). Without it the
   site checks each document with a request instead.

   Output: { "generatedAt": ..., "fileCount": N,
             "folders": { "ASSETS/MINI SPLITS/SUBMITTALS": ["2MXM18AVJU8.pdf", ...] } }
   Run by hand (from the repo root or anywhere):
       node "DATA/DATA FILES/build_asset_index.js"
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'ASSETS');
const OUT = path.join(ROOT, 'DATA', 'asset_index.json');

const folders = {};
let count = 0;

function walk(dir, rel) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
        return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name.startsWith('~$')) continue;
        const full = path.join(dir, entry.name);
        const relPath = rel + '/' + entry.name;
        if (entry.isDirectory()) {
            walk(full, relPath);
        } else if (entry.isFile()) {
            (folders[rel] = folders[rel] || []).push(entry.name);
            count++;
        }
    }
}

if (!fs.existsSync(ASSETS)) {
    console.error('build_asset_index: no ASSETS folder at ' + ASSETS);
    process.exit(1);
}

walk(ASSETS, 'ASSETS');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    fileCount: count,
    folders: folders
}));
console.log('build_asset_index: ' + count + ' files in ' +
    Object.keys(folders).length + ' folders -> ' + path.relative(ROOT, OUT));
