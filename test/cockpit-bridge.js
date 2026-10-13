'use strict';
// Implements Cockpit's HTTP request API, including two-argument failure callbacks.
function bridge(base, observe = () => {}) {
    return { http(endpoint) {
        observe(endpoint);
        return {
            request(options) {
                let responseCallback;
                const controller = new AbortController();
                const operation = fetch(base + options.path, {
                    method: options.method, headers: options.headers,
                    ...(options.method !== 'GET' ? { body: options.body } : {}), signal: controller.signal, redirect: 'manual'
                }).then(async response => {
                    const headers = Object.fromEntries(response.headers);
                    if (response.headers.getSetCookie().length) headers['Set-Cookie'] = response.headers.getSetCookie().join(', ');
                    responseCallback(response.status, headers);
                    return { status: response.status, body: await response.text() };
                });
                return {
                    response(callback) { responseCallback = callback; },
                    then(resolve, reject) { operation.then(r => r.status < 300 ? resolve(r.body) : reject({ status: r.status }, r.body), reject); },
                    close() { controller.abort(); }
                };
            }, close() {}
        };
    } };
}
module.exports = { bridge };
