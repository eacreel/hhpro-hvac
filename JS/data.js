/* ============================================================
   HHpro - Data module
   ------------------------------------------------------------
   Central product registry. Adding a new product type to the
   site is as simple as adding a new entry to PRODUCTS below
   (plus running convert_to_json.py on the matching Excel file).
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};

    /**
     * Product registry.
     *
     * Each entry describes one product type tile on the main page and
     * links to the JSON data file the site loads for that product.
     *
     * To add a new product type:
     *   1. Add the Excel file to DATA/DATA FILES/
     *   2. Add an entry in convert_to_json.py's PRODUCT_CONFIGS
     *   3. Run convert_to_json.py
     *   4. Add a new entry below, then add a matching tile color
     *      variable and .tile-<productKey> rule in CSS/main.css
     *   5. Create a stub JS file at JS/products/<productKey>.js
     *      (see gas_packs.js for the pattern) and add it to index.html
     *   6. (Optional) Drop a JPG in DATA/PICTURES/ with the exact
     *      filename shown in pictureFile. If missing, the colored
     *      placeholder shows instead.
     */
    var PRODUCTS = [
        {
            productKey: 'gas_packs',
            displayName: 'GAS PACK RTUS',
            jsonFile: 'DATA/JSON/gas_packs.json',
            pictureFile: 'DATA/PICTURES/GAS PACK RTUS.jpg',
            assetsFolder: 'ASSETS/GAS PACKS',
            tileClass: 'tile-gas-packs'
        },
        {
            productKey: 'mini_splits',
            displayName: 'MINI SPLITS',
            jsonFile: 'DATA/JSON/mini_splits.json',
            pictureFile: 'DATA/PICTURES/MINI SPLITS.jpg',
            assetsFolder: 'ASSETS/MINI SPLITS',
            tileClass: 'tile-mini-splits'
        },
        {
            productKey: 'multi_position_splits',
            displayName: 'MULTI POSITION SPLITS',
            jsonFile: 'DATA/JSON/multi_position_splits.json',
            pictureFile: 'DATA/PICTURES/MULTI POSITION SPLITS.jpg',
            assetsFolder: 'ASSETS/MULTI POSITION SPLITS',
            tileClass: 'tile-multi-position-splits',
            // Collapse selections that differ only in AUX. ELECTRIC HEAT
            // kW into a single row with a kW dropdown. The dropdown
            // swaps the dependent columns (TEMPERATURE RISE, MCA, MOP)
            // to the chosen variant's values; Select / Submittal / Docs
            // and the project-view schedule all act on whichever variant
            // is currently selected.
            kwVariants: {
                variantColumn: 'L',
                dependentColumns: ['M', 'O', 'P'],
                filterName: 'KW',
                defaultValue: '-'
            }
        },
        {
            productKey: 'gas_splits',
            displayName: 'GAS SPLITS',
            jsonFile: 'DATA/JSON/gas_splits.json',
            pictureFile: 'DATA/PICTURES/GAS SPLITS.jpg',
            assetsFolder: 'ASSETS/GAS SPLITS',
            tileClass: 'tile-gas-splits'
        },
        {
            productKey: 'marvair',
            displayName: 'MARVAIR VERTICAL WALL MOUNT',
            jsonFile: 'DATA/JSON/marvair.json',
            pictureFile: 'DATA/PICTURES/MARVAIR VERTICAL WALL MOUNT.jpg',
            assetsFolder: 'ASSETS/MARVAIR',
            tileClass: 'tile-marvair',
            // Collapse selections that differ only in ELECTRIC HEAT (KW)
            // into a single row with a kW dropdown. The dropdown swaps
            // the dependent columns (MCA, MOCP) to the chosen variant's
            // values. See multi_position_splits above for details.
            kwVariants: {
                variantColumn: 'I',
                dependentColumns: ['K', 'L'],
                filterName: 'ELECTRIC HEAT',
                defaultValue: 0
            }
        },
        {
            productKey: 'vfds',
            displayName: 'VFDs',
            jsonFile: 'DATA/JSON/vfds.json',
            pictureFile: 'DATA/PICTURES/VFDs.jpg',
            assetsFolder: 'ASSETS/VFDs',
            tileClass: 'tile-vfds',
            // Unlike the other products, VFD schedule notes are a fixed
            // authoritative list - users can't delete items or add
            // custom ones. The notes render as a plain numbered list
            // in the order defined on the SCHEDULE NOTES tab.
            scheduleNotesReadOnly: true,
            // Schedule column letters to hide on the selection (browse)
            // page. The project-view schedule creator still shows these.
            // For VFDs, column M is the "Notes" column (per-item note
            // numbers) - useful in the final schedule but noisy while
            // browsing.
            hiddenSelectionColumns: ['M'],
            // Don't render the free-text "Accessories" column anywhere
            // (browse page, project schedule creator, Excel/PDF export).
            // VFDs convey per-item annotations via the Notes column.
            hideAccessoriesColumn: true,
            // Render a manual-input "Serves" column immediately to the
            // right of the primary Tag column in the project schedule
            // creator (and in Excel/PDF export).
            hasServesColumn: true,
            // Auto Tag prefix default for this product.
            autoTagPrefix: 'VFD-'
        }
    ];

    // In-memory cache for loaded product JSON (filled lazily by loadProduct)
    var productDataCache = {};

    HHpro.Data = {
        getProducts: function () {
            return PRODUCTS.slice();
        },

        getProduct: function (productKey) {
            for (var i = 0; i < PRODUCTS.length; i++) {
                if (PRODUCTS[i].productKey === productKey) {
                    return PRODUCTS[i];
                }
            }
            return null;
        },

        /**
         * Asynchronously fetch a product's JSON data. Caches after first load.
         * Returns a Promise resolving to the parsed JSON object.
         */
        loadProduct: function (productKey) {
            var product = this.getProduct(productKey);
            if (!product) {
                return Promise.reject(new Error('Unknown product key: ' + productKey));
            }
            if (productDataCache[productKey]) {
                return Promise.resolve(productDataCache[productKey]);
            }
            return fetch(product.jsonFile)
                .then(function (resp) {
                    if (!resp.ok) {
                        throw new Error('Failed to load ' + product.jsonFile + ' (HTTP ' + resp.status + ')');
                    }
                    return resp.json();
                })
                .then(function (data) {
                    productDataCache[productKey] = data;
                    return data;
                });
        }
    };
})();