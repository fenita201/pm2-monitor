'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { AppError, validateAction } = require('./errors');

// Resolve the RPC libraries shipped with the locked PM2 dependency. Importing
// the PM2 API would initialize PM2_HOME and connect() can start a daemon.
function makeSocket() {
    const pm2Require = createRequire(require.resolve('pm2'));
    const socket = pm2Require('pm2-axon').socket('req');
    const Client = pm2Require('pm2-axon-rpc').Client;
    return { socket, client: new Client(socket) };
}

async function tail(file, bytes = 64 * 1024, lines = 100) {
    if (!file) return 'No logs.';
    let handle;
    try {
        handle = await fs.open(file, 'r');
        const stat = await handle.stat();
        if (!stat.isFile()) throw new AppError('Log is not a regular file');
        const start = Math.max(0, stat.size - bytes);
        const buffer = Buffer.alloc(Math.min(bytes, stat.size));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        let text = buffer.subarray(0, bytesRead).toString('utf8');
        if (start > 0) text = text.slice(text.indexOf('\n') + 1);
        return text.split('\n').slice(-lines).join('\n');
    } catch (err) {
        if (err.code === 'ENOENT') return 'No logs.';
        if (err instanceof AppError) throw err;
        throw new AppError('Cannot read process log');
    } finally { if (handle) await handle.close(); }
}

class LocalPM2 {
    constructor(config, options = {}) {
        this.user = config.user; this.home = config.pm2Home;
        this.serverPath = path.join(config.root, 'server.js');
        this.factory = options.socketFactory || makeSocket;
        this.timeout = options.timeout || 5000;
        this.socket = null; this.client = null; this.connecting = null;
        this.pending = new Set(); this.closed = false;
    }
    reset(message = 'PM2 connection closed') {
        const socket = this.socket;
        this.socket = null; this.client = null;
        for (const reject of [...this.pending]) reject(new AppError(message));
        if (socket) socket.close();
    }
    async connect() {
        if (this.closed) throw new AppError('Dashboard is shutting down');
        if (this.connecting) return this.connecting;
        if (this.client && this.socket.connected) return;
        this.connecting = (async () => {
            const socketPath = path.join(this.home, 'rpc.sock');
            try { if (!(await fs.stat(socketPath)).isSocket()) throw new Error(); }
            catch { throw new AppError('PM2 daemon is not running or its socket is inaccessible'); }
            if (this.closed) throw new AppError('Dashboard is shutting down');
            const { socket, client } = this.factory();
            this.socket = socket; this.client = client;
            await new Promise((resolve, reject) => {
                let done = false;
                const finish = err => {
                    if (done) return; done = true; clearTimeout(timer); this.pending.delete(fail);
                    err ? reject(err) : resolve();
                };
                const fail = err => finish(err);
                this.pending.add(fail);
                const timer = setTimeout(() => { finish(new AppError('PM2 connection timed out')); this.reset(); }, this.timeout);
                socket.once('connect', () => finish());
                socket.on('error', () => { finish(new AppError('Cannot connect to PM2 daemon')); if (this.socket === socket) this.reset(); });
                socket.on('close', () => { if (this.socket === socket) this.reset(); });
                socket.on('reconnect attempt', () => { if (this.socket === socket) this.reset('PM2 daemon disconnected'); });
                socket.connect(socketPath);
            });
        })().finally(() => { this.connecting = null; });
        return this.connecting;
    }
    async rpc(method, args) {
        await this.connect();
        if (this.pending.size >= 16) throw new AppError('PM2 target is busy; try again shortly', 429);
        return new Promise((resolve, reject) => {
            let done = false;
            const finish = (err, result) => {
                if (done) return; done = true; clearTimeout(timer); this.pending.delete(fail);
                err ? reject(err) : resolve(result);
            };
            const fail = err => finish(err);
            this.pending.add(fail);
            const timer = setTimeout(() => { finish(new AppError('PM2 request timed out; check status before retrying')); this.reset(); }, this.timeout);
            try { this.client.call(method, args, (err, result) => finish(err ? new AppError('PM2 operation failed') : null, result)); }
            catch { finish(new AppError('PM2 request failed')); this.reset(); }
        });
    }
    async rawList() { return this.rpc('getMonitorData', {}); }
    protected(p) {
        return p.pid === process.pid || (p.pm2_env?.pm_exec_path && path.resolve(p.pm2_env.pm_exec_path) === this.serverPath);
    }
    async list() {
        return (await this.rawList()).map(p => ({
            targetUser: this.user, id: p.pm_id, name: p.name,
            status: p.pm2_env.status, memory: Number(((p.monit?.memory || 0) / 1048576).toFixed(2)),
            cpu: p.monit?.cpu || 0, uptime: p.pm2_env.pm_uptime, protected: Boolean(this.protected(p))
        }));
    }
    async find(id) {
        const p = (await this.rawList()).find(p => p.pm_id === id);
        if (!p) throw new AppError('Process not found', 404);
        return p;
    }
    async logs(id) {
        const p = await this.find(id);
        const [out, error] = await Promise.all([tail(p.pm2_env.pm_out_log_path), tail(p.pm2_env.pm_err_log_path)]);
        return { out, error };
    }
    async action(action, id, body = {}) {
        validateAction(action);
        const p = await this.find(id);
        if (this.protected(p) && ['stop', 'delete', 'rename'].includes(action)) throw new AppError('Dashboard process is protected', 403);
        if (action === 'start' && !['stopped', 'errored'].includes(p.pm2_env.status)) throw new AppError('Start requires a stopped or errored process', 409);
        if (action === 'rename') return this.rpc('restartProcessId', { id, env: { current_conf: { name: body.newName } } });
        if (action === 'start' || action === 'restart') return this.rpc('restartProcessId', { id });
        return this.rpc(action === 'stop' ? 'stopProcessId' : 'deleteProcessId', id);
    }
    close() { this.closed = true; this.reset('Dashboard is shutting down'); }
}
module.exports = { LocalPM2, tail };
