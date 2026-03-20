# OpenClaw Context Optimizer

A small open-source CLI for turning noisy local files into compact, deterministic, human-readable summaries.

> **OpenClaw-first, agent-first** (v0.6). Local reduction + **`advise`** policy before expensive `read`s. Not a generic “all LLMs everywhere” wrapper. Complements **RTK** on `exec` — see [docs/RTK_COMPAT.md](./docs/RTK_COMPAT.md). Agent workflow: **[openclaw/SKILL.md](./openclaw/SKILL.md)**.

## Why this exists

Large files are expensive to read in full, annoying to paste into chat, and often full of repetition. The goal is not perfect summarization. The goal is to preserve **decision-relevant context** while cutting obvious waste:

- repeated lines
- boilerplate
- oversized JSON structures
- long logs where a few anomalies matter most
- directory trees that are too large to inspect raw

## OpenClaw-first positioning

OpenClaw already has excellent primitives for exact reads and shell work. This toolkit is useful when an agent needs a **bounded first pass** before choosing where to look next.

- `read` is still better for small or exact files.
- RTK/shell rewriting is better when the command output itself needs reshaping.
- `context-optimizer` is best when a local artifact is too noisy to read raw.

See [`openclaw/README.md`](./openclaw/README.md) for plugin install (optional **`suggestOnLargeRead`** hook) and [`openclaw/SKILL.md`](./openclaw/SKILL.md) for the step-by-step agent method.

### Which tool when? (compact)

| You have… | First move |
|-----------|------------|
| Unknown repo folder | `advise` → `smart-tree --preset=triage` |
| Huge log | `advise` → `smart-log` (often `--preset=aggressive`) |
| Huge JSON / JSONL | `advise` → `smart-json` (often `--preset=schema`) |
| Huge CSV | `advise` → `smart-csv` |
| Small / exact snippet | Native **`read`** |
| **`exec` / shell output** | **RTK**, not file reducers |

## Commands

```bash
context-optimizer smart-read [options] <file>
context-optimizer smart-log [options] <file>
context-optimizer smart-csv [options] <file>
context-optimizer smart-json [options] <file>
context-optimizer smart-tree [options] <dir>
context-optimizer metrics [--clear] [--limit=N] [--json]
context-optimizer advise <file-or-dir> [--urgency=tight] [--command-hint=exec]
```

## Presets

Presets are agent-oriented budget bundles that tune the existing reducers without adding new complexity.

| Preset | Best for | Behavior |
|---|---|---|
| `agent` | everyday OpenClaw work | balanced detail with slightly deeper tree/JSON inspection |
| `triage` | first-pass repo inspection | cheaper output, quick project hints |
| `aggressive` | tight context budgets | more compact previews and shallower traversal |
| `schema` | JSON/config inspection | larger JSON shape budget, structure-first |
| `balanced` | default fallback | legacy-like defaults |

Use them with any reducer:

```bash
context-optimizer smart-tree . --preset=triage
context-optimizer smart-log app.log --preset=aggressive
context-optimizer smart-json package-lock.json --preset=schema
```

CLI flags like `--max-lines`, `--max-depth`, `--json-depth`, and `--budget` still override the preset.

## CLI options

| Flag | Effect |
|------|--------|
| `--json` | Print structured JSON (stable keys) instead of plain text |
| `--preset=NAME` | `balanced`, `agent`, `triage`, `aggressive`, `schema` |
| `--max-lines=N` | Preview lines, anomaly cap, pattern cap, CSV sample rows |
| `--max-depth=N` | Directory tree max depth |
| `--json-depth=N` | Max JSON walk depth for structure + anomalies |
| `--budget=N` | Coarse knob: tree entry cap + JSON node visit budget |
| `--stdin` | Read file body from stdin (requires `--label`) |
| `--label=NAME` | Override target name in output and metrics |
| `--tokens` | Append rough token estimates (~bytes/4) |
| `--metrics` | Append this run to `~/.context-optimizer/metrics.jsonl` |
| `--strict-preset` | Fail if `--preset` is not a known name (no silent fallback to `balanced`) |
| `--workflow-tag=TAG` | Stored on each metrics row (or `CONTEXT_OPTIMIZER_WORKFLOW_TAG`) |

