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
        callback: (r) => r.jsonResponse({
            method: r.method,
            params: r.params,
            pathParams: r.pathParams,
            urlParams: r.urlParams,
            bodyParams: r.bodyParams
        })
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/?a=1' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            method: 'GET',
            params: { a: '1' },
            pathParams: {},
            urlParams: { a: '1' },
            bodyParams: {}
        });
    } finally {
        await srv.shutdown();
    }
});

test('handles POST requests', async () => {
    const port = 12351;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({
            method: r.method,
            params: r.params,
            pathParams: r.pathParams,
            urlParams: r.urlParams,
            bodyParams: r.bodyParams
        })
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ a: 1 })
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            method: 'POST',
            params: { a: 1 },
            pathParams: {},
            urlParams: {},
            bodyParams: { a: 1 }
        });
    } finally {
        await srv.shutdown();
    }
});

test('handles PUT requests', async () => {
    const port = 12352;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({
            method: r.method,
            params: r.params,
            pathParams: r.pathParams,
            urlParams: r.urlParams,
            bodyParams: r.bodyParams
        })
    });
    try {
        const res = await httpRequest(port, {
            method: 'PUT',
            path: '/',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'a=1'
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            method: 'PUT',
            params: { a: '1' },
            pathParams: {},
            urlParams: {},
            bodyParams: { a: '1' }
        });
    } finally {
        await srv.shutdown();
    }
});

test('handles DELETE requests', async () => {
    const port = 12353;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({
            method: r.method,
            params: r.params,
            pathParams: r.pathParams,
            urlParams: r.urlParams,
            bodyParams: r.bodyParams
        })
    });
    try {
        const res = await httpRequest(port, { method: 'DELETE', path: '/?a=1' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            method: 'DELETE',
            params: { a: '1' },
            pathParams: {},
            urlParams: { a: '1' },
            bodyParams: {}
        });
    } finally {
        await srv.shutdown();
    }
});

test('handlers can respond with JSON errors via errorResponse', async () => {
    const port = 12354;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            POST: {
                '/items': (r) => r.errorResponse(400, 'Input data is too complex')
            },
            GET: {
                '/items': (r) => r.errorResponse(404)
            }
        }
    });
    try {
        const invalid = await httpRequest(port, {
            method: 'POST',
            path: '/items',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
        });
        assert.strictEqual(invalid.status, 400);
        const invalidBody = JSON.parse(invalid.data);
        assert.strictEqual(invalidBody.code, 400);
        assert.strictEqual(invalidBody.message, 'Bad Request (Input data is too complex)');

        const missing = await httpRequest(port, { method: 'GET', path: '/items' });
        assert.strictEqual(missing.status, 404);
        const missingBody = JSON.parse(missing.data);
        assert.strictEqual(missingBody.code, 404);
        assert.strictEqual(missingBody.message, 'Not Found');
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
                '/user/{userId}': (r) => r.jsonResponse({
                    handled: 'requestHandlers',
                    params: r.params,
                    pathParams: r.pathParams,
                    urlParams: r.urlParams,
                    bodyParams: r.bodyParams
                })
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/user/123?foo=bar&userId=query' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            handled: 'requestHandlers',
            params: { foo: 'bar', userId: '123' },
            pathParams: { userId: '123' },
            urlParams: { foo: 'bar', userId: 'query' },
            bodyParams: {}
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
                '/user/{userId}': (r) => r.jsonResponse({
                    params: r.params,
                    pathParams: r.pathParams,
                    urlParams: r.urlParams,
                    bodyParams: r.bodyParams
                })
            }
        }
    });
    try {
        let res = await httpRequest(port, { method: 'GET', path: '/user/abc' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            params: { userId: 'abc' },
            pathParams: { userId: 'abc' },
            urlParams: {},
            bodyParams: {}
        });

        res = await httpRequest(port, { method: 'GET', path: '/user/abc/' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            params: { userId: 'abc' },
            pathParams: { userId: 'abc' },
            urlParams: {},
            bodyParams: {}
        });
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

test('requestHandlers reject invalid path parameter names', () => {
    assert.throws(() => {
        new ApiSrv({
            port: 12394,
            requestHandlers: {
                GET: {
                    '/users/{1bad}': () => {}
                }
            }
        });
    }, /Invalid path parameter name/);

    assert.throws(() => {
        new ApiSrv({
            port: 12395,
            requestHandlers: {
                GET: {
                    '/files/[bad-name]': () => {}
                }
            }
        });
    }, /Invalid path parameter name|Invalid path parameter segment/);
});

test('requestHandlers reject invalid array constraints', () => {
    assert.throws(() => {
        new ApiSrv({
            port: 12396,
            requestHandlers: {
                GET: {
                    '/files/[segments:0]': () => {}
                }
            }
        });
    }, /Invalid minimum length/);

    assert.throws(() => {
        new ApiSrv({
            port: 12397,
            requestHandlers: {
                GET: {
                    '/files/[segments:5:2]': () => {}
                }
            }
        });
    }, /Invalid length range/);

    assert.throws(() => {
        new ApiSrv({
            port: 12398,
            requestHandlers: {
                GET: {
                    '/files/[segments:4:four]': () => {}
                }
            }
        });
    }, /Invalid path parameter segment/);
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

test('request handler definition objects apply validators', async () => {
    const port = 12376;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/validate/{userId}': {
                    callback: (r) => r.jsonResponse({
                        params: r.params,
                        pathParams: r.pathParams,
                        urlParams: r.urlParams
                    }),
                    options: {
                        pathParamsValidator: (pathParams) => ({ userId: Number(pathParams.userId) }),
                        urlParamsValidator: async (urlParams) => ({ limit: Number(urlParams.limit) }),
                        paramsValidator: async (params) => ({ ...params, validated: true })
                    }
                }
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/validate/42?limit=5' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            params: { limit: 5, userId: 42, validated: true },
            pathParams: { userId: 42 },
            urlParams: { limit: 5 }
        });
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
                '/files/[pathParts]': (r) => r.jsonResponse({ params: r.params, pathParams: r.pathParams })
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/files/foo/bar/baz' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            params: { pathParts: ['foo', 'bar', 'baz'] },
            pathParams: { pathParts: ['foo', 'bar', 'baz'] }
        });
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
                '/{cmd}/[zap]/{bar}/{pup}': (r) => r.jsonResponse({ params: r.params, pathParams: r.pathParams })
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
            },
            pathParams: {
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

test('array path parameter enforces default length constraints', async () => {
    const port = 12390;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/files/[segments]': (r) => r.jsonResponse({ pathParams: r.pathParams })
            }
        }
    });
    const exactly32 = Array.from({ length: 32 }, (_, i) => `part${i}`);
    const tooMany = Array.from({ length: 33 }, (_, i) => `part${i}`);
    try {
        const within = await httpRequest(port, { method: 'GET', path: `/files/${exactly32.join('/')}` });
        assert.strictEqual(within.status, 200);
        const parsedWithin = JSON.parse(within.data);
        assert.deepStrictEqual(parsedWithin.pathParams.segments, exactly32);

        const overLimit = await httpRequest(port, { method: 'GET', path: `/files/${tooMany.join('/')}` });
        assert.strictEqual(overLimit.status, 404);
        const body = JSON.parse(overLimit.data);
        assert.strictEqual(body.code, 404);
        assert.strictEqual(body.message, 'Not Found');
    } finally {
        await srv.shutdown();
    }
});

