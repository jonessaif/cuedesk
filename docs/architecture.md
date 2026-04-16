# CueDesk Architecture

## 1. System Overview
CueDesk is a local-first operations system for cue sports venues. It runs as a single backend + web UI on LAN and stores all state in SQLite.

Flow:
1. UI calls API route
2. API validates and delegates to service
3. Service applies business rules and writes DB
4. UI refreshes from backend snapshots

## 2. Runtime Components
- **UI layer**: `src/app/page.tsx`
- **API layer**: `src/app/api/**/route.ts`
- **Auth provider**: `src/components/auth-provider.tsx`
- **Domain/service layer**: `src/lib/services/*.ts`
- **Derived state helpers**: `src/lib/session-status.ts`, `src/lib/state-machine.ts`
- **Authorization helpers**: `src/lib/authz.ts`
- **Persistence**: Prisma + SQLite (`prisma/dev.db`)

## 3. Data Model
Defined in `prisma/schema.prisma`.

### Table
- `id`, `name (unique)`, `ratePerMin`

### Session
- Core: `tableId`, `businessDayKey`, `playerName`, `startTime`, `endTime`, `status`, `amount`, `billId`
- Payer: `payerMode`, `payerData`
- Overrides:
  - time/rate: `overrideStartTime`, `overrideEndTime`, `overrideRatePerMin`
  - payer: `overridePayerMode`, `overridePayerData`
  - status: `overrideStatus`
  - payment display: `overridePaymentModes`

### Bill
- `totalAmount`
- discount fields: `discountType`, `discountValue`, `discountedAmount`
- relation to sessions and payments

### Payment
- `billId`, `mode`, `amount`, `createdAt`
- due lifecycle: `dueSettledAt`, `dueReceivedMode`, due customer fields

### DailyReport
- `businessDayKey`, `startAt`, `endAt`
- revenue: `subtotal`, `discount`, `net`
- collection: `cash`, `upi`, `card`
- status: `paid`, `unpaid`, `isBalanced`

## 4. Source-of-Truth Principles
1. Backend computes all business outcomes.
2. UI does not decide ledger/payment truth.
3. Billing linkage uses `billId != null`.
4. Effective session status uses override fallback:
   - `effectiveStatus = overrideStatus ?? status`
5. API authorization is backend enforced by role checks.

## 5. Session Lifecycle
Canonical progression:
1. `running`
2. `completed`
3. `billed`

Payment progress is bill-level and reflected in ledger state derivation (`Billed-Unpaid`, `Partially-Paid`, `Paid`).

## 6. Overrides Model
Overrides never mutate original session base fields for intent tracking. They act as effective-value layers.

Effective values:
- `effectiveStartTime = overrideStartTime ?? startTime`
- `effectiveEndTime = overrideEndTime ?? endTime`
- `effectiveRate = overrideRatePerMin ?? table.ratePerMin`
- `effectivePayerMode = overridePayerMode ?? payerMode`
- `effectivePayerData = overridePayerData ?? payerData`
- `effectiveStatus = overrideStatus ?? status`

## 7. Billing and Payment Architecture
### Bill Creation
- Input: session IDs (+ optional discount)
- Service recomputes effective session amount
- Links sessions to bill and sets `status = billed`

### Discount Handling
- Discount is bill-level only.
- Stored at bill row for consistency in payment and unpaid-list APIs.
- Effective totals are normalized via `src/lib/billTotals.ts`.

### Payment Handling
- Payment service validates:
  - bill exists
  - amount > 0
  - amount <= remaining discounted total
- Prevents overpayment using backend remaining calculation.

## 8. Table State Derivation
Derived in `tables-service` + `session-status`:
- `Free`
- `Running-NoPayer`
- `Running-Single`
- `Running-Split`
- `Completed (Unbilled)`
- `Billed`

## 9. Ledger Derivation
Derived from effective status + billing + payments (not UI math):
- `Running`
- `Completed`
- `Billed-Unpaid`
- `Partially-Paid`
- `Paid`

Business-day reporting derives summary buckets:
- Revenue: `subtotal`, `discount`, `net`
- Collection: `cash`, `upi`, `card`, `due`, `dueReceived`
- Status: `paid`, `unpaid`, `total`, `isBalanced`

`dueReceived` is already included inside cash/upi/card and shown as breakdown only.

## 10. Special Pricing Rule
PS tables (`name` starts with `PS`) use hourly bucket billing:
- billed hours = `ceil(durationMs / 1 hour)`
- amount = `hourlyRate * billedHours`
- display uses `/hr`

All other tables use per-minute floor duration.

## 11. Backfill and Legacy Safety
Script `scripts/backfill-session-bill-links.ts` safely links legacy billed sessions missing `billId` by amount/time heuristics and only applies unambiguous matches.

Additional scripts:
- `scripts/backfill-business-day-keys.ts`
- `scripts/backfill-ledger-preview-data.ts`

## 12. Testing Strategy
Unit tests exist under `src/tests` for:
- session flows and override edges
- payer validation
- billing + discounts
- payment constraints
- status derivation helpers
- user management and auth-adjacent flows

This keeps rules deterministic and protects against regressions during UI iteration.
