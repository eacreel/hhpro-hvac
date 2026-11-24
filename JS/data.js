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
            // Gas packs AND heat pumps (LC RTU DATA.xlsx). The key and JSON
            // name predate the heat pumps; they stay so saved projects and
            // the Users permissions sheet keep resolving.
            productKey: 'gas_packs',
            displayName: 'Daikin Light Commercial RTUs',
            jsonFile: 'DATA/JSON/gas_packs.json',
            pictureFile: 'DATA/PICTURES/GAS PACK RTUS.jpg',
            assetsFolder: 'ASSETS/DAIKIN LIGHT COMMERCIAL RTU',
            tileClass: 'tile-gas-packs',
            // Heat pumps are listed once per AUX. ELECTRIC HEAT kW; collapse
            // them into one row with a kW dropdown that swaps the aux heat
            // temperature rise, MCA / MOCP (and the submittal).
            kwVariants: {
                variantColumn: 'X',
                dependentColumns: ['Y', 'AD', 'AE'],
                defaultValue: '-',
                singleAsText: true,
                // Gas packs are listed once per gas heat size (Low / Medium /
                // High); collapse them into one row with a dropdown in the
                // Input (MBH) column. Besides the model number, output and
                // LAT, some units were selected at a different airflow per
                // heat size, so the CFM and cooling cells follow it too.
                alternates: [{
                    filter: 'TYPE',
                    value: 'GAS',
                    variantColumn: 'M',
                    dependentColumns: ['B', 'D', 'F', 'G', 'K', 'L', 'N', 'Q'],
                    labelFilter: 'HIGH/MEDIUM/LOW GAS HEAT',
                    ariaLabel: 'Gas heat input (MBH)',
                    singleAsText: true
                }]
            },
            // Each unit type fills its own heating columns and leaves the
            // other type's as "-". When every unit in view is one TYPE, the
            // other type's columns are hidden, so a gas-only project shows
            // exactly the old gas pack schedule.
            typeColumns: {
                filter: 'TYPE',
                columns: {
                    'GAS': ['M', 'N', 'O', 'P', 'Q'],                 // gas heating
                    // heat pump heating (47 F, 17 F, design OA, temp rise,
                    // COPs) + aux heat (kW, temp rise)
                    'HEAT PUMP': ['R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y']
                }
            }
        },
        {
            // 1:1 mini splits AND multi splits (MINI SPLIT DATA.xlsx, two
            // schedule tabs since Nov 2026). The display name is also the
            // product's row name on the Users Permissions tab; the key and
            // JSON name stay so saved projects keep resolving.
            productKey: 'mini_splits',
            displayName: 'Daikin Mini & Multi Splits',
            jsonFile: 'DATA/JSON/mini_splits.json',
            pictureFile: 'DATA/PICTURES/MINI SPLITS.jpg',
            assetsFolder: 'ASSETS/MINI SPLITS',
            tileClass: 'tile-mini-splits',
            // Hide every column with nothing but "-" (or blanks) in the rows
            // in view: multi splits have no LDB / LWB / sensible / heat pump
            // capacity, 1:1 systems no Available Capacity. Browse page per
            // the filters; project schedule + exports per the project items.
            hideEmptyColumns: true,
            emptyColumnValues: ['-'],
            // ~28,000 multi split systems: render at most this many schedule
            // rows (indoor unit rows, not systems) until the filters narrow it.
            maxBrowseRows: 500,
            // A SCHEDULE NOTES line starting with this applies to multi
            // splits only ("*Capacity listed is nominal ..."): it is left
            // out unless a multi split system is in the project.
            multiOnlyNotePrefix: '*',
            // SYSTEM TYPE (1:1 Mini Splits / Multi Splits) is made on the
            // site (mini_splits.js prepareData) and driven by the two
            // buttons above the photo cards - no dropdown.
            galleryOnlyFilters: ['SYSTEM TYPE'],
            // Indoor-unit-type picker gallery rendered above the filters
            // on the browse page (see JS/mini_splits.js), hidden while
            // Multi Splits is selected. `type` must match a TYPE (INDOOR
            // UNIT #1) filter value exactly - clicking a card filters the
            // schedule to that 1:1 indoor type.
            // Photos are the indoor-unit shots from the submittal PDFs,
            // flood-filled onto black like the Price "(Black)" renders.
            typeGallery: [
                { type: 'Wall Mounted',          picture: 'DATA/PICTURES/MINI SPLIT TYPES/Wall Mounted.jpg' },
                { type: 'Cassette',              picture: 'DATA/PICTURES/MINI SPLIT TYPES/Cassette.jpg' },
                { type: 'Ducted Concealed',      picture: 'DATA/PICTURES/MINI SPLIT TYPES/Ducted Concealed.jpg' },
                { type: 'Floor Mounted (Black)', picture: 'DATA/PICTURES/MINI SPLIT TYPES/Floor Mounted (Black).jpg' },
                { type: 'Floor Mounted (White)', picture: 'DATA/PICTURES/MINI SPLIT TYPES/Floor Mounted (White).jpg' }
            ]
        },
        {
            // Key, JSON and folder names predate the rename (Oct 2026);
            // they stay so saved projects and permissions keep resolving.
            productKey: 'multi_position_splits',
            displayName: 'Daikin Unitary & Light Commercial Split Systems',
            jsonFile: 'DATA/JSON/multi_position_splits.json',
            pictureFile: 'DATA/PICTURES/MULTI POSITION SPLITS.jpg',
            assetsFolder: 'ASSETS/MULTI POSITION SPLITS',
            tileClass: 'tile-multi-position-splits',
            // Air handler style picker gallery above the filters (see
            // JS/multi_position_splits.js). `style` must match a PHOTO
            // FILTER value exactly - clicking a card filters the schedule
            // to that style. The caption shows the full style text, with
            // the tonnage range on its own line.
            styleGallery: [
                { style: 'Multi Position (1.5 to 10.0 Tons)',  picture: 'DATA/PICTURES/Multi Position (1.5 to 10.0 Tons).png' },
                { style: 'Ceiling Mounted (1.5 to 2.5 Tons)',  picture: 'DATA/PICTURES/Ceiling Mounted (1.5 to 2.5 Tons).png' },
                { style: 'Apartment Style (1.0 to 3.0 Tons)',  picture: 'DATA/PICTURES/Apartment Style (1.0 to 3.0 Tons).png' }
            ],
            // Filters driven only by a picture gallery: they still filter
            // the schedule, but get no dropdown on the browse page or in
            // Design Search.
            galleryOnlyFilters: ['PHOTO FILTER']
            // One row per system since Oct 2026: the air handler's voltage,
            // electric heat kW, MCA / MOP come from the AHU ELECTRICAL tab
            // as row dropdowns (JS/ahu_electrical.js), not kW-variant rows.
        },
        {
            productKey: 'gas_splits',
            displayName: 'Daikin Gas Splits',
            jsonFile: 'DATA/JSON/gas_splits.json',
            pictureFile: 'DATA/PICTURES/GAS SPLITS.jpg',
            assetsFolder: 'ASSETS/GAS SPLITS',
            tileClass: 'tile-gas-splits'
        },
        {
            // Daikin water source heat pumps (added 2026-11-14), horizontal
            // and vertical on one schedule (DAIKIN WSHP DATA.xlsx). The
            // display name is also the product's row name on the Users
            // Permissions tab.
            productKey: 'wshp',
            displayName: 'Daikin Water Source Heat Pumps',
            jsonFile: 'DATA/JSON/wshp.json',
            pictureFile: 'DATA/PICTURES/WSHP (Black).jpg',
            assetsFolder: 'ASSETS/DAIKIN WSHP',
            tileClass: 'tile-wshp',
            autoTagPrefix: 'WSHP-',
            // The workbook lists every unit twice, once per cooling
            // entering air (75/63 and 80/67). Collapse each pair into one
            // row with a dropdown in the cooling EDB cell; it swaps the
            // EWB, LWT, leaving air, capacities, heat of rejection and EER
            // (and the submittal / Revit / CAD, which differ per row).
            kwVariants: {
                variantColumn: 'J',
                dependentColumns: ['H', 'K', 'L', 'M', 'N', 'O', 'P', 'Q'],
                defaultValue: 75,
                singleAsText: true,
                ariaLabel: 'Cooling entering air dry bulb (°F)'
            },
            // Notes work like the Price RAC: every row's Accessories column
            // (AT) says "All" for the fixed SCHEDULE NOTES list, so the
            // list can't be edited, the site's free-text Accessories
            // column is not added, and AT is hidden while browsing.
            scheduleNotesReadOnly: true,
            hiddenSelectionColumns: ['AT'],
            hideAccessoriesColumn: true,
            // The first filter is the nominal BTU/H, not tons.
            cartSizeLabel: '{} BTU/H'
        },
        {
            // Markel electric heaters (added 2026-11-14). Two workbooks
            // with different columns (MARKEL DATA - 3320 wall heaters,
            // MARKEL DATA - 5100 suspended unit heaters) are converted into
            // one markel.json holding two sub-schedules, the same shape as
            // GPS, so the project view and exports stack one schedule per
            // heater type. The display name is also the product's row name
            // on the Users Permissions tab.
            productKey: 'markel',
            displayName: 'Markel Electric Heaters',
            jsonFile: 'DATA/JSON/markel.json',
            pictureFile: 'DATA/PICTURES/MARKEL ELECTRIC HEATERS.jpg',
            assetsFolder: 'ASSETS/MARKEL',
            tileClass: 'tile-markel',
            autoTagPrefix: 'EH-',
            // The workbooks' Notes column cites the numbered notes under
            // each schedule, so the notes are a fixed list (like GPS).
            scheduleNotesReadOnly: true,
            // Two column sets make tolerance targets awkward (like GPS).
            excludeFromDesignSearch: true,
            // Cart labels lead with the heater kW, e.g. "1.5 KW / <model>".
            cartSizeFilter: 'KW',
            cartSizeLabel: '{} KW',
            // Photo page shown first (JS/markel.js). Clicking a card opens
            // the schedule with `filter` set to that card's `value`; with
            // the filter cleared, both schedules stack on the page.
            typePicker: {
                filter: 'Type',
                prompt: 'Select a heater type to open its schedule',
                backLabel: 'All Heater Types',
                cards: [
                    { value: 'Wall',      label: 'Wall Mounted 3320', picture: 'DATA/PICTURES/Markel 3320 (Black).jpg' },
                    { value: 'Suspended', label: 'Suspended 5100',    picture: 'DATA/PICTURES/Markel 5100 (Black).jpg' }
                ]
            }
        },
        {
            productKey: 'marvair',
            displayName: 'Marvair Vertical Wall Mount',
            jsonFile: 'DATA/JSON/marvair.json',
            pictureFile: 'DATA/PICTURES/MARVAIR VERTICAL WALL MOUNT.jpg',
            assetsFolder: 'ASSETS/MARVAIR',
            tileClass: 'tile-marvair',
            // Collapse selections that differ only in ELECTRIC HEAT (KW)
            // into a single row with a kW dropdown. The dropdown swaps
            // the dependent columns (MCA, MOCP) to the chosen variant's
            // values; Select / Submittal / Docs and the project-view
            // schedule all act on whichever variant is currently selected.
            kwVariants: {
                variantColumn: 'K',
                dependentColumns: ['M', 'N'],
                filterName: 'ELECTRIC HEAT',
                defaultValue: 0
            }
        },
        {
            productKey: 'vfds',
            displayName: 'ABB VFDs',
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
            // For VFDs, column L is the "Notes" column (per-item note
            // numbers) - useful in the final schedule but noisy while
            // browsing.
            hiddenSelectionColumns: ['L'],
            // Don't render the free-text "Accessories" column anywhere
            // (browse page, project schedule creator, Excel/PDF export).
            // VFDs convey per-item annotations via the Notes column.
            hideAccessoriesColumn: true,
            // Render a manual-input "Serves" column immediately to the
            // right of the primary Tag column in the project schedule
            // creator (and in Excel/PDF export).
            hasServesColumn: true,
            // Auto Tag prefix default for this product.
            autoTagPrefix: 'VFD-',
            // The first filter is HP, not tons, in cart labels.
            cartSizeLabel: '{} HP'
        },
        {
            productKey: 'diffusers',
            displayName: 'Price Diffusers',
            jsonFile: 'DATA/JSON/diffusers.json',
            pictureFile: 'DATA/PICTURES/DIFFUSERS.jpg',
            assetsFolder: 'ASSETS/DIFFUSERS',
            tileClass: 'tile-diffusers',
            autoTagPrefix: 'D-',
            // The diffuser schedule holds 9 model families in one sheet,
            // so most columns only apply to some models. Hide any data
            // column that is empty for every row currently in view
            // (browse page respects the active filters; the project
            // schedule + exports respect the items in the project).
            hideEmptyColumns: true,
            // Model picker gallery rendered above the filters/schedule
            // on the browse page. `model` must match the MODEL column
            // value in the Excel data exactly - clicking a card filters
            // the schedule to that model (via the DESCRIPTION filter).
            // `desc` is the short description shown under the model name.
            modelGallery: [
                { model: 'SPD',          desc: 'Square Plaque Diffuser',          picture: 'DATA/PICTURES/Price SPD (Black).jpg' },
                { model: 'SCD',          desc: 'Square Cone Diffuser',            picture: 'DATA/PICTURES/Price SCD (Black).jpg' },
                { model: 'SPD (Return)', desc: 'Square Plaque Return',            picture: 'DATA/PICTURES/Price SPD (Black).jpg' },
                { model: 'SCDA',         desc: 'Adjustable Square Cone Diffuser', picture: 'DATA/PICTURES/Price SCDA (Black).jpg' },
                { model: 'SMD/AMD',      desc: 'Modular Louvered Face Diffuser',  picture: 'DATA/PICTURES/Price SMD (Black).jpg' },
                { model: 'SMD w/ SR',    desc: 'Modular Diffuser, Square to Round', picture: 'DATA/PICTURES/Price SMD (Black).jpg' },
                { model: 'PDDR',         desc: 'Perforated Return Diffuser',      picture: 'DATA/PICTURES/Price PDDR (Black).jpg' },
                { model: 'SDR',          desc: 'Linear Slot Return',              picture: 'DATA/PICTURES/Price SDR (Black).jpg' }
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
            displayName: 'Price Grilles',
            jsonFile: 'DATA/JSON/grilles.json',
            pictureFile: 'DATA/PICTURES/GRILLES.jpg',
            assetsFolder: 'ASSETS/GRILLES',
            tileClass: 'tile-grilles',
            autoTagPrefix: 'G-',
            // 21 model groups from 7 catalogs share one sheet, so most
            // columns only apply to some families (supply deflection
            // columns, return neg. static pressure, linear-bar per-foot
            // columns). Hide any data column empty for every row in view.
            hideEmptyColumns: true,
            // 22k+ selections - never render them all at once. The status
            // line still shows the true match count; a notice asks the
            // user to narrow filters past this many rows.
            maxBrowseRows: 500,
            // Family picker gallery (same mechanics as the diffusers,
            // rendered by JS/grilles.js). `model` must match a MODEL
            // column value; clicking a card filters via DESCRIPTION, so
            // one representative model per family is enough. `label` is
            // the card caption (family name instead of the long grouped
            // model string); `desc` is the short description under it.
            modelGallery: [
                { model: '510/520/610/620/710/720', label: '500/600/700',     desc: 'Louvered Supply Grille',       picture: 'DATA/PICTURES/Price 500-600-700 (Black).jpg' },
                { model: '910/920',                 label: '900 GYM',         desc: 'Heavy Duty Gym Supply Grille', picture: 'DATA/PICTURES/Price 900 (Black).jpg' },
                // One card for both linear bar models: LBMH's DESCRIPTION
                // filter value is "LINEAR BAR GRILLE" too, and the CORE
                // TYPE filter picks pressed core vs heavy duty.
                { model: 'LBP/LBPH',                label: 'LINEAR BAR',      desc: 'Pressed Core or Heavy Duty',   picture: 'DATA/PICTURES/Price LBP (Black).jpg' },
                { model: '510Z/610Z/710Z',          label: '500/600/700 RTN', desc: 'Louvered Return Grille',       picture: 'DATA/PICTURES/Price 500-600-700 Return (Black).jpg' },
                { model: '80/81/82',                label: 'EGG CRATE',       desc: 'Egg Crate Return Grille',      picture: 'DATA/PICTURES/Price Egg Crate (Black).jpg' },
                { model: '10/10FF',                 label: 'PERFORATED',      desc: 'Perforated Return Grille',     picture: 'DATA/PICTURES/Price Perforated Return (Black).jpg' },
                { model: '90/90FH',                 label: '90 GYM RTN',      desc: 'Heavy Duty Gym Return Grille', picture: 'DATA/PICTURES/Price Return Gym (Black).jpg' },
                { model: 'STG',                     label: 'TRANSFER',        desc: 'Door & Wall Transfer Grille',  picture: 'DATA/PICTURES/Price Transfer (Black).jpg' }
            ]
        },
        {
            // Price VAV terminals (added 2026-10-27), for now just the SDV
            // single duct box (PRICE SDV DATA.xlsx). The display name is
            // also the product's row name on the Users Permissions tab.
            productKey: 'vav',
            displayName: 'Price VAV',
            jsonFile: 'DATA/JSON/vav.json',
            pictureFile: 'DATA/PICTURES/Price SDV (Black).jpg',
            assetsFolder: 'ASSETS/PRICE SDV',
            tileClass: 'tile-vav',
            autoTagPrefix: 'VAV-',
            // SIZE is the inlet size (4-16, 24x16), not tons, in cart labels.
            cartSizeLabel: 'SIZE {}'
        },
        {
            // Price RAC return air canopies (added 2026-09-30). The
            // display name is also the product's row name on the Users
            // Permissions tab.
            productKey: 'rac',
            displayName: 'Price RAC (Return Air Canopy)',
            jsonFile: 'DATA/JSON/rac.json',
            pictureFile: 'DATA/PICTURES/Price RAC Photo.jpg',
            assetsFolder: 'ASSETS/Price RAC (Return Air Canopy)',
            tileClass: 'tile-rac',
            // Notes work like the VFDs: every row's Notes/Accessories
            // column (S) cites the fixed SCHEDULE NOTES list ("All"), so
            // the list can't be edited, the free-text Accessories column
            // is not added, and S is hidden while browsing.
            scheduleNotesReadOnly: true,
            hiddenSelectionColumns: ['S'],
            hideAccessoriesColumn: true,
            autoTagPrefix: 'RAC-'
        },
        {
            productKey: 'gps',
            displayName: 'GPS Bipolar Ionization',
            // Short label used in export filenames (productTabLabel).
            name: 'GPS Bipolar Ionization',
            jsonFile: 'DATA/JSON/gps.json',
            pictureFile: 'DATA/PICTURES/GPS/GPS.webp',
            assetsFolder: 'ASSETS/GPS',
            tileClass: 'tile-gps',
            autoTagPrefix: 'AI-',
            // Pre-fill each selected item's Accessories box with "All".
            defaultAccessories: 'All',
            // The GPS JSON holds SEVEN independent sub-schedules (see
            // subSchedules in gps.json); JS/gps.js renders the photo
            // gallery + per-sub-schedule pages, and export.js /
            // project_view.js stack one section per sub-schedule.
            // ZONE TAG (col A) is blank in the data - hideEmptyColumns
            // drops it (the project view's own Tag column takes over),
            // along with any column empty for the models in view.
            hideEmptyColumns: true,
            // Notes are the authoritative pre-numbered lists under each
            // schedule in the Excel; data rows cite the numbers, so no
            // editing/renumbering is allowed anywhere.
            scheduleNotesReadOnly: true,
            // Mixed per-schedule columns make tolerance targets
            // meaningless here - keep GPS out of Design Search.
            excludeFromDesignSearch: true,
            // Where the sub-schedule gallery photos live: each card's
            // image is '<folder>/GPS - <photoKey>.webp'.
            photoFolder: 'DATA/PICTURES/GPS',
            // Gallery card captions default to the sub-schedule's
            // LOCATION filter value; override per schedule TITLE (must
            // match the Excel title row exactly) when two schedules
            // share a filter value and need distinct captions.
            subScheduleLabels: {
                'AIR IONIZATION DEVICE SCHEDULE - FAN COIL MOUNTED':
                    'FAN COIL MOUNTED (BAS COMPATIBLE)'
            }
        },
        {
            // Islandaire PTACs and VTACs (added 2026-11-16) on one schedule
            // (ISLANDAIRE DATA.xlsx). The display name is also the
            // product's row name on the Users Permissions tab. The tile
            // photo combines EZ44 Photo.jpg (PTAC) and EZVV Photo.jpg (VTAC).
            productKey: 'islandaire',
            displayName: 'Islandaire PTAC/VTAC',
            jsonFile: 'DATA/JSON/islandaire.json',
            pictureFile: 'DATA/PICTURES/Islandaire (Black).jpg',
            assetsFolder: 'ASSETS/ISLANDAIRE',
            tileClass: 'tile-islandaire',
            autoTagPrefix: 'PTAC-',
            // Auto Tag numbers each TYPE on its own: PTAC-1, PTAC-2 ... and
            // VTAC-1, VTAC-2 ... (one Prefix / Start at pair per type).
            autoTagByFilter: 'TYPE',
            // One row per unit and voltage with a dropdown in the AUX.
            // ELECTRIC HEAT kW cell (S): "-" (none), 2.5, 3.4, 5 and the
            // DUAL STAGE options. It swaps the heat amps / watts / BTU/H
            // (T U V); the Electric Heat filter is hidden, like Marvair.
            kwVariants: {
                variantColumn: 'S',
                dependentColumns: ['T', 'U', 'V'],
                filterName: 'ELECTRIC HEAT',
                defaultValue: '-'
            },
            // The NOTES column (AE) cites the SCHEDULE NOTES list by
            // number ("1 - 13" VTAC, "14 - 29" PTAC), so the list is fixed
            // and the free-text Accessories column is not added.
            scheduleNotesReadOnly: true,
            hideAccessoriesColumn: true,
            // Cart labels lead with the nominal cooling, e.g. "9600 BTU/H / EZ09".
            cartSizeFilter: 'NOMINAL BTUH COOLING',
            cartSizeLabel: '{} BTU/H'
        },
        {
            // Santa-Fe dehumidifiers (added 2026-11-17), SANTA FE DATA.xlsx.
            // The display name is also the product's row name on the Users
            // Permissions tab. The tile photo is the Santa-Fe logo.
            productKey: 'santa_fe',
            displayName: 'Santa-Fe Dehumidifiers',
            jsonFile: 'DATA/JSON/santa_fe.json',
            pictureFile: 'DATA/PICTURES/Santa Fe - Logo.webp',
            assetsFolder: 'ASSETS/SANTA FE',
            tileClass: 'tile-santa-fe',
            autoTagPrefix: 'DH-',
            excludeFromDesignSearch: true,
            // CFM / VENTILATION CFM list one value per static pressure on
            // its own line, as in the workbook.
            multiLineCells: true,
            // The NOTES column (U) cites the SCHEDULE NOTES list by number,
            // so the list is fixed and the free-text Accessories column is
            // not added (like Islandaire).
            scheduleNotesReadOnly: true,
            hideAccessoriesColumn: true,
            // Cart labels lead with the water removal, e.g.
            // "8.75 GAL/DAY / 4044110 (COMPACT 70)". Must match the filter
            // header in SANTA FE DATA.xlsx exactly (AB2 since 2026-11-24).
            cartSizeFilter: 'WATER REMOVAL @ 80°F and 60%RH (GALLONS PER DAY)',
            cartSizeLabel: '{} GAL/DAY',
            // MODEL (column W) holds each unit's photo name; the photo cards
            // (JS/santa_fe.js) are its only control. `value` must match a
            // MODEL filter value exactly.
            galleryOnlyFilters: ['MODEL'],
            modelGallery: [
                { value: 'Santa Fe Compact70',      label: 'Compact70',      desc: 'Crawl Space / Basement', picture: 'DATA/PICTURES/Santa Fe Compact70.webp' },
                { value: 'Santa Fe Oasis105',       label: 'Oasis105',       desc: 'Crawl Space / Attic',    picture: 'DATA/PICTURES/Santa Fe Oasis105.webp' },
                { value: 'Santa Fe Advance Dry110', label: 'Advance Dry110', desc: 'Crawl Space / Basement', picture: 'DATA/PICTURES/Santa Fe Advance Dry110.webp' },
                { value: 'Santa Fe Classic',        label: 'Classic',        desc: 'Basement (Vertical)',    picture: 'DATA/PICTURES/Santa Fe Classic.webp' },
                { value: 'Santa Fe Ultra MD33',     label: 'Ultra MD33',     desc: 'In-Wall',                picture: 'DATA/PICTURES/Santa Fe Ultra MD33.webp' },
                { value: 'Santa Fe Ultra70',        label: 'Ultra70',        desc: 'Ventilating, Ducted',    picture: 'DATA/PICTURES/Santa Fe Ultra70.webp' },
                // The V100 shares the V125 / V155 cabinet and photo.
                { value: 'Santa Fe Ultra V100',     label: 'Ultra V100',     desc: 'Ventilating, Ducted',    picture: 'DATA/PICTURES/Santa Fe Ultra V125.webp' },
                { value: 'Santa Fe Ultra V125',     label: 'Ultra V125',     desc: 'Ventilating, Ducted',    picture: 'DATA/PICTURES/Santa Fe Ultra V125.webp' },
                { value: 'Santa Fe Ultra V155',     label: 'Ultra V155',     desc: 'Ventilating, Ducted',    picture: 'DATA/PICTURES/Santa Fe Ultra V155.webp' },
                { value: 'Santa Fe Ultra V205',     label: 'Ultra V205',     desc: 'Ventilating, Ducted',    picture: 'DATA/PICTURES/Santa Fe Ultra V205.webp' }
            ]
        }
    ];

    // In-memory cache for loaded product JSON (filled lazily by loadProduct)
    var productDataCache = {};

    // Rebuild the normal selections from a "compactSelections" block (the
    // multi splits, see convert_mini_multi_split_file in convert_to_json.py)
    // and append them to data.selections. Each system is [id, [row numbers],
    // [filter value numbers]]. Rows are shared between systems: a row's
    // scheduleData etc. are the same objects everywhere it appears, which
    // is safe because the only writers (the leaving-air / temp rise fills)
    // compute from the row itself. filterData lives on the first row, as
    // on every multi-row selection.
    function expandCompactSelections(data) {
        var c = data && data.compactSelections;
        if (!c || !Array.isArray(c.systems)) return data;
        var filterCols = data.filterColumns || [];
        var values = c.filterValues || [];
        var rows = c.rows || [];
        var empty = {};
        var out = data.selections || (data.selections = []);
        c.systems.forEach(function (sys) {
            var fd = {};
            (sys[2] || []).forEach(function (code, i) {
                if (code < 0 || !filterCols[i]) return;
                fd[filterCols[i].name] = values[i][code];
            });
            out.push({
                id: sys[0],
                rows: sys[1].map(function (ri, k) {
                    var t = rows[ri];
                    var row = {
                        scheduleData: t.scheduleData,
                        filterData: k === 0 ? fd : empty,
                        documentationData: t.documentationData || empty
                    };
                    if (t.refrigerantData) row.refrigerantData = t.refrigerantData;
                    if (t.scheduleCellSpans) row.scheduleCellSpans = t.scheduleCellSpans;
                    if (t.scheduleCellSuffix) row.scheduleCellSuffix = t.scheduleCellSuffix;
                    return row;
                })
            });
        });
        delete data.compactSelections;
        return data;
    }

    // One-time post-processing of a freshly loaded product JSON. Split
    // system schedules leave their leaving-air cells (LDB / LWB, LAT (WB))
    // blank in the Excel; the site fills them from each row's rated point
    // (see HHpro.Capacity.fillLeavingAir), and their heat pump TEMP RISE
    // the same way (fillHeatRise). A product extension can fill its own
    // calculated columns too (prepareData - the LC RTU and gas split
    // temperature rises).
    function postProcess(productKey, data) {
        if (HHpro.Capacity && typeof HHpro.Capacity.fillLeavingAir === 'function') {
            try {
                HHpro.Capacity.fillLeavingAir(productKey, data);
            } catch (e) {
                console.warn('HHpro.Data: leaving-air fill failed for ' + productKey, e);
            }
        }
        if (HHpro.Capacity && typeof HHpro.Capacity.fillHeatRise === 'function') {
            try {
                HHpro.Capacity.fillHeatRise(productKey, data);
            } catch (e) {
                console.warn('HHpro.Data: heat pump temp rise fill failed for ' + productKey, e);
            }
        }
        var ext = HHpro.ProductExtensions && HHpro.ProductExtensions[productKey];
        if (ext && typeof ext.prepareData === 'function') {
            try {
                ext.prepareData(data);
            } catch (e) {
                console.warn('HHpro.Data: prepareData failed for ' + productKey, e);
            }
        }
        return data;
    }

    // Runs every time loadProduct hands a product's JSON out (cached or
    // not), before the caller sees it. A product extension's afterLoad
    // can fix up the open cart / project against it (the split systems
    // move pre-Oct-2026 items onto their new rows).
    function afterLoad(productKey, data) {
        var ext = HHpro.ProductExtensions && HHpro.ProductExtensions[productKey];
        if (ext && typeof ext.afterLoad === 'function') {
            try {
                ext.afterLoad(data);
            } catch (e) {
                console.warn('HHpro.Data: afterLoad failed for ' + productKey, e);
            }
        }
        return data;
    }

    HHpro.Data = {
        /**
         * Products this person may see. The Permissions tab of the Users
         * spreadsheet can say No for a product at their location; those
         * are left out here, so tiles, Design Search and model lookup all
         * respect it from one place. Super Admins see everything.
         */
        getProducts: function () {
            return PRODUCTS.filter(function (p) {
                return !HHpro.State || typeof HHpro.State.isProductAllowed !== 'function' ||
                    HHpro.State.isProductAllowed(p.displayName);
            });
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
         * A product's JSON if loadProduct has already fetched it, else
         * null. For synchronous callers that can cope without the data
         * (e.g. schedule_templates.js deciding a firm layout fits).
         */
        getLoadedProduct: function (productKey) {
            return productDataCache[productKey] || null;
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
                return Promise.resolve(afterLoad(productKey, productDataCache[productKey]));
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
                    expandCompactSelections(data);
                    var cont = data.continuationFiles;
                    if (!cont || !cont.length) {
                        productDataCache[productKey] = postProcess(productKey, data);
                        return afterLoad(productKey, data);
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
                        productDataCache[productKey] = postProcess(productKey, data);
                        return afterLoad(productKey, data);
                    });
                });
        }
    };
})();