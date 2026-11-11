# API Server

`tr-apisrv` is a lightweight JSON-oriented HTTP(S) server that focuses on fast
configuration and predictable request handling rules. It supports declarative
handler registration, request parameter validation, and pluggable
authentication, making it easy to bootstrap small services or mock APIs.

Requires **Node.js 18 or newer**.

## Installation

```bash
npm install tr-apisrv
```

## Quick start

```javascript
const ApiSrv = require('tr-apisrv');

async function authenticate(request) {
  // return false to reject the request
  return request.headers.authorization === 'Bearer secret-token';
}

async function listUsers(request) {
  // Access individual parameter sources or the merged view
  return request.jsonResponse({
    params: request.params,
    path: request.pathParams,
    query: request.urlParams,
    body: request.bodyParams
  });
}

async function fallback(request) {
  return request.jsonResponse({ message: 'Fallback handler invoked' });
}

const server = new ApiSrv({
  port: 8808,
  address: '127.0.0.1',
  authCallback: authenticate,
  callback: fallback,
  requestHandlers: {
    GET: {
      '/users': listUsers,
      '/users/{userId}': listUsers,
      '/files/[path]': {
        callback: listUsers,
        options: {
          paramsValidator: (params) => ({ ...params, validated: true })
        }
      }
    }
  }
});
```

Requests are matched against `requestHandlers` first. When no handler matches,
the optional top-level `callback` is used as a fallback. If neither resolves the
request, `tr-apisrv` returns a canonical JSON error such as
`{"code":404,"message":"Not Found"}`.

