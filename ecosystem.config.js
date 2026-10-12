'use strict';

module.exports = {
    apps: [{
        name: 'pm2-dashboard',
        script: './server.js',
        cwd: __dirname,
        // Resolve Node from the PM2 command's active NVM runtime, not a user path.
        interpreter: process.execPath,
        exec_mode: 'fork',
        instances: 1,
        watch: false,
        // CPU/RAM monitoring still works; disable unused PM2.io instrumentation.
        automation: false,
        pmx: false,
        vizion: false,
        autorestart: true,
        restart_delay: 2000,
        kill_timeout: 6000,
        env: { NODE_ENV: 'production' }
        // PORT, mode, credentials and targets stay in this checkout's .env.
    }]
};
