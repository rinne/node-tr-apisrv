Changelog
=========

3.2.0
-----

### Changed behaviour

- `rejectDangerousPaths` also looks at percent-decoded path segments.
  `%2e%2e` and `%2e` are rejected like `..` and `.`, and so is a
  segment that decodes to something containing `/`, `\` or NUL
  (`..%2f..`), a raw `\`, or a malformed escape. Before, these
  reached the handlers, where a path parameter could then be `..` or
  `../../etc`.
- Upgrade requests go through the same check, before and after
  `pathRewrite`. Before, they were not checked at all.

3.1.0
-----

Tested on Node.js 18, 20, 22, 24 and 26.

### Changed behaviour

- `maxBodySize: 0` now allows only empty bodies, as documented.
  Before, 0 disabled the limit.

### Fixed

- A request rejected because of its body (413 too large, 400 longer
  than Content-Length) had its connection destroyed right after the
  response was queued, so clients could get a reset instead of the
  response (seen on Node 20 and 22). The response is now sent with
  `Connection: close` and the connection is closed only after it has
  been written. If an `errorCallback` takes over and never responds,
  the connection is closed after `bodyReadTimeoutMs`.
