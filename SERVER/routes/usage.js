/* ============================================================
   HHpro backend - Basic usage records (/api/usage)
   ------------------------------------------------------------
     POST /cart-add   { productKey }  one item went into a
                      temporary cart (selections that never reach
                      a saved project). Stored as product type +
                      time in cart_adds, shown to Super Admins on
                      the Users > Analytics tab.

   Signed-in people only; the account comes from the session,
   never from the request. Nothing else about the selection is
   kept. A person adding more than CAP items in WINDOW_MS is not
   recorded past the cap (a runaway script can't fill the table).
   ============================================================ */

'use strict';

const express = require('express');
const db = require('../lib/db');
const auth = require('../lib/auth');

const router = express.Router();
router.use(auth.requireUser);

const KEY_RE = /^[a-z0-9_]{1,40}$/;
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

module.exports = router;
