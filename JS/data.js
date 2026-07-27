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
                variantColumn: 'K',
                dependentColumns: ['M', 'N'],
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
        },
        {
            productKey: 'diffusers',
            displayName: 'DIFFUSERS',
            jsonFile: 'DATA/JSON/diffusers.json',
            pictureFile: 'DATA/PICTURES/DIFFUSERS.jpg',
            assetsFolder: 'ASSETS/DIFFUSERS',
            tileClass: 'tile-diffusers',
            autoTagPrefix: 'D-',
            // The diffuser schedule holds 8 model families in one sheet,
            // so most columns only apply to some models. Hide any data
            // column that is empty for every row currently in view
            // (browse page respects the active filters; the project
            // schedule + exports respect the items in the project).
            hideEmptyColumns: true,
            // Model picker gallery rendered above the filters/schedule
            // on the browse page. `model` must match the MODEL column
            // value in the Excel data exactly - clicking a card filters
            // the schedule to that model (via the DESCRIPTION filter).
            modelGallery: [
                { model: 'SPD',          picture: 'DATA/PICTURES/Price SPD (Black).jpg' },
                { model: 'SCD',          picture: 'DATA/PICTURES/Price SCD (Black).jpg' },
                { model: 'SPD (Return)', picture: 'DATA/PICTURES/Price SPD (Black).jpg' },
                { model: 'SCDA',         picture: 'DATA/PICTURES/Price SCDA (Black).jpg' },
                { model: 'SMD/AMD',      picture: 'DATA/PICTURES/Price SMD (Black).jpg' },
                { model: 'SMD w/ SR',    picture: 'DATA/PICTURES/Price SMD (Black).jpg' },
                { model: 'PDDR',         picture: 'DATA/PICTURES/Price PDDR (Black).jpg' }
            ],
            // Core-style icon row: shown under the model gallery on the
            // browse page whenever an SMD-family model is selected.
            // Each icon (sliced from the Price options sheet) acts as a
            // CORE STYLE filter button - clicking selects the filter
            // value containing that code. Icons whose code isn't in the
            // data render dimmed as reference only.
            coreStyles: {
                folder: 'DATA/PICTURES/CORE STYLES',
                codes: ['1S', '2S', '2G', '3A', '4A',
                        '1A', '1B', '2A', '2B', '2C', '2D', '2E', '2F',
                        '3A1', '3A2', '3B', '3C', '3E',
                        '4B', '4C', '4E'],
                descriptions: ['MODULAR LOUVERED FACE DIFFUSER',
                               'MODULAR LOUVERED FACE DIFFUSER (SQUARE TO ROUND)']
            },
            // Core-style legend image embedded INSIDE the schedule frame
            // (to the right of the schedule notes) on-screen and in the
            // Excel / PDF exports whenever any of the listed models is
            // in the project schedule.
            notesLegend: {
                models: ['SMD/AMD', 'SMD w/ SR'],
                title: 'SMD/AMD CORE STYLE LEGEND:',
                picture: 'DATA/PICTURES/SMD & AMD Options.jpg',
                width: 1064,
                height: 616
            }
        },
        {
            productKey: 'grilles',
            displayName: 'GRILLES',
            jsonFile: 'DATA/JSON/grilles.json',
            pictureFile: 'DATA/PICTURES/GRILLES.jpg',
            assetsFolder: 'ASSETS/GRILLES',
            tileClass: 'tile-grilles',
            autoTagPrefix: 'G-',
            // 32 model groups from 13 catalogs share one sheet, so most
            // columns only apply to some families (supply deflection
            // columns, return neg. static pressure, linear-bar per-foot
            // columns). Hide any data column empty for every row in view.
            hideEmptyColumns: true,
            // 32k+ selections - never render them all at once. The status
            // line still shows the true match count; a notice asks the
            // user to narrow filters past this many rows.
            maxBrowseRows: 500,
            // Family picker gallery (same mechanics as the diffusers,
            // rendered by JS/grilles.js). `model` must match a MODEL
            // column value; clicking a card filters via DESCRIPTION, so
            // one representative model per family is enough. `label` is
            // the card caption (family name instead of the long grouped
            // model string).
            modelGallery: [
                { model: '150',                     label: '150',             picture: 'DATA/PICTURES/Price 150 (Black).jpg' },
                { model: '21/22/31/32',             label: '20/30',           picture: 'DATA/PICTURES/Price 20-30 (Black).jpg' },
                { model: '301/302',                 label: '300',             picture: 'DATA/PICTURES/Price 300 (Black).jpg' },
                { model: '510/520/610/620/710/720', label: '500/600/700',     picture: 'DATA/PICTURES/Price 500-600-700 (Black).jpg' },
                { model: '910/920',                 label: '900 GYM',         picture: 'DATA/PICTURES/Price 900 (Black).jpg' },
                { model: '540/640',                 label: '540/640',         picture: 'DATA/PICTURES/Price 540-640 (Black).jpg' },
                { model: 'LBP/LBPH',                label: 'LINEAR BAR',      picture: 'DATA/PICTURES/Price LBP (Black).jpg' },
                { model: 'LBMH',                    label: 'LINEAR BAR HD',   picture: 'DATA/PICTURES/Price LBMH (Black).jpg' },
                { model: '510Z/610Z/710Z',          label: '500/600/700 RTN', picture: 'DATA/PICTURES/Price 500-600-700 Return (Black).jpg' },
                { model: '60/60FH',                 label: '60/70',           picture: 'DATA/PICTURES/Price Airfoil Return (Black).jpg' },
                { model: '80/81/82',                label: 'EGG CRATE',       picture: 'DATA/PICTURES/Price Egg Crate (Black).jpg' },
                { model: '10/10FF',                 label: 'PERFORATED',      picture: 'DATA/PICTURES/Price Perforated Return (Black).jpg' },
                { model: '90/90FH',                 label: '90 GYM RTN',      picture: 'DATA/PICTURES/Price Return Gym (Black).jpg' },
                { model: 'LG50',                    label: 'LATTICE',         picture: 'DATA/PICTURES/Price Lattice (Black).jpg' },
                { model: 'STG',                     label: 'TRANSFER',        picture: 'DATA/PICTURES/Price Transfer (Black).jpg' }
            ]
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
                    // Very large products (grilles) are split across
                    // multiple JSON files to stay under Cloudflare
                    // Pages' 25 MiB per-file limit. The main file lists
                    // its continuation files (selections-only chunks in
                    // the same folder); fetch them all and re-join the
                    // selections in order before caching.
                    var cont = data.continuationFiles;
                    if (!cont || !cont.length) {
                        productDataCache[productKey] = data;
                        return data;
                    }
                    var dir = product.jsonFile.slice(0, product.jsonFile.lastIndexOf('/') + 1);
                    return Promise.all(cont.map(function (name) {
                        var url = dir + name;
                        return fetch(url).then(function (resp) {
                            if (!resp.ok) {
                                throw new Error('Failed to load ' + url + ' (HTTP ' + resp.status + ')');
                            }
                            return resp.json();
                        });
                    })).then(function (partList) {
                        partList.forEach(function (part) {
                            data.selections = data.selections.concat(part.selections || []);
                        });
                        productDataCache[productKey] = data;
                        return data;
                    });
                });
        }
    };
})();