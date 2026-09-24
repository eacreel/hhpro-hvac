# HHpro backend

The small server program behind hhpro-hvac.com. It handles accounts,
location permissions, and saved projects. It runs on the Hoffman &
Hoffman server as a Windows service and is reached through
Cloudflare Tunnel at https://api.hhpro-hvac.com.

The site itself is still plain files served by Cloudflare Pages. This
folder is deployed with the repo but is not part of the site; the
`_redirects` file at the repo root sends anyone browsing to /SERVER
back to the home page.

## Where things live on the server

| What | Where |
| --- | --- |
| This code | `C:\ProgramData\HHpro\SERVER` |
| Settings and secret | `SERVER\.env` (git-ignored, copy of `.env.example`) |
| Database | `Users\hhpro.db` |
| Excel file (Users and Permissions tabs) | `Users\HHpro - Users & Permissions.xlsx` |
| Saved projects | `Users\Projects\Hoffman\<person>\`, `Users\Projects\Engineers\<Company>\<person>\`, `Users\Projects\Contractors\<Company>\<person>\`, `Users\Projects\Manufacturers\<Company>\<person>\` (Manufacturers see only the Calculators, so theirs stay empty) |
| Logs | `Users\logs\backend-YYYY-MM-DD.log` |
| Excel backups | `Users\backups\excel\` (newest 10 kept) |
| Daily data backups | `Users\backups\daily\hhpro-data-YYYY-MM-DD.zip` (newest 30 kept) |
| Weekly site backups | `Users\backups\weekly\hhpro-site-YYYY-MM-DD.zip` (newest 4 kept) |

Everything under `Users\` is git-ignored.

## The Excel file

- **Permissions tab**: edited by Eric in Excel. The backend re-reads it
  within about 15 seconds of a save. A blank cell means Yes.
- **Users tab**: written by the backend after every user change. Hand
  edits there are overwritten. If the file is open in Excel the write
  waits and retries every minute.

## Backups

The service makes them on its own; nothing to schedule in Windows.

- **Daily, 02:00**: the users database, the spreadsheet, and every
  project folder, zipped into `Users\backups\daily`. Thirty days kept.
  The same job removes trashed projects and set-aside user folders that
  are more than 30 days old.
- **Weekly, Sunday 03:00**: the site files (HTML, CSS, JS, DATA, SERVER
  code) into `Users\backups\weekly`. Four kept. ASSETS is left out
  unless `BACKUP_SITE_INCLUDE_ASSETS=true` in `.env`; everything in the
  site is also in GitHub.
- If the server was off at the scheduled time, the job runs within five
  minutes of the service starting.
- `BACKUP_DIR` in `.env` moves both to another drive or a network share.

To restore, stop the HHpro Backend service, unzip the daily backup over
`Users\` (hhpro.db, the spreadsheet, Projects), and start the service.

## Commands

Run these from the `SERVER` folder.

| Command | What it does |
| --- | --- |
| `npm install` | Installs the packages (once, and after pulling a change to package.json) |
| `npm start` | Runs the backend in the current window (for testing) |
| `npm run import-users` | One-time import of the Users tab into the database |
| `npm run sync-excel` | Rewrites the Users tab from the database on demand |
| `npm run backup` | Makes a daily data backup now (`npm run backup -- weekly` for the site) |

## Health check

https://api.hhpro-hvac.com/health returns a small JSON status: version,
uptime, when the Permissions tab was last read, and whether the last
Users-tab write succeeded.
