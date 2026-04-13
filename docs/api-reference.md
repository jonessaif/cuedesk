# CueDesk API Reference

Base URL (dev): `http://localhost:3000`

All routes are local Next.js handlers under `src/app/api`.

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

### GET `/api/reports/daily?key=YYYY-MM-DD`
Returns one persisted daily report snapshot by business-day key.

### GET `/api/reports/daily?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
Returns snapshot list in key range.

## Errors

Most validation/business failures return:
```json
{
  "error": "Error message"
}
```

Typical status: `400`.
