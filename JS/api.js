/* ============================================================
   HHpro - API client
   ------------------------------------------------------------
   The one place the site talks to the backend. Every call goes
   to api.hhpro-hvac.com (Cloudflare Tunnel to the Hoffman &
   Hoffman server) and carries the session cookie.

   Usage:
     HHpro.Api.get('/api/auth/me').then(function (profile) {...})
     HHpro.Api.post('/api/auth/login', { email, password })

   A rejected promise carries an Error with:
     .status   HTTP status (0 when the server could not be reached)
     .data     the JSON body the server sent, if any
     .network  true when the request never reached the server
   and .message is always something safe to show the user.

   For local testing against a different backend, set
   localStorage 'hhpro.apiBase' to its origin.
   ============================================================ */

(function () {
    'use strict';
    window.HHpro = window.HHpro || {};

    var DEFAULT_BASE = 'https://api.hhpro-hvac.com';
    var UNREACHABLE = 'Can\'t reach the HHpro server right now. Try again in a minute. ' +
        'If it keeps happening, email eric.creel@hoffman-hoffman.com.';

    function base() {
        try {
            var override = localStorage.getItem('hhpro.apiBase');
            if (override) return override.replace(/\/+$/, '');
        } catch (e) { /* storage unavailable */ }
        return DEFAULT_BASE;
    }

    function request(method, path, body) {
        var opts = {
            method: method,
            credentials: 'include',
            headers: {}
        };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(body);
        }
        return fetch(base() + path, opts).then(function (res) {
            return res.text().then(function (text) {
                var data = null;
                if (text) {
                    try { data = JSON.parse(text); } catch (e) { data = null; }
                }
                if (res.ok) return data;
                var err = new Error((data && (data.message || data.error)) || ('Request failed (' + res.status + ')'));
                err.status = res.status;
                err.data = data;
                err.network = false;
                throw err;
            });
        }, function () {
            var err = new Error(UNREACHABLE);
            err.status = 0;
            err.data = null;
            err.network = true;
            throw err;
        });
    }

    HHpro.Api = {
        base: base,
        get: function (path) { return request('GET', path); },
        post: function (path, body) { return request('POST', path, body || {}); },
        put: function (path, body) { return request('PUT', path, body || {}); },
        del: function (path) { return request('DELETE', path); }
    };
})();
