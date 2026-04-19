import { requireOperatorOrAdmin } from "@/lib/authz";
import { prisma } from "@/lib/prisma";

type CustomerMetricRow = {
  customer_id: number | bigint | null;
  payer_identity: string;
  name: string;
  visits: number | bigint;
  total_spent: number | bigint;
  avg_spent: number | bigint;
  last_visit: string | null;
  avg_gap: number | bigint | null;
  last_gap: number | bigint | null;
  is_high_value: number | bigint;
  is_at_risk: number | bigint;
};

const CUSTOMER_INSIGHTS_SQL_TEMPLATE = `
WITH
bill_base AS (
  SELECT
    b.id AS bill_id,
    b.customerId AS bill_customer_id,
    b.createdAt AS session_date,
    CASE
      WHEN b.discountedAmount IS NOT NULL AND b.discountedAmount > 0 THEN b.discountedAmount
      ELSE b.totalAmount
    END AS bill_amount
  FROM bills b
  __BILL_DATE_FILTER__
),
session_payers AS (
  SELECT
    s.billId AS bill_id,
    100.0 AS payer_weight,
    CASE
      WHEN COALESCE(s.overridePayerMode, s.payerMode) = 'single'
        THEN TRIM(COALESCE(json_extract(COALESCE(s.overridePayerData, s.payerData), '$.name'), ''))
      WHEN COALESCE(s.overridePayerMode, s.payerMode) = 'none'
        THEN TRIM(COALESCE(s.playerName, ''))
      ELSE NULL
    END AS payer_name
  FROM sessions s
  WHERE s.billId IS NOT NULL

  UNION ALL

  SELECT
    s.billId AS bill_id,
    CASE
      WHEN CAST(COALESCE(json_extract(j.value, '$.percentage'), 0) AS REAL) > 0
        THEN CAST(json_extract(j.value, '$.percentage') AS REAL)
      ELSE 100.0
    END AS payer_weight,
    TRIM(COALESCE(json_extract(j.value, '$.name'), '')) AS payer_name
  FROM sessions s
  JOIN json_each(COALESCE(s.overridePayerData, s.payerData)) j
    ON COALESCE(s.overridePayerMode, s.payerMode) = 'split'
  WHERE s.billId IS NOT NULL

  UNION ALL

  SELECT
    p.billId AS bill_id,
    100.0 AS payer_weight,
    TRIM(COALESCE(p.dueCustomerName, '')) AS payer_name
  FROM payments p
  WHERE p.dueCustomerName IS NOT NULL
    AND TRIM(p.dueCustomerName) <> ''
),
bill_payers AS (
  SELECT
    sp.bill_id,
    MIN(sp.payer_name) AS name,
    LOWER(TRIM(sp.payer_name)) AS payer_identity,
    SUM(CASE WHEN sp.payer_weight > 0 THEN sp.payer_weight ELSE 0 END) AS payer_weight
  FROM session_payers sp
  WHERE sp.payer_name IS NOT NULL
    AND sp.payer_name <> ''
  GROUP BY sp.bill_id, LOWER(TRIM(sp.payer_name))
),
bill_payer_weights AS (
  SELECT
    bill_id,
    SUM(CASE WHEN payer_weight > 0 THEN payer_weight ELSE 0 END) AS total_weight
  FROM bill_payers
  GROUP BY bill_id
),
customer_bill_allocations AS (
  SELECT
    bp.name,
    bp.payer_identity,
    bb.bill_id,
    bb.bill_customer_id,
    bb.session_date,
    ROUND(bb.bill_amount * (
      CASE
        WHEN bpc.total_weight <= 0 THEN 0
        ELSE bp.payer_weight / bpc.total_weight
      END
    ), 0) AS amount_share
  FROM bill_base bb
  JOIN bill_payers bp
    ON bp.bill_id = bb.bill_id
  JOIN bill_payer_weights bpc
    ON bpc.bill_id = bb.bill_id
),
customer_visits AS (
  SELECT
    payer_identity,
    DATE(CAST(session_date AS INTEGER) / 1000, 'unixepoch') AS visit_day
  FROM customer_bill_allocations
  GROUP BY payer_identity, DATE(CAST(session_date AS INTEGER) / 1000, 'unixepoch')
),
visit_gaps AS (
  SELECT
    payer_identity,
    visit_day,
    (julianday(visit_day) - julianday(LAG(visit_day) OVER (PARTITION BY payer_identity ORDER BY visit_day))) AS gap_days
  FROM customer_visits
),
customer_metrics AS (
  SELECT
    COALESCE(MAX(a.bill_customer_id), c.id) AS customer_id,
    a.payer_identity,
    MIN(a.name) AS name,
    COUNT(DISTINCT a.bill_id) AS visits,
    ROUND(SUM(a.amount_share), 2) AS total_spent,
    ROUND(AVG(a.amount_share), 2) AS avg_spent,
    DATETIME(CAST(MAX(a.session_date) AS INTEGER) / 1000, 'unixepoch') AS last_visit,
    ROUND(AVG(CASE WHEN vg.gap_days IS NOT NULL AND vg.gap_days > 0 THEN vg.gap_days END), 2) AS avg_gap,
    ROUND((strftime('%s', 'now') - (CAST(MAX(a.session_date) AS INTEGER) / 1000)) / 86400.0, 2) AS last_gap
  FROM customer_bill_allocations a
  LEFT JOIN (
    SELECT
      MIN(id) AS id,
      LOWER(TRIM(name)) AS payer_identity
    FROM customers
    GROUP BY LOWER(TRIM(name))
  ) c
    ON c.payer_identity = a.payer_identity
  LEFT JOIN visit_gaps vg
    ON vg.payer_identity = a.payer_identity
  GROUP BY c.id, a.payer_identity
),
ranked_metrics AS (
  SELECT
    cm.*,
    ROW_NUMBER() OVER (ORDER BY cm.total_spent DESC, cm.visits DESC, cm.name ASC) AS spend_rank,
    COUNT(*) OVER () AS total_customers
  FROM customer_metrics cm
)
SELECT
  rm.customer_id AS customer_id,
  rm.payer_identity AS payer_identity,
  rm.name AS name,
  CAST(rm.visits AS INTEGER) AS visits,
  ROUND(rm.total_spent, 2) AS total_spent,
  ROUND(rm.avg_spent, 2) AS avg_spent,
  rm.last_visit AS last_visit,
  rm.avg_gap AS avg_gap,
  rm.last_gap AS last_gap,
  CASE
    WHEN rm.spend_rank <= CASE
      WHEN rm.total_customers <= 0 THEN 1
      ELSE CAST((rm.total_customers * 0.2) + 0.9999 AS INT)
    END THEN 1
    ELSE 0
  END AS is_high_value,
  CASE
    WHEN rm.avg_gap IS NOT NULL
      AND rm.avg_gap > 0
      AND rm.last_gap > (2 * rm.avg_gap)
    THEN 1
    ELSE 0
  END AS is_at_risk
FROM ranked_metrics rm
ORDER BY rm.total_spent DESC, rm.visits DESC, rm.name ASC
`;