## Configuration reference

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `port` | number | **required** | TCP port to listen on (1–65535). |
| `address` | string | `undefined` | Local address to bind. Leave undefined to listen on all interfaces. |
| `key` / `cert` | string &#124; Buffer | `undefined` | Provide both to enable HTTPS. Supplying only one throws an error. |
| `callback` | function | `undefined` | Fallback handler when no `requestHandlers` entry matches. |
| `requestHandlers` | object | `undefined` | Declarative handler map, keyed by HTTP method. Details below. |
| `authCallback` | function | `() => true` | Runs before any parameters are parsed. Return truthy to continue; falsy lets you reject (e.g. send 401). Parameter fields are `undefined` during this callback. |
| `upgradeCallback` | function | `undefined` | Optional `upgrade` (e.g. WebSocket) handler invoked after authentication. |
| `prettyPrintJsonResponses` | boolean | `false` | When true, `jsonResponse` pretty-prints JSON with trailing newline. |
| `rejectDangerousPaths` | boolean | `true` | Reject paths containing empty, `.` or `..` segments with HTTP 400. |
| `bodyReadTimeoutMs` | number | `2000` | Milliseconds allowed to fully read the request body. Applies to upgrade as well. |
| `maxBodySize` | number | `1048576` | Maximum allowed request body size in bytes. `0` allows only empty bodies. |
| `errorCallback` | function | `undefined` | Called for every error response the server generates itself, so that the application can send its own. See [Custom error responses](#custom-error-responses). |
| `pathRewrite` | function | `undefined` | `(path) => path`, applied to the request path before handlers are matched. See [Path rewriting](#path-rewriting). |
| `requireObjectBody` | boolean | `false` | When true, a JSON body that is an array is rejected with HTTP 400. |
| `rejectDangerousParamNames` | boolean | `false` | When true, a request whose body or query string has a key named `__proto__`, `constructor` or `prototype`, at any depth, is rejected with HTTP 400. |
| `debug` | boolean | `false` | Enables verbose logging for authentication failures and handler completion. |

The server accepts only `GET`, `POST`, `PUT`, and `DELETE` requests. Other
methods receive `405 Method Not Allowed`.

## Request handler definitions

Each HTTP method in `requestHandlers` maps path templates to either a callback
function or an object of the shape `{ callback, options }`. Callbacks receive the
request wrapper described in [Request object](#request-object).

### Resolution order

1. Match the request method and path against `requestHandlers`.
2. If no handler matches and a top-level `callback` exists, it handles the request.
3. When neither resolves the request, `tr-apisrv` returns a JSON error. A `405 Method Not Allowed`
   response is used when another method is registered for the same path; otherwise
   the response is `404 Not Found`.

### Path templates

Path templates determine which requests reach a handler and how parameters are
extracted. All templates must start with `/`.
Method keys in `requestHandlers` should be uppercase (`GET`, `POST`, `PUT`, `DELETE`).

* **Literal segments** – `/users/list` matches exactly that path.
* **Single-segment captures** – `{name}` captures one path component and makes it
  available as a string. Capture names must match the regular expression
  `/^[A-Za-z_][A-Za-z0-9_]*$/`. Example: `/users/{userId}` matches `/users/123`
  and sets `request.pathParams.userId === '123'`.
* **Multi-segment captures** – `[name]` captures one or more consecutive
  segments and exposes them as an array of strings. Names follow the same
  pattern restriction as `{name}`. Arrays match 1–32 segments by default, and
  you can provide explicit bounds with `[name:min]` (exact length) or
  `[name:min:max]` (inclusive range). Examples:
  * `/example/path/[MyArray]` matches 1 to 32 segments.
  * `/example/path/[MyArray:4]` matches exactly four segments.
  * `/example/path/[MyArray:2:12]` matches two to twelve segments.
  * `/example/path/[MyArray:10:50]` matches ten to fifty segments, allowing
    larger maxima than the default. The upper bound is always finite—either the
    default 32 or the explicit maximum you declare.
* Captures can be combined with literals, e.g. `/{cmd}/[args]/{tail}`. When
  combined, `[args]` consumes all necessary segments so the remaining template
  still matches.

Trailing slashes are significant only when they appear in the template:

* `/users/` matches `/users/` but not `/users`.
* `/users` matches both `/users` and `/users/`.

All captured values are URL-decoded. If decoding fails, the request is rejected
with HTTP 400.

### Handler options

`options` fine-tune validation and query-string handling. Every option is
optional; validators may be synchronous or asynchronous and must return the
processed object. Throwing from a validator results in `400 Bad Request`. Returning
anything other than an object causes a `500` response noting the validator must
return an object.

| Option | Description |
| --- | --- |
| `pathParamsValidator` | Validates and can transform `request.pathParams`. |
| `urlParamsValidator` | Validates and can transform `request.urlParams`. Not called when `ignoreUrlParams` is `true`. |
| `bodyParamsValidator` | Validates and can transform `request.bodyParams`. |
| `paramsValidator` | Validates the merged `request.params` object. |
| `ignoreUrlParams` | When `true`, the query string is ignored and `request.urlParams` is left `undefined`. |
| `authCallback` | Authentication for this handler only. Runs after the server's `authCallback` has accepted the request and, like it, before any parameters are parsed. Return truthy to continue; when returning falsy, send the response yourself. |
| `meta` | Any value you want to attach to the handler, for example a name or the scopes it needs. Available as `request.handler.meta` and from `requestHandlerList()`. |

#### Validator example

```javascript
server.requestHandleAdd('GET', '/reports/{id}', fetchReport, {
  pathParamsValidator: (params) => ({ id: Number(params.id) }),
  urlParamsValidator: async (query) => ({ ...query, limit: Number(query.limit ?? 10) }),
  paramsValidator: (params) => ({ ...params, filtered: true })
});
```

Validators can perform type coercion or enforce business rules before the
handler runs. Throwing inside any validator (including asynchronous ones)
returns `400 Bad Request` with the error message appended in parentheses.

Use `ignoreUrlParams` to opt out of query-string parsing entirely:

```javascript
server.requestHandleAdd('POST', '/import', importHandler, {
  ignoreUrlParams: true,
  bodyParamsValidator: validateImportPayload
});
```

You can supply the same `options` when adding handlers at runtime with
`requestHandleAdd(method, path, callback, options)`.

#### Per-handler authentication and metadata

```javascript
server.requestHandleAdd('POST', '/admin/users', createUser, {
  meta: { name: 'create-user', scope: 'admin' },
  authCallback: async (request) => {
    if (await tokenHasScope(request.headers.authorization, request.handler.meta.scope)) {
      return true;
    }
    request.jsonResponse({ code: 403, message: 'Forbidden' }, 403);
    return false;
  }
});
```

`request.handler` is `{ method, path, meta }` for a request matched by
`requestHandlers`, where `path` is the template that matched. It is
`undefined` when the fallback `callback` serves the request.

### Runtime updates

Handlers may be added, replaced, or removed without restarting the process:

```javascript
server.requestHandleAdd('GET', '/status', statusHandler);
server.requestHandleAdd('POST', '/status', statusHandler, {
  bodyParamsValidator: (body) => ({ ...body, updatedAt: Date.now() })
});

// Remove a single method
server.requestHandleDelete('POST', '/status');

// Remove all methods for a path
server.requestHandleDelete('*', '/status');
```

`requestHandlerList()` returns the registered handlers as
`{ method, path, meta }` objects, which is useful for generating
documentation or checking that every route has what it needs:

```javascript
for (const { method, path, meta } of server.requestHandlerList()) {
  console.log(method, path, meta);
}
```

## Request object

Handlers receive an object that wraps the underlying `http.IncomingMessage` and
`http.ServerResponse`.

| Property | Description |
| --- | --- |
| `method` | Uppercase HTTP method. |
| `url` | Request path without the query string, after `pathRewrite` when one is configured. |
| `originalUrl` | Request path without the query string, as received. |
| `handler` | `{ method, path, meta }` of the matched `requestHandlers` entry, or `undefined` for the fallback `callback`. |
| `requestPayloadBuffer` | The request body as received, as a `Buffer`. |
| `req` | The raw `http.IncomingMessage`. |
| `res` | The raw `http.ServerResponse`. |
| `headers` | Request headers as received. |
| `jsonResponse(data, statusCode?, excludeNoCacheHeaders?)` | Serializes JSON responses and sets default no-cache headers unless `excludeNoCacheHeaders` is `true`. |
| `errorResponse(statusCode, detail?)` | Sends a JSON error using canonical HTTP status text. For `400 Bad Request`, the optional detail is appended in parentheses. |
| `params` | Merged view of all parameters (body < query < path precedence). |
| `pathParams` | Parameters parsed from the matched path template. |
| `urlParams` | Parsed query parameters (unless suppressed). Arrays are preserved when the query repeats a key. |
| `bodyParams` | Parsed request body, when provided. |

During `authCallback`, the server has not parsed any parameters. At that point
`request.params`, `request.pathParams`, `request.urlParams`, and
`request.bodyParams` are all `undefined`. They are populated only after
authentication succeeds and before the handler runs.

All parameter collections are plain objects (or arrays for multi-segment
captures). Parameters are merged in the following order: body → query string →
path. Later sources override earlier ones in `request.params`. When this occurs,
`tr-apisrv` logs a warning naming both sources.

## Body parsing and limits

* `POST` and `PUT` bodies must use `application/json` or
  `application/x-www-form-urlencoded`. Other types result in
  `400 Bad Request (POST or PUT body must be in JSON or www-form-urlencoded format.)`.
* `GET` and `DELETE` requests must not include a body.
* Bodies larger than `maxBodySize` yield `413 Payload Too Large`.
* Slow clients that exceed `bodyReadTimeoutMs` cause `408 Request Timeout`.

## Path rewriting

`pathRewrite` receives the request path (without the query string) and returns
the path to use for matching handlers. Return `undefined` to keep the path as
it is. It is the place to strip a deployment prefix, so that one handler table
serves the same routes under several mount points:

```javascript
const server = new ApiSrv({
  port: 8808,
  // /api/v1/users, /v1/users and /users all reach the '/users' handler
  pathRewrite: (path) => path.replace(/^\/(api\/)?(v1\/)?/, '/'),
  requestHandlers: { GET: { '/users': listUsers } }
});
```

The function must be synchronous and must return a string that starts with
`/`; anything else, or a thrown error, results in HTTP 500. The dangerous path
check applies both to the path as received and to the rewritten one.
`request.url` holds the rewritten path and `request.originalUrl` the original.
Upgrade requests are rewritten in the same way.

## Authentication and upgrades

Before a handler runs, `authCallback` is awaited with the request object. During
this phase the parameter properties remain `undefined`; they are parsed only
after authentication succeeds. Returning a falsy value lets you send your own
response (for example, `401 Unauthorized`) and skips the handler. The callback
can still mutate the request object, such as attaching user information for the
handler to consume.

When `upgradeCallback` is provided, upgrade requests (e.g. WebSocket handshakes)
follow the same sequence: authentication runs first with the parameter
properties unset. Once the callback allows the upgrade, query parameters are
parsed and provided alongside `req`, `s`, and `head` before invoking the upgrade
handler.

## Error handling

Errors generated by `tr-apisrv` itself always use JSON with canonical HTTP
status text in the `message` property, for example:

```json
{ "code": 404, "message": "Not Found" }
```

Additional context is appended in parentheses for 400-series validation errors,
matching the format `"Bad Request (detailed reason)"`.

### Custom error responses

Set `errorCallback` to answer these errors in your own format. It is called
with one object for every error response that `tr-apisrv` generates itself:

| Property | Description |
| --- | --- |
| `code` | The HTTP status the server would answer with. |
| `message` | The message of the default response, e.g. `Bad Request (detailed reason)`. |
| `detail` | The detail alone, when there is one. |
| `source` | What produced the error: `request` (malformed request, dangerous path, unsupported method), `limit` (body too large, read timeout), `parser` (unparsable or unacceptable body or parameters), `validator` (a parameter validator threw or returned a non-object), `router` (no handler: 404 or 405, or a failing `pathRewrite`), `handler` (the handler threw). |
| `stage` | For `validator`: which validator, e.g. `request parameters`. |
| `cause` | For `validator` and `handler`: the error that was thrown. A validator can attach anything to it, such as a list of problems. |
| `req`, `res` | The raw request and response. |
| `request` | The request wrapper. Depending on how far the request got, some of its properties are not set yet. |

Send the response and return a truthy value. Return a falsy value to let the
server send its default response; it does that too when the callback throws
or leaves the response unsent.

```javascript
const server = new ApiSrv({
  port: 8808,
  errorCallback: (error) => {
    const body = { status: 'error', code: error.code, message: error.message };
    if (error.source === 'validator' && error.cause && error.cause.problems) {
      body.problems = error.cause.problems;
    }
    error.res.writeHead(error.code, { 'Content-Type': 'application/json; charset=utf-8' });
    error.res.end(JSON.stringify(body));
    return true;
  },
  requestHandlers: {
    POST: {
      '/items': {
        callback: createItem,
        options: {
          paramsValidator: (params) => {
            const problems = checkItem(params);
            if (problems.length > 0) {
              const err = new Error('Invalid item');
              err.problems = problems;
              throw err;
            }
            return params;
          }
        }
      }
    }
  }
});
```

The callback may be asynchronous. For errors raised while the request is still
being read (`limit`, and some of `request`) the connection is closed right
after the error, so respond synchronously for those. Responses that a handler
sends with `request.errorResponse()` or `request.jsonResponse()` do not go
through the callback.

Handlers remain free to craft any response, including non-JSON payloads, by using
`request.res` directly. The convenience method `jsonResponse` is suitable for
most use cases:

```javascript
async function ping(request) {
  return request.jsonResponse({ ok: true });
}
```

## Safety features

When `rejectDangerousPaths` is `true` (the default), the server rejects paths
containing empty segments (`//`) or dot segments (`/.`, `/..`) before running
authentication or handlers. Disable the check only when you know that upstream
routing has already sanitized paths:

```javascript
const srv = new ApiSrv({
  port: 8808,
  rejectDangerousPaths: false,
  callback: handler
});
```

### Parameter names

A parameter named `__proto__` is an ordinary own property of
`request.params`; it never replaces the prototype of the object. A JSON body
can nevertheless carry keys such as `__proto__` or `constructor` at any depth,
and code that later copies such objects with `Object.assign` or a recursive
merge can be tricked by them. If your API has no use for those names, reject
them outright:

```javascript
const srv = new ApiSrv({
  port: 8808,
  rejectDangerousParamNames: true,   // 400 for __proto__, constructor, prototype keys
  requireObjectBody: true,           // 400 for a JSON array as the body
  callback: handler
});
```

Without `requireObjectBody`, the items of a JSON array body become the
parameters `"0"`, `"1"` and so on.

### Response headers

JSON responses, including errors, carry `X-Content-Type-Options: nosniff`.

## Changes in 3.0.0

Version 3.0.0 is backwards compatible with 2.1.0: every existing option,
method and default behaves as before. New:

* `errorCallback`, for answering server-generated errors in your own format.
* `pathRewrite`, and `request.originalUrl`.
* Handler options `authCallback` and `meta`, and `request.handler`.
* `requestHandlerList()`.
* `requireObjectBody` and `rejectDangerousParamNames`.

Fixes and hardening that apply without any configuration:

* A parameter named `__proto__` in a JSON body used to become the prototype of
  `request.params`, so that its contents appeared as parameters that were not
  own properties. It is now an own property like any other.
* `__proto__` is rejected as a path template parameter name.
* A request target that is not a path (for example an absolute URL, when
  `rejectDangerousPaths` is off) matched against `requestHandlers` used to
  end in HTTP 500. It now matches nothing: 404, or the fallback `callback`.
* JSON responses carry `X-Content-Type-Options: nosniff`.
* The request body is assembled once instead of being copied for every chunk
  received.

## License

MIT
