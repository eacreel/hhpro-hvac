/* ============================================================
   HHpro - Display formatting shared by every schedule
   ------------------------------------------------------------
   HHpro.Format.number(v)
       A number of 1,000 or more gets thousands separators
       (11200 -> "11,200", 1385.5 -> "1,385.5"). Anything else -
       small numbers, text, "208/60/1", "-" - comes back as text,
       unchanged. Every schedule number of 1,000+ is a measurement
       (CFM, BTU/h, FPM, lbs), never a model or part number.

   HHpro.Format.setCellText(td, text)
       Sets a schedule cell's text and marks a lone "-" (no value
       for this unit) with .cell-dash, which mutes it so the real
       values stand out. Use it for every repaint too, so a cell
       that changes from "-" to a value loses the muting.

   Exports: the native Excel / PDF / CAD schedules show the same
   separators (Excel keeps them real numbers with a #,##0 format).
   Firm template layouts read raw values - their own math (e.g.
   BTU/h / 1000 for MBH) needs plain numbers.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var NUMERIC_TEXT = /^-?\d+(\.\d+)?$/;

    function number(v) {
        if (v === null || v === undefined) return '';
        var n = (typeof v === 'number') ? v
            : (typeof v === 'string' && NUMERIC_TEXT.test(v.trim())) ? Number(v) : NaN;
        if (!isFinite(n) || Math.abs(n) < 1000) return String(v);
        return n.toLocaleString('en-US', { maximumFractionDigits: 6 });
    }

    function isDash(text) {
        var t = String(text == null ? '' : text).trim();
        return t === '-' || t === '—' || t === '–';
    }

    function setCellText(td, text) {
        if (!td) return;
        td.textContent = (text === null || text === undefined) ? '' : String(text);
        td.classList.toggle('cell-dash', isDash(td.textContent));
    }

    // Display capitalization for labels that arrive ALL CAPS from the
    // workbooks (filter names, schedule titles, document types):
    // "SIZE (INDOOR UNIT #1)" -> "Size (Indoor Unit #1)",
    // "COOLING ONLY OR HEAT PUMP" -> "Cooling Only or Heat Pump",
    // "AFUE (%)" stays. Text that already has lowercase letters is left
    // as written. Schedule table headers keep their caps on purpose.
    var ACRONYMS = toSet('AC AFUE AHRI AHU AHUS ASHRAE BAS BTU BTUH CAD CFM COP DB DC DOAS DX EAT ECM ' +
        'EDB EER EER2 ERV ESP ETL EWB FLA FPM GPM GPS HGRH HP HRV HSPF HSPF2 HVAC ID IDU IEER IOM ' +
        'IWG KW LAT LC LDB LRA LWB MBH MCA MERV MOCP MOP MZVAV NEMA OA ODU PDF PSC PSI RAC RLA RPM ' +
        'RTU RTUS SDV SEER SEER2 TESP UL USB VAV VFD VFDS WB WSHP XLSX ZIP');
    var SMALL_WORDS = toSet('A AN AND AS AT BY FOR IN OF ON OR PER THE TO VS WITH');

    function toSet(words) {
        var o = {};
        words.split(/\s+/).forEach(function (w) { if (w) o[w] = true; });
        return o;
    }

    function label(text) {
        var s = String(text == null ? '' : text);
        if (/[a-z]/.test(s)) return s;
        var firstAt = s.search(/[A-Z]/);
        return s.replace(/[A-Z][A-Z0-9]*/g, function (word, at) {
            if (ACRONYMS[word] || word.length === 1) return word;
            if (SMALL_WORDS[word] && at !== firstAt) return word.toLowerCase();
            return word.charAt(0) + word.slice(1).toLowerCase();
        });
    }

    HHpro.Format = {
        number: number,
        isDash: isDash,
        setCellText: setCellText,
        label: label
    };
})();
