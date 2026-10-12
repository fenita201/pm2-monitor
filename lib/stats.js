'use strict';
const os = require('node:os');
const checkDiskSpace = require('check-disk-space').default;

function cpuTimes(cpus) {
    let idle = 0, total = 0;
    for (const { times } of cpus) {
        idle += times.idle;
        total += times.user + times.nice + times.sys + times.idle + times.irq;
    }
    return { idle, total, count: cpus.length };
}

function makeStats(system = os, diskSpace = checkDiskSpace, now = Date.now) {
    let previous = cpuTimes(system.cpus());
    let pending, until = 0, cpuUsage = 0;
    return () => {
        if (pending && now() < until) return pending;
        until = Infinity;
        pending = Promise.resolve().then(() => diskSpace('/')).then(disk => {
            const current = cpuTimes(system.cpus());
            const elapsed = current.total - previous.total;
            const idle = current.idle - previous.idle;
            if (elapsed > 0 && idle >= 0 && current.count === previous.count) {
                cpuUsage = Math.max(0, Math.min(100, (1 - idle / elapsed) * 100));
            } else if (current.count !== previous.count) cpuUsage = 0;
            previous = current;
            const load = system.loadavg()[0];
            return {
                load: Number(load.toFixed(2)), cpuUsage,
                // Retain this field for clients using the previous API.
                loadPercent: Math.min(100, load / Math.max(1, current.count) * 100),
                totalMem: system.totalmem() / 1073741824, freeMem: system.freemem() / 1073741824,
                uptime: system.uptime(), disk: {
                    percent: (disk.size - disk.free) / disk.size * 100,
                    used: (disk.size - disk.free) / 1073741824, total: disk.size / 1073741824
                }
            };
        }).finally(() => { until = now() + 1500; });
        return pending;
    };
}
module.exports = { makeStats };
