/* ============================================================
   HHpro backend - Basic usage records (/api/usage)
   ------------------------------------------------------------
     POST /cart-add   { productKey }  one item went into a
                      temporary cart (selections that never reach
                      a saved project). Stored as product type +
                      time in cart_adds.
     POST /event      { kind, detail, productKey }  one of:
                        export         a schedule download; detail =
                                       xlsx | dxf | pdf
                        calculator     a calculator opened; detail =
                                       its key (psychrometrics, ...)
                        design_search  a Design Search run
                      Stored in usage_events.

   All of it is shown to Super Admins on the Users > Analytics tab.
   Signed-in people only; the account comes from the session, never
   from the request. Nothing else about the action is kept. A person
   sending more than CAP records in WINDOW_MS is not recorded past
   the cap (a runaway script can't fill the tables).
   ============================================================ */

'use strict';

const express = require('express');
const db = require('../lib/db');
const auth = require('../lib/auth');

const router = express.Router();
router.use(auth.requireUser);

const KEY_RE = /^[a-z0-9_]{1,40}$/;
const KINDS = ['export', 'calculator', 'design_search'];
const CAP = 200;
const WINDOW_MS = 10 * 60 * 1000;
const recent = new Map();   // user id -> { start, n }

function underCap(userId) {
    const t = Date.now();
    let r = recent.get(userId);
    if (!r || t - r.start > WINDOW_MS) {
        r = { start: t, n: 0 };
        recent.set(userId, r);
    }
    r.n += 1;
    return r.n <= CAP;
}

router.post('/cart-add', (req, res) => {
    const key = String((req.body && req.body.productKey) || '');
    if (!KEY_RE.test(key)) return res.status(400).json({ error: 'Bad product key.' });
    if (underCap(req.user.id)) db.recordCartAdd(req.user.id, key);
    res.status(204).end();
});

router.post('/event', (req, res) => {
    const b = req.body || {};
    const kind = String(b.kind || '');
    const detail = String(b.detail || '');
    const key = String(b.productKey || '');
    if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Unknown kind.' });
    if (detail && !KEY_RE.test(detail)) return res.status(400).json({ error: 'Bad detail.' });
    if (key && !KEY_RE.test(key)) return res.status(400).json({ error: 'Bad product key.' });
    if (underCap(req.user.id)) db.recordEvent(req.user.id, kind, detail, key);
    res.status(204).end();
});

module.exports = router;
