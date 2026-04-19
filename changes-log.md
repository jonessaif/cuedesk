# CueDesk Change Log

Date: 2026-04-20

## Summary (Recent Major Updates)
- Added dashboard request consolidation and dedupe caching:
  - `GET /api/dashboard-live` combines tables + unpaid + completed + all sessions.
  - short in-memory TTL cache for concurrent request sharing.
- Refactored Reports APIs and page behavior:
  - new unified endpoints: `GET /api/ledger?date=YYYY-MM-DD`, `GET /api/analytics?date=YYYY-MM-DD`
  - reports tab lazy loading with background prefetch and per-date caching.
- Added Customer Insights:
  - `GET /api/customer-insights`
  - new page: `/reports/customers`
  - payer-identity based spend/visits/recency metrics, high-value and at-risk segmentation.
- Added Daily Closing module:
  - API: `/api/reports/daily-closing`
  - page: `/reports/daily-closing`
  - opening carry-forward logic, business-day aligned calculations, live closing preview.
- Extended Daily Closing inputs:
  - food sales (cash/bank/due)
  - food due-received (cash/bank)
  - accessories sales (cash/bank/due)
  - total and summary breakdown updates.
- Added Expenses module:
  - APIs: `/api/expenses/categories`, `/api/expenses/categories/[id]`, `/api/expenses/entries`
  - page: `/reports/expenses` with category management, entry rows, filters, and quick date presets.
- Added operational scripts:
  - `backfill:daily-closing`
  - `backfill:expenses`
  - `package:server`
  - benchmark scripts for sequential + concurrent API latency tests.

## Notes
- Recent docs are now captured in `README.md` under Core Features, Project Structure, Scripts, and Key API Endpoints.
- Older 2026-04-12 entries remain below for historical setup context.

Date: 2026-04-12

## Summary
This document records the implementation work completed so far for CueDesk, following the requested backend-first and strict TDD flow.

## Files Created
- `tdd-plan.md`
- `package.json`
- `package-lock.json`
- `.npmrc`
- `.env`
- `tsconfig.json`
- `next.config.ts`
- `next-env.d.ts`
- `vitest.config.ts`
- `prisma/schema.prisma`
- `src/tests/tables.test.ts`
- `src/lib/tables-service.ts`
- `src/lib/prisma.ts`
- `src/app/api/tables/route.ts`
- `src/app/page.tsx`

## Requirements + Planning
- Read `prd.md` and `design.md` completely.
- Extracted and documented:
  - Core entities
  - Key workflows
  - API requirements
  - System constraints
- Created `tdd-plan.md` with fixed implementation order:
  1. Tables
  2. Sessions
  3. Timer logic
  4. Payer system
  5. Billing
  6. Payments

## Project Setup
- Initialized Node project and scripts.
- Added dependencies for:
  - Next.js
  - Prisma
  - SQLite (via Prisma datasource)
  - Vitest
  - TypeScript
- Created required source folders:
  - `src/app`
  - `src/components`
  - `src/lib`
  - `src/api`
  - `src/tests`
  - `prisma`

## Prisma/Data Model Work
- Implemented schema in `prisma/schema.prisma` for:
  - `tables`
  - `sessions`
  - `bills`
  - `payments`
- Added enums:
  - `PayerMode`
  - `SessionStatus`
  - `PaymentMode`
- Added table/session/payment indexes where needed.

## Tables Module (Strict TDD)

### Tests Written First
`src/tests/tables.test.ts` includes:
- should create table successfully
- should reject duplicate table name
- should reject non-positive rate per minute
- should list all tables with rate and derived dashboard state

### Red Phase (Fail First)
- Initial test run failed because `@/lib/tables-service` did not exist.

### Green Phase (Minimal Implementation)
Implemented `src/lib/tables-service.ts`:
- `createTable(prisma, input)`
  - validates name
  - validates positive `ratePerMin`
  - checks duplicate table name
  - creates table
- `listTablesWithState(prisma)`
  - fetches tables and latest session
  - derives dashboard state mapping:
    - Free
    - Running-NoPayer
    - Running-Single
    - Running-Split
    - Completed (Unbilled)
    - Billed

### API Integration (Backend-first)
Implemented `src/app/api/tables/route.ts`:
- `GET /api/tables` -> list table dashboard rows
- `POST /api/tables` -> create table

Implemented shared Prisma client in `src/lib/prisma.ts`:
- singleton Prisma client pattern for Next.js runtime.

## Test Results
Latest run:
- Command: `npm test`
- Result: 1 file passed, 4 tests passed
- File: `src/tests/tables.test.ts`

## Notes / Known Issue
- `prisma db push` currently fails in this environment with generic:
  - `Error: Schema engine error:`
- To keep progress unblocked, Tables tests were kept as fast unit tests using a Prisma-shaped mock.
- Prisma schema and API structure are already in place for transition to DB-backed integration tests once the environment issue is resolved.

## Next Planned Step
- Continue strict TDD with module #2: Sessions.
