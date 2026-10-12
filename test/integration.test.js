'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { start, json, login, write, fakeLocal } = require('./helpers');
const { AppError } = require('../lib/errors');

test('single-user public reads, admin actions, logout, legacy routes and cross-origin rejection', async t => {
    const app = await start(t);
    const status = await json(app.url + '/api/status');
    assert.equal(status.data.mode, 'single-user'); assert.equal(status.data.isAdmin, false);
    assert.deepEqual(status.data.targets.map(t => t.user), ['deploy']);
    assert.equal((await json(app.url + '/api/logs/0')).data.out, 'deploy:0');
    assert.equal((await json(app.url + '/api/processes/worker/0/logs')).response.status, 404);
    assert.equal((await json(app.url + '/api/processes/deploy/0/start', write('POST', ''))).response.status, 401);
    assert.equal((await json(app.url + '/api/targets')).response.status, 401);
    assert.equal((await json(app.url + '/auth/login', write('POST', '', { password: 'wrong' }))).response.status, 401);
    const cookie = await login(app.url);
    assert.equal((await json(app.url + '/api/targets', { headers: { Cookie: cookie } })).response.status, 404);
    for (const action of ['start', 'stop', 'restart']) assert.equal((await json(app.url + `/api/processes/deploy/0/${action}`, write('POST', cookie))).response.status, 200);
    assert.equal((await json(app.url + '/api/rename/0', write('POST', cookie, { newName: 'renamed' }))).response.status, 200);
    assert.equal(app.local.calls.at(-1).body.newName, 'renamed');
    for (const id of ['all', '-1', '01', 'app']) assert.equal((await json(app.url + `/api/processes/deploy/${id}/stop`, write('POST', cookie))).response.status, 400);
    assert.equal((await json(app.url + '/api/processes/deploy/0/exec', write('POST', cookie))).response.status, 400);
    assert.equal((await json(app.url + '/api/processes/deploy/0/restart', write('POST', cookie, { command: 'id' }))).response.status, 400);
    assert.equal((await json(app.url + '/api/processes/deploy/0/logs?path=/etc/passwd')).response.status, 400);
    assert.equal((await json(app.url + '/api/processes/deploy/0/stop', { ...write('POST', cookie), headers: { ...write('POST', cookie).headers, Origin: 'http://other.example' } })).response.status, 403);
    await fetch(app.url + '/auth/logout', { headers: { Cookie: cookie }, redirect: 'manual' });
    assert.equal((await json(app.url + '/api/stop/0', write('POST', cookie))).response.status, 401);
});

test('current user plus three HTTP targets route duplicate ID 0 correctly, isolate errors and coalesce polling', async t => {
    const users = ['appuser', 'worker', 'service-a'];
    const remotes = [];
    for (let i = 0; i < users.length; i++) remotes.push(await start(t, { user: users[i], uid: 2000 + i }));
    const main = await start(t, { mode: 'multi-user', targets: remotes.map((r, i) => ({ user: users[i], baseUrl: r.url, password: 'test-admin' })) });
    const statuses = await Promise.all(Array.from({ length: 10 }, () => json(main.url + '/api/status')));
    const data = statuses[0].data;
    assert.equal(data.processes.length, 4); assert.deepEqual(data.targets.map(t => t.user), ['deploy', ...users]);
    assert.ok(data.processes.every(p => p.id === 0)); assert.equal(main.local.lists, 1);
    for (const remote of remotes) assert.equal(remote.local.lists, 1);
    const cookie = await login(main.url);
    for (let i = 0; i < users.length; i++) {
        assert.equal((await json(main.url + `/api/processes/${users[i]}/0/logs`)).data.out, `${users[i]}:0`);
        assert.equal((await json(main.url + `/api/processes/${users[i]}/0/start`, write('POST', cookie))).response.status, 200);
        assert.equal(remotes[i].local.calls.length, 1); assert.equal(remotes[i].local.calls[0].action, 'start');
    }
    assert.equal(main.local.calls.length, 0);
    // Expired/invalid target session triggers one backend login, without a UI login.
    main.manager.target('worker').adapter.cookie = 'invalid=expired';
    assert.equal((await json(main.url + '/api/processes/worker/0/restart', write('POST', cookie))).response.status, 200);
    remotes[0].local.fail = new AppError('PM2 daemon is not running');
    remotes[0].manager.target('appuser').cache.clear(); main.manager.target('appuser').cache.clear();
    const failure = (await json(main.url + '/api/status')).data;
    assert.match(failure.targets.find(t => t.user === 'appuser').error, /unavailable/);
    assert.equal(failure.processes.length, 3);
});

