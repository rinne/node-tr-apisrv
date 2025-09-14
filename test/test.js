'use strict';

const assert = require('assert');
const ApiSrv = require('../index');

const timeout = 2500;

const srv = new ApiSrv({
    port: 8000,
    address: '127.0.0.1',
    bodyReadTimeoutMs: timeout,
    callback: function () {}
});

srv.server.on('listening', function () {
    try {
        assert.strictEqual(srv.server.headersTimeout, timeout);
        assert.strictEqual(srv.server.requestTimeout, timeout + 1);
    } finally {
        srv.server.close();
    }
});

