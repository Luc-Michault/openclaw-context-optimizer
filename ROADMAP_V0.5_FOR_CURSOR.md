# Roadmap v0.5 — Instructions for Cursor

Goal: evolve `openclaw-context-optimizer` from a strong OpenClaw-first reducer toolkit into a more integrated **agent triage layer**.

## Product direction
This project is **not** trying to be a generic all-LLM shell wrapper. RTK already covers shell-stream rewriting well. Our differentiation is:
- OpenClaw-first / agent-first
- local artifact reduction before expensive reads
- deterministic triage for files, logs, JSON, trees
- metrics that help improve real agent workflows over time

## Priority 1 — Real OpenClaw plugin layer
Build a proper `openclaw/` integration instead of only docs + example stub.

### Deliverables
- `openclaw/openclaw.plugin.json`
- `openclaw/index.ts` (or JS if preferred by compatibility) for a real plugin scaffold
- clear config options such as:
  - `enabled`
  - `verbose`
  - `defaultPreset`
  - `maxFileBytes`
  - `extensions` / `matchers`
- README examples showing installation in `~/.openclaw/extensions/...`

### Scope
Do **not** over-automate everything. MVP can focus on:
- helper utilities / policies for future routing
- explicit reducer invocation patterns
- optional hooks that annotate or suggest, rather than aggressively rewriting all tool calls

## Priority 2 — Auto-selection / policy layer
Add a decision layer so the system can recommend whether to:
- use raw `read`
- use a reducer
- rely on RTK shell rewriting

### Deliverables
Create a policy module, e.g. `src/policy.js`, with functions like:
- `shouldReduce({ path, sizeBytes, extension, commandHint })`
- `recommendedReducer({ path, extension, mimeHint })`
- `recommendedPreset({ kind, sizeBytes, urgency })`
- `explainPolicyDecision(...)`

### Expected behavior
Examples:
- large `.log` → `smart-log --preset=aggressive`
- large `.json` → `smart-json --preset=schema`
- unknown repo root → `smart-tree --preset=triage`
- small exact file → recommend raw `read`

## Priority 3 — Make smart-tree much more agent-useful
Turn `smart-tree` into a stronger repo triage tool.

### Additions
- hot files / likely entrypoints
- recently modified files (bounded, deterministic if feasible)
- likely config files
- likely test folders
- likely build/deploy files
- likely docs/start-here files
- “where to read next” hints

### Constraints
- remain deterministic
- stay compact
- no heavy dependencies
- avoid recursive metadata explosions

## Priority 4 — Improve smart-read for real docs/config/code triage
### Additions
- markdown section map (headers, counts, maybe short section titles)
- detect TODO / FIXME / NOTE / HACK markers
- better config awareness for:
  - `.env`
  - YAML
  - TOML
  - INI
  - Docker-like key/value configs
- better “read next” hints

### Goal
A reducer output should help an agent decide whether to inspect exact raw lines and where.

## Priority 5 — Improve smart-json for operational triage
### Additions
- dominant-shape / schema hints for arrays of objects
- key-frequency sketch for large object arrays
- suspicious-field hints (status/error/id/timestamp/version)
- large-array summaries with representative samples
- “what looks operationally important here?” hints

### Stretch goal
Optional JSON diff helper later, but do not over-scope v0.5 if it jeopardizes shipping.

## Priority 6 — Metrics that measure value, not just usage
Current metrics are useful, but v0.5 should move toward “did this actually help the agent?”

### Additions
- richer dashboard breakdowns:
  - per-command ratios
  - per-preset ratios
  - per-repoKey summaries
  - top largest inputs
  - top biggest savings
- optional `sessionTag` / `workflowTag` support
- maybe export mode: `context-optimizer metrics --json`

### Keep
- append-only JSONL
- no database
- no web dashboard required

## Priority 7 — RTK complementarity docs
Add a dedicated section/page clarifying coexistence with RTK.

### Deliverables
- `docs/RTK_COMPAT.md` (or equivalent section)
- examples:
  - RTK for `exec`
  - openclaw-context-optimizer for local artifacts
  - combined workflows

### Goal
Make it obvious this project complements RTK instead of competing with it.

## Priority 8 — Packaging / release polish
### Deliverables
- verify all names/docs use `openclaw-context-optimizer`
- improve README examples and screenshots / terminal captures
- ensure package exports / bin naming are coherent
- consider whether both CLI names should remain (`context-optimizer` and `openclaw-context-optimizer`) or whether one should become primary and the other just alias

## Nice-to-have
- `--format=jsonl` or other machine-oriented output modes
- more fixture data for benchmarks
- performance tests for very large files
- safer/error-tolerant fallback behavior in the OpenClaw integration layer

## Guardrails
- No heavy dependencies unless clearly worth it
- Keep outputs deterministic and bounded
- Optimize for agent usefulness, not feature count
- Prefer simple local-first designs over infrastructure
- Don’t turn the project into a generic shell-wrapper clone of RTK

## Suggested Cursor deliverables summary
1. real `openclaw/` plugin layer
2. policy/recommendation module
3. stronger `smart-tree`
4. stronger `smart-read`
5. stronger `smart-json`
6. richer metrics/dashboard
7. RTK complementarity docs
8. release polish + tests
