/* ==========================================================================
   data-loader.js — Fetch JSON data for multiple product types, build
   lookup maps, expose filtered data to other modules.

   Supports:
     - mini-splits
     - multi-position (Multi Position Splits)
     - gas-packs (Light Commercial RTUs - Gas Heat)
   ========================================================================== */

const DataLoader = (function () {

    // -----------------------------------------------------------------------
    // Product Configuration
    // -----------------------------------------------------------------------
    const PRODUCT_CONFIG = {
        "mini-splits": {
            jsonPath: "DATA/JSON/mini-splits.json",
            assetBase: "ASSETS/MINI SPLITS/",
        },
        "multi-position": {
            jsonPath: "DATA/JSON/multi-position-splits.json",
            assetBase: "ASSETS/MULTI POSITION SPLITS/",
        },
        "gas-packs": {
            jsonPath: "DATA/JSON/gas-packs.json",
            assetBase: "ASSETS/GAS PACKS/",
        },
    };

    // Per-product storage: { data, systems, filterOptions, systemMap, scheduleNotes }
    let _products = {};

    // Active product key
    let _activeProductKey = "mini-splits";


    // -----------------------------------------------------------------------
    // Load a single product's data
    // -----------------------------------------------------------------------
    async function loadProduct(productKey) {
        if (_products[productKey]) {
            return true;   // already loaded
        }

        var config = PRODUCT_CONFIG[productKey];
        if (!config) {
            console.error("[DataLoader] Unknown product:", productKey);
            return false;
        }

        try {
            var response = await fetch(config.jsonPath);

            if (!response.ok) {
                throw new Error(
                    "Failed to load data for " + productKey + ": " +
                    response.status + " " + response.statusText
                );
            }

            var data = await response.json();
            var systems = data.systems || [];
            var filterOptions = data.filterOptions || {};
            var scheduleNotes = data.scheduleNotes || [];

            // Normalize MPS systems: wrap indoorUnit in indoorUnits array
            if (productKey === "multi-position") {
                for (var i = 0; i < systems.length; i++) {
                    if (systems[i].indoorUnit && !systems[i].indoorUnits) {
                        systems[i].indoorUnits = [systems[i].indoorUnit];
                        delete systems[i].indoorUnit;
                    }
                    systems[i].productKey = "multi-position";
                }
            } else {
                for (var j = 0; j < systems.length; j++) {
                    systems[j].productKey = productKey;
                }
            }

            // Build id -> system lookup map
            var systemMap = {};
            for (var k = 0; k < systems.length; k++) {
                systemMap[systems[k].id] = systems[k];
            }

            _products[productKey] = {
                data: data,
                systems: systems,
                filterOptions: filterOptions,
                systemMap: systemMap,
                scheduleNotes: scheduleNotes,
            };

            console.log(
                "[DataLoader] Loaded " + systems.length + " systems for " +
                productKey + " (" + data.productType + " — " + data.manufacturer + ")" +
                " with " + scheduleNotes.length + " schedule notes"
            );

            return true;

        } catch (err) {
            console.error("[DataLoader] Error loading " + productKey + ":", err);
            return false;
        }
    }


    // -----------------------------------------------------------------------
    // Load (default product — backward compatibility)
    // -----------------------------------------------------------------------
    async function load() {
        return await loadProduct("mini-splits");
    }


    // -----------------------------------------------------------------------
    // Switch Active Product
    // -----------------------------------------------------------------------
    async function switchProduct(productKey) {
        if (!PRODUCT_CONFIG[productKey]) {
            console.error("[DataLoader] Unknown product:", productKey);
            return false;
        }

        // Load if not already loaded
        if (!_products[productKey]) {
            var success = await loadProduct(productKey);
            if (!success) return false;
        }

        _activeProductKey = productKey;
        console.log("[DataLoader] Switched to product:", productKey);
        return true;
    }


    // -----------------------------------------------------------------------
    // Active Product Getters
    // -----------------------------------------------------------------------

    function getActiveProductKey() {
        return _activeProductKey;
    }

    /** Full raw data object for active product */
    function getData() {
        var p = _products[_activeProductKey];
        return p ? p.data : null;
    }

    /** Array of all system objects for active product */
    function getSystems() {
        var p = _products[_activeProductKey];
        return p ? p.systems : [];
    }

    /** Pre-built filter options for active product */
    function getFilterOptions() {
        var p = _products[_activeProductKey];
        return p ? p.filterOptions : {};
    }

    /** Whether active product data has been loaded */
    function isLoaded() {
        return !!_products[_activeProductKey];
    }


    // -----------------------------------------------------------------------
    // Cross-Product Getters (search all loaded products)
    // -----------------------------------------------------------------------

    /** Look up a single system by its id — searches all loaded products */
    function getSystemById(id) {
        // Try active product first (fast path)
        var active = _products[_activeProductKey];
        if (active && active.systemMap[id]) {
            return active.systemMap[id];
        }

        // Search other products
        var keys = Object.keys(_products);
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] === _activeProductKey) continue;
            var sys = _products[keys[i]].systemMap[id];
            if (sys) return sys;
        }

        return null;
    }

    /** Get pre-made schedule notes for a given product key */
    function getScheduleNotes(productKey) {
        var pk = productKey || _activeProductKey;
        var p = _products[pk];
        return p ? (p.scheduleNotes || []) : [];
    }


    // -----------------------------------------------------------------------
    // Filtering — Mini Splits
    // -----------------------------------------------------------------------
    function filterMiniSplits(filters) {
        var p = _products["mini-splits"];
        if (!p) return [];

        return p.systems.filter(function (sys) {
            var f = sys.filters;

            if (filters.systemType && f.systemType !== filters.systemType) return false;

            if (filters.outdoorSize) {
                if (f.outdoorSize !== parseFloat(filters.outdoorSize)) return false;
            }

            if (filters.numIndoor) {
                if (f.numIndoor !== parseInt(filters.numIndoor, 10)) return false;
            }

            if (filters.electricalType && f.electricalType !== filters.electricalType) return false;

            var checkCount = filters.numIndoor
                ? parseInt(filters.numIndoor, 10)
                : f.numIndoor;

            for (var i = 0; i < checkCount; i++) {
                if (filters.indoorSizes[i]) {
                    if (!f.indoorSizes[i] || f.indoorSizes[i] !== parseFloat(filters.indoorSizes[i])) return false;
                }
                if (filters.indoorTypes[i]) {
                    if (!f.indoorTypes[i] || f.indoorTypes[i] !== filters.indoorTypes[i]) return false;
                }
            }

            return true;
        });
    }


    // -----------------------------------------------------------------------
    // Filtering — Multi Position Splits
    // -----------------------------------------------------------------------
    function filterMultiPosition(filters) {
        var p = _products["multi-position"];
        if (!p) return [];

        return p.systems.filter(function (sys) {
            var f = sys.filters;

            if (filters.size) {
                if (f.size !== parseFloat(filters.size)) return false;
            }

            if (filters.systemType && f.systemType !== filters.systemType) return false;

            if (filters.nominalEfficiency && f.nominalEfficiency !== filters.nominalEfficiency) return false;

            if (filters.electrical && f.electrical !== filters.electrical) return false;

            if (filters.electricHeatKw) {
                if (filters.electricHeatKw === "NONE") {
                    // Show only systems with no aux heat
                    if (f.electricHeatKw !== null) return false;
                } else {
                    if (f.electricHeatKw !== filters.electricHeatKw) return false;
                }
            }

            if (filters.compressorStages && f.compressorStages !== filters.compressorStages) return false;

            if (filters.fanType && f.fanType !== filters.fanType) return false;

            return true;
        });
    }


    // -----------------------------------------------------------------------
    // Filtering — Gas Packs
    // All filter values are compared as strings (no parseFloat) to avoid
    // corrupting slash-delimited values like "208/3".
    // -----------------------------------------------------------------------
    function filterGasPacks(filters) {
        var p = _products["gas-packs"];
        if (!p) return [];

        return p.systems.filter(function (sys) {
            var f = sys.filters;

            if (filters.size && f.size !== filters.size) return false;
            if (filters.electrical && f.electrical !== filters.electrical) return false;
            if (filters.efficiency && f.efficiency !== filters.efficiency) return false;
            if (filters.coolingStages && f.coolingStages !== filters.coolingStages) return false;
            if (filters.gasHeat && f.gasHeat !== filters.gasHeat) return false;
            if (filters.hgrh && f.hgrh !== filters.hgrh) return false;

            return true;
        });
    }


    // -----------------------------------------------------------------------
    // Unified Filter Dispatch
    // -----------------------------------------------------------------------
    function filterSystems(filters) {
        if (_activeProductKey === "multi-position") {
            return filterMultiPosition(filters);
        }
        if (_activeProductKey === "gas-packs") {
            return filterGasPacks(filters);
        }
        return filterMiniSplits(filters);
    }


    // -----------------------------------------------------------------------
    // Document Helpers — Mini Splits
    // -----------------------------------------------------------------------
    function getMiniSplitDocuments(systemId) {
        var sys = getSystemById(systemId);
        if (!sys || !sys.docs) return [];

        var docs = [];
        var seen = {};

        function add(label, path, type) {
            if (!path || seen[path]) return;
            seen[path] = true;
            docs.push({ label: label, path: path, type: type });
        }

        var d = sys.docs;

        // System-level docs
        add("Submittal (System)", d.submittalSystem, "pdf");
        add("Submittal (Outdoor Unit)", d.submittalOutdoor, "pdf");
        add("Engineering Manual", d.engineeringManual, "pdf");
        add("Capacity Table", d.capacityTable, "pdf");
        add("Installation Manual (Outdoor)", d.installManualOutdoor, "pdf");
        add("Revit (Outdoor)", d.revitOutdoor, "zip");
        add("CAD (Outdoor)", d.cadOutdoor, "zip");

        // Per-indoor-unit docs
        if (d.indoorDocs) {
            for (var i = 0; i < d.indoorDocs.length; i++) {
                var idu = d.indoorDocs[i];
                var suffix = sys.indoorUnits.length > 1
                    ? " — IDU #" + (i + 1)
                    : "";

                add("Submittal (Indoor)" + suffix, idu.submittalIndoor, "pdf");
                add("Installation Manual (Indoor)" + suffix, idu.installManualIndoor, "pdf");
                add("Operation Manual" + suffix, idu.operationManual, "pdf");
                add("Revit (Indoor)" + suffix, idu.revitIndoor, "zip");
                add("CAD (Indoor)" + suffix, idu.cadIndoor, "zip");
            }
        }

        return docs;
    }


    // -----------------------------------------------------------------------
    // Document Helpers — Multi Position Splits
    // -----------------------------------------------------------------------
    function getMultiPositionDocuments(systemId) {
        var sys = getSystemById(systemId);
        if (!sys || !sys.docs) return [];

        var docs = [];
        var seen = {};

        function add(label, path, type) {
            if (!path || seen[path]) return;
            seen[path] = true;
            docs.push({ label: label, path: path, type: type });
        }

        var d = sys.docs;

        // System-level docs
        add("Submittal (System)", d.submittalSystem, "pdf");
        add("Submittal (Outdoor Unit)", d.submittalOutdoor, "pdf");
        add("Submittal (Indoor Unit)", d.submittalIndoor, "pdf");
        add("Engineering Manual (System)", d.engineeringManualSystem, "pdf");
        add("Engineering Manual (Outdoor Unit)", d.engineeringManualOutdoor, "pdf");
        add("Engineering Manual (Indoor Unit)", d.engineeringManualIndoor, "pdf");
        add("Capacity Table", d.capacityTable, "pdf");
        add("Installation Manual (Outdoor)", d.installManualOutdoor, "pdf");
        add("Installation Manual (Indoor)", d.installManualIndoor, "pdf");
        add("Revit (Outdoor)", d.revitOutdoor, "zip");
        add("Revit (Indoor)", d.revitIndoor, "zip");
        add("CAD (Outdoor)", d.cadOutdoor, "zip");
        add("CAD (Indoor)", d.cadIndoor, "zip");

        return docs;
    }


    // -----------------------------------------------------------------------
    // Document Helpers — Gas Packs (single unit — no indoor/outdoor split)
    // -----------------------------------------------------------------------
    function getGasPacksDocuments(systemId) {
        var sys = getSystemById(systemId);
        if (!sys || !sys.docs) return [];

        var docs = [];
        var seen = {};

        function add(label, path, type) {
            if (!path || seen[path]) return;
            seen[path] = true;
            docs.push({ label: label, path: path, type: type });
        }

        var d = sys.docs;

        add("Submittal", d.submittal, "pdf");
        add("Engineering Manual", d.engineeringManual, "pdf");
        add("Installation Manual", d.installationManual, "pdf");
        add("Revit", d.revit, "zip");
        add("CAD", d.cad, "zip");

        return docs;
    }


    // -----------------------------------------------------------------------
    // Unified Document Access
    // -----------------------------------------------------------------------
    function getSystemDocuments(systemId) {
        var sys = getSystemById(systemId);
        if (!sys) return [];

        if (sys.productKey === "gas-packs") {
            return getGasPacksDocuments(systemId);
        }
        if (sys.productKey === "multi-position") {
            return getMultiPositionDocuments(systemId);
        }
        return getMiniSplitDocuments(systemId);
    }

    function getSystemDocCount(systemId) {
        return getSystemDocuments(systemId).length;
    }


    // -----------------------------------------------------------------------
    // System Summary
    // -----------------------------------------------------------------------
    function getSystemSummary(systemId) {
        var sys = getSystemById(systemId);
        if (!sys) return "";

        if (sys.productKey === "gas-packs") {
            return getGasPacksSummary(sys);
        }
        if (sys.productKey === "multi-position") {
            return getMultiPositionSummary(sys);
        }
        return getMiniSplitSummary(sys);
    }

    function getMiniSplitSummary(sys) {
        var numIndoor = sys.indoorUnits.length;
        var zone = numIndoor === 1 ? "Single-Zone" : numIndoor + "-Zone";
        var type = sys.filters.systemType || "";
        var size = sys.filters.outdoorSize
            ? sys.filters.outdoorSize + " Ton"
            : "";

        return [zone, type, size, sys.outdoorUnit.manufacturer].filter(Boolean).join(" — ");
    }

    function getMultiPositionSummary(sys) {
        var size = sys.filters.size ? sys.filters.size + " Ton" : "";
        var type = sys.filters.systemType || "";
        var model = sys.indoorUnits[0].model || "";

        return ["Multi-Position", type, size, model].filter(Boolean).join(" — ");
    }

    function getGasPacksSummary(sys) {
        var size = sys.filters.size ? sys.filters.size + " Ton" : "";
        var model = sys.schedule.model || "";

        return ["Gas Pack RTU", size, model].filter(Boolean).join(" — ");
    }


    // -----------------------------------------------------------------------
    // Asset Base Path (for document download)
    // -----------------------------------------------------------------------
    function getAssetBase(productKey) {
        var config = PRODUCT_CONFIG[productKey || _activeProductKey];
        return config ? config.assetBase : "";
    }


    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    return {
        load:                load,
        loadProduct:         loadProduct,
        switchProduct:       switchProduct,
        getActiveProductKey: getActiveProductKey,
        isLoaded:            isLoaded,
        getData:             getData,
        getSystems:          getSystems,
        getFilterOptions:    getFilterOptions,
        getSystemById:       getSystemById,
        getScheduleNotes:    getScheduleNotes,
        filterSystems:       filterSystems,
        getSystemDocuments:  getSystemDocuments,
        getSystemDocCount:   getSystemDocCount,
        getSystemSummary:    getSystemSummary,
        getAssetBase:        getAssetBase,
    };

})();
