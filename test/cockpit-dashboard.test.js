'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { cockpitConfig, cockpitFiles } = require('../lib/cockpit-package');
const { createTransport } = require('../cockpit/pm2monitor/transport');
const { start, root, json, write } = require('./helpers');

const { bridge } = require('./cockpit-bridge');
test('Cockpit transport uses dashboard session for controls, renews expiry and logs out on backend', async t => {
    const app = await start(t);
    let session;
    const http = bridge(app.url, endpoint => assert.equal(endpoint.superuser, undefined)).http({ port: 8877 });
    const cockpit = { http: () => ({ ...http, request: options => { session = options.headers.Cookie || session; return http.request(options); } }) };
    const transport = createTransport(cockpit, { user: 'deploy', endpoint: { port: 8877 } });
    t.after(() => transport.close());
    assert.equal((await transport.request('/api/status')).isAdmin, false);
    assert.equal((await transport.request('/api/processes/deploy/0/logs')).out, 'deploy:0');
    await assert.rejects(transport.request('/api/processes/deploy/0/start', { method: 'POST', body: '{}' }), /Unauthorized/);
    await assert.rejects(transport.request('/auth/login', { method: 'POST', body: '{"password":"wrong"}' }), /Incorrect admin password/);
    await transport.request('/auth/login', { method: 'POST', body: '{"password":"test-admin"}' });
    assert.equal((await transport.request('/api/status')).isAdmin, true);
    for (const action of ['start', 'stop', 'restart']) await transport.request(`/api/processes/deploy/0/${action}`, { method: 'POST', body: '{}' });
    assert.deepEqual(app.local.calls.map(c => c.action), ['start', 'stop', 'restart']);
    // Destroy the backend session while the transport still holds its old cookie.
    await json(app.url + '/auth/logout', write('POST', session));
    await assert.rejects(transport.request('/api/processes/deploy/0/stop', { method: 'POST', body: '{}' }), /Unauthorized/);
    assert.equal((await transport.request('/api/status')).isAdmin, false);
    await transport.request('/auth/login', { method: 'POST', body: '{"password":"test-admin"}' });
    assert.equal((await transport.request('/api/status')).isAdmin, true);
    await transport.request('/auth/logout', { method: 'POST', body: '{}' });
    assert.equal((await transport.request('/api/status')).isAdmin, false);
    await assert.rejects(transport.request('/api/processes/deploy/0/stop', { method: 'POST', body: '{}' }), /Unauthorized/);
    assert.equal(app.local.calls.length, 3);
});

test('Cockpit rejects mismatched backend before sending a login password', async t => {
    const app = await start(t, { user: 'other', uid: 2000 });
    const paths = [];
    const fake = bridge(app.url); const http = fake.http({});
    const wrapped = { http: () => ({ ...http, request: options => { paths.push(options.path); return http.request(options); } }) };
    const transport = createTransport(wrapped, { user: 'deploy', endpoint: {} });
    t.after(() => transport.close());
    await assert.rejects(transport.request('/auth/login', { method: 'POST', body: '{"password":"private"}' }), /identity does not match/);
    assert.deepEqual(paths, ['/api/info']);
});

test('Cockpit multi-user controls and duplicate ID logs route through aggregate backend', async t => {
    const remote = await start(t, { user: 'worker', uid: 2000 });
    const main = await start(t, { mode: 'multi-user', targets: [{ user: 'worker', baseUrl: remote.url, password: 'test-admin' }] });
    const transport = createTransport(bridge(main.url), { user: 'deploy', endpoint: {} });
    t.after(() => transport.close());
    assert.equal((await transport.request('/api/status')).processes.length, 2);
    await transport.request('/auth/login', { method: 'POST', body: '{"password":"test-admin"}' });
    await transport.request('/api/processes/worker/0/start', { method: 'POST', body: '{}' });
    assert.equal(remote.local.calls[0].action, 'start'); assert.equal(main.local.calls.length, 0);
    assert.equal((await transport.request('/api/processes/worker/0/logs')).out, 'worker:0');
    assert.equal((await transport.request('/api/processes/deploy/0/logs')).out, 'deploy:0');
    await assert.rejects(transport.request('/api/processes/unconfigured/0/stop', { method: 'POST', body: '{}' }), /not configured/);
});

