Read `CODEX_START_HERE.md` and `AGENTS.md`.

This is now the actual `intelligence-platform` monorepo scaffold, not a documentation-only folder.

Do not create another repository and do not start P1/SHADOW feature implementation.

Execute the M0 Engineering Ready validation in:
`docs/engineering/M0_ENGINEERING_READY_GATE.md`.

All mandatory architecture documents referenced by `AGENTS.md` are present under `docs/knowledge/`.

Inspect actual code first. For each failure:
1. report root cause;
2. check architecture/security constraints;
3. implement the smallest correct fix;
4. add/update regression coverage;
5. rerun the failed gate.

Important source clarification:
`leaked-service` == Hono Person Lookup / previously named Resident API.
Use one connector only, and never bypass it to query its Elasticsearch store.

Create `docs/engineering/M0_VALIDATION_REPORT.md`.

Only declare `M0 ENGINEERING READY` when all required M0 gates pass.
