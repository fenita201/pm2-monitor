'use strict';
// Real PM2, isolated daemon/apps/ports. Never use production PM2_HOME.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { LocalPM2 } = require('../lib/local-pm2');
const run = promisify(execFile);
async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function ready(url) {
    for (let i = 0; i < 40; i++) {
        try { const response = await fetch(url + '/api/info'); if (response.ok) return response.json(); } catch {}
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Test dashboard did not become ready');
}
async function main() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm2-monitor-ecosystem-'));
    const home = path.join(dir, '.pm2'); const root = path.resolve(__dirname, '..');
    const cli = process.env.PM2_TEST_CLI || require.resolve('pm2/bin/pm2');
    const env = { ...process.env, PM2_HOME: home, PM2_DISCRETE_MODE: 'true' };
    const pm2 = args => run(process.execPath, [cli, ...args], { env, timeout: 20000 });
    const ports = [await freePort(), await freePort()];
    const config = require('../ecosystem.config'); const optimized = config.apps[0];
    assert.equal(optimized.instances, 1); assert.equal(optimized.cwd, root);
    assert.equal(optimized.interpreter, process.execPath);
    const baseEnv = { NODE_ENV: 'production', PM2_MONITOR_MODE: 'single-user', HOST: '127.0.0.1', ADMIN_PASSWORD: 'isolated-test-password', SESSION_SECRET: 'isolated-test-secret', PM2_HOME: home };
    const file = path.join(dir, 'ecosystem.config.js');
    const apps = [
        { ...optimized, name: 'smoke-default', automation: true, pmx: true, vizion: true, env: { ...baseEnv, PORT: String(ports[0]) } },
        { ...optimized, name: 'smoke-light', env: { ...baseEnv, PORT: String(ports[1]) } }
    ];
    await fs.writeFile(file, 'module.exports = ' + JSON.stringify({ apps }) + ';\n');
    const local = new LocalPM2({ user: os.userInfo().username, pm2Home: home, root });
    let started = false;
    try {
        started = true; await pm2(['start', file]);
        for (const port of ports) {
            const url = `http://127.0.0.1:${port}`;
            const info = await ready(url); assert.equal(info.mode, 'single-user'); assert.equal(info.user, os.userInfo().username);
            const status = await (await fetch(url + '/api/status')).json();
            assert.ok(status.serverStats.cpuUsage >= 0 && status.serverStats.cpuUsage <= 100);
            assert.equal(status.processes.length, 2);
            assert.ok(status.processes.every(p => p.protected));
            const response = await fetch(url + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'isolated-test-password' }) });
            const cookie = response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
            assert.equal(response.status, 200);
            const stop = await fetch(`${url}/api/processes/${encodeURIComponent(info.user)}/${status.processes[0].id}/stop`, { method: 'POST', headers: { Cookie: cookie } });
            assert.equal(stop.status, 403);
        }
        // Equal warm-up requests; sample after PM2 has settled.
        for (let i = 0; i < 3; i++) {
            await new Promise(resolve => setTimeout(resolve, 1700));
            for (const port of ports) await (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
        }
        const processes = await local.list();
        console.log(JSON.stringify({ node: process.version, pm2Cli: cli, memoryMB: processes.map(p => ({ name: p.name, memory: p.memory, status: p.status })) }));
        assert.ok(processes.every(p => p.status === 'online' && p.memory > 0));
        console.log('PASS: ecosystem runs with current Node, single fork, .env-compatible settings, CPU/RAM metrics, admin login and backend dashboard protection');
    } finally { local.close(); if (started) await pm2(['kill']); await fs.rm(dir, { recursive: true, force: true }); }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
