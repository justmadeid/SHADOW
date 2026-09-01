# SHADOW Target Profile v2
## UI / UX Specification — Clean Tactical Intelligence Workbench

**Status:** Proposed baseline for design and implementation  
**Product:** SHADOW  
**Screen:** Target Profile  
**Primary goal:** Give an investigator one clean workspace to understand a target, explore connected data, inspect evidence, and progressively drill into rich platform-specific intelligence without overwhelming the main screen.

---

# 1. Product Intent

Target Profile is the central working screen in SHADOW.

It should answer four questions immediately:

1. **Who is this target?**
2. **What do we currently know about the target?**
3. **What new signals, accounts, locations, or activities have been discovered?**
4. **What should the investigator do next?**

The screen should feel like a **modern intelligence analyst workstation**: simple, clean, tactical, interactive, information-rich without being crowded, strong on provenance, and optimized for progressive exploration.

It should **not** become a giant dashboard containing every field returned by every source.

---

# 2. Core UX Principle — Progressive Tactical Interface

Information is disclosed in three levels.

## Level 1 — Summary
The Target Profile shows only what is required to understand the target quickly: identity, resolution state, confidence, source coverage, high-value accounts, latest evidence, discoveries, and activity signals.

## Level 2 — Inspector
Clicking a resource opens a persistent **Entity / Resource Inspector**. Use this when information can be understood quickly without leaving the current investigation context.

Examples: account candidate, identifier, evidence item, search result, discovery, timeline event, relationship candidate, location marker.

## Level 3 — Dedicated Deep Dive
Rich resources open a dedicated page.

Examples: Strava activity intelligence, Google Maps activity, LinkedIn career profile, GitHub activity, rich social profile, complex timeline, large evidence object.

```text
small information
→ Inspector

medium information
→ Inspector + Open Detail

rich / spatial / temporal information
→ Dedicated Page
```

---

# 3. Target Profile Layout

Recommended desktop structure:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ TOP COMMAND BAR                                                              │
├──────┬───────────────────────────────────────────────────────┬───────────────┤
│      │ TARGET HERO                                           │               │
│ ICON │                                                       │ RESOURCE      │
│ RAIL │ ADAPTIVE INVESTIGATION STAGE                          │ INSPECTOR     │
│      │                                                       │               │
│      │ SUPPORT MODULES                                       │               │
│      │                                                       │               │
├──────┴───────────────────────────────────────────────────────┴───────────────┤
│ OPTIONAL SYSTEM / SOURCE STATUS STRIP                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

The central area should remain visually dominant. The left navigation and right inspector must support the workbench, not compete with it.

---

# 4. Left Navigation — Icon-First Rail

Default width: `56–64px`.

Default state: icon only.

Interaction states:

- **Collapsed:** icons only.
- **Hover Reveal:** menu name, optional shortcut, optional submenu preview.
- **Active Expanded:** clicking/pinning a section expands contextual submenu.

Example:

```text
[Target icon]

Targets
────────────
All Targets
Primary Targets
Unresolved
Recent Discoveries
```

Suggested global icons:

```text
Mission Control
Cases
Search
Evidence
Review
Settings
```

Case-specific sections appear when context requires them. The rail should feel like an instrument toolbar, not a traditional enterprise sidebar.

---

# 5. Top Command Bar

```text
SHADOW
CASE-024 / Influence Network
TARGET / Ahmad Wijaya

          Search cases, targets, evidence...

+ Add Target
Review Queue
Alerts
User
```

Requirements:

- Case context always visible.
- Global search is internal platform search, not external OSINT search.
- `⌘K` / `Ctrl+K` opens Command Palette.
- Search supports target/entity/evidence/case navigation.
- Case switching is deliberate and highly visible.

---

# 6. Target Hero

Recommended content:

```text
[Avatar]

PRIMARY TARGET

Ahmad Wijaya

PERSON-A
RESOLVED
HIGH CONFIDENCE

Jakarta, Indonesia
Aliases: ...
Last enriched: 2 hours ago
```

Primary actions:

```text
Enrich
Find Accounts
Search
Monitor
More
```

Secondary/contextual actions:

```text
Open Canvas
Open Map
Open Timeline
Open in ECHO
Add Evidence
```

Recommended compact summary metrics:

