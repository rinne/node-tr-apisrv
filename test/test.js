'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const ApiSrv = require('..');

function httpRequest(port, { method = 'GET', path = '/', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            port,
            hostname: '127.0.0.1',
            method,
            path,
            headers
        }, (res) => {
            let data = '';
            res.on('data', (d) => data += d);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

test('handles GET requests', async () => {
    const port = 12350;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ method: r.method, params: r.params })
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/?a=1' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { method: 'GET', params: { a: '1' } });
    } finally {
        await srv.shutdown();
    }
});

test('handles POST requests', async () => {
    const port = 12351;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ method: r.method, params: r.params })
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ a: 1 })
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { method: 'POST', params: { a: 1 } });
    } finally {
        await srv.shutdown();
    }
});

test('handles PUT requests', async () => {
    const port = 12352;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ method: r.method, params: r.params })
    });
    try {
        const res = await httpRequest(port, {
            method: 'PUT',
            path: '/',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'a=1'
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { method: 'PUT', params: { a: '1' } });
    } finally {
        await srv.shutdown();
    }
});

test('handles DELETE requests', async () => {
    const port = 12353;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ method: r.method, params: r.params })
    });
    try {
        const res = await httpRequest(port, { method: 'DELETE', path: '/?a=1' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { method: 'DELETE', params: { a: '1' } });
    } finally {
        await srv.shutdown();
    }
});

test('authentication callback controls access', async () => {
    const port = 12354;
    let handled = 0;
    let authCalls = 0;
    const srv = new ApiSrv({
        port,
        callback: (r) => {
            handled++;
            r.jsonResponse({ ok: true });
        },
        authCallback: (r) => {
            authCalls++;
            return r.url !== '/deny';
        }
    });
    try {
        const okRes = await httpRequest(port, { method: 'GET', path: '/allow' });
        assert.strictEqual(okRes.status, 200);
        assert.strictEqual(handled, 1);
        assert.strictEqual(authCalls, 1);

        const unauthorized = new Promise((resolve, reject) => {
            const req = http.request({ port, hostname: '127.0.0.1', method: 'GET', path: '/deny' });
            req.on('response', (res) => {
                res.resume();
                res.on('end', resolve);
            });
            req.on('error', reject);
            req.end();
            setTimeout(() => req.destroy(), 50);
        });
        await assert.rejects(unauthorized);
        assert.strictEqual(handled, 1);
        assert.strictEqual(authCalls, 2);
    } finally {
        await srv.shutdown();
    }
});

test('body read timeout returns 408', async () => {
    const port = 12355;
    const srv = new ApiSrv({
        port,
        bodyReadTimeoutMs: 50,
        callback: () => {}
    });
    try {
        const res = await new Promise((resolve, reject) => {
            const req = http.request({
                port,
                method: 'POST',
                path: '/',
                hostname: '127.0.0.1'
            }, (res) => {
                let data = '';
                res.on('data', (d) => data += d);
                res.on('end', () => resolve({ status: res.statusCode, data }));
            });
            req.on('error', reject);
            req.write('123'); // intentionally never calling end to trigger timeout
        });
        assert.strictEqual(res.status, 408);
        assert.strictEqual(res.data, 'Timeout occured while reading the request data.\n');
    } finally {
        await srv.shutdown();
    }
});

test('shutdown stops listening', async () => {
    const port = 12356;
    const srv = new ApiSrv({
        port,
        callback: () => {}
    });
    await new Promise((resolve) => srv.server.on('listening', resolve));
    await srv.shutdown();
    await assert.rejects(httpRequest(port, { method: 'GET', path: '/' }));
});

