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
  available as a string. Example: `/users/{userId}` matches `/users/123` and sets
  `request.pathParams.userId === '123'`.
* **Multi-segment captures** – `[name]` captures one or more consecutive
  segments and exposes them as an array of strings. Example: `/files/[path]`
  matches `/files/a/b/c` and sets `request.pathParams.path === ['a','b','c']`.
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

## Request object

Handlers receive an object that wraps the underlying `http.IncomingMessage` and
`http.ServerResponse`.

| Property | Description |
| --- | --- |
| `method` | Uppercase HTTP method. |
| `url` | Request path without the query string. |
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

## License

MIT
