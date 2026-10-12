'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { AppError } = require('./errors');

function validateTarget(input, currentUser) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Invalid target', 400);
    if (Object.keys(input).some(key => !['user', 'baseUrl', 'password', 'adminPasswordEnv'].includes(key))) throw new AppError('Unknown target field', 400);
    const { user } = input;
    if (typeof user !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_.-]{0,63}\$?$/.test(user) || user === 'root' || user === currentUser) {
        throw new AppError('Target must name a different, non-root Linux user', 400);
    }
    let url;
    try { url = new URL(input.baseUrl); } catch { throw new AppError('Invalid dashboard URL', 400); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw new AppError('Use an HTTP(S) dashboard origin without credentials, path or query', 400);
    }
    const target = { user, baseUrl: url.origin };
    if (input.password !== undefined) {
        if (typeof input.password !== 'string' || !input.password.length || input.password.length > 1024) throw new AppError('Invalid dashboard password', 400);
        target.password = input.password;
    }
    if (input.adminPasswordEnv !== undefined) {
        if (typeof input.adminPasswordEnv !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(input.adminPasswordEnv)) throw new AppError('Invalid password environment variable name', 400);
        target.adminPasswordEnv = input.adminPasswordEnv;
    }
    if (target.password && target.adminPasswordEnv) throw new AppError('Choose password or adminPasswordEnv, not both', 400);
    return target;
}

class TargetStore {
    constructor(config, env = process.env) {
        this.file = config.targetsFile; this.currentUser = config.user; this.env = env;
        this.targets = []; this.queue = Promise.resolve(); this.queued = 0;
    }
    async load() {
        if (!this.file) return;
        try {
            const stat = await fs.lstat(this.file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) throw new Error('Targets file must be a regular file of at most 1 MiB');
            const doc = JSON.parse(await fs.readFile(this.file, 'utf8'));
            if (!doc || Object.keys(doc).length !== 1 || !Array.isArray(doc.targets)) throw new Error('Expected { "targets": [...] }');
            const targets = doc.targets.map(t => validateTarget(t, this.currentUser));
            if (new Set(targets.map(t => t.user)).size !== targets.length || new Set(targets.map(t => t.baseUrl)).size !== targets.length) throw new Error('Duplicate target user or URL');
            await fs.chmod(this.file, 0o600);
            this.targets = targets;
        } catch (err) {
            if (err.code === 'ENOENT') return; // UI can create the first targets file.
            throw new Error(`Invalid targets configuration: ${err instanceof SyntaxError ? 'Invalid JSON' : err.message}`);
        }
    }
    password(target) { return target.password || (target.adminPasswordEnv ? this.env[target.adminPasswordEnv] : undefined); }
    publicList() { return this.targets.map(t => ({ user: t.user, baseUrl: t.baseUrl, hasPassword: Boolean(this.password(t)) })); }
    mutate(task) {
        if (this.queued >= 16) return Promise.reject(new AppError('Target configuration is busy; try again shortly', 429));
        this.queued++;
        const next = this.queue.then(task).finally(() => { this.queued--; });
        this.queue = next.catch(() => {}); return next;
    }
    async save(targets) {
        const content = JSON.stringify({ targets }, null, 2) + '\n';
        if (Buffer.byteLength(content) > 1024 * 1024) throw new AppError('Targets configuration exceeds 1 MiB', 400);
        const temp = `${this.file}.${crypto.randomUUID()}.tmp`;
        try {
            await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
            await fs.writeFile(temp, content, { flag: 'wx', mode: 0o600 });
            await fs.rename(temp, this.file);
            this.targets = targets;
        } catch { throw new AppError('Cannot save target configuration; check directory permissions and disk space', 500); }
        finally { await fs.unlink(temp).catch(() => {}); }
    }
}
module.exports = { TargetStore, validateTarget };
