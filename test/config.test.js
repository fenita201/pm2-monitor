'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadConfig } = require('../lib/config');
const { validateTarget } = require('../lib/targets');
const { processId, validateAction } = require('../lib/errors');
const identity = { uid: 1200, username: 'deploy', homedir: '/srv/deploy' };
test('mode defaults, invalid modes, OS identity and PM2_HOME', () => {
    for (const mode of [undefined, '', '   ']) {
        const config = loadConfig({ PM2_MONITOR_MODE: mode, PM2_MONITOR_TARGETS_FILE: '/does/not/exist' }, identity, '/project');
        assert.equal(config.mode, 'single-user'); assert.equal(config.targetsFile, null);
        assert.equal(config.user, 'deploy'); assert.equal(config.pm2Home, '/srv/deploy/.pm2');
    }
    assert.equal(loadConfig({ PM2_HOME: '/srv/custom-pm2' }, identity).pm2Home, '/srv/custom-pm2');
    assert.throws(() => loadConfig({ PM2_MONITOR_MODE: 'auto' }, identity), /must be/);
    assert.throws(() => loadConfig({}, { ...identity, uid: 0 }), /non-root/);
    assert.throws(() => loadConfig({ PORT: 'bad' }, identity), /PORT/);
    assert.equal(loadConfig({ PM2_MONITOR_MODE: ' multi-user ', PM2_MONITOR_TARGETS_FILE: 'config/users.json' }, identity, '/project').targetsFile, path.join('/project', 'config/users.json'));
});
test('target schema accepts HTTP dashboard origins; rejects arbitrary commands and ambiguous secrets', () => {
    assert.deepEqual(validateTarget({ user: 'appuser', baseUrl: 'http://127.0.0.1:8888/' }, 'deploy'), { user: 'appuser', baseUrl: 'http://127.0.0.1:8888' });
    for (const target of [
        { user: 'root', baseUrl: 'http://localhost' }, { user: 'deploy', baseUrl: 'http://localhost' },
        { user: 'x;id', baseUrl: 'http://localhost' }, { user: 'appuser', baseUrl: 'file:///etc/passwd' },
        { user: 'appuser', baseUrl: 'http://u:p@localhost' }, { user: 'appuser', baseUrl: 'http://localhost/api/status' },
        { user: 'appuser', baseUrl: 'http://localhost', nodePath: '/bin/node' },
        { user: 'appuser', baseUrl: 'http://localhost', password: 'secret', adminPasswordEnv: 'PASS' }
    ]) assert.throws(() => validateTarget(target, 'deploy'));
});
test('only safe integer process IDs and whitelisted actions are accepted', () => {
    assert.equal(processId('0'), 0);
    for (const value of ['all', '*', 'app', '-1', '1.0', '01', '1e2', '9007199254740992', 0]) assert.throws(() => processId(value));
    for (const action of ['start', 'stop', 'restart', 'delete', 'rename']) validateAction(action);
    assert.throws(() => validateAction('exec'));
});
