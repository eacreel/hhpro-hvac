/* ============================================================
   HHpro - Quick Model Lookup
   ------------------------------------------------------------
   Header search input that finds a model number across every
   product. Type a partial or full model (e.g. "DSG0363" or
   "FTXV12AVJU9"); a dropdown shows matches and clicking one
   navigates to that product's page.

   Index strategy:
     - Lazy-load every product's JSON the first time the input
       is focused (cached for the session by HHpro.Data).
     - For each loaded product, scan its scheduleHeader for
       columns whose header value is "MODEL" / "MODEL NUMBER" /
       "Model" / etc., then collect distinct values from those
       columns across all selection rows.
     - Each entry: { productKey, productDisplayName, columnLabel,
                     model, modelLower }

   Search: case-insensitive substring match on `modelLower`.
   Ranking: exact match first, then prefix match, then any
   match alphabetical. Results carry `matchIdx` (where the query
   begins in the model) so the dropdown can highlight the
   matched substring.

   Adding a new product just means including a new product JSON
   with a "MODEL"-headed column -- the index picks it up
   automatically on the next page load.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var MAX_RESULTS = 10;
    var DEBOUNCE_MS = 120;

    var indexBuilt = false;
    var indexBuilding = null;
    var entries = [];

    HHpro.QuickLookup = {
        attach: attach,
        // Forces a rebuild on the next ensureIndex(). Useful if the
        // product registry is ever changed at runtime.
        invalidate: function () { indexBuilt = false; indexBuilding = null; entries = []; }
    };

    /**
     * Wire a text <input> as a quick-lookup search box. Manages its own
     * dropdown element appended to <body>. Handles focus, input,
     * keyboard navigation, blur/escape, and click-outside.
     */
    function attach(inputEl) {
        var dropdown = document.createElement('div');
        dropdown.className = 'quick-lookup-dropdown';
        dropdown.setAttribute('role', 'listbox');
        dropdown.style.display = 'none';
        document.body.appendChild(dropdown);

        var debounceTimer = null;
        var activeIdx = -1;
        var currentMatches = [];
        // Lowercased query of the current match set; renderMatches uses
        // its length to size the highlighted substring in each model.
        var currentQuery = '';

        inputEl.setAttribute('autocomplete', 'off');
        inputEl.setAttribute('spellcheck', 'false');

        inputEl.addEventListener('focus', function () {
            // Kick off lazy loading on first focus so the very first
            // keystroke has data ready (or close to it).
            ensureIndex();
            if (inputEl.value.trim()) showDropdown(inputEl.value.trim());
        });

        inputEl.addEventListener('input', function () {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                showDropdown(inputEl.value.trim());
            }, DEBOUNCE_MS);
        });

        inputEl.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                inputEl.value = '';
                hide();
                inputEl.blur();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (currentMatches.length) {
                    activeIdx = (activeIdx + 1) % currentMatches.length;
                    refreshActive();
                }
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (currentMatches.length) {
                    activeIdx = (activeIdx - 1 + currentMatches.length) % currentMatches.length;
                    refreshActive();
                }
                return;
            }
            if (e.key === 'Enter') {
                if (activeIdx >= 0 && currentMatches[activeIdx]) {
                    e.preventDefault();
                    pickMatch(currentMatches[activeIdx]);
                }
            }
        });

        document.addEventListener('mousedown', function (e) {
            if (e.target === inputEl) return;
            if (dropdown.contains(e.target)) return;
            hide();
        });

        // Hide + reposition on resize / scroll (input position can shift).
        window.addEventListener('resize', function () {
            if (dropdown.style.display !== 'none') position();
        });

        function showDropdown(query) {
            ensureIndex().then(function () {
                if (!query) {
                    currentMatches = [];
                    activeIdx = -1;
                    hide();
                    return;
                }
                currentQuery = query.toLowerCase();
                currentMatches = search(currentQuery);
                activeIdx = currentMatches.length ? 0 : -1;
                renderMatches();
                position();
                dropdown.style.display = currentMatches.length || query ? 'block' : 'none';
            });
        }

        function position() {
            var rect = inputEl.getBoundingClientRect();
            dropdown.style.left = rect.left + 'px';
            dropdown.style.top = (rect.bottom + 4) + 'px';
            dropdown.style.minWidth = rect.width + 'px';
        }

        function renderMatches() {
            dropdown.innerHTML = '';
            if (!currentMatches.length) {
                if (!indexBuilt) {
                    // The first keystroke usually lands here while every
                    // product JSON lazy-loads; show a spinner so it reads
                    // as "working", not "no results".
                    var loading = document.createElement('div');
                    loading.className = 'quick-lookup-loading';
                    var spinner = document.createElement('span');
                    spinner.className = 'hh-spinner hh-spinner-sm';
                    loading.appendChild(spinner);
                    loading.appendChild(
                        document.createTextNode('Loading product data...'));
                    dropdown.appendChild(loading);
                } else {
                    var empty = document.createElement('div');
                    empty.className = 'quick-lookup-empty';
                    empty.textContent = 'No matching models.';
                    dropdown.appendChild(empty);
                }
                return;
            }
            currentMatches.forEach(function (m, idx) {
                var item = document.createElement('button');
                item.type = 'button';
                item.className = 'quick-lookup-item' +
                    (idx === activeIdx ? ' quick-lookup-item-active' : '');
                item.setAttribute('role', 'option');
                item.dataset.idx = String(idx);

                var primary = document.createElement('span');
                primary.className = 'quick-lookup-model';
                // Wrap the matched substring so the user can see WHY each
                // of ten near-identical codes matched. model and modelLower
                // are the same length, so matchIdx slices both correctly.
                if (m.matchIdx >= 0 && currentQuery.length) {
                    primary.appendChild(
                        document.createTextNode(m.model.slice(0, m.matchIdx)));
                    var hl = document.createElement('span');
                    hl.className = 'quick-lookup-hl';
                    hl.textContent =
                        m.model.slice(m.matchIdx, m.matchIdx + currentQuery.length);
                    primary.appendChild(hl);
                    primary.appendChild(document.createTextNode(
                        m.model.slice(m.matchIdx + currentQuery.length)));
                } else {
                    primary.textContent = m.model;
                }

                var secondary = document.createElement('span');
                secondary.className = 'quick-lookup-product';
                secondary.textContent = m.productDisplayName;

                item.appendChild(primary);
                item.appendChild(secondary);

                // mousedown (not click) so the input's blur handler doesn't
                // hide the dropdown before the click fires.
                item.addEventListener('mousedown', function (e) {
                    e.preventDefault();
                    pickMatch(m);
                });
                dropdown.appendChild(item);
            });
        }

        function refreshActive() {
            var items = dropdown.querySelectorAll('.quick-lookup-item');
            for (var i = 0; i < items.length; i++) {
                items[i].classList.toggle('quick-lookup-item-active', i === activeIdx);
                if (i === activeIdx && items[i].scrollIntoView) {
                    items[i].scrollIntoView({ block: 'nearest' });
                }
            }
        }

        function pickMatch(m) {
            inputEl.value = '';
            hide();
            inputEl.blur();
            // Pass the model string so the product view can filter the
            // schedule down to just selections containing it.
            HHpro.App.showView('product', {
                productKey: m.productKey,
                modelQuery: m.model
            });
        }

        function hide() {
            dropdown.style.display = 'none';
            currentMatches = [];
            activeIdx = -1;
            currentQuery = '';
        }
    }

    // -----------------------------------------------------------------
    // Index build
    // -----------------------------------------------------------------

    function ensureIndex() {
        if (indexBuilt) return Promise.resolve();
        if (indexBuilding) return indexBuilding;

        indexBuilding = Promise.all(
            HHpro.Data.getProducts().map(function (product) {
                return HHpro.Data.loadProduct(product.productKey)
                    .then(function (data) { return { product: product, data: data }; })
                    .catch(function () { return null; });
            })
        ).then(function (results) {
            var seen = {};
            entries = [];
            results.forEach(function (r) {
                if (!r) return;
                buildEntriesFor(r.product, r.data, entries, seen);
            });
            indexBuilt = true;
            indexBuilding = null;
        }).catch(function () {
            indexBuilding = null;
        });

        return indexBuilding;
    }

    function buildEntriesFor(product, data, out, seen) {
        // Defer to the shared HHpro.Schedule.findModelColumns so adding a
        // new "model"-style header synonym is a one-place change.
        var modelCols = (HHpro.Schedule && HHpro.Schedule.findModelColumns)
            ? HHpro.Schedule.findModelColumns(data)
            : [];
        if (!modelCols.length) return;

        (data.selections || []).forEach(function (sel) {
            (sel.rows || []).forEach(function (row) {
                if (!row.scheduleData) return;
                modelCols.forEach(function (mc) {
                    var raw = row.scheduleData[mc.col];
                    if (raw === undefined || raw === null) return;
                    var s = String(raw).trim();
                    if (!s) return;
                    var key = product.productKey + '|' + s;
                    if (seen[key]) return;
                    seen[key] = true;
                    out.push({
                        productKey: product.productKey,
                        productDisplayName: product.displayName,
                        columnLabel: mc.label,
                        model: s,
                        modelLower: s.toLowerCase()
                    });
                });
            });
        });
    }

    // -----------------------------------------------------------------
    // Search
    // -----------------------------------------------------------------

    function search(query) {
        var hits = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var idx = e.modelLower.indexOf(query);
            if (idx === -1) continue;
            hits.push({ entry: e, idx: idx });
        }
        // Rank: exact match > prefix match > earlier substring match;
        // tie-break alphabetically.
        hits.sort(function (a, b) {
            var aExact = a.entry.modelLower === query ? 0 : 1;
            var bExact = b.entry.modelLower === query ? 0 : 1;
            if (aExact !== bExact) return aExact - bExact;
            if (a.idx !== b.idx) return a.idx - b.idx;
            return a.entry.modelLower.localeCompare(b.entry.modelLower);
        });
        // Copy the entry plus the substring position -- the dropdown needs
        // matchIdx to highlight the matched run inside the model code.
        return hits.slice(0, MAX_RESULTS).map(function (h) {
            return {
                productKey: h.entry.productKey,
                productDisplayName: h.entry.productDisplayName,
                columnLabel: h.entry.columnLabel,
                model: h.entry.model,
                modelLower: h.entry.modelLower,
                matchIdx: h.idx
            };
        });
    }
})();
