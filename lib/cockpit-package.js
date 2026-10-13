'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const dotenv = require('dotenv');
const { dashboardPort, dashboardUrl } = require('./cockpit-links');

async function cockpitConfig(root, user, overrides = {}, env = process.env) {
    let fileEnv = {};
    try { fileEnv = dotenv.parse(await fs.readFile(path.join(root, '.env'))); }
    catch (err) { if (err.code !== 'ENOENT') throw new Error('Cannot read project .env'); }
    const port = dashboardPort(overrides.port ?? (env.PORT || fileEnv.PORT || 8877));
    const url = new URL(overrides.url === undefined ? `http://127.0.0.1:${port}/` : dashboardUrl(overrides.url));
    if (url.pathname !== '/' || url.search || url.hash) throw new Error('Cockpit requires a dashboard origin without a path, query or fragment');
    return {
        user,
        endpoint: { address: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)), ...(url.protocol === 'https:' ? { tls: { validate: true } } : {}) }
    };
}

async function cockpitFiles(root, config) {
    const source = path.join(root, 'cockpit/pm2monitor');
    let html = await fs.readFile(path.join(root, 'public/index.html'), 'utf8');
    // Keep the web UI as the single source; Cockpit serves all assets locally.
    html = html.replace(/    <link[^>]+https:\/\/[^>]+>\n/g, '')
        .replace('<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>', '<script src="chart.umd.js"></script>')
        .replace(/<i\b[^>]*><\/i>/g, '')
        .replace('<link rel="stylesheet" href="style.css">', '<link rel="stylesheet" href="style.css">\n    <link rel="stylesheet" href="cockpit.css">')
        .replace('<script src="/app.js" defer></script>', '<script src="../base1/cockpit.js"></script>\n    <script src="config.js"></script>\n    <script src="transport.js"></script>\n    <script src="app.js" defer></script>')
        .replace('<div id="app-list"></div>', '<div id="app-list" aria-live="polite">Connecting to dashboard…</div>');
    const files = new Map([
        ['index.html', html],
        ['config.js', `'use strict';\nwindow.pm2MonitorCockpit = ${JSON.stringify(config)};\n`],
        ['app.js', await fs.readFile(path.join(root, 'public/app.js'))],
        ['style.css', await fs.readFile(path.join(root, 'public/style.css'))]
    ]);
    for (const name of ['manifest.json', 'cockpit.css', 'transport.js']) files.set(name, await fs.readFile(path.join(source, name)));
    files.set('chart.umd.js', await fs.readFile(path.join(source, 'vendor/chart.umd.js')));
    files.set('Chart-LICENSE.md', await fs.readFile(path.join(source, 'vendor/Chart-LICENSE.md')));
    return files;
}
module.exports = { cockpitConfig, cockpitFiles };
