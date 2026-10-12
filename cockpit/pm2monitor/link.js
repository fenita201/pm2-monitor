'use strict';
try {
    const links = window.pm2MonitorLink.links;
    if (!Array.isArray(links) || !links.length) throw new Error();
    const cards = links.map((link, index) => {
        const url = new URL(link.url || window.location.href);
        if (!link.url) {
            url.protocol = 'http:'; url.port = String(link.port);
            url.pathname = '/'; url.search = ''; url.hash = '';
        }
        // Local target URLs refer to the server, not the browser's localhost.
        if (!link.url || link.useCockpitHost) url.hostname = window.location.hostname;
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        const card = document.createElement('section'); card.className = 'dashboard-card';
        const title = document.createElement('h2'); title.textContent = `${link.user}${index === 0 ? ' (current user)' : ''}`;
        const address = document.createElement('p'); address.textContent = url.href;
        const anchor = document.createElement('a'); anchor.textContent = 'Open PM2 Monitor';
        anchor.href = url.href; anchor.target = '_blank'; anchor.rel = 'noopener noreferrer';
        card.append(title, address, anchor); return card;
    });
    document.getElementById('dashboardLinks').replaceChildren(...cards);
} catch {
    document.getElementById('dashboardLinks').textContent = 'Invalid dashboard configuration. Reinstall the Cockpit links.';
}
