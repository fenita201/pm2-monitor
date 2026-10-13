'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
function quote(value) {
    for (const candidate of [`'${value}'`, `"${value}"`, '`' + value + '`', JSON.stringify(value)]) {
        if (dotenv.parse(`VALUE=${candidate}`).VALUE === value) return candidate;
    }
    throw new Error('Giá trị chứa tổ hợp dấu nháy không thể lưu chính xác trong .env; hãy chọn giá trị khác.');
}
async function main() {
    const env = process.env;
    const values = { PORT: env.SETUP_PORT, HOST: env.SETUP_HOST, PM2_MONITOR_MODE: env.SETUP_MODE,
        ADMIN_PASSWORD: env.SETUP_PASSWORD, SESSION_SECRET: env.SETUP_SECRET, PM2_MONITOR_TARGETS_FILE: env.SETUP_TARGETS };
    if (Object.values(values).some(value => value === undefined)) throw new Error('Hãy tạo cấu hình qua setup.sh.');
    const content = '# Created by setup.sh; do not commit this file.\n' + Object.entries(values).map(([name, value]) => `${name}=${quote(value)}`).join('\n') + '\n';
    const destination = path.join(root, '.env');
    const previous = await fs.lstat(destination).catch(err => { if (err.code !== 'ENOENT') throw err; });
    if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error('.env phải là file thường, không phải symlink.');
    const temporary = path.join(root, `.env.setup-${crypto.randomBytes(8).toString('hex')}.tmp`);
    try {
        await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
        await fs.rename(temporary, destination);
    } finally { await fs.rm(temporary, { force: true }); }
    console.log('Đã tạo .env với quyền 0600.');
}
main().catch(err => { console.error(`Không tạo được .env: ${err.message}`); process.exitCode = 1; });
