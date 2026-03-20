# Skill: OpenClaw Context Optimizer (local triage before expensive reads)

This skill describes how an **OpenClaw agent** should use `openclaw-context-optimizer` (`context-optimizer` CLI) as a **first-pass capability** on local artifacts. It complements **RTK** (shell stream shaping); it does not replace native `read` or RTK-wrapped `exec`.

---

## When to use

- Large or noisy **log** files
- Large **JSON** / **JSONL**
- Wide or messy **CSV** / **TSV**
- **Unknown repo or folder** (what to open first?)
- Large **markdown** / docs / configs where you need structure and anomalies before verbatim text
- **Before** broad reads that would waste context

## When not to use (prefer other tools)

- **Small files** — use a direct, targeted `read`
- You need **exact syntax** for a patch — `read` the precise region
- **Tiny lockfiles / env examples** — often fine verbatim
- Payload is **shell or command output** — use **RTK** (stream rewriting), not file reducers

---

## RTK vs this toolkit

| Situation | Tooling |
|-----------|---------|
| Waste is in **terminal output** (`exec`, pipelines) | **RTK** — rewrite/bound the stream |
| Waste is an **on-disk file** (log, JSON, tree, CSV) | **context-optimizer** reducers + policy |
| You already know **exact lines** | **read** |

---

## Recommended workflow

1. **Classify** — file vs directory vs “this came from exec” (if exec → RTK).
2. Run **`context-optimizer advise <path>`** — get `action` (`raw-read` | `reduce` | `rtk-shell`), `why[]`, `recommendedCli` / `recommendedCommand`, `nextStepIfInsufficient`.
3. If **`reduce`**, run the suggested command (e.g. `smart-log`, `smart-json`, `smart-tree`) with the suggested **`--preset`**.
4. **Read the bounded summary** — anomalies, structure, `readNext` hints, duplicates, etc.
5. Only then **`read`** the 3–7 highest-signal paths or line ranges the summary points to.
6. If the reducer was insufficient, follow **`nextStepIfInsufficient`** from `advise` (usually: deeper targeted `read` or re-run after refresh).

---

## Commands (quick map)

| Artifact | Typical command | Preset hints |
|----------|-----------------|--------------|
| Repo / directory | `smart-tree <dir> --preset=triage` | `triage` at unknown roots |
| Log | `smart-log <file> --preset=agent` | `aggressive` if huge / tight context |
| JSON | `smart-json <file> --preset=agent` | `schema` for large structured configs |
| CSV | `smart-csv <file> --preset=agent` | default `agent` |
| Text / md | `smart-read <file> --preset=agent` | `triage` / `aggressive` by size |

Use **`--json`** when another tool must parse the result; use **`--metrics`** when you want runs logged for later dashboards.

---

## `smart-tree` triage output

- **`triageHints.readNext`** — ordered `{ path, reason }[]` (what to open next and why).
- **`triageHints.readNextPaths`** — same paths as strings (compat / quick checks).
- **`recentlyTouched`**, **`stackSignals`**, **`whyThisMatters`** — bounded, deterministic hints.

---

## Examples (OpenClaw-shaped)

**Unknown repo**

```bash
context-optimizer advise .
context-optimizer smart-tree . --preset=triage
# Then exact read on top readNext paths (README, package manifest, entry file).
```

**Huge application log**

```bash
context-optimizer advise ./app.log
context-optimizer smart-log ./app.log --preset=aggressive
# Then read around anomaly line numbers from the summary.
```

**Large API JSON**

```bash
context-optimizer advise ./state.json
context-optimizer smart-json ./state.json --preset=schema
# Then read only the keys/branches the sketch flags.
```

**Shell-heavy task**

```bash
context-optimizer advise ./out.txt --command-hint=exec
# Expect action rtk-shell — shape the command with RTK, not smart-log on a fake “file”.
```

---

## Success check

You are using this skill well when the agent consistently does **`advise` → reducer → bounded review → targeted `read`**, keeps outputs deterministic and bounded, and reaches for **RTK** when the problem is **exec output**, not files.
