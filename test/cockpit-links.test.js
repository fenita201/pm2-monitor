'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { readCockpitLinks } = require('../lib/cockpit-links');

async function fixture(t, env, targets) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm2-cockpit-config-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.writeFile(path.join(root, '.env'), env);
    await fs.mkdir(path.join(root, 'config'));
    if (targets) await fs.writeFile(path.join(root, 'config/pm2-targets.json'), JSON.stringify({ targets }));
    return root;
}
test('own dashboard comes first, port comes from project .env, missing targets are optional', async t => {
    const root = await fixture(t, 'PORT=8888\nADMIN_PASSWORD=env-private-password\nSESSION_SECRET=env-private-secret\n');
    const result = await readCockpitLinks(root, 'worker', {}, {});
    assert.deepEqual(result.links, [{ user: 'worker', port: 8888, url: null }]);
    assert.equal(result.hasTargetsFile, false);
    assert.ok(!JSON.stringify(result).includes('env-private'));
    const overridden = await readCockpitLinks(root, 'worker', { port: 8890, url: 'https://dashboard.example.com/' }, {});
    assert.deepEqual(overridden.links, [{ user: 'worker', port: 8890, url: 'https://dashboard.example.com/' }]);
});
test('append N targets in config order, remap loopback and never export credential values or variable names', async t => {
    const root = await fixture(t, 'PORT=8877\nPM2_MONITOR_MODE=single-user\n', [
        { user: 'worker', baseUrl: 'http://127.0.0.1:8888', password: 'target-private-password' },
        { user: 'service-a', baseUrl: 'https://[::1]:8890', adminPasswordEnv: 'PRIVATE_CREDENTIAL_VAR' },
        { user: 'appuser', baseUrl: 'https://apps.example.com' }
    ]);
    const file = path.join(root, 'config/pm2-targets.json'); await fs.chmod(file, 0o600);
    const result = await readCockpitLinks(root, 'deploy', {}, {});
    assert.deepEqual(result.links.map(link => link.user), ['deploy', 'worker', 'service-a', 'appuser']);
    assert.deepEqual(result.links.slice(1).map(link => link.useCockpitHost), [true, true, false]);
    const serialized = JSON.stringify({ links: result.links });
    for (const secret of ['target-private-password', 'PRIVATE_CREDENTIAL_VAR', 'password', 'adminPasswordEnv']) assert.ok(!serialized.includes(secret));
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});
test('custom targets path resolves from project root; runtime PORT and explicit arguments preserve precedence', async t => {
    const root = await fixture(t, 'PORT=8888\nPM2_MONITOR_TARGETS_FILE=./config/custom.json\n');
    await fs.writeFile(path.join(root, 'config/custom.json'), JSON.stringify({ targets: [{ user: 'worker', baseUrl: 'http://localhost:9999' }] }));
    const result = await readCockpitLinks(root, 'deploy', {}, { PORT: '9000' });
    assert.equal(result.links[0].port, 9000); assert.equal(result.links[1].user, 'worker');
    assert.equal(result.targetsFile, path.join(root, 'config/custom.json'));
    assert.equal((await readCockpitLinks(root, 'deploy', { port: 9001 }, { PORT: '9000' })).links[0].port, 9001);
});
test('invalid JSON/schema/duplicate targets/credential URLs reject without leaking source file content', async t => {
    const root = await fixture(t, 'PORT=8877\n'); const file = path.join(root, 'config/pm2-targets.json');
    for (const data of ['{"password":"private-value",', '{}', JSON.stringify({ targets: [{ user: 'worker', baseUrl: 'http://localhost:8888' }, { user: 'worker', baseUrl: 'http://localhost:8889' }] })]) {
        await fs.writeFile(file, data);
        await assert.rejects(readCockpitLinks(root, 'deploy', {}, {}), error => !error.message.includes('private-value'));
    }
    await assert.rejects(readCockpitLinks(root, 'deploy', { url: 'http://user:private-value@example.com' }, {}), /without embedded credentials/);
});
