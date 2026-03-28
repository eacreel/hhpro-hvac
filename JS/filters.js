/* ==========================================================================
   filters.js — Populate dropdowns, cascading dependent filters,
   dynamic indoor visibility, emit changes via EventBus.
   Supports: mini-splits (complex cascading), multi-position (flat),
   and gas-packs (flat).
   ========================================================================== */

const Filters = (function () {

    // -----------------------------------------------------------------------
    // Active Product
    // -----------------------------------------------------------------------
    let _activeProduct = "mini-splits";

    // Flag to prevent cascading updates from re-triggering
    let _updating = false;


    // -----------------------------------------------------------------------
    // DOM References — Mini Splits
    // -----------------------------------------------------------------------
    const ms = {
        systemType:     null,
        electricalType: null,
        outdoorSize:    null,
        numIndoor:      null,
        indoorSizes:    [],
        indoorTypes:    [],
        sizeGroups:     [],
        typeGroups:     [],
        clearBtn:       null,
        resultCount:    null,
    };


    // -----------------------------------------------------------------------
    // DOM References — Multi Position Splits
    // -----------------------------------------------------------------------
    const mps = {
        size:             null,
        systemType:       null,
        nominalEfficiency: null,
        electrical:       null,
        electricHeatKw:   null,
        compressorStages: null,
        fanType:          null,
        clearBtn:         null,
        resultCount:      null,
    };


    // -----------------------------------------------------------------------
    // DOM References — Gas Packs
    // -----------------------------------------------------------------------
    const gp = {
        size:           null,
        electrical:     null,
        efficiency:     null,
        coolingStages:  null,
        gasHeat:        null,
        hgrh:           null,
        clearBtn:       null,
        resultCount:    null,
    };


    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------
    function init() {

        // ---- Mini Splits DOM ----
        ms.systemType      = document.getElementById("filter-system-type");
        ms.electricalType  = document.getElementById("filter-electrical-type");
        ms.outdoorSize     = document.getElementById("filter-outdoor-size");
        ms.numIndoor       = document.getElementById("filter-num-indoor");
        ms.clearBtn        = document.getElementById("btn-clear-filters");
        ms.resultCount     = document.getElementById("filter-result-count");

        for (var i = 1; i <= 5; i++) {
            ms.indoorSizes.push(document.getElementById("filter-indoor-size-" + i));
            ms.indoorTypes.push(document.getElementById("filter-indoor-type-" + i));
            ms.sizeGroups.push(document.getElementById("fg-indoor-size-" + i));
            ms.typeGroups.push(document.getElementById("fg-indoor-type-" + i));
        }

        // Mini Splits events
        ms.systemType.addEventListener("change", handleFilterChange);
        ms.electricalType.addEventListener("change", handleFilterChange);
        ms.outdoorSize.addEventListener("change", handleFilterChange);
        ms.numIndoor.addEventListener("change", handleNumIndoorChange);

        for (var j = 0; j < 5; j++) {
            ms.indoorSizes[j].addEventListener("change", handleFilterChange);
            ms.indoorTypes[j].addEventListener("change", handleFilterChange);
        }

        ms.clearBtn.addEventListener("click", clearAll);

        // ---- Multi Position Splits DOM ----
        mps.size             = document.getElementById("mps-filter-size");
        mps.systemType       = document.getElementById("mps-filter-system-type");
        mps.nominalEfficiency = document.getElementById("mps-filter-nom-eff");
        mps.electrical       = document.getElementById("mps-filter-electrical");
        mps.electricHeatKw   = document.getElementById("mps-filter-heat-kw");
        mps.compressorStages = document.getElementById("mps-filter-compressor");
        mps.fanType          = document.getElementById("mps-filter-fan-type");
        mps.clearBtn         = document.getElementById("mps-btn-clear-filters");
        mps.resultCount      = document.getElementById("mps-filter-result-count");

        // MPS events
        if (mps.size) mps.size.addEventListener("change", handleFilterChange);
        if (mps.systemType) mps.systemType.addEventListener("change", handleFilterChange);
        if (mps.nominalEfficiency) mps.nominalEfficiency.addEventListener("change", handleFilterChange);
        if (mps.electrical) mps.electrical.addEventListener("change", handleFilterChange);
        if (mps.electricHeatKw) mps.electricHeatKw.addEventListener("change", handleFilterChange);
        if (mps.compressorStages) mps.compressorStages.addEventListener("change", handleFilterChange);
        if (mps.fanType) mps.fanType.addEventListener("change", handleFilterChange);
        if (mps.clearBtn) mps.clearBtn.addEventListener("click", clearAll);

        // ---- Gas Packs DOM ----
        gp.size          = document.getElementById("gp-filter-size");
        gp.electrical    = document.getElementById("gp-filter-electrical");
        gp.efficiency    = document.getElementById("gp-filter-efficiency");
        gp.coolingStages = document.getElementById("gp-filter-cooling-stages");
        gp.gasHeat       = document.getElementById("gp-filter-gas-heat");
        gp.hgrh          = document.getElementById("gp-filter-hgrh");
        gp.clearBtn      = document.getElementById("gp-btn-clear-filters");
        gp.resultCount   = document.getElementById("gp-filter-result-count");

        // Gas Packs events
        if (gp.size) gp.size.addEventListener("change", handleFilterChange);
        if (gp.electrical) gp.electrical.addEventListener("change", handleFilterChange);
        if (gp.efficiency) gp.efficiency.addEventListener("change", handleFilterChange);
        if (gp.coolingStages) gp.coolingStages.addEventListener("change", handleFilterChange);
        if (gp.gasHeat) gp.gasHeat.addEventListener("change", handleFilterChange);
        if (gp.hgrh) gp.hgrh.addEventListener("change", handleFilterChange);
        if (gp.clearBtn) gp.clearBtn.addEventListener("click", clearAll);

        // Initial population (mini-splits is active at boot)
        populateAllDropdowns();
        updateIndoorVisibility();

        console.log("[Filters] Initialized");
    }


    // -----------------------------------------------------------------------
    // Switch Product
    // -----------------------------------------------------------------------
    function switchProduct(productKey) {
        _activeProduct = productKey;

        if (productKey === "multi-position") {
            populateMpsDropdowns();
        } else if (productKey === "gas-packs") {
            populateGpDropdowns();
        } else {
            populateAllDropdowns();
            updateIndoorVisibility();
        }
    }


    // -----------------------------------------------------------------------
    // Populate Dropdowns — Mini Splits
    // -----------------------------------------------------------------------
    function populateAllDropdowns() {
        var opts = DataLoader.getFilterOptions();
        if (!opts) return;

        populateSelect(ms.systemType, opts.systemTypes, formatIdentity);
        populateSelect(ms.electricalType, opts.electricalTypes || [], formatIdentity);
        populateSelect(ms.outdoorSize, opts.outdoorSizes, formatTon);

        var numOptions = [];
        for (var i = 1; i <= (opts.maxIndoorUnits || 5); i++) {
            numOptions.push(i);
        }
        populateSelect(ms.numIndoor, numOptions, formatString);

        for (var j = 0; j < 5; j++) {
            populateSelect(ms.indoorSizes[j], opts.indoorSizes, formatTon);
            populateSelect(ms.indoorTypes[j], opts.indoorTypes, formatIdentity);
        }
    }


    // -----------------------------------------------------------------------
    // Populate Dropdowns — Multi Position Splits
    // -----------------------------------------------------------------------
    function populateMpsDropdowns() {
        var opts = DataLoader.getFilterOptions();
        if (!opts) return;

        populateSelect(mps.size, opts.sizes || [], formatTon);
        populateSelect(mps.systemType, opts.systemTypes || [], formatIdentity);
        populateSelect(mps.nominalEfficiency, opts.nominalEfficiencies || [], formatIdentity);
        populateSelect(mps.electrical, opts.electricalTypes || [], formatIdentity);

        var heatKwValues = opts.electricHeatKw || [];
        populateSelectCustom(mps.electricHeatKw, heatKwValues, function (val) {
            return val + " kW";
        }, "NONE", "None (No Aux Heat)");

        populateSelect(mps.compressorStages, opts.compressorStages || [], formatIdentity);
        populateSelect(mps.fanType, opts.fanTypes || [], formatIdentity);
    }


    // -----------------------------------------------------------------------
    // Populate Dropdowns — Gas Packs
    // -----------------------------------------------------------------------
    function populateGpDropdowns() {
        var opts = DataLoader.getFilterOptions();
        if (!opts) return;

        populateSelect(gp.size, opts.size || [], formatTon);
        populateSelect(gp.electrical, opts.electrical || [], formatIdentity);
        populateSelect(gp.efficiency, opts.efficiency || [], formatIdentity);
        populateSelect(gp.coolingStages, opts.coolingStages || [], formatIdentity);

        // Custom sort for gasHeat: LOW, MEDIUM, HIGH
        var gasHeatValues = (opts.gasHeat || []).slice();
        var heatOrder = { "LOW": 0, "MEDIUM": 1, "HIGH": 2 };
        gasHeatValues.sort(function (a, b) {
            var aO = heatOrder[String(a).toUpperCase()];
            var bO = heatOrder[String(b).toUpperCase()];
            if (aO !== undefined && bO !== undefined) return aO - bO;
            return String(a).localeCompare(String(b));
        });
        populateSelect(gp.gasHeat, gasHeatValues, formatIdentity);
        populateSelect(gp.hgrh, opts.hgrh || [], formatIdentity);
    }


    // -----------------------------------------------------------------------
    // Cascading Filter Update — Mini Splits
    // -----------------------------------------------------------------------
    function updateAvailableOptions() {
        if (_activeProduct !== "mini-splits") return;

        var allSystems = DataLoader.getSystems();
        var state = getStateMiniSplits();
        var numIndoorVal = state.numIndoor ? parseInt(state.numIndoor, 10) : 0;

        var stOptions = getValidValues(allSystems, state, "systemType", function (sys) { return sys.filters.systemType; });
        repopulateSelect(ms.systemType, stOptions, formatIdentity, state.systemType);

        var etOptions = getValidValues(allSystems, state, "electricalType", function (sys) { return sys.filters.electricalType; });
        repopulateSelect(ms.electricalType, etOptions, formatIdentity, state.electricalType);

        var osOptions = getValidValues(allSystems, state, "outdoorSize", function (sys) { return sys.filters.outdoorSize; });
        repopulateSelect(ms.outdoorSize, osOptions, formatTon, state.outdoorSize);

        var niOptions = getValidValues(allSystems, state, "numIndoor", function (sys) { return sys.filters.numIndoor; });
        repopulateSelect(ms.numIndoor, niOptions, formatString, state.numIndoor);

        state = getStateMiniSplits();
        numIndoorVal = state.numIndoor ? parseInt(state.numIndoor, 10) : 0;

        var maxSlots = numIndoorVal > 0 ? numIndoorVal : 5;

        for (var i = 0; i < 5; i++) {
            if (i < maxSlots) {
                var sizeKey = "indoorSize_" + i;
                var isOptions = getValidValues(allSystems, state, sizeKey, (function (idx) {
                    return function (sys) { return sys.filters.indoorSizes[idx] || null; };
                })(i));
                repopulateSelect(ms.indoorSizes[i], isOptions, formatTon, state.indoorSizes[i]);

                var typeKey = "indoorType_" + i;
                var itOptions = getValidValues(allSystems, state, typeKey, (function (idx) {
                    return function (sys) { return sys.filters.indoorTypes[idx] || null; };
                })(i));
                repopulateSelect(ms.indoorTypes[i], itOptions, formatIdentity, state.indoorTypes[i]);

                state = getStateMiniSplits();
            }
        }
    }


    // -----------------------------------------------------------------------
    // Cascading Filter Update — Multi Position Splits
    // -----------------------------------------------------------------------
    function updateMpsAvailableOptions() {
        if (_activeProduct !== "multi-position") return;

        var allSystems = DataLoader.getSystems();
        var state = getStateMps();

        var fields = [
            { key: "size",             el: mps.size,             extract: function (s) { return s.filters.size; },             fmt: formatTon },
            { key: "systemType",       el: mps.systemType,       extract: function (s) { return s.filters.systemType; },       fmt: formatIdentity },
            { key: "nominalEfficiency", el: mps.nominalEfficiency, extract: function (s) { return s.filters.nominalEfficiency; }, fmt: formatIdentity },
            { key: "electrical",       el: mps.electrical,       extract: function (s) { return s.filters.electrical; },       fmt: formatIdentity },
            { key: "electricHeatKw",   el: mps.electricHeatKw,   extract: function (s) { return s.filters.electricHeatKw; },   fmt: function (v) { return v + " kW"; } },
            { key: "compressorStages", el: mps.compressorStages, extract: function (s) { return s.filters.compressorStages; }, fmt: formatIdentity },
            { key: "fanType",          el: mps.fanType,          extract: function (s) { return s.filters.fanType; },          fmt: formatIdentity },
        ];

        for (var f = 0; f < fields.length; f++) {
            var field = fields[f];
            var validValues = getMpsValidValues(allSystems, state, field.key, field.extract);

            if (field.key === "electricHeatKw") {
                repopulateSelectWithNone(field.el, validValues, field.fmt, state[field.key], allSystems, state);
            } else {
                repopulateSelect(field.el, validValues, field.fmt, state[field.key]);
            }

            state = getStateMps();
        }
    }

    function getMpsValidValues(allSystems, state, excludeKey, extractor) {
        var modified = {
            size:              state.size,
            systemType:        state.systemType,
            nominalEfficiency: state.nominalEfficiency,
            electrical:        state.electrical,
            electricHeatKw:    state.electricHeatKw,
            compressorStages:  state.compressorStages,
            fanType:           state.fanType,
        };
        modified[excludeKey] = "";

        var compatible = DataLoader.filterSystems(modified);

        var valueSet = {};
        for (var i = 0; i < compatible.length; i++) {
            var val = extractor(compatible[i]);
            if (val !== null && val !== undefined) {
                valueSet[val] = true;
            }
        }

        var values = Object.keys(valueSet).map(function (v) {
            if (/^-?\d+(\.\d+)?$/.test(v)) {
                return parseFloat(v);
            }
            return v;
        });

        values.sort(function (a, b) {
            if (typeof a === "number" && typeof b === "number") return a - b;
            return String(a).localeCompare(String(b));
        });

        return values;
    }

    function repopulateSelectWithNone(selectEl, values, formatLabel, currentValue, allSystems, state) {
        if (!selectEl) return;
        var prevValue = currentValue || selectEl.value;

        while (selectEl.options.length > 1) {
            selectEl.remove(1);
        }

        var modifiedForNone = {
            size:              state.size,
            systemType:        state.systemType,
            nominalEfficiency: state.nominalEfficiency,
            electrical:        state.electrical,
            electricHeatKw:    "",
            compressorStages:  state.compressorStages,
            fanType:           state.fanType,
        };
        var compatible = DataLoader.filterSystems(modifiedForNone);
        var hasNone = false;
        for (var c = 0; c < compatible.length; c++) {
            if (compatible[c].filters.electricHeatKw === null) {
                hasNone = true;
                break;
            }
        }

        if (hasNone) {
            var noneOpt = document.createElement("option");
            noneOpt.value = "NONE";
            noneOpt.textContent = "None (No Aux Heat)";
            selectEl.appendChild(noneOpt);
        }

        for (var i = 0; i < values.length; i++) {
            var opt = document.createElement("option");
            opt.value = values[i];
            opt.textContent = formatLabel(values[i]);
            selectEl.appendChild(opt);
        }

        if (prevValue) {
            var found = false;
            for (var j = 1; j < selectEl.options.length; j++) {
                if (String(selectEl.options[j].value) === String(prevValue)) {
                    selectEl.value = prevValue;
                    found = true;
                    break;
                }
            }
            if (!found) selectEl.value = "";
        } else {
            selectEl.value = "";
        }

        updateSelectHighlight(selectEl);
    }


    // -----------------------------------------------------------------------
    // Cascading Filter Update — Gas Packs
    // -----------------------------------------------------------------------
    function updateGpAvailableOptions() {
        if (_activeProduct !== "gas-packs") return;

        var allSystems = DataLoader.getSystems();
        var state = getStateGp();

        var fields = [
            { key: "size",          el: gp.size,          extract: function (s) { return s.filters.size; },          fmt: formatTon },
            { key: "electrical",    el: gp.electrical,    extract: function (s) { return s.filters.electrical; },    fmt: formatIdentity },
            { key: "efficiency",    el: gp.efficiency,    extract: function (s) { return s.filters.efficiency; },    fmt: formatIdentity },
            { key: "coolingStages", el: gp.coolingStages, extract: function (s) { return s.filters.coolingStages; }, fmt: formatIdentity },
            { key: "gasHeat",       el: gp.gasHeat,       extract: function (s) { return s.filters.gasHeat; },       fmt: formatIdentity },
            { key: "hgrh",          el: gp.hgrh,          extract: function (s) { return s.filters.hgrh; },          fmt: formatIdentity },
        ];

        for (var f = 0; f < fields.length; f++) {
            var field = fields[f];
            var validValues = getGpValidValues(allSystems, state, field.key, field.extract);
            repopulateSelect(field.el, validValues, field.fmt, state[field.key]);
            state = getStateGp();
        }
    }

    function getGpValidValues(allSystems, state, excludeKey, extractor) {
        var modified = {
            size:          state.size,
            electrical:    state.electrical,
            efficiency:    state.efficiency,
            coolingStages: state.coolingStages,
            gasHeat:       state.gasHeat,
            hgrh:          state.hgrh,
        };
        modified[excludeKey] = "";

        var compatible = DataLoader.filterSystems(modified);

        var valueSet = {};
        for (var i = 0; i < compatible.length; i++) {
            var val = extractor(compatible[i]);
            if (val !== null && val !== undefined) {
                valueSet[val] = true;
            }
        }

        var values = Object.keys(valueSet).map(function (v) {
            if (/^-?\d+(\.\d+)?$/.test(v)) {
                return parseFloat(v);
            }
            return v;
        });

        values.sort(function (a, b) {
            if (typeof a === "number" && typeof b === "number") return a - b;
            return String(a).localeCompare(String(b));
        });

        // Custom sort for gasHeat: LOW, MEDIUM, HIGH
        if (excludeKey === "gasHeat") {
            var heatOrder = { "LOW": 0, "MEDIUM": 1, "HIGH": 2 };
            values.sort(function (a, b) {
                var aO = heatOrder[String(a).toUpperCase()];
                var bO = heatOrder[String(b).toUpperCase()];
                if (aO !== undefined && bO !== undefined) return aO - bO;
                return String(a).localeCompare(String(b));
            });
        }

        return values;
    }


    // -----------------------------------------------------------------------
    // getValidValues — Mini Splits cascading helper
    // -----------------------------------------------------------------------
    function getValidValues(allSystems, state, excludeKey, extractor) {
        var modified = {
            systemType:     state.systemType,
            electricalType: state.electricalType,
            outdoorSize:    state.outdoorSize,
            numIndoor:      state.numIndoor,
            indoorSizes:    state.indoorSizes.slice(),
            indoorTypes:    state.indoorTypes.slice(),
        };

        if (excludeKey === "systemType") modified.systemType = "";
        else if (excludeKey === "electricalType") modified.electricalType = "";
        else if (excludeKey === "outdoorSize") modified.outdoorSize = "";
        else if (excludeKey === "numIndoor") modified.numIndoor = "";
        else if (excludeKey.indexOf("indoorSize_") === 0) {
            var sIdx = parseInt(excludeKey.split("_")[1], 10);
            modified.indoorSizes[sIdx] = "";
        } else if (excludeKey.indexOf("indoorType_") === 0) {
            var tIdx = parseInt(excludeKey.split("_")[1], 10);
            modified.indoorTypes[tIdx] = "";
        }

        var compatible = DataLoader.filterSystems(modified);

        var valueSet = {};
        for (var i = 0; i < compatible.length; i++) {
            var val = extractor(compatible[i]);
            if (val !== null && val !== undefined) valueSet[val] = true;
        }

        var values = Object.keys(valueSet).map(function (v) {
            if (/^-?\d+(\.\d+)?$/.test(v)) {
                return parseFloat(v);
            }
            return v;
        });

        values.sort(function (a, b) {
            if (typeof a === "number" && typeof b === "number") return a - b;
            return String(a).localeCompare(String(b));
        });

        return values;
    }


    // -----------------------------------------------------------------------
    // Repopulate Select
    // -----------------------------------------------------------------------
    function repopulateSelect(selectEl, values, formatLabel, currentValue) {
        if (!selectEl) return;
        var prevValue = currentValue || selectEl.value;

        while (selectEl.options.length > 1) {
            selectEl.remove(1);
        }

        for (var i = 0; i < values.length; i++) {
            var opt = document.createElement("option");
            opt.value = values[i];
            opt.textContent = formatLabel(values[i]);
            selectEl.appendChild(opt);
        }

        if (values.length === 1) {
            selectEl.value = values[0];
        } else if (prevValue) {
            var found = false;
            for (var j = 0; j < values.length; j++) {
                if (String(values[j]) === String(prevValue)) {
                    selectEl.value = prevValue;
                    found = true;
                    break;
                }
            }
            if (!found) selectEl.value = "";
        } else {
            selectEl.value = "";
        }

        updateSelectHighlight(selectEl);
    }


    // -----------------------------------------------------------------------
    // Format Helpers
    // -----------------------------------------------------------------------
    function formatIdentity(val) { return String(val); }
    function formatTon(val) { return val + " Ton"; }
    function formatString(val) { return String(val); }


    // -----------------------------------------------------------------------
    // Populate a <select> from scratch
    // -----------------------------------------------------------------------
    function populateSelect(selectEl, values, formatLabel) {
        if (!selectEl) return;
        while (selectEl.options.length > 1) {
            selectEl.remove(1);
        }

        for (var i = 0; i < values.length; i++) {
            var opt = document.createElement("option");
            opt.value = values[i];
            opt.textContent = formatLabel(values[i]);
            selectEl.appendChild(opt);
        }
    }

    function populateSelectCustom(selectEl, values, formatLabel, specialValue, specialLabel) {
        if (!selectEl) return;
        while (selectEl.options.length > 1) {
            selectEl.remove(1);
        }

        if (specialValue) {
            var special = document.createElement("option");
            special.value = specialValue;
            special.textContent = specialLabel;
            selectEl.appendChild(special);
        }

        for (var i = 0; i < values.length; i++) {
            var opt = document.createElement("option");
            opt.value = values[i];
            opt.textContent = formatLabel(values[i]);
            selectEl.appendChild(opt);
        }
    }


    // -----------------------------------------------------------------------
    // Dynamic Indoor Filter Visibility (Mini Splits only)
    // -----------------------------------------------------------------------
    function updateIndoorVisibility() {
        var numVal = ms.numIndoor.value;
        var num = numVal ? parseInt(numVal, 10) : 0;

        for (var i = 0; i < 5; i++) {
            var unitIndex = i + 1;

            if (i === 0) {
                showGroup(ms.sizeGroups[i]);
                showGroup(ms.typeGroups[i]);
            } else if (num >= unitIndex) {
                showGroup(ms.sizeGroups[i]);
                showGroup(ms.typeGroups[i]);
            } else {
                hideGroup(ms.sizeGroups[i]);
                hideGroup(ms.typeGroups[i]);
                ms.indoorSizes[i].value = "";
                ms.indoorTypes[i].value = "";
                updateSelectHighlight(ms.indoorSizes[i]);
                updateSelectHighlight(ms.indoorTypes[i]);
            }
        }
    }

    function showGroup(groupEl) {
        if (groupEl) groupEl.classList.remove("hidden");
    }

    function hideGroup(groupEl) {
        if (groupEl) groupEl.classList.add("hidden");
    }


    // -----------------------------------------------------------------------
    // Event Handlers
    // -----------------------------------------------------------------------
    function handleFilterChange() {
        if (_updating) return;
        _updating = true;

        if (_activeProduct === "mini-splits") {
            updateIndoorVisibility();
            updateAvailableOptions();
        } else if (_activeProduct === "multi-position") {
            updateMpsAvailableOptions();
        } else if (_activeProduct === "gas-packs") {
            updateGpAvailableOptions();
        }

        updateAllHighlights();
        emitChange();
        _updating = false;
    }

    function handleNumIndoorChange() {
        if (_updating) return;
        _updating = true;

        updateIndoorVisibility();
        updateAvailableOptions();
        updateAllHighlights();
        emitChange();

        _updating = false;
    }

    function emitChange() {
        EventBus.emit("filters:changed", getState());
    }


    // -----------------------------------------------------------------------
    // Active Filter Highlighting
    // -----------------------------------------------------------------------
    function updateAllHighlights() {
        if (_activeProduct === "mini-splits") {
            updateSelectHighlight(ms.systemType);
            updateSelectHighlight(ms.electricalType);
            updateSelectHighlight(ms.outdoorSize);
            updateSelectHighlight(ms.numIndoor);
            for (var i = 0; i < 5; i++) {
                updateSelectHighlight(ms.indoorSizes[i]);
                updateSelectHighlight(ms.indoorTypes[i]);
            }
        } else if (_activeProduct === "multi-position") {
            updateSelectHighlight(mps.size);
            updateSelectHighlight(mps.systemType);
            updateSelectHighlight(mps.nominalEfficiency);
            updateSelectHighlight(mps.electrical);
            updateSelectHighlight(mps.electricHeatKw);
            updateSelectHighlight(mps.compressorStages);
            updateSelectHighlight(mps.fanType);
        } else if (_activeProduct === "gas-packs") {
            updateSelectHighlight(gp.size);
            updateSelectHighlight(gp.electrical);
            updateSelectHighlight(gp.efficiency);
            updateSelectHighlight(gp.coolingStages);
            updateSelectHighlight(gp.gasHeat);
            updateSelectHighlight(gp.hgrh);
        }
    }

    function updateSelectHighlight(selectEl) {
        if (!selectEl) return;
        if (selectEl.value) {
            selectEl.classList.add("has-value");
        } else {
            selectEl.classList.remove("has-value");
        }
    }


    // -----------------------------------------------------------------------
    // Get State
    // -----------------------------------------------------------------------
    function getState() {
        if (_activeProduct === "multi-position") {
            return getStateMps();
        }
        if (_activeProduct === "gas-packs") {
            return getStateGp();
        }
        return getStateMiniSplits();
    }

    function getStateMiniSplits() {
        var indoorSizes = [];
        var indoorTypes = [];

        for (var i = 0; i < 5; i++) {
            indoorSizes.push(ms.indoorSizes[i].value);
            indoorTypes.push(ms.indoorTypes[i].value);
        }

        return {
            systemType:     ms.systemType.value,
            electricalType: ms.electricalType.value,
            outdoorSize:    ms.outdoorSize.value,
            numIndoor:      ms.numIndoor.value,
            indoorSizes:    indoorSizes,
            indoorTypes:    indoorTypes,
        };
    }

    function getStateMps() {
        return {
            size:              mps.size ? mps.size.value : "",
            systemType:        mps.systemType ? mps.systemType.value : "",
            nominalEfficiency: mps.nominalEfficiency ? mps.nominalEfficiency.value : "",
            electrical:        mps.electrical ? mps.electrical.value : "",
            electricHeatKw:    mps.electricHeatKw ? mps.electricHeatKw.value : "",
            compressorStages:  mps.compressorStages ? mps.compressorStages.value : "",
            fanType:           mps.fanType ? mps.fanType.value : "",
        };
    }

    function getStateGp() {
        return {
            size:          gp.size ? gp.size.value : "",
            electrical:    gp.electrical ? gp.electrical.value : "",
            efficiency:    gp.efficiency ? gp.efficiency.value : "",
            coolingStages: gp.coolingStages ? gp.coolingStages.value : "",
            gasHeat:       gp.gasHeat ? gp.gasHeat.value : "",
            hgrh:          gp.hgrh ? gp.hgrh.value : "",
        };
    }

    function hasActiveFilters() {
        if (_activeProduct === "multi-position") {
            var s = getStateMps();
            return !!(s.size || s.systemType || s.nominalEfficiency || s.electrical || s.electricHeatKw || s.compressorStages || s.fanType);
        }

        if (_activeProduct === "gas-packs") {
            var g = getStateGp();
            return !!(g.size || g.electrical || g.efficiency || g.coolingStages || g.gasHeat || g.hgrh);
        }

        var state = getStateMiniSplits();
        if (state.systemType || state.electricalType || state.outdoorSize || state.numIndoor) return true;
        for (var i = 0; i < 5; i++) {
            if (state.indoorSizes[i] || state.indoorTypes[i]) return true;
        }
        return false;
    }


    // -----------------------------------------------------------------------
    // Clear All Filters
    // -----------------------------------------------------------------------
    function clearAll() {
        if (_activeProduct === "multi-position") {
            clearMps();
        } else if (_activeProduct === "gas-packs") {
            clearGp();
        } else {
            clearMiniSplits();
        }
    }

    function clearMiniSplits() {
        ms.systemType.value      = "";
        ms.electricalType.value  = "";
        ms.outdoorSize.value     = "";
        ms.numIndoor.value       = "";

        for (var i = 0; i < 5; i++) {
            ms.indoorSizes[i].value = "";
            ms.indoorTypes[i].value = "";
        }

        populateAllDropdowns();
        updateIndoorVisibility();
        updateAllHighlights();
        emitChange();
    }

    function clearMps() {
        if (mps.size) mps.size.value = "";
        if (mps.systemType) mps.systemType.value = "";
        if (mps.nominalEfficiency) mps.nominalEfficiency.value = "";
        if (mps.electrical) mps.electrical.value = "";
        if (mps.electricHeatKw) mps.electricHeatKw.value = "";
        if (mps.compressorStages) mps.compressorStages.value = "";
        if (mps.fanType) mps.fanType.value = "";

        populateMpsDropdowns();
        updateAllHighlights();
        emitChange();
    }

    function clearGp() {
        if (gp.size) gp.size.value = "";
        if (gp.electrical) gp.electrical.value = "";
        if (gp.efficiency) gp.efficiency.value = "";
        if (gp.coolingStages) gp.coolingStages.value = "";
        if (gp.gasHeat) gp.gasHeat.value = "";
        if (gp.hgrh) gp.hgrh.value = "";

        populateGpDropdowns();
        updateAllHighlights();
        emitChange();
    }


    // -----------------------------------------------------------------------
    // Update Result Count Display
    // -----------------------------------------------------------------------
    function setResultCount(count, total) {
        var el;
        if (_activeProduct === "multi-position") {
            el = mps.resultCount;
        } else if (_activeProduct === "gas-packs") {
            el = gp.resultCount;
        } else {
            el = ms.resultCount;
        }
        if (!el) return;

        if (count === total) {
            el.textContent = count + " systems";
            el.className = "";
        } else if (count === 0) {
            el.textContent = "0 systems found";
            el.className = "no-results";
        } else {
            el.textContent = count + " of " + total + " systems";
            el.className = "has-results";
        }
    }


    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        init:               init,
        switchProduct:      switchProduct,
        getState:           getState,
        hasActiveFilters:   hasActiveFilters,
        clearAll:           clearAll,
        setResultCount:     setResultCount,
    };

})();