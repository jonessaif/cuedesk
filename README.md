# CueDesk

CueDesk is a LAN-first snooker operations app for managing:
- table sessions
- payer assignment
- bill creation
- split/partial payments
- overrides for audit-safe corrections

It is built with Next.js + Prisma + SQLite and keeps backend logic as the single source of truth.

## Tech Stack
- Next.js (App Router)
- TypeScript
- Prisma ORM
- SQLite (`prisma/dev.db`)
- Tailwind CSS
- Vitest

## Core Features
- Table dashboard with derived states (`Free`, running variants, `Completed (Unbilled)`, `Billed`)
- Session lifecycle: start, assign payer, end
- Session outcome handling: `NORMAL`, `LTP_LOSS`, `CANCELLED`
- Session override system:
  - optional override start/end/rate
  - optional override payer mode/data
  - optional override status/payment modes
- Billing:
  - create bills from completed sessions
  - bill-level discounts (`fixed`, `percent`)
  - discount updates after bill creation
- Payments:
  - multiple payments per bill
  - `cash` / `upi` / `card` / `due`
  - strict no-overpay validation against discounted totals
  - due settlement tracking (`dueReceivedMode`, `dueSettledAt`)
- Ledger:
  - business-day aware reporting window (ledger reset time configurable, default 10 AM)
  - backend-derived revenue, collection, and status summaries
  - due-received visibility (included in collection modes)
  - grouped by bill context
  - daily snapshot storage (`DailyReport`)
  - analytics: table idle time, table-wise revenue/runtime, and hour-wise best/slow periods
  - revenue trend chart: day-wise for multi-day ranges, hour-wise for single day
  - hourly chart includes a combined `08-11` bucket (cafe closed window)
- Auth and security:
  - PIN-based login (`4` digits)
  - mobile numeric keypad with auto-submit at 4 digits
  - persisted local auth (`localStorage`) + auto-login
  - auto logout after 2 hours inactivity
  - role-based access (`admin`, `operator`)
  - backend role checks on all APIs
- Management:
  - table management (`create`, `edit`, `remove`)
  - section management (`create`, `edit`, `remove`)
  - user management with roles (`operator`, `admin`)
  - configurable ledger reset time (once every 24 hours)

## Project Structure
`src/app/page.tsx`  
Main dashboard + ledger + billing/payment UI.

`src/app/api/*`  
Route handlers for sessions, bills, payments, tables.

`src/components/auth-provider.tsx`  
Global auth store/provider (login, persistence, inactivity timeout, auth headers).

`src/lib/services/*`  
Business logic (session, payer, billing, payment, timer).

`src/lib/authz.ts`  
Authorization helpers (`requireRole`, `requireOperatorOrAdmin`, bootstrap support).

`src/lib/session-status.ts`  
Centralized effective status + ledger/table status derivation.

`src/lib/state-machine.ts`  
State ordering and transition guards.

`src/lib/tables-service.ts`  
Table CRUD + table state derivation.

`src/tests/*`  
Unit tests for modules and edge cases.

`scripts/backfill-session-bill-links.ts`  
Safe backfill utility for legacy billed sessions missing `billId`.

## Setup
1. Install dependencies:
```bash
npm install
```

2. Configure env:
```bash
# .env
DATABASE_URL="file:./prisma/dev.db"
```

3. Sync Prisma schema to local DB:
```bash
npx prisma db push
```

4. Generate Prisma client (if needed):
```bash
npx prisma generate
```

5. Run dev server:
```bash
npm run dev
```

## Scripts
- `npm run dev` - start development server
- `npm run build` - production build
- `npm run start` - run production server on `0.0.0.0`
- `npm test` - run unit tests
- `npm run test:watch` - run tests in watch mode
- `npm run backfill:bills` - backfill missing `billId` on legacy billed sessions
- `npm run backfill:business-day-keys` - fill legacy `businessDayKey` values
- `npm run backfill:ledger-demo` - seed preview ledger/demo data

## LAN Usage
Start server and open from other devices on the same network:
- `http://<your-lan-ip>:3000`

For production:
```bash
npm run build
npm run start
```

## Status and Billing Truth Rules
- `effectiveStatus = overrideStatus ?? status`
- Billing is determined by `billId != null` (not status string alone)
- Ledger status is backend-derived from effective status + bill linkage + paid amount
- UI should not compute billing truth; UI only displays backend outputs

## Management and Permissions
- Roles:
  - `operator`: session, billing, payments, reports
  - `admin`: full access, including management
- Management route:
  - `/management` is admin-only
  - unauthorized users are redirected to `/access-denied`
- API auth:
  - all APIs require authenticated user context except `/api/auth/login`
  - send active user via request header:
  - `x-user-id: <user-id>`
- Admin-only APIs include:
  - tables create/update/delete
  - users create/list/update/delete
  - table sections create/list/update/delete
  - settings (ledger reset) get/update
- Bootstrap mode:
  - if `users` table is empty, management endpoints are allowed to help create the first admin.

## Authentication UX
- Login screen is centered and mobile friendly.
- Numeric keypad is provided for fast PIN entry.
- Login auto-submits when PIN length reaches 4.
- Active user is shown in header.
- `Logout` is available in the header.
- Auto logout happens after 2 hours of inactivity.
- PIN validation is done on backend and stored as bcrypt hash (`bcryptjs`).

## Rate Rules
- Regular tables: per-minute billing
- PS tables (`name` starts with `PS`): hourly bucket billing using ceil-hours
  - Example: `1m` => `1 hour`
  - Example: `1h20m` => `2 hours`

## Discount Rules
- Applied at bill level only
- `fixed`: subtract fixed amount, clamp final to `>= 0`
- `percent`: 0..100 only
- Payments validate against discounted bill total
- Discount update is blocked if fixed discount exceeds current remaining amount

## Business Day Reporting
- Business day boundary is configurable via management settings (default `10:00 AM` local time).
- `current` report scope: reset time to now.
- `day` scope: selected day key (`YYYY-MM-DD`) mapped to reset time -> next day same reset time.
- `range` scope: inclusive business-day keys.
- Daily summary includes:
  - Revenue: `subtotal`, `discount`, `net`
  - Collection: `cash`, `upi`, `card`, `due`, `dueReceived`
  - Status: `paid`, `unpaid`, `total`, `isBalanced`
- Note: `dueReceived` is informational and already included in `cash`/`upi`/`card`.

## Design Docs
See:
- [design.md](./design.md)
- [Architecture](./docs/architecture.md)
- [State Machine](./docs/state-machine.md)
- [API Reference](./docs/api-reference.md)

## Testing
Run:
```bash
npm test
```

Tests cover:
- session lifecycle and overrides
- payer validation
- billing + discount logic
- payment edge cases
- status derivation helpers
