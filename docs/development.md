# Development

[中文](development.zh-CN.md) | [Back to README](../README.md)

## Project Notes

- `README.md` is the source English document. When it changes, update
  `README.zh-CN.md` in the same change.
- Browser-facing UI text lives in `src/views.js`.
- The Hub dynamically reloads `src/views.js` on each page request, so UI text
  and style changes usually need only a browser refresh.
- Backend/API changes require restarting the Hub/Node process or running with
  `node --watch`.
- The project intentionally has no npm runtime dependencies. Prefer Node.js
  built-in modules unless a dependency is clearly justified.

## Run With Watch

```bash
TMUXFLEET_HUB_TOKEN=test-token TMUXFLEET_NODE_TOKEN=test-token \
npm run dev:hub -- --host 127.0.0.1 --port 8090
```

## Verify

Check syntax and run tests:

```bash
npm run check
```
