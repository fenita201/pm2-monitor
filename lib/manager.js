'use strict';
const { RemoteDashboard } = require('./remote');
const { AppError } = require('./errors');

class CachedTarget {
    constructor(adapter) { this.adapter = adapter; this.cache = new Map(); this.failures = 0; this.busy = false; this.closed = false; }
    read(key, operation) {
        if (this.closed) return Promise.reject(new AppError('Target connection has been removed'));
        const existing = this.cache.get(key);
        if (existing && existing.until > Date.now()) return existing.promise;
        if (!existing && this.cache.size >= 64) {
            const expired = [...this.cache].find(([, entry]) => entry.until <= Date.now());
            if (expired) this.cache.delete(expired[0]);
            else return Promise.reject(new AppError('Target is busy; try again shortly', 429));
        }
        const record = { until: Infinity };
        record.promise = Promise.resolve().then(operation).then(value => {
            this.failures = 0; record.until = Date.now() + 1500; return value;
        }, err => {
            this.failures = Math.min(this.failures + 1, 6);
            record.until = Date.now() + Math.min(30000, 1000 * 2 ** (this.failures - 1)); throw err;
        });
        this.cache.set(key, record); return record.promise;
    }
    list() { return this.read('list', () => this.adapter.list()); }
    logs(id) { return this.read(`logs:${id}`, () => this.adapter.logs(id)); }
    async action(...args) {
        if (this.closed) throw new AppError('Target connection has been removed');
        if (this.busy) throw new AppError('Another target operation is in progress', 409);
        this.busy = true;
        try { return await this.adapter.action(...args); }
        finally { this.busy = false; this.cache.clear(); }
    }
    close() { this.closed = true; this.cache.clear(); this.adapter.close(); }
}
async function mapLimit(items, limit, fn) {
    const results = new Array(items.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) { const index = next++; results[index] = await fn(items[index]); }
    }));
    return results;
}
class Manager {
    constructor(config, store, local, remoteFactory = (t, p) => new RemoteDashboard(t, p)) {
        this.config = config; this.store = store; this.remoteFactory = remoteFactory;
        this.adapters = new Map([[config.user, new CachedTarget(local)]]); this.refresh();
    }
    refresh() {
        const desired = new Map(this.store.targets.map(t => [t.user, t]));
        for (const [user, adapter] of this.adapters) {
            if (user === this.config.user) continue;
            const target = desired.get(user);
            const signature = target && JSON.stringify([target, this.store.password(target)]);
            if (signature !== adapter.signature) { adapter.close(); this.adapters.delete(user); }
        }
        for (const target of desired.values()) {
            if (!this.adapters.has(target.user)) {
                const adapter = new CachedTarget(this.remoteFactory(target, this.store.password(target)));
                adapter.signature = JSON.stringify([target, this.store.password(target)]);
                this.adapters.set(target.user, adapter);
            }
        }
        this.statusPending = null;
    }
    target(user) {
        const adapter = this.adapters.get(user);
        if (!adapter) throw new AppError('Target is not configured for this dashboard', 404);
        return adapter;
    }
    async status() {
        if (this.statusPending) return this.statusPending;
        const operation = mapLimit([...this.adapters], 4, async ([user, adapter]) => {
            try {
                const processes = await adapter.list();
                return { user, error: null, processCount: processes.length, processes };
            } catch (err) { return { user, error: err instanceof AppError ? err.message : 'Target unavailable', processCount: null, processes: [] }; }
        }).then(states => ({ targets: states.map(({ processes, ...state }) => state), processes: states.flatMap(s => s.processes) }));
        this.statusPending = operation;
        const clear = () => { if (this.statusPending === operation) this.statusPending = null; };
        operation.then(clear, clear); return operation;
    }
    close() { for (const adapter of this.adapters.values()) adapter.close(); }
}
module.exports = { Manager, CachedTarget, mapLimit };
