/* ============================================================
   HHpro - Privacy & Data view
   ------------------------------------------------------------
   A plain-language account of what the site does with data.

   The short version, and the reason this page can be so short:
   HHpro is a static site with no backend. It has no accounts, no
   analytics, no cookies and no third-party requests - Inter is
   self-hosted precisely so that stays true (see the @font-face
   note at the top of CSS/base.css). Everything a user creates
   lives in their own browser's localStorage / sessionStorage and
   is never transmitted anywhere.

   The only party that sees anything is Cloudflare, which serves
   the site and necessarily handles the request itself.

   KEEP THIS PAGE HONEST. If anything is ever added that phones
   home - analytics, a CDN asset, an error reporter, a contact
   form, a hosted font - this page has to change in the same
   commit, or it becomes a false statement on a public website.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    // Shown at the bottom of the page. Update whenever the substance
    // changes, not for typo fixes.
    var LAST_UPDATED = 'August 15, 2026';

    var SECTIONS = [
        {
            title: 'The short version',
            paragraphs: [
                'HHpro does not collect, store or transmit personal information. ' +
                'There are no user accounts, no cookies, no analytics and no advertising. ' +
                'Nothing you do here is sent to us, because there is no server to send it to — ' +
                'the site is a set of static files and everything runs inside your browser.'
            ]
        },
        {
            title: 'What is stored, and where',
            paragraphs: [
                'Projects, selections and your saved preferences are written to your own ' +
                'browser’s local storage, on your own device. They never leave it. We cannot ' +
                'see them, and neither can anyone else with access to the website.',
                'Because that storage belongs to your browser, clearing your browsing data ' +
                'deletes it permanently. Use “Export All to CSV” on the Projects page to keep ' +
                'a backup you control.'
            ]
        },
        {
            title: 'Third parties',
            paragraphs: [
                'There are none. The site loads no third-party scripts, fonts, images, trackers ' +
                'or embedded content — every file it requests comes from this website itself. ' +
                'Documents you generate (Excel schedules, PDFs, CAD files) are built inside your ' +
                'browser and downloaded directly; they are never uploaded anywhere.'
            ]
        },
        {
            title: 'Hosting',
            paragraphs: [
                'The site is served through Cloudflare. Like any web host, Cloudflare handles the ' +
                'technical details of your request — your IP address, the time, your browser type ' +
                'and the page requested — in order to deliver the site and protect it from abuse. ' +
                'That processing is Cloudflare’s and is covered by their privacy policy. We do not ' +
                'add any analytics or logging of our own on top of it, and we do not receive ' +
                'reports identifying individual visitors.'
            ]
        },
        {
            title: 'Your rights',
            paragraphs: [
                'Privacy laws such as the GDPR and the CCPA give you the right to see, correct or ' +
                'delete personal data a site holds about you, and to know whether it is sold or ' +
                'shared. We hold none, so there is nothing to retrieve or erase, and nothing is ' +
                'ever sold or shared. The data this site creates is already entirely in your ' +
                'hands: clearing your browser’s site data removes all of it immediately.'
            ]
        },
        {
            title: 'Children',
            paragraphs: [
                'HHpro is a professional engineering tool intended for use in the course of work. ' +
                'It is not directed at children and collects no information from anyone.'
            ]
        },
        {
            title: 'Changes',
            paragraphs: [
                'If the site ever begins collecting or transmitting anything, this page will be ' +
                'updated to say so before that change goes live, and the date below will change.'
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
            lede.textContent = 'How HHpro handles information — in plain terms.';
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
     * a visitor who cannot get past the password should still be able to
     * read what the site does with their data.
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
