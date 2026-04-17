# CueDesk API Reference

Base URL (dev): `http://localhost:3000`

All routes are local Next.js handlers under `src/app/api`.

## Authentication and Authorization

### POST `/api/auth/login`
Authenticate with PIN.

Body:
```json
{
  "pin": "9345"
}
```

Notes:
- PIN must be 4 digits.
- Server validates PIN against stored bcrypt hash.

### Auth header for all other APIs
All APIs except `/api/auth/login` require:
```http
x-user-id: <user-id>
```

Role model:
- `operator`: session, billing, payment, reports
- `admin`: full access, including management APIs

## Tables

### GET `/api/tables`
Returns all tables with derived state and current session snapshot.

### POST `/api/tables`
Create a table.

Body:
```json
{
  "name": "S1",
  "ratePerMin": 6
}
```

## Sessions

### POST `/api/session/start`
Start a session for a table.

Body:
```json
{
  "tableId": 1,
  "playerName": "Saif",
  "startTime": "2026-04-13T08:30:00.000Z"
}
```

`startTime` is optional.

### POST `/api/session/end`
End effective-running session for table.

Body:
```json
{
  "tableId": 1,
  "endTime": "2026-04-13T09:10:00.000Z"
}
```

`endTime` is optional.

### POST `/api/session/cancel`
Cancel a running/completed session with required reason.

### POST `/api/session/assign-payer`
Assign payer to running session.

### POST `/api/session/override`
Apply override layer to a session.

Body (example):
```json
{
  "sessionId": 12,
  "overrideStartTime": "2026-04-13T08:20:00.000Z",
  "overrideEndTime": "2026-04-13T09:05:00.000Z",
  "overrideRatePerMin": 8,
  "overridePayerMode": "single",
  "overridePayerData": { "name": "Saif" },
  "overrideStatus": "completed",
  "overridePaymentModes": ["cash", "upi"],
  "adminOverride": false,
  "changedBy": "Operator"
}
```

### GET `/api/session/history?sessionId=<id>`
Returns full timeline (system + override events).

Response item:
```json
{
  "id": 1,
  "action": "override_update",
  "actionLabel": "Override Updated",
  "changedBy": "Operator",
  "diffs": [
    {
      "field": "overrideRatePerMin",
      "before": null,
      "after": 8
    }
  ],
  "createdAt": "2026-04-13T00:00:00.000Z"
}
```

### GET `/api/sessions/completed`
Returns completed, unbilled sessions ready for bill creation.

### GET `/api/sessions/all?scope=current|day|range&date=YYYY-MM-DD&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
Returns ledger rows + business-day summary.

`scope`:
- `current`: current business day (`10:00 AM` to now)
- `day`: selected business day key
- `range`: selected business-day key range (inclusive)

Response shape:
```json
{
  "data": [],
  "summary": {
    "subtotal": 0,
    "discount": 0,
    "net": 0,
    "cash": 0,
    "upi": 0,
    "card": 0,
    "due": 0,
    "dueReceived": 0,
    "dueReceivedCash": 0,
    "dueReceivedUpi": 0,
    "dueReceivedCard": 0,
    "paid": 0,
    "unpaid": 0,
    "total": 0,
    "isBalanced": true
  },
  "window": {
    "scope": "current",
    "key": "2026-04-13",
    "start": "2026-04-13T04:30:00.000Z",
    "end": "2026-04-13T09:00:00.000Z"
  }
}
```

Important:
- `total = net + dueReceived`
- `dueReceived` is informational and already included inside cash/upi/card.

## Billing

### POST `/api/bill/create`
Create bill from selected sessions (+ optional discount).

### POST `/api/bill/discount`
Apply/update bill-level discount.

### GET `/api/bill/latest`
Returns latest bill with normalized fields:
- `subtotal`, `discount`, `finalAmount`, `paidAmount`, `remaining`

### GET `/api/bill/unpaid`
Returns unpaid bills (`remainingAmount > 0`) with normalized totals.

### GET `/api/bill/search`
Bill explorer with filters:
- `billId`
- `payer`
- `paymentMode`
- `startDate`, `endDate`
- optional `startTime`, `endTime`

## Payments

### POST `/api/payment/add`
Add payment to bill.

