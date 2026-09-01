# SHADOW Adaptive Investigation Stage Specification v1

## Purpose

The Adaptive Investigation Stage is the central interactive area of Target Profile.

It provides multiple **lenses** over the same target context:

```text
Overview
Canvas
Timeline
Map
```

Documentation names:

```text
Overview
Investigation Resource Canvas
Activity Timeline
Geospatial Map
```

UI labels should remain simple:

```text
Overview | Canvas | Timeline | Map
```

---

## Key principle

These are not four unrelated pages.

They are four ways to inspect the same investigation target.

```text
TARGET
├── Overview  → What matters?
├── Canvas    → What is connected/discovered?
├── Timeline  → What happened when?
└── Map       → Where was source activity observed?
```

---

## Shared stage state

Conceptual state:

```ts
type InvestigationStageState = {
  targetId: string;
  mode: "overview" | "canvas" | "timeline" | "map";

  selectedResource?: ResourceRef;
  focusedResources: ResourceRef[];

  sourceFilters: string[];
  dateRange?: {
    from: string;
    to: string;
  };

  inspectorOpen: boolean;
};
```

Changing lens should preserve meaningful context.

Example:

```text
Canvas
select Strava
→ Timeline
Strava lane is highlighted
→ Map
Strava spatial features are highlighted
```

---

## Shared interaction language

```text
single click
→ Inspector

double click / Open Detail
→ dedicated page if capability exists

Focus
→ isolate relevant neighborhood/events/features

Timeline
→ temporal context

Map
→ spatial context

Evidence
→ supporting material

Open in ECHO
→ canonical Entity/Relationship context
```

---

## Stage availability

Not all lenses are always available.

Example new target:

```text
Overview    available
Canvas      available
Timeline    unavailable
Map         unavailable
```

After suitable observations arrive:

```text
Overview    available
Canvas      available
Timeline    available
Map         available
```

Disabled lens should explain why.

---

## Overview lens

Overview is calm and selective.

It should prioritize:

```text
Identity Snapshot
Source Coverage
High-value Resource Footprint
Open Attention / Review
Recent Evidence
Recent Discoveries
Next Investigation Action
```

Avoid a wall of KPI cards.

A small footprint visualization is allowed, but not the full Canvas.

---

## Canvas lens

Formal specification:

`05_INVESTIGATION_RESOURCE_CANVAS_SPEC_V1.md`

The Canvas is target-centric and progressively expandable.

---

## Timeline lens

Timeline remains conceptually defined here but its detailed Design Specification is intentionally **pending**.

Known constraints already approved:

- same target/resource selection as Canvas and Map;
- normalized temporal events rather than raw provider timeline UI;
- source/platform lanes may be used;
- event click opens the shared Resource Inspector;
- temporal observations remain source observations unless explicitly promoted;
- support provider activity such as account events, professional profile events, Strava activity, Google Maps activity, evidence events, and investigator decisions where appropriate;
- must support partial/completeness semantics;
- must lazy-load rather than preload every temporal event.

Do not invent final Timeline component anatomy, event taxonomy, zoom behavior, or advanced temporal correlation until the dedicated Timeline specification is approved.

---

## Map lens

Map remains conceptually defined here but its detailed Design Specification is intentionally **pending**.

Known constraints already approved:

- dark tactical map;
- map shown only when geospatial observations/features exist;
- same selected ResourceRef as Canvas/Timeline;
- markers/routes open the shared Resource Inspector;
- source observation at a location does not automatically mean canonical `PERSON LOCATED_AT PLACE`;
- geospatial data may require masking/generalization according to authorization;
- support source layers such as Google Maps observations and Strava routes when available;
- map data loads on demand.

Do not invent final Map controls, geospatial analysis, heatmaps, privacy heuristics, or route inference until the dedicated Map specification is approved.

---

## Platform-aware deep dives

Rich resources may leave the stage and open dedicated pages.

Examples:

```text
Strava
→ map/activity-rich intelligence view

Google Maps
→ geospatial/source activity view

LinkedIn
→ profile + career timeline view

GitHub
→ dedicated page only when source capability is rich enough
```

Dedicated pages retain:

```text
SHADOW shell
Case context
Target context
Resource Inspector
Design-system semantics
Back state
```

---

## SourcePresentationCapabilities

Frontend behavior should be capability-driven.

Concept:

```ts
type SourcePresentationCapabilities = {
  hasProfile: boolean;
  hasTimeline: boolean;
  hasMap: boolean;
  hasRoute: boolean;
  hasRichActivity: boolean;
  hasCareerTimeline: boolean;
  hasMedia: boolean;
  hasDedicatedPage: boolean;
};
```

Avoid provider-name conditionals scattered through the application.

---

## Loading strategy

Initial Target Profile:

```text
load TargetProfileView summary only
```

Then:

```text
Canvas selected
→ fetch TargetCanvasView

Timeline selected
→ fetch TargetTimelineView

Map selected
→ fetch TargetMapView
```

Do not preload all source payloads, routes, markers, events, or evidence.

---

## Navigation / deep-link concept

Target route:

```text
/shadow/cases/:caseId/targets/:subjectId
```

Lens:

```text
?view=overview
?view=canvas
?view=timeline
?view=map
```

Optional focus may use an opaque Resource ID.

Never place raw sensitive email/phone/username values into routes.

---

## Locked stage baseline

```text
Shared target context
Shared ResourceRef selection
Overview
Investigation Resource Canvas
Timeline placeholder until formal spec
Map placeholder until formal spec
Shared Resource Inspector
Cross-lens navigation
Capability-driven deep dives
Lazy stage data loading
Provenance-first interactions
```