test('array path parameter enforces exact length constraint', async () => {
    const port = 12391;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/files/[segments:4]': (r) => r.jsonResponse({ pathParams: r.pathParams })
            }
        }
    });
    const exactlyFour = Array.from({ length: 4 }, (_, i) => `p${i}`);
    const three = exactlyFour.slice(0, 3);
    const five = [...exactlyFour, 'extra'];
    try {
        const exact = await httpRequest(port, { method: 'GET', path: `/files/${exactlyFour.join('/')}` });
        assert.strictEqual(exact.status, 200);
        const parsedExact = JSON.parse(exact.data);
        assert.deepStrictEqual(parsedExact.pathParams.segments, exactlyFour);

        const tooFew = await httpRequest(port, { method: 'GET', path: `/files/${three.join('/')}` });
        assert.strictEqual(tooFew.status, 404);
        const bodyFew = JSON.parse(tooFew.data);
        assert.strictEqual(bodyFew.code, 404);
        assert.strictEqual(bodyFew.message, 'Not Found');

        const tooMany = await httpRequest(port, { method: 'GET', path: `/files/${five.join('/')}` });
        assert.strictEqual(tooMany.status, 404);
        const bodyMany = JSON.parse(tooMany.data);
        assert.strictEqual(bodyMany.code, 404);
        assert.strictEqual(bodyMany.message, 'Not Found');
    } finally {
        await srv.shutdown();
    }
});

