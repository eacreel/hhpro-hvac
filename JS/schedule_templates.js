/* ============================================================
   HHpro - Schedule template registry
   ------------------------------------------------------------
   Engineer-specific schedule layouts. The site can render a
   project's schedules (on-screen + Excel/CAD/PDF) in different
   engineering firms' house formats. The firm is chosen with a
   project-level dropdown (see project_view.js) and stored on the
   cart/project state (Cart.getProjectEngineer).

   Model
   -----
   A "template" describes ONE firm's layout for ONE product. It is
   consumed by HHpro.Export.buildTemplateGrid (export.js), which
   turns it into the same generic `grid` object the native
   scheduleHeader path produces - so the existing xlsx / dxf / pdf
   emitters and the on-screen renderer all work unchanged.

   getTemplate(engineerKey, productKey) returns:
     - null  -> use the native (default) layout. The 'hoffman' key
                returns null for every product, so Hoffman & Hoffman
                is exactly today's behaviour with zero risk.
     - object -> a template:
         orientation : 'rows'    units are rows (one row per unit /
                                 indoor sub-row), fields are columns.
                     : 'columns' transposed - units are columns,
                                 fields (attributes) are rows.
         title       : schedule title string.
         columns     : (rows) ordered leaf columns, each
                       { scope:'item'|'row', derive(g)->string }
                       or { editable:true, fieldKey, scope }.
         header      : (rows) header band cells positioned over the
                       leaf columns: { r, c, rowspan?, colspan?, label }
                       with r = 0-based row under the title.
         attributes  : (columns) ordered attribute rows, each
                       { label, band:'top'|'main', derive(g) } or
                       { label, band, editable:true, fieldKey }.
         notesTitle  : optional bold notes-box header.
         notes       : array of verbatim note lines (already numbered
                       where the firm numbers them).
         manufacturers : optional verbatim "acceptable manufacturers"
                       block (its own bordered box).

   `derive(g)` data-access API (built by export.js per unit/sub-row):
       g.cell(letter)      formatted native value at the current row
       g.cellAt(letter,i)  formatted native value at sub-row i
       g.item              the cart item (tag, serves, indoorTags, ...)
       g.rowIndex          current sub-row index
       g.numRows           sub-row count for this unit
       g.tf(fieldKey)      per-unit editable override (string, '' if none)

   Editable fields have no native source yet (the user will wire the
   underlying data later). They render an in-place input on screen and
   a "-" placeholder in exports until filled. The typed value is stored
   on the item as item.templateFields[fieldKey].
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};

    // ---- value transforms ------------------------------------------
    function s(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

    // "DAIKIN" + "FTKF09BVJU9" -> "DAIKIN FTKF09BVJU9"
    function combine(make, model) {
        return [s(make), s(model)].filter(Boolean).join(' ');
    }

    // Like combine() but stacks make over model on TWO lines (engineer
    // sheets show the manufacturer on the first row and the model number on
    // a second row within the same MANUF. MODEL cell). The "\n" is honoured
    // by every renderer (screen <br>, xlsx wrapText, DXF \P, PDF stacked).
    function combine2(make, model) {
        var a = s(make), b = s(model);
        if (a && b) return a + '\n' + b;
        return a || b;
    }

    // "208/60/1" -> "208/1" (drop the middle 60 Hz token). Leaves
    // already-2-part or non-slash values untouched.
    function voltPh(v) {
        var parts = s(v).split('/');
        if (parts.length >= 3) {
            return parts[0].trim() + '/' + parts[parts.length - 1].trim();
        }
        return s(v);
    }

    // MCA + MOP -> "11.6/15"
    function slash(a, b) {
        var aa = s(a), bb = s(b);
        if (!aa && !bb) return '';
        return aa + '/' + bb;
    }

    // "21.0 / 12.5 / -" -> "21" (first token, trailing .0 stripped)
    function firstNumber(v) {
        var first = s(v).split('/')[0].trim();
        return first.replace(/\.0+$/, '');
    }

    function isPositiveNum(v) {
        var n = Number(v);
        return isFinite(n) && n > 0;
    }

    // BTU/h -> MBH number string, e.g. 35418 -> "35.418"
    function div1000(v) {
        var n = Number(v);
        if (!isFinite(n)) return s(v);
        return String(n / 1000);
    }

    // BTU/h -> "X MBH" (used by Barrett Woodyard heating-capacity cells)
    function mbh(v) {
        var n = Number(v);
        if (!isFinite(n)) return s(v);
        return (n / 1000) + ' MBH';
    }

    // "CAPTA3026B3 / DR80TN0803BN" -> idx 0 = coil, idx 1 = furnace.
    // The gas-split native MODEL column stores both, slash-separated.
    function modelPart(v, idx) {
        var parts = s(v).split('/');
        return parts[idx] !== undefined ? parts[idx].trim() : s(v);
    }

    // =================================================================
    // Refresco templates
    // =================================================================

    function refrescoMiniSplit() {
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM UNIT',
            header: [
                // Tier A - super groups
                { r: 0, c: 0, colspan: 13, label: 'AIR HANDLING UNIT' },
                { r: 0, c: 13, colspan: 3, label: 'OUTDOOR CONDENSING UNIT' },
                { r: 0, c: 16, colspan: 2, label: 'SINGLE POINT POWER (TO OUTDOOR UNIT*)' },
                // Tier B / C
                { r: 1, c: 0, rowspan: 2, label: 'UNIT NO.' },
                { r: 1, c: 1, rowspan: 2, label: 'MANUFACTURER & MODEL #' },
                { r: 1, c: 2, rowspan: 2, label: 'SERVES' },
                { r: 1, c: 3, colspan: 2, label: 'SUPPLY - FAN DATA' },
                { r: 2, c: 3, label: 'TOTAL CFM' },
                { r: 2, c: 4, label: 'MIN O.A CFM' },
                { r: 1, c: 5, colspan: 3, label: 'COOLING CAPACITY' },
                { r: 2, c: 5, label: 'TOTAL (btuh)' },
                { r: 2, c: 6, label: 'E. DB (F)' },
                { r: 2, c: 7, label: 'E. WB (F)' },
                { r: 1, c: 8, colspan: 2, label: 'HEATING CAPACITY' },
                { r: 2, c: 8, label: 'TOTAL (btuh)' },
                { r: 2, c: 9, label: 'AMBIENT (F)' },
                { r: 1, c: 10, label: 'EFFICIENCY' },
                { r: 2, c: 10, label: 'SEER' },
                { r: 1, c: 11, colspan: 2, label: 'INDOOR UNIT ELECTRICAL DATA*' },
                { r: 2, c: 11, label: 'VOLT/PH' },
                { r: 2, c: 12, label: 'MCA/MOCP' },
                { r: 1, c: 13, colspan: 3, label: 'GENERAL DATA' },
                { r: 2, c: 13, label: 'UNIT NO.' },
                { r: 2, c: 14, label: 'MANUFACTURER & MODEL' },
                { r: 2, c: 15, label: 'WEIGHT (LBS)' },
                { r: 1, c: 16, colspan: 2, label: 'ELECTRICAL DATA' },
                { r: 2, c: 16, label: 'VOLT/PH' },
                { r: 2, c: 17, label: 'MCA/MOP' }
            ],
            columns: [
                { scope: 'row', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[g.rowIndex]); } },
                { scope: 'row', derive: function (g) { return combine(g.cell('M'), g.cell('N')); } },
                { scope: 'item', editable: true, fieldKey: 'refresco_ms_serves' },
                { scope: 'row', derive: function (g) { return g.cell('A'); } },
                { scope: 'row', editable: true, fieldKey: 'refresco_ms_min_oa_cfm' },
                { scope: 'row', derive: function (g) { return g.cell('D'); } },
                { scope: 'row', derive: function (g) { return g.cell('B'); } },
                { scope: 'row', derive: function (g) { return g.cell('C'); } },
                { scope: 'row', derive: function (g) { return g.cell('G'); } },
                { scope: 'row', derive: function (g) { return g.cell('P'); } },
                { scope: 'item', derive: function (g) { return firstNumber(g.cell('R')); } },
                // Indoor units fed from the outdoor single-point feed have
                // no independent service, so BOTH the indoor VOLT/PH and
                // MCA/MOCP read "-" (the real feed lives in the SINGLE POINT
                // POWER column, cols 16/17). Column J flags the indoor power
                // source; if a unit were ever independently powered it would
                // fall back to showing its own voltage.
                { scope: 'item', derive: function (g) {
                    return /powered from outdoor/i.test(g.cell('J'))
                        ? '-' : voltPh(g.cell('S'));
                } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return combine(g.cell('V'), g.cell('W')); } },
                { scope: 'item', derive: function (g) { return g.cell('Q'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('S')); } },
                { scope: 'item', derive: function (g) { return slash(g.cell('T'), g.cell('U')); } }
            ],
            notesTitle: '',
            // One bordered note box, text on multiple rows (matches the
            // wrapped merged note cell in the Refresco Excel template).
            notes: [
                '* POWER IS SINGLE POINT CONNECTION TO BE MADE TO OUTDOOR CONDENSING UNIT.',
                'POWER FROM CONDENSING UNIT SHALL BE PROVIDED TO INDOOR UNIT.',
                "FOLLOW MANUFACTURER'S INSTALLATION INSTRUCTIONS.",
                'PROVIDE DISCONNECT AT INDOOR AND OUTDOOR LOCATION.',
                'UNIT SHALL BE SUPPLIED WITH ALL PROVISIONS NECESSARY FOR LOW AMBIENT COOLING.',
                'PROVIDE INTEGRAL CONDENSATE PUMP.'
            ],
            manufacturers: null
        };
    }

    function refrescoRtu() {
        return {
            orientation: 'columns',
            title: 'ROOFTOP PACKAGED AIR HANDLING UNITS',
            attributes: [
                { band: 'top', label: 'TAG:', derive: function (g) { return s(g.item.tag); } },
                { band: 'top', label: 'MANUFACTURER:', derive: function (g) { return g.cell('A'); } },
                { band: 'top', label: 'UNIT MODEL NUMBER:', derive: function (g) { return g.cell('B'); } },
                { band: 'top', label: 'WEIGHT:', derive: function (g) { return g.cell('Y'); } },

                { band: 'main', label: 'NOTES', editable: true, fieldKey: 'refresco_rtu_notes' },
                { band: 'main', label: 'SUPPLY  CFM', derive: function (g) { return g.cell('D'); } },
                { band: 'main', label: 'SUPPLY FAN HP', derive: function (g) { return g.cell('V'); } },
                { band: 'main', label: 'EXTERNAL  STATIC  PRESSURE  (IN.  OF WATER)', derive: function (g) { return g.cell('E'); } },
                { band: 'main', label: 'NOMINAL  CAPACITY  (TONS)', derive: function (g) { return g.cell('C'); } },
                { band: 'main', label: 'GROSS  TOT COOLING  CAP.  (BTU/h)', derive: function (g) { return g.cell('G'); } },
                { band: 'main', label: 'EFFICIENCY', derive: function (g) { return g.cell('I'); } },
                { band: 'main', label: 'COOLING STAGES', derive: function (g) { return g.cell('T'); } },
                { band: 'main', label: 'INPUT HEATING  CAP.  (MBH)  -  NAT.  GAS', derive: function (g) { return g.cell('N'); } },
                { band: 'main', label: 'OUTPUT HEATING  CAP.  (MBH)', derive: function (g) { return g.cell('O'); } },
                { band: 'main', label: 'HEATING  STAGES', derive: function (g) { return g.cell('P'); } },
                { band: 'main', label: 'VOLTAGE/PHASE', derive: function (g) { return g.cell('U'); } },
                { band: 'main', label: 'SINGLE  POINT ELEC.  CONN.   MCA(A)/MOP(A)', derive: function (g) { return slash(g.cell('W'), g.cell('X')); } },
                { band: 'main', label: 'SEISMIC IMPORTANCE  FACTOR  (IP)', editable: true, fieldKey: 'refresco_rtu_seismic' }
            ],
            notesTitle: 'NOTES:',
            notes: [
                '1. PROVIDE FACTORY ROOF CURB.',
                '2. R-32 REFRIGERANT',
                '3. PROVIDE TWO POSITION OUTSIDE AIR DAMPER, POWERED CLOSED WHEN UNIT IS OFF',
                '4. PROVIDE 2" PLEATED FILTERS',
                '5. PROVIDE PROGRAMMABLE THERMOSTAT',
                '6. PROVIDE A WATER LEVEL DETECTION DEVICE CONFORMING TO UL508 TO SHUT OFF',
                '     THE EQUIPMENT IN THE EVENT THAT THE PRIMARY DRAIN IS BLOCKED',
                '7. PROVIDE DRY BULB ECONOMIZER, POWERED CLOSED WHEN UNIT IS OFF.',
                '8. PROVIDE HOT GAS REHEAT DEHUMIDIFICATION'
            ],
            manufacturers:
                'ACCEPTABLE MANUFACTURERS:\n' +
                '1.  TRANE          4.  DAIKIN\n' +
                '2.  CARRIER        5.  TEMPMASTER'
        };
    }

    // =================================================================
    // Barrett Woodyard & Associates templates
    // Circled note refs (① = (1) ... ) render as circles on screen /
    // Excel / print-PDF; the DXF + full-PDF emitters transliterate them
    // to "(1)" etc. (see export.js). Fields HHpro has no live source for
    // are constant defaults here - engineers tweak per-unit via the
    // "Edit Schedule" button rather than inline inputs.
    // =================================================================

    function barrettWoodyardMultiSplit() {
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM SCHEDULE',
            header: [
                { r: 0, c: 3, colspan: 9, label: 'FAN COIL UNIT DATA' },
                { r: 0, c: 12, colspan: 4, label: 'HEATING SECTION' },
                { r: 0, c: 16, colspan: 4, label: 'CONDENSING UNIT DATA' },
                { r: 0, c: 0, rowspan: 3, label: 'I.D. TAG' },
                { r: 0, c: 1, rowspan: 3, label: 'MINIMUM TOTAL CAP. (BTUH)' },
                { r: 0, c: 2, rowspan: 3, label: 'MINIMUM SENSIBLE CAP. (BTUH)' },
                { r: 0, c: 20, rowspan: 3, label: 'BASIS OF DESIGN' },
                { r: 0, c: 21, rowspan: 3, label: 'REMARKS' },
                { r: 1, c: 3, rowspan: 2, label: 'AIRFLOW (CFM)' },
                { r: 1, c: 4, rowspan: 2, label: 'OUTSIDE AIR (CFM)' },
                { r: 1, c: 5, rowspan: 2, label: 'EXT. S.P. (IN. W.C.) ①' },
                { r: 1, c: 6, rowspan: 2, label: 'MAX H.P.' },
                { r: 1, c: 7, colspan: 2, label: 'COIL EAT' },
                { r: 2, c: 7, label: '°F db' },
                { r: 2, c: 8, label: '°F wb' },
                { r: 1, c: 9, rowspan: 2, label: 'VOLTS/ PHASE' },
                { r: 1, c: 10, rowspan: 2, label: 'DRIVE ②' },
                { r: 1, c: 11, rowspan: 2, label: 'TYPE OF UNIT' },
                { r: 1, c: 12, colspan: 2, label: 'PRIMARY HEATING' },
                { r: 2, c: 12, label: 'TYPE' },
                { r: 2, c: 13, label: 'CAPACITY③' },
                { r: 1, c: 14, colspan: 2, label: 'SECONDARY HEATING' },
                { r: 2, c: 14, label: 'TYPE' },
                { r: 2, c: 15, label: 'CAPACITY③' },
                { r: 1, c: 16, rowspan: 2, label: 'AMBIENT TEMP. (F)' },
                { r: 1, c: 17, rowspan: 2, label: 'VOLTS/ PHASE' },
                { r: 1, c: 18, rowspan: 2, label: 'STAGES' },
                { r: 1, c: 19, rowspan: 2, label: 'EFFICIENCY' }
            ],
            columns: [
                { scope: 'item', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[0]) + '/' + s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('I'); } },
                { scope: 'item', derive: function (g) { return g.cell('J'); } },
                { scope: 'item', capacityField: 'airflow', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', editable: true, fieldKey: 'bw_ms_oa_cfm' },
                { scope: 'item', derive: function () { return '0.5'; } },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', capacityField: 'eatDb', derive: function (g) { return g.cell('F'); } },
                { scope: 'item', capacityField: 'eatWb', derive: function (g) { return g.cell('G'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('N')); } },
                { scope: 'item', derive: function () { return 'D'; } },
                { scope: 'item', derive: function () { return 'MULTI-POSITION AHU'; } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('U')) ? 'HP' : '-'; } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('U')) ? mbh(g.cell('U')) : '-'; } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('L')) ? 'ELEC' : '-'; } },
                { scope: 'item', kwSelect: true, derive: function (g) { return isPositiveNum(g.cell('L')) ? g.cell('L') : '-'; } },
                { scope: 'item', derive: function () { return '95'; } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('W')); } },
                { scope: 'item', derive: function () { return '1'; } },
                { scope: 'item', derive: function (g) { return g.cell('AB'); } },
                { scope: 'item', derive: function (g) { return combine(g.cell('R'), g.cell('S')) + '/' + s(g.cell('B')); } },
                { scope: 'item', derive: function () { return '① ② ③ ④ ⑤ ⑥ ⑦'; } }
            ],
            notesTitle: '',
            notes: [
                '① THIS IS THE SP EXTERNAL TO THE ENTIRE FAN COIL UNIT ASSEMBLY (WET COIL, CASING, CLEAN FILTERS, AND FURNACE LOSSES ARE NOT INCLUDED IN THIS EXT. SP.)',
                '② B = BELT DRIVE, D = DIRECT',
                '③ HP STANDS FOR HEAT PUMP AND CAPACITY IS GIVEN IN MBH, ELEC STANDS FOR ELECTRIC HEAT AND VALUES ARE GIVEN IN kW.',
                '④ PROVIDE WITH REMOTE WALL MOUNTED THERMOSTAT LOCATED AS SHOWN ON PLANS.',
                '⑤ PROVIDE AIR HANDLER WITH VARIABLE SPEED ECM FAN.',
                '⑥ CONDENSATE IS TO BE CONNECTED INTO EXISTING CONDENSATE DRAIN FROM EXISTING UNITS BEING REPLACED.',
                '⑦ BLOWER COIL UNIT SHALL BE ENCOMPASSED BY A DRAIN PAN AND ALSO CONSIST OF A FLOAT SWITCH LOCATED IN DRAIN PAN TO DISABLE UNIT UNDER WATER DETECTION.'
            ],
            manufacturers: null
        };
    }

    function barrettWoodyardRtu() {
        return {
            orientation: 'rows',
            title: 'PACKAGED ROOF TOP UNITS',
            header: [
                { r: 0, c: 0, rowspan: 2, label: 'I.D. TAG' },
                { r: 0, c: 1, rowspan: 2, label: 'MINIMUM TOTAL CAP. (MBH)' },
                { r: 0, c: 2, rowspan: 2, label: 'MINIMUM SENSIBLE CAP. (MBH)' },
                { r: 0, c: 3, rowspan: 2, label: 'AMBIENT TEMP (°F)' },
                { r: 0, c: 4, colspan: 2, label: 'COIL EAT' },
                { r: 1, c: 4, label: '°F db' },
                { r: 1, c: 5, label: '°F wb' },
                { r: 0, c: 6, rowspan: 2, label: 'AIRFLOW (CFM)' },
                { r: 0, c: 7, rowspan: 2, label: 'EXT. S.P. (IN. W.C.)' },
                { r: 0, c: 8, rowspan: 2, label: 'MAX H.P.' },
                { r: 0, c: 9, rowspan: 2, label: 'OUTSIDE AIR (CFM)' },
                { r: 0, c: 10, colspan: 3, label: 'HEATING' },
                { r: 1, c: 10, label: 'TYPE' },
                { r: 1, c: 11, label: 'INPUT' },
                { r: 1, c: 12, label: 'OUTPUT' },
                { r: 0, c: 13, rowspan: 2, label: 'VOLTS/ PHASE' },
                { r: 0, c: 14, rowspan: 2, label: 'MCA' },
                { r: 0, c: 15, rowspan: 2, label: 'MOCP' },
                { r: 0, c: 16, rowspan: 2, label: 'BASIS OF DESIGN' },
                { r: 0, c: 17, rowspan: 2, label: 'EFFICIENCY (AT AHRI)' },
                { r: 0, c: 18, rowspan: 2, label: 'APPROX. UNIT WEIGHT (LBS)' },
                { r: 0, c: 19, rowspan: 2, label: 'REMARKS' }
            ],
            columns: [
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('G')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('H')); } },
                { scope: 'item', derive: function () { return '95'; } },
                { scope: 'item', derive: function (g) { return g.cell('J'); } },
                { scope: 'item', derive: function (g) { return g.cell('K'); } },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', derive: function (g) { return g.cell('E'); } },
                { scope: 'item', derive: function (g) { return g.cell('V'); } },
                { scope: 'item', editable: true, fieldKey: 'bw_rtu_oa_cfm' },
                { scope: 'item', derive: function () { return 'GAS'; } },
                { scope: 'item', derive: function (g) { return g.cell('N'); } },
                { scope: 'item', derive: function (g) { return g.cell('O'); } },
                { scope: 'item', derive: function (g) { return g.cell('U'); } },
                { scope: 'item', derive: function (g) { return g.cell('W'); } },
                { scope: 'item', derive: function (g) { return g.cell('X'); } },
                { scope: 'item', derive: function (g) { return combine(g.cell('A'), g.cell('B')); } },
                { scope: 'item', derive: function (g) { return g.cell('I'); } },
                { scope: 'item', derive: function (g) { return g.cell('Y'); } },
                { scope: 'item', derive: function () { return '① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨'; } }
            ],
            notesTitle: '',
            notes: [
                '① THIS IS THE STATIC PRESSURE EXTERNAL TO THE UNIT. IT DOES NOT INCLUDE COIL, CASING, FILTER, OR HEATER LOSSES',
                '② PROVIDE UNIT COMPLETE FACTORY DISCONNECT W/ LOCKOUT PROTECTION CAPABILITY.',
                '③ CAPACITY IN MBH.',
                '④ SUPPLY FAN SHALL BE CAPABLE OF SUPPLYING AIRFLOW AT CFM & E.S.P. (IN. W.C.) AS INDICATED ON SCHEDULED ABOVE',
                '⑤ PROVIDE SMOKE DETECTOR IN UNIT SUPPLY AND RETURN. INSTALLATION SHALL BE IN ACCORDANCE WITH NFPA 72E. COORD. W/ DIVISION 16.',
                '⑥ POWERED WEATHERPROOF GFI DEDICATED CONVENIENCE OUTLET TO BE PROVIDED, COORDINATE WITH ELECTRICAL.',
                '⑦ PROVIDE UNIT WITH COMPARATIVE ENTHALPY ECONOMIZER',
                '⑧ PROVIDE WITH HAIL GUARD',
                '⑨ PROVIDE WITH 2 MULTI-STAGE COMPRESSORS.'
            ],
            manufacturers: null
        };
    }

    // =================================================================
    // Allied templates (password Allied1)
    // Mapped from DATA/ENGINEER SCHEDULES/ALLIED.xlsx. Note refs are the
    // firm's own plain comma lists ("1,2,3..."), not circled digits.
    // Nominal tonnage has no scheduleData letter - it comes from the
    // SIZE filter value via g.filter('SIZE'). Fields with no data
    // source (LOCATION, OA CFM) are inline-editable; ESP is the firm's
    // constant 0.5 default, tweakable via Edit Schedule.
    // =================================================================

    function alliedMultiSplit() {
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM SCHEDULE',
            header: [
                { r: 0, c: 0, label: 'TAG' },
                { r: 0, c: 1, label: 'DAIKIN AIR HANDLER MODEL NO.' },
                { r: 0, c: 2, label: 'NOMINAL TONS' },
                { r: 0, c: 3, label: 'LOCATION' },
                { r: 0, c: 4, label: 'TOTAL CFM' },
                { r: 0, c: 5, label: 'OA CFM' },
                { r: 0, c: 6, label: 'MAX FAN HP' },
                { r: 0, c: 7, label: 'ESP' },
                { r: 0, c: 8, label: 'MBH TOT. COOL' },
                { r: 0, c: 9, label: 'MBH SENS. COOL' },
                { r: 0, c: 10, label: 'EFFICIENCY' },
                { r: 0, c: 11, label: 'HEAT PUMP HEAT' },
                { r: 0, c: 12, label: 'HEAT KW' },
                { r: 0, c: 13, label: 'VOLTS/ PHASE' },
                { r: 0, c: 14, label: 'MCA' },
                { r: 0, c: 15, label: 'MOCP' },
                { r: 0, c: 16, label: 'TAG' },
                { r: 0, c: 17, label: 'DAIKIN CONDENSING UNIT MODEL NO.' },
                { r: 0, c: 18, label: 'VOLTS/ PHASE' },
                { r: 0, c: 19, label: 'MCA' },
                { r: 0, c: 20, label: 'MOCP' },
                { r: 0, c: 21, label: 'NOTES' }
            ],
            columns: [
                { scope: 'item', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[0]); } },
                { scope: 'item', derive: function (g) { return g.cell('B'); } },
                { scope: 'item', derive: function (g) { return g.filter('SIZE'); } },
                { scope: 'item', editable: true, fieldKey: 'allied_ms_location' },
                { scope: 'item', capacityField: 'airflow', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', editable: true, fieldKey: 'allied_ms_oa_cfm' },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', derive: function () { return '0.5'; } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('I')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('J')); } },
                { scope: 'item', derive: function (g) { return g.cell('AB'); } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('K')) ? div1000(g.cell('K')) : '-'; } },
                { scope: 'item', kwSelect: true, derive: function (g) { return g.cell('L'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('N')); } },
                { scope: 'item', derive: function (g) { return g.cell('O'); } },
                { scope: 'item', derive: function (g) { return g.cell('P'); } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('S'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('W')); } },
                { scope: 'item', derive: function (g) { return g.cell('X'); } },
                { scope: 'item', derive: function (g) { return g.cell('Y'); } },
                { scope: 'item', derive: function () { return '1,2,3,4,5,6,7,8'; } }
            ],
            notesTitle: 'NOTE:',
            notes: [
                '1. COOLING CAPACITIES ARE RATED IN ACCORDANCE WITH ARI STANDARD 210/290 AT 95°F AMBIENT OUTDOOR AIR TEMP., 80°F',
                '    DRY BULB, 67°F WET BULB ENTERING AIR TEMP., AND NOMINAL AIR QUANTITY LISTED.',
                '2. REFRIG. R-32 PIPING TO BE SIZED PER TOTAL INSTALL. EQUIV. LENGTH.  LONG-LINE APP. TO BE PROVIDED WHENEVER MFG.',
                "    RECOMM. LENGTHS ARE EXCEEDED, INCL. LIQ. LINE SOLENOID VALVES, ACCUMULATOR, ETC. MAX T.E.L. IS 100'",
                '3. PROVIDE SINGLE POINT ELECTRICAL CONNECTION',
                '4. PROVIDE HONEYWELL "VISION-PRO 8000" THERMOSTAT/HUMIDISTAT',
                '5. PROVIDE NEW FILTERS IN UNIT WHEN BUILDING IS TURNED OVER TO OWNER/TENANT.',
                '6. SES HEAT PUMP DEHUMIDIFICATION CONTROL MODULE HPDM-MP AS WELL AS EQUIPMENT AND CONTROLS AS REQUIRED',
                '    FOR A COMPLETE WORKING SYSTEM',
                '7. HEAT PUMP TO BE INSTALLED LEVEL ON MANUFACTURERS PREFORMED PAD.',
                '8. PROVIDE LOW AMBIENT CONTROLS.',
                'APPROVED EQUALS: TRANE, CARRIER, & LENNOX'
            ],
            manufacturers: null
        };
    }

    function alliedGasSplit() {
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM GAS FURNACE SCHEDULE',
            header: [
                { r: 0, c: 0, rowspan: 2, label: 'UNIT TAG' },
                { r: 0, c: 1, rowspan: 2, label: 'DAIKIN FURNACE MODEL NO.' },
                { r: 0, c: 2, rowspan: 2, label: 'DAIKIN COOLING COIL MODEL NO.' },
                { r: 0, c: 3, rowspan: 2, label: 'TONNAGE' },
                { r: 0, c: 4, rowspan: 2, label: 'TOTAL CFM' },
                { r: 0, c: 5, rowspan: 2, label: 'TOTAL OA' },
                { r: 0, c: 6, rowspan: 2, label: 'SERVING' },
                { r: 0, c: 7, rowspan: 2, label: 'MAX FAN HP' },
                { r: 0, c: 8, rowspan: 2, label: 'ESP' },
                { r: 0, c: 9, rowspan: 2, label: 'MBH TOT. COOL' },
                { r: 0, c: 10, rowspan: 2, label: 'MBH INPUT' },
                { r: 0, c: 11, rowspan: 2, label: 'MBH OUTPUT' },
                { r: 0, c: 12, colspan: 3, label: 'ELECTRICAL DATA' },
                { r: 1, c: 12, label: 'VOLTS' },
                { r: 1, c: 13, label: 'MCA' },
                { r: 1, c: 14, label: 'MOCP' },
                { r: 0, c: 15, rowspan: 2, label: 'WEIGHT' },
                { r: 0, c: 16, rowspan: 2, label: 'UNIT TAG' },
                { r: 0, c: 17, rowspan: 2, label: 'DAIKIN COND UNIT MODEL NO. (CU)' },
                { r: 0, c: 18, rowspan: 2, label: 'TONNAGE' },
                { r: 0, c: 19, rowspan: 2, label: 'EFFICIENCY (SEER2 / EER2)' },
                { r: 0, c: 20, colspan: 3, label: 'ELECTRICAL DATA' },
                { r: 1, c: 20, label: 'VOLTS' },
                { r: 1, c: 21, label: 'MCA' },
                { r: 1, c: 22, label: 'MOCP' },
                { r: 0, c: 23, rowspan: 2, label: 'WEIGHT' },
                { r: 0, c: 24, rowspan: 2, label: 'ACCESSORIES' }
            ],
            columns: [
                { scope: 'item', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[0]); } },
                { scope: 'item', derive: function (g) { return modelPart(g.cell('B'), 1); } },
                { scope: 'item', derive: function (g) { return modelPart(g.cell('B'), 0); } },
                { scope: 'item', derive: function (g) { return g.filter('SIZE'); } },
                { scope: 'item', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', editable: true, fieldKey: 'allied_gs_oa_cfm' },
                { scope: 'item', derive: function (g) { return s(g.item.serves) || '-'; } },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', derive: function () { return '0.5'; } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('H')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('I')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('J')); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('M')); } },
                { scope: 'item', derive: function (g) { return g.cell('N'); } },
                { scope: 'item', derive: function (g) { return g.cell('O'); } },
                { scope: 'item', derive: function (g) { return g.cell('P'); } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('R'); } },
                { scope: 'item', derive: function (g) { return g.filter('SIZE'); } },
                { scope: 'item', derive: function (g) { return g.cell('X'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('S')); } },
                { scope: 'item', derive: function (g) { return g.cell('T'); } },
                { scope: 'item', derive: function (g) { return g.cell('U'); } },
                { scope: 'item', derive: function (g) { return g.cell('Y'); } },
                { scope: 'item', derive: function () { return '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18'; } }
            ],
            notesTitle: 'NOTES & ACCESSORIES:',
            notes: [
                '1. COOLING CAPACITIES ARE RATED IN ACCORDANCE WITH ARI STANDARD 210/290 AT 95°F AMBIENT OUTDOOR AIR TEMP., 80°F DRY BULB, 67°F WET BULB ENTERING AIR TEMP., AND NOMINAL AIR QUANTITY LISTED.',
                '2. AGA CERTIFIED UL LISTED AND LABELED.',
                '3. PROVIDE WITH LOW AMBIENT KIT.',
                '4. REFRIG. PIPING TO BE R-32, SIZED PER TOTAL INSTALLED EQUIVALENT LENGTH. LONG-LINE APPLICATION TO BE PROVIDED WHENEVER MFG. RECOMM. LENGTHS ARE EXCEEDED, INCL. LIQUID LINE SOLENOID VALVES, ACCUMULATOR, AND OTHER SPECIAL PRECAUTIONS PER MANUFACTURERS',
                "    RECOMMENDATIONS. MAX T.E.L. IS 100'",
                '5. PROVIDE SINGLE POINT ELECTRICAL CONNECTION WITH FACTORY DISCONNECT KIT FOR BOTH INDOOR AND OUTDOOR UNIT.',
                '6. PROVIDE MANUFACTURERS 7-DAY PROGRAMMABLE TOUCHSCREEN THERMOSTAT WITH AUTO-CHANGEOVER, CONTROL WIRING AND ASSOCIATED ACCESSORIES REQUIRED TO MEET SEQUENCE OF OPERATION. PROVIDE THERMOSTAT CLEAR LOCKING COVER.',
                '7. PROVIDE NEW FILTERS IN UNIT WHEN BUILDING IS TURNED OVER TO OWNER/TENANT.',
                '8. CONDENSING UNIT TO BE INSTALLED LEVEL ON EQUIPMENT ROOF RAILS WITH VIBRATION ISOLATION.',
                '9. CONDENSING UNIT TO BE INSTALLED LEVEL ON 4" UTILITY PAD',
                '10. PROVIDE CONDENSATE OVERFLOW SENSOR IN DRAIN PAN TO DE-ENERGIZE UNIT SHOULD A CLOGGED CONDENSATE DRAIN CONDITION OCCUR.',
                '11. PROVIDE A CONDENSATE OVERFLOW SENSOR IN DRAIN PAN. CONDENSATE PUMP SHALL BE WIRED TO DE-ENERGIZE UNIT SHOULD A CLOGGED CONDENSATE DRAIN CONDITION OCCUR.',
                '12. PROVIDE TRANSFORMER AS REQUIRED FOR SUPPLY FAN.',
                '13. PROVIDE DUCT SMOKE DETECTOR IN RETURN AIR DUCT.',
                '14. PROVIDE HIGH-STATIC DRIVE AND ALTERNATE MOTOR.',
                '15. PROVIDE VARIABLE SPEED SUPPLY FAN CONTROL FOR ENHANCED DEHUMIDIFICATION CAPABILITY',
                '16. PROVIDE FACTORY INSTALLED NON-BLEED TXV, EVAPORATOR DEFROST CONTROLS AND AIR TIGHT CABINET CONSTRUCTION FOR INDOOR UNIT.',
                '17. INDOOR UNIT SHALL BE PROVIDED WITH VIBRATION ISOLATION.',
                '18. WARRANTY - 10 YR HEAT EXCHANGER / 5 YR COMPRESSOR / 3 YR CONTROLLER.',
                '19. PROVIDE MIXING BOX.',
                '20. PROVIDE HAIL GUARDS - FACTORY SUPPLIED, FIELD INSTALLED FOR OUTDOOR UNIT.',
                '21. PROVIDE CORROSION PROTECTION.',
                '22. VARIABLE SPEED SCROLL COMPRESSOR.',
                '23. 2 STAGE SCROLL COMPRESSOR',
                'APPROVED EQUALS: TRANE, CARRIER, & LENNOX'
            ],
            manufacturers: null
        };
    }

    // =================================================================
    // Saber templates (password Saber1)
    // Mapped from DATA/ENGINEER SCHEDULES/SABER.xlsx, using the user's
    // matching Hoffman Cart exports as a value-by-value Rosetta Stone.
    // Both layouts are orientation 'rows'. Note refs are the firm's own
    // plain comma lists ("1, 2, 3 ..."), not circled digits, so there are
    // no DXF/PDF transliteration concerns. Fields with no native data
    // source (AHU ESP, OUTSIDE AIR, FAN RPM) are inline-editable; AREA
    // SERVED derives from the project schedule's Serves input. The MPS
    // condensing-unit TONNAGE has no scheduleData letter - it comes from
    // the SIZE filter value via g.filter('SIZE') (like Allied).
    // =================================================================

    function saberMultiSplit() {
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM HEAT PUMP UNIT SCHEDULE',
            // Keep each note on a single line (the firm's sheets are wide):
            // widen the columns so the full-width notes box never word-wraps.
            notesSingleLine: true,
            // Header labels carry the SABER.xlsx's exact line breaks ("\n");
            // every renderer honours them (screen <br>, xlsx wrapText, DXF \P,
            // PDF stacked) and the rows auto-grow to fit.
            header: [
                // Tier A - super groups over the two unit halves
                { r: 0, c: 0, colspan: 14, label: 'AIR HANDLING UNIT DATA' },
                { r: 0, c: 14, colspan: 7, label: 'CONDENSING UNIT' },
                { r: 0, c: 21, rowspan: 3, label: 'WEIGHT (LBS)\nAH/HP' },
                { r: 0, c: 22, rowspan: 3, label: 'NOTES' },
                // Tier B - sub groups
                { r: 1, c: 0, rowspan: 2, label: 'UNIT\nTAG' },
                { r: 1, c: 1, rowspan: 2, label: 'AREA\nSERVED' },
                { r: 1, c: 2, rowspan: 2, label: 'MANUF.\nMODEL' },
                { r: 1, c: 3, colspan: 4, label: 'FAN DATA' },
                { r: 1, c: 7, colspan: 2, label: 'COOLING' },
                { r: 1, c: 9, label: 'HEAT' },
                { r: 1, c: 10, label: 'AUX.' },
                { r: 1, c: 11, colspan: 3, label: 'ELECTRICAL DATA' },
                { r: 1, c: 14, colspan: 4, label: 'GENERAL DATA' },
                { r: 1, c: 18, colspan: 3, label: 'ELECTRICAL DATA' },
                // Tier C - leaf labels
                { r: 2, c: 3, label: 'FAN\nCFM' },
                { r: 2, c: 4, label: 'ESP\n(WG)' },
                { r: 2, c: 5, label: 'MOTOR\nHP' },
                { r: 2, c: 6, label: 'OA\n(CFM)' },
                { r: 2, c: 7, label: 'TOTAL\n(MBH)' },
                { r: 2, c: 8, label: 'SENS.\n(MBH)' },
                { r: 2, c: 9, label: 'TOTAL\n(MBH)' },
                { r: 2, c: 10, label: 'HEAT\n(KW)' },
                { r: 2, c: 11, label: 'VOLTAGE\n(V/PH)' },
                { r: 2, c: 12, label: 'MCA\n(A)' },
                { r: 2, c: 13, label: 'MOCP\n(A)' },
                { r: 2, c: 14, label: 'UNIT\nTAG' },
                { r: 2, c: 15, label: 'MANUF.\nMODEL' },
                { r: 2, c: 16, label: 'TONNAGE' },
                { r: 2, c: 17, label: 'EFFICIENCY' },
                { r: 2, c: 18, label: 'VOLTAGE\n(V/PH)' },
                { r: 2, c: 19, label: 'MCA\n(A)' },
                { r: 2, c: 20, label: 'MOCP\n(A)' }
            ],
            columns: [
                // --- Air handling unit --- (UNIT TAG + AREA SERVED render as
                // editable text boxes; they pre-fill from the item's tag /
                // serves but the engineer can type over them per their plans.)
                { scope: 'item', editable: true, fieldKey: 'saber_ms_ahu_tag', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[0]); } },
                { scope: 'item', editable: true, fieldKey: 'saber_ms_area', derive: function (g) { return s(g.item.serves); } },
                { scope: 'item', derive: function (g) { return combine2(g.cell('A'), g.cell('B')); } },
                { scope: 'item', capacityField: 'airflow', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', editable: true, fieldKey: 'saber_ms_esp' },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', editable: true, fieldKey: 'saber_ms_oa_cfm' },
                { scope: 'item', derive: function (g) { return div1000(g.cell('I')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('J')); } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('K')) ? div1000(g.cell('K')) : '-'; } },
                { scope: 'item', kwSelect: true, derive: function (g) { return g.cell('L'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('N')); } },
                { scope: 'item', derive: function (g) { return g.cell('O'); } },
                { scope: 'item', derive: function (g) { return g.cell('P'); } },
                // --- Condensing unit ---
                { scope: 'item', editable: true, fieldKey: 'saber_ms_cu_tag', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return combine2(g.cell('R'), g.cell('S')); } },
                { scope: 'item', derive: function (g) { return g.filter('SIZE'); } },
                { scope: 'item', derive: function (g) { return g.cell('AB'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('W')); } },
                { scope: 'item', derive: function (g) { return g.cell('X'); } },
                { scope: 'item', derive: function (g) { return g.cell('Y'); } },
                // --- Weight (AH/HP) + notes ---
                { scope: 'item', derive: function (g) { return s(g.cell('Q')) + '/' + s(g.cell('AC')); } },
                { scope: 'item', derive: function () { return '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14'; } }
            ],
            notesTitle: 'NOTES:',
            // One row per note (renderers word-wrap long notes within the row),
            // matching the SABER.xlsx. Note 14 is the only one the Excel splits
            // across two rows, so it is two entries here.
            notes: [
                '1. COOLING CAPACITIES ARE RATED IN ACCORDANCE WITH ARI STANDARD 210/290 AT 95 DEGREE FARENHEIT AMBIENT OUTDOOR AIR TEMPERATURE, 80 DEGREE FARENHEIT DRY BULB, AND 67 DEGREE FAHRENHEIT WET BULB ENTERING AIR TEMPERATURE, AND NORMAL AIR QUANTITY LISTED.',
                "2. REFRIGERANT PIPING TO BE SIZED PER TOTAL INSTALLATION EQUIVALENT LENGTH. LONG-LINE APPLICATION TO BE PROVIDED WHENEVER MANUFACTURER RECOMMENDED LENGTHS ARE EXCEEDED, INCLUDING LIQUID LINE SOLENOID VALVES, ACCUMULATOR, ETC. MAXIMUM T.E.L. IS 100'",
                '3. PROVIDE SINGLE POINT ELECTRICAL CONNECTION FOR AIR HANDLING UNIT.',
                '4. PROVIDE NEW FILTER IN EACH UNIT AT TURNOVER TO OWNER.',
                '5. OUTDOOR UNITS SHALL HAVE MINIMUM 14.0 SEER2 RATING',
                '6. PROVIDE ON/AUTO FAN SWITCH AND HEAT-OF-COOL THERMOSTAT WITH SUBBASE FOR EACH UNIT. PROVIDE WITH OUTSIDE AIR TEMPERATURE SENSOR TO LOCKOUT ELECTRIC HEAT WHEN OUTSIDE AIR TEMPERATURE IS ABOVE 40 DEGREES.',
                '7. PROVIDE HEAT PUMP KIT WITH AIR HANDLER (IF REQUIRED).',
                '8. PROVIDE A 24V MOTORIZED DAMPER ON FRESH AIR RUN-OUT TO UNIT. DAMPER IS TO OPEN WHEN FAN IS ENERGIZED.',
                '9. ALL ACCESSORIES AND OPTIONS ARE TO BE FACTORY INSTALLED.',
                '10. SUPPORT AHU ON REINFORCED SHEET METAL R.A. PLENUM.',
                '11. AHU TO USE UPFLOW APPLICATION.',
                '12. AHU TO USE HORIZONTAL APPLICATION.',
                '13. DRAIN CONDENSATE TO HUB DRAIN.',
                '14. CATALOG NUMBERS AND MANUFACTURERS ARE TO INDICATE TYPE AND QUALITY OF UNIT DESIRED. SUBMIT CUTSHEETS OF THESE AND ALTERNATE MANUFACTURERS FOR ARCHITECT AND OWNER APPROVAL PRIOR TO PURCHASE OF ANY UNITS. INFORMATION ON ALTERNATE UNITS PROPOSED BY THE',
                'CONTRACTOR SHALL INCLUDE THE ADD/DEDUCT ASSOCIATED WITH ACCEPTANCE OF THAT UNIT (OR THE ALTERNATE PACKAGE AS A WHOLE).'
            ],
            manufacturers: null
        };
    }

    function saberRtu() {
        return {
            orientation: 'rows',
            title: 'PACKAGED DX COOLING/GAS HEATING ROOF TOP UNIT SCHEDULE',
            // Keep each note on a single line (the firm's sheets are wide):
            // widen the columns so the full-width notes box never word-wraps.
            notesSingleLine: true,
            // Header labels carry the SABER.xlsx's exact line breaks ("\n").
            header: [
                { r: 0, c: 0, rowspan: 2, label: 'UNIT\nTAG' },
                { r: 0, c: 1, rowspan: 2, label: 'AREA\nSERVED' },
                { r: 0, c: 2, colspan: 5, label: 'SUPPLY - FAN DATA' },
                { r: 0, c: 7, colspan: 2, label: 'COOLING CAPACITY' },
                { r: 0, c: 9, colspan: 2, label: 'HEATING CAPACITY' },
                { r: 0, c: 11, colspan: 3, label: 'ELECTRICAL DATA' },
                { r: 0, c: 14, rowspan: 2, label: 'MANUF.\nMODEL' },
                { r: 0, c: 15, rowspan: 2, label: 'TONNAGE' },
                { r: 0, c: 16, rowspan: 2, label: 'EFFICIENCY' },
                { r: 0, c: 17, rowspan: 2, label: 'UNIT\nWEIGHT\n(LBS)' },
                { r: 0, c: 18, rowspan: 2, label: 'NOTES' },
                { r: 1, c: 2, label: 'TOTAL\nCFM' },
                { r: 1, c: 3, label: 'OA\n(CFM)' },
                { r: 1, c: 4, label: 'MIN. EXT.\nS.P. (IN. WG)' },
                { r: 1, c: 5, label: 'MOTOR\nHP' },
                { r: 1, c: 6, label: 'FAN\nRPM' },
                { r: 1, c: 7, label: 'TOTAL\n(MBH)' },
                { r: 1, c: 8, label: 'SENS.\n(MBH)' },
                { r: 1, c: 9, label: 'INPUT\n(MBH)' },
                { r: 1, c: 10, label: 'OUTPUT\n(MBH)' },
                { r: 1, c: 11, label: 'VOLTAGE/PH' },
                { r: 1, c: 12, label: 'MCA\n(A)' },
                { r: 1, c: 13, label: 'MOCP\n(A)' }
            ],
            columns: [
                // UNIT TAG + AREA SERVED render as editable text boxes,
                // pre-filled from the item's tag / serves but overridable.
                { scope: 'item', editable: true, fieldKey: 'saber_rtu_tag', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', editable: true, fieldKey: 'saber_rtu_area', derive: function (g) { return s(g.item.serves); } },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', editable: true, fieldKey: 'saber_rtu_oa_cfm' },
                { scope: 'item', derive: function (g) { return g.cell('E'); } },
                { scope: 'item', derive: function (g) { return g.cell('V'); } },
                { scope: 'item', editable: true, fieldKey: 'saber_rtu_fan_rpm' },
                { scope: 'item', derive: function (g) { return div1000(g.cell('G')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('H')); } },
                { scope: 'item', derive: function (g) { return g.cell('N'); } },
                { scope: 'item', derive: function (g) { return g.cell('O'); } },
                { scope: 'item', derive: function (g) { return g.cell('U'); } },
                { scope: 'item', derive: function (g) { return g.cell('W'); } },
                { scope: 'item', derive: function (g) { return g.cell('X'); } },
                { scope: 'item', derive: function (g) { return combine2(g.cell('A'), g.cell('B')); } },
                { scope: 'item', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', derive: function (g) { return g.cell('I'); } },
                { scope: 'item', derive: function (g) { return g.cell('Y'); } },
                { scope: 'item', derive: function () { return '1, 2, 3, 4, 5, 6, 7, 8'; } }
            ],
            notesTitle: 'NOTES:',
            // One row per note (renderers word-wrap within the row). Note 8 is
            // the only one the Excel splits across two rows -> two entries.
            notes: [
                '1. COOLING CAPACITIES ARE RATED IN ACCORDANCE WITH ARI STANDARD 210/290 AT 95 DEGREE FARENHEIT AMBIENT OUTDOOR AIR TEMPERATURE, 80 DEGREE FARENHEIT DRY BULB, AND 67 DEGREE FAHRENHEIT WET BULB ENTERING AIR TEMPERATURE, AND NORMAL AIR QUANTITY LISTED.',
                '2. PROVIDE NEW FILTER IN EACH UNIT AT TURNOVER TO OWNER.',
                '3. PROVIDE MANUFACTURER\'S 7-DAY PROGRAMMABLE AUTOMATIC CHANGEOVER HEAT/COOL THERMOSTAT. PROGRAM FAN SETTING TO BE IN "ON" POSITION DURING PERIODS OF OCCUPATION.',
                '4. PROVIDE FACTORY ROOF CURB AND AIR SIDE ECONOMIZER SECTION WITH BAROMETRIC RELIEF DAMPER FOR EACH UNIT.',
                '5. ALL ACCESSORIES AND OPTIONS ARE TO BE FACTORY INSTALLED.',
                '6. PROVIDE SINGLE POINT ELECTRICAL CONNECTION.',
                '7. DUCT SMOKE DETECTOR TO BE PROVIDED BY E.C. AND INSTALLED BY M.C.',
                '8. UNLESS NOTED OTHERWISE, PRODUCTS SPECIFIED ON THESE PLANS ARE "BASIS OF DESIGN". SPECIFIC MANUFACTURER\'S PRODUCT IS NAMED, INCLUDING MAKE OR MODEL NUMBER OR OTHER DESIGNATION, IS TO ESTABLISH THE SIGNIFICANT QUALITIES RELATED TO TYPE, FUNCTION,',
                'DIMENSION, IN-SERVICE PERFORMANCE, PHYSICAL PROPERTIES, APPEARANCE, AND OTHER CHARACTERISTICS FOR PURPOSES OF EVALUATING COMPARABLE PRODUCTS OF OTHER MANUFACTURERS.'
            ],
            manufacturers: null
        };
    }

    // engineerKey -> productKey -> factory (returns a fresh template).
    var REGISTRY = {
        hoffman: {},   // empty - native layout for every product
        refresco: {
            mini_splits: refrescoMiniSplit,
            gas_packs: refrescoRtu
        },
        barrett_woodyard: {
            multi_position_splits: barrettWoodyardMultiSplit,
            gas_packs: barrettWoodyardRtu
        },
        allied: {
            multi_position_splits: alliedMultiSplit,
            gas_splits: alliedGasSplit
        },
        saber: {
            multi_position_splits: saberMultiSplit,
            gas_packs: saberRtu
        }
    };

    var ENGINEERS = [
        { key: 'hoffman', label: 'Hoffman & Hoffman' },
        { key: 'refresco', label: 'Refresco' },
        { key: 'barrett_woodyard', label: 'Barrett Woodyard & Associates' },
        { key: 'allied', label: 'Allied' },
        { key: 'saber', label: 'Saber' }
    ];

    // Engineer access is gated by the login password (see login.js ->
    // State.getAllowedEngineers). 'hoffman' (the standard layout) is
    // always allowed. This is the security boundary: a disallowed firm's
    // template is never returned, so even a project saved/imported with
    // engineer:'refresco' renders the standard schedule for a login that
    // lacks Refresco access.
    function isAllowed(engineerKey) {
        if (engineerKey === 'hoffman') return true;
        if (HHpro.State && typeof HHpro.State.isEngineerAllowed === 'function') {
            return HHpro.State.isEngineerAllowed(engineerKey);
        }
        return false;
    }

    HHpro.Templates = {
        // Only engineers the current login is allowed to use.
        listEngineers: function () {
            return ENGINEERS.filter(function (e) { return isAllowed(e.key); });
        },

        /**
         * Returns a template object for (engineerKey, productKey), or
         * null to fall back to the native scheduleHeader layout. Returns
         * null when the current login isn't allowed this engineer.
         */
        getTemplate: function (engineerKey, productKey) {
            if (!isAllowed(engineerKey)) return null;
            var byProduct = REGISTRY[engineerKey || 'hoffman'];
            if (!byProduct) return null;
            var factory = byProduct[productKey];
            return factory ? factory() : null;
        }
    };
})();
