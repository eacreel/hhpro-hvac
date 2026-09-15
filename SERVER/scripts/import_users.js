/* ============================================================
   HHpro backend - One-time import of the Users tab
   ------------------------------------------------------------
   Reads every row of the "Users" tab in the Excel file into the
   database as an Invited account, with the super admin recorded
   as the person who added them. Rows whose email already exists
   are skipped, so running it twice is harmless.

   Afterwards the Users tab is rewritten from the database so
   the file gains its STATUS and ADDED BY columns.

   Run from the SERVER folder:   npm run import-users
   ============================================================ */

'use strict';

const config = require('../lib/config');
const db = require('../lib/db');
const usersExcel = require('../lib/users_excel');

async function main() {
    const rows = await usersExcel.readUsersTab();
    console.log(`Users tab: ${rows.length} rows`);

    let added = 0, skipped = 0, failed = 0;
    for (const r of rows) {
        const email = db.normalizeEmail(r.email);
        if (db.getUserByEmail(email)) {
            skipped++;
            continue;
        }
        try {
            db.insertUser({
                email,
                firstName: r.firstName,
                lastName: r.lastName,
                company: r.company,
                location: r.location,
                userLevel: r.userLevel,
                createdBy: config.superAdminEmail
            });
            added++;
        } catch (e) {
            failed++;
            console.error(`  Skipped ${r.email}: ${e.message}`);
        }
    }
    console.log(`Added ${added}, already present ${skipped}, failed ${failed}. Database now has ${db.countUsers()} users.`);

    const n = await usersExcel.writeUsersTab();
    console.log(`Users tab rewritten with ${n} users (backup kept in Users/backups/excel).`);
}

main().catch((e) => {
    console.error(`Import failed: ${e.message}`);
    process.exit(1);
});
