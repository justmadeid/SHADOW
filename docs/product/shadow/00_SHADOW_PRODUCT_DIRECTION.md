# SHADOW Product Direction v1

## Role

SHADOW is the **Case Command Center / Investigation Workbench** of the Investigation Intelligence Platform.

> **SHADOW discovers and investigates.**

It is the first product experience to prioritize because it proves the core investigation loop before ECHO and SPECTRA become useful.

SHADOW is a frontend/product boundary, **not a separate backend silo**.

Backend implementation remains domain-first:

```text
workspace
case
investigation
subject
resolution
entity-registry
workflow
execution
source-registry
evidence
dataset
analysis
knowledge
monitoring
intelligence
governance
audit
notification
```

Do not create a `shadow-api` business silo.

---

## North-star flow

```text
Create Case
→ Add Target
→ Search Workspace Entity Registry
→ Person Lookup / Enrichment
→ Persist Search Run + Source Results
→ Candidate Review
→ Resolve / Link Entity
→ Target Profile
→ Explore Digital Footprint
→ Save / Review Evidence
→ Discover Related Target
→ Investigate Related Target
```

Later this connects to:

```text
ECHO
→ curate canonical relationships

SPECTRA
→ continuous monitoring and activity analysis
```

---

## Product principles

1. Search results persist according to source-specific retention policy.
2. Source output does not automatically become canonical truth.
3. Target Profile is the central SHADOW working screen.
4. Search History / Search Memory is a first-class investigation feature.
5. The interface uses progressive disclosure:
   - summary;
   - Inspector;
   - dedicated deep dive.
6. Canvas, Timeline, and Map are lenses over the same target context.
7. SHADOW Canvas is target-centric discovery; ECHO owns canonical relationship exploration.
8. Provenance must be reachable from important displayed resources.
9. Partial source availability must degrade capability, not destroy the whole Target Profile.
10. The UI is **Clean Tactical Intelligence**, not a cyberpunk/hacker dashboard.

---

## First usable SHADOW experience

```text
Analyst opens Mission Control
→ opens Case
→ selects Target
→ Target Profile
→ runs lookup/enrichment
→ sees honest per-source progress
→ reviews persistent results
→ confirms/rejects candidates
→ returns later
→ search history/evidence/discoveries remain available
```

---

## Source order after foundations

Proposed source integration sequence:

```text
1. leaked-service / Hono Person Lookup API
2. OSINT Industries after contractual/retention review
3. user-scanner
4. twitter-scrapper-api later
```

This is a product/integration proposal, not permission to skip engineering dependencies or source governance.
