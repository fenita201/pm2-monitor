'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { createApp } = require('../server');
async function main() {
    const runtime = await createApp();
    try {
        console.log(`Mode: ${runtime.config.mode}; current Linux user: ${runtime.config.user}`);
        const status = await runtime.manager.status();
        for (const target of status.targets) {
            console.log(`${target.user}: ${target.error || `${target.processCount} PM2 process(es)`}`);
        }
        if (status.targets.some(t => t.error)) process.exitCode = 1;
    } finally { runtime.close(); }
}
main().catch(err => { console.error(`Configuration error: ${err.message}`); process.exitCode = 1; });
