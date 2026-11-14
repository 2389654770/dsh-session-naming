# Changelog

## 0.1.0 — 2026-11-14

First release.

- `session_title` tool: read the current session's name, or rename it through
  `ctx.sessionTitle.rename()`. Repeated identical titles write no event; blank
  input is read mode; the session is resolved from `exec.agent.session` only.
- Proactive-naming prompt section (`session-namer:auto-rename`, order 4550):
  static text with note-workspace defaults (`prefix`, `maxChars`, `language`,
  `customRule`).
- `sessionTitle` is a soft dependency: without the service the tool reports a
  clear error instead of blocking activation.
- Zero dependencies, zero build; `scripts/check.mjs` validates the bundle and
  runs in CI.
