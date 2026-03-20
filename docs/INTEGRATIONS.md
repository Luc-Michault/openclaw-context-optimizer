# Integrations

## OpenClaw

Project/package name: `openclaw-context-optimizer`

The intended OpenClaw flow is now:

```bash
context-optimizer advise .
context-optimizer smart-tree . --preset=triage
# then triageHints.triageGroups + readNext / readNextSecondary, then exact reads
```

For file artifacts:

```bash
context-optimizer advise app.log
context-optimizer smart-log app.log --preset=aggressive

context-optimizer advise package-lock.json
context-optimizer smart-json package-lock.json --preset=schema
```

Then use native OpenClaw `read` only on the files / sections that matter.

### Reducers vs raw reads vs shell rewriting

- **Reducer**: when the artifact is too noisy to inspect raw
- **Raw read**: when exact content matters or the file is already small
- **Shell rewriting / RTK**: when command output, grep pipelines, or repo-wide shell flow needs shaping before the model sees it

## Policy / `advise`

```bash
context-optimizer advise ./path/to/file-or-dir
context-optimizer advise big.log --urgency=tight
context-optimizer advise ./some-output.txt --command-hint=exec
```

`advise` emits a decision object including:
- `action` (`raw-read` | `reduce` | `rtk-shell`)
- `confidence` + **`confidenceScore`** (numeric; label includes **very-high** at repo-root `smart-tree`)
- `why[]`
- `recommendedCli` / `recommendedCommand`
- `nextStepIfInsufficient`
- **`repoContext`** (markers, stacks, **inferences**), **`pathRoles`**, **`alternatives[]`**, **`worthReadingExactly`**

Use `require('openclaw-context-optimizer/policy')` (or the main package re-exports) to apply the same logic programmatically.

## OpenClaw plugin

See `openclaw/README.md` for install details.

Current plugin behavior:
- passive registration by default
- opt-in `suggestOnLargeRead`
- can filter on `readToolNames`, `extensions`, `matchers`
- **`require('./openclaw/suggest')`** — `buildLargeReadSuggestion`, `renderSuggestionLogLine`, `emitLargeReadSuggestion`; optional **`onSuggestion`** on the config object when the plugin is registered programmatically (not from JSON); `logSuggestions: false` skips `console.warn`
- does **not** rewrite tool calls automatically

### Example helper stub

`openclaw/plugin-example.js` is a small integration seam for local experiments. It demonstrates reducer access from OpenClaw-shaped code without committing to aggressive runtime behavior.

## Metrics

```bash
export CONTEXT_OPTIMIZER_METRICS=1
context-optimizer smart-log ./big.log --preset=agent --json
context-optimizer metrics
context-optimizer metrics --json
# JSON aggregate includes tuningHints + qualityHints
```

Optional:
- `CONTEXT_OPTIMIZER_METRICS_DIR=/path/to/dir` to store `metrics.jsonl` elsewhere
- `CONTEXT_OPTIMIZER_METRICS_SAFE=1` to avoid writing full `cwd` and to truncate error text
- `CONTEXT_OPTIMIZER_WORKFLOW_TAG=my-flow` to group runs by workflow

For agent scripts that pass `--preset` from an LLM, add `--strict-preset` so unknown names fail loudly instead of falling back to `balanced`.

## Generic shell usage

```bash
context-optimizer smart-read README.md
context-optimizer smart-log app.log
context-optimizer smart-csv data.csv
context-optimizer smart-json package.json
context-optimizer smart-tree src
```

## RTK

See [RTK_COMPAT.md](./RTK_COMPAT.md) for how this toolkit relates to RTK-wrapped `exec`.
