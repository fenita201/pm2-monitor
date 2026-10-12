'use strict';
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

function loadConfig(env = process.env, identity = os.userInfo(), root = path.resolve(__dirname, '..')) {
    const mode = (env.PM2_MONITOR_MODE || '').trim() || 'single-user';
    if (!['single-user', 'multi-user'].includes(mode)) throw new Error('PM2_MONITOR_MODE must be single-user or multi-user');
    if (identity.uid === 0) throw new Error('Run PM2 Monitor as a non-root Linux user');
    const port = Number(env.PORT || 8877);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
    return {
        mode, port, host: env.HOST || undefined, root,
        user: identity.username, uid: identity.uid,
        pm2Home: path.resolve(env.PM2_HOME || path.join(identity.homedir, '.pm2')),
        targetsFile: mode === 'multi-user' ? path.resolve(root, env.PM2_MONITOR_TARGETS_FILE || './config/pm2-targets.json') : null,
        adminPassword: env.ADMIN_PASSWORD || 'admin123',
        sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex')
    };
}
module.exports = { loadConfig };
