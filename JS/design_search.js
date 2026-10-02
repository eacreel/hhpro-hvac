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
        error: null,
        capacity: freshCapacityState(), // condition-aware inputs (products with capacity tables)
        capacityError: null,            // validation message for the capacity section
        gasPack: freshGasPackState(),   // Gas Pack RTU inputs (replaces the form entirely)
        gasPackError: null,
        // LC RTU "Configure": the unit waiting to be applied once the data
        // loads, and the token of the last click applied (see render).
        pendingConfigure: null,
        configureToken: null
    };

    // Gas Pack RTUs get a purpose-built form rather than the schema-driven
    // one: every number on their schedule came from a selection run by hand
    // at one condition, so the useful question is "what does this cabinet do
    // at MY condition", not "which stored row is closest". The defaults are
    // the conditions those manual selections used, so an untouched form
    // reproduces the schedule.
    // Heat pump heating defaults to 17 F outdoor - the AHRI low-temperature
    // rating point, so the result lines up with the schedule's 17 F column.
    function freshGasPackState() {
        return {
            type: null,                            // 'GAS' | 'HEAT PUMP' | null = All
            tons: null, electrical: null, motor: null,
            efficiency: null, hgrh: null, kw: null, // null = All
            ambient: 95, eatDb: 80, eatWb: 67,     // degF
            heatAmbient: 17,                       // heat pump heating design OA DB, degF
            cfm: null, coolTotal: null, coolSensible: null, heatRise: null, hpHeating: null,
            heatLoad: null,                        // heat pump + kit must cover it (BTU/h)
            tols: { cfm: 10, coolTotal: 10, coolSensible: 10, heatRise: 10, hpHeating: 10 },
            // 'band' = each target ± tolerance; 'min' = capacities meet or
            // exceed, smallest first, with an optional oversize cap (%).
            mode: 'band',
            caps: { coolTotal: null, coolSensible: null, heatRise: null, hpHeating: null },
            convOutlet: false, powerExhaust: false,
            // Set by the LC RTU schedules' "Configure" button
            // (applyGasPackConfigure): the unit to narrow to, and - from a
            // project schedule - the project item Replace swaps.
            configure: null,
            replace: null
        };
    }

    function gasPackUiActive() {
        return !!(HHpro.GasPackCapacity &&
                  HHpro.GasPackCapacity.isProduct(state.productKey) &&
                  HHpro.GasPackCapacity.hasTables() && state.productData);
    }

    // Condition-aware search inputs. Only rendered for products backed by
    // HHpro.Capacity tables (Multi Position Splits today). The three
    // capacity targets REPLACE the nominal cooling/sensible/heat-pump
    // schema targets in the form; when design conditions are entered they
    // are evaluated against the capacity curves, otherwise they fall back
    // to the same nominal-column comparison the schema targets used.
    function freshCapacityState() {
        return {
            coolOa: null, coolDb: null, coolWb: null, // cooling design conditions (deg F)
            hpOa: null,                               // heat-pump design ambient (deg F; coil EAT fixed at 70)
            targets: { coolTotal: null, coolSensible: null, hpHeating: null }, // BTU/H
            tols:    { coolTotal: 10,   coolSensible: 10,   hpHeating: 10 }    // percent
        };
    }

    var CAP_TARGET_DEFS = [
        { key: 'coolTotal',    label: 'Cooling Total Capacity',    unit: 'BTU/H' },
        { key: 'coolSensible', label: 'Cooling Sensible Capacity', unit: 'BTU/H' },
        { key: 'hpHeating',    label: 'Heat Pump Heating Capacity', unit: 'BTU/H' }
    ];

    function capacityUiActive() {
        return !!(HHpro.Capacity && HHpro.Capacity.isProduct(state.productKey) &&
                  HHpro.Capacity.hasTables(state.productKey) && state.productData);
    }

    // Nominal schedule column letter behind each capacity target (used
    // both to hide the duplicated schema targets and as the fallback
    // comparison for systems without capacity tables). hpHeatingAll
    // carries EVERY heat-pump total letter (indoor summary + outdoor
    // duplicate) so both spellings of the schema target hide.
    function capacityNominalCols() {
        var cols = HHpro.Capacity.columnsFor(state.productData);
        return {
            coolTotal:    cols.coolTotal || null,
            coolSensible: cols.coolSensible || null,
            hpHeating:    (cols.hpTotalCols && cols.hpTotalCols[0]) || null,
            hpHeatingAll: (cols.hpTotalCols || []).slice()
        };
    }

    HHpro.Views.design_search = {
        /**
         * params.productKey (optional) opens the page on that category -
         * the "Design Search" button on each product page passes it.
         * Coming back to the category already on screen keeps the
         * entered targets and results.
         *
         * params.configure (LC RTU "Configure" button, see
         * GasPackDesign.configureFor) starts a fresh search narrowed to
         * that unit and runs it. Applied once per click: coming back to
         * the page through browser history keeps what was changed since.
         */
        render: function (root, params) {
            var requested = params && params.productKey;
            var configure = params && params.configure;
            var loadKey = null;
            if (requested && isSearchableProduct(requested)) {
                if (configure && configure.token !== state.configureToken) {
                    selectCategory(requested);
                    state.configureToken = configure.token;
                    state.pendingConfigure = configure;
                    loadKey = requested;
                } else if (requested !== state.productKey) {
                    selectCategory(requested);
                    loadKey = requested;
                } else if (!state.productData && !state.loading) {
                    loadKey = requested;
                }
            }

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
            if (loadKey) loadProductData(loadKey);
        }
    };

    // Products offered in the category picker: allowed for this account
    // (Data.getProducts) and not flagged excludeFromDesignSearch.
    function isSearchableProduct(productKey) {
        return HHpro.Data.getProducts().some(function (p) {
            return p.productKey === productKey && !p.excludeFromDesignSearch;
        });
    }

    // Switch the form to another category. The previously-entered values
    // are wiped - they reference column letters that don't apply to the
    // new category's schema. The caller loads the product data.
    function selectCategory(key) {
        state.productKey = key;
        state.productData = null;
        state.targetValues = {};
        state.tolerances = {};
        state.filterValues = {};
        state.results = null;
        state.loading = false;
        state.error = null;
        state.capacity = freshCapacityState();
        state.capacityError = null;
        state.gasPack = freshGasPackState();
        state.gasPackError = null;
        state.pendingConfigure = null;
    }

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
            // Products flagged in data.js (GPS: per-sub-schedule column
            // sets make tolerance targets meaningless) stay out of the
            // category picker entirely.
            if (p.excludeFromDesignSearch) return;
            var opt = document.createElement('option');
            opt.value = p.productKey;
            opt.textContent = p.displayName || p.productKey;
            if (state.productKey === p.productKey) opt.selected = true;
            select.appendChild(opt);
        });

        select.addEventListener('change', function () {
            var key = select.value || null;
            if (key === state.productKey) return;
            selectCategory(key);
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
                // Capacity tables must be resolved before the form renders
                // so the condition-aware section knows whether it applies.
                // Routed through the registry so any product with tables --
                // Multi Position Splits, Gas Pack RTUs -- resolves here.
                if (HHpro.CapacityCore && HHpro.CapacityCore.ensureFor) {
                    return HHpro.CapacityCore.ensureFor(productKey)
                        .then(function () { return data; });
                }
                return data;
            })
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

                // "Configure" from the LC RTU schedule: narrow the form to
                // that unit and show it straight away.
                var cfg = state.pendingConfigure;
                state.pendingConfigure = null;
                if (cfg && gasPackUiActive() && applyGasPackConfigure(cfg)) {
                    runGasPackSearch();
                    return;
                }

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
        if (!work) return;
        // Preserve the form's internal scroll position across re-renders
        // so toggling NUMBER OF INDOOR UNITS doesn't jump the user back
        // to the top of the form.
        var prevForm = work.querySelector('.design-search-form');
        var savedScroll = prevForm ? prevForm.scrollTop : 0;
        renderWorkArea(work);
        var newForm = work.querySelector('.design-search-form');
        if (newForm) newForm.scrollTop = savedScroll;
    }

    function renderWorkArea(work) {
        work.innerHTML = '';
        if (!state.productKey) {
            return; // nothing to show until a category is picked
        }
        if (state.loading) {
            // Centered card with the shared spinner so the two-pane
            // layout keeps its footprint instead of collapsing to a
            // single line of text while data fetches.
            var loadingBox = document.createElement('div');
            loadingBox.className = 'design-search-loading';
            var spinner = document.createElement('div');
            spinner.className = 'hh-spinner';
            loadingBox.appendChild(spinner);
            var msg = document.createElement('p');
            msg.className = 'design-search-status';
            msg.textContent = 'Loading product data...';
            loadingBox.appendChild(msg);
            work.appendChild(loadingBox);
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
        // Shared dashed-well empty state (base.css .hh-empty) with the
        // search icon, so the pane reads "nothing here yet" instead of
        // looking like a broken panel.
        var msg = document.createElement('div');
        msg.className = 'hh-empty design-search-placeholder';
        msg.appendChild(HHpro.UI.icon('search'));
        var title = document.createElement('div');
        title.className = 'hh-empty-title';
        title.textContent = 'No search run yet';
        msg.appendChild(title);
        var hint = document.createElement('div');
        hint.className = 'hh-empty-hint';
        hint.textContent = 'Enter design targets and click "Find matches" to see equipment that fits.';
        msg.appendChild(hint);
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

        // Gas Pack RTUs replace the whole schema-driven form -- targets AND
        // filter dropdowns -- with one condition-aware panel. Their schedule
        // filters still exist on the product page; this page is a different
        // question. (Everything below this block is skipped for them.)
        if (gasPackUiActive()) {
            form.appendChild(buildGasPackSection());
            form.appendChild(buildFormActions(function () {
                state.gasPack = freshGasPackState();
                state.gasPackError = null;
                state.results = null;
            }));
            return form;
        }

        // Condition-aware capacity section (products with capacity
        // tables). Its three capacity targets replace the nominal
        // cooling/sensible/heat-pump schema targets, so those are hidden
        // from the Design targets grid below to avoid double entry.
        var capUi = capacityUiActive();
        var hiddenTargetCols = {};
        if (capUi) {
            var ncols = capacityNominalCols();
            [ncols.coolTotal, ncols.coolSensible]
                .concat(ncols.hpHeatingAll)
                .forEach(function (L) { if (L) hiddenTargetCols[L] = true; });
            form.appendChild(buildCapacitySection());
        }

        // Target rows -- each line is "[label]: [value] ± [tolerance]% [unit]"
        var visibleTargets = schema.targets.filter(function (t) {
            return !hiddenTargetCols[t.col];
        });
        if (visibleTargets.length) {
            var targetsBox = document.createElement('section');
            targetsBox.className = 'design-search-section';
            var hdr = document.createElement('h2');
            hdr.className = 'design-search-section-title';
            hdr.textContent = capUi ? 'Other design targets' : 'Design targets';
            targetsBox.appendChild(hdr);

            var hint = document.createElement('p');
            hint.className = 'design-search-hint';
            hint.textContent = 'Leave a row blank to skip it. Tolerance is the +/- percent the result can differ from your target.';
            targetsBox.appendChild(hint);

            var grid = document.createElement('div');
            grid.className = 'design-target-grid';
            visibleTargets.forEach(function (t) {
                grid.appendChild(buildTargetRow(t));
            });
            targetsBox.appendChild(grid);
            form.appendChild(targetsBox);
        }

        // Filter dropdowns -- same UX as the main product page, including
        // per-product visibility logic (e.g. mini splits hides SIZE/TYPE
        // (INDOOR UNIT #N) until NUMBER OF INDOOR UNITS is picked, then
        // shows only the relevant N rows). Prune any stored values that
        // refer to currently-hidden filters so a stale "SIZE (INDOOR
        // UNIT #5)" doesn't silently affect search after the user drops
        // the unit count down to 1.
        var visibleFilters = HHpro.Schedule.getVisibleFilters(state.productKey, data, state.filterValues);
        HHpro.Schedule.pruneFilterValues(state.filterValues, visibleFilters);
        if (visibleFilters.length) {
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
            visibleFilters.forEach(function (fc) {
                fgrid.appendChild(buildFilterDropdown(fc, data));
            });
            filtersBox.appendChild(fgrid);
            form.appendChild(filtersBox);
        }

        form.appendChild(buildFormActions(function () {
            state.targetValues = {};
            state.filterValues = {};
            state.results = null;
            state.capacity = freshCapacityState();
            state.capacityError = null;
            // Re-seed default tolerances
            schema.targets.forEach(function (t) {
                state.tolerances[t.col] = (t.defaultTolerance != null ? t.defaultTolerance : 10);
            });
        }));

        return form;
    }

    // Find matches / Reset. clearState wipes whatever the active form owns.
    function buildFormActions(clearState) {
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
            clearState();
            rerenderWorkArea();
        });
        actions.appendChild(reset);
        return actions;
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

    // -----------------------------------------------------------------
    // Performance at design conditions (condition-aware capacity search)
    // -----------------------------------------------------------------

    function buildCapacitySection() {
        var box = document.createElement('section');
        box.className = 'design-search-section design-capacity-section';

        var hdr = document.createElement('h2');
        hdr.className = 'design-search-section-title';
        hdr.textContent = 'Performance at design conditions';
        box.appendChild(hdr);

        var hint = document.createElement('p');
        hint.className = 'design-search-hint';
        hint.textContent = 'Systems with capacity tables are verified at these conditions. ' +
            'A condition between rated points is evaluated at the bracketing rated points ' +
            'with the worst case shown. Leave the conditions blank to compare nominal ratings instead.';
        box.appendChild(hint);

        var condGrid = document.createElement('div');
        condGrid.className = 'design-cond-grid';
        condGrid.appendChild(buildCondGroup('Cooling conditions', [
            buildCondField('OA Ambient', 'coolOa'),
            buildCondField('Coil EAT (DB)', 'coolDb'),
            buildCondField('Coil EAT (WB)', 'coolWb')
        ]));
        condGrid.appendChild(buildCondGroup('Heat pump heating conditions', [
            buildCondField('OA Ambient', 'hpOa'),
            buildFixedCondField('Coil EAT (DB)', '70')
        ]));
        box.appendChild(condGrid);

        var grid = document.createElement('div');
        grid.className = 'design-target-grid';
        CAP_TARGET_DEFS.forEach(function (def) {
            grid.appendChild(buildCapTargetRow(def));
        });
        box.appendChild(grid);

        if (state.capacityError) {
            var err = document.createElement('p');
            err.className = 'design-search-status design-search-error';
            err.textContent = state.capacityError;
            box.appendChild(err);
        }

        return box;
    }

    function buildCondGroup(title, fields) {
        var group = document.createElement('div');
        group.className = 'design-cond-group';
        var lbl = document.createElement('div');
        lbl.className = 'design-cond-group-title';
        lbl.textContent = title;
        group.appendChild(lbl);
        var row = document.createElement('div');
        row.className = 'design-cond-fields';
        fields.forEach(function (f) { row.appendChild(f); });
        group.appendChild(row);
        return group;
    }

    function buildCondField(labelText, key) {
        var wrap = document.createElement('div');
        wrap.className = 'design-cond-field';
        var label = document.createElement('label');
        label.className = 'design-cond-label';
        label.textContent = labelText;
        wrap.appendChild(label);
        var input = document.createElement('input');
        input.type = 'number';
        input.className = 'design-cond-value';
        input.step = 'any';
        input.placeholder = '—';
        input.setAttribute('aria-label', labelText + ' (°F)');
        if (state.capacity[key] != null) input.value = state.capacity[key];
        input.addEventListener('input', function () {
            var raw = input.value.trim();
            state.capacity[key] = raw === '' ? null : parseFloat(raw);
        });
        wrap.appendChild(input);
        var unit = document.createElement('span');
        unit.className = 'design-cond-unit';
        unit.textContent = '°F';
        wrap.appendChild(unit);
        return wrap;
    }

    // Heat-pump tables are all rated at 70F coil EAT today, so that
    // condition renders as a fixed value instead of an input. When
    // EAT-varying heating tables are added later this becomes a real
    // field like the others.
    function buildFixedCondField(labelText, valueText) {
        var wrap = document.createElement('div');
        wrap.className = 'design-cond-field';
        var label = document.createElement('label');
        label.className = 'design-cond-label';
        label.textContent = labelText;
        wrap.appendChild(label);
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'design-cond-value design-cond-fixed';
        input.value = valueText;
        input.disabled = true;
        input.title = 'Heat pump capacity tables are rated at ' + valueText + ' °F entering air.';
        wrap.appendChild(input);
        var unit = document.createElement('span');
        unit.className = 'design-cond-unit';
        unit.textContent = '°F';
        wrap.appendChild(unit);
        return wrap;
    }

    function buildCapTargetRow(def) {
        var row = document.createElement('div');
        row.className = 'design-target-row';

        var label = document.createElement('label');
        label.className = 'design-target-label';
        label.textContent = def.label;
        row.appendChild(label);

        var valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.className = 'design-target-value';
        valueInput.step = 'any';
        valueInput.placeholder = '—';
        valueInput.setAttribute('aria-label', def.label + ' (' + def.unit + ')');
        if (state.capacity.targets[def.key] != null) {
            valueInput.value = state.capacity.targets[def.key];
        }
        valueInput.addEventListener('input', function () {
            var raw = valueInput.value.trim();
            state.capacity.targets[def.key] = raw === '' ? null : parseFloat(raw);
        });
        row.appendChild(valueInput);

        var unit = document.createElement('span');
        unit.className = 'design-target-unit';
        unit.textContent = def.unit;
        row.appendChild(unit);

        var plusMinus = document.createElement('span');
        plusMinus.className = 'design-target-plusminus';
        plusMinus.textContent = '±';
        row.appendChild(plusMinus);

        var tolInput = document.createElement('input');
        tolInput.type = 'number';
        tolInput.className = 'design-target-tolerance';
        tolInput.step = 'any';
        tolInput.min = '0';
        tolInput.setAttribute('aria-label', def.label + ' tolerance (%)');
        tolInput.value = state.capacity.tols[def.key] != null ? state.capacity.tols[def.key] : 10;
        tolInput.addEventListener('input', function () {
            var raw = tolInput.value.trim();
            state.capacity.tols[def.key] = raw === '' ? 0 : parseFloat(raw);
        });
        row.appendChild(tolInput);

        var pct = document.createElement('span');
        pct.className = 'design-target-pct';
        pct.textContent = '%';
        row.appendChild(pct);

        return row;
    }

    // -----------------------------------------------------------------
    // Gas Pack RTUs -- condition-aware form
    // -----------------------------------------------------------------

    // `cap`: a capacity, so "Meet or exceed" turns it into a minimum (the
    // tolerance box becomes the oversize cap). Supply CFM stays ± either
    // way. `load`: always a minimum, with no tolerance. `short` names the
    // target in the results' vs Target column; `actual` reads it off a result.
    var GP_NUMERIC = [
        { key: 'cfm', label: 'Supply CFM', unit: 'CFM', short: 'CFM',
          actual: function (r) { return r.cooling.airflow; } },
        { key: 'coolTotal', label: 'Cooling Total Capacity', unit: 'BTU/h', cap: true, short: 'Total',
          actual: function (r) { return r.cooling.total; } },
        { key: 'coolSensible', label: 'Cooling Sensible Capacity', unit: 'BTU/h', cap: true, short: 'Sens',
          actual: function (r) { return r.cooling.sensible; } },
        { key: 'heatRise', label: 'Gas Heating High Stage Temp Rise', unit: '°F', cap: true, short: 'Rise',
          type: 'GAS', actual: function (r) { return r.heat ? r.heat.riseHigh : null; } },
        { key: 'hpHeating', label: 'Heat Pump Heating Capacity', unit: 'BTU/h', cap: true, short: 'HP heat',
          type: 'HEAT PUMP', actual: function (r) { return r.hpHeat ? r.hpHeat.capacity : null; } },
        { key: 'heatLoad', label: 'Heating Load (heat pump + electric heat)', unit: 'BTU/h', load: true,
          short: 'Heat load', type: 'HEAT PUMP',
          actual: function (r) { return r.totalHeat; } }
    ];

    // The criteria target for a form row: a band, or a minimum.
    function gpTarget(def) {
        var gp = state.gasPack;
        var v = gp[def.key];
        if (def.load) return { value: v, min: true };
        var min = gp.mode === 'min' && !!def.cap;
        return { value: v, tol: min ? gp.caps[def.key] : gp.tols[def.key], min: min };
    }

    // Picking a Type re-scopes every other list to that unit type. Any
    // choice the new type can't have (Variable Speed or a heat kit on Gas,
    // hot gas reheat or 25 tons on Heat Pump, the other type's heating
    // target) is cleared, so a control that is no longer shown can't keep
    // filtering the search.
    function pruneGasPackForType() {
        var gp = state.gasPack;
        var opts = HHpro.GasPackCapacity.formOptions(gp.type);
        function keep(key, choices) {
            if (gp[key] == null) return;
            var ok = choices.some(function (c) { return String(c.value) === String(gp[key]); });
            if (!ok) gp[key] = null;
        }
        keep('tons', opts.tons.map(function (t) { return { value: t }; }));
        keep('efficiency', opts.efficiencies);
        keep('electrical', opts.electrical.map(function (v) { return { value: v }; }));
        keep('kw', opts.kits);
        if (!opts.hgrh) gp.hgrh = null;
        if (!opts.hasGas) gp.heatRise = null;
        if (!opts.hasHeatPump) { gp.hpHeating = null; gp.heatLoad = null; }
    }

    // "Configure" on an LC RTU schedule row (GasPackDesign.configureFor):
    // pin the form to that unit - type, tons and efficiency single out the
    // cabinet - with its voltage, motor and hot gas reheat, plus whatever
    // conditions and electrical options a design-values row carried. The
    // heat size / kit and CFM are not form inputs: gp.configure steers the
    // results row to them (configuredStart). false = no tables for it.
    function applyGasPackConfigure(cfg) {
        var cab = HHpro.GasPackCapacity.cabinets()[cfg.cabinet];
        if (!cab) return false;
        var gp = state.gasPack;
        gp.type = cab.type || 'GAS';
        gp.tons = cab.tons;
        gp.efficiency = cab.efficiency;
        gp.electrical = (cab.electrical && cab.electrical[cfg.voltage]) ? cfg.voltage : null;
        // The motor is picked on the result row (configure.motor below).
        gp.motor = null;
        gp.hgrh = gp.type === 'GAS' ? (cfg.hgrh === 'YES' ? 'YES' : 'NO') : null;
        ['ambient', 'eatDb', 'eatWb', 'heatAmbient'].forEach(function (k) {
            if (cfg[k] != null) gp[k] = cfg[k];
        });
        gp.convOutlet = !!cfg.convOutlet;
        gp.powerExhaust = !!cfg.powerExhaust;
        gp.configure = {
            // What the banner calls the unit (the row it came from).
            label: cfg.model + (gp.type !== 'HEAT PUMP' ? ''
                : (cfg.kitKw ? ' with ' + cfg.kitKw + ' kW electric heat' : ' (no electric heat)')),
            cabinet: cfg.cabinet,
            heatSize: cfg.heatSize || null, kitKw: cfg.kitKw, cfm: cfg.cfm,
            motor: cfg.motor || null,
            convOutlet: !!cfg.convOutlet, powerExhaust: !!cfg.powerExhaust
        };
        // Configure from a project schedule row: every result's button
        // replaces that unit ({ instanceId, projectId, mode, tag, model }).
        // Kept apart from `configure`, so it survives a change of size.
        gp.replace = null;
        if (cfg.replace) {
            gp.replace = { model: cfg.model };
            Object.keys(cfg.replace).forEach(function (k) { gp.replace[k] = cfg.replace[k]; });
        }
        // The search runs before the form renders: settle the conditions
        // on published values for this unit first.
        reconcileGasPackConditions();
        return true;
    }

    // The configured unit stops applying once the form is pointed at
    // another cabinet (Type, Tons or Efficiency changed).
    function configuredCabinetInScope() {
        var gp = state.gasPack;
        var cab = gp.configure && HHpro.GasPackCapacity.cabinets()[gp.configure.cabinet];
        return !!(cab && (cab.type || 'GAS') === gp.type &&
                  Number(cab.tons) === Number(gp.tons) && cab.efficiency === gp.efficiency);
    }

    // "Configuring DSG0363DL ..." (cfg = gp.configure, may be null) and/or
    // "Replacing RTU-1 ..." (rep = gp.replace, may be null).
    function buildConfigureBanner(cfg, rep) {
        var box = document.createElement('div');
        box.className = 'design-gp-configure';
        var unit = rep ? (rep.tag ? rep.tag + ' (' + rep.model + ')' : rep.model) : null;
        var strong = document.createElement('strong');
        var text;
        if (cfg) {
            strong.textContent = 'Configuring ' + (rep ? unit + ' from your project' : cfg.label) + '. ';
            text = 'The search is narrowed to this unit. Change the motor, power exhaust or outlet on ' +
                'the result row; change hot gas reheat or the design conditions here and click Find ' +
                'matches. ' + (rep
                    ? 'Replace swaps the unit on your project schedule, keeping its tag and place. '
                    : 'Select puts the result on its schedule row. ') +
                'Reset searches every unit again.';
        } else {
            strong.textContent = 'Replacing ' + unit + ' on your project. ';
            text = 'Replace on any result swaps it in, keeping its tag and place in the schedule.';
        }
        box.appendChild(strong);
        box.appendChild(document.createTextNode(text));
        if (rep) {
            var stop = document.createElement('button');
            stop.type = 'button';
            stop.className = 'projects-btn projects-btn-secondary design-gp-configure-stop';
            stop.textContent = 'Don’t replace';
            stop.title = 'Results go back to Select (to the product page) instead of replacing ' + unit;
            stop.addEventListener('click', function () {
                state.gasPack.replace = null;
                rerenderWorkArea();
            });
            box.appendChild(stop);
        }
        return box;
    }

    // The conditions the manual selections were run at (and the AHRI 17 F
    // heat pump point) - the defaults whenever the tables publish them.
    var GP_DEFAULT_CONDITIONS = { ambient: 95, eatDb: 80, eatWb: 67, heatAmbient: 17 };

    // Design conditions are picked from the values the capacity tables
    // publish for the units in scope (Type, Tons, Efficiency; the WB list
    // also follows the EAT DB). When a filter change takes away the current
    // pick, fall back to the default if it is offered, else the nearest
    // published value. Returns the form options for that scope.
    function reconcileGasPackConditions() {
        var gp = state.gasPack;
        var G = HHpro.GasPackCapacity;
        function pick(key, list) {
            if (!list.length) { gp[key] = null; return; }
            var cur = (gp[key] == null) ? NaN : Number(gp[key]);
            if (list.indexOf(cur) >= 0) return;
            var d = GP_DEFAULT_CONDITIONS[key];
            if (list.indexOf(d) >= 0) { gp[key] = d; return; }
            var ref = isFinite(cur) ? cur : d;
            gp[key] = list.reduce(function (best, v) {
                return Math.abs(v - ref) < Math.abs(best - ref) ? v : best;
            }, list[0]);
        }
        var opts = G.formOptions(gp.type, { tons: gp.tons, efficiency: gp.efficiency });
        pick('ambient', opts.ambients);
        pick('eatDb', opts.eatDbs);
        opts = G.formOptions(gp.type, { tons: gp.tons, efficiency: gp.efficiency, eatDb: gp.eatDb });
        pick('eatWb', opts.eatWbs);
        if (opts.hasHeatPump) pick('heatAmbient', opts.heatAmbients);
        return opts;
    }

    function gpValueChoices(values) {
        return values.map(function (v) { return { value: String(v), label: String(v) }; });
    }

    // A titled block of dropdowns, laid out like the unit constraints.
    function gpCondGroup(title, nodes) {
        var group = document.createElement('div');
        group.className = 'design-cond-group';
        var lbl = document.createElement('div');
        lbl.className = 'design-cond-group-title';
        lbl.textContent = title;
        group.appendChild(lbl);
        var grid = document.createElement('div');
        grid.className = 'design-filter-grid';
        nodes.forEach(function (n) { grid.appendChild(n); });
        group.appendChild(grid);
        return group;
    }

    function buildGasPackSection() {
        var G = HHpro.GasPackCapacity;
        var gp = state.gasPack;
        var opts = reconcileGasPackConditions();
        // Filters that change which conditions are published re-render the
        // form so the condition lists follow them.
        function rescope() { rerenderWorkArea(); }

        var box = document.createElement('section');
        box.className = 'design-search-section design-capacity-section';

        var hdr = document.createElement('h2');
        hdr.className = 'design-search-section-title';
        hdr.textContent = 'Performance at design conditions';
        box.appendChild(hdr);

        if (gp.configure && !configuredCabinetInScope()) gp.configure = null;
        if (gp.configure || gp.replace) box.appendChild(buildConfigureBanner(gp.configure, gp.replace));

        var hint = document.createElement('p');
        hint.className = 'design-search-hint';
        hint.textContent = 'Results come from Daikin’s published capacity tables, not from the ' +
            'schedule’s stored selection. Conditions are picked from the values those tables ' +
            'publish, so every number shown is a rated point; a unit with no rating at the ' +
            'chosen condition is left out.';
        box.appendChild(hint);

        // ----- Unit constraints -----
        var fgrid = document.createElement('div');
        fgrid.className = 'design-filter-grid';
        if (opts.types.length > 1) {
            fgrid.appendChild(gpSelect('Type', 'type', opts.types, false, function () {
                pruneGasPackForType();
                rerenderWorkArea();
            }));
        }
        fgrid.appendChild(gpSelect('Nominal Tons', 'tons', gpValueChoices(opts.tons), false, rescope));
        fgrid.appendChild(gpSelect('Efficiency', 'efficiency', opts.efficiencies, false, rescope));
        fgrid.appendChild(gpSelect('Electrical', 'electrical',
            opts.electrical.map(function (v) { return { value: v, label: v }; })));
        fgrid.appendChild(gpSelect('Motor', 'motor', opts.motors));
        if (opts.hgrh) {
            fgrid.appendChild(gpSelect('Hot Gas Reheat', 'hgrh', [
                { value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }
            ]));
        }
        if (opts.kits.length) {
            fgrid.appendChild(gpSelect('Electric Heat (Heat Pump)', 'kw', opts.kits));
        }
        box.appendChild(fgrid);

        // ----- Design conditions -----
        // Picked, not typed: each list holds only the values the tables
        // publish for the units in scope, so nothing is ever read off-grid.
        var hasHp = opts.hasHeatPump;
        var condGrid = document.createElement('div');
        condGrid.className = 'design-cond-grid design-gp-conds';
        // A value only some unit families publish is labelled with them
        // ("22 (DVH only)"): pick it and the others have no rating to show.
        condGrid.appendChild(gpCondGroup('Cooling', [
            gpSelect('Outdoor Ambient DB (°F)', 'ambient', opts.ambientChoices, true),
            gpSelect('Cooling EAT DB (°F)', 'eatDb', opts.eatDbChoices, true, rescope),
            gpSelect('Cooling EAT WB (°F)', 'eatWb', opts.eatWbChoices, true)
        ]));
        if (hasHp) {
            condGrid.appendChild(gpCondGroup('Heat pump heating (70 °F EAT)', [
                gpSelect('Heating Outdoor Ambient DB (°F)', 'heatAmbient',
                    opts.heatAmbientChoices, true)
            ]));
        }
        box.appendChild(condGrid);
        if (hasHp) {
            var hpHint = document.createElement('p');
            hpHint.className = 'design-search-hint';
            hpHint.textContent = 'DVH tables are rated on outdoor wet bulb, so a DVH unit is ' +
                'read at DB − ' + G.HP_WB_DEPRESSION + ' °F and shows heating only where ' +
                'that wet bulb is published.';
            box.appendChild(hpHint);
        }

        // ----- Targets -----
        // Within ± tolerance, or meet or exceed (smallest unit first).
        var modeRow = document.createElement('div');
        modeRow.className = 'design-gp-mode';
        modeRow.setAttribute('role', 'radiogroup');
        modeRow.setAttribute('aria-label', 'Target mode');
        [{ value: 'band', label: 'Within ± tolerance' },
         { value: 'min', label: 'Meet or exceed (smallest first)' }].forEach(function (m) {
            var lab = document.createElement('label');
            lab.className = 'design-gp-check';
            var input = document.createElement('input');
            input.type = 'radio';
            input.name = 'design-gp-mode';
            input.checked = gp.mode === m.value;
            input.addEventListener('change', function () {
                if (!input.checked) return;
                gp.mode = m.value;
                rerenderWorkArea();
            });
            lab.appendChild(input);
            var span = document.createElement('span');
            span.textContent = m.label;
            lab.appendChild(span);
            modeRow.appendChild(lab);
        });
        box.appendChild(modeRow);

        var thint = document.createElement('p');
        thint.className = 'design-search-hint';
        thint.textContent = gp.mode === 'min'
            ? 'Leave a row blank to skip it. Each capacity must be met or exceeded, and the ' +
              'closest fit is listed first; "cap" limits how far above the target a unit can ' +
              'be (blank = no limit). Supply CFM is still ± tolerance.'
            : 'Leave a row blank to skip it. Tolerance is the +/- percent the result ' +
              'can differ from your target.';
        box.appendChild(thint);

        var grid = document.createElement('div');
        grid.className = 'design-target-grid';
        GP_NUMERIC.forEach(function (def) {
            // Each unit type's heating target only while that type is in scope.
            if (def.type === 'GAS' && !opts.hasGas) return;
            if (def.type === 'HEAT PUMP' && !opts.hasHeatPump) return;
            grid.appendChild(gpTargetRow(def));
        });
        box.appendChild(grid);
        if (opts.hasHeatPump) {
            var loadHint = document.createElement('p');
            loadHint.className = 'design-search-hint';
            loadHint.textContent = 'Heating Load: heat pump capacity at the heating outdoor ' +
                'temperature plus the electric heat kit (kW × ' + G.KW_BTUH.toLocaleString() +
                ') must cover it. Each unit opens on the smallest kit that does.';
            box.appendChild(loadHint);
        }

        // ----- Electrical options -----
        var optBox = document.createElement('div');
        optBox.className = 'design-cond-group design-gp-options';
        var optTitle = document.createElement('div');
        optTitle.className = 'design-cond-group-title';
        optTitle.textContent = 'Electrical options';
        optBox.appendChild(optTitle);
        var optRow = document.createElement('div');
        optRow.className = 'design-cond-fields';
        optRow.appendChild(gpCheckbox('Powered Convenience Outlet', 'convOutlet'));
        optRow.appendChild(gpCheckbox('Power Exhaust', 'powerExhaust'));
        optBox.appendChild(optRow);
        box.appendChild(optBox);

        if (state.gasPackError) {
            var err = document.createElement('p');
            err.className = 'design-search-status design-search-error';
            err.textContent = state.gasPackError;
            box.appendChild(err);
        }
        return box;
    }

    // Dropdown bound to a gasPack state key. `required` drops the "All"
    // option; `onChange` runs after the state is updated.
    function gpSelect(labelText, key, choices, required, onChange) {
        var group = document.createElement('div');
        group.className = 'filter-group';

        var label = document.createElement('label');
        label.className = 'filter-label';
        label.textContent = labelText;
        group.appendChild(label);

        var select = document.createElement('select');
        select.className = 'filter-select';
        select.setAttribute('aria-label', labelText);

        if (!required) {
            var all = document.createElement('option');
            all.value = '';
            all.textContent = 'All';
            select.appendChild(all);
        }
        var current = state.gasPack[key];
        choices.forEach(function (c) {
            var opt = document.createElement('option');
            opt.value = c.value;
            opt.textContent = c.label;
            if (current != null && String(current) === String(c.value)) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener('change', function () {
            var raw = select.value;
            if (raw === '') {
                state.gasPack[key] = null;
            } else {
                var n = parseFloat(raw);
                state.gasPack[key] = (String(n) === raw) ? n : raw;
            }
            if (typeof onChange === 'function') onChange();
        });
        group.appendChild(select);
        return group;
    }

    function gpTargetRow(def) {
        var row = document.createElement('div');
        row.className = 'design-target-row';

        var label = document.createElement('label');
        label.className = 'design-target-label';
        label.textContent = def.label;
        row.appendChild(label);

        var valueInput = document.createElement('input');
        valueInput.type = 'number';
        valueInput.className = 'design-target-value';
        valueInput.step = 'any';
        valueInput.placeholder = '—';
        valueInput.setAttribute('aria-label', def.label + ' (' + def.unit + ')');
        if (state.gasPack[def.key] != null) valueInput.value = state.gasPack[def.key];
        valueInput.addEventListener('input', function () {
            var raw = valueInput.value.trim();
            state.gasPack[def.key] = raw === '' ? null : parseFloat(raw);
        });
        row.appendChild(valueInput);

        var unit = document.createElement('span');
        unit.className = 'design-target-unit';
        unit.textContent = def.unit;
        row.appendChild(unit);

        var pm = document.createElement('span');
        pm.className = 'design-target-plusminus';
        row.appendChild(pm);

        // A heating load is always a minimum: nothing to set.
        if (def.load) {
            pm.textContent = 'minimum';
            pm.classList.add('design-target-min');
            return row;
        }

        // Meet or exceed: the box is the oversize cap (blank = none).
        var capMode = state.gasPack.mode === 'min' && !!def.cap;
        var store = capMode ? state.gasPack.caps : state.gasPack.tols;
        pm.textContent = capMode ? 'cap +' : '±';
        if (capMode) {
            pm.title = 'No more than this percent above the target. Leave blank for no limit.';
        }

        var tolInput = document.createElement('input');
        tolInput.type = 'number';
        tolInput.className = 'design-target-tolerance';
        tolInput.step = 'any';
        tolInput.min = '0';
        if (capMode) tolInput.placeholder = 'none';
        tolInput.setAttribute('aria-label', def.label + (capMode ? ' oversize cap (%)' : ' tolerance (%)'));
        if (store[def.key] != null) tolInput.value = store[def.key];
        tolInput.addEventListener('input', function () {
            var raw = tolInput.value.trim();
            store[def.key] = raw === '' ? (capMode ? null : 0) : parseFloat(raw);
        });
        row.appendChild(tolInput);

        var pct = document.createElement('span');
        pct.className = 'design-target-pct';
        pct.textContent = '%';
        row.appendChild(pct);
        return row;
    }

    function gpCheckbox(labelText, key) {
        var wrap = document.createElement('label');
        wrap.className = 'design-gp-check';
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!state.gasPack[key];
        input.addEventListener('change', function () {
            state.gasPack[key] = input.checked;
        });
        wrap.appendChild(input);
        var text = document.createElement('span');
        text.textContent = labelText;
        wrap.appendChild(text);
        return wrap;
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
            // Re-render so per-product visibility logic kicks in -- e.g.
            // changing NUMBER OF INDOOR UNITS on mini splits should hide
            // or reveal the matching SIZE/TYPE rows.
            rerenderWorkArea();
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
        // Same order as the product page filters: numbers ascending
        // (fractions like "3/4" by value), strings alphabetical.
        out.sort(HHpro.Schedule.compareFilterValues);
        return out;
    }

    // -----------------------------------------------------------------
    // Search execution
    // -----------------------------------------------------------------

    function runSearch() {
        var data = state.productData;
        if (!data) return;
        state.capacityError = null;

        if (gasPackUiActive()) { runGasPackSearch(); return; }

        // 1. Hard constraints first (existing filter logic).
        var afterFilters = HHpro.Schedule.applyFilters(
            data.selections || [],
            state.filterValues
        );

        // 2. Build the active target list -- only targets the user actually
        //    entered a value for. Tolerances default to 0 if unset (exact
        //    match), but the schema pre-fills sensible defaults so this
        //    rarely matters. (Capacity-replaced schema targets never render
        //    when the capacity section is active, so no overlap here.)
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

        // 3. Condition-aware capacity query (null when the section is
        //    absent or untouched).
        var capQ = buildCapacityQuery();
        if (capQ && capQ.problems.length) {
            state.capacityError = capQ.problems.join(' ');
            state.results = null;
            rerenderWorkArea();
            return;
        }

        // Stale seeds from a previous capacity search must not leak into
        // the next results table.
        (data.selections || []).forEach(function (sel) { delete sel.__capacitySeed; });

        if (!capQ || (!capQ.useCool && !capQ.useHp)) {
            // Capacity targets entered without design conditions compare
            // against the nominal schedule columns -- the exact semantics
            // of the schema targets they replaced in the form.
            if (capQ) activeTargets = activeTargets.concat(capQ.nominalTargets);
            runPlainSearch(afterFilters, activeTargets, data);
            return;
        }
        runCapacitySearch(afterFilters, activeTargets, data, capQ);
    }

    // The pre-capacity search: every selection with at least one row
    // inside every active target's window, scored by summed % deviation.
    function runPlainSearch(afterFilters, activeTargets, data) {
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

        matched.sort(byScore);

        state.results = {
            selections: matched.map(pickSel),
            scores: matched,
            allCount: (data.selections || []).length,
            activeTargets: activeTargets
        };
        rerenderWorkArea();
    }

    function byScore(a, b) { return a.score - b.score; }
    function pickSel(m) { return m.selection; }

    // Absolute % deviation, or null when it can't be computed.
    function pctDev(actual, target) {
        if (!isFinite(actual) || !isFinite(target) || target === 0) return null;
        return Math.abs(actual - target) / Math.abs(target) * 100;
    }

    // Reads the capacity-section inputs into a query object, or null when
    // the section is absent/untouched. problems[] carries validation
    // messages (partial cooling conditions etc.) that block the search.
    function buildCapacityQuery() {
        if (!capacityUiActive()) return null;
        var c = state.capacity;
        var t = c.targets;
        var condVals = [c.coolOa, c.coolDb, c.coolWb];
        var coolCondEntered  = condVals.some(function (v) { return v != null; });
        var coolCondComplete = condVals.every(function (v) { return v != null; });
        var anyTarget = t.coolTotal != null || t.coolSensible != null || t.hpHeating != null;
        if (!coolCondEntered && c.hpOa == null && !anyTarget) return null;

        var problems = [];
        if (coolCondEntered && !coolCondComplete) {
            problems.push('Enter all three cooling conditions (OA Ambient, Coil EAT DB, Coil EAT WB) to evaluate cooling performance.');
        }
        var useCool = coolCondComplete;
        var useHp = c.hpOa != null;

        function tolOf(key) {
            var v = c.tols[key];
            return (v == null || isNaN(v)) ? 0 : v;
        }

        // Capacity targets whose conditions were left blank fall back to
        // a nominal-column comparison for EVERY system.
        var ncols = capacityNominalCols();
        var nominalTargets = [];
        function nominalTarget(key, label) {
            if (t[key] == null || !ncols[key]) return;
            nominalTargets.push({
                col: ncols[key], target: t[key], tolerance: tolOf(key),
                label: label + ' (nominal)', unit: 'BTU/H'
            });
        }
        if (!useCool) {
            nominalTarget('coolTotal', 'Cooling Total Capacity');
            nominalTarget('coolSensible', 'Cooling Sensible Capacity');
        }
        if (!useHp) nominalTarget('hpHeating', 'Heat Pump Heating Capacity');

        return {
            useCool: useCool, useHp: useHp, problems: problems,
            nominalTargets: nominalTargets, ncols: ncols, tolOf: tolOf, cond: c
        };
    }

    // True when the selection is a heat pump: any row carries a numeric
    // value in the heat-pump total column (cooling-only systems show
    // "-"). Falls back to the capacity table's hp block when the column
    // couldn't be resolved.
    function hasHeatPumpData(sel, capQ, matchup) {
        var col = capQ.ncols.hpHeating;
        if (!col) return !!(matchup && matchup.hp);
        var rows = sel.rows || [];
        for (var i = 0; i < rows.length; i++) {
            var sd = rows[i] && rows[i].scheduleData;
            if (!sd) continue;
            var v = parseFloat(String(sd[col]).replace(/,/g, ''));
            if (isFinite(v) && v > 0) return true;
        }
        return false;
    }

    // Capacity targets that are being evaluated against curves, expressed
    // as nominal-column targets -- the fallback comparison for systems
    // whose tables are missing or don't cover the entered conditions.
    function capacityFallbackTargets(capQ) {
        var t = state.capacity.targets;
        var out = [];
        function add(key, label) {
            if (t[key] == null || !capQ.ncols[key]) return;
            out.push({
                col: capQ.ncols[key], target: t[key], tolerance: capQ.tolOf(key),
                label: label, unit: 'BTU/H'
            });
        }
        if (capQ.useCool) {
            add('coolTotal', 'Cooling Total Capacity');
            add('coolSensible', 'Cooling Sensible Capacity');
        }
        if (capQ.useHp) add('hpHeating', 'Heat Pump Heating Capacity');
        return out;
    }

    // Condition-aware search. Systems whose capacity tables cover the
    // entered conditions are VERIFIED against the curves (worst-case
    // rated point when a condition falls between rated points) and their
    // results table seeds the capacity dropdowns at the evaluated
    // conditions. Systems without usable tables fall back to nominal
    // comparison and surface in a second "possible solutions" group.
    function runCapacitySearch(afterFilters, activeTargets, data, capQ) {
        var c = capQ.cond, t = c.targets;
        var verified = [], nominal = [];
        var flags = { offGrid: {}, coolOutOfRange: 0, hpOutOfRange: 0, coolNoData: 0, noTable: 0 };

        function noteOffGrid(axisLabel, entered, og) {
            if (!og) return;
            var f = flags.offGrid[axisLabel] ||
                (flags.offGrid[axisLabel] = { entered: entered, pairs: {} });
            f.pairs[og.lo + ' & ' + og.hi] = true;
        }

        afterFilters.forEach(function (sel) {
            // Remaining schema targets and any nominal-mode capacity
            // targets gate every result, verified or not.
            var baseDev = 0;
            var gates = activeTargets.concat(capQ.nominalTargets);
            for (var i = 0; i < gates.length; i++) {
                var g = bestRowDeviation(sel, gates[i]);
                if (g == null) return;
                baseDev += g;
            }

            var sd = (sel.rows && sel.rows[0] && sel.rows[0].scheduleData) || {};
            var matchup = HHpro.Capacity.matchupForRow(sd, data);

            // Heat-pump conditions entered -> heat pumps ONLY, in both
            // result groups. Cooling-only systems (DC/other non-HP
            // pairings) show "-" in the heat-pump total column and have
            // no hp table, so they can't answer a heating question.
            if (capQ.useHp && !hasHeatPumpData(sel, capQ, matchup)) return;

            var coolRes = (matchup && capQ.useCool)
                ? HHpro.Capacity.coolingAt(matchup,
                    { oa: c.coolOa, eatDb: c.coolDb, eatWb: c.coolWb },
                    { total: t.coolTotal, sensible: t.coolSensible })
                : null;
            var hpRes = (matchup && capQ.useHp)
                ? HHpro.Capacity.hpAt(matchup, c.hpOa)
                : null;

            var verifiable = !!matchup;
            if (coolRes && coolRes.outOfRange) { verifiable = false; flags.coolOutOfRange++; }
            if (coolRes && coolRes.noData)     { verifiable = false; flags.coolNoData++; }
            if (hpRes && hpRes.applicable && (hpRes.outOfRange || hpRes.noData)) {
                verifiable = false;
                flags.hpOutOfRange++;
            }

            if (verifiable) {
                var capDev = 0;
                var seed = {};
                if (coolRes && coolRes.result) {
                    var r = coolRes.result;
                    seed.eatDb = r.eatDb;
                    seed.eatWb = r.eatWb;
                    seed.oaCooling = r.oaCooling;
                    seed.airflow = r.airflow;
                    noteOffGrid('Coil EAT (DB)', c.coolDb, coolRes.offGrid && coolRes.offGrid.eatDb);
                    noteOffGrid('Coil EAT (WB)', c.coolWb, coolRes.offGrid && coolRes.offGrid.eatWb);
                    noteOffGrid('Cooling OA Ambient', c.coolOa, coolRes.offGrid && coolRes.offGrid.oaCooling);
                    if (t.coolTotal != null) {
                        var dTot = pctDev(r.total, t.coolTotal);
                        if (dTot == null || dTot > capQ.tolOf('coolTotal')) return;
                        capDev += dTot;
                    }
                    if (t.coolSensible != null) {
                        var dSen = pctDev(r.sensible, t.coolSensible);
                        if (dSen == null || dSen > capQ.tolOf('coolSensible')) return;
                        capDev += dSen;
                    }
                }
                if (hpRes && hpRes.applicable) {
                    seed.hpAmbient = hpRes.ambientUsed;
                    if (hpRes.offGrid) {
                        noteOffGrid('Heat Pump OA Ambient', c.hpOa,
                            { lo: hpRes.lo.ambient, hi: hpRes.hi.ambient });
                    }
                    if (t.hpHeating != null) {
                        var dHp = pctDev(hpRes.capacity, t.hpHeating);
                        if (dHp == null || dHp > capQ.tolOf('hpHeating')) return;
                        capDev += dHp;
                    }
                }
                sel.__capacitySeed = seed;
                verified.push({ selection: sel, score: baseDev + capDev });
            } else {
                if (!matchup) flags.noTable++;
                var fallback = capacityFallbackTargets(capQ);
                var nomDev = 0;
                for (var j = 0; j < fallback.length; j++) {
                    var f = bestRowDeviation(sel, fallback[j]);
                    if (f == null) return;
                    nomDev += f;
                }
                nominal.push({ selection: sel, score: baseDev + nomDev });
            }
        });

        verified.sort(byScore);
        nominal.sort(byScore);

        state.results = {
            mode: 'capacity',
            verified: verified.map(pickSel),
            nominal: nominal.map(pickSel),
            selections: verified.concat(nominal).map(pickSel),
            allCount: (data.selections || []).length,
            activeTargets: activeTargets.concat(capQ.nominalTargets),
            capChips: buildCapChips(capQ),
            flags: buildFlagMessages(flags, capQ)
        };
        rerenderWorkArea();
    }

    function buildCapChips(capQ) {
        var c = capQ.cond, t = c.targets;
        var chips = [];
        if (capQ.useCool) {
            chips.push('Cooling @ ' + c.coolOa + '°F OA, ' + c.coolDb + '/' + c.coolWb + '°F EAT');
        }
        if (capQ.useHp) {
            chips.push('HP Heating @ ' + c.hpOa + '°F OA (70°F EAT)');
        }
        CAP_TARGET_DEFS.forEach(function (def) {
            if (t[def.key] == null) return;
            var curveMode = (def.key === 'hpHeating') ? capQ.useHp : capQ.useCool;
            if (!curveMode) return; // nominal-mode targets already chip via activeTargets
            chips.push(def.label + ' ' + t[def.key] + ' ' + def.unit + ' ±' + capQ.tolOf(def.key) + '%');
        });
        return chips;
    }

    function buildFlagMessages(flags, capQ) {
        var msgs = [];
        Object.keys(flags.offGrid).forEach(function (axisLabel) {
            var f = flags.offGrid[axisLabel];
            var pairs = Object.keys(f.pairs).join(', ');
            msgs.push(f.entered + ' °F ' + axisLabel + ' is not a rated condition. Results were ' +
                'evaluated at the bracketing rated points (' + pairs + ' °F) with the worst case ' +
                'shown -- adjust the dropdowns on any result to compare.');
        });
        if (flags.coolOutOfRange) {
            msgs.push(flags.coolOutOfRange + ' system(s) have cooling tables that do not cover these ' +
                'conditions and were compared by nominal ratings instead.');
        }
        if (flags.coolNoData) {
            msgs.push(flags.coolNoData + ' system(s) have no rated data at these cooling conditions ' +
                'and were compared by nominal ratings instead.');
        }
        if (flags.hpOutOfRange) {
            msgs.push(flags.hpOutOfRange + ' system(s) have heating tables that do not cover ' +
                capQ.cond.hpOa + ' °F and were compared by nominal ratings instead.');
        }
        return msgs;
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

    // -----------------------------------------------------------------
    // Gas Pack RTUs -- search + results
    // -----------------------------------------------------------------

    function runGasPackSearch() {
        var gp = state.gasPack;
        state.gasPackError = null;

        var missing = [];
        if (gp.ambient == null || isNaN(gp.ambient)) missing.push('Outdoor Ambient');
        if (gp.eatDb == null || isNaN(gp.eatDb)) missing.push('Cooling EAT (DB)');
        if (gp.eatWb == null || isNaN(gp.eatWb)) missing.push('Cooling EAT (WB)');
        // Heating is optional (heat pumps then list with heating blank),
        // unless a heating capacity target or load has to be judged.
        var hpTarget = (gp.hpHeating != null && !isNaN(gp.hpHeating)) ||
                       (gp.heatLoad != null && !isNaN(gp.heatLoad));
        if (hpTarget && (gp.heatAmbient == null || isNaN(gp.heatAmbient))) {
            missing.push('Heating Outdoor Ambient');
        }
        if (missing.length) {
            state.gasPackError = 'Pick ' + missing.join(', ') +
                ' — capacity can only be read at a stated condition.';
            state.results = null;
            rerenderWorkArea();
            return;
        }
        if (gp.eatWb > gp.eatDb) {
            state.gasPackError = 'Wet bulb cannot exceed dry bulb.';
            state.results = null;
            rerenderWorkArea();
            return;
        }

        var criteria = {
            type: gp.type,
            tons: gp.tons, electrical: gp.electrical, motor: gp.motor,
            efficiency: gp.efficiency, hgrh: gp.hgrh, kw: gp.kw,
            ambient: gp.ambient, eatDb: gp.eatDb, eatWb: gp.eatWb,
            heatAmbient: (gp.heatAmbient == null || isNaN(gp.heatAmbient)) ? null : gp.heatAmbient,
            mode: gp.mode,
            convOutlet: gp.convOutlet, powerExhaust: gp.powerExhaust,
            // Conditions are picked from published values: read them there,
            // never at a snapped neighbour.
            exact: true
        };
        // cfm, coolTotal, coolSensible, heatRise, hpHeating, heatLoad.
        GP_NUMERIC.forEach(function (def) { criteria[def.key] = gpTarget(def); });
        var out = HHpro.GasPackCapacity.search(criteria);
        state.results = {
            mode: 'gasPack',
            results: out.results,
            skipped: out.skipped,
            criteria: criteria
        };
        rerenderWorkArea();
    }

    // Columns of the Design Search result schedule. Deliberately NOT the
    // product schedule: this table reports only what was asked for plus the
    // values derived from it, so nothing here can be mistaken for the
    // manually-run selection stored on the product page.
    // `only` columns belong to one unit type and are dropped when no result
    // of that type is listed (a gas-only search shows exactly the old table);
    // `mixedOnly` columns appear only when both types are listed. The
    // `variant` column of a unit's type becomes its heat size / heat kit
    // dropdown when the unit has more than one.
    // `marginCol` (vs Target: each entered target's margin) shows only when
    // a target was entered. `motorPicker` / `optionsPicker` are the row's
    // own Motor dropdown and electrical option toggles (withOptions).
    var GP_COLUMNS = [
        { label: 'Model', get: function (r) { return r.model; }, cls: 'gp-col-model' },
        { label: 'vs Target', marginCol: true, cls: 'gp-col-margin' },
        { label: 'Type', get: function (r) { return r.type === 'HEAT PUMP' ? 'Heat Pump' : 'Gas'; },
          mixedOnly: true },
        { label: 'Nom Tons', get: function (r) { return r.tons; } },
        { label: 'Efficiency', get: function (r) {
            return HHpro.GasPackCapacity.EFFICIENCY_LABELS[r.efficiency] || r.efficiency;
        } },
        { label: 'Volt/PH', get: function (r) { return r.voltage; } },
        { label: 'Motor', get: function (r) { return r.motorLabel; }, motorPicker: true },
        { label: 'HGRH', get: function (r) { return r.hgrh; }, only: 'GAS' },
        // A dropdown of the unit's published airflows (see buildAirflowSelect).
        { label: 'CFM', get: function (r) { return r.cooling.airflow; }, group: 'Cooling',
          airflowPicker: true },
        { label: 'OA DB (°F)', get: function (r) { return r.cooling.ambient; }, group: 'Cooling' },
        { label: 'EDB (°F)', get: function (r) { return r.cooling.eatDb; }, group: 'Cooling' },
        { label: 'EWB (°F)', get: function (r) { return r.cooling.eatWb; }, group: 'Cooling' },
        { label: 'LDB (°F)', get: function (r) { return fmt(r.cooling.lat, 1); }, group: 'Cooling' },
        { label: 'LWB (°F)', get: function (r) { return fmt(r.cooling.lwb, 1); }, group: 'Cooling' },
        { label: 'Total (BTU/h)', get: function (r) { return fmtInt(r.cooling.total); }, group: 'Cooling' },
        { label: 'Sensible (BTU/h)', get: function (r) { return fmtInt(r.cooling.sensible); }, group: 'Cooling' },
        { label: 'Gas Heat', get: gasCell('size'), group: 'Gas Heating', only: 'GAS', variant: 'GAS' },
        { label: 'High In (MBH)', get: gasCell('inputHigh'), group: 'Gas Heating', only: 'GAS' },
        { label: 'High Out (MBH)', get: gasCell('outputHigh'), group: 'Gas Heating', only: 'GAS' },
        { label: 'High Rise (°F)', get: gasCell('riseHigh', 1), group: 'Gas Heating', only: 'GAS' },
        { label: 'Low In (MBH)', get: gasCell('inputLow'), group: 'Gas Heating', only: 'GAS' },
        { label: 'Low Out (MBH)', get: gasCell('outputLow'), group: 'Gas Heating', only: 'GAS' },
        { label: 'Low Rise (°F)', get: gasCell('riseLow', 1), group: 'Gas Heating', only: 'GAS' },
        { label: 'T.E. (%)', get: gasCell('thermalEff'), group: 'Gas Heating', only: 'GAS' },
        // The rated outdoor point actually read: DB for DSH / DHH, WB for DVH.
        { label: 'OA (°F)', get: function (r) {
            if (!r.hpHeat) return null;
            return r.hpHeat.oa + (r.hpHeat.basis === 'WB' ? ' WB' : '');
        }, group: 'Heat Pump Heating', only: 'HEAT PUMP' },
        // The airflow the heating table publishes that point at: always the
        // nominal CFM for DSH / DHH, the chosen airflow for DVH.
        { label: 'CFM', get: function (r) { return r.hpHeat ? r.hpHeat.airflow : null; },
          group: 'Heat Pump Heating', only: 'HEAT PUMP' },
        { label: 'Capacity (BTU/h)', get: function (r) {
            return r.hpHeat ? fmtInt(r.hpHeat.capacity) : null;
        }, group: 'Heat Pump Heating', only: 'HEAT PUMP' },
        { label: 'COP', get: function (r) { return r.hpHeat ? r.hpHeat.cop : null; },
          group: 'Heat Pump Heating', only: 'HEAT PUMP' },
        { label: 'Elec Heat (kW)', get: function (r) {
            if (r.type !== 'HEAT PUMP') return null;
            return r.kitKw ? r.kitKw : 'None';
        }, group: 'Heat Pump Heating', only: 'HEAT PUMP', variant: 'HEAT PUMP' },
        // Heat pump + kit at the heating outdoor temperature (what a
        // Heating Load is judged on).
        { label: 'HP + Kit (BTU/h)', get: function (r) {
            return r.totalHeat == null ? null : fmtInt(r.totalHeat);
        }, group: 'Heat Pump Heating', only: 'HEAT PUMP' },
        { label: 'Options', optionsPicker: true, group: 'Electrical' },
        { label: 'MCA', get: function (r) { return r.electrical.mca; }, group: 'Electrical' },
        { label: 'MOP', get: function (r) { return r.electrical.mop; }, group: 'Electrical' },
        { label: 'Motor HP', get: function (r) { return r.electrical.hp == null ? '—' : r.electrical.hp; },
          group: 'Electrical' }
    ];

    // Gas heating cell getter; blank on heat pump rows.
    function gasCell(key, places) {
        return function (r) {
            if (!r.heat) return null;
            var v = r.heat[key];
            return places == null ? v : fmt(v, places);
        };
    }

    function gpColumnsFor(rows, criteria) {
        var types = {};
        rows.forEach(function (r) { types[r.type || 'GAS'] = true; });
        var mixed = Object.keys(types).length > 1;
        var anyTarget = activeTargets(criteria).length > 0;
        return GP_COLUMNS.filter(function (col) {
            if (col.only && !types[col.only]) return false;
            if (col.mixedOnly && !mixed) return false;
            if (col.marginCol && !anyTarget) return false;
            return true;
        });
    }

    // The targets a search was run with: [{ def, t }].
    function activeTargets(criteria) {
        return GP_NUMERIC.map(function (def) {
            return { def: def, t: criteria && criteria[def.key] };
        }).filter(function (x) {
            return x.t && x.t.value != null && !isNaN(x.t.value) && x.t.value > 0;
        });
    }

    // vs Target cell: one line per target the result can be judged on,
    // "Total +4%" / "Sens −2%"; a line outside its target is marked.
    function fillMarginCell(td, r, criteria) {
        td.innerHTML = '';
        var tips = [];
        activeTargets(criteria).forEach(function (x) {
            if (x.def.type && x.def.type !== r.type) return;
            var v = x.def.actual(r);
            var line = document.createElement('div');
            line.className = 'gp-margin-line';
            if (v == null || isNaN(v)) {
                line.textContent = x.def.short + ' —';
                line.classList.add('is-off');
            } else {
                var pct = (v - x.t.value) / x.t.value * 100;
                var r1 = Math.round(pct);
                line.textContent = x.def.short + ' ' + (r1 > 0 ? '+' : r1 < 0 ? '−' : '±') +
                    Math.abs(r1) + '%';
                if (!HHpro.GasPackCapacity.meets(v, x.t)) line.classList.add('is-off');
                tips.push(x.def.label + ': ' + fmtInt(v) + ' vs ' + fmtInt(x.t.value) + ' ' +
                    x.def.unit + ' (' + (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1) + '%)');
            }
            td.appendChild(line);
        });
        td.title = tips.join('\n');
    }

    function fmt(v, places) {
        if (v == null || isNaN(v)) return '—';
        return String(Number(Number(v).toFixed(places)));
    }
    function fmtInt(v) {
        if (v == null || isNaN(v)) return '—';
        return Math.round(v).toLocaleString();
    }

    // Select hands the result to the Gas Pack schedule: the closest stored
    // row is found, stamped with the design payload, and the user is taken
    // there with that row focused and the toggle already on.
    // While a project unit is being replaced (Configure on the project
    // schedule) the button is Replace instead: see replaceProjectUnit.
    function buildGasPackActions(r) {
        var wrap = document.createElement('div');
        wrap.className = 'actions-row design-gp-actions';

        var match = HHpro.GasPackDesign.matchSelection(state.productData, r);
        var rep = state.gasPack.replace;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action-btn action-btn-select';
        btn.textContent = rep ? 'Replace' : 'Select';
        if (rep) btn.title = 'Replace ' + (rep.tag || rep.model) + ' on your project schedule with this unit';
        btn.disabled = !match;
        btn.addEventListener('click', function () {
            if (!match) return;
            if (state.gasPack.replace) {
                replaceProjectUnit(state.gasPack.replace, match, r);
                return;
            }
            // The row's other kW / heat-size variants lose any older design
            // values, so the schedule opens on the one picked here.
            var fam = (HHpro.Schedule && HHpro.Schedule.findKwFamilyForSelection)
                ? HHpro.Schedule.findKwFamilyForSelection(state.productData, state.productKey,
                                                          match.selection.id)
                : null;
            var siblings = fam ? fam.family.variants.map(function (v) { return v.sel.id; }) : [];
            HHpro.GasPackDesign.set(match.selection.id, HHpro.GasPackDesign.payloadFor(r), siblings);
            HHpro.App.showView('product', {
                productKey: state.productKey,
                focusSelectionId: match.selection.id
            });
        });
        wrap.appendChild(btn);

        // The schedule row is keyed on the standard-static model, so when a
        // high-static result is selected the row it lands on is spelled
        // differently. Say so here rather than let it surprise them.
        var note = document.createElement('span');
        note.className = 'design-gp-match';
        if (!match) {
            note.textContent = 'no schedule row';
            note.title = 'This combination has no row in the LC RTU schedule.';
        } else {
            var schedModel = match.selection.rows[0].scheduleData[
                HHpro.GasPackDesign.resolveColumns(state.productData).model];
            var isHp = r.type === 'HEAT PUMP';
            var kwText = isHp ? (r.kitKw ? r.kitKw + ' kW' : 'no electric heat') : '';
            note.textContent = '→ ' + schedModel + (isHp ? ' · ' + kwText : '');
            if (rep) {
                note.textContent = '→ replaces ' + (rep.tag || rep.model);
                note.title = 'Becomes schedule row ' + schedModel + (isHp ? ' (' + kwText + ')' : '') +
                    ' with these design values, keeping the tag and place of ' + (rep.tag || rep.model) + '.';
            } else if (schedModel === r.model) {
                note.title = 'Selects this row on the LC RTU schedule.';
            } else if (isHp) {
                // Heat pump rows carry no motor letter; design values spell
                // the full model (D or W).
                note.title = 'Selects schedule row ' + schedModel + ' (' + kwText + '); ' +
                    'design values show it as ' + r.model + '.';
            } else {
                note.title = 'Selects schedule row ' + schedModel + '; switching to design values ' +
                    'renames it ' + r.model + ' for the high-static motor.';
            }
        }
        wrap.appendChild(note);
        return wrap;
    }

    /**
     * Replace on a result (Configure from the project schedule): the
     * project item takes this result's schedule row and design values, and
     * keeps its tag and place (HHpro.ProjectView.replaceItem). Only while
     * the project it came from is still the one open.
     */
    function replaceProjectUnit(rep, match, r) {
        var st = HHpro.Cart && HHpro.Cart.getActiveState ? HHpro.Cart.getActiveState() : null;
        var sameProject = st && st.mode === rep.mode && (st.projectId || null) === rep.projectId;
        if (!sameProject || !HHpro.ProjectView) {
            alert('The project ' + (rep.tag || rep.model) + ' came from is no longer open, so it ' +
                'can’t be replaced. Open that project and use Configure again.');
            return;
        }
        var payload = HHpro.GasPackDesign.payloadFor(r);
        payload.selectionId = match.selection.id;
        var product = HHpro.Data.getProduct(state.productKey);
        var label = HHpro.Cart.computeLabel
            ? HHpro.Cart.computeLabel(product, match.selection, state.productData)
            : match.selection.id;
        var out = HHpro.ProjectView.replaceItem({
            instanceId: rep.instanceId,
            productKey: state.productKey,
            data: state.productData,
            patch: { selectionId: match.selection.id, label: label, gasPackDesign: payload }
        });
        if (!out.ok) {
            alert((rep.tag || rep.model) + ' is no longer on the project schedule, so it can’t ' +
                'be replaced.');
            return;
        }
        state.gasPack.replace = null;
        state.gasPack.configure = null;
        if (HHpro.UI && HHpro.UI.toast) {
            HHpro.UI.toast((rep.tag || rep.model) + ' replaced with ' + r.model +
                (out.dropped ? '. ' + out.dropped + ' hand edit' + (out.dropped === 1 ? '' : 's') +
                    ' on its row no longer applied and ' + (out.dropped === 1 ? 'was' : 'were') +
                    ' cleared.' : '.'));
        }
        HHpro.App.showView('project_view');
    }

    // One results row per orderable unit: the heat sizes of a gas pack (and
    // the heat kits of a heat pump) become a dropdown on that row instead of
    // rows of their own. Hot gas reheat stays a separate row - it is a
    // different schedule row and a different unit. Groups keep the order of
    // their best-scoring variant; each opens on that variant (ties go to the
    // smallest heat size / kit).
    var GAS_HEAT_ORDER = { Low: 0, Medium: 1, High: 2 };

    function variantRank(r) {
        return r.type === 'HEAT PUMP' ? (r.kitKw || 0) : (GAS_HEAT_ORDER[r.heatSize] || 0);
    }

    function variantLabel(r) {
        if (r.type === 'HEAT PUMP') return r.kitKw ? String(r.kitKw) : 'None';
        return r.heatSize || '';
    }

    // The motor is a dropdown on the row (withOptions), not a row of its
    // own: each group keeps the results of one motor - the form's Motor,
    // else Standard Static - and the row can switch to the other.
    function groupGasPackResults(rows, criteria) {
        var groups = [];
        var byKey = {};
        rows.forEach(function (r) {
            var key = [r.type, r.cabinet, r.voltage, r.hgrh].join('|');
            var g = byKey[key];
            if (!g) { g = byKey[key] = { key: key, all: [] }; groups.push(g); }
            g.all.push(r);
        });
        var pref = (criteria && criteria.motor) || 'D';
        groups.forEach(function (g) {
            g.motor = g.all.some(function (r) { return r.motor === pref; }) ? pref : g.all[0].motor;
            g.variants = g.all.filter(function (r) { return r.motor === g.motor; });
            delete g.all;
            g.variants.sort(function (a, b) { return variantRank(a) - variantRank(b); });
            g.defaultIdx = 0;
            g.variants.forEach(function (v, i) {
                if (v.score < g.variants[g.defaultIdx].score) g.defaultIdx = i;
            });
        });
        return groups;
    }

    function buildGasPackResults() {
        var res = state.results;
        var rows = res.results;
        var groups = groupGasPackResults(rows, res.criteria);
        var wrap = document.createElement('section');
        wrap.className = 'design-search-results';

        var hdr = document.createElement('div');
        hdr.className = 'design-search-results-header';
        var title = document.createElement('h2');
        title.className = 'design-search-section-title design-search-results-title';
        var titleText = document.createElement('span');
        titleText.textContent = 'Results';
        title.appendChild(titleText);
        var count = document.createElement('span');
        count.className = 'design-search-count';
        count.textContent = groups.length + ' match' + (groups.length === 1 ? '' : 'es');
        title.appendChild(count);
        hdr.appendChild(title);

        var chips = gasPackChips(res.criteria);
        if (chips.length) {
            var chipRow = document.createElement('div');
            chipRow.className = 'design-search-chip-row';
            var lead = document.createElement('span');
            lead.className = 'design-search-chip-lead';
            lead.textContent = 'Evaluated at:';
            chipRow.appendChild(lead);
            chips.forEach(function (t) {
                var chip = document.createElement('span');
                chip.className = 'design-search-chip';
                chip.textContent = t;
                chipRow.appendChild(chip);
            });
            hdr.appendChild(chipRow);
        }
        wrap.appendChild(hdr);

        // Anything the tables could not answer for is said out loud rather
        // than silently missing from the list.
        (res.skipped || []).forEach(function (s) {
            var note = document.createElement('p');
            note.className = 'design-search-note';
            if (s.notRated) {
                var c = res.criteria;
                note.textContent = 'Not listed - no published rating at ' + c.ambient +
                    ' °F ambient, ' + c.eatDb + '/' + c.eatWb + ' °F EAT: ' +
                    s.cabinets.join(', ') + '.';
            } else {
                note.textContent = s.partial
                    ? s.cabinet + ' (' + s.tons + ' ton) heat pump heating not shown: ' + s.reason + '.'
                    : s.cabinet + ' (' + s.tons + ' ton) was not evaluated: ' + s.reason + '.';
            }
            wrap.appendChild(note);
        });

        if (!rows.length) {
            var empty = document.createElement('div');
            empty.className = 'hh-empty design-search-empty';
            empty.appendChild(HHpro.UI.icon('search'));
            var et = document.createElement('div');
            et.className = 'hh-empty-title';
            et.textContent = 'No units meet those targets at that condition.';
            empty.appendChild(et);
            var eh = document.createElement('div');
            eh.className = 'hh-empty-hint';
            eh.textContent = 'Try widening a tolerance, or relaxing the tons / electrical / motor constraints.';
            empty.appendChild(eh);
            wrap.appendChild(empty);
            return wrap;
        }

        wrap.appendChild(buildGasPackTable(groups, res));
        return wrap;
    }

    function gasPackChips(c) {
        var G = HHpro.GasPackCapacity;
        var chips = [];
        if (c.type) chips.push(G.TYPE_LABELS[c.type] || c.type);
        chips.push(c.eatDb + '/' + c.eatWb + ' °F EAT DB/WB');
        chips.push(c.ambient + ' °F ambient');
        if (c.type !== 'GAS' && c.heatAmbient != null) {
            chips.push('heat pump heating at ' + c.heatAmbient + ' °F');
        }
        if (c.kw != null) {
            chips.push(Number(c.kw) === 0 ? 'no electric heat' : c.kw + ' kW electric heat');
        }
        GP_NUMERIC.forEach(function (def) {
            var t = c[def.key];
            if (!t || t.value == null || isNaN(t.value)) return;
            var text = def.label + ' ' + Number(t.value).toLocaleString() + ' ' + def.unit;
            if (t.min) {
                text = def.label + ' ≥ ' + Number(t.value).toLocaleString() + ' ' + def.unit +
                    (t.tol != null && !isNaN(t.tol) ? ' (cap +' + t.tol + '%)' : '');
            } else {
                text += ' ±' + t.tol + '%';
            }
            chips.push(text);
        });
        if (c.convOutlet) chips.push('powered convenience outlet');
        if (c.powerExhaust) chips.push('power exhaust');
        return chips;
    }

    // Where the configured unit's results row opens ({ cur, air, motor,
    // conv, pe }), or null for any other row: on the heat size / heat kit,
    // motor and electrical options it was configured with, at the readable
    // airflow nearest its CFM (a tie goes to the one nearer nominal). A
    // typed CFM target steers the airflow instead; a heating load picks
    // the kit (the smallest that covers it).
    function configuredStart(g) {
        var cfg = state.gasPack.configure;
        if (!cfg || g.variants[0].cabinet !== cfg.cabinet) return null;
        var loadTyped = state.gasPack.heatLoad != null && !isNaN(state.gasPack.heatLoad);
        var cur = -1;
        g.variants.forEach(function (v, i) {
            if (cur >= 0) return;
            var same = v.type === 'HEAT PUMP'
                ? Number(v.kitKw || 0) === Number(cfg.kitKw || 0)
                : v.heatSize === cfg.heatSize;
            if (same) cur = i;
        });
        if (cur < 0 || (loadTyped && g.variants[0].type === 'HEAT PUMP')) cur = g.defaultIdx;
        var v = g.variants[cur];
        var air = v.airflow;
        var cfmTyped = state.gasPack.cfm != null && !isNaN(state.gasPack.cfm);
        if (cfg.cfm != null && !cfmTyped) {
            var best = null;
            (v.options || []).forEach(function (o) {
                if (!o.ok) return;
                var d = Math.abs(o.airflow - cfg.cfm);
                var bd = best == null ? Infinity : Math.abs(best - cfg.cfm);
                if (d < bd || (d === bd &&
                    Math.abs(o.airflow - v.nominalAirflow) < Math.abs(best - v.nominalAirflow))) {
                    best = o.airflow;
                }
            });
            if (best != null) air = best;
        }
        return { cur: cur, air: air, motor: cfg.motor || null,
                 conv: cfg.convOutlet == null ? null : !!cfg.convOutlet,
                 pe: cfg.powerExhaust == null ? null : !!cfg.powerExhaust };
    }

    // What is picked on the configured unit's row (heat size / kit, airflow,
    // motor, electrical options) is kept, so the next Find matches (other
    // conditions, hot gas reheat, ...) opens on it again.
    function noteConfigured(g, pick) {
        var cfg = state.gasPack.configure;
        var v = g.variants[pick.cur];
        if (!cfg || !v || v.cabinet !== cfg.cabinet) return;
        if (v.type === 'HEAT PUMP') cfg.kitKw = v.kitKw || 0;
        else cfg.heatSize = v.heatSize;
        cfg.cfm = pick.air;
        cfg.motor = pick.motor;
        cfg.convOutlet = pick.conv;
        cfg.powerExhaust = pick.pe;
    }

    // Motor dropdown for a results row: every offered motor, the ones the
    // cabinet isn't built with (at this voltage / kit) disabled.
    function buildMotorSelect(base, motor, onChange) {
        var G = HHpro.GasPackCapacity;
        var select = document.createElement('select');
        select.className = 'kw-variant-select';
        select.setAttribute('aria-label', 'Indoor fan motor');
        G.OFFERED_MOTORS.forEach(function (m) {
            var opt = document.createElement('option');
            opt.value = m;
            opt.textContent = G.MOTOR_LABELS[m];
            if (!G.withOptions(base, { motor: m })) opt.disabled = true;
            if (m === motor) opt.selected = true;
            select.appendChild(opt);
        });
        select.addEventListener('change', function () { onChange(select.value); });
        return wrapVariantControl(select);
    }

    // Electrical option toggles for a results row; they change MCA / MOP.
    function buildOptionToggles(conv, pe, onChange) {
        var wrap = document.createElement('div');
        wrap.className = 'design-gp-row-options';
        [{ key: 'pe', label: 'Power exhaust', on: pe },
         { key: 'conv', label: 'Conv. outlet', on: conv, title: 'Powered convenience outlet' }]
            .forEach(function (o) {
                var lab = document.createElement('label');
                lab.className = 'design-gp-check';
                if (o.title) lab.title = o.title;
                var input = document.createElement('input');
                input.type = 'checkbox';
                input.checked = !!o.on;
                input.addEventListener('change', function () { onChange(o.key, input.checked); });
                lab.appendChild(input);
                var span = document.createElement('span');
                span.textContent = o.label;
                lab.appendChild(span);
                wrap.appendChild(lab);
            });
        return wrap;
    }

    function buildGasPackTable(groups, res) {
        var rows = [];
        groups.forEach(function (g) { rows = rows.concat(g.variants); });
        var tableWrap = document.createElement('div');
        tableWrap.className = 'schedule-wrap design-search-schedule-wrap';
        var table = document.createElement('table');
        table.className = 'schedule-table design-gp-table';

        var thead = document.createElement('thead');
        var groupRow = document.createElement('tr');
        var headRow = document.createElement('tr');

        var actionsHead = document.createElement('th');
        actionsHead.className = 'actions-head';
        actionsHead.rowSpan = 2;
        actionsHead.textContent = '';
        groupRow.appendChild(actionsHead);

        // Group header: one merged cell per run of columns sharing a group.
        var columns = gpColumnsFor(rows, res.criteria);
        var i = 0;
        while (i < columns.length) {
            var g = columns[i].group || null;
            var span = 1;
            while (i + span < columns.length &&
                   (columns[i + span].group || null) === g) span++;
            var th = document.createElement('th');
            th.colSpan = span;
            th.textContent = g || '';
            if (!g) th.className = 'design-gp-group-blank';
            groupRow.appendChild(th);
            i += span;
        }
        columns.forEach(function (col) {
            var th = document.createElement('th');
            th.textContent = col.label;
            headRow.appendChild(th);
        });
        thead.appendChild(groupRow);
        thead.appendChild(headRow);
        table.appendChild(thead);

        var G = HHpro.GasPackCapacity;
        var tbody = document.createElement('tbody');
        groups.forEach(function (g) {
            var tr = document.createElement('tr');
            // Two choices per row: the heat size / heat kit (variant) and the
            // published airflow the unit is read at. Both open on the search's
            // default; the airflow dropdown repaints every airflow-dependent cell.
            // What was picked is kept with these results, so coming back from
            // the schedule shows the airflow and kit that Select sent there.
            res.picks = res.picks || {};
            var pick = res.picks[g.key] || configuredStart(g) || {};
            var cur = pick.cur != null ? pick.cur : g.defaultIdx;
            var air = pick.air != null ? pick.air : g.variants[cur].airflow;
            // Motor and electrical options: the row's own, starting from the
            // form (see groupGasPackResults / the Electrical options boxes).
            var motor = pick.motor || g.motor;
            var conv = pick.conv != null ? pick.conv : !!res.criteria.convOutlet;
            var pe = pick.pe != null ? pick.pe : !!res.criteria.powerExhaust;
            function remember() {
                var p = { cur: cur, air: air, motor: motor, conv: conv, pe: pe };
                res.picks[g.key] = p;
                noteConfigured(g, p);
            }

            var actionsTd = document.createElement('td');
            actionsTd.className = 'actions-cell';
            tr.appendChild(actionsTd);

            // Value cells repaint from the variant, airflow, motor and
            // options picked.
            var cells = [];
            var variantTd = null, airTd = null, motorTd = null, optionsTd = null;
            var marginTd = null, kitTd = null;
            columns.forEach(function (col) {
                var td = document.createElement('td');
                if (col.cls) td.className = col.cls;
                var r0 = g.variants[0];
                // Gas rows keep the dropdown even with one size left, so the
                // sizes Daikin rules out at this airflow show (greyed out).
                // Heat pump rows keep it with a heating load, so the kits
                // too small for it show.
                var otherSizes = (r0.heatSizes || []).length > 1 ||
                    (r0.type === 'HEAT PUMP' && res.criteria.heatLoad &&
                     res.criteria.heatLoad.value > 0);
                if (col.variant && col.variant === r0.type) kitTd = td;
                if (col.variant && col.variant === r0.type && (g.variants.length > 1 || otherSizes)) {
                    td.classList.add('kw-variant-cell');
                    variantTd = td;
                } else if (col.airflowPicker && (r0.options || []).length > 1) {
                    td.classList.add('kw-variant-cell');
                    airTd = td;
                } else if (col.motorPicker) {
                    td.classList.add('kw-variant-cell', 'gp-col-motor');
                    motorTd = td;
                } else if (col.optionsPicker) {
                    optionsTd = td;
                } else if (col.marginCol) {
                    marginTd = td;
                } else {
                    cells.push({ col: col, td: td });
                }
                tr.appendChild(td);
            });

            function paint() {
                var base = G.atAirflow(g.variants[cur], air);
                var r = G.withOptions(base, { motor: motor, convOutlet: conv, powerExhaust: pe });
                if (!r) { r = base; motor = base.motor; }
                if (variantTd) {
                    variantTd.innerHTML = '';
                    variantTd.appendChild(buildVariantSelect(g, cur, air, function (idx) {
                        cur = idx;
                        // Sizes that can't run at this airflow are disabled,
                        // so this only matters if the options disagree.
                        if (!optionAt(g.variants[cur], air).ok) air = g.variants[cur].airflow;
                        remember();
                        paint();
                    }, { motor: motor, r: r, criteria: res.criteria }));
                }
                if (motorTd) {
                    motorTd.innerHTML = '';
                    motorTd.appendChild(buildMotorSelect(base, motor, function (m) {
                        motor = m;
                        remember();
                        paint();
                    }));
                    // Static pressure / airflow range of each drive.
                    if (HHpro.GasPackAirflow) {
                        motorTd.appendChild(HHpro.GasPackAirflow.helpButton({
                            cabinet: r.cabinet,
                            motor: r.motor,
                            heatSize: r.heat ? r.heat.size : null,
                            kitKw: r.kitKw || 0,
                            productPage: false
                        }));
                    }
                }
                if (optionsTd) {
                    optionsTd.innerHTML = '';
                    optionsTd.appendChild(buildOptionToggles(conv, pe, function (key, on) {
                        if (key === 'pe') pe = on; else conv = on;
                        remember();
                        paint();
                    }));
                }
                if (marginTd) fillMarginCell(marginTd, r, res.criteria);
                // A heat kit outside Daikin's supply airflow limits at this CFM.
                var kitChk = (r.type === 'HEAT PUMP' && r.kitKw)
                    ? G.kitAirflowCheck(r.cabinet, r.motor, r.kitKw, r.cooling.airflow) : null;
                var kitOff = !!(kitChk && !kitChk.ok);
                if (airTd) {
                    airTd.innerHTML = '';
                    airTd.appendChild(buildAirflowSelect(g.variants[cur], air, function (a) {
                        air = a;
                        remember();
                        paint();
                    }));
                }
                cells.forEach(function (c) {
                    var v = c.col.get(r);
                    c.td.textContent = (v == null || v === '') ? '—' : String(v);
                    c.td.title = (c.col.label === 'MOP' && v == null)
                        ? 'Daikin’s published MOP for this unit is misprinted; ' +
                          'confirm with Daikin (see the Notes sheet of the capacity workbook).'
                        : '';
                });
                if (kitTd) {
                    kitTd.classList.toggle('gp-kit-flag', kitOff);
                    if (kitOff) kitTd.title = kitAirflowText(r.kitKw, kitChk, r.cooling.airflow);
                    else if (!variantTd) kitTd.title = '';
                }
                actionsTd.innerHTML = '';
                actionsTd.appendChild(buildGasPackActions(r));

                // Anything worth knowing about how a row was read says so on
                // the row itself, not just in a summary line that scrolls away.
                var notes = [];
                if (r.offGrid) {
                    notes.push('Cooling evaluated at the harsher bracketing rated point: ' +
                        Object.keys(r.offGrid).map(function (k) {
                            return k + ' ' + r.offGrid[k].lo + '–' + r.offGrid[k].hi;
                        }).join(', '));
                }
                if (r.hpHeat && r.hpHeat.basis === 'WB') {
                    notes.push('Heating read at ' + r.hpHeat.oa + ' °F outdoor WB (' +
                        r.hpHeat.designDb + ' °F DB − ' +
                        HHpro.GasPackCapacity.HP_WB_DEPRESSION + ' °F).');
                }
                if (r.hpHeat && r.hpHeat.airflow !== r.cooling.airflow) {
                    notes.push('Heating is published at ' + r.hpHeat.airflow + ' CFM only (Daikin’s ' +
                        'nominal airflow for this unit); cooling is read at ' + r.cooling.airflow + ' CFM.');
                }
                if (r.meets === false) {
                    notes.push('At ' + r.cooling.airflow + ' CFM this unit is outside one or more ' +
                        'of your targets.');
                }
                if (r.type === 'HEAT PUMP' && !r.hpHeat && r.hpHeatNote) {
                    notes.push('Heating not shown: ' + r.hpHeatNote + '.');
                }
                if (kitOff) notes.push(kitAirflowText(r.kitKw, kitChk, r.cooling.airflow));
                if (r.cooling.lwbSaturated) {
                    notes.push('LWB: the leaving air works out at saturation, so LWB = LDB.');
                }
                tr.title = notes.join('\n');
                // Only a snapped (harsher-point) reading earns the warning mark.
                tr.classList.toggle('design-gp-offgrid', !!r.offGrid);
            }
            paint();
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);

        HHpro.Schedule.applyStickyHeaderOffsets(table);
        requestAnimationFrame(function () {
            if (table.isConnected) HHpro.Schedule.applyStickyHeaderOffsets(table);
        });
        return tableWrap;
    }

    // A result's reading at one of its published airflows ({} if none).
    function optionAt(r, airflow) {
        var hit = null;
        (r.options || []).forEach(function (o) {
            if (o.airflow === Number(airflow)) hit = o;
        });
        return hit || {};
    }

    function wrapVariantControl(select) {
        var wrap = document.createElement('span');
        wrap.className = 'kw-variant-control';
        var chevron = document.createElement('span');
        chevron.className = 'kw-variant-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.textContent = '▾';
        wrap.appendChild(select);
        wrap.appendChild(chevron);
        return wrap;
    }

    // "15 kW electric heat needs at least 2,400 CFM (Daikin); this unit is
    // read at 2,250 CFM."
    function kitAirflowText(kw, chk, airflow) {
        var lim = [];
        if (chk.min != null) lim.push('at least ' + Number(chk.min).toLocaleString());
        if (chk.max != null) lim.push('no more than ' + Number(chk.max).toLocaleString());
        return kw + ' kW electric heat needs ' + lim.join(' and ') + ' CFM (Daikin’s ' +
            'electric heat airflow limits); this unit is read at ' +
            Number(airflow).toLocaleString() + ' CFM.';
    }

    // Heat size / heat kit dropdown for a grouped results row, styled like
    // the schedule's kW dropdown. `air` is the airflow the row is read at;
    // ctx = { motor, r (the row as painted), criteria } for heat pumps.
    function buildVariantSelect(g, idx, air, onChange, ctx) {
        if (g.variants[0].type === 'HEAT PUMP') return buildKitSelect(g, idx, air, onChange, ctx || {});
        var select = document.createElement('select');
        select.className = 'kw-variant-select';
        select.setAttribute('aria-label', 'Gas heat size');
        // Offered sizes, plus (gas only) every other size of the cabinet
        // whose high-stage temp rise at this airflow falls outside Daikin's
        // published range - listed in size order but disabled, with the
        // reason in the tooltip. An offered size can be out of range at this
        // airflow too (it is offered at another one): same treatment.
        var sizes = g.variants[0].heatSizes || [];
        function byAir(size) {
            var s = sizes.filter(function (h) { return h.size === size; })[0];
            return s && s.byAirflow[air];
        }
        var offered = {};
        var rejected = [];
        var entries = g.variants.map(function (v, i) {
            var e = { rank: variantRank(v), label: variantLabel(v), value: String(i) };
            if (v.type !== 'HEAT PUMP') {
                offered[v.heatSize] = true;
                var b = byAir(v.heatSize);
                if (b && !b.ok) {
                    e.off = true;
                    e.label += ' (' + fmt(b.riseHigh, 1) + ' °F rise)';
                    rejected.push({ size: v.heatSize, b: b });
                }
            }
            return e;
        });
        sizes.forEach(function (h) {
            var b = h.byAirflow[air];
            if (offered[h.size] || !b || b.ok) return;
            entries.push({ rank: GAS_HEAT_ORDER[h.size] || 0,
                           label: h.size + ' (' + fmt(b.riseHigh, 1) + ' °F rise)', value: '', off: true });
            rejected.push({ size: h.size, b: b });
        });
        entries.sort(function (a, b) { return a.rank - b.rank; });
        entries.forEach(function (e) {
            var opt = document.createElement('option');
            opt.value = e.value;
            opt.textContent = e.label;
            if (e.off) opt.disabled = true;
            if (e.value === String(idx)) opt.selected = true;
            select.appendChild(opt);
        });
        if (rejected.length) {
            select.title = 'Not available at ' + air + ' CFM - high-stage temp rise ' +
                'outside Daikin’s published range: ' + rejected.map(function (x) {
                    return x.size + ' ' + fmt(x.b.riseHigh, 1) + ' °F (' +
                        (x.b.range ? x.b.range[0] + '–' + x.b.range[1] + ' °F' : 'no range') + ')';
                }).join(', ') + '.';
        }
        select.addEventListener('change', function () {
            onChange(parseInt(select.value, 10) || 0);
        });
        return wrapVariantControl(select);
    }

    // Heat kit dropdown for a heat pump results row. With a heating load,
    // the kits too small for it are listed but disabled ("(short)"); a kit
    // outside Daikin's electric heat airflow limits at this CFM stays
    // pickable but says so ("(airflow)").
    function buildKitSelect(g, idx, air, onChange, ctx) {
        var G = HHpro.GasPackCapacity;
        var r0 = g.variants[0];
        var motor = ctx.motor || r0.motor;
        var select = document.createElement('select');
        select.className = 'kw-variant-select';
        select.setAttribute('aria-label', 'Electric heat (kW)');
        var load = ctx.criteria && ctx.criteria.heatLoad;
        var loadVal = (load && load.value > 0) ? Number(load.value) : null;
        var hpCap = (ctx.r && ctx.r.hpHeat) ? ctx.r.hpHeat.capacity : null;
        var entries = [];
        var offered = {};
        var tips = [];
        g.variants.forEach(function (v, i) {
            var kw = v.kitKw || 0;
            offered[kw] = true;
            var label = kw ? String(kw) : 'None';
            var chk = kw ? G.kitAirflowCheck(v.cabinet, motor, kw, air) : null;
            if (chk && !chk.ok) {
                label += ' (airflow)';
                tips.push(kitAirflowText(kw, chk, air));
            }
            entries.push({ rank: kw, label: label, value: String(i) });
        });
        if (loadVal != null && hpCap != null) {
            var slot = (((G.cabinets()[r0.cabinet] || {}).electrical || {})[r0.voltage] || {})[motor];
            Object.keys((slot && slot.kits) || {}).map(Number).forEach(function (kw) {
                if (offered[kw]) return;
                var total = hpCap + kw * G.KW_BTUH;
                if (total >= loadVal) return;      // left out for another reason
                entries.push({ rank: kw, label: (kw ? String(kw) : 'None') + ' (short)',
                               value: '', off: true });
                tips.push((kw ? kw + ' kW' : 'No electric heat') + ': ' + fmtInt(total) +
                    ' BTU/h, short of the ' + fmtInt(loadVal) + ' BTU/h heating load.');
            });
        }
        entries.sort(function (a, b) { return a.rank - b.rank; });
        entries.forEach(function (e) {
            var opt = document.createElement('option');
            opt.value = e.value;
            opt.textContent = e.label;
            if (e.off) opt.disabled = true;
            if (e.value === String(idx)) opt.selected = true;
            select.appendChild(opt);
        });
        select.title = tips.join('\n');
        select.addEventListener('change', function () {
            onChange(parseInt(select.value, 10) || 0);
        });
        return wrapVariantControl(select);
    }

    // CFM dropdown: every airflow Daikin publishes cooling at for this unit.
    // One the unit can't be read at (no rating at this condition, or - gas -
    // this heat size's temp rise out of range) is disabled; one that misses
    // a target stays pickable but says so.
    function buildAirflowSelect(r, air, onChange) {
        var select = document.createElement('select');
        select.className = 'kw-variant-select';
        select.setAttribute('aria-label', 'Supply airflow (CFM)');
        var sizes = r.heatSizes || [];
        (r.options || []).forEach(function (o) {
            var opt = document.createElement('option');
            opt.value = String(o.airflow);
            var label = String(o.airflow);
            if (!o.ok) {
                var s = sizes.filter(function (h) { return h.size === r.heatSize; })[0];
                var b = s && s.byAirflow[o.airflow];
                label += (o.cooling && b && !b.ok)
                    ? ' (' + fmt(b.riseHigh, 1) + ' °F rise)' : ' (not rated)';
                opt.disabled = true;
            } else if (!o.meets) {
                label += ' (off target)';
            }
            opt.textContent = label;
            if (o.airflow === Number(air)) opt.selected = true;
            select.appendChild(opt);
        });
        select.title = 'Airflows Daikin publishes for this unit: ' +
            (r.options || []).map(function (o) { return o.airflow; }).join(' / ') +
            ' CFM (' + r.nominalAirflow + ' nominal).';
        select.addEventListener('change', function () {
            onChange(Number(select.value));
        });
        return wrapVariantControl(select);
    }

    function buildResults() {
        if (state.results && state.results.mode === 'gasPack') {
            return buildGasPackResults();
        }
        if (state.results && state.results.mode === 'capacity') {
            return buildCapacityResults();
        }
        var wrap = document.createElement('section');
        wrap.className = 'design-search-results';

        var hdr = document.createElement('div');
        hdr.className = 'design-search-results-header';

        var title = document.createElement('h2');
        title.className = 'design-search-section-title design-search-results-title';
        var n = state.results.selections.length;
        var titleText = document.createElement('span');
        titleText.textContent = 'Results';
        title.appendChild(titleText);
        var count = document.createElement('span');
        count.className = 'design-search-count';
        count.textContent = n + ' match' + (n === 1 ? '' : 'es');
        title.appendChild(count);
        hdr.appendChild(title);

        // One chip per active target so the criteria behind the ranking
        // stay individually auditable instead of merging into a single
        // semicolon-joined sentence.
        if (state.results.activeTargets.length) {
            var chipRow = document.createElement('div');
            chipRow.className = 'design-search-chip-row';
            var lead = document.createElement('span');
            lead.className = 'design-search-chip-lead';
            lead.textContent = 'Sorted by closeness to:';
            chipRow.appendChild(lead);
            state.results.activeTargets.forEach(function (t) {
                var chip = document.createElement('span');
                chip.className = 'design-search-chip';
                chip.textContent = t.label + ' ' + t.target + (t.unit ? ' ' + t.unit : '') + ' ±' + t.tolerance + '%';
                chipRow.appendChild(chip);
            });
            hdr.appendChild(chipRow);
        }

        wrap.appendChild(hdr);

        if (n === 0) {
            var empty = document.createElement('div');
            empty.className = 'hh-empty design-search-empty';
            empty.appendChild(HHpro.UI.icon('search'));
            var emptyTitle = document.createElement('div');
            emptyTitle.className = 'hh-empty-title';
            emptyTitle.textContent = 'No items match those targets and constraints.';
            empty.appendChild(emptyTitle);
            var emptyHint = document.createElement('div');
            emptyHint.className = 'hh-empty-hint';
            emptyHint.textContent = 'Try widening your tolerance or relaxing a filter.';
            empty.appendChild(emptyHint);
            wrap.appendChild(empty);
            return wrap;
        }

        // Reuse the standard schedule table -- same look and the same
        // Select / Submittal / Docs action buttons engineers already know.
        wrap.appendChild(buildResultsTable(state.results.selections));

        return wrap;
    }

    // Standard schedule table for a result group, with the same
    // multi-pass sticky-offset treatment as the product page (font swap,
    // layout settling).
    function buildResultsTable(selections) {
        var product = HHpro.Data.getProduct(state.productKey);
        var tableWrap = document.createElement('div');
        tableWrap.className = 'schedule-wrap design-search-schedule-wrap';
        var table = HHpro.Schedule.buildTable(state.productData, selections, product);
        tableWrap.appendChild(table);

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
        return tableWrap;
    }

    // Results for a condition-aware search: systems verified against
    // their capacity tables first, then possible solutions compared by
    // nominal ratings, with any off-grid / out-of-range flags between.
    function buildCapacityResults() {
        var res = state.results;
        var wrap = document.createElement('section');
        wrap.className = 'design-search-results';

        var hdr = document.createElement('div');
        hdr.className = 'design-search-results-header';

        var title = document.createElement('h2');
        title.className = 'design-search-section-title design-search-results-title';
        var n = res.verified.length + res.nominal.length;
        var titleText = document.createElement('span');
        titleText.textContent = 'Results';
        title.appendChild(titleText);
        var count = document.createElement('span');
        count.className = 'design-search-count';
        count.textContent = n + ' match' + (n === 1 ? '' : 'es');
        title.appendChild(count);
        hdr.appendChild(title);

        // Criteria chips: design conditions + curve-mode capacity targets
        // first, then any other active targets.
        var chipTexts = (res.capChips || []).concat(
            (res.activeTargets || []).map(function (t) {
                return t.label + ' ' + t.target + (t.unit ? ' ' + t.unit : '') + ' ±' + t.tolerance + '%';
            })
        );
        if (chipTexts.length) {
            var chipRow = document.createElement('div');
            chipRow.className = 'design-search-chip-row';
            var lead = document.createElement('span');
            lead.className = 'design-search-chip-lead';
            lead.textContent = 'Sorted by closeness to:';
            chipRow.appendChild(lead);
            chipTexts.forEach(function (text) {
                var chip = document.createElement('span');
                chip.className = 'design-search-chip';
                chip.textContent = text;
                chipRow.appendChild(chip);
            });
            hdr.appendChild(chipRow);
        }
        wrap.appendChild(hdr);

        // Off-grid / out-of-range notices.
        if (res.flags && res.flags.length) {
            var flagBox = document.createElement('div');
            flagBox.className = 'design-search-flags';
            res.flags.forEach(function (msg) {
                var p = document.createElement('p');
                p.className = 'design-search-flag';
                p.textContent = msg;
                flagBox.appendChild(p);
            });
            wrap.appendChild(flagBox);
        }

        if (n === 0) {
            var empty = document.createElement('div');
            empty.className = 'hh-empty design-search-empty';
            empty.appendChild(HHpro.UI.icon('search'));
            var emptyTitle = document.createElement('div');
            emptyTitle.className = 'hh-empty-title';
            emptyTitle.textContent = 'No items match those targets and constraints.';
            empty.appendChild(emptyTitle);
            var emptyHint = document.createElement('div');
            emptyHint.className = 'hh-empty-hint';
            emptyHint.textContent = 'Try widening your tolerance or relaxing a filter.';
            empty.appendChild(emptyHint);
            wrap.appendChild(empty);
            return wrap;
        }

        function subSection(titleText, hintText, badgeClass) {
            var sub = document.createElement('div');
            sub.className = 'design-search-subheader';
            var h = document.createElement('h3');
            h.className = 'design-search-subtitle' + (badgeClass ? ' ' + badgeClass : '');
            h.textContent = titleText;
            sub.appendChild(h);
            var p = document.createElement('p');
            p.className = 'design-search-hint';
            p.textContent = hintText;
            sub.appendChild(p);
            return sub;
        }

        if (res.verified.length) {
            wrap.appendChild(subSection(
                'Verified at design conditions (' + res.verified.length + ')',
                'Capacity columns show rated performance at your design conditions -- worst-case ' +
                'rated point when a condition falls between rated points. Adjust the condition ' +
                'dropdowns on any row to compare nearby rated points.',
                'design-search-subtitle-verified'
            ));
            wrap.appendChild(buildResultsTable(res.verified));
        } else {
            var noneVerified = document.createElement('p');
            noneVerified.className = 'design-search-hint design-search-none-verified';
            noneVerified.textContent = 'No system with capacity tables meets the targets at these design conditions.';
            wrap.appendChild(noneVerified);
        }

        if (res.nominal.length) {
            wrap.appendChild(subSection(
                'Possible solutions -- compared by nominal ratings (' + res.nominal.length + ')',
                'These systems have no capacity table covering the entered conditions, so they were ' +
                'matched on nominal schedule values. Actual performance at your design conditions ' +
                'may differ.',
                'design-search-subtitle-nominal'
            ));
            wrap.appendChild(buildResultsTable(res.nominal));
        }

        return wrap;
    }
})();
