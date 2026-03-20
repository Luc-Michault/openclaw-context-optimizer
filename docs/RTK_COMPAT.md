# RTK and openclaw-context-optimizer

These tools **complement** each other; they do not solve the same problem.

## RTK (shell stream)

- **What it rewrites**: commands passed to **`exec`** (and similar shell paths), e.g. `git log`, `find`, `grep`, test runners.
- **Where it helps**: **stdout/stderr** from shell tools — shrink what the model sees *before* it leaves the terminal.
- **OpenClaw integration**: typically as an extension under `~/.openclaw/extensions/rtk-rewrite` with `plugins.entries.rtk-rewrite` in `openclaw.json`.

## openclaw-context-optimizer (local artifacts)

- **What it reduces**: **files and directories** already on disk — logs, CSV, JSON, trees, long text/docs.
- **Where it helps**: **read** / paste / agent context when the payload is a **path or stdin body**, not a live command stream.
- **Entry points**: `context-optimizer smart-*`, `context-optimizer advise`, or `require('openclaw-context-optimizer')` from a tool wrapper.

## Combined workflow (typical)

1. **Discover** with bounded `smart-tree --preset=triage` or shell + RTK.
2. **Triage large artifacts** with `smart-log` / `smart-json` / `smart-csv` / `smart-read`.
3. **Exact `read`** only on the small slice the reducer pointed to (lines, keys, paths).
4. Use **RTK-wrapped `exec`** when the signal is in **command output**, not in a single file.

## When to use which

| Situation | Prefer |
|-----------|--------|
| Huge `npm test` or `git log` output | RTK + exec |
| 50 MB `app.log` on disk | `smart-log` (this toolkit) |
| Repo layout, “where to look” | `smart-tree` + policy `advise` |
| Verbatim patch / small file | raw `read` |

## Anti-patterns

- Enabling OpenClaw plugin hooks expecting **automatic read rewriting** — the plugin only emits **optional** structured suggestions; RTK still owns exec streams.
- Expecting this package to **rewrite every exec** like RTK — out of scope.
- Piping RTK output into `smart-log` **instead of** using RTK’s own shaping — redundant; pick one layer per hop.
- Using reducers on **tiny** files when a targeted `read` is enough — see `context-optimizer advise <path>`.
