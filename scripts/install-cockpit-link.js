'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { dashboardPort, dashboardUrl } = require('../lib/cockpit-links');
const { cockpitConfig, cockpitFiles } = require('../lib/cockpit-package');

async function main() {
    const args = process.argv.slice(2);
    const overrides = {};
    let dryRun = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--help') {
            console.log('Usage: npm run cockpit:install -- [--port 8877] [--url https://dashboard.example.com/] [--dry-run]');
            console.log('Installs the embedded dashboard for the Linux user running this command. No sudo or service restart.');
            console.log('Connects through Cockpit to the local backend (PORT from .env). Multi-user targets stay in the backend. --url is a server-side HTTP(S) origin.');
            return;
        }
        if (args[i] === '--dry-run') { dryRun = true; continue; }
        if (args[i] === '--port') {
            const value = args[++i];
            overrides.port = dashboardPort(value); continue;
        }
        if (args[i] === '--url') {
            overrides.url = dashboardUrl(args[++i]);
            continue;
        }
        throw new Error(`Unknown argument: ${args[i]}`);
    }
    const identity = os.userInfo();
    if (identity.uid === 0) throw new Error('Run this installer as the intended Cockpit login user, without sudo');
    const dataHome = process.env.XDG_DATA_HOME || path.join(identity.homedir, '.local/share');
    if (!path.isAbsolute(dataHome)) throw new Error('XDG_DATA_HOME must be an absolute path');
    const destination = path.join(dataHome, 'cockpit/pm2monitor');
    const root = path.resolve(__dirname, '..');
    const config = await cockpitConfig(root, identity.username, overrides);
    const contents = await cockpitFiles(root, config);
    const files = [...contents.keys()];
    console.log(`User: ${identity.username}`);
    console.log(`Install: ${destination}`);
    console.log(`Backend: ${config.endpoint.tls ? 'https' : 'http'}://${config.endpoint.address}:${config.endpoint.port} (accessed from server)`);
    console.log(`Create/update: ${files.join(', ')}`);
    if (dryRun) { console.log('Dry run: no files written.'); return; }
    const existing = await fs.lstat(destination).catch(err => { if (err.code !== 'ENOENT') throw err; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Install destination must be a regular directory');
    for (const name of files) {
        const stat = await fs.lstat(path.join(destination, name)).catch(err => { if (err.code !== 'ENOENT') throw err; });
        if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`Refusing to replace non-regular file: ${name}`);
    }
    // Install public assets only; no .env, passwords or target credentials.
    await fs.mkdir(destination, { recursive: true, mode: 0o755 });
    for (const [name, content] of contents) {
        await fs.writeFile(path.join(destination, name), content, { mode: 0o644 });
    }
    console.log('Installed. Log out/in to Cockpit or refresh to load the PM2 Monitor menu item.');
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