```text
Identity Sources
Accounts
Evidence
Open Reviews
Discoveries
```

Maximum about 4–5 values.

---

# 7. Source Coverage Strip

```text
SOURCE COVERAGE

[Strava] [Google] [Maps] [LinkedIn] [GitHub] [TikTok] [Microsoft] ...
```

Each source icon has semantic state:

```text
confirmed/useful result
candidate
partial
no result
error
not searched
```

Click source → Source Inspector.  
Double click / Open Detail → platform-specific detail view.

This communicates breadth without filling the screen with platform cards.

---

# 8. Adaptive Investigation Stage

The center of Target Profile contains one large interactive stage.

Modes:

```text
Overview
Canvas
Timeline
Map
```

Suggested selector:

```text
[ Overview ] [ Canvas ] [ Timeline ] [ Map ]
```

The stage keeps the same target context while changing the analysis lens.

---

# 9. Stage — Overview Mode

Overview is calm and selective.

Recommended content:

```text
Identity Snapshot
Top Accounts / Services
Recent Evidence
High-value Discoveries
Recent Search
Activity Summary
```

Avoid a wall of identical cards. Prefer an asymmetrical layout.

```text
┌─────────────────────────────────┬────────────────────────────┐
│ IDENTITY + ACCOUNT FOOTPRINT    │ RECENT DISCOVERIES         │
│                                 │                            │
│ central identity + source       │ Person B                   │
│ coverage visualization          │ Domain X                   │
│                                 │ Location signal            │
├─────────────────────────────────┼────────────────────────────┤
│ RECENT EVIDENCE                 │ ACTIVITY / NEXT ACTION     │
└─────────────────────────────────┴────────────────────────────┘
```

A mini platform footprint can appear in Overview, but not the full graph.

---

# 10. Stage — Canvas Mode

Canvas visualizes discovered platforms, accounts, identifiers, and related resources.

Center node:

```text
PERSON-A
Ahmad Wijaya
```

Connected nodes can include:

```text
Strava
Google
Google Maps
LinkedIn
GitHub
TikTok
Microsoft
Domains
Email
Phone
Related Entity
```

Node states:

```text
confirmed
candidate
observed
analysis-generated
unknown
```

Edge semantics:

```text
solid green/neutral = curated/confirmed

dashed amber = candidate

dotted cyan = observed/source-derived

dashed purple = analysis/inference

red segmented = conflict
```

### Canvas interactions

Single click:
```text
select node
→ open/update Inspector
```

Double click:
```text
open dedicated resource page if supported
```

Hover:
```text
highlight node
highlight connected path
show minimal tooltip
```

Context menu:

```text
Inspect
Open Detail
View Evidence
Open Timeline
Add to Investigation
Open in ECHO
```

Canvas supports zoom/pan and fit-to-selection. Do not render every evidence item as a node.

---

# 11. Stage — Timeline Mode

Timeline normalizes events from multiple platforms into one target activity view.

Supported event concepts:

```text
account registration
account update
profile update
social activity
map review/activity
sports activity
breach event
professional profile update
search discovery
evidence collection
investigator decision
```

Layout:

```text
Platform rows
+
shared horizontal time axis
```

Example:

```text
LinkedIn  ─────────■──────────────■
Maps      ───●─────●──────────●────
Strava    ─────▲──▲─▲──▲───────────
GitHub    ─────────◆──────◆─────────
TikTok    ───○──────────────○───────
```

Timeline controls:

```text
Platform filter
Event type filter
Date range
Zoom +/-
Fit range
Export selection
```

Click event → Timeline Event Inspector.

Inspector displays:

```text
platform
event
time
normalized fields
source
evidence
provenance
Open Platform Detail
```

---

# 12. Stage — Map Mode

Map is shown only when geospatial data exists.

Possible geospatial observations:

```text
Google Maps review locations
location-based source activity
Strava route/activity geometry
MapMyRun observations
other authorized geospatial observations
```

Use a dark tactical basemap.

Visual types:

```text
point markers
route polylines
clusters
time-filtered markers
area/heat summary
```

Controls:

```text
Sources
Time range
Layer selector
Cluster toggle
Fit target
Timeline sync
```

Click marker/route → Map Resource Inspector.

Important semantic rule:

