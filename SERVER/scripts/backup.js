/* ============================================================
   HHpro backend - Run a backup by hand
   ------------------------------------------------------------
   The running service does these on its own (daily at 02:00,
   weekly on Sunday at 03:00). This is for running one now, for
   example before a change to the server.

   From the SERVER folder:
     npm run backup            daily data backup
     npm run backup -- weekly  weekly site backup
   ============================================================ */

'use strict';

const backup = require('../lib/backup');

const which = (process.argv[2] || 'daily').toLowerCase();
const result = which === 'weekly' ? backup.runWeekly() : backup.runDaily();
if (result.ok) {
    const size = result.bytes < 1048576 ? `${Math.max(1, Math.round(result.bytes / 1024))} KB` : `${(result.bytes / 1048576).toFixed(1)} MB`;
    console.log(`${which} backup written: ${result.file} (${size})`);
    if (result.pruned) console.log(`Removed ${result.pruned} old backup(s).`);
    if (result.tidied) console.log(`Cleared ${result.tidied} trashed item(s) older than 30 days.`);
} else {
    console.error(`${which} backup failed: ${result.error}`);
    process.exit(1);
}
