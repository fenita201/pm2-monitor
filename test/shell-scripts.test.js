'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');
const { root } = require('./helpers');

async function fixture(t) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'monitor-shell-'));
    t.after(() => fs.rm(directory, { recursive: true, force: true }));
    for (const entry of ['setup.sh', 'start.sh', 'reload.sh', 'stop.sh', 'install-cockpit-plugin.sh', 'ecosystem.config.js', 'scripts', 'lib', 'public', 'cockpit']) {
        await fs.cp(path.join(root, entry), path.join(directory, entry), { recursive: true });
    }
    await fs.symlink(path.join(root, 'node_modules'), path.join(directory, 'node_modules'));
    const bin = path.join(directory, 'bin'); await fs.mkdir(bin);
    const calls = path.join(directory, 'calls.jsonl');
    await fs.writeFile(path.join(bin, 'node'), `#!/usr/bin/env bash
if [[ "\${1:-}" == "$TEST_SERVER" ]]; then
    "$TEST_NODE_EXE" -e 'require("node:fs").appendFileSync(process.env.TEST_CALLS, JSON.stringify({command:"foreground",args:process.argv.slice(1)})+"\\n")' "$@"
else
    exec "$TEST_NODE_EXE" "$@"
fi
`, { mode: 0o755 });
    await fs.writeFile(path.join(bin, 'pm2'), `#!/usr/bin/env bash
exec "$TEST_NODE_EXE" -e 'require("node:fs").appendFileSync(process.env.TEST_CALLS, JSON.stringify({command:"pm2",args:process.argv.slice(1),home:process.env.PM2_HOME})+"\\n")' "$@"
`, { mode: 0o755 });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_NODE_EXE: process.execPath, TEST_SERVER: path.join(directory, 'server.js'), TEST_CALLS: calls, XDG_DATA_HOME: path.join(directory, 'xdg') };
    for (const name of ['PORT', 'HOST', 'PM2_HOME', 'PM2_MONITOR_MODE', 'PM2_MONITOR_TARGETS_FILE', 'ADMIN_PASSWORD', 'SESSION_SECRET']) delete env[name];
    const run = (name, input = '', args = []) => new Promise((resolve, reject) => {
        const child = spawn('bash', [path.join(directory, name), ...args], { cwd: os.tmpdir(), env });
        let out = '', error = '';
        child.stdout.on('data', data => { out += data; }); child.stderr.on('data', data => { error += data; });
        child.on('error', reject); child.on('close', code => resolve({ code, out, error })); child.stdin.on('error', () => {});
        child.stdin.end(input);
    });
    const readEnv = async () => dotenv.parse(await fs.readFile(path.join(directory, '.env')));
    const readCalls = async () => (await fs.readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    return { directory, run, readEnv, readCalls };
}

test('setup Enter defaults creates private .env and fresh random secret without touching a PM2 daemon', async t => {
    const f = await fixture(t); const result = await f.run('setup.sh', '\n\n\n\n\n');
    assert.equal(result.code, 0, result.error);
    const env = await f.readEnv();
    assert.equal(env.PORT, '8877'); assert.equal(env.HOST, ''); assert.equal(env.PM2_MONITOR_MODE, 'single-user');
    assert.equal(env.ADMIN_PASSWORD, 'admin123'); assert.match(env.SESSION_SECRET, /^[a-f0-9]{64}$/);
    assert.equal((await fs.stat(path.join(f.directory, '.env'))).mode & 0o777, 0o600);
    assert.ok(!result.out.includes(env.SESSION_SECRET));
    await assert.rejects(f.readCalls(), { code: 'ENOENT' });
});

