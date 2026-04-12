# Product Requirements Document (PRD)

## 1. Product Name
CueDesk (Local Snooker Management System)

---

## 2. Objective

Build a local-first web application to manage snooker tables, sessions, and billing in real-time within a single WiFi network.

The system replaces manual tracking and must be faster, error-free, and easy for staff.

---

## 3. Environment Constraints

- Runs on local server (no internet)
- Accessible via LAN (WiFi)
- Used by:
  - Android APK (primary device)
  - iPhone browser (secondary viewing)
- Single active operator at a time

---

## 4. Core Entities

### Table
- Represents a physical snooker table
- Has a fixed rate per minute

### Session
- Represents gameplay on a table
- Only ONE active session per table

### Bill
- Group of completed sessions

### Payment
- Records payment against a bill

---

## 5. Core Features

### 5.1 Table Dashboard

User sees all tables in grid:

Each table shows:
- Status
- Timer (if running)
- Player name
- Payer info

States:
- Free
- Running-NoPayer
- Running-Single
- Running-Split
- Completed (Unbilled)
- Billed

---

### 5.2 Session Management

#### Start Session
- Input: player_name
- Creates session with:
  - status = running
  - start_time = now

Constraint:
- Cannot start if session already running

---

#### End Session
- Ends active session
- Calculates:
  - duration_minutes
  - amount = duration × rate

---

### 5.3 Timer

- Live timer per running session
- Displays minutes elapsed

---

### 5.4 Payer System

Modes:
- none
- single
- split

#### Single
- payer_name

#### Split
- List of:
  - name
  - percentage

Validation:
- Sum of percentages = 100

---

### 5.5 Billing

- Show completed sessions (not billed)
- Select sessions
- Create bill

---

### 5.6 Payments

Modes:
- Cash
- UPI
- Card
- Due

Rules:
- Sum(payments) = total OR remainder = due

---

## 6. User Flow

### Flow 1: Start Game
- Select table → Start → enter player

### Flow 2: During Game
- View timer
- Assign payer (optional)

### Flow 3: End Game
- Click End → auto calculate

### Flow 4: Billing
- Select sessions → generate bill → add payment

---

## 7. Non-Functional Requirements

- Works offline (LAN only)
- Fast (<200ms actions)
- Mobile-first UI
- Large buttons (staff usage)
- Minimal clicks (POS-style)

---

## 8. Constraints

- Single source of truth = backend DB
- No local client storage
- No sync system required
- No RBAC (admin-only for now)

---

## 9. Success Criteria

- Staff can manage tables without confusion
- Billing errors = zero
- Faster than paper system
