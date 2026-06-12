/* ============================================================
   HHpro - Login view
   ------------------------------------------------------------
   Password prompt. Each password maps to the engineer schedule
   templates that login may use:
     - "Mellon"    -> standard (Hoffman & Hoffman) schedules only
     - "Refresco1" -> standard + Refresco engineer templates
     - "BW&A1"     -> standard + Barrett Woodyard & Associates templates
     - "Allied1"   -> standard + Allied engineer templates
   Every password always includes the standard layout. Adding a
   new firm = add its password here plus a template in
   schedule_templates.js.
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    // password -> allowed engineer-template keys
    var PASSWORDS = {
        'Mellon':    ['hoffman'],
        'Refresco1': ['hoffman', 'refresco'],
        'BW&A1':     ['hoffman', 'barrett_woodyard'],
        'Allied1':   ['hoffman', 'allied']
    };

    HHpro.Views.login = {
        render: function (root) {
            root.innerHTML = '';

            // The cart toggle/panel live outside #app-root, so they
            // survive a logout. Flag the body while the login view is
            // up; cart.css hides the cart UI under this class.
            document.body.classList.add('login-active');

            var view = document.createElement('div');
            view.className = 'login-view';

            var card = document.createElement('div');
            card.className = 'login-card';

            var title = document.createElement('h1');
            title.className = 'login-title';
            title.appendChild(HHpro.UI.createLogo());

            var subtitle = document.createElement('p');
            subtitle.className = 'login-subtitle';
            subtitle.textContent = 'Enter the password to continue';

            var form = document.createElement('form');
            form.className = 'login-form';
            form.noValidate = true;

            var label = document.createElement('label');
            label.className = 'login-label';
            label.htmlFor = 'login-password';
            label.textContent = 'Password';

            var input = document.createElement('input');
            input.className = 'login-input';
            input.type = 'password';
            input.id = 'login-password';
            input.name = 'password';
            input.autocomplete = 'current-password';
            input.required = true;

            var error = document.createElement('div');
            error.className = 'login-error';
            error.setAttribute('role', 'alert');

            var submit = document.createElement('button');
            submit.type = 'submit';
            submit.className = 'btn btn-primary login-submit';
            submit.textContent = 'Enter';

            form.appendChild(label);
            form.appendChild(input);
            form.appendChild(error);
            form.appendChild(submit);

            card.appendChild(title);
            card.appendChild(subtitle);
            card.appendChild(form);
            view.appendChild(card);
            root.appendChild(view);

            // Focus the input immediately for keyboard users
            window.setTimeout(function () { input.focus(); }, 0);

            // Clear the failed-attempt tint (red input border) once
            // the user starts retyping
            input.addEventListener('input', function () {
                card.classList.remove('shake');
            });

            form.addEventListener('submit', function (event) {
                event.preventDefault();
                var value = input.value;
                var allowed = Object.prototype.hasOwnProperty.call(PASSWORDS, value)
                    ? PASSWORDS[value] : null;
                if (allowed) {
                    HHpro.State.setLoggedIn(true);
                    HHpro.State.setAllowedEngineers(allowed);
                    HHpro.App.showView('main');
                } else {
                    error.textContent = 'Incorrect password. Please try again.';
                    card.classList.remove('shake');
                    // Force reflow so the animation replays on repeated wrong entries
                    void card.offsetWidth;
                    card.classList.add('shake');
                    input.value = '';
                    input.focus();
                }
            });
        }
    };
})();