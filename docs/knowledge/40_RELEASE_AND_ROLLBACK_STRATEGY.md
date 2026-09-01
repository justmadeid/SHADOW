# Release & Rollback Strategy

## 1. Principle

Application rollback must not depend on reversing destructive database changes.

Prefer forward-compatible migrations.

## 2. Deployment order for schema change

Typical:
1. deploy additive DB migration;
2. deploy backward-compatible code;
3. backfill asynchronously if required;
4. switch reads/feature flag;
5. observe;
6. remove deprecated shape in later release.

## 3. Worker compatibility

During rolling deploy:
- old/new workers may coexist;
- ExecutionPlan/event schemas need compatible versioning;
- connector checkpoint version prevents incompatible resume;
- analysis/connector definition version pinned in Run.

## 4. Search mapping change

Use versioned index:
```text
investigation-vN
```

Rebuild/backfill then atomically switch alias where practical.

Canonical DB remains truth.

## 5. Feature flags

Use for risky behavior rollout:
- new connector;
- new analysis;
- new UI workflow;
- new projection.

Feature flag is not authorization.

## 6. Rollback triggers

Examples:
- broken authorization;
- data corruption;
- runaway queue/job duplication;
- major latency/error regression;
- incompatible migration;
- connector causing source abuse.

## 7. Emergency stop

Support:
- disable connector;
- pause monitoring schedules;
- stop dispatcher/worker profile;
- revoke service credential;
- feature flag read/write path.

Do not require destructive DB operation to stop a bad connector.

## 8. Release evidence

For production candidate keep:
- build SHA;
- migration version;
- OpenAPI version/hash;
- dependency lock;
- test results;
- security scan;
- rollout timestamp;
- rollback plan.
