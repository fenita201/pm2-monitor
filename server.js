require('dotenv').config();
const express = require('express');
const pm2 = require('pm2');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const os = require('os');
const checkDiskSpace = require('check-disk-space').default;

const app = express();
const PORT = process.env.PORT || 8877;
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 }
}));

// Middleware Security
const isAdmin = (req) => req.session.isLoggedIn || false;
const checkAdmin = (req, res, next) => {
    if (isAdmin(req)) return next();
    res.status(401).json({ success: false, message: "Unauthorized" });
};

// Auth Routes
app.post('/auth/login', (req, res) => {
    if (req.body.password === ADMIN_PASS) {
        req.session.isLoggedIn = true;
        return res.json({ success: true });
    }
    res.status(401).json({ success: false });
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// API Status (Public Access)
app.get('/api/status', async (req, res) => {
    try {
        const disk = await checkDiskSpace('/');
        pm2.connect((err) => {
            if (err) return res.status(500).send(err);
            pm2.list((err, list) => {
                pm2.disconnect();
                const processes = list.map(p => ({
                    id: p.pm_id,
                    name: p.name,
                    status: p.pm2_env.status,
                    memory: (p.monit.memory / 1024 / 1024).toFixed(2),
                    cpu: p.monit.cpu,
                    uptime: p.pm2_env.pm_uptime
                }));

                res.json({
                    processes,
                    isAdmin: isAdmin(req),
                    serverStats: {
                        load: os.loadavg()[0].toFixed(2),
                        totalMem: (os.totalmem() / 1024 / 1024 / 1024).toFixed(1),
                        freeMem: (os.freemem() / 1024 / 1024 / 1024).toFixed(1),
                        uptime: os.uptime(),
                        disk: {
                            percent: (((disk.size - disk.free) / disk.size) * 100).toFixed(1),
                            used: ((disk.size - disk.free) / 1024 / 1024 / 1024).toFixed(1),
                            total: (disk.size / 1024 / 1024 / 1024).toFixed(1)
                        }
                    }
                });
            });
        });
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/logs/:id', (req, res) => {
    pm2.connect(() => {
        pm2.describe(req.params.id, (err, desc) => {
            pm2.disconnect();
            if (err || !desc.length) return res.status(500).send("Not found");
            const logPath = desc[0].pm2_env.pm_out_log_path;
            const logContent = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split('\n').slice(-50).join('\n') : "No logs.";
            res.json({ out: logContent });
        });
    });
});

// Admin Controls
app.post('/api/:action/:id', checkAdmin, (req, res) => {
    const { action, id } = req.params;
    pm2.connect(() => {
        const cb = () => { pm2.disconnect(); res.json({success:true}); };
        if (action === 'stop') pm2.stop(id, cb);
        else if (action === 'restart') pm2.restart(id, cb);
        else if (action === 'delete') pm2.delete(id, cb);
    });
});

app.post('/api/rename/:id', checkAdmin, (req, res) => {
    pm2.connect(() => {
        pm2.restart(req.params.id, { name: req.body.newName }, () => {
            pm2.disconnect(); res.json({ success: true });
        });
    });
});

app.listen(PORT, () => console.log(`🚀 Server Status running on port ${PORT}`));
