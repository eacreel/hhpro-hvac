/* ============================================================
   HHpro backend - Schedule template access
   ------------------------------------------------------------
   Which engineer schedule templates a user may pick, decided by
   user level and company:

     Super Admin, Admin, Hoffman   every template
     Engineer                      standard + their company's, if
                                   the company has one
     Contractor                    standard only

   The list below mirrors ENGINEERS in JS/schedule_templates.js.
   When a new firm's template is added to the site, add its key
   and label here too. Company names are matched loosely: case,
   punctuation, "&" and "and" are ignored, so "Barrett Woodyard
   and Associates" still finds barrett_woodyard.
   ============================================================ */

'use strict';

const STANDARD = 'hoffman';

const ENGINEERS = [
    { key: 'hoffman', label: 'Hoffman & Hoffman' },
    { key: 'refresco', label: 'Refresco' },
    { key: 'barrett_woodyard', label: 'Barrett Woodyard & Associates' },
    { key: 'allied', label: 'Allied' },
    { key: 'saber', label: 'Saber' },
    { key: 'mswg', label: 'MSWG' }
];

function normalize(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/&/g, ' ')
        .replace(/\band\b/g, ' ')
        .replace(/[^a-z0-9]/g, '');
}

/** Template key for a company name, or null if the company has none. */
function templateForCompany(company) {
    const target = normalize(company);
    if (!target) return null;
    const hit = ENGINEERS.find((e) => normalize(e.label) === target || e.key === target);
    return hit ? hit.key : null;
}

function allowedEngineersFor(user) {
    switch (user.user_level) {
        case 'Super Admin':
        case 'Admin':
        case 'Hoffman':
            return ENGINEERS.map((e) => e.key);
        case 'Engineer': {
            const own = templateForCompany(user.company);
            return own && own !== STANDARD ? [STANDARD, own] : [STANDARD];
        }
        default:
            return [STANDARD];
    }
}

/** The layout a new project should start on for this user. */
function defaultEngineerFor(user) {
    if (user.user_level === 'Engineer') {
        const own = templateForCompany(user.company);
        if (own) return own;
    }
    return STANDARD;
}

module.exports = {
    ENGINEERS,
    STANDARD,
    templateForCompany,
    allowedEngineersFor,
    defaultEngineerFor
};
