'use strict';
const { AppError, validateAction } = require('./errors');

class RemoteDashboard {
    constructor(target, password, options = {}) {
        this.target = target; this.password = password; this.cookie = null;
        this.fetch = options.fetch || globalThis.fetch; this.timeout = options.timeout || 5000;
        this.controllers = new Set(); this.closed = false; this.loginPending = null;
        this.identityPending = null; this.identityAt = 0;
    }
    async request(route, options = {}, cookie = false) {
        if (this.closed) throw new AppError('Target connection has been removed');
        if (this.controllers.size >= 8) throw new AppError('Target is busy; try again shortly', 429);
        const controller = new AbortController(); this.controllers.add(controller);
        const timer = setTimeout(() => controller.abort(), this.timeout);
        try {
            const response = await this.fetch(this.target.baseUrl + route, {
                ...options, redirect: 'error', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', ...(cookie && this.cookie ? { Cookie: this.cookie } : {}) }
            });
            const reader = response.body?.getReader();
            const chunks = []; let size = 0;
            if (reader) {
                while (true) {
                    const { done, value } = await reader.read(); if (done) break;
                    size += value.length;
                    if (size > 1024 * 1024) { await reader.cancel(); throw new AppError('Target response exceeds 1 MiB'); }
                    chunks.push(Buffer.from(value));
                }
            }
            let data;
            try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
            catch { throw new AppError('Target must run the updated PM2 Monitor'); }
            return { response, data };
        } catch (err) {
            if (err instanceof AppError) throw err;
            throw new AppError(controller.signal.aborted ? 'Target request timed out; check status before retrying' : 'Cannot reach target dashboard');
        } finally { clearTimeout(timer); this.controllers.delete(controller); }
    }
    async identity(force = false) {
        if (this.identityPending) return this.identityPending;
        if (!force && Date.now() - this.identityAt < 30000) return;
        this.identityPending = (async () => {
            const { response, data } = await this.request('/api/info');
            if (!response.ok || data.protocolVersion !== 1) throw new AppError('Target must run the updated PM2 Monitor');
            if (data.mode !== 'single-user') throw new AppError('Target dashboard must use single-user mode');
            if (data.user !== this.target.user || !Number.isSafeInteger(data.uid) || data.uid <= 0) throw new AppError('Target Linux user identity does not match configuration');
            if (typeof data.sessionCookie !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(data.sessionCookie)) throw new AppError('Invalid target session configuration');
            this.sessionCookie = data.sessionCookie;
            this.identityAt = Date.now();
        })().finally(() => { this.identityPending = null; });
        return this.identityPending;
    }
    async login() {
        if (this.loginPending) return this.loginPending;
        if (!this.password) throw new AppError('Configure the target dashboard admin password to enable controls', 403);
        this.loginPending = (async () => {
            const { response, data } = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ password: this.password }) });
            if (!response.ok || data.success !== true) throw new AppError('Target dashboard admin password was rejected', 403);
            const cookies = response.headers.getSetCookie();
            const session = cookies.map(c => c.split(';')[0]).find(c => c.startsWith(`${this.sessionCookie}=`));
            if (!session) throw new AppError('Target did not provide an admin session');
            this.cookie = session;
        })().finally(() => { this.loginPending = null; });
        return this.loginPending;
    }
    async verify() { await this.identity(true); if (this.password) await this.login(); }
    async list() {
        await this.identity();
        const { response, data } = await this.request('/api/status');
        if (!response.ok || !Array.isArray(data.processes) || !Array.isArray(data.targets)) throw new AppError('Invalid target status response');
        const targetState = data.targets.find(t => t.user === this.target.user);
        if (!targetState || targetState.error) throw new AppError(targetState?.error ? 'Target PM2 daemon is unavailable' : 'Target identity is missing from status');
        const seen = new Set();
        return data.processes.map(p => {
            if (p.targetUser !== this.target.user || !Number.isSafeInteger(p.id) || p.id < 0 || seen.has(p.id) || typeof p.name !== 'string' || typeof p.status !== 'string' || typeof p.protected !== 'boolean' || !Number.isFinite(Number(p.memory)) || !Number.isFinite(Number(p.cpu))) throw new AppError('Invalid target process data');
            seen.add(p.id);
            return { targetUser: this.target.user, id: p.id, name: p.name, status: p.status, memory: Number(p.memory), cpu: Number(p.cpu), uptime: p.uptime, protected: p.protected };
        });
    }
    async logs(id) {
        await this.identity();
        const { response, data } = await this.request(`/api/processes/${encodeURIComponent(this.target.user)}/${id}/logs`);
        if (!response.ok) throw new AppError('Cannot read target process logs', response.status === 404 ? 404 : 503);
        if (typeof data.out !== 'string' || typeof data.error !== 'string') throw new AppError('Invalid target log response');
        return { out: data.out, error: data.error };
    }
    async action(action, id, body) {
        validateAction(action);
        await this.identity(true);
        if (!this.cookie) await this.login();
        const route = `/api/processes/${encodeURIComponent(this.target.user)}/${id}/${action}`;
        const options = { method: 'POST', body: JSON.stringify(body || {}) };
        let result = await this.request(route, options, true);
        if (result.response.status === 401) {
            this.cookie = null; await this.login();
            result = await this.request(route, options, true);
        }
        if (!result.response.ok || result.data.success !== true) {
            const status = result.response.status;
            const message = status === 403 ? 'Target refused the operation (protected process or permission denied)' : status === 404 ? 'Process not found on target' : status === 409 ? 'Target process state changed; refresh and retry' : 'Target PM2 operation failed; check status before retrying';
            throw new AppError(message, [400, 403, 404, 409].includes(status) ? status : 503);
        }
    }
    close() { this.closed = true; this.cookie = null; for (const c of this.controllers) c.abort(); }
}
module.exports = { RemoteDashboard };
