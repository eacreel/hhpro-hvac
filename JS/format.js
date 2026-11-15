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

    HHpro.Format = {
        number: number,
        isDash: isDash,
        setCellText: setCellText
    };
})();
