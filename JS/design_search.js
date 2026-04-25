/* ============================================================
   HHpro - Design Search view
   ------------------------------------------------------------
   Engineer enters their design loads (cooling capacity, heating
   capacity, airflow, etc. as target ± tolerance %) plus any hard
   constraints (electrical, stages, etc.) and the page returns
   matching equipment ranked by closeness to the targets.

   Schema-driven: each product's JSON declares a `searchSchema`
   block listing which schedule columns are search "targets". The
   form is built from that block plus the product's existing
   `filterColumns`. Adding a new product requires only adding the
   JSON file with a searchSchema -- no code changes here.

   Data shapes referenced:
     product.searchSchema = {
       displayName: "Gas Pack RTUs",
       description: "...",
       targets: [{ label, col, unit, defaultTolerance }]
     }
     selection.rows[].scheduleData[colLetter] = numeric value
     selection.rows[].filterData[filterName]  = filter value
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    // Module-level form state preserved across re-renders (so the user's
    // entered targets survive when results re-render after a search).
    // Reset when the user changes product category.
    var state = {
        productKey: null,
        productData: null, // cached data for the selected product
        targetValues: {},  // { col: number | null }
        tolerances: {},    // { col: number  }   percent
        filterValues: {},  // { filterName: value | null }
        results: null,     // { selections, allCount } | null = no search run yet
        loading: false,
        error: null
    };

    HHpro.Views.design_search = {
        render: function (root) {
            root.innerHTML = '';
            root.appendChild(HHpro.UI.buildHeader('Design Search'));
            var main = document.createElement('main');
            main.className = 'design-search-page';
            root.appendChild(main);

            main.appendChild(buildIntro());
            main.appendChild(buildCategoryPicker());

            // Form + results render conditionally based on whether a
            // category has been picked.
            var workArea = document.createElement('div');
            workArea.className = 'design-search-work';
            main.appendChild(workArea);

            renderWorkArea(workArea);
        }
    };

    // -----------------------------------------------------------------
    // Top intro / explanation
    // -----------------------------------------------------------------

    function buildIntro() {
        var wrap = document.createElement('div');
        wrap.className = 'design-search-intro';

        var title = document.createElement('h1');
        title.className = 'design-search-title';
        title.textContent = 'Design Search';
        wrap.appendChild(title);

        var sub = document.createElement('p');
        sub.className = 'design-search-sub';
        sub.textContent = 'Pick a product category, enter your design targets with the tolerance you can accept, then find matching equipment.';
        wrap.appendChild(sub);

        return wrap;
    }

    // -----------------------------------------------------------------
    // Category picker
    // -----------------------------------------------------------------

    function buildCategoryPicker() {
        var wrap = document.createElement('div');
        wrap.className = 'design-search-category';

        var label = document.createElement('label');
        label.className = 'design-search-category-label';
        label.htmlFor = 'design-search-category-select';
        label.textContent = 'Product category';
        wrap.appendChild(label);

        var select = document.createElement('select');
        select.id = 'design-search-category-select';
        select.className = 'filter-select design-search-category-select';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '-- Choose a category --';
        select.appendChild(placeholder);

        var products = HHpro.Data.getProducts();
        products.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p.productKey;
            opt.textContent = p.displayName || p.productKey;
            if (state.productKey === p.productKey) opt.selected = true;
            select.appendChild(opt);
        });

        select.addEventListener('change', function () {
            var key = select.value || null;
            if (key === state.productKey) return;
            // Switching categories wipes the previously-entered values --
            // they reference column letters that don't apply to the new
            // category's schema.
            state.productKey = key;
            state.productData = null;
            state.targetValues = {};
            state.tolerances = {};
            state.filterValues = {};
            state.results = null;
            state.loading = false;
            state.error = null;
            if (key) loadProductData(key);
            else rerenderWorkArea();
        });

        wrap.appendChild(select);
        return wrap;
    }

    function loadProductData(productKey) {
        state.loading = true;
        state.error = null;
        rerenderWorkArea();

        HHpro.Data.loadProduct(productKey)
            .then(function (data) {
                if (state.productKey !== productKey) return; // user switched away
                state.productData = data;
                state.loading = false;

                // Pre-fill default tolerances from the schema so the user
                // sees them as suggestions instead of blank fields.
                var schema = (data && data.searchSchema) || { targets: [] };
                schema.targets.forEach(function (t) {
                    if (state.tolerances[t.col] === undefined) {
                        state.tolerances[t.col] = (t.defaultTolerance != null ? t.defaultTolerance : 10);
                    }
                });

                rerenderWorkArea();
            })
            .catch(function (err) {
                if (state.productKey !== productKey) return;
                state.loading = false;
                state.error = (err && err.message) || 'Failed to load product data.';
                rerenderWorkArea();
            });
    }

    function rerenderWorkArea() {
        var work = document.querySelector('.design-search-work');
        if (work) renderWorkArea(work);
    }

    function renderWorkArea(work) {
        work.innerHTML = '';
        if (!state.productKey) {
            return; // nothing to show until a category is picked
        }
        if (state.loading) {
            var msg = document.createElement('p');
            msg.className = 'design-search-status';
            msg.textContent = 'Loading product data...';
            work.appendChild(msg);
            return;
        }
        if (state.error) {
            var err = document.createElement('p');
            err.className = 'design-search-status design-search-error';
            err.textContent = state.error;
            work.appendChild(err);
            return;
        }
        if (!state.productData) return;

        work.appendChild(buildSearchForm());
        work.appendChild(state.results ? buildResults() : buildResultsPlaceholder());
    }

    function buildResultsPlaceholder() {
        var wrap = document.createElement('section');
        wrap.className = 'design-search-results design-search-results-empty';
        var msg = document.createElement('div');
        msg.className = 'design-search-placeholder';
        msg.textContent = 'Enter design targets and click "Find matches" to see equipment that fits.';
        wrap.appendChild(msg);
        return wrap;
    }

    // -----------------------------------------------------------------
    // Search form (targets + filters)
    // -----------------------------------------------------------------

    function buildSearchForm() {
        var data = state.productData;
        var schema = (data && data.searchSchema) || { targets: [] };
        var product = HHpro.Data.getProduct(state.productKey);

        var form = document.createElement('form');
        form.className = 'design-search-form';
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            runSearch();
        });

        if (schema.description) {
            var desc = document.createElement('p');
            desc.className = 'design-search-desc';
            desc.textContent = schema.description;
            form.appendChild(desc);
        }

        // Target rows -- each line is "[label]: [value] ± [tolerance]% [unit]"
        if (schema.targets.length) {
            var targetsBox = document.createElement('section');
            targetsBox.className = 'design-search-section';
            var hdr = document.createElement('h2');
            hdr.className = 'design-search-section-title';
            hdr.textContent = 'Design targets';
            targetsBox.appendChild(hdr);

            var hint = document.createElement('p');
            hint.className = 'design-search-hint';
            hint.textContent = 'Leave a row blank to skip it. Tolerance is the +/- percent the result can differ from your target.';
            targetsBox.appendChild(hint);

            var grid = document.createElement('div');
            grid.className = 'design-target-grid';
            schema.targets.forEach(function (t) {
                grid.appendChild(buildTargetRow(t));
            });
            targetsBox.appendChild(grid);
            form.appendChild(targetsBox);
        }

        // Filter dropdowns -- same UX as the main product page.
        var filterCols = (data.filterColumns || []);
        if (filterCols.length) {
            var filtersBox = document.createElement('section');
            filtersBox.className = 'design-search-section';
            var fhdr = document.createElement('h2');
            fhdr.className = 'design-search-section-title';
            fhdr.textContent = 'Constraints';
            filtersBox.appendChild(fhdr);

            var fhint = document.createElement('p');
            fhint.className = 'design-search-hint';
            fhint.textContent = 'Hard constraints -- a result must match these exactly.';
            filtersBox.appendChild(fhint);

            var fgrid = document.createElement('div');
            fgrid.className = 'design-filter-grid';
            filterCols.forEach(function (fc) {
                fgrid.appendChild(buildFilterDropdown(fc, data));
            });
            filtersBox.appendChild(fgrid);
            form.appendChild(filtersBox);
        }

        // Action buttons
        var actions = document.createElement('div');
        actions.className = 'design-search-actions';

        var search = document.createElement('button');
        search.type = 'submit';
        search.className = 'btn btn-primary';
        search.textContent = 'Find matches';
        actions.appendChild(search);

        var reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'projects-btn projects-btn-secondary';
        reset.textContent = 'Reset';
        reset.addEventListener('click', function () {
            state.targetValues = {};
            state.filterValues = {};
            state.results = null;
            // Re-seed default tolerances
            schema.targets.forEach(function (t) {
                state.tolerances[t.col] = (t.defaultTolerance != null ? t.defaultTolerance : 10);
            });
            rerenderWorkArea();
        });
        actions.appendChild(reset);

        form.appendChild(actions);

        return form;
    }

    function buildTargetRow(target) {
        var row = document.createElement('div');
        row.className = 'design-target-row';

        var label = document.createElement('label');
        label.className = 'design-target-label';
        label.textContent = target.label;
        row.appendChild(label);

        var valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.className = 'design-target-value';
        valueInput.step = 'any';
        valueInput.placeholder = '—';
        if (state.targetValues[target.col] != null) {
            valueInput.value = state.targetValues[target.col];
        }
        valueInput.addEventListener('input', function () {
            var raw = valueInput.value.trim();
            state.targetValues[target.col] = raw === '' ? null : parseFloat(raw);
        });
        row.appendChild(valueInput);

        var unit = document.createElement('span');
        unit.className = 'design-target-unit';
        unit.textContent = target.unit || '';
        row.appendChild(unit);

        var plusMinus = document.createElement('span');
        plusMinus.className = 'design-target-plusminus';
        plusMinus.textContent = '±'; // ±
        row.appendChild(plusMinus);

        var tolInput = document.createElement('input');
        tolInput.type = 'number';
        tolInput.className = 'design-target-tolerance';
        tolInput.step = 'any';
        tolInput.min = '0';
        tolInput.value = state.tolerances[target.col] != null ? state.tolerances[target.col] : 10;
        tolInput.addEventListener('input', function () {
            var raw = tolInput.value.trim();
            state.tolerances[target.col] = raw === '' ? 0 : parseFloat(raw);
        });
        row.appendChild(tolInput);

        var pct = document.createElement('span');
        pct.className = 'design-target-pct';
        pct.textContent = '%';
        row.appendChild(pct);

        return row;
    }

    function buildFilterDropdown(filterCol, data) {
        var group = document.createElement('div');
        group.className = 'filter-group';

        var label = document.createElement('label');
        label.className = 'filter-label';
        label.textContent = filterCol.name;
        group.appendChild(label);

        var select = document.createElement('select');
        select.className = 'filter-select';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'All';
        select.appendChild(placeholder);

        // Distinct values for this filter, drawn from row 0 of every selection.
        var values = collectDistinctFilterValues(data, filterCol.name);
        values.forEach(function (v) {
            var opt = document.createElement('option');
            opt.value = String(v);
            opt.textContent = String(v);
            if (state.filterValues[filterCol.name] === String(v)) opt.selected = true;
            select.appendChild(opt);
        });

        select.addEventListener('change', function () {
            state.filterValues[filterCol.name] = select.value || null;
        });
        group.appendChild(select);
        return group;
    }

    function collectDistinctFilterValues(data, filterName) {
        var seen = {};
        var out = [];
        (data.selections || []).forEach(function (sel) {
            if (!sel.rows || !sel.rows[0] || !sel.rows[0].filterData) return;
            var v = sel.rows[0].filterData[filterName];
            if (v === undefined || v === null || v === '') return;
            var key = String(v);
            if (seen[key]) return;
            seen[key] = true;
            out.push(v);
        });
        // Numeric-friendly sort: numbers ascending, strings alphabetical.
        out.sort(function (a, b) {
            var na = parseFloat(a), nb = parseFloat(b);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return String(a).localeCompare(String(b));
        });
        return out;
    }

    // -----------------------------------------------------------------
    // Search execution
    // -----------------------------------------------------------------

    function runSearch() {
        var data = state.productData;
        if (!data) return;

        // 1. Hard constraints first (existing filter logic).
        var afterFilters = HHpro.Schedule.applyFilters(
            data.selections || [],
            state.filterValues
        );

        // 2. Build the active target list -- only targets the user actually
        //    entered a value for. Tolerances default to 0 if unset (exact
        //    match), but the schema pre-fills sensible defaults so this
        //    rarely matters.
        var activeTargets = [];
        ((data.searchSchema && data.searchSchema.targets) || []).forEach(function (t) {
            var val = state.targetValues[t.col];
            if (val == null || isNaN(val)) return;
            var tol = state.tolerances[t.col];
            if (tol == null || isNaN(tol)) tol = 0;
            activeTargets.push({
                col: t.col,
                target: val,
                tolerance: tol,
                label: t.label,
                unit: t.unit
            });
        });

        // 3. For each remaining selection, check whether at least one row
        //    falls inside every active target's window. Score = sum of
        //    absolute % deviations of the best-matching row per target.
        //    Lower score = better match.
        var matched = [];
        afterFilters.forEach(function (sel) {
            var allTargetsPassed = true;
            var totalDev = 0;
            for (var i = 0; i < activeTargets.length; i++) {
                var t = activeTargets[i];
                var bestDev = bestRowDeviation(sel, t);
                if (bestDev == null) { allTargetsPassed = false; break; }
                totalDev += bestDev;
            }
            if (!allTargetsPassed) return;
            matched.push({ selection: sel, score: totalDev });
        });

        matched.sort(function (a, b) { return a.score - b.score; });

        state.results = {
            selections: matched.map(function (m) { return m.selection; }),
            scores: matched,
            allCount: (data.selections || []).length,
            activeTargets: activeTargets
        };
        rerenderWorkArea();
    }

    /**
     * For a given selection and a target, find the smallest absolute
     * percent deviation across all rows of the selection where the column
     * has a numeric value. Returns null if no row's value lies within the
     * tolerance window OR no row has a value at all (selection fails this
     * target). Returns a number in [0, tolerance] otherwise.
     */
    function bestRowDeviation(sel, target) {
        if (!sel.rows || !sel.rows.length) return null;
        var bestPct = null;
        for (var i = 0; i < sel.rows.length; i++) {
            var row = sel.rows[i];
            if (!row.scheduleData) continue;
            var raw = row.scheduleData[target.col];
            if (raw === undefined || raw === null || raw === '') continue;
            var num = parseFloat(raw);
            if (isNaN(num)) continue;
            var dev;
            if (target.target === 0) {
                dev = num === 0 ? 0 : 100; // avoid div-by-zero; nonzero diff = 100% dev
            } else {
                dev = Math.abs(num - target.target) / Math.abs(target.target) * 100;
            }
            if (dev > target.tolerance) continue;
            if (bestPct === null || dev < bestPct) bestPct = dev;
        }
        return bestPct;
    }

    // -----------------------------------------------------------------
    // Results
    // -----------------------------------------------------------------

    function buildResults() {
        var wrap = document.createElement('section');
        wrap.className = 'design-search-results';

        var hdr = document.createElement('div');
        hdr.className = 'design-search-results-header';

        var title = document.createElement('h2');
        title.className = 'design-search-section-title';
        var n = state.results.selections.length;
        title.textContent = 'Results: ' + n + ' match' + (n === 1 ? '' : 'es');
        hdr.appendChild(title);

        if (state.results.activeTargets.length) {
            var meta = document.createElement('p');
            meta.className = 'design-search-results-meta';
            meta.textContent = 'Sorted by closeness to: ' + state.results.activeTargets.map(function (t) {
                return t.label + ' = ' + t.target + ' ' + (t.unit || '') + ' ± ' + t.tolerance + '%';
            }).join('; ');
            hdr.appendChild(meta);
        }

        wrap.appendChild(hdr);

        if (n === 0) {
            var empty = document.createElement('p');
            empty.className = 'design-search-empty';
            empty.textContent = 'No items match those targets and constraints. Try widening your tolerance or relaxing a filter.';
            wrap.appendChild(empty);
            return wrap;
        }

        // Reuse the standard schedule table -- same look and the same
        // Select / Submittal / Docs action buttons engineers already know.
        var product = HHpro.Data.getProduct(state.productKey);
        var tableWrap = document.createElement('div');
        tableWrap.className = 'schedule-wrap design-search-schedule-wrap';
        var table = HHpro.Schedule.buildTable(state.productData, state.results.selections, product);
        tableWrap.appendChild(table);
        wrap.appendChild(tableWrap);

        // Sticky offsets need the same multi-pass treatment as the
        // product page (font swap, layout settling).
        HHpro.Schedule.applyStickyHeaderOffsets(table);
        requestAnimationFrame(function () {
            if (!table.isConnected) return;
            HHpro.Schedule.applyStickyHeaderOffsets(table);
        });
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () {
                if (!table.isConnected) return;
                HHpro.Schedule.applyStickyHeaderOffsets(table);
            });
        }

        return wrap;
    }
})();
