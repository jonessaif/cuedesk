# CueDesk TDD Plan

## Requirement Extraction

### Core Entities
- Table: physical table with per-minute rate.
- Session: table gameplay lifecycle with payer metadata and timing.
- Bill: group of completed sessions for checkout.
- Payment: one or more payment records against a bill.

### Key Workflows
- Start session for a table with player name (one running session max per table).
- View running timer and table state in dashboard.
- Assign payer mode (none/single/split) with split validation.
- End session and compute duration + amount.
- Select completed unbilled sessions, create bill, and collect payments.

### API Requirements
- `POST /api/session/start`
- `POST /api/session/end`
- `POST /api/session/assign-payer`
- `GET /api/sessions/active`
- `GET /api/sessions/completed`
- `POST /api/bill/create`
- `POST /api/payment/add`

### Constraints
- LAN local-first operation, no internet dependency at runtime.
- Single source of truth is backend database (SQLite).
- No client-side persistent storage or sync layer.
- Single active operator, no RBAC for now.
- Backend contains business logic; UI only reflects backend state.

## 1. Modules
- Tables
- Sessions
- Timer logic
- Payer system
- Billing
- Payments

## 2. Test-First Cases Per Module

### Tables Module
- should create table successfully
- should list all tables with rate and derived dashboard state
- should reject duplicate table name
- should reject non-positive rate per minute

### Sessions Module
- should start session successfully
- should not allow multiple running sessions per table
- should end session and set status to completed
- should calculate amount from duration and table rate
- should return active sessions only
- should return completed unbilled sessions only

### Timer Logic Module
- should calculate floor minutes elapsed from start_time to now
- should return zero when elapsed is below one minute
- should derive running table states by payer mode

### Payer System Module
- should assign no payer mode
- should assign single payer
- should assign split payer list
- should validate split percentages sum to 100
- should reject payer assignment for non-running session

### Billing Module
- should create bill from completed unbilled sessions
- should only include completed sessions
- should mark billed sessions with status billed
- should compute bill total from linked sessions

### Payments Module
- should add single payment to a bill
- should allow split payments across multiple modes
- should validate paid total equals bill total or leaves due remainder
- should reject overpayment beyond bill total

## 3. Iterative Strict TDD Loop
For each module in sequence:
1. Write tests first in `src/tests`.
2. Run tests and confirm initial failures.
3. Implement minimal backend code to pass.
4. Refactor while keeping tests green.

## 4. Implementation Order (Fixed)
1. Tables module
2. Sessions module
3. Timer logic
4. Payer system
5. Billing
6. Payments

## 5. Backend-First Scope
- Prisma models and migrations
- Business services in `src/lib`
- API route handlers in `src/app/api`
- Frontend components after backend module stability