```text
source-location observation
≠
automatic proof that the target was physically present
```

Preferred wording:

```text
Google Maps activity observed at Location X
```

Avoid definitive presence wording unless it has been assessed and promoted.

---

# 13. Universal Right Inspector

Recommended width: `320–380px`.

Anatomy:

```text
RESOURCE TYPE
RESOURCE NAME / ID
STATUS

KEY INFORMATION

SOURCE / PROVENANCE

RELATED RESOURCES

INVESTIGATION CONTEXT

ACTIONS
```

Resource types:

```text
Entity
Platform Account
Search Result
Candidate
Evidence
Observation
SourceRecord
Timeline Event
Location
Route
Relationship Candidate
Run
```

The Inspector is designed to preserve investigation context while exploring many items.

---

# 14. Inspector Behavior

- Single click → open/update Inspector.
- Click selected object again → keep Inspector, optionally focus object.
- Escape → close Inspector.
- Pin → keep Inspector while another resource is selected.
- Open Detail → navigate to dedicated page while preserving Case/Target context.

Possible later feature: Compare Mode.

---

# 15. Inspector vs Full Page Matrix

| Resource | Default | Full View |
|---|---|---|
| Identifier | Inspector | Rarely |
| Simple checker result | Inspector | No |
| Account candidate | Inspector | Optional |
| Evidence | Inspector | Yes if rich |
| LinkedIn | Inspector summary | Yes |
| GitHub | Inspector summary | Yes if rich |
| Strava | Inspector summary | **Yes** |
| Google Maps | Inspector summary | **Yes** |
| TikTok | Inspector summary | Yes when rich |
| WHOIS result | Inspector | Optional |
| Timeline event | Inspector | Source-specific |
| Location | Inspector | Map detail |
| RelationshipCandidate | Inspector | ECHO |
| Search Run | Inspector | Run Detail |

---

# 16. Support Modules

Recommended modules:

```text
Recent Findings / Discoveries
Recent Evidence
Recent Searches
Observation Notes
Open Reviews
```

Do not show all simultaneously if the viewport becomes crowded.

Priority:

```text
wide desktop:
Stage + right support column + Inspector when active

medium desktop:
Stage + support modules below + Inspector drawer
```

---

# 17. Search Memory

Search history is first-class.

```text
Recent Searches

OSINT Industries — Email
18 results
2h ago

Resident Lookup — Name
3 candidates
3h ago

user-scanner — Email Presence
7 observations
1d ago
```

Click → persisted Search Run / result set.

Search results remain part of investigation history according to source retention policy.

---

# 18. Platform-Aware Deep Dive Architecture

Dedicated page shell:

```text
Target context
Platform identity
Platform-specific primary visualization
Supporting metrics
Timeline
Evidence/provenance
Inspector
```

Route concept:

```text
/shadow/cases/:caseId/targets/:subjectId/sources/:sourceObservationId
```

or

```text
/shadow/cases/:caseId/targets/:subjectId/accounts/:accountId
```

Use canonical resource IDs instead of provider username in URLs.

---

# 19. Strava Deep Dive

Strava is a rich dedicated page.

## Hero

```text
STRAVA
Account
username
profile
account status
last observed
registered
activities
```

## Primary visualization

Full map:

```text
activity routes
start/end markers when available
selected activity highlight
time-filtered activity
```

## Activity rail

```text
date
activity type
distance
moving time
elapsed time
elevation
average speed
max speed
```

## Tactical cards

Only if supported by collected data:

```text
Activity Count
Observed Date Range
Total / Avg Distance
Typical Activity Time
Activity Frequency
Elevation Pattern
```

Click route → Route Inspector.

Route Inspector:

```text
timestamp
distance
moving time
elapsed time
elevation gain
average/max speed
source record
evidence links
```

Any recurring-route / anchor-area output is marked **ANALYSIS**, not fact.

---

# 20. Google Maps Deep Dive

Google Maps is map-first.

## Primary view

```text
dark map
review/activity markers
cluster support
time filter
```

## Marker detail

```text
location name
address
location category/tags
timestamp
rating
comment/review if present
source URL
```

## Side summary

```text
Observed Places
Reviews
Photos
Answers
Edits
Observed Date Range
```

Optional analysis layer:

