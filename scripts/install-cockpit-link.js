'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function main() {
    const args = process.argv.slice(2);
    let port = 8877, url = null, dryRun = false;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--help') {
            console.log('Usage: npm run cockpit:install -- [--port 8877] [--url https://dashboard.example.com/] [--dry-run]');
            console.log('Installs a static dashboard link only for the Linux user running this command. No sudo or service restart.');
            return;
        }
        if (args[i] === '--dry-run') { dryRun = true; continue; }
        if (args[i] === '--port') {
            const value = args[++i];
            if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('Port must be between 1 and 65535');
            port = Number(value); continue;
        }
        if (args[i] === '--url') {
            try {
                const parsed = new URL(args[++i]);
                if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
                url = parsed.href;
            } catch { throw new Error('Use an HTTP(S) dashboard URL without embedded credentials'); }
            continue;
        }
        throw new Error(`Unknown argument: ${args[i]}`);
    }
    const identity = os.userInfo();
    if (identity.uid === 0) throw new Error('Run this installer as the intended Cockpit login user, without sudo');
    const dataHome = process.env.XDG_DATA_HOME || path.join(identity.homedir, '.local/share');
    if (!path.isAbsolute(dataHome)) throw new Error('XDG_DATA_HOME must be an absolute path');
    const destination = path.join(dataHome, 'cockpit/pm2monitor');
    const source = path.resolve(__dirname, '../cockpit/pm2monitor');
    const files = ['manifest.json', 'index.html', 'style.css', 'link.js', 'config.js'];
    console.log(`User: ${identity.username}`);
    console.log(`Install: ${destination}`);
    console.log(`Dashboard: ${url || `http://<Cockpit hostname>:${port}/`}`);
    console.log(`Create/update: ${files.join(', ')}`);
    if (dryRun) { console.log('Dry run: no files written.'); return; }
    const existing = await fs.lstat(destination).catch(err => { if (err.code !== 'ENOENT') throw err; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) throw new Error('Install destination must be a regular directory');
    for (const name of files) {
        const stat = await fs.lstat(path.join(destination, name)).catch(err => { if (err.code !== 'ENOENT') throw err; });
        if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error(`Refusing to replace non-regular file: ${name}`);
    }
    // Copy only the five static plugin files, never .env or target credentials.
    await fs.mkdir(destination, { recursive: true, mode: 0o755 });
    for (const name of files) {
        const content = name === 'config.js'
            ? `'use strict';\nwindow.pm2MonitorLink = ${JSON.stringify({ port, url })};\n`
            : await fs.readFile(path.join(source, name));
        await fs.writeFile(path.join(destination, name), content, { mode: 0o644 });
    }
    console.log('Installed. Log out/in to Cockpit or refresh to load the PM2 Monitor menu item.');
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
