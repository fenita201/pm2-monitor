'use strict';
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const session = require('express-session');
const checkDiskSpace = require('check-disk-space').default;
const { loadConfig } = require('./lib/config');
const { TargetStore, validateTarget } = require('./lib/targets');
const { LocalPM2 } = require('./lib/local-pm2');
const { Manager } = require('./lib/manager');
const { AppError, processId, validateAction } = require('./lib/errors');

const route = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
function makeStats() {
    let pending, until = 0;
    return () => {
        if (pending && Date.now() < until) return pending;
        until = Infinity;
        pending = checkDiskSpace('/').then(disk => ({
            load: Number(os.loadavg()[0].toFixed(2)),
            loadPercent: Math.min(100, os.loadavg()[0] / os.cpus().length * 100),
            totalMem: os.totalmem() / 1073741824, freeMem: os.freemem() / 1073741824,
            uptime: os.uptime(), disk: {
                percent: (disk.size - disk.free) / disk.size * 100,
                used: (disk.size - disk.free) / 1073741824, total: disk.size / 1073741824
            }
        })).finally(() => { until = Date.now() + 1500; });
        return pending;
    };
}
async function createApp(options = {}) {
    const config = options.config || loadConfig();
    const store = options.store || new TargetStore(config);
    await store.load();
    const local = options.local || new LocalPM2(config);
    const manager = new Manager(config, store, local, options.remoteFactory);
    const stats = options.stats || makeStats();
    const app = express();
    const sessionCookie = `pm2-monitor.${config.uid}.${config.port}`;
    app.disable('x-powered-by');
    app.use(express.json({ limit: '16kb' }));
    app.use(session({
        name: sessionCookie,
        secret: config.sessionSecret, resave: false, saveUninitialized: false,
        cookie: { httpOnly: true, sameSite: 'lax', maxAge: 3600000 }
    }));
    app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    // Browser writes must be same-origin. Backend HTTP calls have no Origin.
    app.use((req, res, next) => {
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('origin')) {
            try { if (new URL(req.get('origin')).host !== req.get('host')) throw new Error(); }
            catch { return res.status(403).json({ success: false, message: 'Cross-origin writes are not allowed' }); }
        }
        next();
    });
    const checkAdmin = (req, res, next) => req.session.isLoggedIn ? next() : res.status(401).json({ success: false, message: 'Unauthorized' });
    const checkMulti = (req, res, next) => config.mode === 'multi-user' ? next() : res.status(404).json({ success: false, message: 'Target management requires multi-user mode' });

    app.post('/auth/login', route(async (req, res) => {
        if (req.body?.password !== config.adminPassword) return res.status(401).json({ success: false, message: 'Incorrect admin password' });
        await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
        req.session.isLoggedIn = true;
        await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
        res.json({ success: true });
    }));
    app.get('/auth/logout', route(async (req, res) => {
        await new Promise((resolve, reject) => req.session.destroy(err => err ? reject(err) : resolve()));
        res.clearCookie(sessionCookie); res.redirect('/');
    }));
    app.get('/api/info', (req, res) => res.json({ protocolVersion: 1, mode: config.mode, user: config.user, uid: config.uid, sessionCookie }));
    app.get('/api/status', route(async (req, res) => {
        const [status, serverStats] = await Promise.all([manager.status(), stats()]);
        res.json({ ...status, mode: config.mode, currentUser: config.user, isAdmin: Boolean(req.session.isLoggedIn), serverStats });
    }));

    app.get('/api/targets', checkAdmin, checkMulti, (req, res) => res.json({ targets: store.publicList() }));
    const saveTarget = route(async (req, res) => {
        await store.mutate(async () => {
            const previous = req.params.user ? store.targets.find(t => t.user === req.params.user) : undefined;
            if (req.params.user && !previous) throw new AppError('Target not found', 404);
            const input = { ...req.body };
            if (previous && !input.password && !input.adminPasswordEnv) {
                if (previous.password) input.password = previous.password;
                if (previous.adminPasswordEnv) input.adminPasswordEnv = previous.adminPasswordEnv;
            }
            const target = validateTarget(input, config.user);
            if (store.targets.some(t => t !== previous && (t.user === target.user || t.baseUrl === target.baseUrl))) throw new AppError('Target user or URL already exists', 409);
            const adapter = manager.remoteFactory(target, store.password(target));
            try { await adapter.verify(); } finally { adapter.close(); }
            const targets = previous ? store.targets.map(t => t === previous ? target : t) : [...store.targets, target];
            await store.save(targets); manager.refresh();
        });
        res.json({ success: true, targets: store.publicList() });
    });
    app.post('/api/targets', checkAdmin, checkMulti, saveTarget);
    app.put('/api/targets/:user', checkAdmin, checkMulti, saveTarget);
    app.delete('/api/targets/:user', checkAdmin, checkMulti, route(async (req, res) => {
        await store.mutate(async () => {
            if (!store.targets.some(t => t.user === req.params.user)) throw new AppError('Target not found', 404);
            await store.save(store.targets.filter(t => t.user !== req.params.user)); manager.refresh();
        });
        res.json({ success: true, targets: store.publicList() });
    }));

    const logs = route(async (req, res) => {
        if (Object.keys(req.query).length) throw new AppError('Log requests do not accept paths or query parameters', 400);
        const adapter = manager.target(req.params.user || config.user);
        res.json(await adapter.logs(processId(req.params.id)));
    });
    const action = route(async (req, res) => {
        if (Object.keys(req.query).length) throw new AppError('Action requests do not accept query parameters', 400);
        const adapter = manager.target(req.params.user || config.user);
        const id = processId(req.params.id); validateAction(req.params.action);
        const body = req.body || {};
        if (typeof body !== 'object' || Array.isArray(body)) throw new AppError('Invalid action request', 400);
        if (req.params.action === 'rename' && (typeof body.newName !== 'string' || !body.newName.trim() || body.newName.length > 128 || /[\x00-\x1f\x7f]/.test(body.newName))) throw new AppError('Invalid process name', 400);
        if (Object.keys(body).some(k => req.params.action !== 'rename' || k !== 'newName')) throw new AppError('Unexpected action field', 400);
        await adapter.action(req.params.action, id, req.params.action === 'rename' ? { newName: body.newName.trim() } : {});
        res.json({ success: true });
    });
    app.get('/api/processes/:user/:id/logs', logs);
    app.post('/api/processes/:user/:id/:action', checkAdmin, action);
    // Original endpoints remain local-only, including in multi-user mode.
    app.get('/api/logs/:id', logs);
    app.post('/api/:action/:id', checkAdmin, action);
    app.use('/api', (req, res) => res.status(404).json({ success: false, message: 'API route not found' }));
    app.use(express.static(path.join(config.root, 'public')));
    app.use((err, req, res, next) => {
        if (res.headersSent) return next(err);
        const status = err instanceof AppError ? err.status : err.type === 'entity.parse.failed' ? 400 : err.type === 'entity.too.large' ? 413 : 500;
        res.status(status).json({ success: false, message: err instanceof AppError ? err.message : status === 400 ? 'Invalid JSON request' : status === 413 ? 'Request too large' : 'Request failed' });
    });
    return { app, config, store, manager, close: () => manager.close() };
}
if (require.main === module) {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
    createApp().then(runtime => {
        const server = runtime.app.listen(runtime.config.port, runtime.config.host, () => {
            console.log(`PM2 Monitor: ${runtime.config.mode}, user=${runtime.config.user}, port=${runtime.config.port}`);
        });
        server.on('error', err => { console.error(`Cannot start dashboard: ${err.code || 'listen failed'}`); runtime.close(); process.exitCode = 1; });
        const shutdown = () => {
            runtime.close(); server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 5000).unref();
        };
        process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    }).catch(err => { console.error(`Configuration error: ${err.message}`); process.exitCode = 1; });
}
module.exports = { createApp };
