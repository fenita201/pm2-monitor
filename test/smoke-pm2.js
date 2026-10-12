'use strict';
// Opt-in smoke test: only an isolated PM2_HOME and temporary test apps.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { LocalPM2 } = require('../lib/local-pm2');
const run = promisify(execFile);
async function main() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pm2-monitor-smoke-'));
    const home = path.join(dir, '.pm2');
    const env = { ...process.env, PM2_HOME: home, PM2_DISCRETE_MODE: 'true' };
    const cli = require.resolve('pm2/bin/pm2');
    const pm2 = args => run(process.execPath, [cli, ...args], { env, timeout: 20000 });
    const adapter = new LocalPM2({ user: os.userInfo().username, pm2Home: home, root: path.resolve(__dirname, '..') });
    let started = false;
    try {
        await assert.rejects(adapter.list(), /not running/);
        await assert.rejects(fs.stat(home), { code: 'ENOENT' });
        const file = path.join(dir, 'app.js');
        await fs.writeFile(file, "console.log('smoke test output');console.error('smoke test error');setInterval(()=>{},1000);\n");
        started = true;
        await pm2(['start', file, '--name', 'smoke <special>']);
        const list = await adapter.list(); const id = list[0].id;
        assert.equal(list[0].status, 'online'); assert.equal(list[0].name, 'smoke <special>');
        await new Promise(resolve => setTimeout(resolve, 300));
        const logs = await adapter.logs(id); assert.match(logs.out, /smoke test output/); assert.match(logs.error, /smoke test error/);
        await adapter.action('stop', id); assert.equal((await adapter.list())[0].status, 'stopped');
        await adapter.action('start', id); assert.equal((await adapter.list())[0].status, 'online');
        await adapter.action('rename', id, { newName: 'renamed <safe>' }); assert.equal((await adapter.list())[0].name, 'renamed <safe>');
        await adapter.action('restart', id); assert.equal((await adapter.list())[0].status, 'online');
        await adapter.action('delete', id); assert.equal((await adapter.list()).length, 0);
        await assert.rejects(adapter.action('restart', id), /not found/);
        console.log('PASS: isolated PM2 daemon list/log/stop/start/rename/restart/delete; absent daemon is not created by reads');
    } finally {
        adapter.close(); if (started) await pm2(['kill']); await fs.rm(dir, { recursive: true, force: true });
    }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
