# OpenClaw Integration Notes

`openclaw-context-optimizer` is most useful in OpenClaw as a **local pre-read reducer**, not as a replacement for native tools.

## Where it fits

OpenClaw already has strong primitives:
- `read` for exact targeted file reads
- `exec` for shell-level triage and rewriting workflows
- skills/wrappers for larger coding tasks

`context-optimizer` fits **between raw shell discovery and expensive deep reading**.

## Installing the OpenClaw plugin

1. Copy **the files inside** this package’s `openclaw/` directory into an extension folder, e.g.  
   `~/.openclaw/extensions/openclaw-context-optimizer/`  
   so **`index.js`** and **`openclaw.plugin.json`** sit next to each other (same layout as other extensions such as `rtk-rewrite`).
2. Register it in `~/.openclaw/openclaw.json` under `plugins.entries`, for example:

```json
"openclaw-context-optimizer": {
  "enabled": true,
  "config": {
    "enabled": true,
    "verbose": false,
    "defaultPreset": "agent",
    "maxFileBytes": 2097152
  }
}
```

By default the plugin only loads configuration and optionally logs bootstrap lines when `verbose` is true.

**Opt-in:** set `suggestOnLargeRead: true` to register a narrow `before_tool_call` hook: for configured read-like tools (default tool name `read`), if the resolved path is a file **≥ `maxFileBytes`**, the plugin logs a one-line **`advise`** summary (action + suggested reducer/preset). No tool calls are rewritten. Use **`matchers`** / **`extensions`** to limit noise.

Use the **CLI** or **`require()`** the library for real reductions. Agent workflow is also described in [SKILL.md](./SKILL.md). See [RTK coexistence](../docs/RTK_COMPAT.md).

## Rule of thumb

### Use raw `read` when
- the file is already small
- you know the exact lines/section you need
- correctness requires verbatim content
- you're about to patch code and need exact syntax

### Use reducers when
- the file/log/JSON/tree is large or noisy
- you need a first-pass triage view
- you want anomalies, structure, duplicates, or project hints first
- you're deciding whether a deeper `read` is worth spending context on

### Use RTK/shell rewriting when
- the waste is in the **command output stream**, not the file itself
- you need shell orchestration, grep/head/tail/jq pipelines, or repo-wide command shaping
- you want a wrapper that rewrites or bounds a terminal command before it reaches the model

## Recommended OpenClaw flow

1. `smart-tree --preset=triage <repo>` for a bounded project view
2. `smart-read --preset=agent README.md` or config/docs files
3. `smart-log --preset=aggressive app.log` for noisy logs
4. Fall back to `read` only on the most relevant files/regions

## Presets in practice

- `triage`: cheapest first pass for repo/project inspection
- `agent`: balanced default for everyday OpenClaw work
- `aggressive`: shortest summaries when context is tight
- `schema`: more structure budget for JSON/config inspection

## Programmatic wrapper

`openclaw/plugin-example.js` exports `reduceForOpenClaw(command, target, preset)` which calls the **library** by default (no subprocess, no `execFileSync` buffer cap). Set `CONTEXT_OPTIMIZER_USE_CLI=1` when running the example CLI to force a subprocess with `maxBuffer` 16 MiB (adjust in source if needed).

## Why this is OpenClaw-first

The toolkit does not assume a generic multi-provider prompt bus. It assumes an agent with:
- local file access
- shell access
- explicit read tools
- iterative repo triage needs

That is much closer to OpenClaw than to “paste huge blobs into any LLM chat”.
