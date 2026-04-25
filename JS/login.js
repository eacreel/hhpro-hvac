/* ============================================================
   HHpro - Login view
   ------------------------------------------------------------
   Single password prompt. Password is "Mellon".
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    var CORRECT_PASSWORD = 'Mellon';

    HHpro.Views.login = {
        render: function (root) {
            root.innerHTML = '';

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

            form.addEventListener('submit', function (event) {
                event.preventDefault();
                var value = input.value;
                if (value === CORRECT_PASSWORD) {
                    HHpro.State.setLoggedIn(true);
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