# CI/CD & Quality Gates

## Pull Request gates

Mandatory:
1. format/lint;
2. TypeScript typecheck;
3. backend/product dependency boundary check;
4. unit tests;
5. affected module integration tests;
6. OpenAPI/contract validation;
7. migration validation;
8. secret scan;
9. dependency vulnerability scan;
10. architecture gate checklist for affected domains.

Conditional:
- connector contract tests;
- E2E reference flow;
- performance smoke;
- search mapping validation;
- security tests.

## Branch/release gates

Before release:
- all migrations reviewed;
- backward compatibility checked;
- deployment order documented;
- no unresolved Critical/High security issue;
- performance regression reviewed;
- backup/restore status known;
- changelog/release notes;
- rollback plan.

## Architecture gate automation

Automate when possible:
- import graph rules;
- package boundary lint;
- direct cross-module infrastructure imports;
- forbidden public imports from `products/*`;
- raw SQL location conventions;
- OpenAPI breaking-change diff;
- migration destructive-operation detection.

## Test selection

Fast PR:
- lint/type/unit/affected integration.

Main branch:
- broader integration/contract.

Nightly:
- E2E reference flows;
- connector integration against safe test environments;
- load/performance;
- dependency/security deep scan.

Pre-production:
- smoke against deployed stack;
- migration compatibility;
- observability signals;
- critical access-control matrix.

## Deployment

Prefer:
- immutable build artifacts;
- environment config injected at deploy;
- health/readiness gating;
- staged rollout/canary where operationally useful;
- backward-compatible DB change first.

Never:
- mutate production DB manually as normal deployment mechanism;
- deploy untracked source connector credentials;
- skip audit/security test because feature is “internal”.
