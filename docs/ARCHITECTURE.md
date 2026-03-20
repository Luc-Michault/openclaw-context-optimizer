# Architecture

## Overview

The toolkit is a single-process Node.js CLI with one executable entrypoint and a small set of deterministic summarizers.

```text
bin/context-optimizer.js
        |
        v
     src/index.js
        |
        +-- smartRead(file)
        +-- smartLog(file)
        +-- smartCsv(file)
        +-- smartJson(file)
        +-- smartTree(dir)
```

## Core choices

### Single entrypoint
The CLI is intentionally exposed through one `bin` command and routes subcommands internally. That keeps installation, packaging, and discoverability simple.

### Shared heuristics
Several rules are shared across commands:

- bounded previews
- deterministic sorting
- compact string truncation
- anomaly-first ordering
- duplicate/pattern grouping

### Determinism strategy
To keep output stable across runs:

- directory names and object keys are alphabetically sorted
- preview budgets are fixed
- grouping output is sorted by count then lexicographically
- formatting is plain text, not terminal-width dependent

## Command behaviors

### `smart-read`
Designed for generic text. It reports broad file stats, repeated lines, lightweight anomaly detection, and a short unique-line preview.

### `smart-log`
Adds log-specific grouping by normalizing timestamps, numbers, and hex values into stable patterns. This collapses noisy streams into a few dominant templates.

### `smart-csv`
Treats CSV as a simple grid and computes per-column statistics suitable for quick inspection and schema drift detection.

### `smart-json`
Builds a compact structural sketch of nested JSON and flags obvious anomalies like nulls, empty containers, and long strings.

### `smart-tree`
Walks the filesystem with depth and entry budgets to avoid runaway output. It produces a readable tree-like list without relying on external commands.

## Why plain JavaScript

This project targets easy cloning and local use. Plain CommonJS avoids build steps and keeps the MVP publishable with minimal tooling.