For due:
```json
{
  "billId": 15,
  "mode": "due",
  "amount": 200,
  "dueCustomerName": "Saif",
  "dueCustomerPhone": "9876543210"
}
```

### GET `/api/payment/due-report`
Aggregated due by customer.

### GET `/api/payment/due-report-by-bill`
Due report by bill with bill/date breakup.

### POST `/api/payment/receive-due`
Settle due to `cash` / `upi` / `card`.

Body:
```json
{
  "paymentId": 123,
  "mode": "cash",
  "amount": 150
}
```

Also supports customer-level settlement by `customerPhone`.

### GET `/api/customers/search?q=<text>`
Realtime customer suggestions by phone/name.

## Reports

### GET `/api/reports/daily`
Requires operator/admin auth.

### GET `/api/reports/daily?key=YYYY-MM-DD`
Returns one persisted daily report snapshot by business-day key.

### GET `/api/reports/daily?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
Returns snapshot list in key range.

### GET `/api/reports/analytics?scope=current|day|range&date=YYYY-MM-DD&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&tableId=<id>`
Returns analytics for selected timeframe:
- table idle/running time
- table-wise revenue and utilization
- hour-wise running/revenue/session distribution
- best/slowest hours by revenue and utilization
- daily average revenue (`dailyAverageRevenue`)
- revenue chart series (`revenueSeries`):
  - `mode: "day"` when selected period has multiple days
  - `mode: "hour"` when selected period is a single day
  - in `hour` mode, merged buckets are configurable (default includes `08-11`)
- includes chart settings bundle in response:
  - `settings.global`
  - `settings.table` (when `tableId` is provided and override exists)
  - `settings.effective` (resolved settings used by chart)

Optional custom timeframe:
- `startAt=<ISO datetime>`
- `endAt=<ISO datetime>`

### GET `/api/reports/settings?tableId=<id>`
Returns report chart settings bundle.

Auth:
- `operator` or `admin`

Response:
```json
{
  "data": {
    "global": {
      "target": "global",
      "tableId": null,
      "chartMode": "auto",
      "mergeBuckets": [{ "startHour": 8, "endHour": 11, "label": "08-11" }],
      "includeClosed": true,
      "updatedAt": null
    },
    "table": null,
    "effective": {
      "target": "global",
      "tableId": null,
      "chartMode": "auto",
      "mergeBuckets": [{ "startHour": 8, "endHour": 11, "label": "08-11" }],
      "includeClosed": true,
      "updatedAt": null
    }
  }
}
```

### PATCH `/api/reports/settings`
Upsert report chart settings.

Auth:
- `admin` only

Body:
```json
{
  "target": "global",
  "chartMode": "auto",
  "mergeBuckets": [{ "startHour": 8, "endHour": 11, "label": "08-11" }],
  "includeClosed": true
}
```

Table-specific example:
```json
{
  "target": "table",
  "tableId": 3,
  "chartMode": "hour",
  "mergeBuckets": [{ "startHour": 8, "endHour": 11, "label": "08-11" }],
  "includeClosed": false
}
```

### GET `/api/reports/settings?tableId=<id>`
Returns report chart settings bundle:
- `global` settings
- optional `table` override for given table
- `effective` resolved settings

Requires: operator/admin

### PATCH `/api/reports/settings`
Upsert report chart settings.

Body:
```json
{
  "target": "global",
  "chartMode": "auto",
  "includeClosed": true,
  "mergeBuckets": [
    { "startHour": 8, "endHour": 11, "label": "08-11" }
  ]
}
```

Table-specific body:
```json
{
  "target": "table",
  "tableId": 3,
  "chartMode": "hour",
  "includeClosed": false,
  "mergeBuckets": [
    { "startHour": 8, "endHour": 11, "label": "08-11" }
  ]
}
```

Requires: admin

## Management APIs (Admin)

### Users
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`
- `GET /api/users/options`

### Table sections
- `GET /api/table-sections`
- `POST /api/table-sections`
- `PATCH /api/table-sections/:id`
- `DELETE /api/table-sections/:id`

### Settings
- `GET /api/settings/ledger-reset`
- `PATCH /api/settings/ledger-reset`

## Errors

Most validation/business failures return:
```json
{
  "error": "Error message"
}
```

Typical status codes:
- `400` validation/business rule failure
- `401` unauthorized (missing/invalid auth)
- `403` forbidden (insufficient role)
