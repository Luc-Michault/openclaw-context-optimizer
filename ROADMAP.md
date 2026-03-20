# Roadmap

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
