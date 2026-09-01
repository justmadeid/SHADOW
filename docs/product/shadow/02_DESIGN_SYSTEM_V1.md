# SHADOW Design System v1
## Clean Tactical Intelligence

## Design identity

SHADOW should feel like:

```text
modern intelligence analyst workstation
```

not:

```text
cyberpunk hacker screen
gaming dashboard
generic SaaS KPI dashboard
```

Desired personality:

```text
Tactical
Precise
Analytical
Controlled
Dense when useful
Readable
Professional
Calm under pressure
```

---

## Theme

Dark is the primary design language.

### Core surfaces

```css
--bg-canvas: #090c10;
--bg-base: #0d1117;

--surface-1: #11161d;
--surface-2: #151b23;
--surface-3: #1b222c;
--surface-elevated: #202833;

--border-subtle: #232b35;
--border-strong: #343e4b;

--text-primary: #eef3f7;
--text-secondary: #a6b0bc;
--text-muted: #687382;
```

Avoid pure black as the primary working surface.

---

## Semantic signal colors

```css
--signal-green: #35e6a5;
--signal-cyan: #52c7ff;
--signal-purple: #a78bfa;
--warning: #f5b84b;
--danger: #ff5d6c;
```

Semantics:

```text
GREEN
confirmed / resolved / complete / healthy

CYAN
selected / active / observed

AMBER
candidate / needs review / partial / uncertain

PURPLE
analysis / inferred / machine-generated

RED
conflict / failed / critical / destructive

GRAY
unknown / inactive / archived
```

Provider brand colors may exist in logos. They must not replace SHADOW semantic state colors.

---

## Typography

Recommended UI family:

```text
Geist or Inter
```

Metadata accent:

```text
JetBrains Mono or IBM Plex Mono
```

Use monospace for:

```text
CASE-024
PERSON-A
RUN-0198
timestamps
source IDs
technical metadata
```

Do not render normal human-readable content entirely in monospace.

### Scale

```text
Resource / hero title   24–28px
Page title              20–22px
Section title           14–16px
Body                    13–14px
Table                   12–13px
Metadata                11–12px
Micro label             10–11px
```

Technical section labels may be uppercase with slight tracking.

---

## Spacing

4px base system:

```text
4
8
12
16
20
24
32
40
48
```

Typical:

```text
control gap     8
card gap        12
card padding    16
panel padding   20–24
section gap     24–32
```

---

## Radius

Restrained and slightly angular:

```text
small controls   4px
buttons          5–6px
cards            6px
large panels     8px
dialogs          8px
```

---

## Depth

Prefer:

```text
surface contrast
+
1px precision borders
```

over large shadows.

Use shadows mainly for:

```text
popover
dialog
floating inspector
command palette
```

Glow is allowed only as subtle selection/focus feedback.

---

## Density

Desktop-first default:

```text
compact
```

Suggested control sizes:

```text
table row          40px
metadata row       32px
nav item           36px
command item       40px
input              36px
primary button     36–40px
```

---

## Shell dimensions

Indicative desktop values:

```text
top command bar      48–52px
left icon rail       56–64px collapsed
right inspector      320–380px
bottom status strip  28–32px optional
```

---

## Button hierarchy

### Primary

Use sparingly for deliberate action:

```text
Run Search
Add Target
Link Existing
Review / Confirm
```

### Secondary

Bordered dark surface.

### Tertiary

Text/icon action.

### Danger

Red outline/subtle red surface.

Do not render every action as a primary button.

---

## Iconography

Use one consistent family such as Lucide.

Suggested stroke:

```text
1.5–1.75px
```

Custom resource glyphs may be introduced later, but should retain the same visual weight.

---

## Tactical details

Tactical character should come from:

```text
precision borders
subtle grid/dots
monospace IDs
semantic state dots
technical status strips
graph paths
map layers
timeline markers
instrument-like controls
```

not decorative neon.

---

## Resource Inspector visual grammar

Every Inspector follows:

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

The Inspector is shared across Canvas, Timeline, Map, Search Results, and Evidence.

---

## Status language

Never use color alone.

Good:

```text
● PARTIAL
● CANDIDATE
● RESOLVED
```

Bad:

```text
●
```

with no textual state.

---

## Motion

Functional only:

```text
hover              100–140ms
selection          120–160ms
panel              160–220ms
expand/collapse    180–240ms
graph/layout       220–320ms
```

Support reduced motion.

---

## Responsive approach

```text
>= 1440
full workstation

1200–1439
compact rail + collapsible inspector

1024–1199
collapsed rail + inspector drawer

<1024
reduced capability for MVP
```

Desktop is the primary investigation environment.

---

## Consistency rule

> Different information, same interaction language.

Across:

```text
Target Profile
Canvas
Timeline
Map
Strava
Google Maps
LinkedIn
Evidence
Search
```

preserve:

```text
same shell
same status semantics
same Inspector
same button hierarchy
same typography
same provenance component
same selection model
```
