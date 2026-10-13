'use strict';
(function () {
    // Session stays in this closure, never in browser cookies or persistent storage.
    function createTransport(cockpit, config, timeout = 30000) {
        const http = cockpit.http(config.endpoint);
        let cookie = null, cookieName = null, identityAt = 0, identityPending = null, closed = false;
        const pending = new Set();

        function exchange(path, options = {}) {
            return new Promise((resolve, reject) => {
                if (closed) { reject(new Error('Cockpit connection closed')); return; }
                const call = http.request({ path, method: options.method || 'GET', body: options.body ?? '',
                    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } });
                let status, headers = {}, finished = false;
                pending.add(call);
                const finish = (err, value) => {
                    if (finished) return;
                    finished = true; clearTimeout(timer); pending.delete(call);
                    if (err) reject(err); else resolve(value);
                };
                const timer = setTimeout(() => {
                    finish(new Error('Dashboard request timed out; check status before retrying'));
                    call.close('timeout');
                }, timeout);
                call.response((code, responseHeaders) => { status = code; headers = responseHeaders; });
                call.then(body => finish(null, { status, headers, body }), (err, body) => {
                    if (err.status) finish(null, { status: err.status, headers, body });
                    else finish(new Error('Cannot reach dashboard backend. Check that it is running and reinstall if its port changed.'));
                });
            });
        }
        function decode(result) {
            let data;
            try { data = JSON.parse(result.body); }
            catch { throw new Error('Invalid dashboard response; update and restart the backend'); }
            if (result.status < 200 || result.status >= 300) {
                if (result.status === 401) cookie = null;
                throw new Error(data.message || 'Dashboard request failed');
            }
            return data;
        }
        async function identity(force) {
            if (identityPending) return identityPending;
            if (!force && Date.now() - identityAt < 30000) return;
            identityPending = (async () => {
                const info = decode(await exchange('/api/info'));
                if (info.protocolVersion !== 1 || !['single-user', 'multi-user'].includes(info.mode) || info.user !== config.user || !Number.isSafeInteger(info.uid) || info.uid <= 0 || !/^[a-zA-Z0-9._-]{1,128}$/.test(info.sessionCookie || '')) {
                    cookie = null; identityAt = 0;
                    throw new Error('Dashboard identity does not match this Cockpit installation. Check the port and reinstall as the correct Linux user.');
                }
                if (cookieName !== info.sessionCookie) cookie = null;
                cookieName = info.sessionCookie; identityAt = Date.now();
            })().finally(() => { identityPending = null; });
            return identityPending;
        }
        async function request(path, options = {}) {
            if (!/^\/(api|auth)\/[a-zA-Z0-9/%._-]+$/.test(path)) throw new Error('Invalid dashboard API path');
            await identity(Boolean(options.method && options.method !== 'GET'));
            const result = await exchange(path, options);
            const data = decode(result);
            const header = Object.entries(result.headers).find(([name]) => name.toLowerCase() === 'set-cookie')?.[1];
            if (header) {
                const values = Array.isArray(header) ? header : [header];
                // Cockpit can combine duplicate HTTP headers. Only take our session.
                const escaped = cookieName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const pattern = new RegExp(`(?:^|,\\s*)(${escaped}=[^;,\\s]*)`);
                const session = values.map(value => String(value).match(pattern)?.[1]).find(Boolean);
                if (session) cookie = session === `${cookieName}=` ? null : session;
            }
            if (path === '/auth/login' && !cookie) throw new Error('Dashboard did not provide an admin session');
            if (path === '/auth/logout') cookie = null;
            return data;
        }
        function close() {
            closed = true; cookie = null;
            for (const call of pending) call.close('disconnected');
            http.close();
        }
        return { request, close };
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { createTransport };
    else {
        window.pm2MonitorTransport = createTransport(window.cockpit, window.pm2MonitorCockpit);
        window.addEventListener('pagehide', () => window.pm2MonitorTransport.close());
        window.cockpit.addEventListener('visibilitychange', () => {
            if (!window.cockpit.hidden && typeof fetchData === 'function') fetchData();
        });
        document.addEventListener('DOMContentLoaded', () => {
            const context = document.createElement('p'); context.className = 'cockpit-context';
            context.textContent = `Dashboard: ${window.pm2MonitorCockpit.user}. View status and logs here; use dashboard admin login for process controls.`;
            document.querySelector('.header-top').after(context);
        });
    }
}());
