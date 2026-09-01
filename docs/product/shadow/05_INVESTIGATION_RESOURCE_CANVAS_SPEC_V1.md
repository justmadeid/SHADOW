# SHADOW Investigation Resource Canvas
## Design & Interaction Specification v1

**Product:** SHADOW  
**Context:** Target Profile → Adaptive Investigation Stage  
**Lens label in UI:** `Canvas`  
**Internal/documentation name:** `Investigation Resource Canvas`  
**Status:** Proposed baseline to lock before implementation  
**Primary implementation candidate:** `@xyflow/react`

---

# 1. Purpose

The Investigation Resource Canvas is the target-centric exploration surface in SHADOW.

It should answer:

> **What resources, signals, accounts, discoveries, and observations have been found around this target, and how can the investigator explore them without losing context?**

The Canvas is **not**:

- the canonical Knowledge Graph;
- a workflow editor;
- a dump of every evidence item;
- a visualization of every row in the database.

The canonical relationship graph remains primarily an ECHO responsibility.

---

# 2. Product Boundary

## SHADOW — Investigation Resource Canvas

Target-centric:

```text
Target
→ identity resources
→ accounts
→ platforms
→ services
→ observations
→ discoveries
→ related entities
```

Question answered:

> What have we discovered around this target?

## ECHO — Knowledge Graph

Entity / Case-centric:

```text
Entity A
→ Relationship
→ Entity B
→ Organization
→ Event
```

Question answered:

> What canonical relationships exist in the investigation?

A SHADOW Canvas resource may expose `Open in ECHO` when the resource has canonical Entity/Relationship context.

---

# 3. Core Design Principles

1. **Sparse by default.**
2. **Groups before details.**
3. **Expand on investigator intent.**
4. **Click to inspect.**
5. **Double-click or explicit action to deep dive.**
6. **Focus to isolate.**
7. **Canvas shows context; Inspector shows detail.**
8. **Dedicated pages show depth.**
9. **Resource state matters more than provider branding.**
10. **No rainbow graph.**
11. **No raw evidence explosion by default.**
12. **Same interaction language as Timeline, Map, and Deep Dive pages.**

---

# 4. Canvas Shell

Recommended desktop structure:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ TARGET HERO / GLOBAL COMMAND BAR                                            │
├──────┬───────────────────────────────────────────────────────┬───────────────┤
│      │ CANVAS HEADER                                         │               │
│ ICON │                                                       │ RESOURCE      │
│ RAIL │             INVESTIGATION RESOURCE CANVAS             │ INSPECTOR     │
│      │                                                       │               │
│      │                                                       │               │
│      │                                                       │               │
│      │                                                       │               │
│      │ [canvas status]                     [zoom/minimap]     │               │
│      │                                                       │               │
│      │             [CONTEXT ACTION DOCK]                     │               │
├──────┴───────────────────────────────────────────────────────┴───────────────┤
│ OPTIONAL SYSTEM / SOURCE STATUS STRIP                                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

When the Inspector is closed, the Canvas expands.

---

# 5. Visual Character

The Canvas should feel:

```text
clean
technical
precise
tactical
calm
interactive
spatial
```

Avoid:

```text
cyberpunk neon
heavy glow
too many permanent controls
dense dashboard cards
random provider colors
large amounts of always-visible metadata
```

The background should use a near-black surface and a very subtle dot grid. The grid exists for spatial orientation, not decoration.

---

# 6. Canvas Header

Compact header example:

```text
DIGITAL FOOTPRINT
Ahmad Wijaya
18 resources · 12 links

[Search Canvas]   [Layers] [Filter] [Layout] [Focus]
```

Advanced options belong in popovers. Do not permanently expose every control.

---

# 7. Lens Consistency

Canvas exists inside the Adaptive Investigation Stage:

```text
Overview | Canvas | Timeline | Map
```

Shared state should include:

```text
selectedResource
focusResource
dateRange
sourceFilters
reviewState
```

