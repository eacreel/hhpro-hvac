/* ==========================================================================
   app.js — Application entry point. Initializes all modules and wires
   the data flow via EventBus: DataLoader → Filters → Schedule → Project → Export.
   Handles product tab switching between Mini Splits, Multi Position, and Gas Packs.
   Manages loading states for data load and product switching.
   ========================================================================== */

(function () {

    "use strict";

    // Track the currently active product tab
    var _activeProduct = "mini-splits";

    // Loading overlay element
    var _loadingOverlay = null;
    var _loadingMessage = null;

    // Tab loading bar element (created dynamically)
    var _tabLoadingBar = null;

    // -----------------------------------------------------------------------
    // Boot
    // -----------------------------------------------------------------------
    document.addEventListener("DOMContentLoaded", async function () {

        console.log("[App] Starting HHpro Equipment Selection…");

        // Grab loading overlay references
        _loadingOverlay = document.getElementById("loading-overlay");
        _loadingMessage = _loadingOverlay ? _loadingOverlay.querySelector(".loading-message") : null;

        // Create tab loading bar (for product switching)
        _tabLoadingBar = document.createElement("div");
        _tabLoadingBar.className = "tab-loading-bar";
        document.body.appendChild(_tabLoadingBar);

        // Show initial loading state
        showLoading("Loading equipment data…");

        // ---- 1. Load ALL product data upfront ----
        var success = await DataLoader.load();
        if (!success) {
            hideLoading();
            showFatalError("Failed to load equipment data. Check that DATA/JSON/mini-splits.json exists.");
            return;
        }
        // Pre-load other products (non-blocking — failures are OK)
        await DataLoader.loadProduct("multi-position");
        await DataLoader.loadProduct("gas-packs");

        // ---- 2. Subscribe to EventBus events ----
        wireEventBus();

        // ---- 3. Initialize modules (no callbacks needed) ----
        Filters.init();
        Schedule.init();
        Project.init();
        SchedulePreview.init();
        Export.init();

        // ---- 4. Wire up product tabs ----
        wireProductTabs();

        // ---- 5. Initial render ----
        performFilterAndRender();

        // ---- 6. Hide loading overlay ----
        hideLoading();

        console.log("[App] Ready.");
    });


    // -----------------------------------------------------------------------
    // EventBus Wiring
    // -----------------------------------------------------------------------
    function wireEventBus() {

        // Filters changed → re-filter and re-render schedule
        EventBus.on("filters:changed", function (filterState) {
            performFilterAndRender();
        });

        // User clicked "+" on schedule row → add to project
        EventBus.on("system:add", function (systemId) {
            Project.addSystem(systemId);
        });

        // Project changed → update schedule add-button states
        EventBus.on("project:changed", function (projectIds) {
            Schedule.updateAddButtons(projectIds);
        });

        // Loading state requests from other modules (e.g. exports)
        EventBus.on("app:loading", function (payload) {
            if (payload && payload.show) {
                showLoading(payload.message || "Processing…");
            } else {
                hideLoading();
            }
        });
    }


    // -----------------------------------------------------------------------
    // Loading State Management
    // -----------------------------------------------------------------------

    /**
     * Show the full-page loading overlay with a message.
     */
    function showLoading(message) {
        if (!_loadingOverlay) return;
        if (_loadingMessage) _loadingMessage.textContent = message || "Loading…";
        _loadingOverlay.classList.remove("loading-hidden");
    }

    /**
     * Hide the full-page loading overlay with a fade-out.
     */
    function hideLoading() {
        if (!_loadingOverlay) return;
        _loadingOverlay.classList.add("loading-hidden");
    }

    /**
     * Show the slim loading bar below the tab bar (for product switching).
     */
    function showTabLoading() {
        if (_tabLoadingBar) _tabLoadingBar.classList.add("active");
    }

    /**
     * Hide the slim loading bar below the tab bar.
     */
    function hideTabLoading() {
        if (_tabLoadingBar) _tabLoadingBar.classList.remove("active");
    }


    // -----------------------------------------------------------------------
    // Product Tab Switching
    // -----------------------------------------------------------------------
    function wireProductTabs() {
        var tabs = document.querySelectorAll(".product-tab:not(.disabled)");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].addEventListener("click", handleTabClick);
        }
    }

    function handleTabClick(e) {
        var tab = e.currentTarget;
        var productKey = tab.dataset.product;

        if (!productKey || productKey === _activeProduct) return;
        if (tab.classList.contains("disabled")) return;

        switchProduct(productKey);
    }

    async function switchProduct(productKey) {
        // Show tab loading indicator
        showTabLoading();

        EventBus.emit("product:switching", productKey);

        // Update tab visual state
        var tabs = document.querySelectorAll(".product-tab");
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.remove("active");
            if (tabs[i].dataset.product === productKey) {
                tabs[i].classList.add("active");
            }
        }

        // Show/hide product content sections
        var productSections = document.querySelectorAll(".product-content");
        for (var j = 0; j < productSections.length; j++) {
            productSections[j].classList.add("hidden");
        }

        var targetSection = document.getElementById("product-" + productKey);
        if (targetSection) {
            targetSection.classList.remove("hidden");
        }

        // Switch DataLoader to new product
        var success = await DataLoader.switchProduct(productKey);
        if (!success) {
            hideTabLoading();
            showFatalError("Failed to load data for " + productKey + ".");
            return;
        }

        _activeProduct = productKey;

        // Reinitialize filters for the new product
        Filters.switchProduct(productKey);

        // Reinitialize schedule for the new product
        Schedule.switchProduct(productKey);

        // Render with new data
        performFilterAndRender();

        // Hide tab loading indicator
        hideTabLoading();

        EventBus.emit("product:switched", productKey);

        console.log("[App] Switched to product:", productKey);
    }

    /** Get the currently active product key */
    function getActiveProduct() {
        return _activeProduct;
    }

    // Expose globally for other modules
    window.App = {
        getActiveProduct: getActiveProduct,
    };


    // -----------------------------------------------------------------------
    // Filter → Schedule Flow
    // -----------------------------------------------------------------------

    /**
     * Core render pipeline:
     *   1. Read filter state
     *   2. Filter systems through DataLoader
     *   3. Render filtered results into the schedule table
     *   4. Update result count display
     */
    function performFilterAndRender() {
        var filterState = Filters.getState();
        var allSystems = DataLoader.getSystems();
        var filtered = DataLoader.filterSystems(filterState);
        var projectIds = Project.getProjectIds();

        // Render schedule
        Schedule.render(filtered, projectIds);

        // Update result count
        Filters.setResultCount(filtered.length, allSystems.length);
    }


    // -----------------------------------------------------------------------
    // Fatal Error Display
    // -----------------------------------------------------------------------
    function showFatalError(message) {
        var content = document.getElementById("content");
        if (!content) return;

        content.innerHTML =
            '<div class="fatal-error-wrap">' +
            '<div class="fatal-error-inner">' +
            '<div class="fatal-error-icon">&#9888;</div>' +
            '<h2 class="fatal-error-title">Data Load Error</h2>' +
            '<p class="fatal-error-message">' + message + '</p>' +
            '</div></div>';

        console.error("[App] Fatal:", message);
    }

})();