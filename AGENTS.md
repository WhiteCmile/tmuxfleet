# Agent Instructions

These instructions apply to the entire `tmuxfleet` project.

## Documentation

- `README.md` is the source English document.
- `README.zh-CN.md` is the Simplified Chinese translation.
- When changing `README.md`, update `README.zh-CN.md` in the same change.
- When changing `README.zh-CN.md`, check whether the English README also needs
  the same content.
- Keep the language switch links at the top of both files:
  - `README.md` links to `README.zh-CN.md`.
  - `README.zh-CN.md` links to `README.md`.

## Project Notes

- The project intentionally has no npm runtime dependencies.
- Prefer Node.js built-in modules unless a dependency is clearly justified.
- tmux is the source of truth. Avoid adding separate session state unless it is
  only lightweight UI/configuration metadata.
- Browser-facing UI text lives in `src/views.js`.
- Hub dynamically reloads `src/views.js` on each page request, so UI-only
  changes usually do not need a Hub restart.
- Backend/API changes still require restarting the Hub/Node process or running
  with `node --watch`.

## GitHub Remote

- Use SSH for GitHub git operations in this repository. HTTPS fetch/push has
  repeatedly failed with GitHub HTTP/2 transport errors here.
- Prefer `git@github.com:WhiteCmile/tmuxfleet.git` when fetching or pushing.

## Verification

Run this after code changes:

```bash
npm run check
```
