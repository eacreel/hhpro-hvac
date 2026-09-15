/* ============================================================
   HHpro - Registration view
   ------------------------------------------------------------
   Reached only from the link in an invitation or reset email
   (hhpro-hvac.com/#register/<token>). Shows whose account the
   link belongs to and asks for a password twice. On success the
   backend activates the account, creates the person's project
   folder, signs them in, and the site goes straight to the main
   page.

   params.token   the one-time code from the link
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    var MIN_LENGTH = 10;

    HHpro.Views.register = {
        render: function (root, params) {
            root.innerHTML = '';
            document.body.classList.add('login-active');

            var view = document.createElement('div');
            view.className = 'login-view';

            var card = document.createElement('div');
            card.className = 'login-card';

            var title = document.createElement('h1');
            title.className = 'login-title';
            title.appendChild(HHpro.UI.createLogo());
            card.appendChild(title);

            var subtitle = document.createElement('p');
            subtitle.className = 'login-subtitle';
            subtitle.textContent = 'Checking your link...';
            card.appendChild(subtitle);

            view.appendChild(card);
            if (HHpro.UI.buildPrivacyFooter) {
                view.appendChild(HHpro.UI.buildPrivacyFooter({ corner: true }));
            }
            root.appendChild(view);

            HHpro.Api.get('/api/auth/invite/' + encodeURIComponent(params.token)).then(function (info) {
                subtitle.textContent = info.kind === 'reset' ? 'Choose a new password' : 'Welcome. Choose a password';
                card.appendChild(buildForm(params.token, info));
            }, function (err) {
                subtitle.textContent = 'This link can\'t be used';
                card.appendChild(buildProblem(err.message));
            });
        }
    };

    function buildProblem(message) {
        var wrap = document.createElement('div');
        wrap.className = 'login-form';

        var text = document.createElement('p');
        text.className = 'login-help';
        text.textContent = message;
        wrap.appendChild(text);

        var back = document.createElement('button');
        back.type = 'button';
        back.className = 'btn btn-primary login-submit';
        back.textContent = 'Go to sign in';
        back.addEventListener('click', function () {
            HHpro.App.showView('login');
        });
        wrap.appendChild(back);
        return wrap;
    }

    function buildForm(token, info) {
        var form = document.createElement('form');
        form.className = 'login-form';
        form.noValidate = true;

        var who = document.createElement('p');
        who.className = 'login-help';
        var name = ((info.firstName || '') + ' ' + (info.lastName || '')).trim();
        who.textContent = (name ? name + ' · ' : '') + info.email;
        form.appendChild(who);

        var p1 = passwordField('New password', 'register-password', 'new-password');
        var p2 = passwordField('Type it again', 'register-password-2', 'new-password');
        form.appendChild(p1.label);
        form.appendChild(p1.input);
        form.appendChild(p2.label);
        form.appendChild(p2.input);

        var hint = document.createElement('p');
        hint.className = 'login-help';
        hint.textContent = 'At least ' + MIN_LENGTH + ' characters. A short phrase works well.';
        form.appendChild(hint);

        var error = document.createElement('div');
        error.className = 'login-error';
        error.setAttribute('role', 'alert');
        form.appendChild(error);

        var submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'btn btn-primary login-submit';
        submit.textContent = info.kind === 'reset' ? 'Save new password' : 'Set password and sign in';
        form.appendChild(submit);

        window.setTimeout(function () { p1.input.focus(); }, 0);

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var a = p1.input.value;
            var b = p2.input.value;
            if (a.length < MIN_LENGTH) {
                error.textContent = 'Password must be at least ' + MIN_LENGTH + ' characters.';
                p1.input.focus();
                return;
            }
            if (a !== b) {
                error.textContent = 'The two passwords don\'t match.';
                p2.input.value = '';
                p2.input.focus();
                return;
            }
            submit.disabled = true;
            submit.textContent = 'Saving...';
            error.textContent = '';
            HHpro.Api.post('/api/auth/register', { token: token, password: a }).then(function (profile) {
                HHpro.State.setSession(profile);
                HHpro.App.showView('main');
            }, function (err) {
                submit.disabled = false;
                submit.textContent = info.kind === 'reset' ? 'Save new password' : 'Set password and sign in';
                error.textContent = err.message;
            });
        });

        return form;
    }

    function passwordField(labelText, id, autocomplete) {
        var label = document.createElement('label');
        label.className = 'login-label';
        label.htmlFor = id;
        label.textContent = labelText;

        var input = document.createElement('input');
        input.className = 'login-input';
        input.type = 'password';
        input.id = id;
        input.name = id;
        input.autocomplete = autocomplete;
        input.required = true;
        return { label: label, input: input };
    }
})();
