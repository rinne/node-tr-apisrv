'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
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
            res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
        });
        req.on('error', reject);
        if (body) {
            req.write(body);
        }
        req.end();
    });
}

function rawRequest(port, raw) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        let data = '';
        socket.on('connect', () => socket.end(raw));
        socket.on('data', (d) => data += d.toString());
        socket.on('end', () => {
            const m = data.match(/^HTTP\/1\.1\s+(\d+)/);
            resolve(parseInt(m[1], 10));
        });
        socket.on('error', reject);
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

test('requestHandlers take precedence over callback', async () => {
    const port = 12361;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ handled: 'callback' }),
        requestHandlers: {
            GET: {
                '/': (r) => r.jsonResponse({ handled: 'requestHandlers' })
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { handled: 'requestHandlers' });
    } finally {
        await srv.shutdown();
    }
});

test('requestHandlers support path templates', async () => {
    const port = 12362;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ handled: 'callback' }),
        requestHandlers: {
            GET: {
                '/user/{userId}': (r) => r.jsonResponse({ handled: 'requestHandlers', url: r.url })
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/user/123?foo=bar' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { handled: 'requestHandlers', url: '/user/123' });
    } finally {
        await srv.shutdown();
    }
});

test('falls back to callback when requestHandlers do not match', async () => {
    const port = 12363;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ handled: 'callback' }),
        requestHandlers: {
            GET: {
                '/foo': (r) => r.jsonResponse({ handled: 'requestHandlers' })
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { handled: 'callback' });
    } finally {
        await srv.shutdown();
    }
});

test('returns 404 when no handler matches and callback missing', async () => {
    const port = 12364;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/foo': (r) => r.jsonResponse({ handled: 'requestHandlers' })
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/bar' });
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.headers['content-type'], 'application/json; charset=utf-8');
        assert.deepStrictEqual(JSON.parse(res.data), { message: 'Not Found', code: 404 });
    } finally {
        await srv.shutdown();
    }
});

test('returns 405 when path matches other method and callback missing', async () => {
    const port = 12365;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/foo': (r) => r.jsonResponse({ handled: 'requestHandlers' })
            }
        }
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/foo',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(res.status, 405);
        assert.strictEqual(res.headers['content-type'], 'application/json; charset=utf-8');
        assert.deepStrictEqual(JSON.parse(res.data), { message: 'Method Not Allowed', code: 405 });
    } finally {
        await srv.shutdown();
    }
});

test('requestHandleAdd and requestHandleDelete modify handlers at runtime', async () => {
    const port = 12366;
    const srv = new ApiSrv({ port });
    srv.requestHandleAdd('GET', '/dynamic', (r) => r.jsonResponse({ method: r.method }));
    srv.requestHandleAdd('POST', '/dynamic', (r) => r.jsonResponse({ method: r.method }));
    try {
        let res = await httpRequest(port, { method: 'GET', path: '/dynamic' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { method: 'GET' });

        res = await httpRequest(port, {
            method: 'POST',
            path: '/dynamic',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { method: 'POST' });

        srv.requestHandleDelete('GET', '/dynamic');
        res = await httpRequest(port, { method: 'GET', path: '/dynamic' });
        assert.strictEqual(res.status, 405);
        assert.deepStrictEqual(JSON.parse(res.data), { message: 'Method Not Allowed', code: 405 });

        srv.requestHandleDelete('*', '/dynamic');
        res = await httpRequest(port, {
            method: 'POST',
            path: '/dynamic',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(res.status, 404);
        assert.deepStrictEqual(JSON.parse(res.data), { message: 'Not Found', code: 404 });
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

test('rejects requests exceeding Content-Length limit without reading body', async () => {
    const port = 12357;
    const srv = new ApiSrv({
        port,
        maxBodySize: 5,
        callback: () => {}
    });
    try {
        const status = await rawRequest(port,
            'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n');
        assert.strictEqual(status, 413);
    } finally {
        await srv.shutdown();
    }
});

test('enforces Content-Length to match body length', async () => {
    const port = 12358;
    const srv = new ApiSrv({
        port,
        callback: () => {}
    });
    try {
        const status = await rawRequest(port,
            'POST / HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 5\r\n\r\nabcd');
        assert.strictEqual(status, 400);
    } finally {
        await srv.shutdown();
    }
});

test('allows additional Content-Type parameters', async () => {
    const port = 12359;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse(r.params)
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json; charset=utf-8; version=1' },
            body: JSON.stringify({ a: 1 })
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { a: 1 });
    } finally {
        await srv.shutdown();
    }
});

test('rejects unsupported charset parameter', async () => {
    const port = 12360;
    const srv = new ApiSrv({
        port,
        callback: () => {}
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json; charset=iso-8859-1' },
            body: JSON.stringify({ a: 1 })
        });
        assert.strictEqual(res.status, 400);
    } finally {
        await srv.shutdown();
    }
});

