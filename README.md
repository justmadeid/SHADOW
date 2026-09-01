# Investigation Intelligence Platform

Repository bootstrap for the Investigation Intelligence Platform.

## Start

```bash
corepack enable
pnpm install
cp .env.example .env
cp infrastructure/compose/.env.infrastructure.example infrastructure/compose/.env.infrastructure
```

Read:

```text
CODEX_START_HERE.md
AGENTS.md
```

before implementation.

## Local infrastructure

```bash
pnpm dev:infra
pnpm dev:infra:check
```

## Database

```bash
pnpm migrations:validate
pnpm db:migrate
```

## Development

```bash
pnpm dev
```

## Quality

```bash
pnpm check:architecture
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:contract
pnpm test:integration
pnpm contracts:lint
pnpm migrations:validate
pnpm build
```

M0 is not complete until `docs/engineering/M0_ENGINEERING_READY_GATE.md` passes.
