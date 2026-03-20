# Architecture

Project/package name: `openclaw-context-optimizer`

## Overview

The toolkit is a single-process Node.js CLI with deterministic reducers, preset-aware budgets, and append-only JSONL metrics.

```text
bin/context-optimizer.js
        |
        +-- src/budget.js      (presets + CLI budget overrides)
        +-- src/metrics.js     (JSONL metrics + terminal dashboard)
        +-- src/csv-parse.js   (RFC 4180–style CSV)
        v
     src/index.js
        |
        +-- smartRead(file | text)
        +-- smartLog(file | text)
        +-- smartCsv(file | text)
        +-- smartJson(file | text)
        +-- smartTree(dir)
```

## v0.3 / v0.4 direction

This is an **agent-side reduction layer**.

It is not trying to be:
- a universal prompt middleware
- a shell wrapper replacement
- a framework for remote hosted summarization

It is trying to be:
- deterministic
- local-first
- cheap to run inside agent workflows
- good at first-pass triage before exact reads

## Core choices

### Presets over config sprawl

v0.3 adds agent-friendly presets (`agent`, `triage`, `aggressive`, `schema`) that map onto the existing budget knobs. This keeps the surface area small while giving agents clearer intent.

### Meta in every result

Reducers attach:
- `meta.preset` (applied)
- `meta.presetRequested` / `meta.presetCoerced` (so typos are visible)
- `meta.budgetSummary`

That keeps downstream agents and dashboards aware of **how** a summary was produced.

### JSON: structure vs issues

`smart-json` still builds the structural sketch in one walk, then runs a **single merged walk** for `anomalyFirst` + `operationalHints` (shared patterns, bounded array indexing so huge homogeneous arrays do not recurse per element). Stats expose `structureNodesVisited` and `issueNodesVisited` separately.

### Simple append-only metrics

Metrics stay JSONL and append-only. No database, no migrations, no daemon. The dashboard computes aggregates on read. Entries use `repoKey` (package name / git folder / directory label); optional `CONTEXT_OPTIMIZER_METRICS_SAFE=1` strips `cwd` and truncates errors.

### Scoped triage heuristics

Reducer improvements stay narrow and deterministic:
- `smart-tree`: project hints from top-level files/folders
- `smart-read`: markdown/config awareness
- `smart-json`: operational hints
- `smart-log`: anomaly range summary

## Determinism strategy

To keep output stable across runs:
- directory names and object keys are alphabetically sorted
- budgets are explicit and fixed unless overridden
- grouped patterns sort by count then lexicographically
- formatting is plain text, not terminal-width dependent logic-heavy UI

## OpenClaw fit

The intended loop is:
1. tree or reducer first
2. exact `read` second
3. patch only after narrowing scope

That is why the project now has an `openclaw/` directory rather than pretending to be runtime-agnostic at the product layer.
