# Integrations

## OpenClaw

Project/package name: `openclaw-context-optimizer`

Recommended order of operations for repo triage:

```bash
context-optimizer smart-tree . --preset=triage
context-optimizer smart-read README.md --preset=agent
context-optimizer smart-json package.json --preset=schema
context-optimizer smart-log server.log --preset=aggressive
```

Then use OpenClaw `read` on only the files/sections that matter.

### Reducers vs raw reads vs shell rewriting

- **Reducer**: when the artifact is too noisy to inspect raw
- **Raw read**: when exact content matters or the file is already small
- **Shell rewriting / RTK**: when command output, grep pipelines, or repo-wide shell flow needs shaping before the model sees it

### Example stub

`openclaw/plugin-example.js` is intentionally tiny. It just shells into the CLI and returns parsed JSON. It demonstrates the likely future seam without adding a plugin framework too early.

## Generic shell usage

```bash
context-optimizer smart-read README.md
context-optimizer smart-log app.log
context-optimizer smart-csv data.csv
context-optimizer smart-json package.json
context-optimizer smart-tree src
```

## Metrics

```bash
export CONTEXT_OPTIMIZER_METRICS=1
context-optimizer smart-log ./big.log --preset=agent --json
context-optimizer metrics
```

Optional: `CONTEXT_OPTIMIZER_METRICS_DIR=/path/to/dir` to store `metrics.jsonl` elsewhere.

Use `CONTEXT_OPTIMIZER_METRICS_SAFE=1` to avoid writing full `cwd` and to truncate error text in the log.

For agent scripts that pass `--preset` from an LLM, add `--strict-preset` so unknown names fail loudly instead of falling back to `balanced`.