Example:

```text
Canvas
select Strava
↓
Timeline
Strava highlighted
↓
Map
Strava routes highlighted
```

Changing lens should not unnecessarily reset investigation focus.

---

# 8. Investigation Resource — Presentation Concept

The Canvas uses a generic presentation abstraction called `Investigation Resource`.

This is **not** a new canonical domain super-entity and should not become a generic `investigation_resources` truth table.

Possible resources:

```text
Person Entity
Organization Entity
Social Account
Platform Profile
Email Identifier
Phone Identifier
Domain
Location Observation
Evidence
Discovery
Candidate
Source Observation
Analysis Result
```

---

# 9. Resource Canvas Node Contract

Conceptual presentation contract:

```ts
type ResourceCanvasNode = {
  resourceRef: ResourceRef;

  kind: ResourceKind;
  category: ResourceCategory;

  label: string;
  subtitle?: string;

  state: ResourceState;
  confidence?: ConfidenceLevel;

  icon?: IconRef;
  avatar?: ImageRef;

  source?: SourceRef;
  observedAt?: string;

  capabilities: ResourceCapability[];

  countSummary?: {
    observations?: number;
    evidence?: number;
    discoveries?: number;
    children?: number;
  };
};
```

Possible capabilities:

```text
INSPECT
EXPAND
FOCUS
OPEN_DETAIL
VIEW_TIMELINE
VIEW_MAP
VIEW_EVIDENCE
INVESTIGATE
OPEN_IN_ECHO
COMPARE
```

UI behavior should be capability-driven.

---

# 10. Resource State Vocabulary

Use one shared semantic state system:

```text
CONFIRMED
RESOLVED
OBSERVED
CANDIDATE
NEEDS_REVIEW
ANALYSIS
CONFLICTED
UNKNOWN
ARCHIVED
```

Semantic colors:

```text
Green   → Confirmed / Resolved
Cyan    → Observed / Selected / Active
Amber   → Candidate / Review / Partial
Purple  → Analysis / Inferred
Red     → Conflict / Critical
Gray    → Unknown / Inactive
```

Provider branding must never override semantic state.

---

# 11. Node Anatomy

Default node:

```text
┌────────────────────────┐
│ [icon/avatar]          │
│                        │
│ Resource Name          │
│ secondary label        │
│                        │
│ ● STATE                │
└────────────────────────┘
```

Default node should contain only high-value information.

Detailed fields belong in Inspector or deep-dive views.

Suggested sizes:

```text
default resource node: 176–220px wide
compact node:          144–176px wide
target anchor:         220–260px wide
```

Nodes should not become mini dashboards.

---

# 12. Target Anchor Node

The current target is the primary visual anchor.

```text
╭────────────────────────╮
│ [avatar]               │
│                        │
│ Ahmad Wijaya           │
│ PERSON-A               │
│                        │
│ ● RESOLVED             │
╰────────────────────────╯
```

Optional target markers:

```text
PRIMARY TARGET
RELATED TARGET
PERSON OF INTEREST
```

The target node should remain visually stable across layout changes.

---

# 13. Resource Categories

Recommended initial categories:

```text
IDENTITY
SOCIAL
PROFESSIONAL
ACTIVITY
LOCATION
DEVELOPER
DIGITAL SERVICES
DOMAINS
RELATED ENTITIES
```

Categories are investigative presentation groupings, not provider groupings.

---

# 14. Category Group Node

Default Canvas should show category groups before provider details.

```text
╭────────────────────────────╮
│ ACTIVITY                   │
│                            │
│ 2 resources                │
│ 18 observations            │
│                            │
│ Strava · Google Maps       │
╰────────────────────────────╯
```

Interaction:

```text
single click
→ Inspector

expand action
→ child resources
```

Group state stays neutral unless attention is required.

---

# 15. Progressive Expansion

Core rule:

> **Graph expands on intent, not on data volume.**

Default:

