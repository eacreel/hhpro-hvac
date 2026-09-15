/* ============================================================
   HHpro backend - Rewrite the Users tab from the database
   ------------------------------------------------------------
   The running backend does this automatically after every user
   change. This script does it on demand, for example after
   restoring the database from a backup.

   Run from the SERVER folder:   npm run sync-excel
   ============================================================ */

'use strict';

const usersExcel = require('../lib/users_excel');

usersExcel.writeUsersTab()
    .then((n) => console.log(`Users tab rewritten with ${n} users.`))
    .catch((e) => {
        console.error(`Sync failed: ${e.message}`);
        if (e.code === 'EBUSY' || e.code === 'EPERM') {
            console.error('The file is probably open in Excel. Close it and run this again.');
        }
        process.exit(1);
    });
