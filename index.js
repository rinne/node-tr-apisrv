'use strict';

const http = require('http');
const https = require('https');

const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);
const HTTP_STATUS_MESSAGES = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    405: 'Method Not Allowed',
    406: 'Not Acceptable',
    408: 'Request Timeout',
    409: 'Conflict',
    413: 'Payload Too Large',
    415: 'Unsupported Media Type',
    429: 'Too Many Requests',
    500: 'Internal Server Error',
    501: 'Not Implemented',
    503: 'Service Unavailable'
};
function parseQuery(str) {
    const params = Object.create(null);
    if (!str) {
        return params;
    }
    const usp = new URLSearchParams(str.replace(/\+/g, '%20'));
    for (const [key, value] of usp.entries()) {
        if (Object.prototype.hasOwnProperty.call(params, key)) {
            const cur = params[key];
            if (Array.isArray(cur)) {
                cur.push(value);
            } else {
                params[key] = [cur, value];
            }
        } else {
            params[key] = value;
        }
    }
    return params;
}

function parseContentType(str) {
    const parts = str.split(';').map(p => p.trim()).filter(p => p !== '');
    if (parts.length === 0) {
        return null;
    }
    const type = parts.shift().toLowerCase();
    const params = Object.create(null);
    for (const part of parts) {
        const m = part.match(/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=((?:"(?:[^"\\]|\\.)*"|[^\s;]+))$/);
        if (!m) {
            return null;
        }
        let val = m[2];
        if (val.startsWith('"')) {
            val = val.slice(1, -1);
        }
        params[m[1].toLowerCase()] = val.toLowerCase();
    }
    return { type, params };
}

function isPlainObject(value) {
    return !!value && (typeof value === 'object') && !Array.isArray(value);
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePathTemplate(path) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
        throw new Error(`Bad request handler path: ${path}`);
    }
    if (path === '/') {
        return { isExact: true, template: path, regex: /^\/$/ };
    }
    const parts = path.split('/').slice(1); // skip leading empty string
    let regex = '^';
    let hasParams = false;
    for (const part of parts) {
        regex += '/';
        if (part === '') {
            // trailing slash
            continue;
        }
        const paramMatch = part.match(/^\{([A-Za-z0-9_]+)\}$/);
        if (paramMatch) {
            hasParams = true;
            regex += '([^/]+)';
        } else {
            regex += escapeRegex(part);
        }
    }
    regex += '$';
    return { isExact: !hasParams, template: path, regex: new RegExp(regex) };
}

function normalizeMethod(method) {
    if (typeof method !== 'string') {
        throw new Error(`Bad request handler method: ${method}`);
    }
    const upper = method.toUpperCase();
    if (!SUPPORTED_METHODS.has(upper)) {
        throw new Error(`Unsupported request handler method: ${method}`);
    }
    return upper;
}

function getMethodStore(map, method, createIfMissing) {
    let store = map.get(method);
    if (!store && createIfMissing) {
        store = { exact: new Map(), dynamic: new Map() };
        map.set(method, store);
    }
    return store;
}

function removeFromStore(store, path) {
    let removed = false;
    if (store.exact.delete(path)) {
        removed = true;
    }
    if (store.dynamic.delete(path)) {
        removed = true;
    }
    return removed;
}

function findMatchInStore(store, path) {
    if (!store) {
        return null;
    }
    const exact = store.exact.get(path);
    if (exact) {
        return exact;
    }
    for (const entry of store.dynamic.values()) {
        if (entry.regex.test(path)) {
            return entry;
        }
    }
    return null;
}