```text
PERSON-A
├── SOCIAL
├── ACTIVITY
├── PROFESSIONAL
└── DIGITAL SERVICES
```

Expand `ACTIVITY`:

```text
ACTIVITY
├── Strava
└── Google Maps
```

Expand `Google Maps` only when needed:

```text
Google Maps
├── Observed Places
├── Reviews
└── Timeline Activity
```

Do not render all reviews, locations, or activities automatically.

Nodes that support expansion must expose a visible affordance such as `+12`, branch icon, or chevron. Double-click should not be the only discoverable expansion method.

---

# 16. Platform Resource Nodes

Example Strava:

```text
╭──────────────────────────╮
│ [STRAVA]                 │
│                          │
│ @username                │
│ 12 activities            │
│                          │
│ ● OBSERVED               │
╰──────────────────────────╯
```

Example Google Maps:

```text
╭──────────────────────────╮
│ [MAPS]                   │
│                          │
│ 12 reviews               │
│ 8 observed places        │
│                          │
│ ● OBSERVED               │
╰──────────────────────────╯
```

Provider brand colors should mainly live inside the provider logo. SHADOW owns the node container style.

---

# 17. Candidate Node

Candidate resources must be visually distinct.

```text
╭ - - - - - - - - - - ╮
  [GitHub]

  ahmadwijaya

  ● CANDIDATE
╰ - - - - - - - - - - ╯
```

Candidate uses Amber semantics and should expose `Review`, `Compare`, or `Investigate` via Inspector/context actions.

---

# 18. Unknown Discovery Node

```text
╭ - - - - - - - - - - ╮
  UNKNOWN PERSON

  Budi Santoso?

  DISCOVERED 35m ago
╰ - - - - - - - - - - ╯
```

Primary actions:

```text
Investigate
Link Existing
Ignore
```

If `Investigate` creates a Subject, the visual state may transition:

```text
DISCOVERY → SUBJECT
```

without deleting discovery history.

---

# 19. Evidence, Observation, and Analysis Layers

Default visible layers:

```text
Entities
Accounts / Profiles
Discoveries
```

Hidden by default:

```text
Evidence
Observations
Analysis
```

This avoids graph noise while preserving deeper investigation options.

Analysis nodes must use Purple semantics and must never appear equivalent to confirmed knowledge.

---

# 20. Edge Semantics

Standardize edge meaning:

```text
solid
→ confirmed / curated

dashed
→ candidate relationship

dotted
→ observed / source-derived

purple dashed
→ analysis inference

red segmented
→ conflict
```

The same semantic model should be reusable in ECHO where appropriate.

Unselected edges should remain low contrast.

---

# 21. Edge Labels and Bundling

Edge labels are hidden by default.

Show when:

- edge hovered;
- connected node selected;
- Focus Mode active;
- user enables `Show Labels`.

Repeated observations aggregate instead of producing many parallel edges.

Bad:

```text
Person → Observation 1 → Maps
Person → Observation 2 → Maps
Person → Observation 3 → Maps
```

Preferred:

```text
Person ───── Google Maps
             12 observations
```

Inspector/expansion reveals detail.

---

# 22. Hover State

Hover behavior:

```text
slightly stronger border
connected edges increase contrast
connected nodes remain clear
minimal tooltip / quick action appears
```

Do **not** open Inspector automatically on hover.

Potential quick actions:

```text
ⓘ Inspect
↗ Open
```

---

# 23. Selected State

Selected node:

```text
cyan/green precision border
subtle low-radius glow
```

Suggested emphasis:

```text
selected node       100%
connected nodes     100%
unrelated nodes      55–70%
```

Inspector opens on selection.

---

# 24. Focus Mode

Focus Mode isolates a resource and its relevant neighborhood.

```text
FOCUS: STRAVA

12 observations
5 evidence
8 timeline events

[Timeline] [Map] [Exit Focus]
```

Canvas behavior:

