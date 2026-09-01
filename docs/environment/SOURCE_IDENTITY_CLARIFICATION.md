# Source Identity Clarification

## Decision

The following names refer to the **same technical service**:

```text
leaked-service
Hono Person Lookup API
previously documented Resident Hono API
```

Do not model them as separate connectors.

Canonical technical flow for current planning:

```text
Investigation Platform
→ Person Lookup Connector
→ leaked-service (Hono)
→ Elasticsearch
```

The precise business/source name of the underlying dataset should be confirmed from the real environment.

## Governance note

Technical identity and source governance are different concerns.

Even though the service is a single approved technical boundary, the team still needs to document:

```text
dataset provenance
permitted use
classification
retention
masking
export rules
reason-for-access
```

Do not infer these solely from the repository name `leaked-service`.

## Codex rule

After M0:

1. inspect the actual sibling `leaked-service` repository read-only;
2. document its real route/request/response contract;
3. reuse one connector definition;
4. never access its Elasticsearch store directly.
