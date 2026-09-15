/* ============================================================
   HHpro - Login view
   ------------------------------------------------------------
   Email and password, checked by the backend (/api/auth/login).
   What a person may see and do comes back with the sign-in and
   is kept in HHpro.State.

   "Forgot password?" does not send anything itself: the site
   never sends email. It looks up who set the account up and
   opens a message to that person (copying Eric) in the user's
   own mail program.

   params:
     message   text shown above the form (e.g. session ended)
     checking  true while app.js is still asking the server
               whether an existing cookie is valid
   ============================================================ */

(function () {
    'use strict';

    window.HHpro = window.HHpro || {};
    HHpro.Views = HHpro.Views || {};

    HHpro.Views.login = {
        render: function (root, params) {
            params = params || {};
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
            card.appendChild(title);

            var subtitle = document.createElement('p');
            subtitle.className = 'login-subtitle';
            subtitle.textContent = params.checking ? 'Checking your sign-in...' : 'Sign in to continue';
            card.appendChild(subtitle);

            if (params.message) {
                var notice = document.createElement('p');
                notice.className = 'login-notice';
                notice.textContent = params.message;
                card.appendChild(notice);
            }

            var form = buildSignInForm(card, params);
            card.appendChild(form);

            view.appendChild(card);
            // Reachable before sign-in too: someone who can't get past the
            // password should still be able to read what the site does with
            // their data.
            if (HHpro.UI.buildPrivacyFooter) {
                view.appendChild(HHpro.UI.buildPrivacyFooter({ corner: true }));
            }
            root.appendChild(view);
        }
    };

    // -----------------------------------------------------------------
    // Sign-in form
    // -----------------------------------------------------------------

    function field(labelText, type, id, autocomplete) {
        var label = document.createElement('label');
        label.className = 'login-label';
        label.htmlFor = id;
        label.textContent = labelText;

        var input = document.createElement('input');
        input.className = 'login-input';
        input.type = type;
        input.id = id;
        input.name = id;
        input.autocomplete = autocomplete;
        input.required = true;
        return { label: label, input: input };
    }

    function buildSignInForm(card, params) {
        var form = document.createElement('form');
        form.className = 'login-form';
        form.noValidate = true;

        var email = field('Email', 'email', 'login-email', 'username');
        var password = field('Password', 'password', 'login-password', 'current-password');

        var error = document.createElement('div');
        error.className = 'login-error';
        error.setAttribute('role', 'alert');

        var submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'btn btn-primary login-submit';
        submit.textContent = 'Sign in';
        submit.disabled = !!params.checking;

        var forgot = document.createElement('button');
        forgot.type = 'button';
        forgot.className = 'login-link';
        forgot.textContent = 'Forgot password?';
        forgot.addEventListener('click', function () {
            card.replaceChild(buildForgotForm(card, email.input.value), form);
        });

        form.appendChild(email.label);
        form.appendChild(email.input);
        form.appendChild(password.label);
        form.appendChild(password.input);
        form.appendChild(error);
        form.appendChild(submit);
        form.appendChild(forgot);

        // Focus the input immediately for keyboard users
        window.setTimeout(function () { email.input.focus(); }, 0);

        function clearFail() { card.classList.remove('shake'); }
        email.input.addEventListener('input', clearFail);
        password.input.addEventListener('input', clearFail);

        function fail(message) {
            error.textContent = message;
            card.classList.remove('shake');
            // Force reflow so the animation replays on repeated wrong entries
            void card.offsetWidth;
            card.classList.add('shake');
            password.input.value = '';
            password.input.focus();
        }

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var emailValue = email.input.value.trim();
            var passwordValue = password.input.value;
            if (!emailValue || !passwordValue) {
                fail('Enter your email and password.');
                return;
            }
            submit.disabled = true;
            submit.textContent = 'Signing in...';
            error.textContent = '';

            HHpro.Api.post('/api/auth/login', { email: emailValue, password: passwordValue })
                .then(function (profile) {
                    HHpro.State.setSession(profile);
                    HHpro.App.showView('main');
                }, function (err) {
                    submit.disabled = false;
                    submit.textContent = 'Sign in';
                    if (err.data && err.data.error === 'not_registered') {
                        error.textContent = err.data.message;
                        card.classList.remove('shake');
                    } else {
                        fail(err.message);
                    }
                });
        });

        return form;
    }

    // -----------------------------------------------------------------
    // Forgot password
    // -----------------------------------------------------------------

    function buildForgotForm(card, presetEmail) {
        var form = document.createElement('form');
        form.className = 'login-form';
        form.noValidate = true;

        var intro = document.createElement('p');
        intro.className = 'login-help';
        intro.textContent = 'Enter your email and we\'ll open a message to the person who set up ' +
            'your account, asking them to send you a reset link.';

        var email = field('Email', 'email', 'forgot-email', 'username');
        email.input.value = presetEmail || '';

        var error = document.createElement('div');
        error.className = 'login-error';
        error.setAttribute('role', 'alert');

        var submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'btn btn-primary login-submit';
        submit.textContent = 'Open email';

        var back = document.createElement('button');
        back.type = 'button';
        back.className = 'login-link';
        back.textContent = 'Back to sign in';
        back.addEventListener('click', function () {
            card.replaceChild(buildSignInForm(card, {}), form);
        });

        form.appendChild(intro);
        form.appendChild(email.label);
        form.appendChild(email.input);
        form.appendChild(error);
        form.appendChild(submit);
        form.appendChild(back);
        window.setTimeout(function () { email.input.focus(); }, 0);

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            var emailValue = email.input.value.trim();
            if (!emailValue) { error.textContent = 'Enter your email address.'; return; }
            submit.disabled = true;
            error.textContent = '';
            HHpro.Api.post('/api/auth/forgot', { email: emailValue }).then(function (res) {
                submit.disabled = false;
                if (!res.found) {
                    error.textContent = 'We don\'t have an account for that address. Email ' +
                        res.contact + ' to get set up.';
                    return;
                }
                var name = ((res.user.firstName || '') + ' ' + (res.user.lastName || '')).trim();
                var body = 'Hi ' + (res.toName ? res.toName.split(' ')[0] : '') + ',\n\n' +
                    'Please send me a ' + (res.registered ? 'password reset' : 'registration') +
                    ' link for HHpro. My sign-in email is ' + res.user.email + '.\n\n' +
                    'Thanks,\n' + name;
                HHpro.UI.openMailto({
                    to: res.to,
                    cc: res.cc,
                    subject: 'HHpro password reset for ' + name,
                    body: body
                });
                intro.textContent = 'An email to ' + res.to + ' has been opened in your mail program. ' +
                    'Send it, and they will reply with a link to choose a new password.';
            }, function (err) {
                submit.disabled = false;
                error.textContent = err.message;
            });
        });

        return form;
    }
})();