test('array path parameter enforces min and max constraints', async () => {
    const port = 12392;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/files/[segments:2:4]': (r) => r.jsonResponse({ pathParams: r.pathParams })
            }
        }
    });
    const two = ['a', 'b'];
    const four = ['a', 'b', 'c', 'd'];
    try {
        const minOk = await httpRequest(port, { method: 'GET', path: `/files/${two.join('/')}` });
        assert.strictEqual(minOk.status, 200);
        const parsedMin = JSON.parse(minOk.data);
        assert.deepStrictEqual(parsedMin.pathParams.segments, two);

        const maxOk = await httpRequest(port, { method: 'GET', path: `/files/${four.join('/')}` });
        assert.strictEqual(maxOk.status, 200);
        const parsedMax = JSON.parse(maxOk.data);
        assert.deepStrictEqual(parsedMax.pathParams.segments, four);

        const tooFew = await httpRequest(port, { method: 'GET', path: '/files/a' });
        assert.strictEqual(tooFew.status, 404);
        const bodyFew = JSON.parse(tooFew.data);
        assert.strictEqual(bodyFew.code, 404);
        assert.strictEqual(bodyFew.message, 'Not Found');

        const tooMany = await httpRequest(port, { method: 'GET', path: '/files/a/b/c/d/e' });
        assert.strictEqual(tooMany.status, 404);
        const bodyMany = JSON.parse(tooMany.data);
        assert.strictEqual(bodyMany.code, 404);
        assert.strictEqual(bodyMany.message, 'Not Found');
    } finally {
        await srv.shutdown();
    }
});

test('array path parameter allows raising the default maximum', async () => {
    const port = 12393;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/files/[segments:10:50]': (r) => r.jsonResponse({ pathParams: r.pathParams })
            }
        }
    });
    const ten = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const forty = Array.from({ length: 40 }, (_, i) => `s${i}`);
    const nine = ten.slice(0, 9);
    const fiftyOne = Array.from({ length: 51 }, (_, i) => `s${i}`);
    try {
        const minOk = await httpRequest(port, { method: 'GET', path: `/files/${ten.join('/')}` });
        assert.strictEqual(minOk.status, 200);
        const parsedMin = JSON.parse(minOk.data);
        assert.deepStrictEqual(parsedMin.pathParams.segments, ten);

        const extended = await httpRequest(port, { method: 'GET', path: `/files/${forty.join('/')}` });
        assert.strictEqual(extended.status, 200);
        const parsedExtended = JSON.parse(extended.data);
        assert.deepStrictEqual(parsedExtended.pathParams.segments, forty);

        const belowMin = await httpRequest(port, { method: 'GET', path: `/files/${nine.join('/')}` });
        assert.strictEqual(belowMin.status, 404);
        const bodyLow = JSON.parse(belowMin.data);
        assert.strictEqual(bodyLow.code, 404);
        assert.strictEqual(bodyLow.message, 'Not Found');

        const aboveMax = await httpRequest(port, { method: 'GET', path: `/files/${fiftyOne.join('/')}` });
        assert.strictEqual(aboveMax.status, 404);
        const bodyHigh = JSON.parse(aboveMax.data);
        assert.strictEqual(bodyHigh.code, 404);
        assert.strictEqual(bodyHigh.message, 'Not Found');
    } finally {
        await srv.shutdown();
    }
});

test('ignoreUrlParams prevents query parsing', async () => {
    const port = 12377;
    let urlValidatorCalled = false;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/items/{itemId}': {
                    callback: (r) => r.jsonResponse({
                        params: r.params,
                        pathParams: r.pathParams,
                        hasUrlParams: Object.prototype.hasOwnProperty.call(r, 'urlParams')
                    }),
                    options: {
                        ignoreUrlParams: true,
                        urlParamsValidator: () => {
                            urlValidatorCalled = true;
                            return {};
                        }
                    }
                }
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/items/abc?foo=bar' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            params: { itemId: 'abc' },
            pathParams: { itemId: 'abc' },
            hasUrlParams: false
        });
        assert.strictEqual(urlValidatorCalled, false);
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
                '/user/{userId}': (r) => r.jsonResponse({
                    params: r.params,
                    pathParams: r.pathParams,
                    urlParams: r.urlParams,
                    bodyParams: r.bodyParams
                })
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
            params: { userId: '123', name: 'alice' },
            pathParams: { userId: '123' },
            urlParams: {},
            bodyParams: { userId: 'fromBody', name: 'alice' }
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

test('requestHandleAdd supports validator options', async () => {
    const port = 12378;
    const srv = new ApiSrv({ port });
    srv.requestHandleAdd('POST', '/items/{itemId}', (r) => r.jsonResponse({
        params: r.params,
        pathParams: r.pathParams,
        bodyParams: r.bodyParams,
        urlParams: r.urlParams
    }), {
        pathParamsValidator: (pathParams) => ({ itemId: Number(pathParams.itemId) }),
        bodyParamsValidator: async (bodyParams) => ({
            name: bodyParams.name.toUpperCase(),
            count: Number(bodyParams.count)
        }),
        paramsValidator: (params) => ({ ...params, validated: true })
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/items/5',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'foo', count: '3' })
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            params: { name: 'FOO', count: 3, itemId: 5, validated: true },
            pathParams: { itemId: 5 },
            bodyParams: { name: 'FOO', count: 3 },
            urlParams: {}
        });
    } finally {
        await srv.shutdown();
    }
});