var ApiSrv = function(opts) {
    var proto = http;
    var srvOpts = {};
    if (!(opts && (typeof(opts) === 'object'))) {
        throw new Error(`Bad opts for ApiSrv constructor: ${opts}`);
    }
    if (opts.key && opts.cert) {
        srvOpts.key = opts.key;
        srvOpts.cert = opts.cert;
        proto = https;
    } else if (opts.key) {
        throw new Error('Key defined without cert');
    } else if (opts.cert) {
        throw new Error('Cert defined without key');
    }
    this.debug = opts.debug ? true : false;
    this.prettyPrintJsonResponses = opts.prettyPrintJsonResponses ? true : false;
    if (Number.isSafeInteger(opts.port) && (opts.port > 0) && (opts.port < 65536)) {
        this.port = opts.port;
    } else {
        throw new Error(`Bad port for ApiSrv constructor: ${opts.port}`);
    }
    if (typeof(opts.address) === 'string') {
        this.address = opts.address;
    } else if (opts.address) {
        throw new Error(`Bad address for ApiSrv constructor: ${opts.address}`);
    }
    if (opts.callback !== undefined) {
        if (typeof(opts.callback) === 'function') {
            this.callback = opts.callback;
        } else {
            throw new Error(`Bad callback for ApiSrv constructor: ${opts.callback}`);
        }
    } else {
        this.callback = undefined;
    }
    this._requestHandlers = new Map();
    if (opts.requestHandlers !== undefined) {
        if (!isPlainObject(opts.requestHandlers)) {
            throw new Error('requestHandlers must be an object.');
        }
        for (const [method, handlers] of Object.entries(opts.requestHandlers)) {
            if (!isPlainObject(handlers)) {
                throw new Error(`Bad requestHandlers for method ${method}`);
            }
            for (const [path, handler] of Object.entries(handlers)) {
                this.requestHandleAdd(method, path, handler);
            }
        }
    }
    if ((opts.authCallback !== undefined) && (opts.authCallback !== null)) {
        if (typeof(opts.authCallback) === 'function') {
            this.authCallback = opts.authCallback;
        } else {
            throw new Error(`Bad authCallback for ApiSrv constructor: ${opts.authCallback}`);
        }
    } else {
        if (this.debug) {
            console.log('No authentication callback set.');
        }
        this.authCallback = function(r) { return true; }.bind(this);
    }
    if ((opts.upgradeCallback !== undefined) && (opts.upgradeCallback !== null)) {
        if (typeof(opts.upgradeCallback) === 'function') {
            this.upgradeCallback = opts.upgradeCallback;
        } else {
            throw new Error(`Bad upgradeCallback for ApiSrv constructor: ${opts.upgradeCallback}`);
        }
    } else {
        this.upgradeCallback = undefined
    }
    if ((opts.bodyReadTimeoutMs !== undefined) && (opts.bodyReadTimeoutMs !== null)) {
        if (Number.isSafeInteger(opts.bodyReadTimeoutMs) && (opts.bodyReadTimeoutMs > 0)) {
            this.bodyReadTimeoutMs = opts.bodyReadTimeoutMs;
        } else {
            throw new Error(`Bad bodyReadTimeoutMs for ApiSrv constructor: ${opts.bodyReadTimeoutMs}`);
        }
    } else {
        this.bodyReadTimeoutMs = 2 * 1000;
    }
    if ((opts.maxBodySize !== undefined) && (opts.maxBodySize !== null)) {
        if (Number.isSafeInteger(opts.maxBodySize) && (opts.maxBodySize >= 0)) {
            this.maxBodySize = opts.maxBodySize;
        } else {
            throw new Error(`Bad maxBodySize for ApiSrv constructor: ${opts.maxBodySize}`);
        }
    } else {
        this.maxBodySize = 1024 * 1024;
    }
    srvOpts.headersTimeout = this.bodyReadTimeoutMs;
    srvOpts.requestTimeout = this.bodyReadTimeoutMs + 1;

    var upgradeCb = async function(req, s, head) {
        var m, r = {};
        r.method = req.method;
        if (m = req.url.match(/^([^\?]*)\?(.*)$/)) {
            r.url = m[1];
            r.params = parseQuery(m[2].toString('utf8'));
        } else {
            r.url = req.url;
            r.params = {};
        }
        r.headers = req.headers;
        r.req = req;
        try {
            const ret = await this.authCallback(r);
            if (ret) {
                r.head = head;
                r.s = s;
                const cbRet = await opts.upgradeCallback(r);
                if (cbRet && this.debug) {
                    console.log('Upgrade successfully processed (resource :' + r.url + ').');
                }
                return cbRet;
            } else {
                s.destroy();
                s = undefined;
                return false;
            }
        } catch (e) {
            if (s) {
                try {
                    s.destroy();
                    s = undefined;
                } catch(ignored) {
                    s = undefined;
                }
            }
            return false;
        }
    }.bind(this);
    var requestCb = function(req, res) {
        var completed = false, body = Buffer.alloc(0), r = {}, timeout, bodySize = 0;
        var contentType, contentTypeArgs;
        var declaredContentLength;
        if (req.headers['transfer-encoding'] && req.headers['content-length']) {
            error(res, 400, 'Both Transfer-Encoding and Content-Length defined.');
            return;
        }
        if (req.headers['content-length']) {
            var cl = parseInt(req.headers['content-length'], 10);
            if (!Number.isSafeInteger(cl) || cl < 0) {
                error(res, 400, 'Bad Content-Length header.');
                return;
            }
            declaredContentLength = cl;
            if (this.maxBodySize && (cl > this.maxBodySize)) {
                error(res, 413, 'Request body too large.');
                try {
                    req.destroy();
                } catch (ignored) {
                }
                return;
            }
        }
        var dataCb = function(data) {
            if (completed) {
                return;
            }
            bodySize += data.length;
            if (declaredContentLength !== undefined && (bodySize > declaredContentLength)) {
                completed = true;
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = undefined;
                }
                error(res, 400, 'Request body longer than Content-Length.');
                try {
                    req.destroy();
                } catch (ignored) {
                }
                return;
            }
            if (this.maxBodySize && (bodySize > this.maxBodySize)) {
                completed = true;
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = undefined;
                }
                error(res, 413, 'Request body too large.');
                try {
                    req.destroy();
                } catch (ignored) {
                }
                return;
            }
            body = Buffer.concat( [ body, data ] );
        }.bind(this);
        var endCb = async function() {
            if (completed) {
                return;
            }
            completed = true;
            if (timeout) {
                clearTimeout(timeout);
                timeout = undefined;
            }
            if (declaredContentLength !== undefined && (body.length !== declaredContentLength)) {
                error(res, 400, 'Request body length does not match Content-Length.');
                return;
            }
            if (req.headers['content-type']) {
                let ct = parseContentType(req.headers['content-type']);
                if (ct) {
                    contentType = ct.type;
                    contentTypeArgs = ct.params;
                } else {
                    error(res, 400, 'Unable to parse content-type.');
                    return;
                }
            }
            switch (req.method) {
            case 'POST':
            case 'PUT':
                if (req.url.match(/\?/)) {
                    error(res, 400, 'URL for POST or PUT must not contain query parameters.');
                    return;
                }
                r.url = req.url;
                r.method = req.method;
                switch (contentType) {
                case 'application/x-www-form-urlencoded':
                case 'application/www-form-urlencoded':
                    r.params = parseQuery(body.toString('utf8'));
                    break;
                case 'application/json':
                    if (contentTypeArgs && contentTypeArgs.charset && (contentTypeArgs.charset !== 'utf-8')) {
                        error(res, 400, 'Bad charset for JSON content type.');
                        return;
                    }
                    try {
                        r.params = JSON.parse(body.toString('utf8'));
                    } catch(e) {
                        r.params = undefined;
                    }
                    if (! (r.params && (typeof(r.params) === 'object'))) {
                        error(res, 400, 'Unable to parse JSON query parameters.');
                        return;
                    }
                    break;
                case 'multipart/form-data':
                    // We know this, but only wankers would use it here.
                    // RFC6749 anyways says that application/x-www-form-urlencoded
                    // is the "correct" way to go.
                default:
                    error(res, 400, 'POST or PUT body must be in JSON or www-form-urlencoded format.');
                    return;
                }
                break;
            case 'GET':
            case 'DELETE':
                if (body.length > 0) {
                    error(res, 400, 'Empty body required for ' + req.method + ' requests.');
                    return;
                }
                var m;
                if (m = req.url.match(/^([^\?]*)\?(.*)$/)) {
                    r.url = m[1];
                    r.params = parseQuery(m[2].toString('utf8'));
                } else {
                    r.url = req.url;
                    r.params = {};
                }
                r.method = req.method;
                break;
            default:
                error(res, 405, 'Only GET, POST, PUT, and DELETE are allowed.');
                return;
            }
            r.headers = req.headers;
            r.res = res;
            r.jsonResponse = function(data, code, excludeNoCacheHeaders) {
                var headers = { 'Content-Type': 'application/json; charset=utf-8' };
                if (! excludeNoCacheHeaders) {
                    headers = Object.assign(headers,
                                            { 'Cache-Control': 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0',
                                              'Expires': 'Wed, 01 Jan 2020 12:00:00 GMT',
                                              'Pragma': 'no-cache' });
                }
                res.writeHead(code ? code : 200, headers);
                if (this.prettyPrintJsonResponses) {
                    res.write(JSON.stringify(data, null, 2));
                    res.write("\n");
                } else {
                    res.write(JSON.stringify(data));
                }
                res.end();
            }.bind(this);
            try {
                let handlerEntry = this._matchRequestHandler(r.method, r.url);
                let handler = handlerEntry ? handlerEntry.handler : undefined;
                if (!handler) {
                    if (this.callback) {
                        handler = this.callback;
                    } else {
                        const hasOtherMethod = this._hasHandlerForOtherMethod(r.method, r.url);
                        if (hasOtherMethod) {
                            jsonError(res, 405, 'Method Not Allowed');
                        } else {
                            jsonError(res, 404, 'Not Found');
                        }
                        return;
                    }
                }
                const auth = await this.authCallback(r);
                if (auth) {
                    const ret = await handler.call(this, r);
                    if (ret !== false && this.debug) {
                        console.log('Request successfully processed (resource :' + r.url + ').');
                    }
                } else if (this.debug) {
                    console.log('Authentication failed (resource :' + r.url + ').');
                }
            } catch (e) {
                if (this.debug) {
                    console.log(e);
                }
                try {
                    error(res, 500, 'Request handler fails to execute.');
                } catch(e) {
                }
            }
        }.bind(this);
        var errorCb = function() {
            if (completed) {
                return;
            }
            completed = true;
            if (timeout) {
                clearTimeout(timeout);
                timeout = undefined;
            }
            error(res, 400, 'Error occured while reading the request data.');
        }.bind(this);
        var timeoutCb = function() {
            if (completed) {
                return;
            }
            timeout = undefined;
            completed = true;
            error(res, 408, 'Timeout occured while reading the request data.');
        }.bind(this);
        timeout = setTimeout(timeoutCb, this.bodyReadTimeoutMs);
        req.on('data', dataCb);
        req.on('end', endCb);
        req.on('error', errorCb);
    }.bind(this);
    var error = function(res, code, text, RFC6749EC) {
        if (RFC6749EC) {
            // RFC6749 wants these errors to be code 400 except in case of 401
            res.writeHead((code != 401) ? 400 : 401,
                          { 'Content-Type': 'application/json; charset=utf-8' });
            res.write(JSON.stringify( { error: RFC6749EC,
                                        error_description: (text ?
                                                            (text +
                                                             ' (HTTP code ' +
                                                             code.toString() +
                                                             ')') :
                                                            ('HTTP code ' +
                                                             code.toString())) },
                                      null, 2));

            res.write("\n");
        } else {
            const canonical = HTTP_STATUS_MESSAGES[code] || 'Error';
            let detail = text ? text.trim() : '';
            if (detail) {
                detail = detail.replace(/\.+$/, '');
            }
            let message = canonical;
            if (code === 400 && detail) {
                message = `${canonical} (${detail})`;
            }
            res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
            res.write(JSON.stringify({ code, message }));
        }
        res.end();
    }.bind(this);
    var jsonError = function(res, code, message) {
        res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
        res.write(JSON.stringify({ message, code }));
        res.end();
    };
    this.server = proto.createServer(srvOpts, requestCb);
    if (this.upgradeCallback) {
        this.server.on('upgrade', upgradeCb);
    }
    this.server.on('error', (e) => {
        const addr = (this.address !== undefined) ? ` address: ${this.address}` : '';
        console.log(`Unable to start HTTP server (port: ${this.port}${addr})`);
        if (this.debug && e) {
            console.log(e);
        }
        process.exit(1);
    });
    this.server.headersTimeout = this.bodyReadTimeoutMs;
    this.server.requestTimeout = this.bodyReadTimeoutMs + 1;
    this.server.listen(this.port, this.address);
};

