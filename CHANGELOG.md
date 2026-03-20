# Changelog

All notable changes to this project are documented here. The format is loosely [Keep a Changelog](https://keepachangelog.com/).

## [1.0.0] — 2026-03-20

### Stable surface (see [API.md](./API.md))

- **smart-tree** — profile-aware `readNext` ranking (OpenClaw extension, monorepo, published npm, docs-heavy), noise paths excluded from read lists, `readNextContext.openFirst` capped at 5, actionable `whyThisMatters`, `openclaw-extension` repo profile, `mkdocs.yml` primary rule.
- **smart-read** — doc-type section priority (SKILL/AGENTS, changelog), stricter `code-examples-present`, YAML sketch improvements (quoted keys, `---`), explicit “best-effort line scan” semantics for YAML/TOML sketches.
- **Policy / `advise`** — binary detection (NUL in first 512 B), `>100MB` huge-file guard, socket/FIFO/device short-circuit, symlink note, `isBinaryArtifact` and `pathIssue` on decisions; shell intent remains **only** via explicit `commandHint` (never inferred from paths).
- **Plugin** — `SUGGESTION_CONTRACT_VERSION` **1.0.0**; suggestion objects include `isBinaryArtifact`, `pathIssue` (aligned with `advise`).
- **Tests** — realistic fixtures under `test/fixtures/fixture-*`, `v1.0-fixtures.test.js`, end-to-end `v1.0-workflow.test.js`, dogfood assertion on this repo.

### Deprecations (still present)

- `formatSuggestionLogLine` — alias of `renderSuggestionLogLine`; prefer `renderSuggestionLogLine` for new code. Will remain for semver compatibility.

## [0.9.0]

- Repo-context module, policy phases + `worthReadingExactlyReasons`, smart-tree v4 triage buckets, smart-read config sketches + priority sections, plugin `silent` / `traceLargeReadSuggestion` / `formatSuggestionForAgent` / glob `matchers`, metrics quality hints, integration fixtures.

## [0.8.0]

- Versioned large-read suggestion contract, `onSuggestion`, `confidenceScore`, richer policy + smart-tree.

## [0.7.0] and earlier

- Progressive introduction of `advise`, smart-tree `readNext`, metrics JSONL, OpenClaw plugin scaffold, presets — see git history and [ROADMAP.md](./ROADMAP.md).

