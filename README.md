API Server
==========

This is a simple API server providing with ability to easily create
JSON API servers. Accepts also calls in www-form-urlencoded form
and treats them identically to flat JSON key-value structure.

Requires Node.js 18 or newer.

```
const ApiSrv = require('tr-apisrv');

var srv = new ApiSrv({ port: 8808,
                       address: '127.0.0.1',
                       callback: cb,
                       authCallback: authCb,
                       prettyPrintJsonResponses: true,
                       bodyReadTimeoutMs: 5000,
                       maxBodySize: 1024 * 1024,
                       debug: true });

async function authCb(r) {
    return true;
}

async function cb(r) {
    r.jsonResponse(r, 200);
}
```

Request handler configuration
-----------------------------

Specific handlers can be declared per HTTP method by supplying the
`requestHandlers` option. Handlers defined this way take precedence over the
top-level `callback`. If no handler matches a request and no fallback callback
is provided, the server responds with a JSON error message (404 when the path is
unknown, 405 when another method is registered for the same path).

```javascript
const srv = new ApiSrv({
    port: 8808,
    requestHandlers: {
        GET: {
            '/': rootCb,
            '/user': userCb,
            '/user/{userId}': userCb
        },
        POST: {
            '/user/{userId}': updateUserCb
        },
        PUT: {
            '/media/{mediaId}': uploadMediaCb
        },
        DELETE: {
            '/user/{userId}': deleteUserCb
        }
    },
    callback: fallbackCb // optional fallback when no requestHandlers match
});

// requestHandlers can be modified at runtime
srv.requestHandleAdd('GET', '/foo/bar', fooBarCb);
srv.requestHandleAdd('POST', '/foo/bar', fooBarCb);
srv.requestHandleDelete('GET', '/foo/bar');
srv.requestHandleDelete('*', '/foo/bar');
```

Examples
========

GET handler with path parameter
-------------------------------

```javascript
async function cb(r) {
    if (r.method === 'GET') {
        // Match URL like /user/123 and capture the id
        const m = r.url.match(/^\/user\/([^/]+)$/);
        if (m) {
            const id = m[1];
            // r.params contains parsed query string values
            return r.jsonResponse({ id, params: r.params });
        }
    }
}
```

POST handler with JSON body
---------------------------

```javascript
async function cb(r) {
    if (r.method === 'POST') {
        // Match URL like /user/123 and capture the id
        const m = r.url.match(/^\/user\/([^/]+)$/);
        if (m) {
            const id = m[1];
            // Body is already parsed into r.params
            return r.jsonResponse({ id, received: r.params });
        }
    }
}
```

Non‑JSON response
-----------------

Sometimes a handler may need to send a plain text or other custom response.
The underlying `http.ServerResponse` is available as `r.res`:

```javascript
async function cb(r) {
    if (r.url === '/plaintext') {
        r.res.writeHead(200, { 'Content-Type': 'text/plain' });
        r.res.end('ok');
        return;
    }
    // default JSON response
    return r.jsonResponse({ ok: true });
}
```

`maxBodySize` limits the size of accepted request bodies in bytes. Requests exceeding
the limit are terminated with HTTP status 413. The default limit is 1 MiB.

Author
======

Timo J. Rinne <tri@iki.fi>


License
=======

MIT License
