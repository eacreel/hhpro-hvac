/* ============================================================
   HHpro - Psychrometric core (IP units)
   ------------------------------------------------------------
   Thin wrapper around the vendored PsychroLib (JS/psychrolib.js,
   MIT - see JS/psychrolib.LICENSE.txt) that gives the rest of
   the site one small, IP-only API:

     state(db, key, value, P)        full state from dry bulb + one property
     fromDbW(db, w, P)               full state from dry bulb + humidity ratio
     massFlow(state, cfm, basis)     lb dry air / hr
     mix(streams, P, basis)          adiabatic mixing of N streams
     process(from, to, m)            loads between two states (+ = removed)
     sensible(state, dbOut, P)       sensible heating / reheat
     coilFromAdp(entering, adp, bf)  coil leaving state from ADP + bypass factor
     adpFromLeaving(entering, lv)    ADP + bypass factor implied by a leaving state
     evap(state, eff, P)             adiabatic (evaporative) cooling / humidifying
     steam(state, key, value, P)     steam humidification at constant dry bulb
     fanHeat(state, opts, m, P)      fan / motor temperature rise
     erv(oa, exhaust, effS, effL)    energy-recovery leaving state for the OA
     roomLine(room, shr, P, dbMin)   points along the room sensible-heat-ratio line
     supplyFromRoom(...)             supply state from room loads (given CFM or DB)
     economizer(oa, ra, opts)        free-cooling comparison
     condensate(lbhr, tons)          gal/hr, gal/day and an IMC drain size
     ...plus the curve helpers the chart uses.

   Every temperature is degF, pressure is psia, humidity ratio
   is lb water / lb dry air (with a grains/lb copy for display),
   enthalpy is Btu/lb dry air, volume is ft3/lb dry air. Unit
   conversion for display happens in psychro_units.js, never here.

   PsychroLib validates its inputs and throws plain Errors with a
   readable message; state() lets those bubble up so the page can
   show them next to the offending field.
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
    var STD_AIR_DENSITY = 0.075; // lb/ft3 - "standard air" behind the 4.5 x CFM and 1.08 x CFM factors
    var R_DA_IP = 0.370486;      // ft3 psi / (lb R) - dry air gas constant, matches PsychroLib
    var LB_PER_GAL = 8.345;
    var BTUH_PER_HP = 2545;

    // Second-property choices for entering a state point. `key` is
    // what the UI stores, `label`/`unit` are what it shows (IP).
    var INPUT_KEYS = [
        { key: 'wb', label: 'Wet Bulb',          unit: '°F',     kind: 'temp' },
        { key: 'rh', label: 'Relative Humidity', unit: '%',      kind: 'pct' },
        { key: 'dp', label: 'Dew Point',         unit: '°F',     kind: 'temp' },
        { key: 'w',  label: 'Humidity Ratio',    unit: 'gr/lb',  kind: 'grains' },
        { key: 'h',  label: 'Enthalpy',          unit: 'Btu/lb', kind: 'h' }
    ];

    function pressureFromAltitude(altitudeFt) {
        var alt = Number(altitudeFt);
        if (!isFinite(alt)) alt = 0;
        return lib.GetStandardAtmPressure(alt);
    }

    function satHumRatio(db, P) {
        return lib.GetSatHumRatio(db, P);
    }

    function cpMoist(w) {
        return 0.240 + 0.444 * w; // Btu/lb-F, ASHRAE Fundamentals ch.1
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
                (wsat * GRAINS_PER_LB).toFixed(1) + ' gr/lb at ' + db.toFixed(1) + ' °F)');
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

    // Same, but clamp to saturation instead of throwing (for computed
    // states such as ERV leaving air that can land in the fog region).
    function fromDbWClamped(db, w, P) {
        var wsat = satHumRatio(db, P);
        var fogged = w > wsat;
        var st = fromDbW(db, fogged ? wsat : w, P);
        if (fogged) st.fogged = true;
        return st;
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

    // Mass flow of dry air through a stream, lb/hr.
    //   basis 'std'    - standard air, 0.075 lb/ft3 (CFM x 4.5), the
    //                    convention behind published coil loads; altitude
    //                    does not change it.
    //   basis 'actual' - CFM measured at the stream's own state, so the
    //                    specific volume (and altitude) counts.
    function massFlow(st, cfm, basis) {
        var q = Number(cfm) * 60;
        if (basis === 'actual') return q / st.v;
        return q * STD_AIR_DENSITY;
    }

    // Inverse: volumetric flow (CFM) for a dry-air mass flow.
    function cfmFromMass(st, massLbHr, basis) {
        if (basis === 'actual') return massLbHr * st.v / 60;
        return massLbHr / (60 * STD_AIR_DENSITY);
    }

    /**
     * Adiabatic mixing of any number of streams.
     * @param {Array<{state:object, cfm:number}>} streams
     * @returns {{state, massFlow, cfm, fractions}}  fractions are mass-based
     */
    function mix(streams, P, basis) {
        var mTot = 0, wSum = 0, hSum = 0, cfmTot = 0;
        var masses = streams.map(function (s) {
            var m = massFlow(s.state, s.cfm, basis);
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
        var mixed = fromDbWClamped(db, w, P);
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
        var sensible = m * cpMoist(to.w) * (from.db - to.db);
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

    // Sensible-only heating (reheat, preheat, electric, gas, hot gas):
    // humidity ratio is held, only dry bulb changes.
    function sensible(entering, dbOut, P) {
        dbOut = Number(dbOut);
        if (!isFinite(dbOut)) throw new Error('Enter the leaving dry bulb');
        return fromDbW(dbOut, entering.w, P);
    }

    function reheat(entering, dbOut, P) {
        dbOut = Number(dbOut);
        if (isFinite(dbOut) && dbOut < entering.db) {
            throw new Error('Reheat leaving temperature must be at or above the entering temperature');
        }
        return sensible(entering, dbOut, P);
    }

    // ----- Cooling coil: apparatus dew point and bypass factor -----

    // Leaving state on the straight line from the entering state to the
    // ADP (on the saturation curve), a fraction `bf` of the way back.
    function coilFromAdp(entering, adpDb, bf, P) {
        adpDb = Number(adpDb); bf = Number(bf);
        if (!isFinite(adpDb)) throw new Error('Enter the apparatus dew point');
        if (!isFinite(bf) || bf < 0 || bf >= 1) throw new Error('Bypass factor must be between 0 and 1');
        if (adpDb >= entering.db) throw new Error('ADP must be below the entering dry bulb');
        var adpW = satHumRatio(adpDb, P);
        if (adpW > entering.w) {
            throw new Error('ADP is wetter than the entering air; use a lower ADP');
        }
        var db = adpDb + bf * (entering.db - adpDb);
        var w = adpW + bf * (entering.w - adpW);
        return {
            state: fromDbW(db, w, P),
            adp: fromDbW(adpDb, adpW, P),
            bf: bf
        };
    }

    // Extend the entering -> leaving line until it meets the saturation
    // curve; that intersection is the ADP. Returns null when the process
    // is not a cooling process or the line never reaches saturation.
    function adpFromLeaving(entering, leaving, P) {
        var ddb = leaving.db - entering.db;
        var dw = leaving.w - entering.w;
        if (ddb >= -1e-6) return null;
        // point(t) = leaving + t * (leaving - entering), t >= 0
        function f(t) {
            var db = leaving.db + t * ddb;
            var w = leaving.w + t * dw;
            return satHumRatio(db, P) - w;   // > 0 while below saturation
        }
        // Search only while the line still has positive humidity ratio
        // and stays above -100 F; past W = 0 the sign test is meaningless.
        var tMax = (leaving.db + 100) / (-ddb);
        if (dw < 0) tMax = Math.min(tMax, leaving.w / (-dw));
        if (tMax <= 0) return null;
        if (f(0) < 0) return null;
        // Scan for the first crossing (the sign can flip back near W = 0
        // where the saturation curve is barely above zero), then bisect.
        var steps = 400, lo = 0, hi = -1;
        for (var k = 1; k <= steps; k++) {
            var tk = tMax * k / steps;
            if (f(tk) < 0) { hi = tk; break; }
            lo = tk;
        }
        if (hi < 0) return null;
        for (var i = 0; i < 50; i++) {
            var mid = (lo + hi) / 2;
            if (f(mid) > 0) lo = mid; else hi = mid;
        }
        var t = (lo + hi) / 2;
        var adpDb = leaving.db + t * ddb;
        var adp = fromDbWClamped(adpDb, satHumRatio(adpDb, P), P);
        var bf = (leaving.db - adpDb) / (entering.db - adpDb);
        return { adp: adp, bf: bf };
    }

    // ----- Adiabatic (evaporative) process along the wet-bulb line -----

    function evap(entering, effPct, P) {
        var eff = Number(effPct) / 100;
        if (!isFinite(eff) || eff < 0 || eff > 1) throw new Error('Effectiveness must be 0 to 100%');
        var dbOut = entering.db - eff * (entering.db - entering.wb);
        var w = lib.GetHumRatioFromTWetBulb(dbOut, entering.wb, P);
        return fromDbWClamped(dbOut, w, P);
    }

    // ----- Steam humidification at (essentially) constant dry bulb -----

    function steam(entering, key, value, P) {
        var target = state(entering.db, key, value, P);
        if (target.w < entering.w - 1e-9) {
            throw new Error('Target humidity is below the entering air; a humidifier can only add moisture');
        }
        return target;
    }

    // ----- Fan / motor heat -----
    // opts: { mode: 'bhp', bhp, motorIn (bool), motorEff (%) } or { mode: 'dt', dt (F) }
    function fanHeat(entering, opts, massLbHr, P) {
        var q, dt;
        var cp = cpMoist(entering.w);
        if (opts.mode === 'dt') {
            dt = Number(opts.dt);
            if (!isFinite(dt) || dt < 0) throw new Error('Enter the fan temperature rise');
            q = massLbHr * cp * dt;
        } else {
            var bhp = Number(opts.bhp);
            if (!isFinite(bhp) || bhp < 0) throw new Error('Enter the fan brake horsepower');
            q = bhp * BTUH_PER_HP;
            if (opts.motorIn) {
                var eff = Number(opts.motorEff) / 100;
                if (!isFinite(eff) || eff <= 0 || eff > 1) throw new Error('Motor efficiency must be 1 to 100%');
                q += bhp * BTUH_PER_HP * (1 / eff - 1);
            }
            dt = massLbHr > 0 ? q / (massLbHr * cp) : 0;
        }
        return { state: sensible(entering, entering.db + dt, P), q: q, dt: dt };
    }

    // ----- Energy recovery (wheel / plate) on the outdoor air -----
    // Exhaust is taken at the return-air condition. `flowRatio` is
    // exhaust mass flow over outdoor mass flow, capped at 1: AHRI 1060
    // effectiveness is referenced to the smaller stream, so when the
    // exhaust is the smaller one the outdoor air changes proportionally
    // less.
    function erv(oa, exhaust, effSPct, effLPct, P, flowRatio) {
        var es = Number(effSPct) / 100, el = Number(effLPct) / 100;
        if (!isFinite(es) || es < 0 || es > 1) throw new Error('Sensible effectiveness must be 0 to 100%');
        if (!isFinite(el) || el < 0 || el > 1) throw new Error('Latent effectiveness must be 0 to 100%');
        var k = (isFinite(flowRatio) && flowRatio >= 0) ? Math.min(1, flowRatio) : 1;
        var db = oa.db - es * k * (oa.db - exhaust.db);
        var w = oa.w - el * k * (oa.w - exhaust.w);
        if (w < 0) w = 0;
        return fromDbWClamped(db, w, P);
    }

    // ----- Room sensible-heat-ratio line -----
    // Points (db, w) from the room state toward lower dry bulb such that
    // every point delivers the room's SHR. Stops at saturation.
    function roomLine(room, shr, P, dbMin) {
        shr = Number(shr);
        if (!isFinite(shr) || shr <= 0 || shr > 1) return [];
        var pts = [{ db: room.db, w: room.w }];
        var cp = cpMoist(room.w);
        for (var db = room.db - 0.5; db >= dbMin; db -= 0.5) {
            var qs = cp * (room.db - db);
            var h = room.h - qs / shr;
            var w = lib.GetHumRatioFromEnthalpyAndTDryBulb(h, db);
            if (w < 0) break;
            var wsat = satHumRatio(db, P);
            if (w > wsat) { pts.push({ db: db, w: wsat }); break; }
            pts.push({ db: db, w: w });
        }
        return pts;
    }

    // Supply state that meets room sensible + latent loads.
    //   given.cfm      -> solve supply dry bulb (and humidity)
    //   given.dbSupply -> solve CFM (and humidity)
    function supplyFromRoom(room, qs, ql, given, basis, P) {
        qs = Number(qs); ql = Number(ql);
        if (!isFinite(qs) || qs <= 0) throw new Error('Enter the room sensible load');
        if (!isFinite(ql) || ql < 0) throw new Error('Room latent load cannot be negative');
        var cp = cpMoist(room.w);
        var m, dbS, cfm;
        if (given.cfm !== undefined && given.cfm !== null) {
            cfm = Number(given.cfm);
            if (!isFinite(cfm) || cfm <= 0) throw new Error('Enter the supply airflow');
            m = massFlow(room, cfm, basis);
            dbS = room.db - qs / (m * cp);
        } else {
            dbS = Number(given.dbSupply);
            if (!isFinite(dbS) || dbS >= room.db) throw new Error('Supply dry bulb must be below the room dry bulb');
            m = qs / (cp * (room.db - dbS));
            cfm = cfmFromMass(room, m, basis);
        }
        var h = room.h - (qs + ql) / m;
        var w = lib.GetHumRatioFromEnthalpyAndTDryBulb(h, dbS);
        var feasible = true, note = null;
        if (w < 0) { w = 0; feasible = false; note = 'Latent load exceeds what this airflow can carry'; }
        var wsat = satHumRatio(dbS, P);
        if (w > wsat) { w = wsat; feasible = false; note = 'Required supply state is above saturation; raise the airflow or lower the supply temperature'; }
        // Actual-air basis: CFM depends on the supply volume, so refine once.
        if (basis === 'actual' && given.cfm !== undefined && given.cfm !== null) {
            var st0 = fromDbW(dbS, w, P);
            m = massFlow(st0, cfm, basis);
            dbS = room.db - qs / (m * cp);
            h = room.h - (qs + ql) / m;
            w = Math.max(0, Math.min(lib.GetHumRatioFromEnthalpyAndTDryBulb(h, dbS), satHumRatio(dbS, P)));
        }
        return {
            state: fromDbW(dbS, w, P),
            massFlow: m,
            cfm: basis === 'actual' ? cfmFromMass(fromDbW(dbS, w, P), m, basis) : cfm,
            shr: qs / (qs + ql),
            feasible: feasible,
            note: note
        };
    }

    // ----- Ventilation latent limit ("Law #1") -----
    // Moisture the air can absorb between the space and the supply state:
    //   Q_latent = m x HFG_LATENT x (W_space - W_supply)
    // With standard air (m = 4.5 x CFM) and W in grains this is the
    // familiar 0.69 x CFM x delta-grains rule (4.5 x 1076 / 7000 = 0.69),
    // the form manufacturers quote for dedicated outdoor air design.
    var HFG_LATENT = 1076; // Btu per lb of water vapor

    // The wettest supply state (humidity ratio / dew point) at which `cfm`
    // of air still removes `ql` Btu/h of latent load from the room.
    function latentLimit(room, ql, cfm, basis, P) {
        ql = Number(ql); cfm = Number(cfm);
        if (!isFinite(ql) || ql < 0) throw new Error('Room latent load cannot be negative');
        if (!isFinite(cfm) || cfm <= 0) throw new Error('Enter the airflow for the latent check');
        var m = massFlow(room, cfm, basis);
        var dW = ql / (m * HFG_LATENT);
        var w = room.w - dW;
        if (w <= 0) throw new Error('This airflow cannot carry the latent load at any dew point; raise the airflow');
        var st = fromDbW(room.db, w, P);
        return {
            state: st,
            w: w,
            dp: st.dp,
            grains: w * GRAINS_PER_LB,
            dW: dW,
            massFlow: m,
            cfm: cfm,
            factor: HFG_LATENT * (m / cfm) / GRAINS_PER_LB   // Btu/h per CFM per gr/lb; 0.69 for standard air
        };
    }

    // Latent load a dry-air mass flow removes going from `room` to `supply`.
    function latentCarried(room, supply, massLbHr) {
        return massLbHr * HFG_LATENT * (room.w - supply.w);
    }

    // ----- Economizer check -----
    // opts: { mode: 'db' | 'enthalpy', limitDb (F, fixed high limit) }
    function economizer(oa, ra, opts) {
        var dbDiff = ra.db - oa.db;   // > 0: OA cooler than RA
        var hDiff = ra.h - oa.h;      // > 0: OA lower enthalpy than RA
        var limit = Number(opts.limitDb);
        var belowLimit = isFinite(limit) ? oa.db <= limit : true;
        var ok, reason;
        if (opts.mode === 'enthalpy') {
            ok = hDiff > 0 && belowLimit;
            reason = hDiff > 0
                ? 'Outdoor air enthalpy is ' + hDiff.toFixed(2) + ' Btu/lb below return air'
                : 'Outdoor air enthalpy is ' + (-hDiff).toFixed(2) + ' Btu/lb above return air';
        } else {
            ok = dbDiff > 0 && belowLimit;
            reason = dbDiff > 0
                ? 'Outdoor air is ' + dbDiff.toFixed(1) + ' °F cooler than return air'
                : 'Outdoor air is ' + (-dbDiff).toFixed(1) + ' °F warmer than return air';
        }
        if (!belowLimit) reason += '; above the ' + limit + ' °F high limit';
        return { ok: ok, dbDiff: dbDiff, hDiff: hDiff, belowLimit: belowLimit, reason: reason };
    }

    // ----- Condensate + drain size (IMC 307.2.2, by cooling capacity) -----
    var DRAIN_SIZES = [
        { maxTons: 20,  size: '3/4 in' },
        { maxTons: 40,  size: '1 in' },
        { maxTons: 90,  size: '1 1/4 in' },
        { maxTons: 125, size: '1 1/2 in' },
        { maxTons: 250, size: '2 in' }
    ];

    function condensate(lbhr, tons) {
        var galhr = Math.max(0, lbhr) / LB_PER_GAL;
        var size = null;
        for (var i = 0; i < DRAIN_SIZES.length; i++) {
            if (tons <= DRAIN_SIZES[i].maxTons) { size = DRAIN_SIZES[i].size; break; }
        }
        return {
            lbhr: lbhr,
            galhr: galhr,
            galday: galhr * 24,
            drainSize: size || 'Over 250 tons: engineer the drain'
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

    function volume(db, w, P) {
        return lib.GetMoistAirVolume(db, w, P);
    }

    // Dry bulb at which the saturation curve reaches enthalpy h (bisection).
    function satDbForEnthalpy(h, P, lo, hi) {
        lo = lo === undefined ? -100 : lo;
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
        lo = lo === undefined ? -100 : lo;
        hi = hi === undefined ? 150 : hi;
        for (var i = 0; i < 60; i++) {
            var mid = (lo + hi) / 2;
            var vm = lib.GetMoistAirVolume(mid, satHumRatio(mid, P), P);
            if (vm < v) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    // Generic: dry bulb where the saturation curve satisfies fn(db, wsat) = 0
    // with fn increasing in db.
    function satDbWhere(fn, P, lo, hi) {
        lo = lo === undefined ? -100 : lo;
        hi = hi === undefined ? 150 : hi;
        for (var i = 0; i < 60; i++) {
            var mid = (lo + hi) / 2;
            if (fn(mid, satHumRatio(mid, P)) < 0) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    HHpro.Psychro = {
        INPUT_KEYS: INPUT_KEYS,
        GRAINS_PER_LB: GRAINS_PER_LB,
        STD_AIR_DENSITY: STD_AIR_DENSITY,
        LB_PER_GAL: LB_PER_GAL,
        pressureFromAltitude: pressureFromAltitude,
        inHgFromPsi: function (psi) { return psi * INHG_PER_PSI; },
        cpMoist: cpMoist,
        state: state,
        fromDbW: fromDbW,
        fromDbWClamped: fromDbWClamped,
        massFlow: massFlow,
        cfmFromMass: cfmFromMass,
        mix: mix,
        process: process,
        sensible: sensible,
        reheat: reheat,
        coilFromAdp: coilFromAdp,
        adpFromLeaving: adpFromLeaving,
        evap: evap,
        steam: steam,
        fanHeat: fanHeat,
        erv: erv,
        roomLine: roomLine,
        supplyFromRoom: supplyFromRoom,
        latentLimit: latentLimit,
        latentCarried: latentCarried,
        HFG_LATENT: HFG_LATENT,
        economizer: economizer,
        condensate: condensate,
        satHumRatio: satHumRatio,
        humRatioFromWb: humRatioFromWb,
        humRatioFromRh: humRatioFromRh,
        humRatioFromEnthalpy: humRatioFromEnthalpy,
        humRatioFromVolume: humRatioFromVolume,
        enthalpy: enthalpy,
        volume: volume,
        satDbForEnthalpy: satDbForEnthalpy,
        satDbForVolume: satDbForVolume,
        satDbWhere: satDbWhere
    };
})();