```text
frequent area
category distribution
temporal activity pattern
```

These remain AnalysisResults.

---

# 21. LinkedIn Deep Dive

LinkedIn is profile/timeline-first.

Sections:

```text
Profile Summary
Current Company
Employment History
Education
Location
Followers
Profile Timeline
Related Organizations
Evidence
```

Suggested career timeline:

```text
Company A ───── 2020–2021
Company B ───────── 2021–...
Company C ─ 2023
```

Organizations should link to canonical Entity when resolved.

---

# 22. GitHub Deep Dive

If rich data exists:

```text
Profile
Repositories
Organizations
Languages
Contribution/activity timeline
Related domains/emails
Evidence
```

If only registration/presence exists:

```text
stay in Inspector
```

Dedicated pages are capability-driven, not platform-name-driven.

---

# 23. Platform Capability Registry

Frontend should not scatter provider-name conditionals everywhere.

Introduce:

```text
SourcePresentationCapabilities

hasProfile
hasTimeline
hasMap
hasRoute
hasRichActivity
hasCareerTimeline
hasMedia
hasContactHints
hasDedicatedPage
```

Example:

```text
Strava
hasProfile = true
hasTimeline = true
hasMap = true
hasRoute = true
hasRichActivity = true
hasDedicatedPage = true
```

Simple checker:

```text
hasProfile = false
hasTimeline = false
hasMap = false
hasDedicatedPage = false
```

This lets future connectors integrate without redesigning Target Profile.

---

# 24. Normalized Presentation Model

Do not render raw provider responses directly.

```text
Provider Response
→ SourceRecord
→ Observation
→ Connector Normalization
→ TargetProfile Source View
```

Conceptual UI model:

```text
PlatformObservation {
  resourceRef
  source
  platform
  status
  observedAt
  registered?
  lastSeen?
  profile?
  attributes[]
  timelineEvents[]
  mapFeatures[]
  media[]
  provenance
}
```

Provider-specific fields remain available in details when needed.

---

# 25. Source Semantics

Preserve meanings such as:

```text
Registered
Observed
Reported
Candidate
Attributed
Confirmed
Aggregated
Breach-related
```

Do not convert all provider `found` results into `Confirmed Account`.

Some results indicate registration; others are aggregator presence, breach occurrence, contact hints, profile matches, or candidates.

---

# 26. Breach Data Treatment

Breach-derived results should be visually distinct:

```text
BREACH OBSERVATION
```

not simply `ACCOUNT`.

Inspector can show:

```text
source/service
breach date
data classes
source reliability
query provenance
```

Never display or persist raw passwords/credentials in SHADOW UI.

---

# 27. Data Aggregator Treatment

Use a semantic label such as:

```text
AGGREGATED SIGNAL
```

with explanation that data presence does not necessarily prove direct account ownership.

Default behavior: Observation / Candidate, not confirmed relationship.

---

# 28. Interaction Rules

Single click → Inspect.  
Double click → Open Full Detail when supported.  
Hover → highlight + minimal context.  
Right click / overflow:

```text
Open Detail
View Provenance
Save Evidence
Add to Investigation
Create Candidate
Open Timeline
Open Map
Open in ECHO
```

Buttons should lead to meaningful depth instead of duplicating information on the current screen.

---

# 29. Tactical Visual Treatment

Keep:

```text
dark surfaces
precision borders
monospace metadata
subtle grid
compact icon rail
semantic status dots
thin canvas paths
map overlays
instrument-like hover feedback
```

Avoid:

```text
large neon glow
decorative cyber animations
many KPI cards
constant red
oversaturated gradients
tiny unreadable labels
```

Visual direction:

> **Clean Tactical Intelligence**

---

# 30. Color Semantics

```text
GREEN  confirmed / resolved / complete
CYAN   selected / active / observed
AMBER  candidate / review / partial
PURPLE analysis / inferred / model-generated
RED    conflict / failed / critical
GRAY   unknown / inactive / unavailable
```

Provider brand colors may appear in logos but should not control application status semantics.

---

# 31. Empty States

## No map data

```text
No geospatial observations are available for this target.

Map mode will become available when an authorized source produces location or route data.
```

## No timeline

```text
No temporal activity has been collected yet.
```

## No canvas relations

