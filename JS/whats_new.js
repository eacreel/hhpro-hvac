/* ============================================================
   HHpro - What's New popup
   ------------------------------------------------------------
   Lists the site updates kept in ASSETS/Updates.txt, one per
   line:

       10.29.2026: Unitary & Light Commercial Splits - updated ...

   Lines are grouped by date, newest first. A line without a
   leading date is shown under the dated line above it.

   Opens two ways:
     - the "What's New" header button (any time)
     - by itself once per page load, after sign-in, when the file
       holds a line this person has not seen in this browser yet.
       Closing the popup marks every line as seen, so it stays
       quiet until the file gets a new or reworded line.
   Lines that are new since the person's last look carry a "New"
   tag. Seen lines are remembered per account in localStorage.

   Calculators-only accounts (Manufacturer) don't get it: the
   updates are mostly about products they can't see.
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};

    var UPDATES_URL = 'ASSETS/Updates.txt';
    var STORAGE_PREFIX = 'hhpro.whatsNew.';
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                  'August', 'September', 'October', 'November', 'December'];

    var checkedFor = null;   // email the automatic check already ran for
    var openModal = null;    // { backdrop, close } while the popup is up

    function available() {
        return !!(HHpro.State && HHpro.State.isLoggedIn() && !HHpro.State.isCalculatorsOnly());
    }

    function storageKey() {
        var u = HHpro.State.getUser();
        return STORAGE_PREFIX + String((u && u.email) || '').toLowerCase();
    }

    // -----------------------------------------------------------------
    // Updates.txt
    // -----------------------------------------------------------------

    /** The file's text; 'no-cache' revalidates so a new line shows at once. */
    function fetchText() {
        return fetch(UPDATES_URL, { cache: 'no-cache' }).then(function (res) {
            if (!res.ok) throw new Error('Updates.txt: HTTP ' + res.status);
            return res.text();
        });
    }

    /**
     * [{ date: {y, m, d} | null, text, key }] in file order. The key
     * ignores case, spacing and punctuation, so tidying a line doesn't
     * flag it as new; changing its words or date does.
     */
    function parse(text) {
        var entries = [];
        String(text || '').replace(/^﻿/, '').split(/\r?\n/).forEach(function (raw) {
            var line = raw.trim();
            if (!line) return;
            var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s*[:\-–]\s*(.*)$/.exec(line);
            if (m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31 && m[4]) {
                entries.push({ date: { y: +m[3], m: +m[1], d: +m[2] }, text: m[4].trim() });
            } else if (entries.length) {
                var prev = entries[entries.length - 1];
                prev.text += ' ' + line;
            } else {
                entries.push({ date: null, text: line });
            }
        });
        entries.forEach(function (e) {
            var d = e.date ? e.date.y + '-' + e.date.m + '-' + e.date.d : '';
            e.key = hash(d + '|' + e.text.toLowerCase().replace(/[^a-z0-9]+/g, ''));
        });
        return entries;
    }

    /** FNV-1a, base 36 - short and stable; collisions don't matter here. */
    function hash(s) {
        var h = 0x811c9dc5;
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(36);
    }

    /** Newest date first; lines that share a date keep their file order. */
    function groupByDate(entries) {
        var groups = [];
        var byLabel = {};
        entries.forEach(function (e) {
            var label = e.date ? formatDate(e.date) : '';
            var g = byLabel[label];
            if (!g) {
                g = byLabel[label] = {
                    label: label,
                    sort: e.date ? e.date.y * 10000 + e.date.m * 100 + e.date.d : -1,
                    entries: []
                };
                groups.push(g);
            }
            g.entries.push(e);
        });
        return groups.sort(function (a, b) { return b.sort - a.sort; });
    }

    function formatDate(d) {
        return MONTHS[d.m - 1] + ' ' + d.d + ', ' + d.y;
    }

    // -----------------------------------------------------------------
    // Seen lines
    // -----------------------------------------------------------------

    /** Keys this account has seen in this browser, or null if it never opened the popup. */
    function loadSeen() {
        try {
            var raw = localStorage.getItem(storageKey());
            var parsed = raw ? JSON.parse(raw) : null;
            return (parsed && Array.isArray(parsed.seen)) ? parsed.seen : null;
        } catch (e) {
            return null;
        }
    }

    function saveSeen(entries) {
        try {
            localStorage.setItem(storageKey(), JSON.stringify({
                seen: entries.map(function (e) { return e.key; })
            }));
        } catch (e) { /* storage full or blocked: the popup just shows again */ }
    }

    // -----------------------------------------------------------------
    // Popup
    // -----------------------------------------------------------------

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    /** Show the popup. newKeys = keys to tag "New" (none for a first look). */
    function show(entries, newKeys) {
        if (openModal) openModal.close();

        var backdrop = el('div', 'modal-backdrop');
        var modal = el('div', 'modal whats-new-modal');
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'whats-new-title');

        var header = el('div', 'whats-new-header');
        var title = el('h2', 'modal-title', "What's New");
        title.id = 'whats-new-title';
        header.appendChild(title);
        var closeX = el('button', 'whats-new-close');
        closeX.type = 'button';
        closeX.setAttribute('aria-label', 'Close');
        closeX.appendChild(HHpro.UI.icon('x'));
        header.appendChild(closeX);
        modal.appendChild(header);

        var newCount = newKeys ? Object.keys(newKeys).length : 0;
        modal.appendChild(el('p', 'modal-desc', newCount
            ? newCount + (newCount === 1 ? ' update' : ' updates') + ' since your last visit, marked New.'
            : 'Recent changes to HHpro.'));

        var list = el('div', 'whats-new-list');
        if (!entries.length) {
            list.appendChild(el('p', 'modal-desc', 'No updates have been posted yet.'));
        }
        groupByDate(entries).forEach(function (g) {
            var section = el('section', 'whats-new-group');
            if (g.label) section.appendChild(el('h3', 'whats-new-date', g.label));
            var ul = el('ul', 'whats-new-items');
            g.entries.forEach(function (e) {
                var li = el('li', 'whats-new-item');
                if (newKeys && newKeys[e.key]) {
                    li.classList.add('whats-new-item-new');
                    li.appendChild(el('span', 'whats-new-badge', 'New'));
                }
                li.appendChild(el('span', 'whats-new-text', e.text));
                ul.appendChild(li);
            });
            section.appendChild(ul);
            list.appendChild(section);
        });
        modal.appendChild(list);

        var actions = el('div', 'modal-actions');
        var ok = el('button', 'modal-btn modal-btn-primary', 'Got it');
        ok.type = 'button';
        actions.appendChild(ok);
        modal.appendChild(actions);

        // Every way out (button, X, backdrop, Escape) counts as seen.
        function close(markSeen) {
            document.removeEventListener('keydown', onKey);
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            if (openModal && openModal.backdrop === backdrop) openModal = null;
            if (markSeen !== false) saveSeen(entries);
        }
        function onKey(e) { if (e.key === 'Escape') close(); }
        ok.addEventListener('click', function () { close(); });
        closeX.addEventListener('click', function () { close(); });
        backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close(); });
        document.addEventListener('keydown', onKey);

        backdrop.appendChild(modal);
        document.body.appendChild(backdrop);
        openModal = { backdrop: backdrop, close: close };
        ok.focus();
    }

    /** Which entries are new for this account: { key: true }, or null on a first look. */
    function newKeysFor(entries) {
        var seen = loadSeen();
        if (!seen) return null;
        var lookup = {};
        seen.forEach(function (k) { lookup[k] = true; });
        var fresh = {};
        entries.forEach(function (e) { if (!lookup[e.key]) fresh[e.key] = true; });
        return fresh;
    }

    // Signing out closes the popup without marking it seen, and lets
    // the next sign-in check again.
    document.addEventListener('hhpro:session-changed', function (e) {
        if (e.detail && e.detail.email) return;
        checkedFor = null;
        if (openModal) openModal.close(false);
    });

    HHpro.WhatsNew = {
        /** Header button: always opens, with any unseen lines tagged New. */
        open: function () {
            if (!available()) return;
            fetchText().then(function (text) {
                var entries = parse(text);
                show(entries, newKeysFor(entries));
            }, function () {
                if (HHpro.UI && HHpro.UI.toast) HHpro.UI.toast("Couldn't load the update list. Please try again.", true);
            });
        },

        /**
         * Called after each signed-in page render (app.js). Runs once per
         * page load per account and opens the popup only if Updates.txt
         * has a line this account hasn't seen. Fails quietly.
         */
        checkForUpdates: function () {
            if (!available()) return;
            var email = HHpro.State.getUser().email;
            if (checkedFor === email) return;
            checkedFor = email;
            fetchText().then(function (text) {
                if (!available() || HHpro.State.getUser().email !== email || openModal) return;
                var entries = parse(text);
                if (!entries.length) return;
                var fresh = newKeysFor(entries);
                if (fresh && !Object.keys(fresh).length) return;
                show(entries, fresh);
            }, function () { /* no file or offline: nothing to announce */ });
        }
    };
})();
