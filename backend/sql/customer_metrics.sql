-- CueDesk Customer Insights Metrics
-- This script derives customer analytics from bills + session payer data.
-- It is optimized around SQL CTEs and window functions (no ML).
-- Primary identity rule: payer_identity = LOWER(TRIM(payer_name)).

-- =========================================================
-- Base CTE: customer_metrics
-- =========================================================
-- Reuse this base block for all sections below.
WITH
bill_base AS (
  SELECT
    b.id AS bill_id,
    b.createdAt AS session_date,
    CASE
      WHEN b.discountedAmount IS NOT NULL AND b.discountedAmount > 0 THEN b.discountedAmount
      ELSE b.totalAmount
    END AS bill_amount
  FROM bills b
),
session_payers AS (
  SELECT
    s.billId AS bill_id,
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
    TRIM(COALESCE(json_extract(j.value, '$.name'), '')) AS payer_name
  FROM sessions s
  JOIN json_each(COALESCE(s.overridePayerData, s.payerData)) j
    ON COALESCE(s.overridePayerMode, s.payerMode) = 'split'
  WHERE s.billId IS NOT NULL

  UNION ALL

  SELECT
    p.billId AS bill_id,
    TRIM(COALESCE(p.dueCustomerName, '')) AS payer_name
  FROM payments p
  WHERE p.dueCustomerName IS NOT NULL
    AND TRIM(p.dueCustomerName) <> ''
),
bill_payers AS (
  SELECT DISTINCT
    sp.bill_id,
    sp.payer_name AS name
  FROM session_payers sp
  WHERE sp.payer_name IS NOT NULL
    AND sp.payer_name <> ''
),
bill_payer_counts AS (
  SELECT
    bill_id,
    COUNT(*) AS payer_count
  FROM bill_payers
  GROUP BY bill_id
),
customer_bill_allocations AS (
  SELECT
    bp.name,
    bb.bill_id,
    bb.session_date,
    ROUND(
      bb.bill_amount / CASE WHEN bpc.payer_count <= 0 THEN 1 ELSE bpc.payer_count END,
      2
    ) AS amount_share
  FROM bill_base bb
  JOIN bill_payers bp
    ON bp.bill_id = bb.bill_id
  JOIN bill_payer_counts bpc
    ON bpc.bill_id = bb.bill_id
),
customer_visits AS (
  SELECT
    name,
    DATE(session_date) AS visit_day
  FROM customer_bill_allocations
  GROUP BY name, DATE(session_date)
),
visit_gaps AS (
  SELECT
    name,
    visit_day,
    (julianday(visit_day) - julianday(LAG(visit_day) OVER (PARTITION BY name ORDER BY visit_day))) AS gap_days
  FROM customer_visits
),
customer_metrics AS (
  SELECT
    c.id AS customer_id,
    a.name,
    COUNT(DISTINCT a.bill_id) AS visits,
    ROUND(SUM(a.amount_share), 2) AS total_spent,
    ROUND(AVG(a.amount_share), 2) AS avg_spent,
    MAX(a.session_date) AS last_visit,
    ROUND(AVG(CASE WHEN vg.gap_days IS NOT NULL AND vg.gap_days > 0 THEN vg.gap_days END), 2) AS avg_gap,
    ROUND(julianday('now') - julianday(DATE(MAX(a.session_date))), 2) AS last_gap
  FROM customer_bill_allocations a
  LEFT JOIN customers c
    ON LOWER(TRIM(c.name)) = LOWER(TRIM(a.name))
  LEFT JOIN visit_gaps vg
    ON vg.name = a.name
  GROUP BY c.id, a.name
)
SELECT * FROM customer_metrics;

-- =========================================================
-- A) Top customers
-- =========================================================
WITH customer_metrics AS (
  SELECT * FROM (
    WITH
    bill_base AS (
      SELECT b.id AS bill_id, b.createdAt AS session_date,
        CASE WHEN b.discountedAmount IS NOT NULL AND b.discountedAmount > 0 THEN b.discountedAmount ELSE b.totalAmount END AS bill_amount
      FROM bills b
    ),
    session_payers AS (
      SELECT s.billId AS bill_id,
        CASE
          WHEN COALESCE(s.overridePayerMode, s.payerMode) = 'single' THEN TRIM(COALESCE(json_extract(COALESCE(s.overridePayerData, s.payerData), '$.name'), ''))
          WHEN COALESCE(s.overridePayerMode, s.payerMode) = 'none' THEN TRIM(COALESCE(s.playerName, ''))
          ELSE NULL
        END AS payer_name
      FROM sessions s
      WHERE s.billId IS NOT NULL
      UNION ALL
      SELECT s.billId AS bill_id, TRIM(COALESCE(json_extract(j.value, '$.name'), '')) AS payer_name
      FROM sessions s
      JOIN json_each(COALESCE(s.overridePayerData, s.payerData)) j
        ON COALESCE(s.overridePayerMode, s.payerMode) = 'split'
      WHERE s.billId IS NOT NULL
    ),
    bill_payers AS (
      SELECT DISTINCT sp.bill_id, sp.payer_name AS name
      FROM session_payers sp
      WHERE sp.payer_name IS NOT NULL AND sp.payer_name <> ''
    ),
    bill_payer_counts AS (
      SELECT bill_id, COUNT(*) AS payer_count
      FROM bill_payers
      GROUP BY bill_id
    ),
    customer_bill_allocations AS (
      SELECT bp.name, bb.bill_id, bb.session_date,
        ROUND(bb.bill_amount / CASE WHEN bpc.payer_count <= 0 THEN 1 ELSE bpc.payer_count END, 2) AS amount_share
      FROM bill_base bb
      JOIN bill_payers bp ON bp.bill_id = bb.bill_id
      JOIN bill_payer_counts bpc ON bpc.bill_id = bb.bill_id
    )
    SELECT
      a.name,
      COUNT(DISTINCT a.bill_id) AS visits,
      ROUND(SUM(a.amount_share), 2) AS total_spent,
      ROUND(AVG(a.amount_share), 2) AS avg_spent,
      MAX(a.session_date) AS last_visit
    FROM customer_bill_allocations a
    GROUP BY a.name
  )
)
SELECT
  name,
  visits,
  total_spent,
  avg_spent,
  last_visit
