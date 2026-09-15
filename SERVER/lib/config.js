/* ============================================================
   HHpro backend - Configuration
   ------------------------------------------------------------
   Reads SERVER/.env (git-ignored) and exposes typed settings.
   Every path is resolved from the HHpro folder, never from the
   current working directory, so the service behaves the same
   whether started by hand or by Windows.

   Keys in .env:
     PORT            port the backend listens on (default 8787,
                     which is what the Cloudflare Tunnel forwards to)
     SESSION_SECRET  random string used to sign session cookies.
                     Generated once during setup. Changing it signs
                     everyone out.
     ALLOWED_ORIGINS comma-separated list of site origins allowed to
                     call the API (default https://hhpro-hvac.com)
     SUPER_ADMIN     email of the site owner. Used as "created by"
                     for imported users and as the contact address
                     shown to users who need a new location.
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');

// SERVER/ is one level below the HHpro folder.
const SERVER_DIR = path.resolve(__dirname, '..');
const HHPRO_DIR = path.resolve(SERVER_DIR, '..');
const ENV_FILE = path.join(SERVER_DIR, '.env');

if (fs.existsSync(ENV_FILE)) {
    process.loadEnvFile(ENV_FILE);
}

function required(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `Missing ${name} in ${ENV_FILE}. Copy .env.example to .env and fill it in.`
        );
    }
    return value;
}

// HHPRO_USERS_DIR points a test copy of the backend at a separate data
// folder, so test accounts never appear in the live user list.
const USERS_DIR = process.env.HHPRO_USERS_DIR
    ? path.resolve(process.env.HHPRO_USERS_DIR)
    : path.join(HHPRO_DIR, 'Users');

const config = {
    hhproDir: HHPRO_DIR,
    serverDir: SERVER_DIR,

    port: parseInt(process.env.PORT || '8787', 10),
    sessionSecret: required('SESSION_SECRET'),
    superAdminEmail: (process.env.SUPER_ADMIN || 'eric.creel@hoffman-hoffman.com').toLowerCase(),
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://hhpro-hvac.com')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),

    // Everything the backend stores lives under Users/, which is
    // git-ignored so none of it can reach GitHub or the public site.
    usersDir: USERS_DIR,
    dbFile: path.join(USERS_DIR, 'hhpro.db'),
    excelFile: path.join(USERS_DIR, 'HHpro - Users & Permissions.xlsx'),
    projectsDir: path.join(USERS_DIR, 'Projects'),
    backupsDir: path.join(USERS_DIR, 'backups'),
    logsDir: path.join(USERS_DIR, 'logs'),

    // Sheet names inside the Excel file.
    usersSheet: 'Users',
    permissionsSheet: 'Permissions'
};

module.exports = config;