```text
focus resource      100%
connected resources 100%
unrelated resources 15–20%
```

Default focus depth: one hop.

Possible later option:

```text
1 hop | 2 hops
```

---

# 25. Canvas-Local Breadcrumb

Nested exploration may show:

```text
Ahmad Wijaya / Activity / Strava
```

This is a local Canvas breadcrumb and must not replace the application breadcrumb:

```text
CASE-024 / Ahmad Wijaya / Canvas
```

---

# 26. Search Canvas

Floating search:

```text
Search canvas...
```

Searchable fields may include:

```text
resource label
alias
platform
domain
entity label
identifier display value when authorized
```

Selecting a result:

```text
pan/zoom to resource
select node
open Inspector
```

---

# 27. Layer Control

Floating control:

```text
Layers ▾
```

Initial options:

```text
✓ Entities
✓ Accounts / Profiles
✓ Discoveries

○ Evidence
○ Observations
○ Analysis
```

Do not use a permanent layer sidebar.

---

# 28. Filter Control

Filters:

```text
Resource Type
Category
State
Source
Confidence
Classification
Observed Date
```

Active filters appear as removable chips:

```text
[Source: OSINT Industries ×]
[State: Candidate ×]
```

---

# 29. Layout Control

Initial layout strategies:

```text
Auto
Radial
Hierarchy
Free
```

Recommended default:

```text
Auto / Category Hierarchy
```

Behavior:

- target anchor stable;
- category groups distributed around target;
- children stay near parent;
- manually moved nodes should not immediately snap back.

Saved layout may come later and remains a presentation preference, not canonical knowledge.

---

# 30. Contextual Action Dock

A floating bottom dock appears only when a resource is selected.

Normal selection:

```text
[Inspect] [Timeline] [Map] [Open Detail] [•••]
```

Candidate:

```text
[Inspect] [Compare] [Investigate] [Review] [•••]
```

Entity:

```text
[Inspect] [Evidence] [Focus] [Open ECHO] [•••]
```

Maximum visible actions: around 4–5.

The rest belongs in overflow.

---

# 31. Multi-Select

Support later/advanced interaction using:

```text
Shift + click
selection box
```

Multi-select action dock:

```text
[Compare]
[Focus]
[Shared Evidence]
[Add to Dataset]
[•••]
```

Do not introduce arbitrary relationship creation in Canvas MVP unless relationship semantics are explicitly designed.

---

# 32. Universal Resource Inspector

Canvas uses the same Inspector primitive as Timeline and Map.

Inspector anatomy:

```text
RESOURCE TYPE
NAME / ID
STATE

SUMMARY

KEY INFORMATION

SOURCE / PROVENANCE

RELATED RESOURCES

INVESTIGATION CONTEXT

ACTIONS
```

Do not create separate Canvas/Timeline/Map detail panels.

---

# 33. Inspector Example — Strava

```text
ACCOUNT INSPECTOR

STRAVA
@username

● OBSERVED

SUMMARY
12 activities
Last observed 24 Aug

SOURCE
OSINT Industries

EVIDENCE
5 linked items

[Open Strava Intelligence]

Timeline
Map
Evidence
View Provenance
```

---

# 34. Inspector Example — Candidate

```text
ACCOUNT CANDIDATE

GitHub
ahmadwijaya

● CANDIDATE

MATCH SIGNALS
Username     HIGH
Name         MEDIUM

SOURCE
OSINT Industries

[Review Candidate]

Compare
View Evidence
View Provenance
```

---

# 35. Deep-Dive Navigation

Deep-dive pages must preserve Canvas return state.

Example starting state:

```text
view = canvas
selected = Strava
focus = Activity
```

Open:

```text
Strava Intelligence
```

Back:

```text
← Target Profile
```

Restore as much as practical:

```text
view
selected resource
focus group
zoom / pan
```

---

# 36. Minimap & Navigation Controls

Minimap should only appear when useful.

```text
small graph
→ hidden

large graph
→ available
```

