/* ============================================================
   HHpro - Psychrometric report: definitions and calculations
   ------------------------------------------------------------
   Builds the closing page(s) of the psychrometric PDF: what each
   item on the report means and the formula behind it, worked with
   this calculation's own numbers. Only the parts of the report
   that exist (mixing, energy recovery, each stage, the space
   checks) get a section.

     HHpro.PsychroAppendix.build(res, state)
       -> { title, intro: [..], sections: [{ title, items: [
              { term, text, lines: [[formula, work], ...] } ] }] }

   `res` is psychrometrics.js evaluate() output, `state` the
   calculator state. The formulas are the ones psychro_core.js and
   PsychroLib actually use. Worked values are IP, the basis every
   calculation runs in (an SI report converts only for display).
   psychro_pdf.js lays the result out.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var HFG = 1076;          // Btu per lb of water vapor (latent check)
    var GR = 7000;           // grains per lb
    var BTUH_PER_HP = 2545;
    var LB_PER_GAL = 8.345;
    var INHG_PER_PSI = 2.036021;

    function n(v, d) {
        if (v === null || v === undefined || !isFinite(v)) return '-';
        return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    }
    function T(v) { return n(v, 1); }     // degF
    function H(v) { return n(v, 2); }     // Btu/lb
    function Wr(v) { return n(v, 5); }    // lb/lb
    function V(v) { return n(v, 3); }     // ft3/lb
    function I(v) { return n(v, 0); }     // CFM, lb/hr, Btu/h
    function cp(w) { return 0.240 + 0.444 * w; }
    function pct(f) { return n(f * 100, 1) + ' %'; }

    function item(term, text, lines) {
        return { term: term, text: text || '', lines: lines || [] };
    }

    // "m = CFM x 60 / v" (actual air) or "4.5 x CFM" (standard air).
    function massExpr(cfm, st, basis) {
        return basis === 'actual' ? I(cfm) + ' × 60 ÷ ' + V(st.v) : '4.5 × ' + I(cfm);
    }

    function build(res, s) {
        if (!res || !s) return null;
        var a = s.ahu || {};
        var basis = a.basis === 'std' ? 'std' : 'actual';
        var P = res.pressure;
        var sections = [];

        // ---------------- Basis ----------------
        var basisItems = [];
        if (isFinite(P)) {
            basisItems.push(item('Barometric pressure',
                'Standard-atmosphere pressure at the project altitude. Every property on this report is computed at this pressure.',
                [['P = 14.696 × (1 − 6.8754E-6 × altitude ft)^5.2559',
                  '= 14.696 × (1 − 6.8754E-6 × ' + I(Number(s.altitude) || 0) + ')^5.2559 = ' + n(P, 3) +
                  ' psia (' + n(P * INHG_PER_PSI, 2) + ' in Hg)']]));
        }
        if (res.kind !== 'points') {
            basisItems.push(item('Dry-air mass flow',
                basis === 'actual'
                    ? 'Pounds of dry air per hour. Actual-air basis: each airflow is converted at the specific volume of its own air, so altitude and temperature count.'
                    : 'Pounds of dry air per hour. Standard-air basis: 0.075 lb/ft³ for every airflow (the 4.5 and 1.08 rules of thumb), regardless of altitude.',
                [[basis === 'actual' ? 'm (lb/hr) = CFM × 60 ÷ v' : 'm (lb/hr) = CFM × 60 × 0.075 = 4.5 × CFM']]));
            basisItems.push(item('Sign convention',
                'Cooling and dehumidifying loads are reported as heat or moisture removed from the air; heating and humidifying stages report what is added.'));
        }
        if (basisItems.length) sections.push({ title: 'Basis', items: basisItems });

        // ---------------- Air properties ----------------
        var pts = res.tablePoints || [];
        if (pts.length) {
            var p0 = pts[0], st = p0.state, lib = window.psychrolib;
            var pws = null, wsWb = null;
            try { pws = lib.GetSatVapPres(st.db); } catch (e) { /* leave blank */ }
            try { wsWb = lib.GetSatHumRatio(st.wb, P); } catch (e) { /* leave blank */ }
            var iceWb = st.wb < 32;
            var wbForm = iceWb
                ? 'W = [(1220 − 0.04 × WB) × Ws(WB) − 0.240 × (DB − WB)] ÷ (1220 + 0.444 × DB − 0.48 × WB)'
                : 'W = [(1093 − 0.556 × WB) × Ws(WB) − 0.240 × (DB − WB)] ÷ (1093 + 0.444 × DB − WB)';
            var wbWork = iceWb
                ? '= [(1220 − 0.04 × ' + T(st.wb) + ') × ' + Wr(wsWb) + ' − 0.240 × (' + T(st.db) + ' − ' + T(st.wb) + ')] ÷ (1220 + 0.444 × ' +
                  T(st.db) + ' − 0.48 × ' + T(st.wb) + ') = ' + Wr(st.w)
                : '= [(1093 − 0.556 × ' + T(st.wb) + ') × ' + Wr(wsWb) + ' − 0.240 × (' + T(st.db) + ' − ' + T(st.wb) + ')] ÷ (1093 + 0.444 × ' +
                  T(st.db) + ' − ' + T(st.wb) + ') = ' + Wr(st.w);
            var T_R = st.db + 459.67;
            var props = [
                item('CFM', 'Airflow through the point: the outdoor or return stream up to mixing, then the whole supply airflow through the unit.'),
                item('DB (dry bulb)', 'Air temperature as an ordinary thermometer reads it.'),
                item('W (humidity ratio)', 'Pounds of water vapor carried by each pound of dry air. Grains per pound = W × 7,000.',
                    [['W = 0.621945 × pw ÷ (P − pw)',
                      '= 0.621945 × ' + n(st.pv, 4) + ' ÷ (' + n(P, 3) + ' − ' + n(st.pv, 4) + ') = ' + Wr(st.w) + ' lb/lb = ' + n(st.grains, 1) + ' gr/lb']]),
                item('Vapor pressure (pw)', 'Partial pressure of the water vapor in the air.',
                    [['pw = P × W ÷ (0.621945 + W)', '= ' + n(P, 3) + ' × ' + Wr(st.w) + ' ÷ (0.621945 + ' + Wr(st.w) + ') = ' + n(st.pv, 4) + ' psia']]),
                item('RH (relative humidity)', 'Vapor pressure as a percentage of the saturation vapor pressure pws at the same dry bulb (pws from the ASHRAE Hyland-Wexler saturation equations).',
                    [['RH = pw ÷ pws(DB) × 100', '= ' + n(st.pv, 4) + ' ÷ ' + n(pws, 4) + ' × 100 = ' + n(st.rh * 100, 1) + ' %']]),
                item('DP (dew point)', 'Temperature at which the air\'s moisture starts to condense: the temperature whose saturation vapor pressure equals pw (solved numerically).',
                    [['pws(DP) = pw', 'pws(' + T(st.dp) + ' °F) = ' + n(st.pv, 4) + ' psia']]),
                item('WB (wet bulb)', 'Thermodynamic wet bulb: the temperature at which evaporating water saturates the air adiabatically. Solved numerically from the relation below, where Ws(WB) is the saturation humidity ratio at WB' +
                    (iceWb ? ' (ice form, WB below 32 °F).' : '.'),
                    [[wbForm, wbWork]]),
                item('h (enthalpy)', 'Heat content per pound of dry air, sensible plus latent, referenced to 0 °F dry air.',
                    [['h = 0.240 × DB + W × (1061 + 0.444 × DB)',
                      '= 0.240 × ' + T(st.db) + ' + ' + Wr(st.w) + ' × (1061 + 0.444 × ' + T(st.db) + ') = ' + H(st.h) + ' Btu/lb']]),
                item('v (specific volume)', 'Cubic feet of moist air per pound of dry air.',
                    [['v = 0.370486 × (DB + 459.67) × (1 + 1.607858 × W) ÷ P',
                      '= 0.370486 × ' + n(T_R, 2) + ' × ' + n(1 + 1.607858 * st.w, 5) + ' ÷ ' + n(P, 3) + ' = ' + V(st.v) + ' ft³/lb']]),
                item('Density', 'Pounds of moist air (dry air plus its water vapor) per cubic foot.',
                    [['density = (1 + W) ÷ v', '= ' + n(1 + st.w, 5) + ' ÷ ' + V(st.v) + ' = ' + n(st.density, 4) + ' lb/ft³']])
            ];
            sections.push({ title: 'Air properties', note: 'Worked for ' + p0.label + ', the first point in the table; every point uses the same relations.', items: props });
        }

        if (res.kind === 'points') return finish(sections, s);

        // ---------------- Mixing / airflow ----------------
        var mx = res.mixed;
        var m = mx ? mx.massFlow : 0;
        if (mx && mx.streams && mx.streams.length) {
            var ss = mx.streams;
            var mixItems = [];
            if (ss.length === 1) {
                mixItems.push(item('Dry-air mass flow', 'The airflow converted to pounds of dry air per hour at the ' + ss[0].label + ' condition; every stage below uses this mass flow.',
                    [['m = ' + (basis === 'actual' ? 'CFM × 60 ÷ v' : '4.5 × CFM'), '= ' + massExpr(ss[0].cfm, ss[0].state, basis) + ' = ' + I(m) + ' lb/hr']]));
            } else {
                mixItems.push(item('Total airflow', 'Sum of the entering streams.',
                    [['CFM = ' + ss.map(function (x) { return 'CFM ' + x.label; }).join(' + '),
                      '= ' + ss.map(function (x) { return I(x.cfm); }).join(' + ') + ' = ' + I(mx.cfm) + ' CFM']]));
                mixItems.push(item('Dry-air mass flow', 'Each stream converted to pounds of dry air per hour, then added; every stage below uses this total.',
                    [['m = ' + ss.map(function (x) { return 'm ' + x.label; }).join(' + '),
                      '= ' + ss.map(function (x) { return massExpr(x.cfm, x.state, basis); }).join(' + ') + ' = ' +
                      ss.map(function (x) { return I(x.mass); }).join(' + ') + ' = ' + I(m) + ' lb/hr']]));
                var o = ss[0];
                if (mx.oaCfm) {
                    mixItems.push(item('Outdoor air (by volume)', 'Share of the total airflow that is outdoor air.',
                        [['OA % = CFM ' + o.label + ' ÷ CFM × 100', '= ' + I(mx.oaCfm) + ' ÷ ' + I(mx.cfm) + ' × 100 = ' + n(mx.oaPctVolume, 1) + ' %']]));
                    mixItems.push(item('Outdoor air (by mass)', 'Share of the dry-air mass flow that is outdoor air; this is the fraction the mixing uses.',
                        [['OA % = m ' + o.label + ' ÷ m × 100', '= ' + I(o.mass) + ' ÷ ' + I(m) + ' × 100 = ' + n(mx.oaPctMass, 1) + ' %']]));
                }
                var msum = function (key, fmtv) {
                    return '(' + ss.map(function (x) { return I(x.mass) + ' × ' + fmtv(x.state[key]); }).join(' + ') + ') ÷ ' + I(m);
                };
                mixItems.push(item('Mixed air (MA)', 'Adiabatic mixing: the humidity ratio and enthalpy are mass-weighted averages of the streams; the dry bulb follows from those two.',
                    [['W MA = sum of (m × W) ÷ m', '= ' + msum('w', Wr) + ' = ' + Wr(mx.state.w) + ' lb/lb'],
                     ['h MA = sum of (m × h) ÷ m', '= ' + msum('h', H) + ' = ' + H(mx.state.h) + ' Btu/lb'],
                     ['DB MA = (h − 1061 × W) ÷ (0.240 + 0.444 × W)',
                      '= (' + H(mx.state.h) + ' − 1061 × ' + Wr(mx.state.w) + ') ÷ ' + n(cp(mx.state.w), 5) + ' = ' + T(mx.state.db) + ' °F']]));
            }
            sections.push({ title: ss.length === 1 ? 'Airflow' : 'Mixing', items: mixItems });
        }

        // ---------------- Energy recovery ----------------
        var e = res.erv;
        if (e && e.exhaust) {
            var oa = e.from, er = e.to, ex = e.exhaust, k = e.ratio;
            var eff = e.eff || {};
            var eItems = [];
            eItems.push(item('Flow ratio (k)', 'Exhaust airflow over outdoor airflow, capped at 1. Effectiveness is referenced to the smaller stream (AHRI 1060), so a smaller exhaust moves ER proportionally less.',
                [['k = min(1, exhaust CFM ÷ outdoor CFM)', '= min(1, ' + I(e.exhCfm) + ' ÷ ' + I(e.oaCfm) + ') = ' + n(k, 2)]]));
            eItems.push(item('Sensible effectiveness', 'Fraction of the outdoor-to-return dry bulb difference the device recovers.',
                [['DB ER = DB OA − sens. eff. × k × (DB OA − DB RA)',
                  '= ' + T(oa.db) + ' − ' + n(eff.sensible, 3) + ' × ' + n(k, 2) + ' × (' + T(oa.db) + ' − ' + T(ex.db) + ') = ' + T(er.db) + ' °F']]));
            if (e.basis === 'total') {
                eItems.push(item('Total effectiveness', 'Fraction of the outdoor-to-return enthalpy difference recovered, sensible and latent together (the value selection software prints). It sets the ER enthalpy; the humidity ratio follows at the ER dry bulb.',
                    [['h ER = h OA − total eff. × k × (h OA − h RA)',
                      '= ' + H(oa.h) + ' − ' + n(eff.total, 3) + ' × ' + n(k, 2) + ' × (' + H(oa.h) + ' − ' + H(ex.h) + ') = ' + H(er.h) + ' Btu/lb'],
                     ['W ER = (h ER − 0.240 × DB ER) ÷ (1061 + 0.444 × DB ER)',
                      '= (' + H(er.h) + ' − 0.240 × ' + T(er.db) + ') ÷ (1061 + 0.444 × ' + T(er.db) + ') = ' + Wr(er.w) + ' lb/lb']]));
                eItems.push(item('Latent effectiveness (implied)', 'The moisture recovery that pair of values works out to at these conditions.',
                    [['latent eff. = (W OA − W ER) ÷ [k × (W OA − W RA)]',
                      '= (' + Wr(oa.w) + ' − ' + Wr(er.w) + ') ÷ [' + n(k, 2) + ' × (' + Wr(oa.w) + ' − ' + Wr(ex.w) + ')] = ' + pct(eff.latent)]]));
            } else {
                eItems.push(item('Latent effectiveness', 'Fraction of the outdoor-to-return humidity ratio difference recovered (wheels; plates recover almost none).',
                    [['W ER = W OA − latent eff. × k × (W OA − W RA)',
                      '= ' + Wr(oa.w) + ' − ' + n(eff.latent, 3) + ' × ' + n(k, 2) + ' × (' + Wr(oa.w) + ' − ' + Wr(ex.w) + ') = ' + Wr(er.w) + ' lb/lb']]));
                eItems.push(item('Total effectiveness (implied)', 'The enthalpy recovery that pair of values works out to at these conditions (what selection software calls total effectiveness).',
                    [['total eff. = (h OA − h ER) ÷ [k × (h OA − h RA)]',
                      '= (' + H(oa.h) + ' − ' + H(er.h) + ') ÷ [' + n(k, 2) + ' × (' + H(oa.h) + ' − ' + H(ex.h) + ')] = ' + pct(eff.total)]]));
            }
            if (e.load) {
                var em = e.massFlow;
                eItems.push(item('Recovered', 'Heat taken out of (or added to) the outdoor air by the device, on the same dry-air mass flow as the rest of the unit.',
                    [['Q = m × (h OA − h ER)', '= ' + I(em) + ' × (' + H(oa.h) + ' − ' + H(er.h) + ') = ' + I(Math.abs(e.load.total)) + ' Btu/h'],
                     ['Qs = m × cp × (DB OA − DB ER), cp = 0.240 + 0.444 × W ER',
                      '= ' + I(em) + ' × ' + n(cp(er.w), 4) + ' × (' + T(oa.db) + ' − ' + T(er.db) + ') = ' + I(Math.abs(e.load.sensible)) + ' Btu/h'],
                     ['QL = Q − Qs', '= ' + I(Math.abs(e.load.total)) + ' − ' + I(Math.abs(e.load.sensible)) + ' = ' + I(Math.abs(e.load.latent)) + ' Btu/h']]));
            }
            sections.push({ title: 'Energy recovery (OA → ER)', items: eItems });
        }

        // ---------------- Economizer ----------------
        if (res.econ) {
            var ec = res.econ, oaP = findPoint(pts, 'oa'), raP = findPoint(pts, 'ra');
            var ecItems = [];
            if (oaP && raP) {
                ecItems.push(item('Dry bulb, RA − OA', 'How much cooler the outdoor air is than the return air (negative: warmer).',
                    [['RA DB − OA DB', '= ' + T(raP.state.db) + ' − ' + T(oaP.state.db) + ' = ' + T(ec.dbDiff) + ' °F']]));
                ecItems.push(item('Enthalpy, RA − OA', 'How much lower the outdoor air enthalpy is than the return air (negative: higher).',
                    [['h RA − h OA', '= ' + H(raP.state.h) + ' − ' + H(oaP.state.h) + ' = ' + H(ec.hDiff) + ' Btu/lb']]));
            }
            ecItems.push(item('Free cooling', (a.econ && a.econ.mode === 'enthalpy'
                ? 'Available when the outdoor enthalpy is below the return enthalpy'
                : 'Available when the outdoor dry bulb is below the return dry bulb') +
                ' and the outdoor dry bulb is at or below the high limit.'));
            ecItems.push(item('High limit', 'Fixed outdoor dry bulb above which the economizer holds minimum outdoor air.'));
            sections.push({ title: 'Economizer check', items: ecItems });
        }

        // ---------------- Stages ----------------
        var stages = res.stages || [];
        if (stages.length) {
            sections.push({ title: 'Process loads', note: 'Relations used by every stage below, from the entering (in) to the leaving (out) state.', items: [
                item('Total', 'Enthalpy change of the air.', [['Q (Btu/h) = m × (h in − h out)']]),
                item('Sensible', 'Dry bulb change of the air.', [['Qs = m × cp × (DB in − DB out), cp = 0.240 + 0.444 × W out (Btu/lb·°F)']]),
                item('Latent', 'The rest of the enthalpy change: moisture removed or added.', [['QL = Q − Qs']]),
                item('Sensible heat ratio (SHR)', 'Sensible share of the total.', [['SHR = Qs ÷ Q']]),
                item('Tons', 'Refrigeration tons.', [['tons = Q ÷ 12,000']])
            ] });
        }
        stages.forEach(function (sg) {
            var f = sg.from, t = sg.to, L = sg.load, lf = sg.fromLabel, lt = sg.label;
            var title = sg.name + ' (' + lf + ' → ' + lt + ')';
            var its = [];
            if (sg.id === 'sa') {
                var cool = L.total >= 0;
                its.push(item(cool ? 'Total cooling' : 'Total heating', null,
                    [['Q = m × (h ' + lf + ' − h ' + lt + ')', '= ' + I(m) + ' × (' + H(f.h) + ' − ' + H(t.h) + ') = ' + I(L.total) + ' Btu/h (' + n(L.tons, 2) + ' tons)']]));
                its.push(item('Sensible', null,
                    [['Qs = m × cp × (DB ' + lf + ' − DB ' + lt + ')', '= ' + I(m) + ' × ' + n(cp(t.w), 4) + ' × (' + T(f.db) + ' − ' + T(t.db) + ') = ' + I(L.sensible) + ' Btu/h']]));
                its.push(item('Latent', null, [['QL = Q − Qs', '= ' + I(L.total) + ' − ' + I(L.sensible) + ' = ' + I(L.latent) + ' Btu/h']]));
                if (cool && L.shr !== null) its.push(item('Sensible heat ratio', null, [['SHR = Qs ÷ Q', '= ' + I(L.sensible) + ' ÷ ' + I(L.total) + ' = ' + n(L.shr, 3)]]));
                var adp = sg.extra && sg.extra.adp;
                if (adp && a.coil && a.coil.mode === 'adp') {
                    its.push(item('Apparatus dew point and bypass factor', 'Entered: the coil surface temperature (ADP) and the fraction of air that passes the coil untreated (BF). The leaving state lies on the straight line from ' + lf + ' to the ADP.',
                        [['DB ' + lt + ' = ADP + BF × (DB ' + lf + ' − ADP)', '= ' + T(adp.adp.db) + ' + ' + n(adp.bf, 3) + ' × (' + T(f.db) + ' − ' + T(adp.adp.db) + ') = ' + T(t.db) + ' °F'],
                         ['W ' + lt + ' = W ADP + BF × (W ' + lf + ' − W ADP)', '= ' + Wr(adp.adp.w) + ' + ' + n(adp.bf, 3) + ' × (' + Wr(f.w) + ' − ' + Wr(adp.adp.w) + ') = ' + Wr(t.w) + ' lb/lb']]));
                } else if (adp) {
                    its.push(item('Apparatus dew point (ADP)', 'Where the straight line from ' + lf + ' through ' + lt + ', extended, meets the saturation curve (solved numerically): the effective coil surface temperature.',
                        [['ADP', '= ' + T(adp.adp.db) + ' °F']]));
                    its.push(item('Bypass factor (BF)', 'Fraction of the air that behaves as if it bypassed the coil.',
                        [['BF = (DB ' + lt + ' − ADP) ÷ (DB ' + lf + ' − ADP)', '= (' + T(t.db) + ' − ' + T(adp.adp.db) + ') ÷ (' + T(f.db) + ' − ' + T(adp.adp.db) + ') = ' + n(adp.bf * 100, 1) + ' %']]));
                }
                its.push(item(L.moistureLbHr >= 0 ? 'Moisture removed' : 'Moisture added', 'Water condensed out of the air on the coil.',
                    [['lb/hr = m × (W ' + lf + ' − W ' + lt + ')', '= ' + I(m) + ' × (' + Wr(f.w) + ' − ' + Wr(t.w) + ') = ' + n(Math.abs(L.moistureLbHr), 1) + ' lb/hr']]));
                var c = sg.extra && sg.extra.condensate;
                if (c) {
                    its.push(item('Condensate', 'Volume of that water, at 8.345 lb per gallon.',
                        [['gal/hr = lb/hr ÷ 8.345, gal/day = gal/hr × 24',
                          '= ' + n(c.lbhr, 1) + ' ÷ ' + LB_PER_GAL + ' = ' + n(c.galhr, 2) + ' gal/hr; × 24 = ' + I(c.galday) + ' gal/day']]));
                    its.push(item('Drain size (IMC 307.2.2)', 'Minimum condensate drain by cooling capacity: up to 20 tons 3/4 in; 21-40 tons 1 in; 41-90 tons 1-1/4 in; 91-125 tons 1-1/2 in; 126-250 tons 2 in.',
                        [[n(L.tons, 2) + ' tons', '-> ' + c.drainSize]]));
                }
            } else if (sg.id === 'sf') {
                var fan = a.fan || {}, q = sg.extra.q, dt = sg.extra.dt, cpf = cp(f.w);
                if (fan.mode === 'dt') {
                    its.push(item('Temperature rise', 'Entered: the dry bulb rise across the fan and motor.', [['dT', '= ' + n(dt, 2) + ' °F']]));
                    its.push(item('Fan heat added', 'The heat that rise represents on this mass flow.',
                        [['Q = m × cp × dT, cp = 0.240 + 0.444 × W', '= ' + I(m) + ' × ' + n(cpf, 4) + ' × ' + n(dt, 2) + ' = ' + I(q) + ' Btu/h']]));
                } else {
                    var bhp = Number(fan.bhp), eff = Number(fan.motorEff) / 100;
                    its.push(item('Fan heat added', fan.motorIn
                        ? 'Fan brake horsepower plus the motor losses, since the motor sits in the airstream (2,545 Btu/h per hp).'
                        : 'Fan brake horsepower only; the motor is outside the airstream (2,545 Btu/h per hp).',
                        [[fan.motorIn ? 'Q = BHP × 2,545 ÷ motor eff.' : 'Q = BHP × 2,545',
                          '= ' + n(bhp, 2) + ' × ' + I(BTUH_PER_HP) + (fan.motorIn ? ' ÷ ' + n(eff, 2) : '') + ' = ' + I(q) + ' Btu/h']]));
                    its.push(item('Temperature rise', 'Dry bulb rise that heat produces on this mass flow.',
                        [['dT = Q ÷ (m × cp)', '= ' + I(q) + ' ÷ (' + I(m) + ' × ' + n(cpf, 4) + ') = ' + n(dt, 2) + ' °F']]));
                }
            } else if (sg.id === 'hu') {
                if (a.hum && a.hum.type === 'evap') {
                    var he = Number(a.hum.eff) / 100;
                    its.push(item('Leaving dry bulb', 'Evaporative (adiabatic) humidifier: the air moves along its wet bulb line; effectiveness is how far toward the wet bulb it gets.',
                        [['DB out = DB in − eff. × (DB in − WB in)', '= ' + T(f.db) + ' − ' + n(he, 2) + ' × (' + T(f.db) + ' − ' + T(f.wb) + ') = ' + T(t.db) + ' °F']]));
                    its.push(item('Dry bulb drop', null, [['DB in − DB out', '= ' + T(f.db) + ' − ' + T(t.db) + ' = ' + T(f.db - t.db) + ' °F']]));
                } else {
                    its.push(item('Heat added with steam', 'Steam humidifier: moisture added at essentially constant dry bulb.',
                        [['Q = m × (h out − h in)', '= ' + I(m) + ' × (' + H(t.h) + ' − ' + H(f.h) + ') = ' + I(-L.total) + ' Btu/h']]));
                }
                its.push(item('Water added', null,
                    [['lb/hr = m × (W out − W in)', '= ' + I(m) + ' × (' + Wr(t.w) + ' − ' + Wr(f.w) + ') = ' + n(Math.abs(L.moistureLbHr), 1) + ' lb/hr']]));
            } else {
                // Preheat / reheat: sensible heating at constant humidity ratio.
                its.push(item('Heat added', 'Sensible heating: the humidity ratio stays at ' + Wr(f.w) + ' lb/lb and only the dry bulb rises, to ' + T(t.db) + ' °F.',
                    [['Q = m × (h ' + lt + ' − h ' + lf + ')', '= ' + I(m) + ' × (' + H(t.h) + ' − ' + H(f.h) + ') = ' + I(-L.total) + ' Btu/h']]));
            }
            if (its.length) sections.push({ title: title, items: its });
        });

        // ---------------- Net ----------------
        if (res.net && res.entering && res.final) {
            var N = res.net, en = res.entering, fi = res.final, le = res.enteringLabel, lfi = res.finalLabel;
            sections.push({ title: 'Net, ' + le + ' → ' + lfi + ' (supply)', note: 'The unit\'s overall effect between the entering air and the supply air.', items: [
                item(N.total >= 0 ? 'Net cooling' : 'Net heating', null,
                    [['Q = m × (h ' + le + ' − h ' + lfi + ')', '= ' + I(m) + ' × (' + H(en.h) + ' − ' + H(fi.h) + ') = ' + I(Math.abs(N.total)) + ' Btu/h']]),
                item('Sensible', null,
                    [['Qs = m × cp × (DB ' + le + ' − DB ' + lfi + ')', '= ' + I(m) + ' × ' + n(cp(fi.w), 4) + ' × (' + T(en.db) + ' − ' + T(fi.db) + ') = ' + I(N.sensible) + ' Btu/h']]),
                item('Latent', null, [['QL = Q − Qs', '= ' + I(N.total) + ' − ' + I(N.sensible) + ' = ' + I(N.latent) + ' Btu/h']])
            ] });
        }

        // ---------------- Sensible check ----------------
        var r = res.room;
        if (r && r.state) {
            var rm = r.state, rItems = [];
            if (r.shr !== undefined) {
                rItems.push(item('Room sensible heat ratio', 'Sensible share of the space load. Supply air on the room line (drawn from the room point at this ratio) matches the space\'s sensible / latent split.',
                    [['SHR = Qs ÷ (Qs + QL)', '= ' + I(r.qs) + ' ÷ (' + I(r.qs) + ' + ' + I(r.ql || 0) + ') = ' + n(r.shr, 3)]]));
            }
            if (r.required) {
                var q2 = r.required, cpr = cp(rm.w);
                if (a.room && a.room.solve === 'cfm') {
                    rItems.push(item('Required airflow', 'The airflow that carries the space sensible load at the chosen supply dry bulb.',
                        [['m = Qs ÷ [cp × (DB room − DB supply)]', '= ' + I(r.qs) + ' ÷ [' + n(cpr, 4) + ' × (' + T(rm.db) + ' − ' + T(q2.state.db) + ')] = ' + I(q2.massFlow) + ' lb/hr'],
                         [basis === 'actual' ? 'CFM = m × v ÷ 60' : 'CFM = m ÷ 4.5',
                          '= ' + (basis === 'actual' ? I(q2.massFlow) + ' × ' + V(q2.state.v) + ' ÷ 60' : I(q2.massFlow) + ' ÷ 4.5') + ' = ' + I(q2.cfm) + ' CFM']]));
                } else {
                    rItems.push(item('Required supply dry bulb', 'The supply temperature at which the airflow carries the space sensible load' +
                        (basis === 'actual' ? ' (mass flow taken at the supply condition).' : '.'),
                        [['DB supply = DB room − Qs ÷ (m × cp)', '= ' + T(rm.db) + ' − ' + I(r.qs) + ' ÷ (' + I(q2.massFlow) + ' × ' + n(cpr, 4) + ') = ' + T(q2.state.db) + ' °F']]));
                }
                rItems.push(item('Required supply humidity', 'The supply enthalpy that also carries the latent load; the humidity ratio follows at the supply dry bulb.',
                    [['h supply = h room − (Qs + QL) ÷ m', '= ' + H(rm.h) + ' − (' + I(r.qs) + ' + ' + I(r.ql || 0) + ') ÷ ' + I(q2.massFlow) + ' = ' + H(q2.state.h) + ' Btu/lb'],
                     ['W supply = (h − 0.240 × DB) ÷ (1061 + 0.444 × DB)', '= ' + Wr(q2.state.w) + ' lb/lb (' + n(q2.state.grains, 1) + ' gr/lb)']]));
            }
            if (r.delivered && res.final) {
                var d = r.delivered, fin = res.final;
                rItems.push(item('Delivered sensible (' + res.finalLabel + ')', 'Sensible cooling the supply air provides to the room on the unit\'s mass flow. Passes at 98 % of the space sensible load or more.',
                    [['Qs = m × cp × (DB room − DB ' + res.finalLabel + ')', '= ' + I(m) + ' × ' + n(cp(fin.w), 4) + ' × (' + T(rm.db) + ' − ' + T(fin.db) + ') = ' + I(d.sensible) + ' Btu/h']]));
                if (d.total) {
                    rItems.push(item('Supply SHR', 'Sensible share of what the supply air delivers, to compare with the room SHR.',
                        [['SHR = Qs ÷ Q, Q = m × (h room − h ' + res.finalLabel + ')',
                          '= ' + I(d.sensible) + ' ÷ ' + I(d.total) + ' = ' + n(d.sensible / d.total, 3)]]));
                }
            }
            if (rItems.length) sections.push({ title: 'Sensible check (room line)', items: rItems });
        }

        // ---------------- Latent check ----------------
        var D = res.dewpoint;
        if (D && D.limit) {
            var Lm = D.limit, rmD = D.room, dItems = [];
            dItems.push(item('Airflow carrying the latent load', D.carrier === 'vent'
                ? 'Dedicated outdoor air (Law #1): the ventilation air alone must absorb the space moisture, so the zone equipment can run dry.'
                : 'The whole supply airflow absorbs the space moisture.',
                [['m = ' + (basis === 'actual' ? 'CFM × 60 ÷ v room' : '4.5 × CFM'), '= ' + massExpr(D.cfm, rmD, basis) + ' = ' + I(Lm.massFlow) + ' lb/hr']]));
            dItems.push(item('Moisture to remove', 'Humidity ratio difference between room and supply that carries the latent load (1,076 Btu per lb of water).',
                [['dW = QL ÷ (m × 1,076)', '= ' + I(D.ql) + ' ÷ (' + I(Lm.massFlow) + ' × ' + I(HFG) + ') = ' + Wr(Lm.dW) + ' lb/lb (' + n(Lm.dW * GR, 1) + ' gr/lb)']]));
            dItems.push(item('Required supply humidity ratio / dew point (max)', 'The wettest supply air that still carries the load; its dew point is the maximum supply dew point.',
                [['W max = W room − dW', '= ' + Wr(rmD.w) + ' − ' + Wr(Lm.dW) + ' = ' + Wr(Lm.w) + ' lb/lb (' + n(Lm.grains, 1) + ' gr/lb)'],
                 ['DP max = dew point at W max', '= ' + T(Lm.dp) + ' °F']]));
            dItems.push(item('Formula (per CFM)', 'The same relation per CFM and grain, the form manufacturers quote.',
                [['QL = factor × CFM × d gr/lb, factor = 1,076 × (m ÷ CFM) ÷ 7,000',
                  '= 1,076 × (' + I(Lm.massFlow) + ' ÷ ' + I(Lm.cfm) + ') ÷ 7,000 = ' + n(Lm.factor, 3) + (basis === 'std' ? ' (0.69 for standard air)' : '')]]));
            if (res.final) {
                var fz = res.final;
                dItems.push(item('Latent carried at ' + res.finalLabel, 'Latent load the supply air absorbs. The check passes when W ' + res.finalLabel + ' is no more than 2 % above W max.',
                    [['QL = m × 1,076 × (W room − W ' + res.finalLabel + ')', '= ' + I(Lm.massFlow) + ' × ' + I(HFG) + ' × (' + Wr(rmD.w) + ' − ' + Wr(fz.w) + ') = ' + I(Math.max(0, D.carried)) + ' Btu/h']]));
                if (D.minCfm !== undefined) {
                    dItems.push(item('Airflow needed at ' + res.finalLabel + ' dew point', 'Airflow that would carry the whole latent load at the supply air\'s actual dryness.',
                        [['CFM = QL ÷ [1,076 × (W room − W ' + res.finalLabel + ') × (m ÷ CFM)]',
                          '= ' + I(D.ql) + ' ÷ [' + I(HFG) + ' × (' + Wr(rmD.w) + ' − ' + Wr(fz.w) + ') × ' + n(Lm.massFlow / Lm.cfm, 3) + '] = ' + I(D.minCfm) + ' CFM']]));
                }
            }
            if (D.unit) {
                dItems.push(item('Unit rated supply dew point', 'Entered: the dew point the unit is rated to deliver, checked the same way.',
                    [['QL = m × 1,076 × (W room − W at rated DP)', '= ' + I(Lm.massFlow) + ' × ' + I(HFG) + ' × (' + Wr(rmD.w) + ' − ' + Wr(D.unit.w) + ') = ' + I(Math.max(0, D.unitCarried)) + ' Btu/h']]));
            }
            sections.push({ title: 'Latent check (max supply dew point)', items: dItems });
        }

        return finish(sections, s);
    }

    function findPoint(pts, id) {
        for (var i = 0; i < pts.length; i++) if (pts[i].id === id) return pts[i];
        return null;
    }

    function finish(sections, s) {
        if (!sections.length) return null;
        var intro = ['What each item on this report means and how it was calculated, worked with this report\'s numbers. ' +
            'Properties follow ASHRAE Fundamentals, chapter 1 (via PsychroLib). Worked lines round each value for display; the results use full precision.'];
        if (s.units === 'SI') {
            intro.push('Worked values are in IP units (°F, lb/hr, Btu/lb, Btu/h), the basis the calculation runs in; the report pages show the results converted to SI.');
        }
        return { title: 'Definitions and calculations', intro: intro, sections: sections };
    }

    HHpro.PsychroAppendix = { build: build };
})();