test('setup Enter skips an existing .env byte-for-byte; no regenerates with mode 2 and literal secrets', async t => {
    const f = await fixture(t); const file = path.join(f.directory, '.env');
    const existing = '# Keep custom entries\nPORT=8888\nADMIN_PASSWORD=original\nCUSTOM=value\n';
    await fs.writeFile(file, existing);
    assert.equal((await f.run('setup.sh', '\n')).code, 0);
    assert.equal(await fs.readFile(file, 'utf8'), existing);
    const marker = path.join(f.directory, 'must-not-exist');
    const password = `pass'"$(touch ${marker})\\n#`;
    const result = await f.run('setup.sh', `no\n9000\n127.0.0.1\n2\n${password}\nsecret # literal\n./config/custom.json\n`);
    assert.equal(result.code, 0, result.error);
    const env = await f.readEnv();
    assert.equal(env.PORT, '9000'); assert.equal(env.HOST, '127.0.0.1'); assert.equal(env.PM2_MONITOR_MODE, 'multi-user');
    assert.equal(env.ADMIN_PASSWORD, password); assert.equal(env.SESSION_SECRET, 'secret # literal');
    assert.equal(env.PM2_MONITOR_TARGETS_FILE, './config/custom.json'); assert.equal(env.CUSTOM, undefined);
    assert.ok(!result.out.includes(password)); await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
});

test('setup retries invalid port/mode and EOF leaves existing configuration intact', async t => {
    const f = await fixture(t);
    const result = await f.run('setup.sh', '0\n65536\n8888\n\nwrong\n2\n\n\n\n');
    assert.equal(result.code, 0, result.error); assert.equal((await f.readEnv()).PM2_MONITOR_MODE, 'multi-user');
    const before = await fs.readFile(path.join(f.directory, '.env'), 'utf8');
    assert.notEqual((await f.run('setup.sh', 'no\n')).code, 0);
    assert.equal(await fs.readFile(path.join(f.directory, '.env'), 'utf8'), before);
});

test('start runs setup first, Enter uses foreground and option 2 uses only the dashboard ecosystem', async t => {
    const f = await fixture(t);
    assert.equal((await f.run('start.sh', '\n\n\n\n\n\n')).code, 0);
    assert.equal((await f.readCalls())[0].command, 'foreground');
    assert.equal((await f.run('start.sh', '\n2\n')).code, 0);
    const calls = await f.readCalls();
    assert.deepEqual(calls[1].args, ['startOrReload', path.join(f.directory, 'ecosystem.config.js'), '--update-env']);
    assert.equal(calls.length, 2);
});

test('reload/stop/remove respect .env PM2_HOME and never target all processes', async t => {
    const f = await fixture(t); const home = path.join(f.directory, 'custom-pm2-home');
    await fs.writeFile(path.join(f.directory, '.env'), `PM2_HOME='${home}'\n`);
    assert.equal((await f.run('reload.sh')).code, 0);
    assert.equal((await f.run('stop.sh', '\n')).code, 0);
    assert.equal((await f.run('stop.sh', '2\n')).code, 0);
    const calls = await f.readCalls();
    assert.deepEqual(calls.map(call => call.args), [
        ['reload', path.join(f.directory, 'ecosystem.config.js'), '--update-env'], ['stop', 'pm2-dashboard'], ['delete', 'pm2-dashboard']
    ]);
    assert.ok(calls.every(call => call.home === home));
    await assert.rejects(fs.stat(home), { code: 'ENOENT' });
});

test('Cockpit shell installer forwards overrides/dry-run and installs only to isolated XDG directory', async t => {
    const f = await fixture(t);
    assert.equal((await f.run('install-cockpit-plugin.sh', '', ['--port', '8888', '--dry-run'])).code, 0);
    const plugin = path.join(f.directory, 'xdg/cockpit/pm2monitor');
    await assert.rejects(fs.stat(plugin), { code: 'ENOENT' });
    assert.equal((await f.run('install-cockpit-plugin.sh', '', ['--port', '8888'])).code, 0);
    assert.ok((await fs.readFile(path.join(plugin, 'config.js'), 'utf8')).includes('"port":8888'));
    await assert.rejects(f.readCalls(), { code: 'ENOENT' });
});