test('Cockpit timeout closes channel without retrying and unavailable backend explains recovery', async t => {
    let requests = 0, closes = 0;
    const fake = { http: () => ({ request: () => { requests++; return { response() {}, then() {}, close() { closes++; } }; }, close() {} }) };
    const transport = createTransport(fake, { user: 'deploy', endpoint: {} }, 10);
    await assert.rejects(transport.request('/api/status'), /timed out/);
    assert.equal(requests, 1); assert.equal(closes, 1); transport.close();
    const offline = createTransport(bridge('http://127.0.0.1:1'), { user: 'deploy', endpoint: {} });
    t.after(() => offline.close());
    await assert.rejects(offline.request('/api/status'), /Check that it is running/);
});

test('Cockpit generated package is local, shares UI and excludes credentials and targets', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-package-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    await fs.writeFile(path.join(directory, '.env'), 'PORT=8888\nADMIN_PASSWORD=private-password\nSESSION_SECRET=private-secret\n');
    const config = await cockpitConfig(directory, 'worker', {}, {});
    assert.deepEqual(config, { user: 'worker', endpoint: { address: '127.0.0.1', port: 8888 } });
    assert.equal((await cockpitConfig(directory, 'worker', { port: 8890 }, { PORT: '9000' })).endpoint.port, 8890);
    assert.equal((await cockpitConfig(directory, 'worker', { url: 'https://monitor.example.com/' }, {})).endpoint.tls.validate, true);
    await assert.rejects(cockpitConfig(directory, 'worker', { url: 'http://user:password@example.com/' }, {}), /credentials/);
    await assert.rejects(cockpitConfig(directory, 'worker', { url: 'https://example.com/path' }, {}), /origin/);
    const files = await cockpitFiles(root, config);
    const html = files.get('index.html');
    assert.ok(html.includes('../base1/cockpit.js')); assert.ok(html.includes('src="app.js"'));
    assert.ok(!html.includes('https://')); assert.ok(!html.includes('iframe'));
    assert.equal(String(files.get('app.js')), await fs.readFile(path.join(root, 'public/app.js'), 'utf8'));
    assert.ok(!files.get('config.js').includes('private-')); assert.ok(!files.get('config.js').includes('targets'));
    assert.ok(JSON.parse(String(files.get('manifest.json')))['content-security-policy'].includes("script-src 'self'"));
});

test('POST logout invalidates the existing cookie and preserves legacy GET redirect', async t => {
    const app = await start(t);
    const response = await fetch(app.url + '/auth/login', write('POST', '', { password: 'test-admin' }));
    const cookie = response.headers.getSetCookie()[0].split(';')[0];
    assert.equal((await json(app.url + '/auth/logout', write('POST', cookie))).data.success, true);
    assert.equal((await json(app.url + '/api/stop/0', write('POST', cookie))).response.status, 401);
    assert.equal((await fetch(app.url + '/auth/logout', { redirect: 'manual' })).status, 302);
});

test('installer writes only to isolated XDG directory, supports dry-run and rejects symlink assets', async t => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cockpit-install-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    const install = (args = []) => promisify(execFile)(process.execPath, [path.join(root, 'scripts/install-cockpit-link.js'), '--port', '8888', ...args], {
        env: { ...process.env, XDG_DATA_HOME: directory }, cwd: directory
    });
    const destination = path.join(directory, 'cockpit/pm2monitor');
    await install(['--dry-run']);
    await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
    await install();
    assert.ok((await fs.readFile(path.join(destination, 'index.html'), 'utf8')).includes('src="transport.js"'));
    assert.ok((await fs.readFile(path.join(destination, 'config.js'), 'utf8')).includes('"port":8888'));
    assert.equal((await fs.readdir(destination)).length, 9);
    const outside = path.join(directory, 'outside');
    await fs.writeFile(outside, 'preserve me');
    await fs.rm(path.join(destination, 'app.js'));
    await fs.symlink(outside, path.join(destination, 'app.js'));
    await assert.rejects(install(), /Refusing to replace non-regular file/);
    assert.equal(await fs.readFile(outside, 'utf8'), 'preserve me');
});
