# OSINT Development Environment Context

## Purpose

This document tells engineers and AI agents what source systems already exist around the platform.

It is an inventory/context document, not permission to turn every source response into canonical knowledge.

---

## Workspace topology

Conceptually:

```text
osint/
├── intelligence-platform/
├── leaked-service/
├── twitter-scrapper-api/
└── user-scanner/
```

Codex must inspect the actual parent workspace instead of assuming exact paths or ports.

---

# Important clarification — `leaked-service` and the Hono Person Lookup API are the same service

The service previously documented separately as:

```text
Resident Hono API
```

and:

```text
leaked-service
```

is **one technical service**, not two independent sources/connectors.

Current understanding:

```text
Investigation Platform
→ Person Lookup Connector
→ leaked-service (Hono API)
→ Elasticsearch-backed person dataset
```

Therefore:

- do **not** create both `ResidentHonoConnector` and `LeakedServiceConnector`;
- do **not** count them as two source integrations;
- inspect the actual `leaked-service` repository to confirm endpoint, authentication, response schema, pagination, limits and exact Elasticsearch dependency;
- the Investigation Platform must still never query that Elasticsearch store directly.

The repository/service name does not by itself determine the legal/governance status of the underlying dataset. Source provenance, permitted use, retention and classification must be documented from the actual environment.

---

# Existing/local systems

## 1. `leaked-service` / Hono Person Lookup API

**Technical status:** existing source boundary.

User-described capability:

```text
search person data by name
```

Architecture:

```text
Platform
→ Person Lookup Connector
→ leaked-service / Hono API
→ Elasticsearch
```

Never:

```text
Platform
→ Elasticsearch directly
```

Proposed capability:

```text
PERSON_LOOKUP
```

Potential additional capability after contract discovery:

```text
IDENTIFIER_LOOKUP
```

Classification baseline:

```text
RESTRICTED
```

because the responses may contain high-sensitivity personal identifiers.

Before production retention/export is finalized, document:

- actual dataset provenance;
- lawful/permitted organizational use;
- source/data classification;
- which fields may be retained;
- which fields must be masked;
- retention/deletion policy;
- audit/reason-for-access requirements.

Do not infer these solely from the repository name.

---

## 2. `user-scanner`

User-described purpose:

- use an email to identify platforms/services where the email appears to be registered.

Proposed capability:

```text
ACCOUNT_PRESENCE_LOOKUP_BY_EMAIL
```

Classification:

```text
SENSITIVE
```

Semantic rule:

```text
"service reports possible account presence"
≠
"Person owns an account on this platform"
```

Result should initially become an Observation / Candidate signal, not canonical SocialAccount ownership.

---

## 3. `twitter-scrapper-api`

User-described purpose:

- discover Twitter/X accounts;
- collect Twitter/X data.

Current status:

```text
DEFERRED
```

Do not spend early implementation effort here unless explicitly reprioritized.

---

## 4. OSINT Industries

External paid source.

Primary intended query inputs:

```text
email
phone
username
name
```

Potential source output can include heterogeneous data such as:

```text
platform/account presence
profile data
professional data
activity timestamps
Google Maps observations
Strava activity
service registration
aggregator signals
breach-related signals
```

This is why provider output must be normalized rather than written directly to Entity fields.

See:

```text
OSINT_INDUSTRIES_CONNECTOR_PLAN.md
SOURCE_NORMALIZATION_STRATEGY.md
```

---

# Proposed integration order after foundations

```text
1. leaked-service / Hono Person Lookup Connector
2. OSINT Industries Connector after contract/retention review
3. user-scanner Connector
4. twitter-scrapper-api later
```

This order is a proposal and does not override backlog dependencies.

---

# Connector discovery rule

After M0 is Engineering Ready, Codex may inspect the sibling service repository read-only.

For `leaked-service`, determine:

```text
actual runtime
actual Hono routes
base URL / port
authentication
request schema
response schema
Elasticsearch dependency
pagination
limits
timeouts
error contract
data classification
source provenance
retention assumptions
```

Do not perform real-person lookups merely to learn the API contract.
