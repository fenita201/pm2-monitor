'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { promisify } = require('node:util');
const { makeStats } = require('../lib/stats');
const { SessionStore } = require('../lib/session-store');
const { CachedTarget } = require('../lib/manager');

test('CPU usage comes from idle/busy deltas across cores; coalesced stats reuse the same sample', async () => {
    let ticks = 0, calls = 0, clock = 0, diskCalls = 0;
    const samples = [{ user: 100, idle: 900 }, { user: 130, idle: 970 }, { user: 190, idle: 1010 }];
    const system = {
        cpus: () => { calls++; return Array.from({ length: 2 }, () => ({ times: { ...samples[ticks], nice: 0, sys: 0, irq: 0 } })); },
        loadavg: () => [8, 0, 0], totalmem: () => 8 * 1073741824, freemem: () => 6 * 1073741824, uptime: () => 100
    };
    const stats = makeStats(system, async () => { diskCalls++; return { size: 100, free: 60 }; }, () => clock);
    ticks = 1;
    const first = await Promise.all(Array.from({ length: 10 }, () => stats()));
    assert.ok(Math.abs(first[0].cpuUsage - 30) < .0001);
    assert.equal(first[0].loadPercent, 100); // Usage is independent of load average.
    assert.equal(first[0].totalMem - first[0].freeMem, 2);
    assert.equal(calls, 2); assert.equal(diskCalls, 1);
    assert.ok(first.every(sample => sample === first[0]));
    clock = 1501; ticks = 2;
    assert.ok(Math.abs((await stats()).cpuUsage - 60) < .0001);
});
test('CPU sampling handles zero elapsed time and missing cores without NaN', async () => {
    const system = { cpus: () => [], loadavg: () => [0], totalmem: () => 1024, freemem: () => 512, uptime: () => 0 };
    const stats = makeStats(system, async () => ({ size: 100, free: 100 }));
    assert.equal((await stats()).cpuUsage, 0); assert.equal((await stats()).loadPercent, 0);
});
test('sessions abandoned by clients are reclaimed while unexpired admin sessions remain valid', async () => {
    const store = new SessionStore();
    try {
        const set = promisify(store.set.bind(store)), get = promisify(store.get.bind(store));
        await set('expired', { cookie: { expires: new Date(Date.now() - 1000) }, isLoggedIn: true });
        await set('active', { cookie: { expires: new Date(Date.now() + 60000) }, isLoggedIn: true });
        store.prune();
        assert.equal(Object.keys(store.sessions).length, 1);
        assert.equal((await get('active')).isLoggedIn, true); assert.equal(await get('expired'), undefined);
        assert.equal(store.sweep.hasRef(), false);
    } finally { store.close(); }
    assert.equal(Object.keys(store.sessions).length, 0);
});
test('expired log caches release retained payloads; pending requests stay coalesced during pruning', async () => {
    let release, requests = 0;
    const cache = new CachedTarget({ logs: async () => ({ out: 'x'.repeat(65536), error: '' }), list: () => { requests++; return new Promise(resolve => { release = resolve; }); }, close() {} });
    await cache.logs(0); cache.cache.get('logs:0').until = Date.now() - 1;
    const pending = cache.list(); await new Promise(resolve => setImmediate(resolve));
    cache.prune(); assert.equal(cache.cache.has('logs:0'), false);
    const shared = cache.list(); assert.equal(requests, 1);
    release([]); await Promise.all([pending, shared]); cache.close();
});
