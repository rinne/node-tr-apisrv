'use strict';

const http = require('http');
const https = require('https');
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

var ApiSrv = function(opts) {
	var proto = http;
	var srvOpts = {};
	if (! (opts && (typeof(opts) === 'object'))) {
		throw new Error('Bad opts for ApiSrv constructor');
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
		throw new Error('Bad port for ApiSrv constructor');
	}
	if (typeof(opts.address) === 'string') {
		this.address = opts.address;
	} else if (opts.address) {
		throw new Error('Bad address for ApiSrv constructor');
	}
	if (typeof(opts.callback) === 'function') {
		this.callback = opts.callback;
	} else {
		throw new Error('Bad callback for ApiSrv constructor');
	}
	if ((opts.authCallback !== undefined) && (opts.authCallback !== null)) {
		if (typeof(opts.authCallback) === 'function') {
			this.authCallback = opts.authCallback;
		} else {
			throw new Error('Bad authCallback for ApiSrv constructor');
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
			throw new Error('Bad upgradeCallback for ApiSrv constructor');
		}
	} else {
		this.upgradeCallback = undefined
	}
	if ((opts.bodyReadTimeoutMs !== undefined) && (opts.bodyReadTimeoutMs !== null)) {
		if (Number.isSafeInteger(opts.bodyReadTimeoutMs) && (opts.bodyReadTimeoutMs > 0)) {
			this.bodyReadTimeoutMs = opts.bodyReadTimeoutMs;
		} else {
			throw new Error('Bad bodyReadTimeoutMs for ApiSrv constructor');
		}
	} else {
		this.bodyReadTimeoutMs = 2 * 1000;
	}
	if ((opts.maxBodySize !== undefined) && (opts.maxBodySize !== null)) {
		if (Number.isSafeInteger(opts.maxBodySize) && (opts.maxBodySize >= 0)) {
			this.maxBodySize = opts.maxBodySize;
		} else {
			throw new Error('Bad maxBodySize for ApiSrv constructor');
		}
	} else {
		this.maxBodySize = 1024 * 1024;
	}
	srvOpts.headersTimeout = this.bodyReadTimeoutMs;
	srvOpts.requestTimeout = this.bodyReadTimeoutMs + 1;

	var upgradeCb = function(req, s, head) {
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
		return (Promise.resolve(this.authCallback(r))
				.then(function(ret) {
                                        if (ret) {
                                                r.head = head;
                                                r.s = s;
                                                return opts.upgradeCallback(r);
                                        } else {
                                                s.destroy();
                                                s = undefined;
                                               return false;
                                       }
                               }.bind(this))
                               .then(function(ret) {
                                       if (ret) {
                                               if (this.debug) {
                                                       console.log('Upgrade successfully processed (resource :' + r.url + ').');
                                               }
                                       }
                                       return ret;
                               }.bind(this))
                               .catch(function(e) {
					if (s) {
						try {
							s.destroy();
							s = undefined;
						} catch(ignored) {
							s = undefined;
						}
						return false;
					}
				}.bind(this)));
	}.bind(this);
	var requestCb = function(req, res) {
		var completed = false, body = Buffer.alloc(0), r = {}, timeout, bodySize = 0;
		var contentType, contentTypeArgs;
		var dataCb = function(data) {
			if (completed) {
				return;
			}
			bodySize += data.length;
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
		var endCb = function() {
			if (completed) {
				return;
			}
			completed = true;
			if (timeout) {
				clearTimeout(timeout);
				timeout = undefined;
			}
			if (req.headers['content-type']) {
				let m = req.headers['content-type'].match(/^\s*([^\s;]+)\s*(|;\s*(|.*[^\s]))\s*$/);
				if (m) {
					contentType = m[1];
					contentTypeArgs = (m[3] && m[3] !== '') ? m[3] : undefined;
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
                                        if (contentTypeArgs && (contentTypeArgs.toLowerCase() !== 'charset=utf-8')) {
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
			return (Promise.resolve(this.authCallback(r))
					.then(function(ret) {
						if (ret) {
							return this.callback(r);
						} else if (this.debug) {
							console.log('Authentication failed (resource :' + r.url + ').');
						}
						return false;
					}.bind(this))
					.then(function(ret) {
						if (ret !== false) {
							if (this.debug) {
								console.log('Request successfully processed (resource :' + r.url + ').');
							}
						}
					}.bind(this))
					.catch(function(e) {
						if (this.debug) {
							console.log(e);
						}
						try {
							error(res, 500, 'Request handler fails to execute.');
						} catch(e) {
						}
					}.bind(this)));
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
			res.writeHead(code, { 'Content-Type': 'text/plain' });
			res.write(text);
			res.write("\n");
		}
		res.end();
	}.bind(this);
	this.server = proto.createServer(srvOpts, requestCb);
	if (this.upgradeCallback) {
		this.server.on('upgrade', upgradeCb);
	}
        this.server.on('error', function(e) {
                console.log('Unable to start HTTP server');
                process.exit(1);
        });
        this.server.headersTimeout = this.bodyReadTimeoutMs;
        this.server.requestTimeout = this.bodyReadTimeoutMs + 1;
        this.server.listen(this.port, this.address);
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
