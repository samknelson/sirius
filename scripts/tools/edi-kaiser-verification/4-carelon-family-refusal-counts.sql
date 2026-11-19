-- Diagnose the November Carelon refusal without returning member identifiers.
-- Run only from an authorized staging SQL console. Read-only; no repairs.
-- The counts describe CURRENT data, so they may differ from the failed check.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

WITH params AS (
  SELECT 'CARELONEAP'::text AS benefit_sirius_id, DATE '2026-11-01' AS month
), held AS (
  SELECT w.*, coalesce(e.sirius_id IN ('COBRA', '13226164'), false) AS cobra
  FROM public.trust_wmb w
  JOIN public.trust_benefits b ON b.id = w.benefit_id
  CROSS JOIN params p
  LEFT JOIN public.employers e ON e.id = w.employer_id
  WHERE b.sirius_id = p.benefit_sirius_id
    AND w.year = extract(year FROM p.month)::int
    AND w.month = extract(month FROM p.month)::int
), person_month AS (
  SELECT worker_id, benefit_id,
    count(DISTINCT (coalesce(source_relation_id, ''), cobra)) AS classes,
    bool_or(source_relation_id IS NULL) AS has_own_coverage,
    min(source_relation_id) AS relation_id
  FROM held GROUP BY worker_id, benefit_id
), classified AS (
  SELECT CASE
    WHEN r.id IS NULL OR r.worker_1 IS NULL OR r.worker_2 IS NULL
      THEN 'Missing relationship or relationship endpoint'
    WHEN r.worker_2 <> child.worker_id THEN 'Relationship names a different dependent'
    WHEN nullif(r.start_ymd::text, '') > to_char(p.month + interval '1 month - 1 day', 'YYYY-MM-DD')
      THEN 'Relationship starts after the coverage month'
    WHEN nullif(r.end_ymd::text, '') < to_char(p.month, 'YYYY-MM-DD')
      THEN 'Relationship ends before the coverage month'
    WHEN parent.classes > 1 THEN NULL -- conflict exclusion, not this refusal
    WHEN parent.worker_id IS NULL THEN 'Subscriber has no coverage for this benefit and month'
    WHEN NOT parent.has_own_coverage THEN 'Subscriber only has dependent-sourced coverage'
    ELSE NULL
  END AS reason
  FROM person_month child
  CROSS JOIN params p
  LEFT JOIN public.worker_relations r ON r.id = child.relation_id
  LEFT JOIN person_month parent
    ON parent.worker_id = r.worker_1 AND parent.benefit_id = child.benefit_id
  WHERE child.classes = 1 AND child.relation_id IS NOT NULL
)
SELECT coalesce(reason, 'TOTAL REFUSED PERSON-MONTHS') AS reason,
       count(*) AS person_months
FROM classified WHERE reason IS NOT NULL
GROUP BY GROUPING SETS ((reason), ())
ORDER BY grouping(reason), reason;

ROLLBACK;
