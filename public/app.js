'use strict';
const $ = id => document.getElementById(id);
let state = { isAdmin: false, mode: 'single-user', processes: [], targets: [] };
let active = null, logTimer = null, logGeneration = 0, detChart = null, polling = null;
let editingUser = null, targetSaving = false;
const histories = new Map(), serverHistory = { cpu: [], mem: [] }, miniCharts = {};
const key = p => JSON.stringify([p.targetUser, p.id]);
function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
}
function button(text, className, action, disabled = false) {
    const node = element('button', text, `btn ${className}`);
    node.type = 'button'; node.disabled = disabled; node.addEventListener('click', action); return node;
}
function notice(id, text) { $(id).textContent = text; $(id).hidden = !text; }
async function request(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Request failed');
    return data;
}
function processUrl(p) { return `/api/processes/${encodeURIComponent(p.targetUser)}/${p.id}`; }
function push(history, value, max) { history.push(value); if (history.length > max) history.shift(); }
function initCharts() {
    if (typeof Chart === 'undefined') return;
    const options = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false } }, scales: { x: { display: false }, y: { display: false, beginAtZero: true } }, elements: { line: { tension: 0.4 }, point: { radius: 0 } } };
    for (const [metric, color] of [['cpu', '#ff7675'], ['mem', '#00b894']]) {
        miniCharts[metric] = new Chart($(`${metric}MiniChart`), { type: 'line', data: { labels: Array(10).fill(''), datasets: [{ data: [], borderColor: color, borderWidth: 2 }] }, options });
    }
}
function renderStats(stats) {
    const memory = (stats.totalMem - stats.freeMem) / stats.totalMem * 100;
    const cpu = Number(stats.loadPercent || 0);
    $('currentDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    for (const [metric, value] of [['cpu', cpu], ['mem', memory]]) {
        $(`${metric}Val`).textContent = `${value.toFixed(1)}%`;
        $(`${metric}Bar`).style.width = `${Math.min(100, Math.max(0, value))}%`;
        push(serverHistory[metric], value, 10);
        if (miniCharts[metric]) { miniCharts[metric].data.datasets[0].data = serverHistory[metric]; miniCharts[metric].update(); }
    }
    $('cpuVal').title = `1-minute load average: ${stats.load}`;
    $('diskVal').textContent = `${Number(stats.disk.percent).toFixed(1)}%`;
    $('diskBar').style.width = `${Number(stats.disk.percent)}%`;
    $('diskDetail').textContent = `${Number(stats.disk.used).toFixed(1)} / ${Number(stats.disk.total).toFixed(1)} GB`;
}
function renderAuth() {
    $('authArea').replaceChildren(state.isAdmin
        ? button('Logout', 'btn-stop', async () => { try { await fetch('/auth/logout'); closeInfo(); closeTargets(); await fetchData(); } catch (err) { notice('pageError', err.message); } })
        : button('Login', 'btn-restart', () => { $('loginModal').style.display = 'flex'; $('adminPass').focus(); }));
    $('toolbar').hidden = state.mode !== 'multi-user';
    $('manageTargets').hidden = !state.isAdmin;
    if (!state.isAdmin) closeTargets();
}
function renderFilters() {
    const selected = $('userFilter').value;
    $('userFilter').replaceChildren(new Option('All users', ''), ...state.targets.map(t => new Option(t.user, t.user)));
    $('userFilter').value = state.targets.some(t => t.user === selected) ? selected : '';
}
function renderList() {
    const user = $('userFilter').value;
    const states = state.targets.filter(t => !user || t.user === user);
    $('targetStatus').replaceChildren(...states.filter(t => t.error || t.processCount === 0).map(t =>
        element('div', `${t.user}: ${t.error || 'No PM2 processes'}`, `notice${t.error ? ' error' : ''}`)));
    const apps = state.processes.filter(p => !user || p.targetUser === user);
    $('app-list').replaceChildren(...apps.map(p => {
        const card = element('div', undefined, 'app-card');
        card.dataset.user = p.targetUser; card.dataset.id = p.id;
        const header = element('div', undefined, 'card-header');
        const title = element('div'); title.append(element('strong', p.name));
        if (state.mode === 'multi-user') title.append(element('div', p.targetUser, 'user-label'));
        const badge = element('span', p.status, 'online-badge');
        badge.style.background = p.status === 'online' ? '#e8f5e9' : '#ffebee';
        badge.style.color = p.status === 'online' ? '#2e7d32' : '#c62828';
        header.append(title, badge);
        const stats = element('div', undefined, 'app-stats-bar');
        stats.append(element('span', `${Number(p.memory).toFixed(2)} MB`), element('span', `CPU ${p.cpu}%`));
        const actions = element('div', undefined, 'btn-group');
        if (state.isAdmin) {
            if (p.status === 'online') {
                actions.append(button(p.protected ? 'Protected' : 'Stop', p.protected ? 'btn-disabled' : 'btn-stop', () => doAction('stop', p), p.protected));
                actions.append(button('Restart', 'btn-restart', () => doAction('restart', p)));
            } else if (['stopped', 'errored'].includes(p.status)) {
                actions.append(button('Start', 'btn-start', () => doAction('start', p)));
            } else actions.append(button(p.status, 'btn-disabled', () => {}, true));
        }
        actions.append(button('Info / Logs', 'btn-info', () => openInfo(p)));
        card.append(header, stats, actions); return card;
    }));
}
async function fetchData() {
    if (polling) return polling;
    polling = (async () => {
        try {
            state = await request('/api/status'); notice('pageError', '');
            renderAuth(); renderStats(state.serverStats); renderFilters();
            const present = new Set();
            state.processes.forEach(p => {
                const id = key(p); present.add(id);
                if (!histories.has(id)) histories.set(id, { r: [], c: [] });
                push(histories.get(id).r, Number(p.memory), 20); push(histories.get(id).c, Number(p.cpu), 20);
            });
            for (const id of histories.keys()) if (!present.has(id)) histories.delete(id);
            renderList();
            if (active) {
                const updated = state.processes.find(p => key(p) === key(active));
                if (updated) { active = updated; renderModalActions(); updateDetailChart(); }
                else closeInfo();
            }
        } catch (err) { notice('pageError', err.message); }
    })().finally(() => { polling = null; });
    return polling;
}
async function poll() { await fetchData(); setTimeout(poll, 2000); }
async function submitLogin() {
    try {
        await request('/auth/login', { method: 'POST', body: JSON.stringify({ password: $('adminPass').value }) });
        $('adminPass').value = ''; $('loginModal').style.display = 'none'; await fetchData();
    } catch (err) { alert(err.message); }
}
function renderModalActions() {
    $('detTitle').textContent = state.mode === 'multi-user' ? `${active.targetUser} / ${active.name}` : active.name;
    const buttons = [];
    if (state.isAdmin && !active.protected) {
        buttons.push(button('Rename', 'btn-restart', async () => {
            const p = active, newName = prompt('New process name', p.name);
            if (newName?.trim()) await doAction('rename', p, { newName });
        }));
        buttons.push(button('Remove', 'btn-stop', async () => {
            const p = active;
            if (confirm(`Remove ${p.targetUser} / ${p.name} from PM2?`)) await doAction('delete', p);
        }));
    }
    buttons.push(button('Close', 'btn-restart', closeInfo));
    $('modalActionArea').replaceChildren(...buttons);
}
function openInfo(p) {
    closeInfo(); active = p; $('infoModal').style.display = 'flex'; $('detLogOut').textContent = 'Loading…';
    renderModalActions();
    if (typeof Chart !== 'undefined') {
        detChart = new Chart($('detChart'), { type: 'line', data: { labels: Array(20).fill(''), datasets: [
            { label: 'RAM (MB)', data: [], borderColor: '#4776E6', tension: .4, pointRadius: 0 },
            { label: 'CPU (%)', data: [], borderColor: '#ff7675', tension: .4, pointRadius: 0 }
        ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { x: { display: false }, y: { beginAtZero: true } } } });
    }
    updateDetailChart(); fetchLogs(p, logGeneration);
}
function updateDetailChart() {
    if (!active || !detChart || !histories.has(key(active))) return;
    detChart.data.datasets[0].data = histories.get(key(active)).r;
    detChart.data.datasets[1].data = histories.get(key(active)).c; detChart.update();
}
async function fetchLogs(p, generation) {
    try {
        const data = await request(`${processUrl(p)}/logs`);
        if (generation !== logGeneration) return;
        const text = [data.out, data.error ? `\nSTDERR:\n${data.error}` : ''].join('');
        $('detLogOut').textContent = text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
        $('detLogOut').scrollTop = $('detLogOut').scrollHeight;
    } catch (err) { if (generation === logGeneration) $('detLogOut').textContent = err.message; }
    if (generation === logGeneration && active) logTimer = setTimeout(() => fetchLogs(p, generation), 3000);
}
function closeInfo() {
    logGeneration++; clearTimeout(logTimer); active = null; $('infoModal').style.display = 'none';
    if (detChart) { detChart.destroy(); detChart = null; }
}
async function doAction(action, p, body = {}) {
    try { await request(`${processUrl(p)}/${action}`, { method: 'POST', body: JSON.stringify(body) }); await fetchData(); }
    catch (err) { notice('pageError', err.message); }
}
function resetTarget() {
    editingUser = null; $('targetUser').value = ''; $('targetHost').value = 'http://127.0.0.1';
    $('targetPort').value = '8888'; $('targetPassword').value = '';
    $('targetPassword').placeholder = 'Optional for read-only access'; $('saveTarget').textContent = 'Check & add';
    $('targetMessage').textContent = '';
}
async function loadTargets() {
    const data = await request('/api/targets');
    $('targetsList').replaceChildren(...data.targets.map(t => {
        const row = element('div', undefined, 'target-row');
        row.append(element('strong', t.user), element('div', `${t.baseUrl} · ${t.hasPassword ? 'Controls enabled' : 'Read only'}`, 'user-label'));
        const buttons = element('div', undefined, 'btn-group');
        buttons.append(button('Edit', 'btn-restart', () => {
            if (targetSaving) return;
            editingUser = t.user; const url = new URL(t.baseUrl);
            $('targetUser').value = t.user; $('targetHost').value = `${url.protocol}//${url.hostname}`;
            $('targetPort').value = url.port || (url.protocol === 'https:' ? '443' : '80');
            $('targetPassword').value = ''; $('targetPassword').placeholder = 'Leave blank to keep existing password';
            $('saveTarget').textContent = 'Check & save'; $('targetMessage').textContent = '';
        }));
        buttons.append(button('Remove target', 'btn-stop', async () => {
            if (targetSaving || !confirm(`Remove target ${t.user}? Its PM2 processes will keep running.`)) return;
            targetSaving = true;
            try { await request(`/api/targets/${encodeURIComponent(t.user)}`, { method: 'DELETE' }); resetTarget(); await loadTargets(); await fetchData(); }
            catch (err) { $('targetMessage').textContent = err.message; }
            finally { targetSaving = false; }
        }));
        row.append(buttons); return row;
    }));
}
async function openTargets() {
    resetTarget(); $('targetsModal').style.display = 'flex';
    try { await loadTargets(); } catch (err) { $('targetMessage').textContent = err.message; }
}
function closeTargets() { $('targetsModal').style.display = 'none'; $('targetPassword').value = ''; }
async function saveTarget(event) {
    event.preventDefault(); if (targetSaving) return;
    targetSaving = true; $('saveTarget').disabled = true; $('targetMessage').textContent = 'Checking connection and saving…';
    try {
        const url = new URL($('targetHost').value); url.port = $('targetPort').value;
        const target = { user: $('targetUser').value.trim(), baseUrl: url.href };
        if ($('targetPassword').value) target.password = $('targetPassword').value;
        await request(editingUser ? `/api/targets/${encodeURIComponent(editingUser)}` : '/api/targets', { method: editingUser ? 'PUT' : 'POST', body: JSON.stringify(target) });
        resetTarget(); $('targetMessage').textContent = 'Target saved.'; await loadTargets(); await fetchData();
    } catch (err) { $('targetMessage').textContent = err.message; }
    finally { targetSaving = false; $('saveTarget').disabled = false; }
}
$('submitLogin').addEventListener('click', submitLogin);
$('adminPass').addEventListener('keydown', event => { if (event.key === 'Enter') submitLogin(); });
$('closeLogin').addEventListener('click', () => { $('loginModal').style.display = 'none'; $('adminPass').value = ''; });
$('infoModal').addEventListener('click', event => { if (event.target === $('infoModal')) closeInfo(); });
$('userFilter').addEventListener('change', () => { closeInfo(); renderList(); });
$('manageTargets').addEventListener('click', openTargets);
$('closeTargets').addEventListener('click', closeTargets);
$('resetTarget').addEventListener('click', () => { if (!targetSaving) resetTarget(); });
$('targetForm').addEventListener('submit', saveTarget);
initCharts(); poll();
