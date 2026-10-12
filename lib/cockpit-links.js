'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const dotenv = require('dotenv');
const { validateTarget } = require('./targets');

function dashboardUrl(value) {
    let parsed;
    try { parsed = new URL(value); } catch { throw new Error('Use an HTTP(S) dashboard URL without embedded credentials'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Use an HTTP(S) dashboard URL without embedded credentials');
    return parsed.href;
}
function dashboardPort(value) {
    if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) throw new Error('Port must be between 1 and 65535');
    return Number(value);
}
function loopback(host) {
    return ['localhost', '0.0.0.0', '[::1]', '[::]'].includes(host) || /^127\.\d+\.\d+\.\d+$/.test(host);
}
async function readCockpitLinks(root, user, overrides = {}, env = process.env) {
    let fileEnv = {};
    try { fileEnv = dotenv.parse(await fs.readFile(path.join(root, '.env'))); }
    catch (err) { if (err.code !== 'ENOENT') throw new Error('Cannot read project .env'); }
    const port = dashboardPort(overrides.port ?? (env.PORT || fileEnv.PORT || 8877));
    const own = { user, port, url: overrides.url === undefined ? null : dashboardUrl(overrides.url) };
    const targetsFile = path.resolve(root, env.PM2_MONITOR_TARGETS_FILE || fileEnv.PM2_MONITOR_TARGETS_FILE || './config/pm2-targets.json');
    const links = [own];
    let doc;
    try {
        const stat = await fs.stat(targetsFile);
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error();
        doc = JSON.parse(await fs.readFile(targetsFile, 'utf8'));
    } catch (err) {
        if (err.code === 'ENOENT') return { links, targetsFile, hasTargetsFile: false };
        throw new Error('Cannot read targets configuration: expected a regular JSON file of at most 1 MiB');
    }
    if (!doc || typeof doc !== 'object' || Object.keys(doc).length !== 1 || !Array.isArray(doc.targets)) throw new Error('Invalid targets configuration: expected { "targets": [...] }');
    const users = new Set(), urls = new Set();
    for (const input of doc.targets) {
        const target = validateTarget(input, user);
        if (users.has(target.user) || urls.has(target.baseUrl)) throw new Error('Duplicate target user or URL');
        users.add(target.user); urls.add(target.baseUrl);
        const url = new URL(target.baseUrl);
        // Copy only public link data; passwords/env variable names stay on server.
        links.push({ user: target.user, url: target.baseUrl, useCockpitHost: loopback(url.hostname) });
    }
    return { links, targetsFile, hasTargetsFile: true };
}
module.exports = { readCockpitLinks, dashboardPort, dashboardUrl };
