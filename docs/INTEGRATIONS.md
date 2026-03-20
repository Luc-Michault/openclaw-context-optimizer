# Integrations

## Generic usage

```bash
context-optimizer smart-read README.md
context-optimizer smart-log app.log
context-optimizer smart-csv data.csv
context-optimizer smart-json package.json
context-optimizer smart-tree src
```

## Agent workflow idea

Instead of feeding raw artifacts into an LLM:

1. run a reducer command locally
2. inspect compact output
3. only fall back to raw reads when detail is actually needed

## Example shell aliases

```bash
alias co-read='context-optimizer smart-read'
alias co-log='context-optimizer smart-log'
alias co-csv='context-optimizer smart-csv'
alias co-json='context-optimizer smart-json'
alias co-tree='context-optimizer smart-tree'
```

## Suggested use cases
- debug logs before sharing with an LLM
- large CSV inspection
- quick JSON schema inspection
- bounded directory snapshots
- compact file preview before raw read
