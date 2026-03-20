# Roadmap

## v0.8 shipped (runtime-ready suggestions + policy phases)

- [x] **Plugin contract** — `schemaVersion`, stable `LARGE_READ_SUGGESTION_KEYS`, `renderSuggestionLogLine` vs `buildLargeReadSuggestion`, `emitLargeReadSuggestion` + optional **`onSuggestion`** (programmatic config), `logSuggestions: false` for callback-only
- [x] **Policy** — phased `buildAdviseContext`, numeric **`confidenceScore`** + label, richer **alternatives** / **worthReadingExactly**, **`gatherRepoContext.inferences`**, path **generated-output** roles
- [x] **smart-tree** — **package.json `bin` / `module`**, **`triageGroups`** buckets, **repoProfile** merged with policy inferences + npm shape hints
- [x] **smart-read** — **depthSummary**, stronger **config** / **instruction** hints
- [x] **Metrics** — **`qualityHints`** (heuristic misuse / preset review) + dashboard section
- [x] Tests + docs alignment

## v0.7 shipped (trust + triage depth)

- [x] **`openclaw/suggest.js`** — structured large-read suggestions (reusable object, log as renderer)
- [x] **Policy v3** — repo markers, path roles, alternatives, worthReadingExactly, lock/manifest nuance, very-high confidence at repo root
- [x] **`smart-tree` v3** — ranked readNext + readNextSecondary + repoProfile + sharper whyThisMatters; main-before-index ordering
- [x] **`smart-read`** — markdownOutline, documentShape, better readNextHints
- [x] **Metrics** — `tuningHints` for preset/command/workflow tuning from avg ratios
- [x] Docs pass (README, ARCHITECTURE, INTEGRATIONS, RTK_COMPAT, openclaw README, SKILL)

## v0.6 shipped (OpenClaw capability layer)

- [x] `openclaw/SKILL.md` — agent workflow + RTK boundary
- [x] `smart-tree` v2 — `readNext` with reasons, stack/monorepo signals, `package.json` main hint, `whyThisMatters`
- [x] Policy v2 — `advise()` with action/confidence/why/next step; CLI aligned
- [x] Plugin v2 — opt-in `suggestOnLargeRead` + config that does real work (`matchers`, `extensions`, …)
- [x] Metrics — avg ratio by command/preset, `workflowTagGroups`
- [x] README hero + decision table

## v0.5 shipped (agent triage layer)

- [x] OpenClaw plugin scaffold: `openclaw/openclaw.plugin.json` + `openclaw/index.js` (passive; config + verbose)
- [x] Policy module `src/policy.js` + CLI `advise` + re-export from package root
- [x] Stronger `smart-tree`: `triageHints` (readNext, recentlyTouched, build/test/doc signals)
- [x] Stronger `smart-read`: markdown section map, TODO/FIXME/NOTE/HACK counts, `readNextHints`
- [x] Stronger `smart-json`: key frequency sample, time/version field hints
- [x] Metrics: `aggregateMetrics`, `metrics --json`, optional `workflowTag` / `CONTEXT_OPTIMIZER_WORKFLOW_TAG`
- [x] [RTK coexistence doc](docs/RTK_COMPAT.md)
- [x] Tests for policy, aggregates, updated reducer hints

## v0.3 / v0.4 (recap)

- Presets, meta (`presetCoerced`), metrics dashboard, RFC CSV, merged JSON issue pass, repoKey, `--strict-preset`, metrics safe mode

## Near-term

- [ ] Tune `suggestOnLargeRead` against real OpenClaw `before_tool_call` payloads in the wild
- [ ] Diff-aware reducer
- [ ] Published benchmark fixtures with raw vs compact stats
- [ ] YAML/XML specific reducers if they prove worth the maintenance

## Mid-term

- [ ] Config file support if presets stop being enough
- [ ] Streaming mode for very large logs
- [ ] Optional exact tokenizer hook behind optional dependency

## Longer-term

- [ ] Benchmark corpus and leaderboard
- [ ] Optional JSON diff helper (bounded)
