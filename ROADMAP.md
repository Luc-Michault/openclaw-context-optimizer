# Roadmap

## v0.3 shipped

- [x] OpenClaw-first docs and `openclaw/` integration folder
- [x] Agent-oriented presets (`agent`, `triage`, `aggressive`, `schema`)
- [x] Richer append-only metrics + improved terminal dashboard
- [x] Scoped agent-triage heuristics across tree/read/json/log reducers
- [x] Smoke + unit tests for presets, metrics, and new reducer hints

## Near-term

- [ ] Markdown heading extraction beyond lightweight file hints
- [ ] Diff-aware reducer
- [ ] Published benchmark fixtures with raw vs compact stats
- [ ] YAML/XML specific reducers if they prove worth the maintenance

## Mid-term

- [ ] Config file support if presets stop being enough
- [ ] Optional plugin hooks for custom reducers
- [ ] Library API examples for more agent runtimes
- [ ] Optional exact tokenizer hook behind optional dependency

## Longer-term

- [ ] OpenClaw helper wrappers once real usage stabilizes
- [ ] Streaming mode for very large logs
- [ ] Benchmark corpus and leaderboard
