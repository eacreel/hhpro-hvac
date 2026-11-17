/* ============================================================
   HHpro - Search by need (top search bar)
   ------------------------------------------------------------
   The header search finds model numbers (quick_lookup.js). This
   adds plain-language equipment searches to the same box:

     "10 ton heat pump RTU"         -> LC RTUs, SIZE 10, TYPE HEAT PUMP
     "3 zone multi split"           -> Mini & Multi Splits, Multi, 3 units
     "12000 btu wall mounted mini"  -> 1:1 mini split, 1 ton, Wall Mounted
     "2 ton apartment air handler"  -> Split systems, 2 ton, Apartment Style
     "400 cfm return grille"        -> Design Search, Price Grilles, 400 CFM
     "15 hp vfd", "5 kw wall heater", "24 x 24 canopy", ...

   HHpro.NeedSearch.suggest(query) -> up to 3 suggestions
       [{ productKey, title, chips: [...], action, go() }]
   go() opens the product page with its filters preset
   (params.initialFilters), or Design Search with a target filled
   in and run (params.preset) when the need is an airflow.

   It reads the product JSONs quick_lookup.js already loaded for
   the model index (HHpro.Data.getLoadedProduct), so a size is
   snapped to one the product really has: exact, else the next
   size up ("9 tons" -> 10 tons, shown as "closest size up").
   Products this account can't see are never suggested.

   The vocabulary lives in the tables below: add a phrase there
   to teach it a new word for a product or option.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var MAX_SUGGESTIONS = 3;

    // Phrases that name a product. All products' phrases are matched
    // longest first and each match is used up, so "mini split" never
    // also counts as "split" and "water source heat pump" never as
    // "heat pump".
    var PRODUCT_WORDS = {
        gas_packs: ['light commercial rtus', 'light commercial rtu', 'rooftop units', 'rooftop unit',
                    'roof top unit', 'rooftops', 'rooftop', 'roof top', 'rtus', 'rtu', 'packaged units',
                    'packaged unit', 'package unit', 'packaged', 'gas packs', 'gas pack', 'gaspack'],
        mini_splits: ['mini splits', 'mini split', 'mini-splits', 'mini-split', 'minisplit', 'ductless',
                      'multi splits', 'multi split', 'multi-split', 'multisplit', 'multi zone',
                      'multi-zone', 'multizone', 'minis', 'mini'],
        multi_position_splits: ['split systems', 'split system', 'air handlers', 'air handler', 'ahus',
                                'ahu', 'multi position', 'multi-position', 'multiposition',
                                'condensing units', 'condensing unit', 'splits', 'split'],
        gas_splits: ['gas splits', 'gas split', 'gas furnaces', 'gas furnace', 'furnaces', 'furnace'],
        wshp: ['water source heat pumps', 'water source heat pump', 'water-source', 'water source',
               'wshps', 'wshp', 'geothermal', 'ground source'],
        marvair: ['marvair', 'vertical wall mount', 'wall mount units', 'wall mount unit', 'wall-mount',
                  'wall mount'],
        markel: ['electric unit heaters', 'electric heaters', 'electric heater', 'unit heaters', 'unit heater',
                 'wall heaters', 'wall heater', 'cabinet heaters', 'cabinet heater', 'heaters', 'heater',
                 'markel'],
        vfds: ['variable frequency drives', 'variable frequency drive', 'variable speed drive', 'vfds',
               'vfd', 'drives', 'drive', 'abb'],
        diffusers: ['ceiling diffusers', 'ceiling diffuser', 'diffusers', 'diffuser'],
        grilles: ['grilles', 'grille', 'grills', 'grill', 'registers', 'register'],
        vav: ['vav boxes', 'vav box', 'vavs', 'vav', 'terminal units', 'terminal unit', 'sdv', 'single duct'],
        rac: ['return air canopies', 'return air canopy', 'canopies', 'canopy', 'rac'],
        gps: ['bipolar ionization', 'needlepoint', 'ionization', 'ionizers', 'ionizer', 'gps'],
        islandaire: ['packaged terminal air conditioners', 'packaged terminal air conditioner',
                     'packaged terminal', 'vertical terminal', 'ptacs', 'ptac', 'vtacs', 'vtac',
                     'islandaire'],
        santa_fe: ['dehumidifiers', 'dehumidifier', 'dehumidification', 'dehu', 'santa-fe', 'santa fe']
    };

    // When no product is named, what a unit points at (in this order).
    var BY_UNIT = {
        kw: ['markel'],
        hp: ['vfds'],
        cfm: ['grilles', 'diffusers', 'vav'],
        tons: ['gas_packs', 'multi_position_splits', 'mini_splits', 'gas_splits', 'marvair'],
        btu: ['mini_splits', 'wshp', 'multi_position_splits']
    };

    // Design Search airflow target (searchSchema col) per air product.
    var AIRFLOW_TARGET = { grilles: 'I', diffusers: 'X', vav: 'D', rac: 'C' };

    HHpro.NeedSearch = {
        suggest: suggest,
        parse: parse
    };

    // =================================================================
    // Parse
    // =================================================================

    function num(s) { return parseFloat(String(s)); }

    function parse(query) {
        var t = ' ' + String(query || '').toLowerCase()
            .replace(/(\d),(?=\d{3}\b)/g, '$1')
            .replace(/[‘’“”]/g, '"')
            .replace(/\s+/g, ' ') + ' ';
        var f = { text: t };
        var m;

        if ((m = /(\d+(?:\.\d+)?)\s*-?\s*(?:tons?|tn)\b/.exec(t))) f.tons = num(m[1]);
        if ((m = /(\d+(?:\.\d+)?)\s*mbh\b/.exec(t))) f.btu = num(m[1]) * 1000;
        if ((m = /(\d+(?:\.\d+)?)\s*(k)?\s*(?:btu\/?hr?|btuh|btus?)\b/.exec(t))) {
            f.btu = num(m[1]) * (m[2] ? 1000 : 1);
        } else if (f.btu == null && (m = /\b(\d+(?:\.\d+)?)\s*k\b/.exec(t))) {
            f.btu = num(m[1]) * 1000;
        }
        if ((m = /(\d+(?:\.\d+)?)\s*cfm\b/.exec(t))) f.cfm = num(m[1]);
        if ((m = /(\d+(?:\.\d+)?)\s*kw\b/.exec(t))) f.kw = num(m[1]);
        if ((m = /(\d+(?:\.\d+)?)\s*(?:hp|horsepower)\b/.exec(t))) f.hp = num(m[1]);
        if ((m = /\b(\d)\s*-?\s*(?:zones?|heads?|indoor units?|indoors?|ports?)\b/.exec(t))) f.zones = num(m[1]);
        else if ((m = /\b([2-5])\s*:\s*1\b/.exec(t))) f.zones = num(m[1]);
        // A voltage needs a V / volts, a "/phase", or one of the clearly
        // electrical values - so "120 cfm" isn't read as 120 V.
        var vre = /\b(115|120|208|230|240|277|460|480)(\s*(?:v\b|volts?\b))?(?:\s*\/\s*(?:60\s*\/\s*)?([13])\b)?(?!\s*(?:cfm|btu|mbh|kw|hp|tons?|x|by|"|in\b|inch|k\b))/g;
        while ((m = vre.exec(t))) {
            if (m[2] || m[3] || /^(208|230|277|460|480)$/.test(m[1])) {
                f.volt = m[1];
                if (m[3]) f.phase = m[3];
                break;
            }
        }
        if (!f.phase && (m = /\b([13])\s*-?\s*(?:ph|phase)\b/.exec(t))) f.phase = m[1];
        if (!f.phase && /\bsingle\s*phase\b/.test(t)) f.phase = '1';
        if (!f.phase && /\bthree\s*phase\b/.test(t)) f.phase = '3';
        if ((m = /\b(\d{1,2})\s*(?:x|by)\s*(\d{1,2})\b/.exec(t))) f.dims = m[1] + ' x ' + m[2];
        if ((m = /\b(\d{1,2})\s*(?:"|in\b|inch(?:es)?\b|-inch\b)/.exec(t))) f.inch = num(m[1]);

        // "hp" with no number in front of it means heat pump.
        var noHpNumber = t.replace(/(\d+(?:\.\d+)?)\s*(?:hp|horsepower)\b/g, ' ');
        f.heatPump = /\bheat\s*pumps?\b/.test(t) || /\bhp\b/.test(noHpNumber);
        f.coolingOnly = /\bcooling\s*only\b|\bstraight\s*cool|\ba\s*\/\s*c\b|\bac\b|\bair\s*condition/.test(t);
        f.gas = /\bgas\b/.test(t);
        f.supply = /\bsupply\b/.test(t);
        f.ret = /\breturns?\b/.test(t);
        f.horizontal = /\bhorizontal\b/.test(t);
        f.vertical = /\bvertical\b/.test(t);
        f.multi = /\bmulti[\s-]*(?:splits?|zones?)\b|\bmultisplit|\bmultizone/.test(t) ||
                  (f.zones != null && f.zones > 1);
        f.single = /\b1\s*:\s*1\b|\bone\s*to\s*one\b|\bsingle[\s-]*zone\b/.test(t) || f.zones === 1;

        f.products = matchProducts(t);
        return f;
    }

    // Products named in the text, in the order of their first mention.
    function matchProducts(t) {
        var phrases = [];
        Object.keys(PRODUCT_WORDS).forEach(function (key) {
            PRODUCT_WORDS[key].forEach(function (p) { phrases.push({ key: key, p: p }); });
        });
        phrases.sort(function (a, b) { return b.p.length - a.p.length; });
        var work = t;
        var found = [];
        phrases.forEach(function (ph) {
            var re = new RegExp('(^|[^a-z0-9])' + escapeRe(ph.p) + '(?=$|[^a-z0-9])');
            var m = re.exec(work);
            if (!m) return;
            var at = m.index + m[1].length;
            found.push({ key: ph.key, at: at });
            work = work.slice(0, at) + new Array(ph.p.length + 1).join(' ') + work.slice(at + ph.p.length);
        });
        found.sort(function (a, b) { return a.at - b.at; });
        var keys = [];
        found.forEach(function (x) { if (keys.indexOf(x.key) < 0) keys.push(x.key); });
        return keys;
    }

    function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    // =================================================================
    // Suggest
    // =================================================================

    function suggest(query) {
        var f = parse(query);
        var hasUnit = f.tons != null || f.btu != null || f.cfm != null || f.kw != null || f.hp != null;
        var keys = f.products.slice();
        if (!keys.length) {
            if (f.kw != null) keys = BY_UNIT.kw;
            else if (f.hp != null) keys = BY_UNIT.hp;
            else if (f.cfm != null) keys = BY_UNIT.cfm;
            else if (f.zones != null || f.multi) keys = ['mini_splits'];
            else if (f.tons != null) keys = BY_UNIT.tons;
            else if (f.btu != null) keys = BY_UNIT.btu;
            else if (f.heatPump || f.coolingOnly) keys = ['gas_packs', 'multi_position_splits', 'mini_splits'];
            else return [];
        }
        var allowed = {};
        HHpro.Data.getProducts().forEach(function (p) { allowed[p.productKey] = p; });

        var out = [];
        keys.forEach(function (key) {
            if (out.length >= MAX_SUGGESTIONS || !allowed[key]) return;
            var data = HHpro.Data.getLoadedProduct(key);
            if (!data) return;
            var s = BUILDERS[key] ? BUILDERS[key](f, data, allowed[key]) : null;
            if (!s) return;
            // A size the product doesn't come in: skip it when it was only
            // guessed from the unit, not named.
            if (s.offSize && f.products.indexOf(key) < 0) return;
            s.productKey = key;
            s.title = allowed[key].displayName;
            out.push(s);
        });
        void hasUnit;
        return out;
    }

    // =================================================================
    // Per product: filters (or a Design Search preset) + chips
    // =================================================================

    function plan(productKey) {
        return { filters: {}, chips: [], productKey: productKey };
    }

    function openProduct(p) {
        return function () {
            HHpro.App.showView('product', { productKey: p.productKey, initialFilters: p.filters });
        };
    }

    function finish(p, action) {
        return {
            chips: p.chips,
            action: action || 'Open schedule',
            offSize: !!p.offSize,
            go: openProduct(p)
        };
    }

    // Tons, from tons or BTU/h.
    function tonsOf(f) {
        if (f.tons != null) return f.tons;
        if (f.btu != null) return f.btu / 12000;
        return null;
    }

    function setSize(p, data, filter, want, unit, format) {
        if (want == null) return;
        var hit = pickNumber(data, filter, want);
        if (!hit) return;
        p.filters[filter] = hit.value;
        var u = (unit === 'tons' && parseFloat(hit.value) === 1) ? 'ton' : unit;
        var shown = format ? format(hit.value) : fmtNum(hit.value) + ' ' + u;
        p.chips.push(hit.exact ? shown : shown + ' (closest size up)');
        if (!hit.exact && hit.below) p.offSize = true;
    }

    function setText(p, data, filter, want, chip) {
        if (!want) return;
        var v = pickText(data, filter, want);
        if (v == null) return;
        p.filters[filter] = v;
        p.chips.push(chip || titleCase(String(v)));
    }

    function setElectrical(p, data, filter, f) {
        if (!f.volt) return;
        var v = pickElectrical(data, filter, f.volt, f.phase);
        if (v == null) return;
        p.filters[filter] = v;
        p.chips.push(String(v));
    }

    function heatOrCool(f, heat, cool) {
        if (f.heatPump) return heat;
        if (f.coolingOnly) return cool;
        return null;
    }

    // A heat pump / cooling only filter, with the same chip wording on
    // every product.
    function setHeatCool(p, data, filter, f, heat, cool) {
        var want = heatOrCool(f, heat, cool);
        setText(p, data, filter, want, want === heat ? 'Heat pump' : 'Cooling only');
    }

    var BUILDERS = {
        gas_packs: function (f, data) {
            var p = plan('gas_packs');
            setSize(p, data, 'SIZE', tonsOf(f), 'tons');
            setText(p, data, 'TYPE', f.heatPump ? 'HEAT PUMP' : (f.gas ? 'GAS' : null),
                    f.heatPump ? 'Heat pump' : 'Gas');
            setElectrical(p, data, 'ELECTRICAL', f);
            return finish(p);
        },

        multi_position_splits: function (f, data) {
            var p = plan('multi_position_splits');
            setSize(p, data, 'SIZE', tonsOf(f), 'tons');
            setHeatCool(p, data, 'COOLING ONLY OR HEAT PUMP', f, 'HEAT PUMP', 'COOLING ONLY');
            var style = /\bapartment\b/.test(f.text) ? 'APARTMENT'
                : /\bceiling\b/.test(f.text) ? 'CEILING'
                : /\bmulti[\s-]*position\b|\bmultiposition\b/.test(f.text) ? 'MULTI POSITION' : null;
            if (style) setText(p, data, 'PHOTO FILTER', style, titleCase(style) + ' air handler');
            return finish(p);
        },

        gas_splits: function (f, data) {
            var p = plan('gas_splits');
            setSize(p, data, 'SIZE', tonsOf(f), 'tons');
            return finish(p);
        },

        marvair: function (f, data) {
            var p = plan('marvair');
            setSize(p, data, 'TONS', tonsOf(f), 'tons');
            setHeatCool(p, data, 'HEAT PUMP OR AC', f, 'HEAT PUMP', 'COOLING ONLY');
            setElectrical(p, data, 'ELECTRICAL', f);
            return finish(p);
        },

        mini_splits: function (f, data) {
            var p = plan('mini_splits');
            var type = miniType(f);
            // The photo-card types are 1:1 indoor units; a type with no
            // zone count reads as a 1:1 system.
            var multi = f.multi && !f.single;
            var single = f.single || (!multi && !!type && f.zones == null);
            if (multi) {
                setText(p, data, 'SYSTEM TYPE', 'MULTI SPLITS', 'Multi split');
                if (f.zones > 1) {
                    p.filters['NUMBER OF INDOOR UNITS'] = f.zones;
                    p.chips.push(f.zones + ' indoor units');
                }
            } else if (single) {
                setText(p, data, 'SYSTEM TYPE', '1:1 MINI SPLITS', '1:1 mini split');
                p.filters['NUMBER OF INDOOR UNITS'] = 1;
            }
            setSize(p, data, 'SIZE (OUTDOOR UNIT)', tonsOf(f), 'tons');
            setHeatCool(p, data, 'COOLING ONLY OR HEAT PUMP', f, 'HEAT PUMP', 'COOLING ONLY');
            if (type && (single || f.zones > 1)) {
                var want = type;
                if (type === 'FLOOR MOUNTED' && single) {
                    want = /\bblack\b/.test(f.text) ? 'FLOOR MOUNTED (BLACK)' : 'FLOOR MOUNTED (WHITE)';
                }
                setText(p, data, 'TYPE (INDOOR UNIT #1)', want);
            }
            return finish(p);
        },

        wshp: function (f, data) {
            var p = plan('wshp');
            var btu = f.btu != null ? f.btu : (f.tons != null ? f.tons * 12000 : null);
            setSize(p, data, 'Nominal BTU/H', btu, 'BTU/H');
            setText(p, data, 'Horizontal or Vertical', f.horizontal ? 'HORIZONTAL' : (f.vertical ? 'VERTICAL' : null));
            setElectrical(p, data, 'Electrical', f);
            return finish(p);
        },

        markel: function (f, data) {
            var p = plan('markel');
            var type = /\bsuspend|\bunit\s*heaters?\b|\bhanging\b|\bceiling\b/.test(f.text) ? 'SUSPENDED'
                : /\bwall\b|\bcabinet\b/.test(f.text) ? 'WALL' : null;
            setText(p, data, 'Type', type, type ? titleCase(type) + ' heater' : null);
            setSize(p, data, 'KW', f.kw, 'kW');
            setElectrical(p, data, 'Voltage/Phase', f);
            return finish(p);
        },

        vfds: function (f, data) {
            var p = plan('vfds');
            setSize(p, data, 'HP', f.hp, 'HP');
            return finish(p);
        },

        grilles: function (f, data) {
            var p = plan('grilles');
            setText(p, data, 'APPLICATION', f.ret ? 'RETURN' : (f.supply ? 'SUPPLY' : null));
            setText(p, data, 'DESCRIPTION', grilleDesc(f));
            if (f.dims) setText(p, data, 'SIZE', f.dims, f.dims);
            return airflowOrSchedule(p, f, 'grilles');
        },

        diffusers: function (f, data) {
            var p = plan('diffusers');
            setText(p, data, 'DESCRIPTION', diffuserDesc(f));
            if (f.dims) setText(p, data, 'FACE SIZE', f.dims, f.dims + ' face');
            if (f.inch != null) setText(p, data, 'NECK SIZE', String(f.inch), f.inch + '" neck');
            return airflowOrSchedule(p, f, 'diffusers');
        },

        vav: function (f, data) {
            var p = plan('vav');
            if (f.inch != null) setText(p, data, 'SIZE', String(f.inch), 'Size ' + f.inch);
            return airflowOrSchedule(p, f, 'vav');
        },

        rac: function (f, data) {
            var p = plan('rac');
            if (f.dims) setText(p, data, 'DIMENSIONS', f.dims, f.dims);
            return airflowOrSchedule(p, f, 'rac');
        },

        gps: function (f, data) {
            void data;
            return finish(plan('gps'), 'Open product');
        },

        islandaire: function (f, data) {
            var p = plan('islandaire');
            var type = /\bvtacs?\b|\bvertical\b/.test(f.text) ? 'VTAC'
                : /\bptacs?\b/.test(f.text) ? 'PTAC' : null;
            setText(p, data, 'TYPE', type, type);
            var btu = f.btu != null ? f.btu : (f.tons != null ? f.tons * 12000 : null);
            setSize(p, data, 'NOMINAL BTUH COOLING', btu, 'BTU/H');
            setElectrical(p, data, 'ELECTRICAL', f);
            return finish(p);
        },

        santa_fe: function (f, data) {
            void data;
            return finish(plan('santa_fe'), 'Open product');
        }
    };

    // An airflow need opens Design Search with the target filled in (the
    // filters picked so far ride along); otherwise the schedule.
    function airflowOrSchedule(p, f, key) {
        var col = AIRFLOW_TARGET[key];
        var product = HHpro.Data.getProduct(key);
        if (f.cfm == null || !col || (product && product.excludeFromDesignSearch) ||
            !HHpro.Views.design_search) {
            return finish(p);
        }
        var targets = {};
        targets[col] = f.cfm;
        var chips = [fmtNum(f.cfm) + ' CFM'].concat(p.chips);
        return {
            chips: chips,
            action: 'Design Search',
            go: function () {
                HHpro.App.showView('design_search', {
                    productKey: key,
                    preset: { token: Date.now() + Math.random(), targets: targets, filters: p.filters }
                });
            }
        };
    }

    function miniType(f) {
        var t = f.text;
        if (/\bcassettes?\b/.test(t)) return 'CASSETTE';
        if (/\bducted\b|\bconcealed\b/.test(t)) return 'DUCTED CONCEALED';
        if (/\bfloor\b|\bconsole\b/.test(t)) return 'FLOOR MOUNTED';
        if (/\bair\s*handlers?\b|\bmulti[\s-]*position\b/.test(t)) return 'AIR HANDLER';
        if (/\bwall\b|\bhigh\s*wall\b/.test(t)) return 'WALL MOUNTED';
        return null;
    }

    function grilleDesc(f) {
        var t = f.text;
        if (/\begg\s*crate\b|\beggcrate\b/.test(t)) return 'EGG CRATE';
        if (/\blinear\b|\bbar\b/.test(t)) return 'LINEAR BAR';
        if (/\bperforated\b|\bperf\b/.test(t)) return 'PERFORATED';
        if (/\bgym\b/.test(t)) return f.ret ? 'HEAVY DUTY RETURN GYM' : 'ADJUSTABLE STEEL HEAVY DUTY GYM';
        if (/\blouvered\b/.test(t)) return f.ret ? 'LOUVERED RETURN' : 'LOUVERED SUPPLY';
        return null;
    }

    function diffuserDesc(f) {
        var t = f.text;
        if (/\bperforated\b|\bperf\b/.test(t)) return 'PERFORATED RETURN';
        if (/\bslot\b|\blinear\b/.test(t)) return 'LINEAR SLOT';
        if (/\bcone\b/.test(t)) return /\badj/.test(t) ? 'SQUARE CONE ADJ' : 'SQUARE CONE DIFFUSER';
        if (/\bplaque\b/.test(t)) return f.ret ? 'SQUARE PLAQUE RETURN' : 'SQUARE PLAQUE DIFFUSER';
        if (/\bmodular\b|\blouvered\b/.test(t)) {
            return /\bround\b/.test(t) ? 'MODULAR LOUVERED FACE DIFFUSER (SQUARE' : 'MODULAR LOUVERED FACE DIFFUSER';
        }
        return null;
    }

    // =================================================================
    // Snapping to the values a product really has
    // =================================================================

    function values(data, filter) {
        data.__needValues = data.__needValues || {};
        if (data.__needValues[filter]) return data.__needValues[filter];
        var seen = {};
        var out = [];
        (data.selections || []).forEach(function (sel) {
            var fd = sel.rows && sel.rows[0] && sel.rows[0].filterData;
            var v = fd && fd[filter];
            if (v === null || v === undefined || v === '' || v === '-') return;
            var k = String(v);
            if (seen[k]) return;
            seen[k] = true;
            out.push(v);
        });
        data.__needValues[filter] = out;
        return out;
    }

    // { value, exact, below } - exact, else the smallest size above, else
    // the largest (below: the product doesn't go that big).
    function pickNumber(data, filter, want) {
        var best = null;
        var biggest = null;
        values(data, filter).forEach(function (v) {
            var n = parseFloat(v);
            if (!isFinite(n)) return;
            if (biggest === null || n > parseFloat(biggest)) biggest = v;
            if (n >= want - 1e-9 && (best === null || n < parseFloat(best))) best = v;
        });
        if (best !== null) return { value: best, exact: Math.abs(parseFloat(best) - want) < 1e-9 };
        if (biggest !== null) return { value: biggest, exact: false, below: true };
        return null;
    }

    // Exact (case-insensitive), else starts with, else contains.
    function pickText(data, filter, want) {
        var w = String(want).toUpperCase();
        var vals = values(data, filter);
        var hit = null;
        [function (u) { return u === w; },
         function (u) { return u.indexOf(w) === 0; },
         function (u) { return u.indexOf(w) >= 0; }].some(function (test) {
            for (var i = 0; i < vals.length; i++) {
                if (test(String(vals[i]).toUpperCase())) { hit = vals[i]; return true; }
            }
            return false;
        });
        return hit;
    }

    // A value starting with the voltage ("208/3", "208/60/1 ...", "460V")
    // and, when a phase was given, ending its "/n" part with it.
    function pickElectrical(data, filter, volt, phase) {
        var vals = values(data, filter).filter(function (v) {
            return String(v).trim().indexOf(String(volt)) === 0;
        });
        if (phase) {
            var withPhase = vals.filter(function (v) {
                var m = /\/\s*(\d)\b(?!.*\/\s*\d)/.exec(String(v));
                return m && m[1] === String(phase);
            });
            if (withPhase.length) return withPhase[0];
            return null;
        }
        return vals.length ? vals[0] : null;
    }

    function fmtNum(v) {
        return (HHpro.Format && HHpro.Format.number) ? HHpro.Format.number(v) : String(v);
    }

    function titleCase(s) {
        return String(s || '').toLowerCase().replace(/(^|[\s(\/-])([a-z])/g, function (m, p, ch) {
            return p + ch.toUpperCase();
        });
    }
})();