test('requestHandleAdd enforces path template constraints', async () => {
    const port = 12399;
    const srv = new ApiSrv({ port });
    try {
        assert.throws(() => {
            srv.requestHandleAdd('GET', '/bad/{1foo}', () => {});
        }, /Invalid path parameter name/);

        assert.throws(() => {
            srv.requestHandleAdd('GET', '/bad/[parts:0]', () => {});
        }, /Invalid minimum length/);
    } finally {
        await srv.shutdown();
    }
});

test('authentication runs before parameter parsing', async () => {
    const port = 12379;
    let authSnapshot;
    let handlerSnapshot;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            POST: {
                '/items/{itemId}': {
                    callback: (r) => {
                        const normalizedPath = r.pathParams === undefined ? undefined : { ...r.pathParams };
                        const normalizedUrl = r.urlParams === undefined ? undefined : { ...r.urlParams };
                        handlerSnapshot = {
                            bodyParams: r.bodyParams,
                            pathParams: normalizedPath,
                            urlParams: normalizedUrl,
                            params: r.params
                        };
                        r.jsonResponse({ ok: true });
                    }
                }
            }
        },
        authCallback: (r) => {
            authSnapshot = {
                bodyParams: r.bodyParams,
                pathParams: r.pathParams,
                urlParams: r.urlParams,
                params: r.params
            };
            return true;
        }
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/items/10',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'foo' })
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(authSnapshot, {
            bodyParams: undefined,
            pathParams: undefined,
            urlParams: undefined,
            params: undefined
        });
        assert.deepStrictEqual(handlerSnapshot, {
            bodyParams: { name: 'foo' },
            pathParams: { itemId: '10' },
            urlParams: {},
            params: { name: 'foo', itemId: '10' }
        });
    } finally {
        await srv.shutdown();
    }
});

test('authentication failure skips parameter parsing', async () => {
    const port = 12380;
    let authCalls = 0;
    let authSnapshot;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            POST: {
                '/items': {
                    callback: () => {
                        throw new Error('handler must not be invoked');
                    }
                }
            }
        },
        authCallback: (r) => {
            authCalls++;
            authSnapshot = {
                bodyParams: r.bodyParams,
                pathParams: r.pathParams,
                urlParams: r.urlParams,
                params: r.params
            };
            r.res.writeHead(401, { 'Content-Type': 'text/plain' });
            r.res.end('unauthorized');
            return false;
        }
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/items',
            headers: { 'Content-Type': 'application/json' },
            body: '{'
        });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(res.data, 'unauthorized');
        assert.strictEqual(authCalls, 1);
        assert.deepStrictEqual(authSnapshot, {
            bodyParams: undefined,
            pathParams: undefined,
            urlParams: undefined,
            params: undefined
        });
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


test('a __proto__ parameter is an own property and does not replace the prototype', async () => {
    const port = 12400;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({
            inherited: r.params.injected,
            ownProto: Object.prototype.hasOwnProperty.call(r.params, '__proto__'),
            plainPrototype: Object.getPrototypeOf(r.params) === Object.prototype,
            keys: Object.keys(r.params)
        })
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json' },
            body: '{"__proto__": {"injected": "yes"}, "a": 1}'
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            ownProto: true,
            plainPrototype: true,
            keys: ['__proto__', 'a']
        });
    } finally {
        await srv.shutdown();
    }
});

test('requestHandlers reject __proto__ as a path parameter name', () => {
    for (const path of ['/a/{__proto__}', '/a/[__proto__]', '/a/[__proto__:2]']) {
        assert.throws(() => new ApiSrv({
            port: 12401,
            requestHandlers: { GET: { [path]: () => {} } }
        }), /Invalid path parameter name "__proto__"/);
    }
});

test('rejectDangerousParamNames rejects reserved names in body and query', async () => {
    const port = 12402;
    let called = 0;
    const srv = new ApiSrv({
        port,
        rejectDangerousParamNames: true,
        callback: (r) => { called++; return r.jsonResponse({ ok: true }); }
    });
    try {
        for (const body of ['{"__proto__": {"a": 1}}', '{"a": {"b": [{"constructor": 1}]}}', '{"prototype": 1}']) {
            const res = await httpRequest(port, {
                method: 'POST',
                path: '/',
                headers: { 'Content-Type': 'application/json' },
                body
            });
            assert.strictEqual(res.status, 400, body);
            assert.match(JSON.parse(res.data).message, /Reserved parameter name ".*" in request body/);
        }
        let res = await httpRequest(port, { method: 'GET', path: '/?__proto__=1' });
        assert.strictEqual(res.status, 400);
        assert.match(JSON.parse(res.data).message, /Reserved parameter name "__proto__" in query string/);
        res = await httpRequest(port, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'a=1&constructor=2'
        });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(called, 0);
        res = await httpRequest(port, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json' },
            body: '{"a": {"proto": 1, "constructors": [2]}}'
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(called, 1);
    } finally {
        await srv.shutdown();
    }
});

