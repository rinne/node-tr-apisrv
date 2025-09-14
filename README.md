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
