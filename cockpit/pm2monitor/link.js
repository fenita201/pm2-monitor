'use strict';
try {
    const config = window.pm2MonitorLink;
    const url = new URL(config.url || window.location.href);
    if (!config.url) {
        // The browser uses the Cockpit server's hostname, never a fixed localhost.
        url.protocol = 'http:';
        url.port = String(config.port);
        url.pathname = '/'; url.search = ''; url.hash = '';
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    document.getElementById('dashboardLink').href = url.href;
    document.getElementById('dashboardAddress').textContent = url.href;
} catch {
    document.getElementById('dashboardAddress').textContent = 'Invalid dashboard URL. Reinstall this link with the correct port or URL.';
    document.getElementById('dashboardLink').hidden = true;
}
