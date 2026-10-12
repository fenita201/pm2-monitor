'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server');
const { loadConfig } = require('../lib/config');
const { AppError } = require('../lib/errors');
const root = path.resolve(__dirname, '..');
const stats = async () => ({ load: .2, loadPercent: 2, totalMem: 8, freeMem: 6, uptime: 100, disk: { percent: 20, used: 2, total: 10 } });
function fakeLocal(user, processes = [{ id: 0, name: `${user} app`, status: 'stopped' }]) {
    return {
        calls: [], lists: 0, closed: false, fail: null,
        async list() {
            this.lists++; if (this.fail) throw this.fail;
            return processes.map(p => ({ targetUser: user, memory: 12, cpu: 2, uptime: 1, protected: false, ...p }));
        },
        async logs(id) { if (!processes.some(p => p.id === id)) throw new AppError('Process not found', 404); return { out: `${user}:${id}`, error: '' }; },
        async action(action, id, body) {
            const p = processes.find(p => p.id === id); if (!p) throw new AppError('Process not found', 404);
            if (p.protected && ['stop', 'delete', 'rename'].includes(action)) throw new AppError('Dashboard process is protected', 403);
            this.calls.push({ action, id, body });
            if (action === 'start' || action === 'restart') p.status = 'online';
            if (action === 'stop') p.status = 'stopped';
            if (action === 'rename') p.name = body.newName;
            if (action === 'delete') processes.splice(processes.indexOf(p), 1);
        },
        close() { this.closed = true; }
    };
}
async function start(t, { user = 'deploy', mode = 'single-user', local, targets, remoteFactory, uid = 1200, adminPassword = 'test-admin', directory } = {}) {
    const dir = directory || await fs.mkdtemp(path.join(os.tmpdir(), 'pm2-monitor-test-'));
    const env = { PM2_MONITOR_MODE: mode, PM2_MONITOR_TARGETS_FILE: path.join(dir, 'targets.json'), ADMIN_PASSWORD: adminPassword, SESSION_SECRET: `test-secret-${user}` };
    if (targets) await fs.writeFile(env.PM2_MONITOR_TARGETS_FILE, JSON.stringify({ targets }));
    const config = loadConfig(env, { username: user, uid, homedir: `/srv/${user}` }, root);
    const adapter = local || fakeLocal(user);
    const runtime = await createApp({ config, local: adapter, stats, remoteFactory });
    const server = await new Promise(resolve => { const s = runtime.app.listen(0, '127.0.0.1', () => resolve(s)); });
    const url = `http://127.0.0.1:${server.address().port}`;
    t.after(async () => { runtime.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (!directory) await fs.rm(dir, { recursive: true, force: true }); });
    return { ...runtime, server, url, dir, local: adapter };
}
async function json(url, options) {
    const response = await fetch(url, options); return { response, data: await response.json() };
}
async function login(url, password = 'test-admin') {
    const { response, data } = await json(url + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    if (!response.ok) throw new Error(JSON.stringify(data));
    return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
function write(method, cookie, body = {}) { return { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) }; }
module.exports = { start, fakeLocal, json, login, write, stats, root };
