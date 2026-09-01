# SHADOW Implementation Guardrails & Pending Specifications

## Why this file exists

Design discussions have moved ahead of implementation in several areas.

Codex must distinguish:

```text
LOCKED
CONCEPTUALLY APPROVED
PENDING SPECIFICATION
FUTURE
```

and must not silently invent missing behavior.

---

# Locked for implementation

## Product direction

- SHADOW = Investigation Workbench.
- SHADOW/ECHO/SPECTRA are frontend experience boundaries, not backend service silos.
- Target Profile is SHADOW's central target workspace.
- Results/search history persist according to source-specific retention policy.
- Resource Inspector is a shared interaction primitive.
- Icon-first left rail.
- Clean Tactical Intelligence design language.
- Progressive disclosure:
  - summary;
  - Inspector;
  - deep dive.
- Adaptive Investigation Stage.
- Investigation Resource Canvas specification v1.
- Canvas is target-centric and not ECHO's Knowledge Graph.
- Semantic status colors and interaction language.

---

# Conceptually approved but not yet fully specified

## Activity Timeline

Approved concepts only:

```text
same target context
same ResourceRef selection
cross-lens focus
source/platform temporal activity
shared Inspector
lazy loading
provenance
partial/completeness
```

**Do not implement a final Timeline UI yet.**

A dedicated `Activity Timeline Design Specification` will be provided later.

## Geospatial Map

Approved concepts only:

```text
same target context
source observations and routes
shared Inspector
authorization-aware geometry
lazy loading
cross-lens focus
```

**Do not implement advanced Map UX yet.**

A dedicated `Geospatial Map Design Specification` will be produced separately.

---

# Rich source deep dives

The following are design directions, not immediate implementation permission:

```text
Strava Intelligence
Google Maps Intelligence
LinkedIn Intelligence
GitHub Intelligence
```

Implement a deep dive only after:

1. source contract is understood;
2. source is approved for use/storage;
3. normalized read model exists;
4. capability warrants a dedicated page;
5. an implementation task is represented in backlog/plan.

Do not create provider-specific pages based only on provider name.

---

# Source-specific gates

## Person Lookup source (`leaked-service` / Hono)

`leaked-service` and the previously named Resident Hono API are the same technical service.

Always:

```text
Platform
→ Person Lookup Connector
→ leaked-service / Hono API
→ Elasticsearch
```

Never direct Elasticsearch access and never implement a duplicate connector for the same service.

## OSINT Industries

- API key only in worker/secret handling.
- raw permanent response storage disabled by default.
- normalized persistence still requires contract/retention decision.
- provider output is not canonical identity truth.

## user-scanner

Positive platform presence is an Observation/signal, not proof of account ownership.

## twitter-scrapper-api

Deferred.

The underlying person dataset still requires explicit provenance, permitted-use, retention and masking documentation. Do not infer governance status solely from the repository name.

---

# Design must not override domain truth

Never implement UI shortcuts such as:

```text
provider found account
→ mark CONFIRMED

map event
→ PERSON LOCATED_AT location

analysis match
→ canonical relationship

click candidate
→ create Entity automatically
```

All promotion/confirmation must respect the domain review/resolution rules.

---

# Mock/data policy

Development fixtures:

```text
synthetic only
```

No production fallback to mock data.

Do not commit:

```text
real API responses with PII
real Resident data
real leaked/breach records
OSINT Industries API keys
```

---

# Initial coding sequence

Design documents do **not** replace the engineering dependency plan.

Start with:

```text
M0 Engineering Ready
```

Then follow domain/backlog dependencies.

Do not jump directly to a high-fidelity Canvas backed by fake business architecture.

SHADOW frontend can be added incrementally when the corresponding domain contracts/read models exist.
