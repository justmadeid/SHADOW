# Data Classification Handling Matrix

| Control | PUBLIC | INTERNAL | SENSITIVE | RESTRICTED |
|---|---|---|---|---|
| Normal authenticated view | policy | policy | explicit case/resource policy | explicit restricted policy |
| Full value in UI | usually allowed | policy | limited | exceptional permission |
| Masked view | optional | optional | preferred for identifiers | default for identifiers |
| Match-only | uncommon | possible | useful | strongly supported |
| Application logs | metadata only | metadata only | no values | no values |
| Metrics labels | no content | no content | no content | no content |
| Search projection | allowed fields | scoped | minimized/scoped | avoid raw values |
| Queue payload | refs/metadata | refs/metadata | refs only preferred | refs only |
| Raw payload persistence | source policy | source policy | minimized | disabled/minimized by default |
| Export | policy | permission | explicit export policy | restricted/redacted |
| Object URL | scoped | scoped | short-lived | short-lived + strict auth |
| Worker routing | general | general | policy-dependent | restricted profile |
| Retention | policy | policy | explicit | explicit/minimized |
| Cross-case disclosure | policy | explicit | explicit | deny by default |

## Field visibility

Backend returns one:
- `FULL`
- `MASKED`
- `MATCH_ONLY`
- `HIDDEN`

Examples for National ID:

### FULL
Only authorized user:
```text
3374........
```

### MASKED
```text
3374••••••••8291
```

### MATCH_ONLY
```text
Exact National ID Match
```

### HIDDEN
No value or match signal disclosed.

Frontend does not invent visibility rules.

## Classification propagation

Classification must be considered when data moves:
```text
Source
→ ConnectorResult
→ SourceRecord
→ Observation
→ Evidence
→ Dataset
→ AnalysisResult
→ Finding
```

Derived data may inherit or increase sensitivity; never automatically downgrade classification because it is an analysis summary.
