/* ============================================================
   HHpro - Privacy & Data view
   ------------------------------------------------------------
   A plain-language account of what the site does with data.

   Since accounts arrived (September 2026) HHpro has a backend:
   a small server run by Hoffman & Hoffman that holds accounts
   and saved projects. There are still no analytics, no
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

    var SECTIONS = [
        {
            title: 'The short version',
            paragraphs: [
                'HHpro requires an account. We store the details needed to run your account and ' +
                'the projects you save. There is no advertising, no analytics and no tracking. ' +
                'Nothing is shared with anyone outside Hoffman & Hoffman.'
            ]
        },
        {
            title: 'What we store about you',
            paragraphs: [
                'Your name, company, office location, user level and email address, entered by the ' +
                'Hoffman & Hoffman administrator who set up your account. A scrambled version of ' +
                'your password that cannot be turned back into the password itself. The date your ' +
                'account was created and who created it.'
            ]
        },
        {
            title: 'Projects you save',
            paragraphs: [
                'Projects are saved on a Hoffman & Hoffman server in Charlotte, North Carolina, in a ' +
                'folder that belongs to your account. Only you can see them on the site. Hoffman & ' +
                'Hoffman staff who maintain the server can access the files. You can export any ' +
                'project to CSV and delete any project at any time.'
            ]
        },
        {
            title: 'Cookies',
            paragraphs: [
                'One cookie, which keeps you signed in. It holds a random session code and nothing ' +
                'else. It is removed when you log out. There are no third-party cookies.'
            ]
        },
        {
            title: 'Email',
            paragraphs: [
                'HHpro never sends email. When an administrator invites you or you ask for a ' +
                'password reset, the site opens a message in their own mail program for them to ' +
                'send. Your email address is used only to identify your account and to reach you ' +
                'about it.'
            ]
        },
        {
            title: 'Who can see the user list',
            paragraphs: [
                'Hoffman & Hoffman administrators can see the name, company, location, level and ' +
                'email of every account. They cannot see passwords or your projects.'
            ]
        },
        {
            title: 'Third parties',
            paragraphs: [
                'The site loads no third-party scripts, fonts, images, trackers or embedded content. ' +
                'Documents you generate (Excel schedules, PDFs, CAD files) are built inside your ' +
                'browser and downloaded directly; they are never uploaded anywhere.'
            ]
        },
        {
            title: 'Cloudflare',
            paragraphs: [
                'The site and its server connection are delivered through Cloudflare, which handles ' +
                'the network request and sees your IP address as any web host would. Cloudflare does ' +
                'not receive your account details or projects in any form it can read. That ' +
                'processing is Cloudflare’s and is covered by their privacy policy.'
            ]
        },
        {
            title: 'Removing your account',
            paragraphs: [
                'Email eric.creel@hoffman-hoffman.com. Your account is deleted and your project ' +
                'folder is set aside and removed after 30 days.'
            ]
        },
        {
            title: 'Children',
            paragraphs: [
                'HHpro is a professional engineering tool intended for use in the course of work. ' +
                'It is not directed at children.'
            ]
        },
        {
            title: 'Changes',
            paragraphs: [
                'If the way HHpro handles data changes, this page changes in the same update, and ' +
                'the date below changes with it.'
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
