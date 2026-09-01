# Source Response Normalization Strategy

## Problem

Existing local services and external providers return different response shapes. The Platform must not force them to change before integration, and must not leak provider-specific payloads into canonical domain models.

## Boundary

```text
Provider / Local API response
        ↓
Connector-specific schema validation
        ↓
Connector mapper
        ↓
ConnectorResultEnvelope
        ↓
SourceRecord
        ↓
Observation
        ↓
Evidence / Candidate processing
```

## Connector responsibilities

Each connector should:

1. validate source response with a connector-owned schema (Zod is already used in this repository and is a suitable default);
2. preserve source semantics;
3. normalize source errors;
4. attach source/connector/version/request provenance;
5. produce stable external record IDs where available;
6. report partial/completeness status honestly;
7. avoid identity conclusions;
8. avoid direct Knowledge mutations;
9. apply source-specific retention policy;
10. keep large/raw payloads out of queue messages.

## Proposed transport-neutral envelope

This is a design target for the later Connector SDK, not a P0 implementation requirement.

```ts
interface ConnectorResultEnvelope<TRecord> {
  connectorId: string;
  connectorVersion: string;
  dataSourceId: string;
  capability: string;

  runId: string;
  externalRequestId?: string;

  retrievedAt: string;
  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";
  warnings?: string[];

  records: Array<{
    externalRecordId?: string;
    observedAt?: string;
    record: TRecord;
  }>;

  checkpoint?: unknown;
  cost?: {
    unit?: string;
    amount?: number;
  };
}
```

## Normalization is not truth promotion

Example `user-scanner` result:

```text
Provider result:
"Email appears registered on Platform X"
```

Normalize to:

```text
Observation:
source = user-scanner
subject = email identifier
predicate = ACCOUNT_PRESENCE_REPORTED
platform = X
```

Do **not** automatically create:

```text
Person
OWNS
Platform-X Account
```

## Contract fixtures

For every connector create sanitized fixtures:

```text
fixtures/
├── success.json
├── empty.json
├── malformed.json
├── rate-limit.json
└── provider-error.json
```

Rules:
- synthetic values only;
- no real targets;
- no live API key;
- no real leaked/breach records;
- fixtures must preserve structure, not sensitive content.

## Contract discovery output

After Codex inspects a source service, create:

```text
docs/environment/discovered/<service>.md
```

and include a proposed normalization table:

| Source field | Meaning | Normalized object | Classification | Persistence |
|---|---|---|---|---|
