# Frontend Product Boundary Guide

## Structure

```text
apps/platform-web/src/
├── shell/
├── products/
│   ├── shadow/
│   ├── echo/
│   └── spectra/
└── shared/
```

## Allowed dependencies

```text
SHADOW ─┐
ECHO ───┼→ api-client / contracts / ui / canvas-kit
SPECTRA ┘
```

Forbidden:
```text
shadow/... import echo/...
echo/... import spectra/...
spectra/... import shadow/...
```

## Shell state

Global only:
- auth user;
- workspace;
- current Case;
- permissions;
- navigation;
- notifications;
- realtime connection.

Product local:
- SHADOW workflow interactions;
- ECHO graph selection/layout state;
- SPECTRA activity filters/timeline state.

## Server state

Use TanStack Query for API-backed state.

Do not copy canonical API data into Zustand as a second cache unless there is a concrete UI interaction requirement.

## Cross-product navigation

Use `DeepLinkTarget`.

Do not persist physical URLs in domain data.

## Realtime

Shell can own one SSE connection.

Events should:
- invalidate/refetch scoped query;
- update lightweight progress;
- not replace canonical data.

## High-volume UX

### ECHO
- graph neighborhood/focused expansion;
- aggregate activity edges;
- lazy inspector detail;
- do not render every social post as node.

### SPECTRA
- cursor pagination;
- virtualized lists where required;
- server-side aggregation;
- image/media lazy loading.

### SHADOW
- summaries/read models;
- do not fetch full ECHO/SPECTRA detail for Case overview.

## Sensitive fields

Render server-provided:
```text
FULL/MASKED/MATCH_ONLY/HIDDEN
```

Never reconstruct hidden values or apply security policy solely in frontend.

## Untrusted evidence

Prefer text rendering.
If HTML is required, use a reviewed sanitization/isolation strategy.
Never render source scripts.

## Error UX

Use stable error code for behavior.
Show requestId for support on unexpected errors.
Do not display stack traces/source raw error.
