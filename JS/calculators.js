/* ============================================================
   HHpro - Calculators hub view
   ------------------------------------------------------------
   Landing page for the "Calculators" section: one card per
   calculator, each opening its own view. Calculators live in
   their own JS file (psychrometrics.js today) and register
   themselves here at load time:

     HHpro.Calculators.register({
         key: 'psychrometrics',          // unique id
         name: 'Psychrometrics',         // card title
         description: 'Short blurb',     // card sub-text
         icon: 'thermometer',            // HHpro.UI.icon name
         view: 'psychrometrics'          // HHpro.Views key to open
     });

   Adding a new calculator = new JS file + one register() call +
   a <script> tag in index.html after calculators.js. Nothing in
   this file needs to change.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    var registry = [];

    HHpro.Calculators = {
        register: function (def) {
            if (!def || !def.key || !def.view) {
                console.warn('HHpro.Calculators.register: key and view are required');
                return;
            }
            // Re-registering the same key replaces the earlier entry so a
            // hot reload during development never duplicates a card.
            for (var i = 0; i < registry.length; i++) {
                if (registry[i].key === def.key) { registry[i] = def; return; }
            }
            registry.push(def);
        },
        list: function () { return registry.slice(); },
        get: function (key) {
            for (var i = 0; i < registry.length; i++) if (registry[i].key === key) return registry[i];
            return null;
        },
        // Saved calculations live in the project extra 'calculations' as one
        // list shared by every calculator. Each entry: { id, name, savedAt,
        // calc: <registry key>, snapshot }. Entries without `calc` predate the
        // second calculator and belong to psychrometrics. A calculator that
        // wants its saves listed in the project view registers
        // saved: { summarize(snapshot), pdfBlob(snapshot, meta), docType }.
        saved: {
            KEY: 'calculations',
            list: function () {
                if (!HHpro.Cart || !HHpro.Cart.getProjectExtra) return [];
                var ex = HHpro.Cart.getProjectExtra('calculations') || {};
                return Array.isArray(ex.list) ? ex.list : [];
            },
            find: function (id) {
                var list = HHpro.Calculators.saved.list();
                for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
                return null;
            },
            write: function (list) { HHpro.Cart.setProjectExtra('calculations', { list: list }); },
            add: function (entry) {
                var list = HHpro.Calculators.saved.list();
                entry.id = entry.id || ('calc_' + Date.now().toString(36));
                entry.savedAt = entry.savedAt || new Date().toISOString();
                list.push(entry);
                HHpro.Calculators.saved.write(list);
                return entry;
            },
            remove: function (id) {
                HHpro.Calculators.saved.write(HHpro.Calculators.saved.list().filter(function (c) { return c.id !== id; }));
            },
            calcKey: function (entry) { return (entry && entry.calc) || 'psychrometrics'; }
        }
    };

    HHpro.Views.calculators = {
        render: function (root) {
            root.innerHTML = '';
            root.appendChild(HHpro.UI.buildHeader('Calculators'));

            var main = document.createElement('main');
            main.className = 'app-main calc-page';
            root.appendChild(main);

            var intro = document.createElement('div');
            intro.className = 'calc-intro';
            var title = document.createElement('h1');
            title.className = 'calc-title';
            title.textContent = 'Calculators';
            var sub = document.createElement('p');
            sub.className = 'calc-sub';
            sub.textContent = 'HVAC calculation tools. Everything runs in your browser; ' +
                'nothing you enter is sent anywhere.';
            intro.appendChild(title);
            intro.appendChild(sub);
            main.appendChild(intro);

            var grid = document.createElement('div');
            grid.className = 'calc-grid';
            registry.forEach(function (def) {
                grid.appendChild(buildCard(def));
            });
            if (!registry.length) {
                var empty = document.createElement('p');
                empty.className = 'calc-empty';
                empty.textContent = 'No calculators are available yet.';
                grid.appendChild(empty);
            }
            main.appendChild(grid);

            if (HHpro.FX && HHpro.FX.staggerReveal) {
                HHpro.FX.staggerReveal(grid);
            }
        }
    };

    function buildCard(def) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'calc-card';

        var iconWrap = document.createElement('div');
        iconWrap.className = 'calc-card-icon';
        iconWrap.appendChild(HHpro.UI.icon(def.icon || 'calculator'));
        card.appendChild(iconWrap);

        var body = document.createElement('div');
        body.className = 'calc-card-body';

        var name = document.createElement('h3');
        name.className = 'calc-card-name';
        name.textContent = def.name || def.key;
        body.appendChild(name);

        if (def.description) {
            var desc = document.createElement('p');
            desc.className = 'calc-card-desc';
            desc.textContent = def.description;
            body.appendChild(desc);
        }
        card.appendChild(body);

        card.addEventListener('click', function () {
            HHpro.App.showView(def.view, def.params || {});
        });
        return card;
    }
})();
