'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const { LocalPM2, tail } = require('../lib/local-pm2');
const { CachedTarget, mapLimit } = require('../lib/manager');
const { TargetStore } = require('../lib/targets');
const { loadConfig } = require('../lib/config');

async function transport(t, handler) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm2-monitor-rpc-test-'));
    const server = net.createServer();
    await new Promise(resolve => server.listen(path.join(dir, 'rpc.sock'), resolve));
    let count = 0;
    const config = { user: 'deploy', pm2Home: dir, root: '/project' };
    const local = new LocalPM2(config, { timeout: 30, socketFactory: () => {
        count++;
        const socket = new EventEmitter(); socket.connected = false;
        socket.connect = () => setImmediate(() => { socket.connected = true; socket.emit('connect'); });
        socket.close = () => { socket.connected = false; socket.emit('close'); };
        return { socket, client: { call: handler } };
    } });
    t.after(async () => { local.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
    return { local, config, count: () => count };
}
const processData = () => [{ pm_id: 0, pid: 99999, name: 'pm2-dashboard', pm2_env: { status: 'stopped', pm_exec_path: '/other/app.js' }, monit: { memory: 1048576, cpu: 1 } }];

test('absent daemon never creates PM2_HOME or spawns a transport', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm2-monitor-absent-'));
    const home = path.join(dir, 'missing'); let factories = 0;
    const local = new LocalPM2({ user: 'deploy', pm2Home: home, root: '/project' }, { socketFactory: () => { factories++; throw new Error(); } });
    t.after(async () => { local.close(); await fs.rm(dir, { recursive: true, force: true }); });
    await assert.rejects(local.list(), /not running/); assert.equal(factories, 0);
    await assert.rejects(fs.stat(home), { code: 'ENOENT' });
});
test('one PM2 socket for concurrent requests; exact numeric RPC operations; dashboard identity protection', async t => {
    let data = processData(); const calls = [];
    const { local, count } = await transport(t, (method, args, cb) => {
        calls.push({ method, args }); setImmediate(() => cb(null, method === 'getMonitorData' ? data : {}));
    });
    await Promise.all(Array.from({ length: 8 }, () => local.list())); assert.equal(count(), 1);
    assert.equal((await local.list())[0].protected, false); // Name alone does not lock an unrelated app.
    await local.action('start', 0); assert.deepEqual(calls.at(-1), { method: 'restartProcessId', args: { id: 0 } });
    await local.action('stop', 0); assert.deepEqual(calls.at(-1), { method: 'stopProcessId', args: 0 });
    await local.action('rename', 0, { newName: 'safe <text>' }); assert.equal(calls.at(-1).args.env.current_conf.name, 'safe <text>');
    await assert.rejects(local.action('exec', 0), /Unsupported action/);
    data[0].pid = process.pid;
    for (const action of ['stop', 'delete', 'rename']) await assert.rejects(local.action(action, 0), /protected/);
    data[0].pid = 99999; data[0].pm2_env.pm_exec_path = '/project/server.js';
    assert.equal((await local.list())[0].protected, true);
    await assert.rejects(local.action('stop', 99), /not found/);
});
test('PM2 timeout resets connection, reconnects on next attempt, and close rejects pending operations', async t => {
    let hung = true;
    const { local, count } = await transport(t, (method, args, cb) => { if (!hung) setImmediate(() => cb(null, processData())); });
    await assert.rejects(local.list(), /timed out/); hung = false;
    assert.equal((await local.list()).length, 1); assert.equal(count(), 2);
    hung = true;
    const pending = local.list(); await new Promise(resolve => setImmediate(resolve)); local.close();
    await assert.rejects(pending, /shutting down/);
    await assert.rejects(local.list(), /shutting down/);
});
test('PM2 errors are failures rather than success', async t => {
    const { local } = await transport(t, (method, args, cb) => setImmediate(() => cb(method === 'getMonitorData' ? null : new Error('failed'), processData())));
    await assert.rejects(local.action('restart', 0), /operation failed/);
});
test('log tail is byte/line bounded and includes no arbitrary browser path', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm2-monitor-log-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'out.log');
    await fs.writeFile(file, 'old line\n'.repeat(100000) + 'final line\n');
    const text = await tail(file);
    assert.ok(Buffer.byteLength(text) <= 65536); assert.ok(text.split('\n').length <= 100); assert.match(text, /final line/);
    assert.equal(await tail(path.join(dir, 'missing')), 'No logs.');
});
test('cache coalesces reads, backs off failures, serializes actions, and closes adapters', async () => {
    let calls = 0, release; const adapter = { list: async () => { calls++; throw new Error('offline'); }, action: () => new Promise(resolve => { release = resolve; }), close() { this.closed = true; } };
    const cache = new CachedTarget(adapter);
    await Promise.all(Array.from({ length: 10 }, () => assert.rejects(cache.list(), /offline/)));
    assert.equal(calls, 1); await assert.rejects(cache.list(), /offline/); assert.equal(calls, 1);
    const action = cache.action('restart', 0);
    await assert.rejects(cache.action('restart', 0), /in progress/); release(); await action;
    assert.equal(cache.cache.size, 0); cache.close(); assert.equal(adapter.closed, true);
    await assert.rejects(cache.list(), /removed/);
});
test('polling many targets uses bounded concurrency', async () => {
    let active = 0, highest = 0;
    const result = await mapLimit(Array.from({ length: 20 }, (_, i) => i), 4, async i => {
        active++; highest = Math.max(highest, active); await new Promise(resolve => setImmediate(resolve)); active--; return i;
    });
    assert.equal(highest, 4); assert.deepEqual(result, Array.from({ length: 20 }, (_, i) => i));
});
test('target configuration validates startup schema, duplicates, secrets references and single-user ignores invalid file', async t => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm2-monitor-config-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'targets.json'); const identity = { uid: 1200, username: 'deploy', homedir: '/srv/deploy' };
    const config = loadConfig({ PM2_MONITOR_MODE: 'multi-user', PM2_MONITOR_TARGETS_FILE: file }, identity);
    const store = new TargetStore(config, { TARGET_PASSWORD: 'sample-test-secret' });
    for (const doc of ['{bad', '{}', '{"targets":{}}', JSON.stringify({ targets: [{ user: 'appuser', baseUrl: 'http://localhost' }, { user: 'appuser', baseUrl: 'http://localhost:8888' }] })]) {
        await fs.writeFile(file, doc); await assert.rejects(store.load(), /Invalid targets/);
    }
    const single = new TargetStore(loadConfig({ PM2_MONITOR_TARGETS_FILE: file }, identity)); await single.load(); assert.deepEqual(single.targets, []);
    await fs.writeFile(file, JSON.stringify({ targets: [{ user: 'worker', baseUrl: 'http://localhost:8888', adminPasswordEnv: 'TARGET_PASSWORD' }] }));
    await store.load(); assert.equal(store.password(store.targets[0]), 'sample-test-secret');
    assert.ok(!JSON.stringify(store.publicList()).includes('sample-test-secret'));
});
