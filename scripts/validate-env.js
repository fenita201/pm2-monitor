'use strict';
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { loadConfig } = require('../lib/config');
const { TargetStore } = require('../lib/targets');
async function main() {
    const config = loadConfig();
    if (process.argv[2] === '--pm2-home') {
        // PM2 stop/remove must still work even if the targets file needs repair.
        process.stdout.write(config.pm2Home);
        return;
    }
    await new TargetStore(config).load();
    console.log(`Cấu hình hợp lệ: user=${config.user}, mode=${config.mode}, port=${config.port}`);
}
main().catch(err => { console.error(`Cấu hình lỗi: ${err.message}`); process.exitCode = 1; });