test('reserved parameter names are accepted by default', async () => {
    const port = 12403;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ keys: Object.keys(r.params) })
    });
    try {
        const res = await httpRequest(port, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json' },
            body: '{"constructor": 1, "prototype": 2}'
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { keys: ['constructor', 'prototype'] });
    } finally {
        await srv.shutdown();
    }
});

test('requireObjectBody rejects JSON array bodies', async () => {
    const port = 12404;
    const strict = new ApiSrv({
        port,
        requireObjectBody: true,
        callback: (r) => r.jsonResponse({ keys: Object.keys(r.params) })
    });
    const lenient = new ApiSrv({
        port: port + 1,
        callback: (r) => r.jsonResponse({ keys: Object.keys(r.params) })
    });
    try {
        const request = (p, body) => httpRequest(p, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json' },
            body
        });
        let res = await request(port, '["a", "b"]');
        assert.strictEqual(res.status, 400);
        assert.deepStrictEqual(JSON.parse(res.data), { code: 400, message: 'Bad Request (JSON body must be an object)' });
        res = await request(port, '{"a": 1}');
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { keys: ['a'] });
        // The default is unchanged: array items become parameters "0", "1", ...
        res = await request(port + 1, '["a", "b"]');
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { keys: ['0', '1'] });
    } finally {
        await strict.shutdown();
        await lenient.shutdown();
    }
});

test('errorCallback shapes validator errors and receives the cause', async () => {
    const port = 12406;
    const seen = [];
    const srv = new ApiSrv({
        port,
        errorCallback: (e) => {
            seen.push({ code: e.code, message: e.message, detail: e.detail, source: e.source, stage: e.stage,
                        cause: e.cause ? e.cause.message : undefined, url: e.request.url, method: e.request.method });
            if (e.source !== 'validator') {
                return false;
            }
            e.request.jsonResponse({ status: 'error', problems: e.cause.problems }, 422);
            return true;
        },
        requestHandlers: {
            POST: {
                '/items': {
                    callback: (r) => r.jsonResponse({ ok: true }),
                    options: {
                        paramsValidator: (params) => {
                            if (params.a !== 1) {
                                const err = new Error('a must be 1');
                                err.problems = [{ path: '/a', reason: 'const' }];
                                throw err;
                            }
                            return params;
                        }
                    }
                }
            }
        }
    });
    try {
        let res = await httpRequest(port, {
            method: 'POST',
            path: '/items',
            headers: { 'Content-Type': 'application/json' },
            body: '{"a": 2}'
        });
        assert.strictEqual(res.status, 422);
        assert.deepStrictEqual(JSON.parse(res.data), { status: 'error', problems: [{ path: '/a', reason: 'const' }] });
        assert.deepStrictEqual(seen.pop(), {
            code: 400,
            message: 'Bad Request (a must be 1)',
            detail: 'a must be 1',
            source: 'validator',
            stage: 'request parameters',
            cause: 'a must be 1',
            url: '/items',
            method: 'POST'
        });
        res = await httpRequest(port, {
            method: 'POST',
            path: '/items',
            headers: { 'Content-Type': 'application/json' },
            body: '{"a": 1}'
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(seen.length, 0);
    } finally {
        await srv.shutdown();
    }
});

test('errorCallback sees router, parser and handler errors and may leave the default', async () => {
    const port = 12407;
    const seen = [];
    const srv = new ApiSrv({
        port,
        errorCallback: (e) => {
            seen.push([e.code, e.source, e.message]);
            return false;
        },
        requestHandlers: {
            GET: { '/known': (r) => r.jsonResponse({ ok: true }), '/boom': () => { throw new Error('boom'); } },
            POST: { '/known': (r) => r.jsonResponse({ ok: true }) }
        }
    });
    try {
        let res = await httpRequest(port, { method: 'GET', path: '/unknown' });
        assert.strictEqual(res.status, 404);
        assert.deepStrictEqual(JSON.parse(res.data), { message: 'Not Found', code: 404 });
        res = await httpRequest(port, { method: 'DELETE', path: '/known' });
        assert.strictEqual(res.status, 405);
        assert.deepStrictEqual(JSON.parse(res.data), { message: 'Method Not Allowed', code: 405 });
        res = await httpRequest(port, {
            method: 'POST',
            path: '/known',
            headers: { 'Content-Type': 'application/json' },
            body: '{not json'
        });
        assert.strictEqual(res.status, 400);
        assert.deepStrictEqual(JSON.parse(res.data), { code: 400, message: 'Bad Request (Unable to parse JSON query parameters)' });
        res = await httpRequest(port, { method: 'GET', path: '/boom' });
        assert.strictEqual(res.status, 500);
        assert.deepStrictEqual(JSON.parse(res.data), { code: 500, message: 'Internal Server Error' });
        assert.deepStrictEqual(seen, [
            [404, 'router', 'Not Found'],
            [405, 'router', 'Method Not Allowed'],
            [400, 'parser', 'Bad Request (Unable to parse JSON query parameters)'],
            [500, 'handler', 'Internal Server Error']
        ]);
    } finally {
        await srv.shutdown();
    }
});

test('errorCallback can be asynchronous, and a failing one falls back to the default', async () => {
    const port = 12408;
    let mode = 'async';
    const srv = new ApiSrv({
        port,
        errorCallback: async (e) => {
            if (mode === 'throw') {
                throw new Error('hook failure');
            }
            if (mode === 'decline') {
                return undefined;
            }
            await new Promise((resolve) => setTimeout(resolve, 5));
            e.res.writeHead(e.code, { 'Content-Type': 'text/plain' });
            e.res.end(`custom ${e.code} ${e.source}`);
            return true;
        }
    });
    try {
        let res = await httpRequest(port, { method: 'GET', path: '/missing' });
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.data, 'custom 404 router');
        for (mode of ['throw', 'decline']) {
            res = await httpRequest(port, { method: 'GET', path: '/missing' });
            assert.strictEqual(res.status, 404, mode);
            assert.deepStrictEqual(JSON.parse(res.data), { message: 'Not Found', code: 404 }, mode);
        }
    } finally {
        await srv.shutdown();
    }
});

test('errorCallback handles body size and unsupported method errors', async () => {
    const port = 12409;
    const seen = [];
    const srv = new ApiSrv({
        port,
        maxBodySize: 8,
        errorCallback: (e) => {
            seen.push([e.code, e.source]);
            e.res.writeHead(e.code, { 'Content-Type': 'application/json' });
            e.res.end(JSON.stringify({ custom: e.code }));
            return true;
        },
        callback: (r) => r.jsonResponse({ ok: true })
    });
    try {
        let res = await httpRequest(port, {
            method: 'POST',
            path: '/',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ a: 'a long enough value' })
        });
        assert.strictEqual(res.status, 413);
        assert.deepStrictEqual(JSON.parse(res.data), { custom: 413 });
        res = await httpRequest(port, { method: 'PATCH', path: '/' });
        assert.strictEqual(res.status, 405);
        assert.deepStrictEqual(JSON.parse(res.data), { custom: 405 });
        assert.deepStrictEqual(seen, [[413, 'limit'], [405, 'request']]);
    } finally {
        await srv.shutdown();
    }
});

