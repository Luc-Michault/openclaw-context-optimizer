# Contributing

Thanks for considering a contribution.

## Principles
- Keep output deterministic.
- Prefer signal over completeness.
- Avoid heavy dependencies unless they unlock clear value.
- Preserve human-readable plain-text output.
- New heuristics should degrade gracefully on messy input.

## Local workflow
```bash
npm install
npm run smoke
npm run demo
```

## Contribution ideas
- Better CSV parsing with quoted field support
- More robust log template grouping
- Token/char benchmarking fixtures
- Additional reducers for XML, YAML, markdown, diffs
- Structured JSON output mode for downstream agents/tools

## Pull requests
Please include:
- what changed
- why it improves compactness or usefulness
- before/after example output when relevant
- smoke test result
