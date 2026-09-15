/* ============================================================
   HHpro backend - Logging
   ------------------------------------------------------------
   Writes one line per event to the console and to a daily log
   file under Users/logs/. The Windows service captures the
   console too, so nothing is lost either way.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

function stamp() {
    return new Date().toISOString();
}

function fileFor(date) {
    return path.join(config.logsDir, `backend-${date.toISOString().slice(0, 10)}.log`);
}

function write(level, message, extra) {
    const line = `${stamp()} ${level.padEnd(5)} ${message}` +
        (extra ? ' ' + JSON.stringify(extra) : '');
    if (level === 'ERROR') console.error(line); else console.log(line);
    try {
        fs.mkdirSync(config.logsDir, { recursive: true });
        fs.appendFileSync(fileFor(new Date()), line + '\n');
    } catch (e) {
        // Logging must never take the service down.
    }
}

module.exports = {
    info: (message, extra) => write('INFO', message, extra),
    warn: (message, extra) => write('WARN', message, extra),
    error: (message, extra) => write('ERROR', message, extra)
};