test('errorResponse from a handler does not go through errorCallback', async () => {
    const port = 12410;
    let hookCalls = 0;
    const srv = new ApiSrv({
        port,
        errorCallback: () => { hookCalls++; return false; },
        callback: (r) => r.errorResponse(409, 'ignored detail')
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/' });
        assert.strictEqual(res.status, 409);
        assert.deepStrictEqual(JSON.parse(res.data), { code: 409, message: 'Conflict' });
        assert.strictEqual(hookCalls, 0);
    } finally {
        await srv.shutdown();
    }
});

test('pathRewrite maps prefixed paths to one handler and keeps the original', async () => {
    const port = 12411;
    const srv = new ApiSrv({
        port,
        pathRewrite: (path) => path.replace(/^\/(svc\/)?(hook\/)?/, '/'),
        requestHandlers: {
            GET: {
                '/items/{id}': (r) => r.jsonResponse({ url: r.url, originalUrl: r.originalUrl, id: r.params.id })
            }
        },
        callback: (r) => r.jsonResponse({ fallback: r.url, originalUrl: r.originalUrl })
    });
    try {
        for (const path of ['/items/7', '/hook/items/7', '/svc/hook/items/7']) {
            const res = await httpRequest(port, { method: 'GET', path: path + '?x=1' });
            assert.strictEqual(res.status, 200, path);
            assert.deepStrictEqual(JSON.parse(res.data), { url: '/items/7', originalUrl: path, id: '7' });
        }
        const res = await httpRequest(port, { method: 'GET', path: '/svc/other' });
        assert.deepStrictEqual(JSON.parse(res.data), { fallback: '/other', originalUrl: '/svc/other' });
    } finally {
        await srv.shutdown();
    }
});

test('pathRewrite results are checked', async () => {
    const port = 12412;
    let mode = 'keep';
    let called = 0;
    const srv = new ApiSrv({
        port,
        pathRewrite: (path) => {
            switch (mode) {
            case 'keep':
                return undefined;
            case 'relative':
                return 'not-a-path';
            case 'throw':
                throw new Error('rewrite failure');
            case 'dangerous':
                return '/a/../b';
            }
        },
        callback: (r) => { called++; return r.jsonResponse({ url: r.url }); }
    });
    try {
        let res = await httpRequest(port, { method: 'GET', path: '/same' });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { url: '/same' });
        for (mode of ['relative', 'throw']) {
            res = await httpRequest(port, { method: 'GET', path: '/same' });
            assert.strictEqual(res.status, 500, mode);
        }
        mode = 'dangerous';
        res = await httpRequest(port, { method: 'GET', path: '/same' });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(called, 1);
    } finally {
        await srv.shutdown();
    }
});

