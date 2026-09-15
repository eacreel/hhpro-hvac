/* ============================================================
   HHpro - Privacy & Data view
   ------------------------------------------------------------
   The privacy notice, kept to the essentials: who collects the
   data, what, why, who it is shared with, cookies, how long it
   is kept, how to get it corrected or removed, and the date.

   HHpro has a backend run by Hoffman & Hoffman that holds
   accounts and saved projects. There are no analytics, no
   advertising and no third-party scripts, and the site itself
   sends no email.

   KEEP THIS PAGE HONEST. If anything is ever added that phones
   home - analytics, a CDN asset, an error reporter, a hosted
   font - or if what the backend stores changes, this page has
   to change in the same commit, or it becomes a false statement
   on a public website.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    // Shown at the bottom of the page. Update whenever the substance
    // changes, not for typo fixes.
    var LAST_UPDATED = 'September 15, 2026';

    var CONTACT = 'eric.creel@hoffman-hoffman.com';

    var SECTIONS = [
        {
            title: 'Who we are',
            paragraphs: [
                'HHpro is operated by Hoffman & Hoffman. Questions about this notice go to ' +
                CONTACT + '.'
            ]
        },
        {
            title: 'What we collect',
            paragraphs: [
                'Your name, company, office location(s), user level and email address, entered by ' +
                'the administrator who set up your account, plus a scrambled form of your password. ' +
                'Projects you save on the site are stored with your account.'
            ]
        },
        {
            title: 'Why',
            paragraphs: [
                'To sign you in, show you the products for your locations, and keep your saved projects.'
            ]
        },
        {
            title: 'Sharing',
            paragraphs: [
                'Your information is not sold or shared with anyone outside Hoffman & Hoffman. The ' +
                'site is delivered through Cloudflare, which handles the network connection under its ' +
                'own privacy policy.'
            ]
        },
        {
            title: 'Cookies',
            paragraphs: [
                'One cookie keeps you signed in. There are no advertising, analytics or third-party cookies.'
            ]
        },
        {
            title: 'How long we keep it',
            paragraphs: [
                'For as long as your account is active. Deleted accounts and deleted projects are ' +
                'removed within 30 days.'
            ]
        },
        {
            title: 'Your choices',
            paragraphs: [
                'To see, correct or delete the information we hold about you, email ' + CONTACT + '.'
            ]
        }
    ];

    HHpro.Views.privacy = {
        render: function (root) {
            root.innerHTML = '';
            root.appendChild(HHpro.UI.buildHeader('Privacy & Data'));

            var main = document.createElement('main');
            main.className = 'app-main privacy-view';

            var title = document.createElement('h1');
            title.className = 'privacy-title';
            title.textContent = 'Privacy & Data';
            main.appendChild(title);

            var lede = document.createElement('p');
            lede.className = 'privacy-lede';
            lede.textContent = 'How HHpro handles information.';
            main.appendChild(lede);

            SECTIONS.forEach(function (section) {
                var h = document.createElement('h2');
                h.className = 'privacy-section-title';
                h.textContent = section.title;
                main.appendChild(h);

                section.paragraphs.forEach(function (text) {
                    var p = document.createElement('p');
                    p.className = 'privacy-text';
                    p.textContent = text;
                    main.appendChild(p);
                });
            });

            var updated = document.createElement('p');
            updated.className = 'privacy-updated';
            updated.textContent = 'Last updated ' + LAST_UPDATED + '.';
            main.appendChild(updated);

            root.appendChild(main);
        }
    };

    /**
     * Footer with the privacy link. Appended to the overview and the login
     * page so the statement is reachable both before and after sign-in -
     * a visitor who cannot sign in should still be able to read what the
     * site does with their data.
     *
     * opts.corner pins it to the bottom-right of its container instead of
     * sitting in the normal flow. The login view centres its single card
     * with flexbox, so an in-flow footer becomes a second flex item and
     * lands BESIDE the card; the corner variant takes it out of flow.
     */
    HHpro.UI = HHpro.UI || {};
    HHpro.UI.buildPrivacyFooter = function (opts) {
        var footer = document.createElement('footer');
        footer.className = 'app-footer' +
            ((opts && opts.corner) ? ' app-footer-corner' : '');

        var link = document.createElement('button');
        link.type = 'button';
        link.className = 'app-footer-link';
        link.textContent = 'Privacy & Data';
        link.addEventListener('click', function () {
            HHpro.App.showView('privacy');
        });
        footer.appendChild(link);

        return footer;
    };
})();