function parseDateStart(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseDateEnd(value: string | null): Date | null {
  if (!value) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toSafeNumber(value: number | bigint | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function toSafeNullableInt(value: number | bigint | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const safe = toSafeNumber(value);
  if (!Number.isFinite(safe)) {
    return null;
  }
  return Math.round(safe);
}

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, currentValue: unknown) => {
    if (typeof currentValue === "bigint") {
      return Number(currentValue);
    }
    return currentValue;
  })) as T;
}

function mapInsightRow(row: CustomerMetricRow) {
  const lastGap = Math.max(toSafeNumber(row.last_gap), 0);
  const avgGap = row.avg_gap === null ? null : Math.max(toSafeNumber(row.avg_gap), 0);
  const mapped = {
    customer_id: toSafeNullableInt(row.customer_id),
    payer_identity: row.payer_identity,
    name: row.name,
    visits: Math.max(Math.round(toSafeNumber(row.visits)), 0),
    total_spent: Math.round(toSafeNumber(row.total_spent)),
    avg_spent: Math.round(toSafeNumber(row.avg_spent)),
    last_visit: row.last_visit,
    avg_gap: avgGap === null ? null : Math.round(avgGap * 10) / 10,
    last_gap: Math.round(lastGap * 10) / 10,
    is_high_value: toSafeNumber(row.is_high_value) === 1,
    is_at_risk: toSafeNumber(row.is_at_risk) === 1,
  };
  return mapped;
}

export async function GET(request: Request) {
  try {
    await requireOperatorOrAdmin(prisma, request);
    const { searchParams } = new URL(request.url);
    const startDateRaw = searchParams.get("startDate");
    const endDateRaw = searchParams.get("endDate");

    const startDate = parseDateStart(startDateRaw);
    const endDate = parseDateEnd(endDateRaw);
    if (startDateRaw && !startDate) {
      return Response.json({ error: "Invalid startDate" }, { status: 400 });
    }
    if (endDateRaw && !endDate) {
      return Response.json({ error: "Invalid endDate" }, { status: 400 });
    }
    if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
      return Response.json({ error: "endDate must be on or after startDate" }, { status: 400 });
    }

    const clauses: string[] = [];
    if (startDate) {
      clauses.push(`CAST(b.createdAt AS INTEGER) >= ${startDate.getTime()}`);
    }
    if (endDate) {
      clauses.push(`CAST(b.createdAt AS INTEGER) <= ${endDate.getTime()}`);
    }
    const dateFilterSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const customerInsightsSql = CUSTOMER_INSIGHTS_SQL_TEMPLATE.replace("__BILL_DATE_FILTER__", dateFilterSql);

    const rows = await prisma.$queryRawUnsafe<CustomerMetricRow[]>(customerInsightsSql);
    const normalized = rows.map(mapInsightRow);

    const topCustomers = normalized;
    const highValueCustomers = normalized.filter((row) => row.is_high_value);
    const atRiskCustomers = normalized
      .filter((row) => row.is_at_risk)
      .map((row) => ({
        ...row,
        alert: `⚠ ${row.name} hasn't visited in ${Math.max(Math.round(row.last_gap), 0)} day(s)`,
      }))
      .sort((a, b) => b.last_gap - a.last_gap || b.total_spent - a.total_spent);

    return Response.json(jsonSafe({
      top_customers: topCustomers,
      high_value_customers: highValueCustomers,
      at_risk_customers: atRiskCustomers,
    }), { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Unauthorized") ? 401 : message.startsWith("Forbidden") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
}
