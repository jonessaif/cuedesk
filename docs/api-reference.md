# CueDesk API Reference

Base URL (dev): `http://localhost:3000`

All routes are local Next.js route handlers under `src/app/api`.

## Tables

### GET `/api/tables`
Returns all tables with derived table state and latest session snapshot.

### POST `/api/tables`
Create a table.

Body:
```json
{
  "name": "S1",
  "ratePerMin": 6
}
```

---

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

Notes:
- `startTime` is optional. If provided, service applies override start time.

### POST `/api/session/end`
End the currently active/effective-running session for table.

Body:
```json
{
  "tableId": 1,
  "endTime": "2026-04-13T09:10:00.000Z"
}
```

Notes:
- `endTime` is optional; defaults to now.
- Handles sessions with `overrideStatus = running`.

### POST `/api/session/assign-payer`
Assign payer info to a running session.

Body:
```json
{
  "sessionId": 12,
  "payerMode": "split",
  "payerData": [
    { "name": "Amaan", "percentage": 50 },
    { "name": "Zaid", "percentage": 50 }
  ]
}
```

### POST `/api/session/override`
Apply override values without mutating original intent fields.

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
  "adminOverride": false
}
```

### GET `/api/sessions/completed`
Returns completed sessions that can be billed (service-filtered).

### GET `/api/sessions/all`
Returns ledger-ready session rows with backend-derived amounts/states.

---

## Billing

### POST `/api/bill/create`
Create bill from selected sessions.

Body:
```json
{
  "sessionIds": [10, 11, 12],
  "discountType": "percent",
  "discountValue": 10
}
```

Validation:
- sessionIds required
- discount type must be `fixed` or `percent`
- percent must be `<= 100`

### POST `/api/bill/discount`
Apply or update discount on existing bill.

Body:
```json
{
  "billId": 15,
  "discountType": "fixed",
  "discountValue": 100
}
```

### GET `/api/bill/latest`
Returns latest bill totals (including paid/remaining and discount-aware values).

### GET `/api/bill/unpaid`
Returns only bills with `remainingAmount > 0`, newest first.

---

## Payments

### POST `/api/payment/add`
Add a payment row to bill.

Body:
```json
{
  "billId": 15,
  "mode": "cash",
  "amount": 200
}
```

Validation:
- bill must exist
- amount > 0
- no overpayment beyond discounted remaining amount

---

## Error Format
Most validation/business failures return:

```json
{
  "error": "Error message"
}
```

Typical status: `400`.

