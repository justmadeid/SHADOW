# Integration Notes

## Root `package.json`

Merge `package-scripts-snippet.json` into the root package manifest.

Do not blindly replace existing scripts.

## CI

The architecture job should run before expensive E2E/load jobs so forbidden
dependencies fail fast.

## Path aliases

The checker currently understands:

```text
@platform-web/* -> apps/platform-web/src/*
@platform-api/* -> apps/platform-api/src/*
@repo/*         -> repository root
```

If the repository adopts different aliases, update `resolveImport()` and add a
test in the same PR.

## Why both custom checker and dependency-cruiser?

Custom checker:
- source product identity vs target product identity;
- source backend module identity vs target backend module identity.

dependency-cruiser:
- circular dependencies;
- broad layer direction rules;
- shared package -> app violations;
- platform primitive -> business module violations.

They are intentionally complementary.

## Required future extension

When module aliases/package exports are finalized in P0-001/P0-004, add tests
covering those exact aliases.

When `packages/*` dependency layers become concrete, add explicit allowed/forbidden
package graph rules rather than guessing them early.
