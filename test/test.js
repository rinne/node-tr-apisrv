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

test('requestHandlers support path templates', async (t) => {
    const port = 12362;
    const warnings = [];
    const warnMock = t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ handled: 'callback' }),
        requestHandlers: {
            GET: {
                '/user/{userId}': (r) => r.jsonResponse({ handled: 'requestHandlers', params: r.params })
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/user/123?foo=bar&userId=query' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            handled: 'requestHandlers',
            params: { foo: 'bar', userId: '123' }
        });
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /userId/);
        assert.match(warnings[0], /query string/);
    } finally {
        t.mock.restoreAll();
        await srv.shutdown();
    }
});

test('requestHandlers match trailing slash when template omits it', async () => {
    const port = 12370;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/slashless': (r) => r.jsonResponse({ handled: 'slashless', path: r.url })
            }
        }
    });
    try {
        let res = await httpRequest(port, { method: 'GET', path: '/slashless' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { handled: 'slashless', path: '/slashless' });

        res = await httpRequest(port, { method: 'GET', path: '/slashless/' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { handled: 'slashless', path: '/slashless/' });
    } finally {
        await srv.shutdown();
    }
});

test('requestHandlers require trailing slash when template includes it', async () => {
    const port = 12371;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/needs-slash/': (r) => r.jsonResponse({ handled: 'needs-slash' })
            }
        }
    });
    try {
        const withSlash = await httpRequest(port, { method: 'GET', path: '/needs-slash/' });
        assert.strictEqual(withSlash.status, 200);
        assert.deepStrictEqual(JSON.parse(withSlash.data), { handled: 'needs-slash' });

        const withoutSlash = await httpRequest(port, { method: 'GET', path: '/needs-slash' });
        assert.strictEqual(withoutSlash.status, 404);
        const body = JSON.parse(withoutSlash.data);
        assert.strictEqual(body.code, 404);
        assert.strictEqual(body.message, 'Not Found');
    } finally {
        await srv.shutdown();
    }
});

test('dynamic template without trailing slash matches both forms', async () => {
    const port = 12372;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/user/{userId}': (r) => r.jsonResponse({ params: r.params })
            }
        }
    });
    try {
        let res = await httpRequest(port, { method: 'GET', path: '/user/abc' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { params: { userId: 'abc' } });

        res = await httpRequest(port, { method: 'GET', path: '/user/abc/' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { params: { userId: 'abc' } });
    } finally {
        await srv.shutdown();
    }
});

test('dynamic template with trailing slash requires trailing slash in request', async () => {
    const port = 12373;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/user/{userId}/': (r) => r.jsonResponse({ params: r.params })
            }
        }
    });
    try {
        const withSlash = await httpRequest(port, { method: 'GET', path: '/user/abc/' });
        assert.strictEqual(withSlash.status, 200);
        assert.deepStrictEqual(JSON.parse(withSlash.data), { params: { userId: 'abc' } });

        const withoutSlash = await httpRequest(port, { method: 'GET', path: '/user/abc' });
        assert.strictEqual(withoutSlash.status, 404);
        const body = JSON.parse(withoutSlash.data);
        assert.strictEqual(body.code, 404);
        assert.strictEqual(body.message, 'Not Found');
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

test('requestHandlers capture array segments with [variable]', async () => {
    const port = 12367;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/files/[pathParts]': (r) => r.jsonResponse({ params: r.params })
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/files/foo/bar/baz' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { params: { pathParts: ['foo', 'bar', 'baz'] } });
    } finally {
        await srv.shutdown();
    }
});

test('requestHandlers capture [variable] segments in the middle of a template', async () => {
    const port = 12368;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/{cmd}/[zap]/{bar}/{pup}': (r) => r.jsonResponse({ params: r.params })
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/do/one/two/three/four' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            params: {
                cmd: 'do',
                zap: ['one', 'two'],
                bar: 'three',
                pup: 'four'
            }
        });
    } finally {
        await srv.shutdown();
    }
});

test('path parameters override body parameters with warning', async (t) => {
    const port = 12369;
    const warnings = [];
    const warnMock = t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' ')));
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            POST: {
                '/user/{userId}': (r) => r.jsonResponse({ params: r.params })
            }
        }
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/user/123',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: 'fromBody', name: 'alice' })
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            params: { userId: '123', name: 'alice' }
        });
        assert.strictEqual(warnings.length, 1);
        assert.match(warnings[0], /userId/);
        assert.match(warnings[0], /request body/);
    } finally {
        t.mock.restoreAll();
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
        const body = JSON.parse(res.data);
        assert.strictEqual(body.code, 404);
        assert.strictEqual(body.message, 'Not Found');
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
        const body = JSON.parse(res.data);
        assert.strictEqual(body.code, 405);
        assert.strictEqual(body.message, 'Method Not Allowed');
    } finally {
        await srv.shutdown();
    }
});

test('rejects dangerous paths by default', async () => {
    const port = 12367;
    let handled = 0;
    const srv = new ApiSrv({
        port,
        callback: (r) => {
            handled++;
            r.jsonResponse({ ok: true });
        }
    });
    try {
        const cases = [
            { path: '/foo//bar', message: 'Bad Request (empty path segment)' },
            { path: '/foo/./bar', message: 'Bad Request (dangerous path segment ".")' },
            { path: '/foo/../bar', message: 'Bad Request (dangerous path segment "..")' }
        ];
        for (const { path, message } of cases) {
            const res = await httpRequest(port, { method: 'GET', path });
            assert.strictEqual(res.status, 400);
            assert.strictEqual(res.headers['content-type'], 'application/json; charset=utf-8');
            const body = JSON.parse(res.data);
            assert.strictEqual(body.code, 400);
            assert.strictEqual(body.message, message);
        }
        assert.strictEqual(handled, 0);
    } finally {
        await srv.shutdown();
    }
});

test('dangerous path rejection can be disabled', async () => {
    const port = 12368;
    let handled = 0;
    const srv = new ApiSrv({
        port,
        rejectDangerousPaths: false,
        callback: (r) => {
            handled++;
            r.jsonResponse({ url: r.url });
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/foo//bar' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { url: '/foo//bar' });
        assert.strictEqual(handled, 1);
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
        let body = JSON.parse(res.data);
        assert.strictEqual(body.code, 405);
        assert.strictEqual(body.message, 'Method Not Allowed');

        srv.requestHandleDelete('*', '/dynamic');
        res = await httpRequest(port, {
            method: 'POST',
            path: '/dynamic',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        assert.strictEqual(res.status, 404);
        body = JSON.parse(res.data);
        assert.strictEqual(body.code, 404);
        assert.strictEqual(body.message, 'Not Found');
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
        const body = JSON.parse(res.data);
        assert.strictEqual(body.code, 408);
        assert.strictEqual(body.message, 'Request Timeout');
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