test('handler authCallback runs after the server authCallback and before parameter parsing', async () => {
    const port = 12413;
    const order = [];
    const srv = new ApiSrv({
        port,
        authCallback: (r) => {
            order.push('server');
            return true;
        },
        requestHandlers: {
            GET: {
                '/private/{id}': {
                    callback: (r) => r.jsonResponse({ id: r.params.id, handler: r.handler }),
                    options: {
                        meta: { name: 'private-item', scopes: ['read'] },
                        authCallback: async (r) => {
                            order.push(`handler:${r.handler.path}:${r.handler.meta.name}:${r.params === undefined}`);
                            if (r.headers.authorization !== 'Bearer route-token') {
                                r.jsonResponse({ denied: true }, 403);
                                return false;
                            }
                            return true;
                        }
                    }
                },
                '/public': (r) => r.jsonResponse({ handler: r.handler })
            }
        },
        callback: (r) => r.jsonResponse({ handler: r.handler === undefined ? 'none' : r.handler })
    });
    try {
        let res = await httpRequest(port, { method: 'GET', path: '/private/5' });
        assert.strictEqual(res.status, 403);
        assert.deepStrictEqual(JSON.parse(res.data), { denied: true });
        res = await httpRequest(port, { method: 'GET', path: '/private/5', headers: { Authorization: 'Bearer route-token' } });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), {
            id: '5',
            handler: { method: 'GET', path: '/private/{id}', meta: { name: 'private-item', scopes: ['read'] } }
        });
        assert.deepStrictEqual(order, [
            'server', 'handler:/private/{id}:private-item:true',
            'server', 'handler:/private/{id}:private-item:true'
        ]);
        res = await httpRequest(port, { method: 'GET', path: '/public' });
        assert.deepStrictEqual(JSON.parse(res.data), { handler: { method: 'GET', path: '/public' } });
        res = await httpRequest(port, { method: 'GET', path: '/elsewhere' });
        assert.deepStrictEqual(JSON.parse(res.data), { handler: 'none' });
    } finally {
        await srv.shutdown();
    }
});

test('handler authCallback is not called when the server authCallback rejects', async () => {
    const port = 12414;
    let handlerAuth = 0;
    const srv = new ApiSrv({
        port,
        authCallback: (r) => {
            r.jsonResponse({ denied: 'server' }, 401);
            return false;
        },
        requestHandlers: {
            GET: {
                '/x': {
                    callback: (r) => r.jsonResponse({ ok: true }),
                    options: { authCallback: () => { handlerAuth++; return true; } }
                }
            }
        }
    });
    try {
        const res = await httpRequest(port, { method: 'GET', path: '/x' });
        assert.strictEqual(res.status, 401);
        assert.strictEqual(handlerAuth, 0);
    } finally {
        await srv.shutdown();
    }
});

test('handler options authCallback and meta are validated', () => {
    assert.throws(() => new ApiSrv({
        port: 12415,
        requestHandlers: { GET: { '/x': { callback: () => {}, options: { authCallback: 'nope' } } } }
    }), /authCallback must be a function for GET \/x/);
    assert.throws(() => new ApiSrv({
        port: 12415,
        requestHandlers: { GET: { '/x': { callback: () => {}, options: { unknownOption: 1 } } } }
    }), /Unsupported request handler option "unknownOption"/);
});

test('requestHandlerList returns the registered handlers', async () => {
    const port = 12416;
    const srv = new ApiSrv({
        port,
        requestHandlers: {
            GET: {
                '/a': () => {},
                '/b/{id}': { callback: () => {}, options: { meta: 'b-item' } }
            },
            POST: { '/a': { callback: () => {}, options: { meta: { name: 'a-create' } } } }
        }
    });
    try {
        assert.deepStrictEqual(srv.requestHandlerList(), [
            { method: 'GET', path: '/a', meta: undefined },
            { method: 'GET', path: '/b/{id}', meta: 'b-item' },
            { method: 'POST', path: '/a', meta: { name: 'a-create' } }
        ]);
        srv.requestHandleAdd('DELETE', '/a', () => {});
        srv.requestHandleDelete('GET', '/a');
        assert.deepStrictEqual(srv.requestHandlerList().map((h) => `${h.method} ${h.path}`),
                               ['GET /b/{id}', 'POST /a', 'DELETE /a']);
    } finally {
        await srv.shutdown();
    }
});

