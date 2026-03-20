# OpenClaw Context Optimizer

A small open-source CLI for turning noisy local files into compact, deterministic, human-readable summaries.

> v0.3 direction: **OpenClaw-first, agent-first**. This is a local reduction layer for agent workflows, not a generic “all LLMs everywhere” wrapper.

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

See [`openclaw/README.md`](./openclaw/README.md) for workflow guidance and a lightweight integration stub.

## Commands

```bash
context-optimizer smart-read [options] <file>
context-optimizer smart-log [options] <file>
context-optimizer smart-csv [options] <file>
context-optimizer smart-json [options] <file>
context-optimizer smart-tree [options] <dir>
context-optimizer metrics [--clear] [--limit=N]
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

JSON output includes `meta.preset`, `meta.presetRequested`, `meta.presetCoerced` so agents see when a typo was corrected.

### Metrics privacy

Set `CONTEXT_OPTIMIZER_METRICS_SAFE=1` to omit `cwd` from JSONL lines and truncate `error` messages.

## What changed in v0.3 / v0.4

### Agent-oriented metrics

Metrics entries include fields useful for real agent usage, including:
- `durationMs`
- `preset` (applied)
- `budgetSummary`
- `sourceType` (`file` or `stdin`)
- `success`
- `cwd` (omitted when `CONTEXT_OPTIMIZER_METRICS_SAFE=1`)
- `repoKey` (`pkg:name`, `git:folder`, or `dir:basename` — walks up to `package.json` / `.git`)

The `context-optimizer metrics` dashboard shows success/failure counts, average runtime, source mix, command/preset usage, and a **repos:** aggregate (falls back to legacy `projectHint` in old JSONL lines).

Still append-only JSONL.

### Reducer improvements for agent triage

- `smart-tree` adds lightweight **project hints** (Node project, tests visible, container config, OpenClaw folder, etc.; folder names matched case-insensitively)
- `smart-read` adds **markdown/config awareness** and **assignment-style** secret hints (`likely-secret-assignment`), not bare word matches
- `smart-json` merges **anomalies + operational hints** in one bounded walk; large homogeneous object arrays sample keys instead of visiting every element
- `smart-log` adds first/last anomaly summary in addition to grouped patterns

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

`require('context-optimizer-toolkit')` exposes:
- `smartRead`, `smartLog`, `smartCsv`, `smartJson`, `smartTree`
- `smartReadText`, `smartLogText`, `smartCsvText`, `smartJsonText`
- `formatOutput(result)`
- `resolveBudget`, `DEFAULT_BUDGET`, `isKnownPreset`, `normalizePresetName`, preset metadata

## Repository structure

```text
bin/        CLI entrypoint
docs/       architecture + integration notes
openclaw/   OpenClaw-specific docs + lightweight integration stub
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

This repo is intended to be open-source ready. The remaining publish-time items are explicit rather than placeholder-y.

- Set your final GitHub repository URL in `package.json`
- Add screenshots if you want a nicer package page
- Add real-world fixtures if you want benchmark credibility

## License

MIT
es if you want benchmark credibility

## License

MIT
