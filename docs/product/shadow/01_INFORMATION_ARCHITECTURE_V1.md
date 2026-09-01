# SHADOW Information Architecture v1

## Mental model

The investigator should always understand the active context:

```text
Workspace
→ Case
→ Investigation
→ Subject / Target
→ Search / Evidence / Discovery / Decision
```

---

## Global IA

```text
SHADOW
├── Mission Control
├── Cases
├── Review Queue
└── Internal Search

Case Workspace
├── Overview
├── Targets
├── Discoveries
├── Evidence
├── Timeline
├── Runs
└── Intelligence

Target Profile
├── Overview
├── Investigation Resource Canvas
├── Activity Timeline
└── Geospatial Map
```

Detailed Identity, Accounts, Searches, Evidence, and Discoveries are surfaced through the Target Profile overview, Inspector, support modules, and dedicated views rather than forcing a large permanent tab set.

---

## Navigation shell

### Top command bar

Carries:

```text
SHADOW
Workspace / Case / Target context
Internal Search
Command Palette
Add Target
Review Queue
Alerts
User
```

Case context must remain highly visible.

### Left navigation

Default:

```text
icon-only rail
```

Behavior:

```text
hover
→ reveal label

active/click
→ reveal contextual submenu

pin
→ keep expanded where useful
```

The rail should feel like an instrument toolbar, not a traditional large enterprise sidebar.

### Right panel

Use one reusable:

```text
Resource Inspector
```

It can inspect:

```text
Entity
Account/Profile
Candidate
Evidence
Observation
SourceRecord
Search Result
Timeline Event
Location
Route
RelationshipCandidate
Run
```

---

## Screen responsibilities

### Mission Control

Answers:

> What needs my attention now?

High-value content:

```text
Active Cases
Open Reviews
Recent Discoveries
Failed / Partial Runs
Recent Evidence
Investigation Activity
```

Avoid vanity metrics.

### Cases

Efficient table-first case discovery.

Filters:

```text
status
classification
assignee
last activity
needs review
alerts
```

### Case Overview

Answers:

> What is the current investigation state?

Show:

```text
Targets
Evidence
Discoveries
Open Reviews
Recent Runs
Recent Intelligence
Needs Attention
```

### Targets

Shows resolved and unresolved Subjects clearly.

### Add Target

Guided flow:

```text
Known information
→ Workspace Entity search
→ Link Existing if appropriate
→ otherwise SubjectSeed
→ lookup/resolution
```

### Review Queue

Answers:

> What decision is waiting for me?

Potential items:

```text
Identity Candidate
Account Candidate
Relationship Candidate
Conflict
Knowledge Promotion
```

### Discoveries / Profile Inbox

Answers:

> What new thing did the system discover?

Examples:

```text
Unknown Person
New Account
Domain
Location signal
Relationship discovery
```

### Evidence Explorer

Three-panel pattern:

```text
Filters
Evidence List
Resource Inspector
```

### Runs

Execution status and failure/retry visibility without exposing raw internal secrets.

### Case Intelligence

Later:

```text
Hypotheses
Findings
Highlights
```

---

## Target Profile is the hero screen

The Target Profile must immediately answer:

```text
Who is this target?
What do we know?
What sources produced information?
What needs review?
What new signals appeared?
What should I do next?
```

Detailed target specification is in:

`03_TARGET_PROFILE_V2_SPEC.md`

---

## Global Internal Search vs OSINT Search

These are different concepts.

### Global internal search

Searches platform-owned authorized projections:

```text
Cases
Targets
Entities
Evidence
Findings
```

### External investigation search

Runs a Workflow/Run through authorized DataSource/Connector capability.

Do not merge both into one ambiguous search box.

---

## Consistent interaction rule

```text
single click
→ Inspect

double click / explicit Open
→ Detailed view

hover
→ Highlight / short preview

focus
→ Isolate context

Evidence
→ supporting material

Timeline
→ temporal lens

Map
→ spatial lens

ECHO
→ canonical relationship context
```

Every visual resource should follow the same interaction language.
