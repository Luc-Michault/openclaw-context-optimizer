# Context Optimizer Toolkit

A small open-source CLI for turning noisy local files into compact, deterministic, human-readable summaries.

> Goal: reduce what an LLM or human needs to read while preserving decision-relevant context.

## Why this exists

Large files are expensive to read in full, annoying to paste into chat, and often full of repetition. The goal of this toolkit is not to perfectly summarize everything. The goal is to preserve **decision-relevant context** while cutting obvious waste:

- repeated lines
- boring boilerplate
- oversized JSON structures
- long logs where a few anomalies matter most
- directory trees that are too large to inspect raw

This makes the toolkit useful for AI workflows, terminal triage, debugging, and quick human review.

## Design principles

- **Compact by default**: prefer signal over completeness.
- **Deterministic output**: same input should produce the same summary ordering.
- **Human-readable**: plain text, stable sections, no fancy rendering required.
- **Anomaly-first**: surface errors, warnings, schema drift, and suspicious structure before the rest.
- **Dedupe-aware**: collapse repeated patterns and report counts.
- **Truncation with intent**: use bounded previews instead of dumping raw content.
- **Generic**: no private paths, no platform-specific assumptions.

## Install locally

```bash
npm link
```

This exposes a local executable named `context-optimizer`.

## Open-source positioning

This project is designed as a **generic pre-context reduction layer** for agent/tooling workflows.
It does not try to replace shell wrappers like RTK. Instead, it complements them by focusing on
**file payloads and structured local artifacts** such as logs, CSV, JSON, text files, and directory trees.

## Commands

```bash
context-optimizer smart-read <file>
context-optimizer smart-log <file>
context-optimizer smart-csv <file>
context-optimizer smart-json <file>
context-optimizer smart-tree <dir>
```

## What each command does

### `smart-read <file>`
Best-effort compact summary for general text files.

Heuristics:
- line counts and blank-line counts
- unique-vs-total line estimation
- duplicate line groups
- anomaly-first scan for error/warning/status patterns
- bounded unique-line preview

### `smart-log <file>`
Focused log summarizer.

Heuristics:
- rough level counts (`error`, `warning`, `info`, `debug`)
- anomaly-first extraction
- pattern grouping with timestamps and numbers normalized
- deterministic tail preview

### `smart-csv <file>`
Quick CSV structural summary.

Heuristics:
- row and column counts
- per-column uniqueness/empties/numeric ranges
- anomaly-first row width mismatch reporting
- bounded sample rows

### `smart-json <file>`
Compact JSON structure inspection.

Heuristics:
- root type and top-level key count
- stable key ordering
- nested structure sketch
- anomaly-first reporting for nulls, empty objects/arrays, and very long strings

### `smart-tree <dir>`
Budgeted directory tree overview.

Heuristics:
- deterministic alphabetical traversal
- bounded depth and entry count
- clear `dir`/`file` markers
- truncation notice when the tree exceeds the display budget

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
anomalyFirst:
  - line 3: WARN retrying request id=92
  - line 4: ERROR request failed status=500 id=92
groupedPatterns:
  - count: 3
    pattern: <timestamp> INFO worker started id=<n>
```

The toolkit intentionally prefers the grouped pattern and the anomalies over the full raw stream.

## Repository structure

```text
bin/      CLI entrypoint
src/      summarization logic
docs/     architecture notes
scripts/  smoke test and demo
samples/  sample inputs for quick evaluation
```

## Development

Run the included smoke test:

```bash
npm run smoke
```

Run the raw-vs-compact demo:

```bash
npm run demo
```

## Suggested GitHub polish before publishing

- Replace `YOUR_ORG` placeholders in `package.json`
- Add screenshots or terminal captures in the README
- Decide whether the package name should stay `context-optimizer-toolkit` or shorten to `context-optimizer`
- Add benchmark fixtures from real-world repositories if you want stronger credibility

## Limitations

- CSV parsing is intentionally simple and does not handle every quoted edge case.
- JSON summaries are structural, not semantic.
- Log grouping uses lightweight normalization rules, not full template mining.
- This is an MVP focused on deterministic usefulness, not exhaustive parsing.

## License

MIT
