/* ============================================================
   HHpro backend - Entry point
   ------------------------------------------------------------
   Express app that the site at hhpro-hvac.com talks to through
   api.hhpro-hvac.com. Cloudflare Tunnel forwards that hostname
   to this process on 127.0.0.1:8787, so the port is never open
   to the network directly.

   Phase 1 (this file): health check, permissions loaded from the
   Excel file and kept fresh, database created. Accounts, the
   Users screen and saved projects arrive in later phases as
   separate route modules under routes/.
   ============================================================ */

'use strict';

const fs = require('fs');
const express = require('express');
const config = require('./lib/config');
const log = require('./lib/log');
const db = require('./lib/db');
const permissions = require('./lib/permissions');
const usersExcel = require('./lib/users_excel');
const pkg = require('./package.json');

const app = express();
app.disable('x-powered-by');
// Cloudflare sits in front; trust its forwarded headers for req.ip.
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));

// ---- CORS ----------------------------------------------------------
// Only the site itself may call the API from a browser, and it may
// send the session cookie when it does.
app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// ---- Routes --------------------------------------------------------

app.get('/health', (req, res) => {
    const perms = permissions.getPermissions();
    res.json({
        ok: true,
        service: 'hhpro-backend',
        version: pkg.version,
        time: new Date().toISOString(),
        uptimeSeconds: Math.round(process.uptime()),
        permissions: {
            loadedAt: perms.loadedAt,
            locations: perms.locations.length,
            products: perms.products.length,
            error: perms.error
        },
        excelSync: usersExcel.getSyncStatus()
    });
});

app.get('/', (req, res) => {
    res.type('text').send('HHpro backend is running.');
});

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    log.error(`Unhandled error on ${req.method} ${req.path}: ${err.message}`);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Server error' });
});

// ---- Start ---------------------------------------------------------

async function start() {
    for (const dir of [config.usersDir, config.projectsDir, config.backupsDir, config.logsDir]) {
        fs.mkdirSync(dir, { recursive: true });
    }
    db.open();
    log.info(`Database open: ${config.dbFile} (${db.countUsers()} users)`);

    await permissions.reload('startup');
    permissions.watch();

    const server = app.listen(config.port, '127.0.0.1', () => {
        log.info(`HHpro backend ${pkg.version} listening on http://127.0.0.1:${config.port}`);
    });

    function shutdown(signal) {
        log.info(`${signal} received, shutting down`);
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    }
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((e) => {
    log.error(`Startup failed: ${e.message}`);
    process.exit(1);
});
