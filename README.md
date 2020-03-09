API Server
==========

This is a simple API server providing with ability to easily create
JSON API servers. Accepts also calls in www-form-urlencoded form
and treats them identically to flat JSON key-value structure.

```
const ApiSrv = require('tr-apisrv');

var srv = new ApiSrv({ port: 8808,
                       address: '127.0.0.1',
                       callback: cb,
                       authCallback: authCb,
                       prettyPrintJsonResponses: true,
                       bodyReadTimeoutMs: 5000,
                       debug: true });

async function authCb(r) {
    return true;
}

async function cb(r) {
    var res = r.res;
    delete r.res;
    r.jsonResponse(r, 200);
}
```

Author
======

Timo J. Rinne <tri@iki.fi>


License
=======

MIT License
