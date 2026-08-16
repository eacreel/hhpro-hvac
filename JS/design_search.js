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
        gasPackError: null
    };

    // Gas Pack RTUs get a purpose-built form rather than the schema-driven
    // one: every number on their schedule came from a selection run by hand
    // at one condition, so the useful question is "what does this cabinet do
    // at MY condition", not "which stored row is closest". The defaults are
    // the conditions those manual selections used, so an untouched form
    // reproduces the schedule.
    function freshGasPackState() {
        return {
            tons: null, electrical: null, motor: null,
            efficiency: null, hgrh: null,          // null = All
            ambient: 95, eatDb: 80, eatWb: 67,     // degF
            cfm: null, coolTotal: null, coolSensible: null, heatRise: null,
            tols: { cfm: 10, coolTotal: 10, coolSensible: 10, heatRise: 10 },
            convOutlet: false, powerExhaust: false
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
                  HHpro.Capacity.hasTables() && state.productData);
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
            state.capacity = freshCapacityState();
            state.capacityError = null;
            state.gasPack = freshGasPackState();
            state.gasPackError = null;
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

    var GP_NUMERIC = [
        { key: 'cfm', label: 'Supply CFM', unit: 'CFM' },
        { key: 'coolTotal', label: 'Cooling Total Capacity', unit: 'BTU/h' },
        { key: 'coolSensible', label: 'Cooling Sensible Capacity', unit: 'BTU/h' },
        { key: 'heatRise', label: 'Gas Heating High Stage Temp Rise', unit: '°F' }
    ];

    function buildGasPackSection() {
        var G = HHpro.GasPackCapacity;
        var opts = G.formOptions();
        var gp = state.gasPack;

        var box = document.createElement('section');
        box.className = 'design-search-section design-capacity-section';

        var hdr = document.createElement('h2');
        hdr.className = 'design-search-section-title';
        hdr.textContent = 'Performance at design conditions';
        box.appendChild(hdr);

        var hint = document.createElement('p');
        hint.className = 'design-search-hint';
        hint.textContent = 'Results come from Daikin’s published capacity tables, not from the ' +
            'schedule’s stored selection. A condition between rated points is evaluated at the ' +
            'harsher bracketing point, so the capacity shown is never optimistic.';
        box.appendChild(hint);

        // ----- Unit constraints -----
        var fgrid = document.createElement('div');
        fgrid.className = 'design-filter-grid';
        fgrid.appendChild(gpSelect('Nominal Tons', 'tons',
            opts.tons.map(function (t) { return { value: String(t), label: String(t) }; })));
        fgrid.appendChild(gpSelect('Efficiency', 'efficiency', opts.efficiencies));
        fgrid.appendChild(gpSelect('Electrical', 'electrical',
            opts.electrical.map(function (v) { return { value: v, label: v }; })));
        fgrid.appendChild(gpSelect('Motor', 'motor', opts.motors));
        fgrid.appendChild(gpSelect('Hot Gas Reheat', 'hgrh', [
            { value: 'YES', label: 'Yes' }, { value: 'NO', label: 'No' }
        ]));
        fgrid.appendChild(gpSelect('Outdoor Ambient (°F)', 'ambient',
            opts.ambients.map(function (a) { return { value: String(a), label: String(a) }; }),
            true));
        box.appendChild(fgrid);

        // ----- Entering air -----
        var condGrid = document.createElement('div');
        condGrid.className = 'design-cond-grid';
        condGrid.appendChild(buildCondGroup('Cooling entering air', [
            gpCondField('Cooling EAT (DB)', 'eatDb'),
            gpCondField('Cooling EAT (WB)', 'eatWb')
        ]));
        box.appendChild(condGrid);

        // ----- Targets -----
        var thint = document.createElement('p');
        thint.className = 'design-search-hint';
        thint.textContent = 'Leave a row blank to skip it. Tolerance is the +/- percent the result ' +
            'can differ from your target.';
        box.appendChild(thint);

        var grid = document.createElement('div');
        grid.className = 'design-target-grid';
        GP_NUMERIC.forEach(function (def) { grid.appendChild(gpTargetRow(def)); });
        box.appendChild(grid);

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
    // option (outdoor ambient always has to resolve to a rated column).
    function gpSelect(labelText, key, choices, required) {
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
            if (raw === '') { state.gasPack[key] = null; return; }
            var n = parseFloat(raw);
            state.gasPack[key] = (String(n) === raw) ? n : raw;
        });
        group.appendChild(select);
        return group;
    }

    function gpCondField(labelText, key) {
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
        input.setAttribute('aria-label', labelText + ' (°F)');
        if (state.gasPack[key] != null) input.value = state.gasPack[key];
        input.addEventListener('input', function () {
            var raw = input.value.trim();
            state.gasPack[key] = raw === '' ? null : parseFloat(raw);
        });
        wrap.appendChild(input);
        var unit = document.createElement('span');
        unit.className = 'design-cond-unit';
        unit.textContent = '°F';
        wrap.appendChild(unit);
        return wrap;
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
        pm.textContent = '±';
        row.appendChild(pm);

        var tolInput = document.createElement('input');
        tolInput.type = 'number';
        tolInput.className = 'design-target-tolerance';
        tolInput.step = 'any';
        tolInput.min = '0';
        tolInput.setAttribute('aria-label', def.label + ' tolerance (%)');
        tolInput.value = state.gasPack.tols[def.key];
        tolInput.addEventListener('input', function () {
            var raw = tolInput.value.trim();
            state.gasPack.tols[def.key] = raw === '' ? 0 : parseFloat(raw);
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
        if (gp.ambient == null) missing.push('Outdoor Ambient');
        if (gp.eatDb == null || isNaN(gp.eatDb)) missing.push('Cooling EAT (DB)');
        if (gp.eatWb == null || isNaN(gp.eatWb)) missing.push('Cooling EAT (WB)');
        if (missing.length) {
            state.gasPackError = 'Enter ' + missing.join(', ') +
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

        function target(key) {
            return { value: gp[key], tol: gp.tols[key] };
        }
        var criteria = {
            tons: gp.tons, electrical: gp.electrical, motor: gp.motor,
            efficiency: gp.efficiency, hgrh: gp.hgrh,
            ambient: gp.ambient, eatDb: gp.eatDb, eatWb: gp.eatWb,
            cfm: target('cfm'),
            coolTotal: target('coolTotal'),
            coolSensible: target('coolSensible'),
            heatRise: target('heatRise'),
            convOutlet: gp.convOutlet, powerExhaust: gp.powerExhaust
        };
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
    var GP_COLUMNS = [
        { label: 'Model', get: function (r) { return r.model; }, cls: 'gp-col-model' },
        { label: 'Nom Tons', get: function (r) { return r.tons; } },
        { label: 'Efficiency', get: function (r) { return r.efficiency === 'HIGH' ? 'High' : 'Low'; } },
        { label: 'Volt/PH', get: function (r) { return r.voltage; } },
        { label: 'Motor', get: function (r) { return r.motorLabel; } },
        { label: 'HGRH', get: function (r) { return r.hgrh; } },
        { label: 'CFM', get: function (r) { return r.cooling.airflow; }, group: 'Cooling' },
        { label: 'OA DB (°F)', get: function (r) { return r.cooling.ambient; }, group: 'Cooling' },
        { label: 'EDB (°F)', get: function (r) { return r.cooling.eatDb; }, group: 'Cooling' },
        { label: 'EWB (°F)', get: function (r) { return r.cooling.eatWb; }, group: 'Cooling' },
        { label: 'LDB (°F)', get: function (r) { return fmt(r.cooling.lat, 1); }, group: 'Cooling' },
        { label: 'Total (BTU/h)', get: function (r) { return fmtInt(r.cooling.total); }, group: 'Cooling' },
        { label: 'Sensible (BTU/h)', get: function (r) { return fmtInt(r.cooling.sensible); }, group: 'Cooling' },
        { label: 'Gas Heat', get: function (r) { return r.heat.size; }, group: 'Heating' },
        { label: 'High In (MBH)', get: function (r) { return r.heat.inputHigh; }, group: 'Heating' },
        { label: 'High Out (MBH)', get: function (r) { return r.heat.outputHigh; }, group: 'Heating' },
        { label: 'High Rise (°F)', get: function (r) { return fmt(r.heat.riseHigh, 1); }, group: 'Heating' },
        { label: 'Low In (MBH)', get: function (r) { return r.heat.inputLow; }, group: 'Heating' },
        { label: 'Low Out (MBH)', get: function (r) { return r.heat.outputLow; }, group: 'Heating' },
        { label: 'Low Rise (°F)', get: function (r) { return fmt(r.heat.riseLow, 1); }, group: 'Heating' },
        { label: 'T.E. (%)', get: function (r) { return r.heat.thermalEff; }, group: 'Heating' },
        { label: 'MCA', get: function (r) { return r.electrical.mca; }, group: 'Electrical' },
        { label: 'MOP', get: function (r) { return r.electrical.mop; }, group: 'Electrical' },
        { label: 'Motor HP', get: function (r) { return r.electrical.hp == null ? '—' : r.electrical.hp; },
          group: 'Electrical' }
    ];

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
    function buildGasPackActions(r) {
        var wrap = document.createElement('div');
        wrap.className = 'actions-row design-gp-actions';

        var match = HHpro.GasPackDesign.matchSelection(state.productData, r);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'action-btn action-btn-select';
        btn.textContent = 'Select';
        btn.disabled = !match;
        btn.addEventListener('click', function () {
            if (!match) return;
            HHpro.GasPackDesign.set(match.selection.id, HHpro.GasPackDesign.payloadFor(r));
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
            note.title = 'This combination has no row in the Gas Pack schedule.';
        } else {
            var schedModel = match.selection.rows[0].scheduleData[
                HHpro.GasPackDesign.resolveColumns(state.productData).model];
            note.textContent = '→ ' + schedModel;
            note.title = (schedModel === r.model)
                ? 'Selects this row on the Gas Pack RTU schedule.'
                : 'Selects schedule row ' + schedModel + '; switching to design values ' +
                  'renames it ' + r.model + ' for the high-static motor.';
        }
        wrap.appendChild(note);
        return wrap;
    }

    function buildGasPackResults() {
        var res = state.results;
        var rows = res.results;
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
        count.textContent = rows.length + ' match' + (rows.length === 1 ? '' : 'es');
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
            note.textContent = s.cabinet + ' (' + s.tons + ' ton) was not evaluated: ' + s.reason + '.';
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

        wrap.appendChild(buildGasPackTable(rows));
        return wrap;
    }

    function gasPackChips(c) {
        var chips = [
            c.eatDb + '/' + c.eatWb + ' °F EAT DB/WB',
            c.ambient + ' °F ambient'
        ];
        GP_NUMERIC.forEach(function (def) {
            var t = c[def.key];
            if (t && t.value != null && !isNaN(t.value)) {
                chips.push(def.label + ' ' + t.value + ' ' + def.unit + ' ±' + t.tol + '%');
            }
        });
        if (c.convOutlet) chips.push('powered convenience outlet');
        if (c.powerExhaust) chips.push('power exhaust');
        return chips;
    }

    function buildGasPackTable(rows) {
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
        var i = 0;
        while (i < GP_COLUMNS.length) {
            var g = GP_COLUMNS[i].group || null;
            var span = 1;
            while (i + span < GP_COLUMNS.length &&
                   (GP_COLUMNS[i + span].group || null) === g) span++;
            var th = document.createElement('th');
            th.colSpan = span;
            th.textContent = g || '';
            if (!g) th.className = 'design-gp-group-blank';
            groupRow.appendChild(th);
            i += span;
        }
        GP_COLUMNS.forEach(function (col) {
            var th = document.createElement('th');
            th.textContent = col.label;
            headRow.appendChild(th);
        });
        thead.appendChild(groupRow);
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        rows.forEach(function (r) {
            var tr = document.createElement('tr');

            var actionsTd = document.createElement('td');
            actionsTd.className = 'actions-cell';
            actionsTd.appendChild(buildGasPackActions(r));
            tr.appendChild(actionsTd);

            GP_COLUMNS.forEach(function (col) {
                var td = document.createElement('td');
                if (col.cls) td.className = col.cls;
                var v = col.get(r);
                td.textContent = (v == null || v === '') ? '—' : String(v);
                tr.appendChild(td);
            });

            // A row evaluated off-grid says so on the row itself, not just
            // in a summary line that scrolls away.
            if (r.offGrid) {
                tr.title = 'Evaluated at the harsher bracketing rated point: ' +
                    Object.keys(r.offGrid).map(function (k) {
                        return k + ' ' + r.offGrid[k].lo + '–' + r.offGrid[k].hi;
                    }).join(', ');
                tr.classList.add('design-gp-offgrid');
            }
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
