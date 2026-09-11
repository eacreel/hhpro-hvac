/* ============================================================
   HHpro - Psychrometric core (IP units)
   ------------------------------------------------------------
   Thin wrapper around the vendored PsychroLib (JS/psychrolib.js,
   MIT - see JS/psychrolib.LICENSE.txt) that gives the rest of
   the site one small, IP-only API:

     HHpro.Psychro.pressureFromAltitude(ft)   -> psia
     HHpro.Psychro.state(db, key, value, P)   -> full state object
     HHpro.Psychro.mix(streams, P)            -> mixed-air state + mass flow
     HHpro.Psychro.process(from, to, massLbHr)-> coil loads between two states
     ...plus the curve helpers the chart uses (saturation, RH,
     wet-bulb, enthalpy and specific-volume lines).

   Every temperature is degF, pressure is psia, humidity ratio
   is lb water / lb dry air (with a grains/lb copy for display),
   enthalpy is Btu/lb dry air, volume is ft3/lb dry air.

   PsychroLib validates its inputs and throws plain Errors with a
   readable message ("Wet bulb temperature is above dry bulb
   temperature") - state() lets those bubble up so the calculator
   page can show them next to the offending field.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var lib = window.psychrolib;
    if (!lib) {
        console.error('HHpro.Psychro: psychrolib.js must load first');
        return;
    }
    lib.SetUnitSystem(lib.IP);

    var GRAINS_PER_LB = 7000;
    var INHG_PER_PSI = 2.036021;
    var R_DA_IP = 0.370486; // ft3 psi / (lb R) - dry air gas constant, matches PsychroLib

    // Second-property choices for entering a state point. `key` is
    // what the UI stores, `label`/`unit` are what it shows.
    var INPUT_KEYS = [
        { key: 'wb', label: 'Wet Bulb',          unit: '°F' },
        { key: 'rh', label: 'Relative Humidity', unit: '%' },
        { key: 'dp', label: 'Dew Point',         unit: '°F' },
        { key: 'w',  label: 'Humidity Ratio',    unit: 'gr/lb' },
        { key: 'h',  label: 'Enthalpy',          unit: 'Btu/lb' }
    ];

    function pressureFromAltitude(altitudeFt) {
        var alt = Number(altitudeFt);
        if (!isFinite(alt)) alt = 0;
        return lib.GetStandardAtmPressure(alt);
    }

    function satHumRatio(db, P) {
        return lib.GetSatHumRatio(db, P);
    }

    // Build the full property set from dry bulb + humidity ratio. Used by
    // every entry path once the humidity ratio is known.
    function fromDbW(db, w, P) {
        if (w < 0) w = 0;
        var wsat = satHumRatio(db, P);
        // Tolerate float noise right at saturation; anything beyond it
        // is a genuinely impossible (fogged) state.
        if (w > wsat * (1 + 1e-6)) {
            throw new Error('That state is above saturation (max ' +
                (wsat * GRAINS_PER_LB).toFixed(1) + ' gr/lb at ' + db + ' °F)');
        }
        if (w > wsat) w = wsat;
        return {
            db: db,
            wb: lib.GetTWetBulbFromHumRatio(db, w, P),
            dp: lib.GetTDewPointFromHumRatio(db, w, P),
            rh: lib.GetRelHumFromHumRatio(db, w, P),        // 0..1
            w: w,
            grains: w * GRAINS_PER_LB,
            h: lib.GetMoistAirEnthalpy(db, w),
            v: lib.GetMoistAirVolume(db, w, P),
            density: lib.GetMoistAirDensity(db, w, P),
            pv: lib.GetVapPresFromHumRatio(w, P),
            pressure: P
        };
    }

    /**
     * Resolve a state point from dry bulb plus one other property.
     * @param {number} db     dry bulb, degF
     * @param {string} key    'wb' | 'rh' | 'dp' | 'w' | 'h'
     * @param {number} value  in the unit listed in INPUT_KEYS (RH in %, W in gr/lb)
     * @param {number} P      barometric pressure, psia
     */
    function state(db, key, value, P) {
        db = Number(db); value = Number(value);
        if (!isFinite(db)) throw new Error('Enter a dry bulb temperature');
        if (!isFinite(value)) throw new Error('Enter a value for the second property');
        if (db < -100 || db > 200) throw new Error('Dry bulb must be between -100 and 200 °F');
        var w;
        switch (key) {
            case 'wb':
                if (value > db) throw new Error('Wet bulb cannot be above dry bulb');
                w = lib.GetHumRatioFromTWetBulb(db, value, P);
                break;
            case 'rh':
                if (value < 0 || value > 100) throw new Error('Relative humidity must be 0 to 100%');
                w = lib.GetHumRatioFromRelHum(db, value / 100, P);
                break;
            case 'dp':
                if (value > db) throw new Error('Dew point cannot be above dry bulb');
                w = lib.GetHumRatioFromTDewPoint(value, P);
                break;
            case 'w':
                if (value < 0) throw new Error('Humidity ratio cannot be negative');
                w = value / GRAINS_PER_LB;
                break;
            case 'h':
                w = lib.GetHumRatioFromEnthalpyAndTDryBulb(value, db);
                if (w < 0) throw new Error('Enthalpy is below that of dry air at ' + db + ' °F');
                break;
            default:
                throw new Error('Unknown property "' + key + '"');
        }
        return fromDbW(db, w, P);
    }

    // Mass flow of dry air through a stream, lb/hr, from its volumetric
    // flow at the stream's own state (CFM is measured at that condition).
    function massFlow(st, cfm) {
        return (Number(cfm) * 60) / st.v;
    }

    /**
     * Adiabatic mixing of any number of streams.
     * @param {Array<{state:object, cfm:number}>} streams
     * @returns {{state, massFlow, cfm, fractions}}  fractions are mass-based
     */
    function mix(streams, P) {
        var mTot = 0, wSum = 0, hSum = 0, cfmTot = 0;
        var masses = streams.map(function (s) {
            var m = massFlow(s.state, s.cfm);
            if (!isFinite(m) || m < 0) m = 0;
            mTot += m;
            wSum += m * s.state.w;
            hSum += m * s.state.h;
            cfmTot += Number(s.cfm) || 0;
            return m;
        });
        if (mTot <= 0) throw new Error('Enter airflow for at least one stream');
        var w = wSum / mTot;
        var h = hSum / mTot;
        var db = lib.GetTDryBulbFromEnthalpyAndHumRatio(h, w);
        var mixed;
        try {
            mixed = fromDbW(db, w, P);
        } catch (e) {
            // Mixing two near-saturated streams can land in the fog region;
            // report the saturated state at that enthalpy instead of failing.
            mixed = fromDbW(db, satHumRatio(db, P), P);
            mixed.fogged = true;
        }
        return {
            state: mixed,
            massFlow: mTot,
            cfm: cfmTot,
            fractions: masses.map(function (m) { return m / mTot; })
        };
    }

    /**
     * Loads for a process taking `from` to `to` at a dry-air mass flow.
     * Positive numbers mean heat removed from the air (cooling /
     * dehumidification); negative means added (heating / humidification).
     */
    function process(from, to, massLbHr) {
        var m = Number(massLbHr) || 0;
        var total = m * (from.h - to.h);
        // Sensible portion at the leaving humidity ratio: cp of moist air
        // = 0.240 + 0.444 W (Btu/lb-F), ASHRAE Fundamentals ch.1.
        var cp = 0.240 + 0.444 * to.w;
        var sensible = m * cp * (from.db - to.db);
        var latent = total - sensible;
        return {
            total: total,
            sensible: sensible,
            latent: latent,
            tons: total / 12000,
            shr: total !== 0 ? sensible / total : null,
            moistureLbHr: m * (from.w - to.w),
            massFlow: m
        };
    }

    // ----- Curve helpers for the chart -----

    function humRatioFromWb(db, wb, P) {
        if (wb > db) return null;
        var w = lib.GetHumRatioFromTWetBulb(db, wb, P);
        return w < 0 ? null : w;
    }

    function humRatioFromRh(db, rh, P) {
        return lib.GetHumRatioFromRelHum(db, rh, P);
    }

    function humRatioFromEnthalpy(h, db) {
        return lib.GetHumRatioFromEnthalpyAndTDryBulb(h, db);
    }

    // v = R T (1 + 1.607858 W) / P   (same relation PsychroLib uses)
    function humRatioFromVolume(v, db, P) {
        var T = db + 459.67;
        return (v * P / (R_DA_IP * T) - 1) / 1.607858;
    }

    function enthalpy(db, w) {
        return lib.GetMoistAirEnthalpy(db, w);
    }

    // Dry bulb at which the saturation curve reaches enthalpy h (bisection).
    function satDbForEnthalpy(h, P, lo, hi) {
        lo = lo === undefined ? -40 : lo;
        hi = hi === undefined ? 150 : hi;
        for (var i = 0; i < 60; i++) {
            var mid = (lo + hi) / 2;
            var hm = lib.GetSatAirEnthalpy(mid, P);
            if (hm < h) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    // Dry bulb at which the saturation curve reaches specific volume v.
    function satDbForVolume(v, P, lo, hi) {
        lo = lo === undefined ? -40 : lo;
        hi = hi === undefined ? 150 : hi;
        for (var i = 0; i < 60; i++) {
            var mid = (lo + hi) / 2;
            var vm = lib.GetMoistAirVolume(mid, satHumRatio(mid, P), P);
            if (vm < v) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    HHpro.Psychro = {
        INPUT_KEYS: INPUT_KEYS,
        GRAINS_PER_LB: GRAINS_PER_LB,
        pressureFromAltitude: pressureFromAltitude,
        inHgFromPsi: function (psi) { return psi * INHG_PER_PSI; },
        state: state,
        fromDbW: fromDbW,
        massFlow: massFlow,
        mix: mix,
        process: process,
        satHumRatio: satHumRatio,
        humRatioFromWb: humRatioFromWb,
        humRatioFromRh: humRatioFromRh,
        humRatioFromEnthalpy: humRatioFromEnthalpy,
        humRatioFromVolume: humRatioFromVolume,
        enthalpy: enthalpy,
        satDbForEnthalpy: satDbForEnthalpy,
        satDbForVolume: satDbForVolume
    };
})();
