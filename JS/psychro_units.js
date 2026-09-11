/* ============================================================
   HHpro - Psychrometric unit conversions (IP <-> SI)
   ------------------------------------------------------------
   The calculator keeps every stored value and every calculation
   in IP (see psychro_core.js). This module converts at the
   screen edge only: what the user types is converted to IP on
   the way in, and results are converted to the chosen system on
   the way out. Switching systems therefore never changes a
   result, only how it is printed.

     HHpro.PsychroUnits.unit('temp', 'SI')        -> '°C'
     HHpro.PsychroUnits.toDisp('temp', 75, 'SI')  -> 23.9
     HHpro.PsychroUnits.fromDisp('temp', 24, 'SI')-> 75.2

   Enthalpy is the one property that is not a straight scale: the
   IP formula is referenced to dry air at 0 °F, the SI formula to
   0 °C (ASHRAE Fundamentals ch.1). enthalpyDisp / humRatioFromEnthalpy
   handle that by recomputing from (t, W) rather than scaling.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    function scale(ipUnit, siUnit, factor) {
        return {
            ip: ipUnit, si: siUnit,
            toSi: function (v) { return v * factor; },
            toIp: function (v) { return v / factor; }
        };
    }

    var KINDS = {
        temp: {
            ip: '°F', si: '°C',
            toSi: function (f) { return (f - 32) / 1.8; },
            toIp: function (c) { return c * 1.8 + 32; }
        },
        dtemp:     scale('°F', 'K', 1 / 1.8),
        grains:    scale('gr/lb', 'g/kg', 1 / 7),          // 7000 gr/lb = 1000 g/kg
        w:         scale('lb/lb', 'kg/kg', 1),
        h:         scale('Btu/lb', 'kJ/kg', 2.326),        // used for load-per-lb only; see enthalpyDisp
        v:         scale('ft³/lb', 'm³/kg', 0.0624280),
        density:   scale('lb/ft³', 'kg/m³', 16.01846),
        pressure:  scale('psia', 'kPa', 6.894757),
        baro:      scale('in Hg', 'kPa', 3.386389),
        altitude:  scale('ft', 'm', 0.3048),
        flow:      scale('CFM', 'L/s', 0.4719474),
        power:     scale('Btu/h', 'kW', 0.00029307107),
        massflow:  scale('lb/hr', 'kg/h', 0.45359237),
        volrate:   scale('gal/hr', 'L/h', 3.785412),
        volday:    scale('gal/day', 'L/day', 3.785412),
        hp:        scale('hp', 'kW', 0.7457),
        pct:       scale('%', '%', 1),
        none:      scale('', '', 1)
    };

    function kind(k) {
        var def = KINDS[k];
        if (!def) throw new Error('PsychroUnits: unknown kind "' + k + '"');
        return def;
    }

    function unit(k, sys) {
        return sys === 'SI' ? kind(k).si : kind(k).ip;
    }

    function toDisp(k, ipValue, sys) {
        if (ipValue === null || ipValue === undefined || !isFinite(ipValue)) return ipValue;
        return sys === 'SI' ? kind(k).toSi(ipValue) : ipValue;
    }

    function fromDisp(k, dispValue, sys) {
        if (dispValue === null || dispValue === undefined || !isFinite(dispValue)) return dispValue;
        return sys === 'SI' ? kind(k).toIp(dispValue) : dispValue;
    }

    // Moist-air enthalpy in the display system's own reference frame.
    function enthalpyDisp(state, sys) {
        if (sys !== 'SI') return state.h;
        var t = KINDS.temp.toSi(state.db);
        return 1.006 * t + state.w * (2501 + 1.86 * t);
    }

    // Inverse of the above for enthalpy entered as the second property.
    // Returns humidity ratio (lb/lb) or null when impossible.
    function humRatioFromEnthalpy(hDisp, dbIp, sys) {
        if (sys !== 'SI') return null; // caller uses the IP core path
        var t = KINDS.temp.toSi(dbIp);
        return (hDisp - 1.006 * t) / (2501 + 1.86 * t);
    }

    // Rounded display helper: decimals appropriate to the unit system.
    function decimals(k, sys) {
        switch (k) {
            case 'temp': case 'dtemp': return 1;
            case 'grains': return 1;
            case 'w': return 5;
            case 'h': return 2;
            case 'v': return 3;
            case 'density': return sys === 'SI' ? 3 : 4;
            case 'pressure': return sys === 'SI' ? 3 : 4;
            case 'baro': return 2;
            case 'altitude': return 0;
            case 'flow': return 0;
            case 'power': return sys === 'SI' ? 2 : 0;
            case 'massflow': return 0;
            case 'volrate': return 2;
            case 'volday': return 0;
            case 'hp': return 2;
            default: return 1;
        }
    }

    HHpro.PsychroUnits = {
        KINDS: KINDS,
        unit: unit,
        toDisp: toDisp,
        fromDisp: fromDisp,
        enthalpyDisp: enthalpyDisp,
        humRatioFromEnthalpy: humRatioFromEnthalpy,
        decimals: decimals
    };
})();