FROM customer_metrics
ORDER BY total_spent DESC
LIMIT 20;

-- =========================================================
-- B) High value customers (top 20% by total_spent)
-- =========================================================
WITH ranked AS (
  SELECT
    cm.*,
    ROW_NUMBER() OVER (ORDER BY cm.total_spent DESC, cm.visits DESC, cm.name ASC) AS spend_rank,
    COUNT(*) OVER () AS total_customers
  FROM (
    SELECT
      name,
      COUNT(DISTINCT bill_id) AS visits,
      ROUND(SUM(amount_share), 2) AS total_spent,
      ROUND(AVG(amount_share), 2) AS avg_spent,
      MAX(session_date) AS last_visit
    FROM (
      WITH
      bill_base AS (
        SELECT b.id AS bill_id, b.createdAt AS session_date,
          CASE WHEN b.discountedAmount IS NOT NULL AND b.discountedAmount > 0 THEN b.discountedAmount ELSE b.totalAmount END AS bill_amount
        FROM bills b
      ),
      session_payers AS (
        SELECT s.billId AS bill_id,
          CASE
            WHEN COALESCE(s.overridePayerMode, s.payerMode) = 'single' THEN TRIM(COALESCE(json_extract(COALESCE(s.overridePayerData, s.payerData), '$.name'), ''))
            WHEN COALESCE(s.overridePayerMode, s.payerMode) = 'none' THEN TRIM(COALESCE(s.playerName, ''))
            ELSE NULL
          END AS payer_name
        FROM sessions s
        WHERE s.billId IS NOT NULL
        UNION ALL
        SELECT s.billId AS bill_id, TRIM(COALESCE(json_extract(j.value, '$.name'), '')) AS payer_name
        FROM sessions s
        JOIN json_each(COALESCE(s.overridePayerData, s.payerData)) j
          ON COALESCE(s.overridePayerMode, s.payerMode) = 'split'
        WHERE s.billId IS NOT NULL
      ),
      bill_payers AS (
        SELECT DISTINCT sp.bill_id, sp.payer_name AS name
        FROM session_payers sp
        WHERE sp.payer_name IS NOT NULL AND sp.payer_name <> ''
      ),
      bill_payer_counts AS (
        SELECT bill_id, COUNT(*) AS payer_count
        FROM bill_payers
        GROUP BY bill_id
      )
      SELECT
        bp.name,
        bb.bill_id,
        bb.session_date,
        ROUND(bb.bill_amount / CASE WHEN bpc.payer_count <= 0 THEN 1 ELSE bpc.payer_count END, 2) AS amount_share
      FROM bill_base bb
      JOIN bill_payers bp ON bp.bill_id = bb.bill_id
      JOIN bill_payer_counts bpc ON bpc.bill_id = bb.bill_id
    ) t
    GROUP BY name
  ) cm
)
SELECT *
FROM ranked
WHERE spend_rank <= CASE
  WHEN total_customers <= 0 THEN 1
  ELSE CAST((total_customers * 0.2) + 0.9999 AS INT)
END
ORDER BY total_spent DESC;

-- =========================================================
-- C) Customer visit gap
-- =========================================================
WITH customer_visit_days AS (
  SELECT
    name,
    DATE(last_visit) AS last_visit_day,
    avg_gap
  FROM customer_metrics
)
SELECT
  name,
  avg_gap,
  ROUND(julianday('now') - julianday(last_visit_day), 2) AS last_gap
FROM customer_visit_days;

-- =========================================================
-- D) At-risk customers
-- =========================================================
SELECT *
FROM customer_metrics
WHERE avg_gap IS NOT NULL
  AND avg_gap > 0
  AND last_gap > 2 * avg_gap
ORDER BY last_gap DESC, total_spent DESC;
