# Architecture

Project/package name: `openclaw-context-optimizer`

## Overview

The project is now an **OpenClaw-first triage layer** with four cooperating parts:

1. **Reducers** — bounded summaries for files and directories
2. **Policy** — `advise` / decision helpers for raw-read vs reduce vs RTK-shell
3. **Metrics** — append-only JSONL + dashboard / aggregate views
4. **OpenClaw integration** — skill + plugin scaffold / opt-in suggestion hook

```text
bin/context-optimizer.js
        |
        +-- src/budget.js       (presets + CLI budget overrides)
        +-- src/policy.js       (advise / shouldReduce / recommendedReducer / recommendedPreset)
        +-- src/metrics.js      (JSONL metrics + dashboard + aggregateMetrics)
        +-- src/csv-parse.js    (RFC 4180–style CSV)
        v
     src/index.js
        |
        +-- smartRead(file | text)
        +-- smartLog(file | text)
        +-- smartCsv(file | text)
        +-- smartJson(file | text)
        +-- smartTree(dir)

openclaw/
  +-- SKILL.md                  (agent workflow: advise → reducer → exact read)
  +-- index.js                  (plugin with opt-in suggestOnLargeRead)
  +-- openclaw.plugin.json      (plugin schema)
  +-- README.md                 (install + runtime notes)
```

## Product direction

This repo is **not** trying to be:
- a universal prompt middleware
- a shell wrapper replacement
- a hosted summarization framework

It **is** trying to be:
- deterministic
- local-first
- cheap to run inside OpenClaw agent workflows
- good at first-pass triage before exact reads
- clearly complementary to RTK for shell streams

## Core choices

### 1. Policy before magic

The project prefers an explicit decision layer (`advise`) over silent automation.
Current actions are:
- `raw-read`
- `reduce`
- `rtk-shell`

This keeps agent behavior inspectable and debuggable.

### 2. Presets over config sprawl

Presets (`balanced`, `agent`, `triage`, `aggressive`, `schema`) bundle budget choices into agent-meaningful modes instead of exposing dozens of knobs by default.

Reducers attach:
- `meta.preset`
- `meta.presetRequested`
- `meta.presetCoerced`
- `meta.budgetSummary`

### 3. Scoped, deterministic reducers

Reducers stay intentionally narrow and bounded:
- `smart-tree`: repo/project triage with `triageHints.readNext`, `readNextPaths`, `stackSignals`, `whyThisMatters`
- `smart-read`: markdown/config awareness, todo summary, read-next hints
- `smart-json`: structure + merged issue/operational hint pass, bounded large-array handling
- `smart-log`: anomaly grouping + first/last anomaly summary

### 4. Simple append-only metrics

Metrics remain JSONL and append-only. No DB, no daemon, no migration burden.
The system computes:
- dashboard text output
- aggregate summaries (`aggregateMetrics`)
- per-command / per-preset ratios
- workflow tag groupings

Optional privacy mode (`CONTEXT_OPTIMIZER_METRICS_SAFE=1`) strips `cwd` and truncates error text.

### 5. Safe OpenClaw integration

The plugin is intentionally **opt-in and non-aggressive**.
Current v0.6 behavior:
- passive registration by default
- optional `suggestOnLargeRead` hook on read-like tools
- can filter by `readToolNames`, `extensions`, `matchers`
- does **not** rewrite tool calls automatically

This preserves trust while still making the runtime more useful.

## Determinism strategy

To keep output stable across runs:
- directory names and object keys are alphabetically sorted
- budgets are explicit and fixed unless overridden
- grouped patterns sort by count then lexicographically
- output is plain text or stable JSON, not terminal-width-heavy fancy UI
- shallow scans are bounded by explicit budgets

## OpenClaw fit

The intended loop is now explicit:
1. run `advise`
2. apply the recommended reducer/preset if needed
3. inspect bounded summary (`readNext`, anomalies, structure, hints)
4. exact `read` only on the most relevant files/sections
5. patch or act after scope is narrowed

That is what turns the project from a generic reducer toolkit into an actual **OpenClaw capability layer**.