test('new constructor options are validated', () => {
    for (const [name, value] of [['errorCallback', 'x'], ['pathRewrite', 1], ['requireObjectBody', 'yes'],
                                 ['rejectDangerousParamNames', 1]]) {
        assert.throws(() => new ApiSrv({ port: 12417, [name]: value }), new RegExp(`Bad ${name} for ApiSrv constructor`));
    }
});

test('JSON responses and errors disable content type sniffing', async () => {
    const port = 12418;
    const srv = new ApiSrv({
        port,
        requestHandlers: { GET: { '/ok': (r) => r.jsonResponse({ ok: true }) } }
    });
    try {
        let res = await httpRequest(port, { method: 'GET', path: '/ok' });
        assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
        res = await httpRequest(port, { method: 'GET', path: '/missing' });
        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
        res = await httpRequest(port, { method: 'GET', path: '/a//b' });
        assert.strictEqual(res.status, 400);
        assert.strictEqual(res.headers['x-content-type-options'], 'nosniff');
    } finally {
        await srv.shutdown();
    }
});

test('a request target that is not a path matches no handler', async () => {
    const port = 12419;
    const raw = 'GET http://example.test/x/1 HTTP/1.1\r\nHost: example.test\r\nConnection: close\r\n\r\n';
    const srv = new ApiSrv({
        port,
        rejectDangerousPaths: false,
        requestHandlers: { GET: { '/x/{id}': (r) => r.jsonResponse({ ok: true }) } }
    });
    const strict = new ApiSrv({
        port: port + 20,
        requestHandlers: { GET: { '/x/{id}': (r) => r.jsonResponse({ ok: true }) } }
    });
    try {
        // Without the dangerous path check the matcher sees the absolute
        // URL: it matches nothing, and no longer fails with 500.
        assert.strictEqual(await rawRequest(port, raw), 404);
        // With the check (the default) the "//" of the URL is rejected.
        assert.strictEqual(await rawRequest(port + 20, raw), 400);
    } finally {
        await strict.shutdown();
        await srv.shutdown();
    }
});

test('a body received in many chunks is assembled', async () => {
    const port = 12420;
    const srv = new ApiSrv({
        port,
        callback: (r) => r.jsonResponse({ length: r.params.value.length, bytes: r.requestPayloadBuffer.length })
    });
    try {
        const body = JSON.stringify({ value: 'x'.repeat(200000) });
        const res = await new Promise((resolve, reject) => {
            const req = http.request({ port, hostname: '127.0.0.1', method: 'POST', path: '/',
                                       headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
                                     (r) => {
                                         let data = '';
                                         r.on('data', (d) => data += d);
                                         r.on('end', () => resolve({ status: r.statusCode, data }));
                                     });
            req.on('error', reject);
            for (let i = 0; i < body.length; i += 1000) {
                req.write(body.slice(i, i + 1000));
            }
            req.end();
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(JSON.parse(res.data), { length: 200000, bytes: Buffer.byteLength(body) });
    } finally {
        await srv.shutdown();
    }
});

test('upgrade requests use pathRewrite and reject reserved query names', async () => {
    const port = 12421;
    const seen = [];
    const srv = new ApiSrv({
        port,
        rejectDangerousParamNames: true,
        pathRewrite: (path) => path.replace(/^\/svc\//, '/'),
        callback: (r) => r.jsonResponse({ ok: true }),
        upgradeCallback: (r) => {
            seen.push({ url: r.url, originalUrl: r.originalUrl, params: Object.assign({}, r.params) });
            r.s.end('HTTP/1.1 101 Switching Protocols\r\nConnection: close\r\n\r\n');
            return true;
        }
    });
    const upgrade = (path) => new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1');
        let data = '';
        socket.on('connect', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`));
        socket.on('data', (d) => data += d.toString());
        socket.on('close', () => resolve(data));
        socket.on('error', reject);
    });
    try {
        let data = await upgrade('/svc/socket?a=1');
        assert.match(data, /^HTTP\/1\.1 101/);
        assert.deepStrictEqual(seen, [{ url: '/socket', originalUrl: '/svc/socket', params: { a: '1' } }]);
        data = await upgrade('/svc/socket?__proto__=1');
        assert.strictEqual(data, '');
        assert.strictEqual(seen.length, 1);
    } finally {
        await srv.shutdown();
    }
});
