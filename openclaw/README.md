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
   so **`index.js`**, **`suggest.js`**, and **`openclaw.plugin.json`** sit together (same layout as other extensions such as `rtk-rewrite`).
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

**Opt-in:** set `suggestOnLargeRead: true` for a narrow `before_tool_call` hook. For read-like tools (default `read`), files **≥ `maxFileBytes`** trigger **`emitLargeReadSuggestion`**: structured object (**`schemaVersion` `0.9.0`**, same fields as **`advise`** incl. **`confidenceScore`**, **`worthReadingExactlyReasons`**), optional **`onSuggestion(suggestion, { toolName, params })`** when the plugin is registered **in code** (not from JSON), and **`renderSuggestionLogLine`** unless **`logSuggestions: false`** or **`silent: true`**. No tool rewriting. **`matchers`**: path substring; **`extensions`**: allowlist when set. **`suggestDryRunVerbose: true`**: logs a JSON **`traceLargeReadSuggestion`** line on each candidate read (filter gate + advise summary). Use **`require('./suggest')`** for **`buildLargeReadSuggestion`**, **`traceLargeReadSuggestion`**, **`emitLargeReadSuggestion`** without the hook.

### Example: `onSuggestion` (register plugin in JS)

Use the callback to record metrics, enqueue a follow-up tool, or surface UI — do not assume `console` is the right sink:

```javascript
const { buildLargeReadSuggestion, emitLargeReadSuggestion } = require('./suggest');

const pluginConfig = {
  suggestOnLargeRead: true,
  maxFileBytes: 2 * 1024 * 1024,
  logSuggestions: false,
  onSuggestion(suggestion, eventMeta) {
    // suggestion.action, suggestion.recommendedCli, suggestion.worthReadingExactlyReasons, …
    // eventMeta.toolName, eventMeta.params (original read call)
    myTelemetry.emit('large_read_hint', { path: suggestion.path, action: suggestion.action });
  },
};

const s = buildLargeReadSuggestion('/abs/huge.log', 9_000_000, pluginConfig);
emitLargeReadSuggestion(pluginConfig, s, { toolName: 'read', params: { path: '/abs/huge.log' } });
```

**Matchers:** plain substring still works. Patterns with `*` use a light glob: `**/*.log` matches any path ending in `.log`; `**/dist/` matches paths containing `dist/`. For full control, combine with **`extensions`**.

**Agent hint string:** `formatSuggestionForAgent(suggestion)` returns a short multi-line block (action, CLI, why, read-exactly reasons) suitable for injecting into a side channel or transcript comment.

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