test('admin target add/edit/delete checks identity/password, persists private config, applies immediately and survives restart', async t => {
    const remote = await start(t, { user: 'appuser', uid: 2000 });
    const main = await start(t, { mode: 'multi-user' }); const cookie = await login(main.url);
    const target = { user: 'appuser', baseUrl: remote.url, password: 'test-admin' };
    assert.equal((await json(main.url + '/api/targets', write('POST', '', target))).response.status, 401);
    assert.equal((await json(main.url + '/api/targets', write('POST', cookie, { ...target, user: 'wrong-user' }))).response.status, 503);
    assert.equal((await json(main.url + '/api/targets', write('POST', cookie, { ...target, password: 'wrong' }))).response.status, 403);
    await assert.rejects(fs.stat(main.config.targetsFile), { code: 'ENOENT' });
    const saved = await json(main.url + '/api/targets', write('POST', cookie, target));
    assert.equal(saved.response.status, 200); assert.equal(saved.data.targets[0].hasPassword, true);
    assert.ok(!JSON.stringify(saved.data).includes('test-admin'));
    assert.equal((await fs.stat(main.config.targetsFile)).mode & 0o777, 0o600);
    assert.equal((await json(main.url + '/api/status')).data.processes.length, 2);
    assert.equal((await json(main.url + '/api/targets', write('POST', cookie, target))).response.status, 409);
    assert.equal((await json(main.url + '/api/targets/appuser', write('PUT', cookie, { user: 'appuser', baseUrl: remote.url }))).response.status, 200);
    assert.equal(main.store.targets[0].password, 'test-admin');
    const restarted = await start(t, { mode: 'multi-user', directory: main.dir });
    assert.equal((await json(restarted.url + '/api/status')).data.processes.length, 2);
    assert.equal((await json(main.url + '/api/targets/appuser', write('DELETE', cookie))).response.status, 200);
    assert.equal((await json(main.url + '/api/status')).data.processes.length, 1);
    assert.equal(remote.local.closed, false); assert.equal(remote.local.calls.length, 0);
    assert.deepEqual(JSON.parse(await fs.readFile(main.config.targetsFile, 'utf8')), { targets: [] });
});

test('read-only target needs no password; target protection is enforced behind aggregate', async t => {
    const local = fakeLocal('worker', [{ id: 0, name: 'dashboard', status: 'online', protected: true }]);
    const remote = await start(t, { user: 'worker', uid: 2001, local });
    const main = await start(t, { mode: 'multi-user', targets: [{ user: 'worker', baseUrl: remote.url }] });
    const cookie = await login(main.url);
    assert.equal((await json(main.url + '/api/processes/worker/0/logs')).response.status, 200);
    assert.equal((await json(main.url + '/api/processes/worker/0/restart', write('POST', cookie))).response.status, 403);
    assert.equal((await json(main.url + '/api/targets/worker', write('PUT', cookie, { user: 'worker', baseUrl: remote.url, password: 'test-admin' }))).response.status, 200);
    assert.equal((await json(main.url + '/api/processes/worker/0/stop', write('POST', cookie))).response.status, 403);
    assert.equal(local.calls.length, 0);
});

test('target multi-user identity rejected; empty target distinguished from unreachable target', async t => {
    const empty = await start(t, { user: 'worker', uid: 2001, local: fakeLocal('worker', []) });
    const main = await start(t, { mode: 'multi-user', targets: [{ user: 'worker', baseUrl: empty.url }, { user: 'offline', baseUrl: 'http://127.0.0.1:1' }] });
    const data = (await json(main.url + '/api/status')).data;
    assert.equal(data.targets.find(t => t.user === 'worker').processCount, 0);
    assert.equal(data.targets.find(t => t.user === 'worker').error, null);
    assert.match(data.targets.find(t => t.user === 'offline').error, /reach/);
    const cookie = await login(main.url);
    const other = await start(t, { user: 'other', mode: 'multi-user', uid: 2002 });
    assert.equal((await json(main.url + '/api/targets', write('POST', cookie, { user: 'other', baseUrl: other.url }))).response.status, 503);
});
