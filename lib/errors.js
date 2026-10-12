'use strict';
class AppError extends Error {
    constructor(message, status = 503) { super(message); this.status = status; }
}
function processId(value) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new AppError('Process ID must be a non-negative integer', 400);
    }
    return Number(value);
}
function validateAction(action) {
    if (!['start', 'stop', 'restart', 'delete', 'rename'].includes(action)) throw new AppError('Unsupported action', 400);
}
module.exports = { AppError, processId, validateAction };
