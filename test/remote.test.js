'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RemoteDashboard } = require('../lib/remote');

test('remote timeout and shutdown abort pending HTTP requests', async () => {
    const fakeFetch = (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    const remote = new RemoteDashboard({ user: 'worker', baseUrl: 'http://localhost:8888' }, null, { fetch: fakeFetch, timeout: 20 });
    await assert.rejects(remote.identity(), /timed out/);
    const pending = remote.identity(); remote.close(); await assert.rejects(pending, /timed out/);
    assert.equal(remote.controllers.size, 0);
    await assert.rejects(remote.list(), /removed/);
});
test('HTTP errors and oversized responses do not leak target details or secrets', async () => {
    const remote = new RemoteDashboard({ user: 'worker', baseUrl: 'http://localhost' }, 'private', { fetch: async () => new Response('x'.repeat(1024 * 1024 + 1)) });
    await assert.rejects(remote.identity(), /exceeds/);
    remote.fetch = async () => new Response('old server html');
    await assert.rejects(remote.identity(), /updated/);
    remote.close();
});
