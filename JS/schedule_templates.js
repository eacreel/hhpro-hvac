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
                { scope: 'item', derive: function (g) { return s(g.item.serves); } },
                { scope: 'row', derive: function (g) { return g.cell('A'); } },
                { scope: 'row', editable: true, fieldKey: 'refresco_ms_min_oa_cfm' },
                { scope: 'row', derive: function (g) { return g.cell('D'); } },
                { scope: 'row', derive: function (g) { return g.cell('B'); } },
                { scope: 'row', derive: function (g) { return g.cell('C'); } },
                { scope: 'row', derive: function (g) { return g.cell('G'); } },
                { scope: 'row', derive: function (g) { return g.cell('P'); } },
                { scope: 'item', derive: function (g) { return firstNumber(g.cell('R')); } },
                // Indoor units are powered from the outdoor single-point
                // feed, so the indoor electrical reported here is that
                // feed's voltage / MCA / MOP (HHpro cols S/T/U).
                { scope: 'item', derive: function (g) { return voltPh(g.cell('S')); } },
                { scope: 'item', derive: function (g) { return slash(g.cell('T'), g.cell('U')); } },
                { scope: 'item', derive: function (g) { return s(g.item.tag); } },
                { scope: 'item', derive: function (g) { return combine(g.cell('V'), g.cell('W')); } },
                { scope: 'item', derive: function (g) { return g.cell('Q'); } },
                { scope: 'item', derive: function (g) { return voltPh(g.cell('S')); } },
                { scope: 'item', editable: true, fieldKey: 'refresco_ms_single_point_mca_mop' }
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
                { band: 'top', label: 'WEIGHT:', editable: true, fieldKey: 'refresco_rtu_weight' },

                { band: 'main', label: 'NOTES', editable: true, fieldKey: 'refresco_rtu_notes' },
                { band: 'main', label: 'SUPPLY  CFM', derive: function (g) { return g.cell('D'); } },
                { band: 'main', label: 'SUPPLY FAN HP', derive: function (g) { return g.cell('U'); } },
                { band: 'main', label: 'EXTERNAL  STATIC  PRESSURE  (IN.  OF WATER)', derive: function (g) { return g.cell('E'); } },
                { band: 'main', label: 'NOMINAL  CAPACITY  (TONS)', derive: function (g) { return g.cell('C'); } },
                { band: 'main', label: 'GROSS  TOT COOLING  CAP.  (BTU/h)', derive: function (g) { return g.cell('G'); } },
                { band: 'main', label: 'EFFICIENCY', derive: function (g) { return g.cell('I'); } },
                { band: 'main', label: 'COOLING STAGES', derive: function (g) { return g.cell('S'); } },
                { band: 'main', label: 'INPUT HEATING  CAP.  (MBH)  -  NAT.  GAS', derive: function (g) { return g.cell('N'); } },
                { band: 'main', label: 'OUTPUT HEATING  CAP.  (MBH)', derive: function (g) { return g.cell('O'); } },
                { band: 'main', label: 'HEATING  STAGES', editable: true, fieldKey: 'refresco_rtu_heating_stages' },
                { band: 'main', label: 'VOLTAGE/PHASE', derive: function (g) { return g.cell('T'); } },
                { band: 'main', label: 'SINGLE  POINT ELEC.  CONN.   MCA(A)/MOP(A)', derive: function (g) { return slash(g.cell('V'), g.cell('W')); } },
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

    // engineerKey -> productKey -> factory (returns a fresh template).
    var REGISTRY = {
        hoffman: {},   // empty - native layout for every product
        refresco: {
            mini_splits: refrescoMiniSplit,
            gas_packs: refrescoRtu
        }
    };

    var ENGINEERS = [
        { key: 'hoffman', label: 'Hoffman & Hoffman' },
        { key: 'refresco', label: 'Refresco' }
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