Bottom/right controls:

```text
+
−
Fit
Center Target
Minimap
```

Keyboard suggestions:

```text
+ / -  zoom
F      fit
C      center target
Esc    exit focus / close inspector
```

---

# 37. Canvas Status Metadata

Optional tactical metadata at bottom-left:

```text
18 nodes · 12 links · 82%
```

Compact alternative:

```text
N:18  E:12  Z:82%
```

Prefer readable format by default.

---

# 38. Empty, Loading, Partial, Error States

## Empty

```text
No connected investigation resources yet.

Run enrichment or account discovery to expand this target.

[Enrich Target]
[Find Accounts]
```

## Loading

```text
Loading target footprint...
```

Use staged loading/skeleton nodes.

## Partial

```text
Canvas generated from partial source coverage.

3 / 4 sources complete
user-scanner unavailable
```

The Canvas remains usable.

## Error

```text
Canvas projection unavailable.

Target data remains accessible from Overview and Evidence.

[Retry Canvas]
```

Canvas failure must not break the Target Profile.

---

# 39. Permission-Aware Rendering

Nodes and Inspector must obey backend visibility:

```text
FULL
MASKED
MATCH_ONLY
HIDDEN
```

Example:

```text
National ID
••••8291
```

or:

```text
Exact Identifier Match
```

Never leak hidden values through tooltip, label, or URL.

---

# 40. Tactical Motion

Suggested durations:

```text
hover              100–140ms
selection          120–160ms
expand/collapse    180–240ms
focus transition   180–260ms
layout transition  220–320ms
```

No looping connector animations.

Respect reduced-motion preferences.

---

# 41. Accessibility

Requirements:

- keyboard-selectable nodes;
- status not represented by color alone;
- visible focus state;
- accessible labels for provider icons;
- Inspector keyboard navigation;
- reduced motion support;
- WCAG AA text contrast;
- controls remain usable at zoom changes.

---

# 42. Responsive Strategy

## >= 1440px

```text
icon rail
canvas
persistent inspector
```

## 1200–1439px

```text
compact rail
canvas
collapsible inspector
```

## 1024–1199px

```text
rail collapsed
canvas
inspector drawer
```

## <1024px

Reduced capability mode for MVP. Desktop remains primary.

---

# 43. Performance Rules

Default Canvas must **not** load:

```text
all Evidence
all Observations
all Timeline events
all Map features
all SourceRecords
```

Use summary/projection nodes and progressive expansion.

Suggested UX targets before benchmarking:

```text
default visible nodes       <= 30
comfortable expanded view  <= 75
strong grouping pressure   > 100
```

These are provisional and should be revised through real performance testing.

---

# 44. Backend Read Model

Recommended read model:

```text
TargetCanvasView
```

Concept:

```ts
type TargetCanvasView = {
  root: CanvasRoot;
  groups: CanvasGroup[];
  nodes: ResourceCanvasNode[];
  edges: ResourceCanvasEdge[];

  availableLayers: CanvasLayer[];
  availableLayouts: CanvasLayout[];

  counts: {
    nodes: number;
    edges: number;
    hiddenByGrouping: number;
  };

  completeness: "COMPLETE" | "PARTIAL" | "UNKNOWN";

  freshness: {
    generatedAt: string;
    projectionRevision?: string;
  };
};
```

Frontend should not assemble the graph by joining many unrelated APIs itself.

---

# 45. Edge Contract

```ts
type ResourceCanvasEdge = {
  id: string;

  source: ResourceRef;
  target: ResourceRef;

  semantic:
    | "CONFIRMED"
    | "CANDIDATE"
    | "OBSERVED"
    | "ANALYSIS"
    | "CONFLICT";

  label?: string;
  evidenceCount?: number;
  observationCount?: number;

  relationshipRef?: ResourceRef;
  candidateRef?: ResourceRef;
};
```

---

# 46. Expansion / Focus API Concepts

Initial Canvas:

