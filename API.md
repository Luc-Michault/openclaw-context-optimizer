# Public API (v1.0)

This document defines what **1.0** commits to as a stable surface. Internal helpers may change in minor/patch releases if tests and this contract stay green.

## Stable — intended for production imports

### Main package (`openclaw-context-optimizer` / `require('…')`)

| Export | Notes |
|--------|--------|
| `smartRead`, `smartLog`, `smartCsv`, `smartJson`, `smartTree` | File-based reducers; JSON shape includes `meta.preset` / budget summary. |
| `smartReadText`, `smartLogText`, `smartCsvText`, `smartJsonText` | Same logic for in-memory strings (tests, harnesses). |
| `formatOutput` | Pretty-print reducer result for CLI-style display. |
| `advise` | Policy decision object: `action`, `confidence`, `confidenceScore`, `why`, `recommendedCli`, `alternatives`, `worthReadingExactly`, `worthReadingExactlyReasons`, `isBinaryArtifact`, `pathIssue`, `repoContext`, etc. |
| `explainPolicyDecision` | Human-readable string from `advise`. |
| `aggregateMetrics`, `appendMetric`, `loadRecent`, `formatDashboard`, … | See `src/metrics.js` re-exports from main `index.js`. |

### Plugin / suggestion module (`./openclaw/suggest.js` or `require('openclaw-context-optimizer/suggest')`)

| Export | Notes |
|--------|--------|
| `SUGGESTION_CONTRACT_VERSION` | Semver string for the **suggestion object** (currently `1.0.0`). Bump when adding/removing top-level keys. |
| `LARGE_READ_SUGGESTION_KEYS` | Documented key list for consumers. |
| `buildLargeReadSuggestion` | Returns `null` if below threshold / filters fail; else full suggestion. |
| `emitLargeReadSuggestion` | Invokes `onSuggestion` and optional `console.warn`. |
| `formatSuggestionForAgent` | Compact multi-line hint string. |
| `renderSuggestionLogLine` | Default one-line log form. |
| `formatSuggestionLogLine` | **Deprecated** alias of `renderSuggestionLogLine`. |

## Stable with narrower scope — plugin tuning

| Export | Notes |
|--------|--------|
| `passesLargeReadFilters` | Gate used by `buildLargeReadSuggestion`. |
| `pathMatchesMatcher` | Light glob / substring helper for `matchers` config. |
| `traceLargeReadSuggestion` | Debug trace for `suggestDryRunVerbose` / tuning. |

## Best-effort / advanced — may evolve

Re-exported from main entry with the reducers (same `require('openclaw-context-optimizer')`):

- `shouldReduce`, `recommendedReducer`, `recommendedPreset`
- `gatherRepoContext`, `classifyPathRoles`, `buildAdviseContext`, `findRepoRoot`, …
- Budget/preset helpers: `resolveBudget`, `PRESET_BUDGETS`, `DEFAULT_PRESET`, etc.

Subpath **`openclaw-context-optimizer/repo-context`** and **`/policy`** are **supported** for advanced agents but treated as **secondary** to the main API: signatures may gain optional fields; breaking removals would only happen in a major version.

## Suggestion object nullability

- `recommendedCli` / `recommendedCommand` / `preset` / `reducerCommand` may be `null` (e.g. `rtk-shell`, binary, huge file, special path).
- `worthReadingExactly` may be `null`; `worthReadingExactlyReasons` is always an array (possibly empty).
- `isBinaryArtifact` is boolean; `pathIssue` is `null` or a short string (`huge-file`, `special-file`).
