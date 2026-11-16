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

    // "208/60/1" or "208/1" -> "208" (the volts token only)
    function voltOnly(v) {
        return s(v).split('/')[0].trim();
    }

    // "208/60/1" or "208/1" -> "1" (phase = last token). '' when the
    // value has no slash (nothing to split a phase out of).
    function phaseOnly(v) {
        var parts = s(v).split('/');
        return parts.length > 1 ? parts[parts.length - 1].trim() : '';
    }

    // Leading number of the idx-th "/"-separated part of an efficiency
    // string, trailing .0 stripped. effNum('16.7 IEER/11.8 EER', 1) ->
    // "11.8"; effNum('16.4 IEER', 0) -> "16.4"; "-" when missing.
    function effNum(v, idx) {
        var parts = s(v).split('/');
        var part = parts[idx] !== undefined ? parts[idx] : '';
        var m = part.match(/-?\d+(?:\.\d+)?/);
        return m ? m[0].replace(/\.0+$/, '') : '-';
    }

    // "AH" + "HP-K1" -> "AH/HP-K1" (either alone passes through)
    function tagPair(a, b) {
        var aa = s(a), bb = s(b);
        return (aa && bb) ? aa + '/' + bb : (aa || bb);
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
                { scope: 'row', derive: function (g) { return combine(g.cell('P'), g.cell('Q')); } },
                { scope: 'item', editable: true, fieldKey: 'refresco_ms_serves' },
                { scope: 'row', derive: function (g) { return g.cell('A'); } },
                { scope: 'row', editable: true, fieldKey: 'refresco_ms_min_oa_cfm' },
                { scope: 'row', derive: function (g) { return g.cell('F'); } },
                { scope: 'row', derive: function (g) { return g.cell('B'); } },
                { scope: 'row', derive: function (g) { return g.cell('C'); } },
                { scope: 'row', derive: function (g) { return g.cell('J'); } },
                { scope: 'row', derive: function (g) { return g.cell('S'); } },
                { scope: 'item', derive: function (g) { return firstNumber(g.cell('W')); } },
                // Indoor units fed from the outdoor single-point feed have
                // no independent service, so BOTH the indoor VOLT/PH and
                // MCA/MOCP read "-" (the real feed lives in the SINGLE POINT
                // POWER column, cols 16/17). Column J flags the indoor power
                // source; if a unit were ever independently powered it would
                // fall back to showing its own voltage.
                { scope: 'item', derive: function (g) {
                    return /powered from outdoor/i.test(g.cell('M'))
                        ? '-' : voltPh(g.cell('X'));
                } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return combine(g.cell('AA'), g.cell('AB')); } },
                { scope: 'item', derive: function (g) { return g.cell('V'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('X')); } },
                { scope: 'item', derive: function (g) { return slash(g.cell('Y'), g.cell('Z')); } }
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
                { band: 'top', label: 'WEIGHT:', derive: function (g) { return g.cell('AF'); } },

                { band: 'main', label: 'NOTES', editable: true, fieldKey: 'refresco_rtu_notes' },
                { band: 'main', label: 'SUPPLY  CFM', derive: function (g) { return g.cell('D'); } },
                { band: 'main', label: 'SUPPLY FAN HP', derive: function (g) { return g.cell('AC'); } },
                { band: 'main', label: 'EXTERNAL  STATIC  PRESSURE  (IN.  OF WATER)', derive: function (g) { return g.cell('E'); } },
                { band: 'main', label: 'NOMINAL  CAPACITY  (TONS)', derive: function (g) { return g.cell('C'); } },
                { band: 'main', label: 'GROSS  TOT COOLING  CAP.  (BTU/h)', derive: function (g) { return g.cell('F'); } },
                { band: 'main', label: 'EFFICIENCY', derive: function (g) { return g.cell('H'); } },
                { band: 'main', label: 'COOLING STAGES', derive: function (g) { return g.cell('AA'); } },
                { band: 'main', label: 'INPUT HEATING  CAP.  (MBH)  -  NAT.  GAS', derive: function (g) { return g.cell('M'); } },
                { band: 'main', label: 'OUTPUT HEATING  CAP.  (MBH)', derive: function (g) { return g.cell('N'); } },
                { band: 'main', label: 'HEATING  STAGES', derive: function (g) { return g.cell('O'); } },
                { band: 'main', label: 'VOLTAGE/PHASE', derive: function (g) { return g.cell('AB'); } },
                { band: 'main', label: 'SINGLE  POINT ELEC.  CONN.   MCA(A)/MOP(A)', derive: function (g) { return slash(g.cell('AD'), g.cell('AE')); } },
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
    // Circled note refs (multi split; ① = (1) ... ) render as circles on screen /
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
                { scope: 'item', derive: function (g) { return g.cell('J'); } },
                { scope: 'item', derive: function (g) { return g.cell('K'); } },
                { scope: 'item', capacityField: 'airflow', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', editable: true, fieldKey: 'bw_ms_oa_cfm' },
                { scope: 'item', derive: function () { return '0.5'; } },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', capacityField: 'eatDb', derive: function (g) { return g.cell('F'); } },
                { scope: 'item', capacityField: 'eatWb', derive: function (g) { return g.cell('G'); } },
                { scope: 'item', elecField: 'voltage', derive: function (g) { return voltPh(g.cell('P')); } },
                { scope: 'item', derive: function () { return 'D'; } },
                { scope: 'item', derive: function () { return 'MULTI-POSITION AHU'; } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('W')) ? 'HP' : '-'; } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('W')) ? mbh(g.cell('W')) : '-'; } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('N')) ? 'ELEC' : '-'; } },
                { scope: 'item', elecField: 'kw', derive: function (g) { return isPositiveNum(g.cell('N')) ? g.cell('N') : '-'; } },
                { scope: 'item', derive: function () { return '95'; } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('Y')); } },
                { scope: 'item', derive: function () { return '1'; } },
                { scope: 'item', derive: function (g) { return g.cell('AD'); } },
                { scope: 'item', derive: function (g) { return combine(g.cell('T'), g.cell('U')) + '/' + s(g.cell('B')); } },
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

    // LC RTU "PACKAGED ROOFTOP UNIT SCHEDULE" (RTU tab, 2026-10-23
    // revision). Gas packs and heat pumps share one layout: the HEATING
    // group carries both gas and heat pump columns, and each row fills the
    // ones for its TYPE ("-" in the others). Note refs are the firm's own
    // plain "(1)" text on this sheet, not circled digits.
    function barrettWoodyardRtu() {
        // Efficiency "13.7 SEER2/11.8 EER2" or "17.20 IEER/12.0 EER": part 0
        // is SEER2/IEER, part 1 is EER. Trailing zeros dropped ("17.2").
        function eff(g, idx) {
            var n = effNum(g.cell('H'), idx);
            return n === '-' ? n : String(Number(n));
        }
        // COP 47/17 -> "3.3/2.05"; gas packs (both "-") read "-".
        function copPair(g) {
            var a = g.cell('V'), b = g.cell('W');
            return (a === '-' && b === '-') ? '-' : slash(a, b);
        }
        // Design Search rows carry the ambient they were selected at.
        function ambient(g) {
            var p = (HHpro.GasPackDesign && HHpro.GasPackDesign.itemPayload)
                ? HHpro.GasPackDesign.itemPayload(g.item) : null;
            return (p && p.cooling && p.cooling.ambient != null) ? String(p.cooling.ambient) : '95';
        }
        return {
            orientation: 'rows',
            title: 'PACKAGED ROOFTOP UNIT SCHEDULE',
            // Applies to heat pumps too (see UNIT_TYPE_LIMITS).
            allUnitTypes: true,
            header: [
                { r: 0, c: 0, rowspan: 2, label: 'I.D. TAG' },
                { r: 0, c: 1, rowspan: 2, label: 'SUPPLY AIRFLOW (CFM)' },
                { r: 0, c: 2, rowspan: 2, label: 'EXT. SP (IN. WC) (1)' },
                { r: 0, c: 3, rowspan: 2, label: 'MOTOR HP' },
                { r: 0, c: 4, rowspan: 2, label: 'BOD TOTAL CAPACITY (MBH)' },
                { r: 0, c: 5, rowspan: 2, label: 'BOD SENSIBLE CAPACITY (MBH)' },
                { r: 0, c: 6, rowspan: 2, label: 'AMBIENT TEMP (°F)' },
                { r: 0, c: 7, colspan: 2, label: 'COIL EAT' },
                { r: 1, c: 7, label: '°F db' },
                { r: 1, c: 8, label: '°F wb' },
                { r: 0, c: 9, colspan: 5, label: 'HEATING' },
                { r: 1, c: 9, label: 'TYPE' },
                { r: 1, c: 10, label: 'GAS INPUT' },
                { r: 1, c: 11, label: 'GAS OUTPUT' },
                { r: 1, c: 12, label: 'HEAT PUMP BTU/h (47°F, 70°F Indoor DB)' },
                { r: 1, c: 13, label: 'HEAT PUMP BTU/h (17°F, 70°F Indoor DB)' },
                { r: 0, c: 14, rowspan: 2, label: 'EER' },
                { r: 0, c: 15, rowspan: 2, label: 'SEER2/ IEER' },
                { r: 0, c: 16, rowspan: 2, label: 'COP (47°F)/(17°F)' },
                { r: 0, c: 17, rowspan: 2, label: 'VOLTS/ PHASE' },
                { r: 0, c: 18, rowspan: 2, label: 'MCA' },
                { r: 0, c: 19, rowspan: 2, label: 'MOCP' },
                { r: 0, c: 20, rowspan: 2, label: 'BASIS OF DESIGN' },
                { r: 0, c: 21, rowspan: 2, label: 'APPROX. WEIGHT (LBS)' },
                { r: 0, c: 22, rowspan: 2, label: 'REMARKS' }
            ],
            columns: [
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', derive: function (g) { return g.cell('E'); } },
                { scope: 'item', derive: function (g) { return g.cell('AC'); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('F')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('G')); } },
                { scope: 'item', derive: ambient },
                { scope: 'item', derive: function (g) { return g.cell('I'); } },
                { scope: 'item', derive: function (g) { return g.cell('J'); } },
                { scope: 'item', derive: function (g) { return g.filter('TYPE') || '-'; } },
                { scope: 'item', derive: function (g) { return g.cell('M'); } },
                { scope: 'item', derive: function (g) { return g.cell('N'); } },
                { scope: 'item', derive: function (g) { return g.cell('R'); } },
                { scope: 'item', derive: function (g) { return g.cell('S'); } },
                { scope: 'item', derive: function (g) { return eff(g, 1); } },
                { scope: 'item', derive: function (g) { return eff(g, 0); } },
                { scope: 'item', derive: copPair },
                { scope: 'item', derive: function (g) { return g.cell('AB'); } },
                { scope: 'item', derive: function (g) { return g.cell('AD'); } },
                { scope: 'item', derive: function (g) { return g.cell('AE'); } },
                { scope: 'item', derive: function (g) { return combine(g.cell('A'), g.cell('B')); } },
                { scope: 'item', derive: function (g) { return g.cell('AF'); } },
                // Every note applies until edited per unit (Edit Schedule).
                { scope: 'item', derive: function () { return '(1) (2) (3) (4) (5) (6) (7) (8) (9) (10) (11) (12) (13)'; } }
            ],
            notesTitle: '',
            notes: [
                '(1)  THIS IS THE SP EXTERNAL TO THE ENTIRE UNIT ASSEMBLY (WET COIL, CASING, CLEAN FILTERS, AND FURNACE LOSSES ARE NOT INCLUDED IN THIS EXTERNAL SP).',
                '(2)  HEAT PUMP CAPACITY RATED AT 17°F.',
                '(3)  PROVIDE WITH POWERED GFI OUTLET. COORD. WITH DIV. 26.',
                '(4)  PROVIDE WITH INTEGRAL DISCONNECT. COORD. WITH DIV. 26.',
                '(5)  PROVIDE SMOKE DETECTORS RETURN DUCTWORK FOR AUTOMATIC SHUTDOWN IN COMPLIANCE WITH NFPA 72.  DETECTORS SHALL BE SUPPLIED BY DIV. 26 AND INSTALLED BY DIV. 23.',
                '(6)  PROVIDE WITH 7-DAY PROGRAMMABLE TSTAT OR INTERLOCK TO BAS.',
                '(7)  PROVIDE UNIT WITH DIFFERENTIAL-ENTHALPY ECONOMIZER AND BAROMETRIC RELIEF.',
                '(8)  PROVIDE UNIT WITH DIFFERENTIAL-ENTHALPY ECONOMIZER AND POWERED EXHAUST',
                '(9)  PROVIDE WITH HOT GAS REHEAT AND SPACE-MOUNTED TEMPERATURE/HUMIDITY SENSOR.',
                '(10) PROVIDE UNIT WITH PLENUM RETURN CURB.',
                '(11) PROVIDE WITH ECM SUPPLY FAN',
                '(12) PROVIDE WITH MODULATING OUTSIDE AIR DAMPER, INTERLOCKED TO SPACE-MOUNTED CO2 SENSOR FOR DEMAND CONTROL VENTILATION SEQUENCE.',
                '(13) FOR ALL HEALTHCARE APPLICATIONS OUTSIDE AIR INTAKE SHALL BE A MINIMUM OF 36" ABOVE THE ADJACENT ROOF. PROVIDE WITH EXTENDED HEIGHT CURB AS REQUIRED.'
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
                { scope: 'item', derive: function (g) { return div1000(g.cell('J')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('K')); } },
                { scope: 'item', derive: function (g) { return g.cell('AD'); } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('L')) ? div1000(g.cell('L')) : '-'; } },
                { scope: 'item', elecField: 'kw', derive: function (g) { return g.cell('N'); } },
                { scope: 'item', elecField: 'voltage', derive: function (g) { return voltPh(g.cell('P')); } },
                { scope: 'item', derive: function (g) { return g.cell('Q'); } },
                { scope: 'item', derive: function (g) { return g.cell('R'); } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('U'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('Y')); } },
                { scope: 'item', derive: function (g) { return g.cell('Z'); } },
                { scope: 'item', derive: function (g) { return g.cell('AA'); } },
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
                { scope: 'item', derive: function (g) { return voltPh(g.cell('N')); } },
                { scope: 'item', derive: function (g) { return g.cell('O'); } },
                { scope: 'item', derive: function (g) { return g.cell('P'); } },
                { scope: 'item', derive: function (g) { return g.cell('Q'); } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('S'); } },
                { scope: 'item', derive: function (g) { return g.filter('SIZE'); } },
                { scope: 'item', derive: function (g) { return g.cell('Y'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('T')); } },
                { scope: 'item', derive: function (g) { return g.cell('U'); } },
                { scope: 'item', derive: function (g) { return g.cell('V'); } },
                { scope: 'item', derive: function (g) { return g.cell('Z'); } },
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
    // Products: multi_position_splits, mini_splits, gas_packs (all
    // orientation 'rows'). Note refs are the firm's own plain comma lists
    // ("1, 2, 3 ..."), not circled digits, so there are no DXF/PDF
    // transliteration concerns. Fields with no native data source (ESP,
    // OUTSIDE AIR, FAN RPM, ...) are inline-editable; AREA SERVED + UNIT TAG
    // pre-fill from the item but are editable.
    //
    // Mini splits + multi position splits use ONE identical layout (title
    // "SPLIT SYSTEM HEAT PUMP UNIT SCHEDULE"). saberSplitHeader() and
    // saberSplitNotes() are shared by both product templates so they stay
    // byte-identical - and so the combined "Split Systems" view (built in
    // export.js by merging both products' rows under this header) lines up.
    // Only the per-product column derives differ, because the two products'
    // scheduleData layouts differ (mini-split values live in different
    // letters; mini-split indoor is powered from the outdoor single-point
    // feed, so its MCA/MOCP read "NA").
    // =================================================================

    // Shared header for the Saber split-system layout (23 leaf columns,
    // 0-22). Labels carry the SABER.xlsx line breaks ("\n").
    function saberSplitHeader() {
        return [
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
        ];
    }

    // Shared notes for the Saber split-system layout. One row per note;
    // note 14 is the only one the Excel splits across two rows (2 entries).
    function saberSplitNotes() {
        return [
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
        ];
    }

    function saberMultiSplit() {
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM HEAT PUMP UNIT SCHEDULE',
            // The mini-split + MPS templates share ONE identical layout, so
            // the combined "Split Systems" view may merge their rows under a
            // single header. Only set this on templates built around a shared
            // header (see showSplitSystemsTab / buildCombinedSplitSystemsGrid).
            combinedSplitSystems: true,
            // Keep each note on a single line (the firm's sheets are wide):
            // widen the columns so the full-width notes box never word-wraps.
            notesSingleLine: true,
            header: saberSplitHeader(),
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
                { scope: 'item', derive: function (g) { return div1000(g.cell('J')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('K')); } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('L')) ? div1000(g.cell('L')) : '-'; } },
                { scope: 'item', elecField: 'kw', derive: function (g) { return g.cell('N'); } },
                { scope: 'item', elecField: 'voltage', derive: function (g) { return voltPh(g.cell('P')); } },
                { scope: 'item', derive: function (g) { return g.cell('Q'); } },
                { scope: 'item', derive: function (g) { return g.cell('R'); } },
                // --- Condensing unit ---
                { scope: 'item', editable: true, fieldKey: 'saber_ms_cu_tag', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return combine2(g.cell('T'), g.cell('U')); } },
                { scope: 'item', derive: function (g) { return g.filter('SIZE'); } },
                { scope: 'item', derive: function (g) { return g.cell('AD'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('Y')); } },
                { scope: 'item', derive: function (g) { return g.cell('Z'); } },
                { scope: 'item', derive: function (g) { return g.cell('AA'); } },
                // --- Weight (AH/HP) + notes ---
                { scope: 'item', derive: function (g) { return s(g.cell('S')) + '/' + s(g.cell('AE')); } },
                { scope: 'item', derive: function () { return '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14'; } }
            ],
            notesTitle: 'NOTES:',
            notes: saberSplitNotes(),
            manufacturers: null
        };
    }

    // Mini splits - SAME layout as the multi position split (saberSplitHeader
    // / saberSplitNotes), but mapped to the mini_splits scheduleData. Indoor
    // fields are per-row (scope 'row') so a multi-zone system lists each head
    // on its own row with the outdoor data row-spanned; the outdoor fields are
    // scope 'item'. Mini-split indoor units are powered from the outdoor
    // single-point feed, so indoor MCA/MOCP read "NA" and indoor VOLTAGE shows
    // the outdoor feed voltage. EFFICIENCY appends "(SEER2/EER2/HSPF2)" on a
    // 2nd line because the mini value (col R) carries no inline label (unlike
    // the MPS "15.2/12.5 (SEER2/EER2)"). TONNAGE = the "SIZE (OUTDOOR UNIT)"
    // filter. Mini splits have no motor HP / aux electric heat, so those are
    // editable "-" placeholders.
    function saberMiniSplit() {
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM HEAT PUMP UNIT SCHEDULE',
            combinedSplitSystems: true,
            notesSingleLine: true,
            header: saberSplitHeader(),
            columns: [
                // --- Indoor (air handling) unit: per indoor sub-row ---
                { scope: 'row', editable: true, fieldKey: 'saber_min_idu_tag', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[g.rowIndex]); } },
                { scope: 'row', editable: true, fieldKey: 'saber_min_area', derive: function (g) { return s(g.item.serves); } },
                { scope: 'row', derive: function (g) { return combine2(g.cell('P'), g.cell('Q')); } },
                { scope: 'row', derive: function (g) { return g.cell('A'); } },
                { scope: 'row', editable: true, fieldKey: 'saber_min_esp' },
                { scope: 'row', editable: true, fieldKey: 'saber_min_motor_hp' },
                { scope: 'row', editable: true, fieldKey: 'saber_min_oa_cfm' },
                { scope: 'row', derive: function (g) { return div1000(g.cell('F')); } },
                { scope: 'row', derive: function (g) { return div1000(g.cell('G')); } },
                { scope: 'row', derive: function (g) { return div1000(g.cell('J')); } },
                { scope: 'row', editable: true, fieldKey: 'saber_min_aux_kw' },
                { scope: 'row', derive: function (g) { return voltPh(g.cell('X')); } },
                { scope: 'row', derive: function () { return 'NA'; } },
                { scope: 'row', derive: function () { return 'NA'; } },
                // --- Condensing unit: shared across the indoor rows ---
                { scope: 'item', editable: true, fieldKey: 'saber_min_odu_tag', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return combine2(g.cell('AA'), g.cell('AB')); } },
                { scope: 'item', derive: function (g) { return g.filter('SIZE (OUTDOOR UNIT)'); } },
                { scope: 'item', derive: function (g) { var r = g.cell('W'); return r ? r + '\n(SEER2/EER2/HSPF2)' : r; } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('X')); } },
                { scope: 'item', derive: function (g) { return g.cell('Y'); } },
                { scope: 'item', derive: function (g) { return g.cell('Z'); } },
                // --- Weight (indoor / outdoor, per row) + notes ---
                { scope: 'row', derive: function (g) { return s(g.cell('K')) + '/' + s(g.cellAt('V', 0)); } },
                { scope: 'item', derive: function () { return '1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14'; } }
            ],
            notesTitle: 'NOTES:',
            notes: saberSplitNotes(),
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
                { scope: 'item', derive: function (g) { return g.cell('AC'); } },
                { scope: 'item', editable: true, fieldKey: 'saber_rtu_fan_rpm' },
                { scope: 'item', derive: function (g) { return div1000(g.cell('F')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('G')); } },
                { scope: 'item', derive: function (g) { return g.cell('M'); } },
                { scope: 'item', derive: function (g) { return g.cell('N'); } },
                { scope: 'item', derive: function (g) { return g.cell('AB'); } },
                { scope: 'item', derive: function (g) { return g.cell('AD'); } },
                { scope: 'item', derive: function (g) { return g.cell('AE'); } },
                { scope: 'item', derive: function (g) { return combine2(g.cell('A'), g.cell('B')); } },
                { scope: 'item', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', derive: function (g) { return g.cell('H'); } },
                { scope: 'item', derive: function (g) { return g.cell('AF'); } },
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

    // =================================================================
    // MSWG templates (password MSWG1)
    // Mapped from DATA/ENGINEER SCHEDULES/MSWG.xlsx, using the user's
    // matching Hoffman Cart exports as a value-by-value Rosetta Stone.
    // Products: mini_splits, multi_position_splits, gas_packs (all
    // orientation 'rows'). Fields the firm schedules but HHpro has no
    // data source for yet (highlighted yellow in MSWG.xlsx: fan-motor
    // FLA, heating COP, outdoor-fan/compressor electrical breakdowns,
    // AFUE, hot-gas-reheat temps, refrigerant charge, temp rise) render
    // as "-" constants until the Hoffman data grows those columns.
    // Volts and Phase are separate columns here, split out of the native
    // "V/Hz/Ph" values via voltOnly()/phaseOnly().
    // =================================================================

    function mswgMiniSplit() {
        return {
            orientation: 'rows',
            title: 'MINI-SPLIT SCHEDULE',
            header: [
                // Tier A
                { r: 0, c: 0, rowspan: 3, label: 'Unit Tag' },
                { r: 0, c: 1, rowspan: 3, label: 'Area Served' },
                { r: 0, c: 2, rowspan: 3, label: 'CFM' },
                { r: 0, c: 3, colspan: 3, label: 'Fan Motor' },
                { r: 0, c: 6, colspan: 4, label: 'Cooling Performance' },
                { r: 0, c: 10, colspan: 3, label: 'Heating Performance' },
                { r: 0, c: 13, colspan: 8, label: 'Outdoor Unit' },
                { r: 0, c: 21, rowspan: 3, label: 'Indoor\nUnit' },
                { r: 0, c: 22, rowspan: 3, label: 'Outdoor\nUnit' },
                { r: 0, c: 23, rowspan: 3, label: 'Remarks' },
                // Tier B
                { r: 1, c: 3, rowspan: 2, label: 'FLA' },
                { r: 1, c: 4, rowspan: 2, label: 'Volts' },
                { r: 1, c: 5, rowspan: 2, label: 'Phase' },
                { r: 1, c: 6, rowspan: 2, label: 'EAT' },
                { r: 1, c: 7, rowspan: 2, label: 'BTU\nTotal' },
                { r: 1, c: 8, rowspan: 2, label: 'BTU\nSensible' },
                { r: 1, c: 9, rowspan: 2, label: 'Efficiency\nSEER' },
                { r: 1, c: 10, rowspan: 2, label: 'EAT' },
                { r: 1, c: 11, rowspan: 2, label: 'BTU\nTotal' },
                { r: 1, c: 12, rowspan: 2, label: 'Efficiency\nCOP' },
                { r: 1, c: 13, rowspan: 2, label: 'Unit Tag' },
                { r: 1, c: 14, rowspan: 2, label: 'Weight' },
                { r: 1, c: 15, colspan: 2, label: 'Fan' },
                { r: 1, c: 17, rowspan: 2, label: 'MCA' },
                { r: 1, c: 18, rowspan: 2, label: 'Fuse\nSize' },
                { r: 1, c: 19, rowspan: 2, label: 'Volts' },
                { r: 1, c: 20, rowspan: 2, label: 'Phase' },
                // Tier C
                { r: 2, c: 15, label: 'No.' },
                { r: 2, c: 16, label: 'FLA(ea)' }
            ],
            columns: [
                // --- Indoor unit: one row per indoor head. UNIT TAG + AREA
                // SERVED pre-fill from the item but stay editable text boxes.
                { scope: 'row', editable: true, fieldKey: 'mswg_min_idu_tag', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[g.rowIndex]); } },
                { scope: 'row', editable: true, fieldKey: 'mswg_min_area', derive: function (g) { return s(g.item.serves); } },
                { scope: 'row', derive: function (g) { return g.cell('A'); } },
                // Fan-motor FLA: no data source yet
                { scope: 'row', derive: function () { return '-'; } },
                // Indoor units are powered from the outdoor single-point
                // feed, so fan-motor volts/phase mirror the outdoor service
                // (which multi-zone selections only store on sub-row 0).
                { scope: 'row', derive: function (g) { return voltOnly(g.cellAt('X', 0)); } },
                { scope: 'row', derive: function (g) { return phaseOnly(g.cellAt('X', 0)); } },
                { scope: 'row', derive: function (g) { return slash(g.cell('B'), g.cell('C')); } },
                { scope: 'row', derive: function (g) { return g.cell('F'); } },
                { scope: 'row', derive: function (g) { return g.cell('G'); } },
                { scope: 'item', derive: function (g) { return firstNumber(g.cell('W')); } },
                { scope: 'row', derive: function (g) { return g.cell('H'); } },
                { scope: 'row', derive: function (g) { return g.cell('J'); } },
                // Heating COP: no data source yet
                { scope: 'item', derive: function () { return '-'; } },
                // --- Outdoor unit ---
                { scope: 'item', editable: true, fieldKey: 'mswg_min_odu_tag', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('V'); } },
                // Outdoor fan No. / FLA(ea): no data source yet
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function (g) { return g.cell('Y'); } },
                { scope: 'item', derive: function (g) { return g.cell('Z'); } },
                { scope: 'item', derive: function (g) { return voltOnly(g.cell('X')); } },
                { scope: 'item', derive: function (g) { return phaseOnly(g.cell('X')); } },
                // --- Model columns + remarks ---
                { scope: 'row', derive: function (g) { return g.cell('Q'); } },
                { scope: 'item', derive: function (g) { return g.cell('AB'); } },
                { scope: 'item', derive: function () { return '1-9'; } }
            ],
            notesTitle: '',
            notes: [
                '1.  REFER TO APPROVED MANUFACTURER LIST FOR ACCEPTABLE EQUAL MANUFACTURERS.  COORDINATE POWER REQUIREMENTS FOR ALL SUBSTITUTIONS.',
                "2.  MECHANICAL CONTRACTOR IS RESPONSIBLE FOR INSTALLING IN ACCORDANCE WITH MANUFACTURER'S INSTALLATION INSTRUCTIONS AND LOCAL CODES.",
                '3.  WIRED REMOTE CONTROLLER AND BAS INTERFACE ADAPTOR.',
                '4.  REFRIGERANT LINES AND ACCESSORIES PER SPECS AND AS RECOMMENDED BY UNIT MFG.',
                '5.  PROVIDE FACTORY CONDENSATE PUMP POWERED FROM AIR HANDLER.  ROUTE 3/4" PUMPED CONDENSATE TO DRAIN WITH MINIMUM 1" AIR GAP.',
                '6.  VARIABLE SPEED, INVERTER DRIVEN.',
                '7.  INDOOR UNIT IS POWERED BY OUTDOOR UNIT.  COORDINATE SUBSTITUTE  MANUFACTURER ELECTRICAL REQUIREMENTS WITH ELECTRICAL CONTRACTOR AT NO ADDITIONAL COST TO OWNER.',
                '8.  PROVIDE ACCESSORIES AS REQUIRED TO ALLOW FOR LOW AMBIENT COOLING DOWN TO 18°F.',
                "9.  PROVIDE WITH MANUFACTURER'S 5-YEAR WARRANTY."
            ],
            manufacturers: null
        };
    }

    function mswgMultiSplit() {
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM SCHEDULE',
            header: [
                // Tier A
                { r: 0, c: 0, rowspan: 3, label: 'Unit Tag' },
                { r: 0, c: 1, rowspan: 3, label: 'SEER\n(EER/IEER)' },
                { r: 0, c: 2, rowspan: 3, label: 'COP\n@47\nDEG. F' },
                { r: 0, c: 3, rowspan: 3, label: 'CFM' },
                { r: 0, c: 4, rowspan: 3, label: 'OA' },
                { r: 0, c: 5, rowspan: 3, label: 'ESP' },
                { r: 0, c: 6, colspan: 12, label: 'Air Handling Unit' },
                { r: 0, c: 18, colspan: 3, label: 'DX Coil Performance' },
                { r: 0, c: 21, colspan: 3, label: 'Heating Performance' },
                { r: 0, c: 24, colspan: 10, label: 'Electrical Data (Outdoor Unit)' },
                { r: 0, c: 34, rowspan: 3, label: 'Remarks' },
                // Tier B
                { r: 1, c: 6, colspan: 3, label: 'Fan Motor' },
                { r: 1, c: 9, colspan: 6, label: 'Electric Heating Coil' },
                { r: 1, c: 15, rowspan: 2, label: 'MCA' },
                { r: 1, c: 16, rowspan: 2, label: 'MOCP' },
                { r: 1, c: 17, rowspan: 2, label: 'Daikin\nModel' },
                { r: 1, c: 18, rowspan: 2, label: 'EAT' },
                { r: 1, c: 19, rowspan: 2, label: 'MBH\nTotal' },
                { r: 1, c: 20, rowspan: 2, label: 'MBH\nSens.' },
                { r: 1, c: 21, rowspan: 2, label: 'EAT' },
                { r: 1, c: 22, rowspan: 2, label: 'LAT' },
                { r: 1, c: 23, rowspan: 2, label: 'Capacity\nMBH@47 F' },
                { r: 1, c: 24, colspan: 2, label: 'Fan' },
                { r: 1, c: 26, colspan: 3, label: 'Compressor' },
                { r: 1, c: 29, rowspan: 2, label: 'Volts' },
                { r: 1, c: 30, rowspan: 2, label: 'Phase' },
                { r: 1, c: 31, rowspan: 2, label: 'MCA' },
                { r: 1, c: 32, rowspan: 2, label: 'MOCP' },
                { r: 1, c: 33, rowspan: 2, label: 'Daikin\nModel' },
                // Tier C
                { r: 2, c: 6, label: 'HP' },
                { r: 2, c: 7, label: 'Volts' },
                { r: 2, c: 8, label: 'Phase' },
                { r: 2, c: 9, label: 'kW' },
                { r: 2, c: 10, label: 'Steps' },
                { r: 2, c: 11, label: 'Volts' },
                { r: 2, c: 12, label: 'Phase' },
                { r: 2, c: 13, label: 'EAT' },
                { r: 2, c: 14, label: 'LAT' },
                { r: 2, c: 24, label: 'No.' },
                { r: 2, c: 25, label: 'FLA' },
                { r: 2, c: 26, label: 'No.' },
                { r: 2, c: 27, label: 'LRA' },
                { r: 2, c: 28, label: 'RLA' }
            ],
            columns: [
                // Unit tag renders "AH-TAG/HP-TAG" style (the firm lists one
                // combined tag, e.g. "AH/HP-K1"); pre-fills from the item's
                // indoor + outdoor tags but stays an editable text box.
                { scope: 'item', editable: true, fieldKey: 'mswg_mps_tag', derive: function (g) { return tagPair(g.item.indoorTags && g.item.indoorTags[0], g.item.tag); } },
                { scope: 'item', derive: function (g) { return effNum(g.cell('AD'), 0); } },
                // COP @ 47F: no data source yet
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', capacityField: 'airflow', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', editable: true, fieldKey: 'mswg_mps_oa_cfm' },
                { scope: 'item', editable: true, fieldKey: 'mswg_mps_esp' },
                // --- Air handling unit ---
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                // Fan motor volts: the air handler voltage / phase dropdown
                // (the phase cells beside it follow the pick).
                { scope: 'item', elecField: 'voltage', derive: function (g) { return voltOnly(g.cell('P')); } },
                { scope: 'item', derive: function (g) { return phaseOnly(g.cell('P')); } },
                { scope: 'item', elecField: 'kw', derive: function (g) { return g.cell('N'); } },
                // Electric heaters in these AHUs are single-step
                { scope: 'item', derive: function () { return '1'; } },
                { scope: 'item', derive: function (g) { return voltOnly(g.cell('P')); } },
                { scope: 'item', derive: function (g) { return phaseOnly(g.cell('P')); } },
                // Heating-coil EAT / LAT: no data source yet
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function (g) { return g.cell('Q'); } },
                { scope: 'item', derive: function (g) { return g.cell('R'); } },
                { scope: 'item', derive: function (g) { return g.cell('B'); } },
                // --- DX coil performance ---
                { scope: 'item', derive: function (g) { return slash(g.cell('F'), g.cell('G')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('J')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('K')); } },
                // --- Heating performance (EAT / LAT: no data source yet) ---
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('L')) ? div1000(g.cell('L')) : '-'; } },
                // --- Outdoor electrical: fan/compressor breakdowns have no
                // data source yet ---
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function (g) { return voltOnly(g.cell('Y')); } },
                { scope: 'item', derive: function (g) { return phaseOnly(g.cell('Y')); } },
                { scope: 'item', derive: function (g) { return g.cell('Z'); } },
                { scope: 'item', derive: function (g) { return g.cell('AA'); } },
                { scope: 'item', derive: function (g) { return g.cell('U'); } },
                { scope: 'item', derive: function () { return '1-9'; } }
            ],
            notesTitle: '',
            notes: [
                '1. REFER TO APPROVED MANUFACTURER LIST FOR ACCEPTABLE EQUAL MANUFACTURERS.  COORDINATE POWER REQUIREMENTS FOR ALL SUBSTITUTIONS.',
                "2.  MECHANICAL CONTRACTOR IS RESPONSIBLE FOR INSTALLING IN ACCORDANCE WITH MANUFACTURER'S INSTALLATION INSTRUCTIONS AND LOCAL CODES.",
                '3. CONTRACTOR SHALL VERIFY SERVICE CLEARANCES FOR ALL SUBSTITUTIONS.',
                '4. SINGLE POINT ELECTRICAL CONNECTION AT AIR HANDLING UNIT UNLESS TWO CIRCUITS SHOWN ON SCHEDULE.',
                '5.  FOR LINE SETS BETWEEN 50 AND 175 FEET, INCLUDE THE FOLLOWING:',
                '        CRANKCASE HEATER',
                '        COMPRESSOR START ASSIST CAPACITOR AND RELAY',
                '        LIQUID - LINE SOLENOID VALVE OR HARD SHUTOFF TXV',
                "6. PROVIDE MANUFACTURER'S REMOTE THERMOSTAT WITH TEMPERATURE/HUMIDITY SENSOR FOR COOLING/HEATING/DEHUMIDIFICATION.",
                '7. REFRIGERANT LINES AND ACCESSORIES PER UNIT MFG. RECOMMENDATIONS.',
                '8. AIR HANDLER CONVERTIBLE FOR VERTICAL / HORIZONTAL INSTALLATION.',
                '9. UNIT SHALL BE SUSPENDED FROM STRUCTURE.',
                '10. PROVIDE OVERFLOW DRAIN PAN BELOW UNIT WITH MICROSWITCH TO SHUT OFF UNIT PRIOR TO PAN OVERFLOW.'
            ],
            manufacturers: null
        };
    }

    function mswgRtu() {
        return {
            orientation: 'rows',
            title: 'PACKAGED CAV SINGLE ZONE RTU WITH GAS HEAT SCHEDULE',
            header: [
                // Tier A
                { r: 0, c: 0, rowspan: 3, label: 'Unit Tag' },
                { r: 0, c: 1, rowspan: 3, label: 'Area Served' },
                { r: 0, c: 2, rowspan: 3, label: 'Nominal\nTons' },
                { r: 0, c: 3, rowspan: 3, label: 'EER' },
                { r: 0, c: 4, rowspan: 3, label: 'IEER/SEER' },
                { r: 0, c: 5, rowspan: 3, label: 'AFUE\n%' },
                { r: 0, c: 6, rowspan: 3, label: 'O.A.\nMin.' },
                { r: 0, c: 7, rowspan: 3, label: 'O.A.\nMax.' },
                { r: 0, c: 8, colspan: 7, label: 'Indoor Fan Motor' },
                { r: 0, c: 15, colspan: 3, label: 'Cooling Performance' },
                { r: 0, c: 18, colspan: 4, label: 'Hot Gas Reheat' },
                { r: 0, c: 22, rowspan: 3, label: 'Refrigerant Charge (lbs)' },
                { r: 0, c: 23, colspan: 4, label: 'Heating Performance' },
                { r: 0, c: 27, colspan: 16, label: 'Electrical Data' },
                { r: 0, c: 43, rowspan: 3, label: 'Daikin Model' },
                { r: 0, c: 44, rowspan: 3, label: 'Weight\n(lbs.)' },
                { r: 0, c: 45, rowspan: 3, label: 'Remarks' },
                // Tier B
                { r: 1, c: 8, rowspan: 2, label: 'CFM' },
                { r: 1, c: 9, rowspan: 2, label: 'ESP' },
                { r: 1, c: 10, rowspan: 2, label: 'Quantity' },
                { r: 1, c: 11, rowspan: 2, label: 'HP' },
                { r: 1, c: 12, rowspan: 2, label: 'FLA' },
                { r: 1, c: 13, rowspan: 2, label: 'Volts' },
                { r: 1, c: 14, rowspan: 2, label: 'Phase' },
                { r: 1, c: 15, rowspan: 2, label: 'EAT\nDB/WB' },
                { r: 1, c: 16, rowspan: 2, label: 'Total\nMBH' },
                { r: 1, c: 17, rowspan: 2, label: 'Sensible\nMBH' },
                { r: 1, c: 18, colspan: 2, label: 'EVAP' },
                { r: 1, c: 20, colspan: 2, label: 'REHEAT' },
                { r: 1, c: 23, rowspan: 2, label: 'Stages' },
                { r: 1, c: 24, rowspan: 2, label: 'INPUT\nMBH' },
                { r: 1, c: 25, rowspan: 2, label: 'OUTPUT\nMBH' },
                { r: 1, c: 26, rowspan: 2, label: 'Temp.\nRise' },
                { r: 1, c: 27, colspan: 4, label: 'Condenser Fan' },
                { r: 1, c: 31, colspan: 2, label: 'Pwr Exh. Fan' },
                { r: 1, c: 33, colspan: 6, label: 'Compressors' },
                { r: 1, c: 39, rowspan: 2, label: 'MCA' },
                { r: 1, c: 40, rowspan: 2, label: 'MOCP' },
                { r: 1, c: 41, rowspan: 2, label: 'Volts' },
                { r: 1, c: 42, rowspan: 2, label: 'Phase' },
                // Tier C
                { r: 2, c: 18, label: 'MIN' },
                { r: 2, c: 19, label: 'MAX' },
                { r: 2, c: 20, label: 'MIN' },
                { r: 2, c: 21, label: 'MAX' },
                { r: 2, c: 27, label: 'No.' },
                { r: 2, c: 28, label: 'HP' },
                { r: 2, c: 29, label: 'FLA' },
                { r: 2, c: 30, label: 'LRA' },
                { r: 2, c: 31, label: 'No.' },
                { r: 2, c: 32, label: 'FLA' },
                { r: 2, c: 33, label: 'No.' },
                { r: 2, c: 34, label: 'RLA' },
                { r: 2, c: 35, label: 'LRA' },
                { r: 2, c: 36, label: 'No.' },
                { r: 2, c: 37, label: 'LRA' },
                { r: 2, c: 38, label: 'RLA' }
            ],
            columns: [
                // UNIT TAG + AREA SERVED pre-fill from the item but stay
                // editable text boxes.
                { scope: 'item', editable: true, fieldKey: 'mswg_rtu_tag', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', editable: true, fieldKey: 'mswg_rtu_area', derive: function (g) { return s(g.item.serves); } },
                { scope: 'item', derive: function (g) { return g.cell('C'); } },
                // Native efficiency reads "16.7 IEER/11.8 EER" (or SEER2/
                // EER2): the number after the slash is the EER column, the
                // one before it is IEER/SEER.
                { scope: 'item', derive: function (g) { return effNum(g.cell('H'), 1); } },
                { scope: 'item', derive: function (g) { return effNum(g.cell('H'), 0); } },
                // AFUE: no data source yet
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', editable: true, fieldKey: 'mswg_rtu_oa_min' },
                { scope: 'item', editable: true, fieldKey: 'mswg_rtu_oa_max' },
                // --- Indoor fan motor ---
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', derive: function (g) { return g.cell('E'); } },
                // Fan quantity / HP / FLA: no data source yet (the firm
                // wants per-motor data, not the native unit-level HP)
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function (g) { return voltOnly(g.cell('AB')); } },
                { scope: 'item', derive: function (g) { return phaseOnly(g.cell('AB')); } },
                // --- Cooling performance ---
                { scope: 'item', derive: function (g) { return slash(g.cell('I'), g.cell('J')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('F')); } },
                { scope: 'item', derive: function (g) { return div1000(g.cell('G')); } },
                // --- Hot gas reheat + refrigerant charge: no data source yet
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                // --- Heating performance ---
                { scope: 'item', derive: function (g) { return g.cell('O'); } },
                { scope: 'item', derive: function (g) { return g.cell('M'); } },
                { scope: 'item', derive: function (g) { return g.cell('N'); } },
                // Temp rise: no data source yet
                { scope: 'item', derive: function () { return '-'; } },
                // --- Electrical data: condenser-fan / power-exhaust /
                // compressor breakdowns have no data source yet ---
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function () { return '-'; } },
                { scope: 'item', derive: function (g) { return g.cell('AD'); } },
                { scope: 'item', derive: function (g) { return g.cell('AE'); } },
                { scope: 'item', derive: function (g) { return voltOnly(g.cell('AB')); } },
                { scope: 'item', derive: function (g) { return phaseOnly(g.cell('AB')); } },
                // --- Model / weight / remarks ---
                { scope: 'item', derive: function (g) { return g.cell('B'); } },
                { scope: 'item', derive: function (g) { return g.cell('AF'); } },
                { scope: 'item', editable: true, fieldKey: 'mswg_rtu_remarks' }
            ],
            notesTitle: '',
            notes: [
                '1.  REFER TO APPROVED MANUFACTURER LIST FOR ACCEPTABLE EQUAL MANUFACTURERS.  FOR ALL SUBSTITUTIONS MECHANICAL CONTRACTOR SHALL COORDINATE POWER REQUIREMENTS WITH ELECTRICAL CONTRACTOR AND PHYSICAL DIMENSIONS WITH GENERAL CONTRACTOR PRIOR TO ORDERING.',
                '2.  SINGLE POINT ELECTRICAL CONNECTION.  DISCONNECT BY ELECTRICAL CONTRACTOR.',
                '3.  REFRIGERANT HOT GAS REHEAT AND R-32 REFRIGERANT.  PROVIDE WITH REFRIGERANT MONITORING FOR SYSTEMS WITH GREATER THAN 3.91 LBS OF REFRIGERANT.',
                '4.  MANUFACTURER FAN DATA BASED ON WET COIL AND CLEAN FILTERS. TSP = ESP + ECON HOOD PD.',
                '5.  MANUFACTURER COOLING DATA BASED ON 80F/67F ENTERING AIR AND 95F AMBIENT OUTDOOR TEMPERATURE.',
                '6.  MANUFACTURER REHEAT DATA BASED ON 75FDB/59FWB ENTERING AIR AND 70F AMBIENT OUTDOOR TEMPERATURE.',
                '7.  CONSTANT AIR VOLUME.',
                '8.  PROVIDE UNIT WITH WATER LEVEL MONITORING DEVICE IN CONDENSATE DRAIN PAN TO SHUT UNIT DOWN IN ACCORDANCE WITH 2018 NCMC SECTION 307.2.3.1 WATER LEVEL MONITORING DEVICE.',
                '9. PROVIDE A DUCT MOUNTED IONIZATION TYPE SMOKE DETECTOR IN RETURN DUCT FOR UNITS WITH GREATER THAN 2,000 CFM SUPPLY AIR.  UPON DETECTION OF SMOKE, THERE SHALL BE FIRE ALARM NOTIFICATION AND THE UNIT SHALL SHUT DOWN.',
                '    ELECTRICAL CONTRACTOR SHALL FURNISH DUCT MOUNTED SMOKE DETECTOR AND ANY OTHER APPURTENANCES NECESSARY FOR A COMPLETE INSTALLATION.  MECHANICAL CONTRACTOR SHALL INSTALL THE DUCT DETECTOR IN THE RETURN DUCT.',
                '9. PROVIDE A DUCT MOUNTED IONIZATION TYPE SMOKE DETECTOR IN RETURN DUCT FOR UNITS WITH GREATER THAN 2,000 CFM SUPPLY AIR.  UPON DETECTION OF SMOKE, THERE SHALL BE ACTIVATION OF AN AUDIO/VISUAL DEVICE AND THE UNIT SHALL SHUT DOWN.',
                '    MECHANICAL CONTRACTOR SHALL FURNISH DUCT MOUNTED SMOKE DETECTOR AND ANY OTHER APPURTENANCES NECESSARY FOR A COMPLETE INSTALLATION.  MECHANICAL CONTRACTOR SHALL INSTALL THE DUCT DETECTOR IN THE RETURN DUCT.',
                '10. OUTSIDE AIR INTAKE HOOD WITH MANUAL VOLUME DAMPER.  PER 2018 NCECC, ECONOMIZER IS NOT REQUIRED FOR SYSTEMS LESS THAN 65,000 BTUH.',
                '11. FOR CLIMATE ZONE 3B OR 4B, PROVIDE DRY BULB OUTSIDE AIR ECONOMIZER WITH TRAQ OUTSIDE AIR MEASUREMENT, WITH BAROMETRIC RELIEF AND/OR POWER EXHAUST.',
                '12. FOR CLIMATE ZONE 3A OR 4A, PROVIDE ENTHALPY BASED OUTSIDE AIR ECONOMIZER WITH BAROMETRIC RELIEF AND/OR POWER EXHAUST.',
                '13. UNIT SHALL BE ROOF MOUNTED WITH VERTICAL DISCHARGE.  PROVIDE MANUFACTURER\'S MINIMUM 14" HIGH CURB.',
                '14. UNIT SHALL BE HORIZONTAL DISCHARGE, UTILIZING A HORIZONTAL DISCHARGE CURB',
                '15.   2" THICK MERV 13 DISPOSABLE FILTERS.',
                "16. MANUFACTURER'S 7-DAY PROGRAMMABLE THERMIDISTAT FOR CONTROL OF HEATING/COOLING/DEHUMIDIFICATION CYCLES.",
                "17. PROVIDE MANUFACTURER'S UNIT CONTROLLER AND INTEGRATE IN TO BUILDING AUTOMATION SYSTEM, INCLUDING MAPPING AND GRAPHICS.  PROVIDE BACNET CARD.",
                "      PROVIDE MANUFACTURER'S TEMPERATURE AND HUMIDITY SENSOR.  UNIT CONTROLLER SHALL BE CAPABLE OF CONTROLLING HEATING, COOLING, DEHUMIDIFICATION, AND ECONOMIZER.",
                '18. PROVIDE DEMAND CONTROLLED VENTILATION, CARBON DIOXIDE BASED WITH FULLY MODULATING OUTSIDE AIR DAMPERS AND INTEGRAL CONTROLS LOGIC.',
                '18. DEMAND CONTROL VENTILATION IS NOT REQUIRED PER EXCEPTION 3 OF C403.2.6.1, SYSTEMS LESS THAN 1,200 CFM OF OUTSIDE AIR.',
                '19.  PROVIDE UNIT WITH UV LIGHTS, FIELD INSTALLED DOWNSTREAM OF COOLING COIL.',
                '20.  PROVIDE UNIT WITH BIPOLAR IONIZATION, FIELD INSTALLED DOWNSTREAM OF AIR FILTRATION.  REFER TO APPROVED MANUFACTURER LIST FOR ACCEPTABLE EQUAL MANUFACTURERS.  COORDINATE POWER REQUIREMENTS WITH ELECTRICAL CONTRACTOR.',
                '21. PROVIDE GAS REGULATOR FOR 2-PSI GAS SERVICE AND DISTRIBUTION.',
                '22.  COORDINATE WITH ELECTRICAL CONTRACTOR TO PROVIDE DUCT MOUNTED CARBON MONOXIDE DETECTOR IN EACH ROOFTOP UNIT SUPPLY DUCT AS REQUIRED TO MEET THE EXCEPTION TO 2018 NCMC, SECTION 313.4.1.3.',
                '       CARBON MONOXIDE DETECTOR SHALL BE WIRED TO FIRE ALARM FOR NOTIFICATION AND TO BAS FOR RTU SHUT DOWN.',
                '23. 5 YEAR BASE LIMITED WARRANTY ON COMPRESSOR AND 3 YEAR BASE LIMITED WARRANTY ON PARTS.'
            ],
            manufacturers: null
        };
    }

    // =================================================================
    // Crenshaw Consulting templates
    // Mapped from DATA/ENGINEER SCHEDULES/Crenshaw Consulting.xlsx, using
    // the user's matching Hoffman Cart exports as a value-by-value Rosetta
    // Stone. The firm keeps more than one layout for some products (tab
    // names "... - PRIVATE" / "... - MILITARY"); those register as
    // `styles` and the Schedule layout dropdown lists one entry per style.
    // Columns headed "(MBH)" show MBH (BTU/h / 1000). Notes are the firm's "1-" numbering.
    // =================================================================

    // "-" (native "doesn't apply") -> blank, as the firm's sheet leaves it.
    function blankDash(v) {
        var t = s(v);
        return t === '-' ? '' : t;
    }

    // "208-230/1" or "208/60/1" -> "208/1" (lower volts of a range, no Hz).
    function voltLow(v) {
        return voltPh(s(v).replace(/^(\d+)\s*-\s*\d+/, '$1'));
    }

    // Leading number with trailing zeros dropped ("12.20" -> "12.2"),
    // '' when there is none.
    function cleanNum(v) {
        var m = s(v).match(/-?\d+(?:\.\d+)?/);
        return m ? String(Number(m[0])) : '';
    }

    // Number of BTU/h -> MBH, '' / '-' passed through.
    function mbhNum(v) {
        var n = Number(v);
        if (s(v) === '' || !isFinite(n)) return s(v);
        return String(Math.round(n) / 1000);
    }

    // Firm notes: "1-" + text; text with hard line breaks continues on
    // indented rows (one notes row per line, like the Excel sheet).
    function crenshawNotes(list) {
        var out = [];
        list.forEach(function (text, i) {
            String(text).split('\n').forEach(function (line, j) {
                out.push(j === 0 ? (i + 1) + '-  ' + line.trim() : '      ' + line.trim());
            });
        });
        return out;
    }

    function crenshawRtuPrivate() {
        function isHp(g) { return /HEAT PUMP/i.test(g.filter('TYPE')) || /SEER/i.test(g.cell('H')); }
        // Efficiency "16.7 IEER/11.8 EER" (gas) or "16.4 SEER2/12.20 EER2"
        // (heat pump): the first part lands in IEER or SEER2 by its label.
        function effFirst(g, label) {
            var part = s(g.cell('H')).split('/')[0];
            return new RegExp(label, 'i').test(part) ? cleanNum(part) : '';
        }
        var labels = ['MARK', 'MANUFACTURER', 'NOMINAL\nTONNAGE', 'MODEL NO.', 'ARI COOLING\n(MBH)',
            'EER', 'IEER', 'SEER2', 'HEAT. INPUT\n(MBH)', 'HEAT. OUTPUT\n(MBH)', 'HEAT\nSTAGES', 'AFUE',
            'HEAT PUMP\nBTU/h (47°F, 70°F INDOOR DB)', 'HEAT PUMP\nBTU/h (17°F, 70°F INDOOR DB)',
            'HEAT PUMP\nBTU/h (70°F INDOOR DB)', 'S.A.\nCFM', 'MIN O.A.\nCFM', 'MAX O.A.\nCFM',
            'ESP\n(IN. H2O)', 'FAN\nHP', 'DRIVE', 'VOLT/PH', 'MCA', 'MOCP', 'WEIGHT\n(LBS)', 'REMARKS'];
        return {
            orientation: 'rows',
            title: 'PACKAGED ROOFTOP UNIT SCHEDULE',
            // Gas and heat pump columns side by side (see UNIT_TYPE_LIMITS).
            allUnitTypes: true,
            header: labels.map(function (label, c) { return { r: 0, c: c, label: label }; }),
            columns: [
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('A'); } },
                { scope: 'item', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', derive: function (g) { return g.cell('B'); } },
                { scope: 'item', derive: function (g) { return mbhNum(g.cell('F')); } },
                { scope: 'item', derive: function (g) { var n = effNum(g.cell('H'), 1); return n === '-' ? '' : String(Number(n)); } },
                { scope: 'item', derive: function (g) { return effFirst(g, 'IEER'); } },
                { scope: 'item', derive: function (g) { return effFirst(g, 'SEER'); } },
                { scope: 'item', derive: function (g) { return blankDash(g.cell('M')); } },
                { scope: 'item', derive: function (g) { return blankDash(g.cell('N')); } },
                { scope: 'item', derive: function (g) { return blankDash(g.cell('O')); } },
                // Daikin LC gas packs are 80% AFUE.
                { scope: 'item', derive: function (g) { return isHp(g) ? '' : '80%'; } },
                { scope: 'item', derive: function (g) { return blankDash(g.cell('R')); } },
                { scope: 'item', derive: function (g) { return blankDash(g.cell('S')); } },
                { scope: 'item', derive: function (g) { return blankDash(g.cell('T')); } },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_rtu_oa_min' },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_rtu_oa_max' },
                { scope: 'item', derive: function (g) { return g.cell('E'); } },
                { scope: 'item', derive: function (g) { return g.cell('AC'); } },
                { scope: 'item', derive: function () { return 'DIRECT'; } },
                { scope: 'item', derive: function (g) { return voltLow(g.cell('AB')); } },
                { scope: 'item', derive: function (g) { return g.cell('AD'); } },
                { scope: 'item', derive: function (g) { return g.cell('AE'); } },
                { scope: 'item', derive: function (g) { return g.cell('AF'); } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_rtu_remarks' }
            ],
            notesTitle: '',
            notes: crenshawNotes([
                'ARI COOLING CAPACITY BASED ON INDOOR ENTERING AIR CONDITION OF 80°F DRY BULB, 67°F WET BULB AND OUTDOOR AIR CONDITION OF 95°F DRY BULB',
                'UNIT TO BE CONFIGURED FOR 2 STAGE GAS HEAT. PROVIDE WITH GALVANIZED STEEL/STAINLESS STEEL HEAT EXCHANGER',
                'UNIT TO UTILIZE R-32 REFRIGERANT. UNIT TO BE PROVIDED WITH REFRIGERANT LEAK DETECTION SYSTEM.',
                'PROVIDE UNIT WITH MANUFACTURER\'S 14" EQUIPMENT CURB',
                'PROVIDE UNIT WITH ANTI-SHORT CYCLE TIMER, COIL GUARD, 100% OUTDOOR AIR ENTHALPY CONTROLLED, FULLY MODULATING ECONOMIZER',
                'UNIT TO BE PROVIDED WITH FULLY MODULATING HOT GAS REHEAT COIL FOR DEHUMIDIFICATION',
                'UNIT TO BE CONFIGURED FOR HORIZONTAL DISCHARGE',
                'UNIT TO BE SET UP FOR DEMAND CONTROLLED VENTILATION. DURING UNOCCUPIED PERIODS AND DURING WARMUP OR COOLDOWN, THE OUTSIDE AIR DAMPER\nSHALL BE CLOSED. DURING OCCUPIED HOURS, THE OUTSIDE AIR DAMPER SHALL OPEN TO THE MINIMUM OA POSITION. WHEN THE CO2 LEVEL IN THE SPACE\nRISES ABOVE SETPOINT, THE OUTSIDE AIR DAMPER SHALL MODULATE TO THE MAXIMUM OA POSITION. MINIMUM AND MAXIMUM OUTSIDE AIR POSITIONS SHALL\nBE SET BY THE TEST AND BALANCE CONTRACTOR DURING SYSTEM BALANCING.',
                'PROVIDE 7-DAY PROGRAMMABLE THERMOSTAT/HUMIDITY SENSOR WITH DIGITAL DISPLAY, OVERRIDE AND SETPOINT ADJUSTMENT. PROVIDE CO2 SENSOR.',
                'UNIT SHALL BE PROVIDED WITH RETURN AIR SMOKE DETECTOR AND SHALL BE SHUT DOWN UPON SIGNAL FROM FIRE ALARM SYSTEM. CONTROLS BY FIRE\nALARM CONTRACTOR. SMOKE DETECTOR SHALL BE FURNISHED AND WIRED BY FIRE ALARM CONTRACTOR. MECHANICAL CONTRACTOR SHALL INSTALL\nDETECTOR IN RETURN AIR DUCT.'
            ]),
            manufacturers: null
        };
    }

    // "MULTI POSITION SPLIT - PRIVATE": two schedules on one sheet - the air
    // handlers, then the heat pumps - built as stacked `tables` (export.js
    // buildStackedTemplateGrid). Each unit is one row in each table.
    function crenshawMultiSplitPrivate() {
        function hdr(labels) {
            return labels.map(function (label, c) { return { r: 0, c: c, label: label }; });
        }
        var ahu = {
            orientation: 'rows',
            title: 'SPLIT SYSTEM AIR HANDLING UNIT SCHEDULE',
            header: hdr(['MARK', 'MANUFACTURER', 'MODEL NO.', 'S.A.\nCFM', 'O.A.\nCFM', 'ESP\n(IN. H2O)',
                'FAN\nHP', 'ELEC. HEAT\n(KW)', 'HEAT\nSTAGES', 'VOLT/PH', 'MCA', 'MOCP', 'WEIGHT\n(LBS)', 'REMARKS']),
            columns: [
                { scope: 'item', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[0]); } },
                { scope: 'item', derive: function (g) { return g.cell('A'); } },
                { scope: 'item', derive: function (g) { return g.cell('B'); } },
                { scope: 'item', capacityField: 'airflow', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_mps_oa_cfm' },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_mps_esp' },
                { scope: 'item', derive: function (g) { return g.cell('D'); } },
                { scope: 'item', elecField: 'kw', derive: function (g) { return g.cell('N') || '0'; } },
                { scope: 'item', derive: function () { return '1'; } },
                { scope: 'item', elecField: 'voltage', derive: function (g) { return voltLow(g.cell('P')); } },
                { scope: 'item', derive: function (g) { return g.cell('Q'); } },
                { scope: 'item', derive: function (g) { return g.cell('R'); } },
                { scope: 'item', derive: function (g) { return g.cell('S'); } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_mps_ahu_remarks' }
            ],
            notesTitle: '',
            notes: crenshawNotes([
                'PROVIDE FAN COIL WITH FACTORY INSTALLED ELECTRIC HEATER, FILTER, DISCONNECT SWITCH AND SINGLE POINT WIRING CONNECTION.',
                'PROVIDE UNIT WITH DAIKIN 7-DAY PROGRAMMABLE THERMOSTAT. THERMOSTAT SHALL BE WIFI CAPABLE AND LOCKABLE.',
                'PROVIDE UNIT WITH AUXILIARY DRAIN PAN AND FLOAT SWITCH.',
                'PROVIDE WITH REFRIGERANT LEAK DETECTION SYSTEM.'
            ]),
            manufacturers: null
        };
        var hp = {
            orientation: 'rows',
            title: 'SPLIT SYSTEM HEAT PUMP SCHEDULE',
            header: hdr(['MARK', 'MANUFACTURER', 'NOMINAL\nTONNAGE', 'MODEL NO.', 'ARI COOLING\n(MBH)',
                'ARI HEATING\n(MBH)', 'SEER2', 'HSPF2', 'VOLT/PH', 'MCA', 'MOCP', 'WEIGHT\n(LBS)', 'REMARKS']),
            columns: [
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('T'); } },
                { scope: 'item', derive: function (g) { return g.filter('SIZE'); } },
                { scope: 'item', derive: function (g) { return g.cell('U'); } },
                { scope: 'item', derive: function (g) { return mbhNum(g.cell('J')); } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('W')) ? mbhNum(g.cell('W')) : '-'; } },
                { scope: 'item', derive: function (g) { return cleanNum(s(g.cell('AD')).split('/')[0]) || '-'; } },
                { scope: 'item', derive: function (g) { return cleanNum(g.cell('X')) || '-'; } },
                { scope: 'item', derive: function (g) { return voltLow(g.cell('Y')); } },
                { scope: 'item', derive: function (g) { return g.cell('Z'); } },
                { scope: 'item', derive: function (g) { return g.cell('AA'); } },
                { scope: 'item', derive: function (g) { return g.cell('AE'); } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_mps_hp_remarks' }
            ],
            notesTitle: '',
            notes: crenshawNotes([
                'COOLING CAPACITY BASED ON INDOOR ENTERING AIR CONDITION OF 80°F DRY BULB, 67°F WET BULB AND OUTDOOR AIR CONDITION OF 95°F DRY BULB.\nHEATING CAPACITY BASED ON INDOOR ENTERING AIR CONDITION OF 70°F DRY BULB AND OUTDOOR AIR CONDITION OF 47°F DRY BULB.',
                'STANDARD UNIT FEATURES SHALL INCLUDE FILTER DRIER, FRONT SEATING SERVICE VALVES, INTERNAL PRESSURE RELIEF VALVE, INTERNAL THERMAL OVERLOAD,\nSUCTION LINE ACCUMULATOR, HIGH PRESSURE SWITCH AND LOSS OF CHARGE SWITCH.',
                'ACCESSORY UNIT FEATURES SHALL INCLUDE: COMPRESSOR START ASSIST, CRANKCASE HEATER, THERMOSTATIC EXPANSION VALVE AND TIME DELAY RELAY.',
                'REFRIGERANT LINES SHALL BE SIZED SO THAT MAXIMUM CAPACITY LOSS DUE TO LINE LENGTH IS 3%. ALL PIPING SHALL BE HARD COPPER PIPE.'
            ]),
            manufacturers: null
        };
        return {
            orientation: 'rows',
            title: ahu.title,
            tables: [ahu, hp]
        };
    }

    function crenshawMultiSplitMilitary() {
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM AIR HANDLING UNIT SCHEDULE',
            header: [
                { r: 0, c: 0, colspan: 22, label: 'INDOOR UNIT' },
                { r: 0, c: 22, colspan: 5, label: 'OUTDOOR UNIT' },
                { r: 0, c: 27, rowspan: 5, label: 'REMARKS' },
                { r: 1, c: 0, rowspan: 4, label: 'MARK' },
                { r: 1, c: 1, rowspan: 4, label: 'DESCRIPTION' },
                { r: 1, c: 2, colspan: 3, label: 'MOTOR' },
                { r: 1, c: 5, colspan: 7, label: 'DX COIL' },
                { r: 1, c: 12, colspan: 2, label: 'HEAT PUMP HEATING' },
                { r: 1, c: 14, colspan: 2, label: 'AUX. ELECTRIC HEAT' },
                { r: 1, c: 16, colspan: 3, label: 'ELECTRICAL DATA' },
                { r: 1, c: 19, colspan: 2, label: 'FILTERS' },
                { r: 1, c: 21, rowspan: 4, label: 'WEIGHT\n(LBS)' },
                { r: 1, c: 22, rowspan: 4, label: 'MARK' },
                { r: 1, c: 23, colspan: 3, label: 'ELECTRICAL DATA' },
                { r: 1, c: 26, rowspan: 4, label: 'WEIGHT\n(LBS)' },
                { r: 2, c: 2, rowspan: 3, label: 'SUPPLY (CFM)' },
                { r: 2, c: 3, rowspan: 3, label: 'E.S.P. ("WC)' },
                { r: 2, c: 4, rowspan: 3, label: 'DRIVE' },
                { r: 2, c: 5, colspan: 7, label: 'COOLING' },
                { r: 2, c: 12, rowspan: 3, label: 'TTL CAP\n(MBH)' },
                { r: 2, c: 13, rowspan: 3, label: 'TEMP RISE\n(°F)' },
                { r: 2, c: 14, rowspan: 3, label: 'KW' },
                { r: 2, c: 15, rowspan: 3, label: 'TEMP RISE\n(°F)' },
                { r: 2, c: 16, rowspan: 3, label: 'V/PH' },
                { r: 2, c: 17, rowspan: 3, label: 'MCA' },
                { r: 2, c: 18, rowspan: 3, label: 'MOCP' },
                { r: 2, c: 19, rowspan: 3, label: 'EFFIC.' },
                { r: 2, c: 20, rowspan: 3, label: 'THICK. (IN)' },
                { r: 2, c: 23, rowspan: 3, label: 'V/PH' },
                { r: 2, c: 24, rowspan: 3, label: 'MCA' },
                { r: 2, c: 25, rowspan: 3, label: 'MOCP' },
                { r: 3, c: 5, rowspan: 2, label: 'TTL CAP\n(MBH)' },
                { r: 3, c: 6, rowspan: 2, label: 'SENS. CAP\n(MBH)' },
                { r: 3, c: 7, rowspan: 2, label: 'AMB. (°F)' },
                { r: 3, c: 8, rowspan: 2, label: 'EAT DB (°F)' },
                { r: 3, c: 9, rowspan: 2, label: 'EAT WB (°F)' },
                { r: 3, c: 10, rowspan: 2, label: 'LAT DB (°F)' },
                { r: 3, c: 11, rowspan: 2, label: 'LAT WB (°F)' }
            ],
            columns: [
                { scope: 'item', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[0]); } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_mps_mil_desc', derive: function () { return 'HORIZONTAL AHU'; } },
                { scope: 'item', capacityField: 'airflow', derive: function (g) { return g.cell('C'); } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_mps_mil_esp' },
                { scope: 'item', derive: function () { return 'DIRECT'; } },
                { scope: 'item', derive: function (g) { return mbhNum(g.cell('J')); } },
                { scope: 'item', derive: function (g) { return mbhNum(g.cell('K')); } },
                { scope: 'item', derive: function (g) { return g.cell('AB'); } },
                { scope: 'item', capacityField: 'eatDb', derive: function (g) { return g.cell('F'); } },
                { scope: 'item', capacityField: 'eatWb', derive: function (g) { return g.cell('G'); } },
                { scope: 'item', derive: function (g) { return g.cell('H'); } },
                { scope: 'item', derive: function (g) { return g.cell('I'); } },
                { scope: 'item', derive: function (g) { return isPositiveNum(g.cell('L')) ? mbhNum(g.cell('L')) : '-'; } },
                { scope: 'item', derive: function (g) { return g.cell('M') || '-'; } },
                { scope: 'item', elecField: 'kw', derive: function (g) { return isPositiveNum(g.cell('N')) ? g.cell('N') : '-'; } },
                { scope: 'item', derive: function (g) { return g.cell('O') || '-'; } },
                { scope: 'item', elecField: 'voltage', derive: function (g) { return voltLow(g.cell('P')); } },
                { scope: 'item', derive: function (g) { return g.cell('Q'); } },
                { scope: 'item', derive: function (g) { return g.cell('R'); } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_mps_mil_filter_eff' },
                { scope: 'item', derive: function () { return '2'; } },
                { scope: 'item', derive: function (g) { return g.cell('S'); } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cell('Y'); } },
                { scope: 'item', derive: function (g) { return g.cell('Z'); } },
                { scope: 'item', derive: function (g) { return g.cell('AA'); } },
                { scope: 'item', derive: function (g) { return g.cell('AE'); } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_mps_mil_remarks' }
            ],
            notesTitle: 'REMARKS:',
            notes: crenshawNotes([
                'PROVIDE WITH TXV VALVE AND ECM SUPPLY FAN MOTOR',
                'DISCHARGE CONDENSATE TO GRADE',
                'PROVIDE WITH SINGLE POINT ELECTRICAL CONNECTION TO AHU'
            ]),
            manufacturers: null
        };
    }

    // Mini splits: indoor fields per indoor head (scope 'row'), outdoor
    // fields once per system (scope 'item', row-spanned). Indoor units are
    // powered from the outdoor unit, so their electrical reads "-".
    function miniIsHp(g) {
        return !/COOLING ONLY/i.test(g.filter('COOLING ONLY OR HEAT PUMP'));
    }

    // Outdoor cooling capacity: the outdoor unit's available capacity on
    // multi-zone systems, else the (single) indoor head's capacity.
    function miniSystemCooling(g) {
        var avail = g.cellAt('T', 0);
        if (isPositiveNum(avail)) return avail;
        var total = 0;
        for (var i = 0; i < g.numRows; i++) {
            var n = Number(g.cellAt('F', i));
            if (isFinite(n)) total += n;
        }
        return total ? String(total) : g.cellAt('F', 0);
    }

    function crenshawMiniSplitPrivate() {
        var labels = ['MARK', 'MANUFACTURER', 'MODEL NO.', 'TYPE', 'SERVICE', 'VOLT/PH', 'MCA', 'MOCP', 'WEIGHT',
            'MARK', 'MODEL NO.', 'NOMINAL\nCOOLING', 'SEER2', 'MCA', 'MOCP', 'VOLT/PH', 'WEIGHT', 'REMARKS'];
        return {
            orientation: 'rows',
            title: 'SPLIT SYSTEM AIR CONDITIONING UNIT SCHEDULE',
            header: labels.map(function (label, c) { return { r: 0, c: c, label: label }; }),
            columns: [
                { scope: 'row', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[g.rowIndex]); } },
                { scope: 'row', derive: function (g) { return g.cell('P'); } },
                { scope: 'row', derive: function (g) { return g.cell('Q'); } },
                { scope: 'row', derive: function (g) { return miniIsHp(g) ? 'HEAT PUMP' : 'COOLING ONLY'; } },
                { scope: 'row', editable: true, fieldKey: 'crenshaw_min_service', derive: function (g) { return s(g.item.serves); } },
                { scope: 'row', derive: function () { return '-'; } },
                { scope: 'row', derive: function () { return '-'; } },
                { scope: 'row', derive: function () { return '-'; } },
                { scope: 'row', derive: function (g) { var w = g.cell('K'); return w ? w + ' LBS' : ''; } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.cellAt('AB', 0); } },
                { scope: 'item', derive: miniSystemCooling },
                { scope: 'item', derive: function (g) { return firstNumber(g.cellAt('W', 0)); } },
                { scope: 'item', derive: function (g) { return g.cellAt('Y', 0); } },
                { scope: 'item', derive: function (g) { return g.cellAt('Z', 0); } },
                { scope: 'item', derive: function (g) { return voltLow(g.cellAt('X', 0)); } },
                { scope: 'item', derive: function (g) { var w = g.cellAt('V', 0); return w ? w + ' LBS' : ''; } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_min_remarks' }
            ],
            notesTitle: '',
            notes: crenshawNotes([
                'PROVIDE UNIT WITH WALL MOUNTING BRACKET AND WALL MOUNTED THERMOSTAT',
                'PROVIDE UNIT WITH 208/230 VOLT CONDENSATE PUMP POWERED THROUGH AIR HANDLING UNIT.',
                'INDOOR UNIT SHALL BE POWERED FROM OUTDOOR UNIT. ALL POWER WIRING BY ELECTRICAL CONTRACTOR'
            ]),
            manufacturers: null
        };
    }

    function crenshawMiniSplitMilitary() {
        return {
            orientation: 'rows',
            title: 'DUCTLESS SPLIT SYSTEM SCHEDULE',
            header: [
                { r: 0, c: 0, colspan: 11, label: 'INDOOR UNIT' },
                { r: 0, c: 11, colspan: 10, label: 'OUTDOOR UNIT' },
                { r: 1, c: 0, rowspan: 3, label: 'MARK' },
                { r: 1, c: 1, rowspan: 3, label: 'SERVES' },
                { r: 1, c: 2, rowspan: 3, colspan: 2, label: 'TYPE' },
                { r: 1, c: 4, rowspan: 2, label: 'AIRFLOW' },
                { r: 3, c: 4, label: 'CFM' },
                { r: 1, c: 5, colspan: 2, label: 'COOLING CAPACITY' },
                { r: 2, c: 5, label: 'TOTAL' },
                { r: 2, c: 6, label: 'SENSIBLE' },
                { r: 3, c: 5, label: '(MBH @ 95°F)' },
                { r: 3, c: 6, label: '(MBH @ 95°F)' },
                { r: 1, c: 7, rowspan: 3, label: 'SHR' },
                { r: 1, c: 8, label: 'HEATING' },
                { r: 2, c: 8, label: 'CAPACITY' },
                { r: 3, c: 8, label: '(MBH @ 17°F)' },
                { r: 1, c: 9, label: 'HEATING' },
                { r: 2, c: 9, label: 'CAPACITY' },
                { r: 3, c: 9, label: '(MBH @ 47°F)' },
                { r: 1, c: 10, rowspan: 3, label: 'WEIGHT\n(LBS)' },
                { r: 1, c: 11, rowspan: 3, label: 'MARK' },
                { r: 1, c: 12, rowspan: 3, label: 'NOMINAL\nTONS' },
                { r: 1, c: 13, rowspan: 3, label: 'SEER2' },
                { r: 1, c: 14, rowspan: 3, label: 'EER2' },
                { r: 1, c: 15, rowspan: 3, label: 'VOLT/PH' },
                { r: 1, c: 16, rowspan: 3, label: 'MCA' },
                { r: 1, c: 17, rowspan: 3, label: 'MOCP' },
                { r: 1, c: 18, rowspan: 3, label: 'WEIGHT\n(LBS)' },
                { r: 1, c: 19, rowspan: 3, label: 'MAX PIPING\n(FT.)' },
                { r: 1, c: 20, rowspan: 3, label: 'REMARKS' }
            ],
            columns: [
                { scope: 'row', derive: function (g) { return s(g.item.indoorTags && g.item.indoorTags[g.rowIndex]); } },
                { scope: 'row', editable: true, fieldKey: 'crenshaw_min_mil_serves', derive: function (g) { return s(g.item.serves); } },
                { scope: 'row', derive: function (g) { return miniIsHp(g) ? 'HP' : 'AC'; } },
                { scope: 'row', derive: function (g) { return s(g.cell('L')).toUpperCase(); } },
                { scope: 'row', derive: function (g) { return g.cell('A'); } },
                { scope: 'row', derive: function (g) { return mbhNum(g.cell('F')); } },
                { scope: 'row', derive: function (g) { return mbhNum(g.cell('G')); } },
                // Sensible heat ratio, worked out from the two capacities.
                { scope: 'row', derive: function (g) {
                    var t = Number(g.cell('F')), sn = Number(g.cell('G'));
                    return (t > 0 && sn > 0) ? (sn / t).toFixed(2) : '-';
                } },
                // 17°F heating capacity: no data source - typed per unit.
                { scope: 'row', editable: true, fieldKey: 'crenshaw_min_mil_heat17',
                  derive: function (g) { return miniIsHp(g) ? '' : '-'; } },
                { scope: 'row', derive: function (g) { return isPositiveNum(g.cell('J')) ? mbhNum(g.cell('J')) : '-'; } },
                { scope: 'row', derive: function (g) { return g.cell('K'); } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return g.filter('SIZE (OUTDOOR UNIT)'); } },
                { scope: 'item', derive: function (g) { return cleanNum(s(g.cellAt('W', 0)).split('/')[0]) || '-'; } },
                { scope: 'item', derive: function (g) { return cleanNum(s(g.cellAt('W', 0)).split('/')[1]) || '-'; } },
                { scope: 'item', derive: function (g) { return voltLow(g.cellAt('X', 0)); } },
                { scope: 'item', derive: function (g) { return g.cellAt('Y', 0); } },
                { scope: 'item', derive: function (g) { return g.cellAt('Z', 0); } },
                { scope: 'item', derive: function (g) { return g.cellAt('V', 0); } },
                // "66' Vertical / 99' Total" -> 66 (the firm's sheet lists the vertical limit)
                { scope: 'item', derive: function (g) { return cleanNum(g.cellAt('AD', 0)) || '-'; } },
                { scope: 'item', editable: true, fieldKey: 'crenshaw_min_mil_remarks' }
            ],
            notesTitle: 'REMARKS',
            notes: crenshawNotes([
                'PROVIDE UNIT WITH WIRED WALL MOUNTED THERMOSTAT AND CONTROLLER WITH BACNET MS/TP COMPATIBLE INTERFACE AND CLEANABLE TYPE FILTERS.',
                "PROVIDE UNIT WITH WALL MOUNTED CONDENSATE PUMP, WIRED TO MOTOR RATED SWITCH, CAPABLE OF 10 GPH AT 20' HEAD, 1/ HP, /,  FLA.",
                'INDOOR AIR HANDLING UNIT IS POWERED FROM OUTDOOR CONDENSING UNIT.',
                'PROVIDE ALL ACCESSORIES REQUIRED FOR LOW AMBIENT OPERATION TO 0°F. PROVIDE COIL GUARDS AND 3,000 SALT-HOUR SEACOAST CONSTRUCTION. COATINGS MUST NOT REDUCE UNIT PERFORMANCE.',
                'COOLING CAPACITY IS CALCULATED AT AN INDOOR DESIGN TEMPERATURE OF 80°F DB AND 67°F WB. HEATING CAPACITY (IF APPLICABLE) IS CALCULATED AT AN INDOOR DESIGN TEMPERATURE OF 60°F DB.',
                'COOLING CAPACITY IS CALCULATED AT AN INDOOR DESIGN TEMPERATURE OF 72°F DB AND RELATIVE HUMIDITY OF 50%.'
            ]),
            manufacturers: null
        };
    }

    // engineerKey -> productKey -> factory (returns a fresh template), or
    // -> { styles: [{ key, label, factory }] } when the firm keeps more than
    // one layout for that product (first style is the default).
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
            mini_splits: saberMiniSplit,
            gas_packs: saberRtu
        },
        mswg: {
            multi_position_splits: mswgMultiSplit,
            mini_splits: mswgMiniSplit,
            gas_packs: mswgRtu
        },
        crenshaw: {
            gas_packs: crenshawRtuPrivate,
            multi_position_splits: { styles: [
                { key: 'private', label: 'Private', factory: crenshawMultiSplitPrivate },
                { key: 'military', label: 'Military', factory: crenshawMultiSplitMilitary }
            ] },
            mini_splits: { styles: [
                { key: 'private', label: 'Private', factory: crenshawMiniSplitPrivate },
                { key: 'military', label: 'Military', factory: crenshawMiniSplitMilitary }
            ] }
        }
    };

    // Styles a firm keeps for one product ([] when it has a single layout).
    function stylesFor(engineerKey, productKey) {
        var entry = (REGISTRY[engineerKey] || {})[productKey];
        return (entry && entry.styles) ? entry.styles : [];
    }

    // The project's chosen style for (firm, product), stored in the
    // product's project extra as templateStyle[engineerKey]; defaults to
    // the firm's first style.
    function chosenStyle(engineerKey, productKey) {
        var styles = stylesFor(engineerKey, productKey);
        if (!styles.length) return null;
        var extra = (HHpro.Cart && HHpro.Cart.getProjectExtra)
            ? HHpro.Cart.getProjectExtra(productKey) : {};
        var key = extra && extra.templateStyle && extra.templateStyle[engineerKey];
        for (var i = 0; i < styles.length; i++) {
            if (styles[i].key === key) return styles[i];
        }
        return styles[0];
    }

    // Firm layouts that only fit some of a product's units. The Light
    // Commercial RTU schedule (gas_packs) mixes gas packs and heat pumps,
    // but most firms' RTU layouts above are gas-heat only. Such a layout
    // applies only while EVERY unit on that schedule is a gas pack; a single
    // heat pump drops the schedule to the standard (Hoffman) layout. A
    // template flagged `allUnitTypes` (Barrett Woodyard, which has heat pump
    // columns) skips this check. `fromLabel` classifies a cart item
    // before the product JSON has loaded - its label always carries the
    // model number, and Daikin's third letter is G for gas, H for heat pump.
    var UNIT_TYPE_LIMITS = {
        gas_packs: {
            filter: 'TYPE',
            only: 'GAS',
            fromLabel: function (label) {
                return /\bD[A-Z]G\d{3}/i.test(String(label || '')) ? 'GAS' : 'HEAT PUMP';
            }
        }
    };

    function itemUnitType(item, data, limit) {
        var sels = (data && data.selections) || [];
        for (var i = 0; i < sels.length; i++) {
            if (sels[i].id !== item.selectionId) continue;
            var fd = (sels[i].rows && sels[i].rows[0] && sels[i].rows[0].filterData) || {};
            if (fd[limit.filter] != null) return String(fd[limit.filter]).trim().toUpperCase();
            break;
        }
        return limit.fromLabel(item.label);
    }

    // True when every unit on the active project's schedule for this
    // product suits the firm layouts (always true for unrestricted
    // products and for an empty schedule).
    function unitsFitTemplates(productKey) {
        var limit = UNIT_TYPE_LIMITS[productKey];
        if (!limit) return true;
        var st = (HHpro.Cart && HHpro.Cart.getActiveState) ? HHpro.Cart.getActiveState() : null;
        var data = (HHpro.Data && HHpro.Data.getLoadedProduct)
            ? HHpro.Data.getLoadedProduct(productKey) : null;
        return ((st && st.items) || []).every(function (item) {
            return item.productKey !== productKey ||
                itemUnitType(item, data, limit) === limit.only;
        });
    }

    var ENGINEERS = [
        { key: 'hoffman', label: 'Hoffman & Hoffman' },
        { key: 'refresco', label: 'Refresco' },
        { key: 'barrett_woodyard', label: 'Barrett Woodyard & Associates' },
        { key: 'allied', label: 'Allied' },
        { key: 'saber', label: 'Saber' },
        { key: 'mswg', label: 'MSWG' },
        { key: 'crenshaw', label: 'Crenshaw Consulting' }
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
         * null when the current login isn't allowed this engineer, or when
         * the project's units for this product don't suit the firm's
         * layout (UNIT_TYPE_LIMITS - e.g. a heat pump on the RTU schedule).
         */
        getTemplate: function (engineerKey, productKey) {
            if (!isAllowed(engineerKey)) return null;
            var byProduct = REGISTRY[engineerKey || 'hoffman'];
            if (!byProduct) return null;
            var factory = byProduct[productKey];
            if (!factory) return null;
            if (factory.styles) factory = chosenStyle(engineerKey, productKey).factory;
            var tpl = factory();
            if (!tpl.allUnitTypes && !unitsFitTemplates(productKey)) return null;
            return tpl;
        },

        /**
         * The layouts a firm keeps for one product, as [{ key, label }]
         * ([] when it has just one). The Schedule layout dropdown lists
         * one entry per style ("Crenshaw Consulting - Military").
         */
        listStyles: function (engineerKey, productKey) {
            return stylesFor(engineerKey, productKey).map(function (st) {
                return { key: st.key, label: st.label };
            });
        },

        /** Current style key for (firm, product), or null. */
        getStyle: function (engineerKey, productKey) {
            var st = chosenStyle(engineerKey, productKey);
            return st ? st.key : null;
        },

        /** Save the project's style for (firm, product). */
        setStyle: function (engineerKey, productKey, styleKey) {
            if (!stylesFor(engineerKey, productKey).length) return;
            if (!(HHpro.Cart && HHpro.Cart.getProjectExtra && HHpro.Cart.setProjectExtra)) return;
            var map = (HHpro.Cart.getProjectExtra(productKey) || {}).templateStyle || {};
            if (map[engineerKey] === styleKey) return;
            map[engineerKey] = styleKey;
            HHpro.Cart.setProjectExtra(productKey, { templateStyle: map });
        },

        /**
         * Key the "Edit Schedule" cell overrides are filed under: the firm,
         * plus ":style" for a firm with several layouts (each style is a
         * different grid, so their hand edits must not mix). Single-layout
         * firms keep the plain firm key, as before.
         */
        layoutKey: function (engineerKey, productKey) {
            var st = chosenStyle(engineerKey, productKey);
            return st && st !== stylesFor(engineerKey, productKey)[0]
                ? engineerKey + ':' + st.key : engineerKey;
        }
    };
})();