```text
No connected resources have been discovered yet.

Run enrichment or account discovery to expand this target.
```

---

# 32. Loading / Partial States

Target Profile remains usable when one source fails.

```text
Source Coverage

Resident          COMPLETE
OSINT Industries  PARTIAL
user-scanner      TIMEOUT
```

Map/Timeline/Canvas render available observations and clearly indicate incomplete coverage.

---

# 33. Permission-Aware Rendering

Inspector and deep-dive views obey:

```text
FULL
MASKED
MATCH_ONLY
HIDDEN
```

Authorization remains server-side.

---

# 34. Recommended Route Model

```text
/shadow/cases/:caseId/targets/:subjectId
```

Target mode:

```text
?view=overview
?view=canvas
?view=timeline
?view=map
```

Rich resources:

```text
/shadow/cases/:caseId/targets/:subjectId/sources/:sourceObservationId
```

or

```text
/shadow/cases/:caseId/targets/:subjectId/accounts/:accountId
```

Avoid sensitive/raw provider identifiers in URLs.

---

# 35. Component Hierarchy

```text
TargetProfilePage
TargetHero
SourceCoverageStrip
AdaptiveInvestigationStage

StageOverview
StageCanvas
StageTimeline
StageMap

IconNavigationRail
ResourceInspector

PlatformNode
RelationshipEdge
TimelineLane
TimelineEvent
MapLayerControl
MapObservationMarker
RoutePolyline

RecentDiscoveryList
RecentEvidenceList
RecentSearchList

SourceStatusBadge
ObservationStateBadge
ConfidenceIndicator
ClassificationBadge
ProvenanceBlock

OpenDetailAction
OpenTimelineAction
OpenMapAction
OpenInEchoAction
```

---

# 36. Read Model Requirement

Target Profile should use a dedicated backend read model.

```text
TargetProfileView
├── subject
├── entity?
├── identitySummary
├── sourceCoverage[]
├── accountSummary[]
├── evidenceSummary
├── discoverySummary
├── openReviewSummary
├── recentSearches[]
├── recentEvidence[]
├── recentDiscoveries[]
├── availableViews
└── freshness
```

Stage-specific data loads on demand:

```text
CanvasView
TimelineView
MapView
```

---

# 37. Performance Strategy

Default page loads summaries only.

Do not preload:

```text
all routes
all map markers
all timeline events
all source payloads
all evidence
```

Lazy loading:

```text
Open Canvas
→ fetch canvas neighborhood

Open Timeline
→ fetch paged/aggregated timeline

Open Map
→ fetch bounded map features

Open Strava
→ fetch activity-specific detail
```

---

# 38. MVP Scope for Target Profile v2

Implement first:

```text
Icon Navigation Rail
Target Hero
Overview
Source Coverage
Universal Inspector
Accounts Summary
Recent Evidence
Recent Searches
Recent Discoveries
Canvas basic
Timeline basic
```

Next:

```text
Map Mode
Strava Deep Dive
Google Maps Deep Dive
LinkedIn Deep Dive
```

Later:

```text
Advanced geospatial analysis
Route correlation
Cross-platform temporal correlation
Compare Inspector
AI analysis overlays
```

---

# 39. Acceptance Criteria

Target Profile v2 is successful when an investigator can:

1. identify the target and its current state within seconds;
2. see which sources/platforms produced useful information;
3. inspect important resources without losing context;
4. open a dedicated page when data is too rich for the Inspector;
5. switch between overview, canvas, timeline, and map while preserving target context;
6. trace displayed items back to source/provenance;
7. distinguish observation/candidate/analysis from confirmed knowledge;
8. return later and still see persisted searches/evidence/discoveries;
9. work with partial source availability;
10. use the interface for long sessions without excessive visual noise.

---

# 40. Design Decision to Lock

```text
ICON-FIRST NAVIGATION
+
CLEAN TARGET HERO
+
ADAPTIVE INVESTIGATION STAGE
  Overview / Canvas / Timeline / Map
+
PROGRESSIVE DISCLOSURE
+
UNIVERSAL RIGHT INSPECTOR
+
PLATFORM-AWARE DEEP DIVES
+
PROVENANCE-FIRST INTERACTIONS
```

This becomes the interaction foundation of SHADOW Target Profile.