ApiSrv.prototype.requestHandleAdd = function(method, path, handler) {
    const normalizedMethod = normalizeMethod(method);
    if (typeof handler !== 'function') {
        throw new Error(`Bad request handler callback for ${normalizedMethod} ${path}`);
    }
    const compiled = compilePathTemplate(path);
    compiled.handler = handler;
    const store = getMethodStore(this._requestHandlers, normalizedMethod, true);
    if (compiled.isExact) {
        store.exact.set(compiled.template, compiled);
    } else {
        store.dynamic.set(compiled.template, compiled);
    }
};

ApiSrv.prototype.requestHandleDelete = function(method, path) {
    if (typeof path !== 'string' || !path.startsWith('/')) {
        throw new Error(`Bad request handler path: ${path}`);
    }
    if (method === '*') {
        let removed = false;
        for (const [key, store] of this._requestHandlers.entries()) {
            removed = removeFromStore(store, path) || removed;
            if ((store.exact.size === 0) && (store.dynamic.size === 0)) {
                this._requestHandlers.delete(key);
            }
        }
        return removed;
    }
    const normalizedMethod = normalizeMethod(method);
    const store = this._requestHandlers.get(normalizedMethod);
    if (!store) {
        return false;
    }
    const removed = removeFromStore(store, path);
    if ((store.exact.size === 0) && (store.dynamic.size === 0)) {
        this._requestHandlers.delete(normalizedMethod);
    }
    return removed;
};

ApiSrv.prototype._matchRequestHandler = function(method, path) {
    const store = this._requestHandlers.get(method.toUpperCase());
    if (!store) {
        return null;
    }
    return findMatchInStore(store, path);
};

ApiSrv.prototype._hasHandlerForOtherMethod = function(method, path) {
    const normalizedMethod = typeof method === 'string' ? method.toUpperCase() : method;
    for (const [key, store] of this._requestHandlers.entries()) {
        if (key === normalizedMethod) {
            continue;
        }
        if (findMatchInStore(store, path)) {
            return true;
        }
    }
    return false;
};

ApiSrv.prototype.close = function() {
    return new Promise((resolve, reject) => {
        this.server.close((err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

// Backward compatible shutdown helper
ApiSrv.prototype.shutdown = ApiSrv.prototype.close;

module.exports = ApiSrv;