For **`metrics`**, add `--json` to print `aggregateMetrics` + a recent tail (machine-readable).

JSON reducer output includes `meta.preset`, `meta.presetRequested`, `meta.presetCoerced` so agents see when a typo was corrected.

### Policy (`advise`)

`advise` prints JSON: **`action`** (`raw-read` | `reduce` | `rtk-shell`), **`confidence`**, **`why[]`**, **`recommendedCli`** / **`recommendedCommand`**, **`nextStepIfInsufficient`**, plus path/repo hints. Same rules live in `src/policy.js` (`require('openclaw-context-optimizer/policy')`).

### Metrics privacy

Set `CONTEXT_OPTIMIZER_METRICS_SAFE=1` to omit `cwd` from JSONL lines and truncate `error` messages.

## What changed in v0.6

- **`openclaw/SKILL.md`**: OpenClaw agent workflow (advise → reducer → targeted read; RTK boundary)
- **`smart-tree` v2**: `triageHints.readNext` as **`{ path, reason }[]`**, plus **`readNextPaths`**, **`stackSignals`**, **`whyThisMatters`**, optional **`package.json` `main`** hint
- **Policy v2**: richer **`advise()`**; CLI **`advise`** emits the full decision object + explanation
- **Plugin v2**: opt-in **`suggestOnLargeRead`** (`before_tool_call`), **`readToolNames`**, **`matchers`**, **`extensions`**, **`logSuggestions`**
- **Metrics**: per-command / per-preset **avg ratio**, **`workflowTagGroups`** in `aggregateMetrics` + dashboard lines

## v0.5 (recap)

- Plugin scaffold, policy + `advise`, stronger `smart-tree` / `smart-read` / `smart-json`, metrics + `workflowTag`, RTK doc

Earlier releases added presets, rich metrics, `repoKey`, merged JSON issue pass, `--strict-preset`, metrics safe mode, dual CLI bin name (`context-optimizer` / `openclaw-context-optimizer`).

## Example philosophy: raw vs compact

Raw log snippet:

```text
2026-03-20T11:00:01Z INFO worker started id=91
2026-03-20T11:00:02Z INFO worker started id=92
2026-03-20T11:00:03Z WARN retrying request id=92
2026-03-20T11:00:04Z ERROR request failed status=500 id=92
2026-03-20T11:00:05Z INFO worker started id=93
```

Compact output:

```text
command: smart-log
target: app.log
stats:
  lines: 5
  levels:
    error: 1
    warning: 1
    info: 3
    debug: 0
anomalySummary:
  - first warning @ line 3
  - last error @ line 4
groupedPatterns:
  -
    pattern: <timestamp> INFO worker started id=<n>
    count: 3
```

## Metrics dashboard

```bash
context-optimizer smart-log app.log --metrics --preset=agent
context-optimizer metrics
```

## Programmatic use

`require('openclaw-context-optimizer')` exposes:
- `smartRead`, `smartLog`, `smartCsv`, `smartJson`, `smartTree`
- `smartReadText`, `smartLogText`, `smartCsvText`, `smartJsonText`
- `formatOutput(result)`
- `resolveBudget`, `DEFAULT_BUDGET`, `isKnownPreset`, `normalizePresetName`, preset metadata
- Policy helpers: `shouldReduce`, `recommendedReducer`, `recommendedPreset`, `explainPolicyDecision` (same as `require('openclaw-context-optimizer/policy')`)

## Repository structure

```text
bin/        CLI entrypoint
docs/       architecture + integration notes + RTK_COMPAT
openclaw/   OpenClaw plugin scaffold + docs + plugin-example
samples/    sample inputs
scripts/    smoke test and demo
src/        reducers, presets, metrics, CSV parser
test/       node:test suite
```

## Development

```bash
npm run smoke
npm test
```

## Publishing state

- GitHub metadata is set in `package.json` for [openclaw-context-optimizer](https://github.com/Luc-Michault/openclaw-context-optimizer).
- Optional: screenshots on the README, benchmark fixtures for marketing.

## License

MIT
