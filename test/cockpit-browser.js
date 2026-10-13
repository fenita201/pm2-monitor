'use strict';
// Browser validation of a Cockpit-shaped iframe and HTTP API stub, not a real Cockpit installation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const { cockpitFiles } = require('../lib/cockpit-package');
const { start, fakeLocal, root } = require('./helpers');
const { chromium } = process.env.PLAYWRIGHT_MODULE ? require(process.env.PLAYWRIGHT_MODULE) : require('playwright');

const cockpitStub = `
window.cockpit = {
    hidden: false, addEventListener: function () {},
    http: function (endpoint) {
        return {
            request: function (options) {
                var callback, controller = new AbortController();
                var operation = fetch('/test-bridge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: endpoint, options: options }), signal: controller.signal })
                    .then(function (response) { return response.json(); }).then(function (result) {
                        if (result.problem) throw new Error(result.problem);
                        callback(result.status, result.headers); return result;
                    });
                return {
                    response: function (fn) { callback = fn; },
                    then: function (resolve, reject) { operation.then(function (r) { if (r.status < 300) resolve(r.body); else reject({ status: r.status }, r.body); }, reject); },
                    close: function () { controller.abort(); }
                };
            }, close: function () {}
        };
    }
};`;

async function main() {
    const cleanup = [], context = { after: fn => cleanup.push(fn) };
    let browser;
    try {
        const single = await start(context, { local: fakeLocal('deploy', [{ id: 0, name: 'Single app', status: 'stopped' }]) });
        const remote = await start(context, { user: 'worker', uid: 2000 });
        const multi = await start(context, { mode: 'multi-user', targets: [{ user: 'worker', baseUrl: remote.url, password: 'test-admin' }] });
        let backend = single.url;
        const files = await cockpitFiles(root, { user: 'deploy', endpoint: { port: Number(new URL(single.url).port), address: '127.0.0.1' } });
        const policy = JSON.parse(String(files.get('manifest.json')))['content-security-policy'];
        const harness = express(); harness.use(express.json());
        harness.get('/', (req, res) => res.send('<html><body style="margin:0;display:flex"><aside style="width:160px">Cockpit test shell</aside><iframe title="PM2 Monitor" style="border:0;width:calc(100vw - 160px);height:100vh" src="/cockpit/pm2monitor/index.html"></iframe></body></html>'));
        harness.get('/cockpit/base1/cockpit.js', (req, res) => res.type('js').send(cockpitStub));
        harness.get('/cockpit/pm2monitor/:file', (req, res) => {
            if (!files.has(req.params.file)) return res.sendStatus(404);
            if (req.params.file === 'index.html') res.set('Content-Security-Policy', policy);
            res.type(path.extname(req.params.file)).send(Buffer.from(files.get(req.params.file)));
        });
        harness.post('/test-bridge', async (req, res) => {
            const options = req.body.options;
            try {
                const response = await fetch(backend + options.path, { method: options.method, headers: options.headers,
                    ...(options.method !== 'GET' ? { body: options.body } : {}), redirect: 'manual', signal: AbortSignal.timeout(3000) });
                res.json({ status: response.status, headers: { ...Object.fromEntries(response.headers), 'Set-Cookie': response.headers.getSetCookie() }, body: await response.text() });
            } catch { res.json({ problem: 'unavailable' }); }
        });
        const server = await new Promise(resolve => { const s = harness.listen(0, '127.0.0.1', () => resolve(s)); });
        cleanup.push(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
        const url = `http://127.0.0.1:${server.address().port}`;
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
        const errors = [], external = [];
        page.on('pageerror', err => errors.push(err.message));
        page.on('request', req => { if (!req.url().startsWith(url)) external.push(req.url()); });
        await page.goto(url);
        let frame = page.frames().find(f => f.url().includes('pm2monitor/index.html'));
        await frame.locator('.app-card').waitFor();
        assert.equal(await frame.locator('#toolbar').isVisible(), false);
        assert.equal(await frame.getByRole('button', { name: 'Start', exact: true }).count(), 0);
        assert.equal(await frame.evaluate(() => Boolean(Chart.getChart(document.getElementById('cpuMiniChart')))), true);
        await frame.getByRole('button', { name: 'Info / Logs' }).click();
        await frame.waitForFunction(() => document.getElementById('detLogOut').textContent === 'deploy:0');
        await frame.getByRole('button', { name: 'Close', exact: true }).click();
        await frame.locator('#authArea button').click(); await frame.locator('#adminPass').fill('wrong');
        page.once('dialog', dialog => dialog.accept()); await frame.locator('#submitLogin').click();
        await frame.locator('#adminPass').fill('test-admin'); await frame.locator('#submitLogin').click();
        let operations = 0;
        for (const name of ['Start', 'Stop', 'Start', 'Restart']) {
            await frame.getByRole('button', { name, exact: true }).click();
            operations++;
            await frame.waitForFunction(async expected => {
                const result = await window.pm2MonitorTransport.request('/api/status');
                return result.processes[0].status === (expected === 2 ? 'stopped' : 'online');
            }, operations);
            // Restart leaves the same buttons visible: wait for the actual operation too.
            await new Promise((resolve, reject) => {
                const started = Date.now();
                const check = () => single.local.calls.length === operations ? resolve()
                    : Date.now() - started > 5000 ? reject(new Error('Process operation did not complete')) : setTimeout(check, 20);
                check();
            });
            await frame.getByRole('button', { name: name === 'Stop' ? 'Start' : 'Stop', exact: true }).waitFor();
        }
        assert.deepEqual(single.local.calls.map(c => c.action), ['start', 'stop', 'start', 'restart']);
        await frame.getByRole('button', { name: 'Logout', exact: true }).click();
        await frame.getByRole('button', { name: 'Login', exact: true }).waitFor();
        assert.equal(await frame.getByRole('button', { name: 'Stop', exact: true }).count(), 0);
        await fs.mkdir(path.join(root, 'test-artifacts'), { recursive: true });
        await page.screenshot({ path: path.join(root, 'test-artifacts/cockpit-single.png'), fullPage: true });

        backend = multi.url; await page.reload();
        frame = page.frames().find(f => f.url().includes('pm2monitor/index.html'));
        await frame.locator('.app-card[data-user="worker"]').waitFor();
        await frame.locator('#authArea button').click(); await frame.locator('#adminPass').fill('test-admin'); await frame.locator('#submitLogin').click();
        const card = frame.locator('.app-card[data-user="worker"]');
        await card.getByRole('button', { name: 'Start', exact: true }).click();
        await card.getByRole('button', { name: 'Stop', exact: true }).waitFor();
        assert.equal(remote.local.calls[0].action, 'start'); assert.equal(multi.local.calls.length, 0);
        await card.getByRole('button', { name: 'Info / Logs' }).click();
        await frame.waitForFunction(() => document.getElementById('detLogOut').textContent === 'worker:0');
        await frame.getByRole('button', { name: 'Close', exact: true }).click();
        await frame.locator('#userFilter').selectOption('worker'); assert.equal(await frame.locator('.app-card').count(), 1);
        await frame.locator('#userFilter').selectOption(''); assert.equal(await frame.locator('.app-card').count(), 2);
        await frame.locator('#manageTargets').click(); await frame.getByRole('button', { name: 'Edit', exact: true }).click();
        await frame.locator('#saveTarget').click();
        await frame.waitForFunction(() => document.getElementById('targetMessage').textContent === 'Target saved.');
        await frame.locator('#closeTargets').click();
        await page.screenshot({ path: path.join(root, 'test-artifacts/cockpit-multi.png'), fullPage: true });
        await page.setViewportSize({ width: 550, height: 844 });
        assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        await page.reload(); frame = page.frames().find(f => f.url().includes('pm2monitor/index.html'));
        await frame.locator('.app-card').first().waitFor();
        assert.equal(await frame.getByRole('button', { name: 'Login', exact: true }).count(), 1);
        backend = remote.url; await page.reload(); frame = page.frames().find(f => f.url().includes('pm2monitor/index.html'));
        await frame.waitForFunction(() => document.getElementById('pageError').textContent.includes('identity does not match'));
        backend = 'http://127.0.0.1:1'; await page.reload(); frame = page.frames().find(f => f.url().includes('pm2monitor/index.html'));
        await frame.waitForFunction(() => document.getElementById('pageError').textContent.includes('Check that it is running'));
        assert.deepEqual(errors, []); assert.deepEqual(external, []);
        console.log('PASS: Cockpit iframe with HTTP bridge stub, local assets/CSP/charts, public reads, admin session, wrong password, start/stop/restart, logout, multi-user routing/logs/filter/target edit, narrow layout, reload requires login, identity mismatch and unavailable backend');
    } finally {
        if (browser) await browser.close();
        for (const fn of cleanup.reverse()) await fn();
    }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
