'use strict';
const session = require('express-session');

// Keep the original in-memory session model, but reap sessions even when their
// browser never returns. MemoryStore.all() removes expired sessions internally.
class SessionStore extends session.MemoryStore {
    constructor() {
        super();
        this.sweep = setInterval(() => this.prune(), 60000);
        this.sweep.unref();
    }
    prune() { this.all(); }
    close() { clearInterval(this.sweep); this.clear(); }
}
module.exports = { SessionStore };