```text
GET TargetCanvasView
?depth=1
```

Expansion:

```text
GET Canvas Expansion
?resource=<resourceId>
```

Focus on large graph:

```text
GET TargetCanvasView
?focus=<resourceId>&depth=1&layers=...
```

Small-graph focus may remain client-side.

---

# 47. @xyflow/react Component Mapping

Likely node types:

```text
TargetNode
ResourceGroupNode
PlatformResourceNode
EntityResourceNode
CandidateResourceNode
EvidenceNode
AnalysisNode
ObservationNode
```

Edge types:

```text
ConfirmedEdge
CandidateEdge
ObservedEdge
AnalysisEdge
ConflictEdge
```

All variants should use shared base components and semantic design tokens.

---

# 48. Do Not Build Provider Components Per Brand

Avoid:

```text
StravaNode
LinkedInNode
TikTokNode
GoogleNode
GitHubNode
```

unless behavior is truly unique.

Preferred:

```text
PlatformResourceNode
```

with provider-specific data supplied through:

```text
icon
label
state
summary
capabilities
```

This preserves visual and implementation consistency.

---

# 49. Node Rendering Architecture

Recommended:

```text
BaseResourceNode
    ↓
variant
    ├── Target
    ├── Group
    ├── Platform
    ├── Entity
    ├── Candidate
    ├── Evidence
    └── Analysis
```

`BaseResourceNode` owns:

```text
spacing
border
typography
selection
hover
state indicator
quick actions
accessibility
```

Variants add only resource-specific structure.

---

# 50. Shared Interaction Contracts

Canvas selection emits:

```ts
onResourceSelect(resourceRef)
```

Application shell owns the shared:

```text
ResourceInspector
```

The same model should be reused by:

```text
Canvas
Timeline
Map
Evidence Explorer
Search Results
```

Context actions should be generated from `capabilities`, not hard-coded per node.

---

# 51. URL / State Contract

Target route:

```text
/shadow/cases/:caseId/targets/:subjectId
```

Canvas lens:

```text
?view=canvas
```

Optional focus:

```text
&focus=<resourceId>
```

Never encode raw email, username, phone, restricted identifier, or provider payload in the URL.

---

# 52. MVP Scope

Canvas MVP should include:

```text
Target anchor
Category groups
Platform/resource nodes
Candidate/confirmed states
Basic semantic edges
Pan/zoom
Auto layout
Expand/collapse
Search canvas
Layer toggle
Focus mode
Inspector integration
Context action dock
Open Detail
Open ECHO
```

Not required initially:

```text
real-time collaboration
advanced graph clustering
complex edge bundling engine
saved layouts
multi-hop path analysis
evidence-heavy graph
AI overlays
manual arbitrary relationship creation
```

---

# 53. Acceptance Criteria

The Investigation Resource Canvas is successful when:

1. the target remains obvious at all times;
2. the initial Canvas remains understandable even with many provider results;
3. platform results are grouped by investigative meaning;
4. clicking a resource always follows the same Resource Inspector interaction;
5. expanding a group does not flood the Canvas;
6. candidate / observation / analysis / confirmed states are visually distinct;
7. provider branding never overrides semantic state;
8. the investigator can isolate a resource with Focus Mode;
9. Canvas selection can transfer naturally to Timeline and Map;
10. rich resources can open dedicated pages without losing return context;
11. provenance is reachable from every important resource;
12. partial source coverage does not make the Canvas unusable;
13. ECHO remains the canonical relationship exploration workspace.

---

# 54. Locked Baseline

```text
INVESTIGATION RESOURCE CANVAS

Target-centric
Sparse by default
Semantic grouping
Progressive expansion
ResourceRef-driven
Capability-driven interaction
Shared Resource Inspector
Semantic status system
Shared Canvas / Timeline / Map selection
Dedicated deep dives
ECHO boundary preserved
```

This specification should be treated as the design and implementation baseline before Canvas development begins.
