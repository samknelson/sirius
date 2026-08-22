-- S1 rehearsal target: WMB relationship-authority fallback preflight
--
-- Use this when s1_staging.t17_desired_spans does not exist because T17 has
-- never completed on the rehearsal target.
--
-- READ-ONLY OVERALL: temporary plan inside a transaction, ending ROLLBACK.
-- Run this entire file as one SQL submission/session after first issuing
-- ROLLBACK if the prior query failed.
--
-- Authority rule:
-- - T17 resolves dependent coverage through the staged S1 relation's id_map
--   target, and stores that target in trust_wmb.source_relation_id.
-- - For each duplicate-worker overlap, the stale WMB row is adoptable only if
--   it points at the stale worker's sole relation AND that relation is a
--   current S1 relation id_map target.
-- - The canonical row must have NULL provenance (or already the same relation)
--   so no independent relationship claim is overwritten.

BEGIN;

CREATE TEMP TABLE wmb_collision_worker_plan (
  stale_worker_id varchar PRIMARY KEY,
  canonical_worker_id varchar NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO wmb_collision_worker_plan (
  stale_worker_id,
  canonical_worker_id
) VALUES
  ('0ce7767d-7dd7-4720-9190-97684872830c', '62703dd1-3a26-4ce4-9feb-a68a885014a6'),
  ('0e2571bd-5b3f-4b30-80a3-03f00e7e74f1', '93d9f467-ac01-4560-a594-d53c29ea219d'),
  ('20d9774a-2047-4b49-8194-9e9e84a159de', '05adec89-3e93-4d21-aa11-345481e381ca'),
  ('6506f9ec-79b8-4ea3-b9a5-80efdf3ef710', 'f8044871-27bf-45d6-83bc-4579284540c4'),
  ('69414db0-7aca-47bc-a166-017c3880ca19', '695a960c-8e8e-4b85-85ba-39e4dfcadc5c'),
  ('6f33dada-eeac-4eef-8214-bcbaa7a07b42', 'affab09c-bcf0-4e67-87ec-ba66ce9a7f50'),
  ('8ee36c3a-8f74-4563-9b41-0b647a3ce4af', '0be59a23-163e-4071-8486-d63eb1d4bbf2'),
  ('920744de-fc63-4e69-8221-6375111d9fb2', 'fa9249c0-1d2e-435c-b9a7-6e9c9dbe4284'),
  ('9c1f821d-dbe7-4e5f-9221-cdf086078acc', 'e542bd18-cf45-449b-b3fe-b6d0100675db'),
  ('b8f7044f-8abc-43f3-8f9c-3f30e41e2f89', '9b23185d-831f-43d7-81e9-3f0324f74680'),
  ('bb49c9b3-a2c1-4531-b16b-1e15c82cfb27', '67a0b5f8-21a4-4bd2-a09e-d60fc615af4f'),
  ('c2d128f1-c76e-49f7-b051-daf527983d8d', '4440b2a6-b640-4587-ad9c-d612a8b88d40');

CREATE TEMP TABLE classified_wmb_collisions
ON COMMIT DROP
AS
WITH stale_relations AS (
  SELECT
    plan.stale_worker_id,
    plan.canonical_worker_id,
    min(relation.id) AS stale_relation_id,
    count(DISTINCT relation.id)::bigint AS stale_relation_count,
    count(DISTINCT mapping.s1_id)::bigint AS relation_id_map_count
  FROM wmb_collision_worker_plan plan
  LEFT JOIN worker_relations relation
    ON relation.worker_2 = plan.stale_worker_id
  LEFT JOIN s1_staging.id_map mapping
    ON mapping.entity = 'relation'
   AND mapping.s2_id = relation.id
  GROUP BY plan.stale_worker_id, plan.canonical_worker_id
)
SELECT
  plan.stale_worker_id,
  plan.canonical_worker_id,
  stale_wmb.id AS stale_wmb_id,
  canonical_wmb.id AS canonical_wmb_id,
  relation.stale_relation_id,
  relation.stale_relation_count,
  relation.relation_id_map_count,
  stale_wmb.source_relation_id AS stale_source_relation_id,
  canonical_wmb.source_relation_id AS canonical_source_relation_id,
  CASE
    WHEN relation.stale_relation_count <> 1
      THEN 'STOP: stale worker does not have exactly one relation'
    WHEN relation.relation_id_map_count = 0
      THEN 'STOP: stale relation is not a current S1 id_map target'
    WHEN stale_wmb.source_relation_id IS DISTINCT FROM relation.stale_relation_id
      THEN 'STOP: stale WMB does not point to the authoritative stale relation'
    WHEN canonical_wmb.source_relation_id IS NULL
      THEN 'READY: adopt stale relationship provenance on canonical row'
    WHEN canonical_wmb.source_relation_id = relation.stale_relation_id
      THEN 'READY: both rows already use the authoritative relation'
    ELSE 'STOP: canonical WMB carries competing relationship provenance'
  END AS decision
FROM wmb_collision_worker_plan plan
JOIN stale_relations relation
  ON relation.stale_worker_id = plan.stale_worker_id
JOIN trust_wmb stale_wmb
  ON stale_wmb.worker_id = plan.stale_worker_id
JOIN trust_wmb canonical_wmb
  ON canonical_wmb.worker_id = plan.canonical_worker_id
 AND canonical_wmb.month = stale_wmb.month
 AND canonical_wmb.year = stale_wmb.year
 AND canonical_wmb.employer_id = stale_wmb.employer_id
 AND canonical_wmb.benefit_id = stale_wmb.benefit_id;

-- RESULT SET 1: DIRECT RELATION-AUTHORITY CLASSIFICATION
-- Expected total overlap rows: 727.
-- Any STOP row blocks the execution transaction.
SELECT
  stale_worker_id,
  canonical_worker_id,
  count(*)::bigint AS overlap_rows,
  count(*) FILTER (
    WHERE decision = 'READY: adopt stale relationship provenance on canonical row'
  )::bigint AS adopt_stale_provenance,
  count(*) FILTER (
    WHERE decision = 'READY: both rows already use the authoritative relation'
  )::bigint AS already_authoritative,
  count(*) FILTER (
    WHERE decision LIKE 'STOP:%'
  )::bigint AS blocked_rows,
  CASE
    WHEN count(*) FILTER (WHERE decision LIKE 'STOP:%') = 0
      THEN 'READY'
    ELSE 'STOP'
  END AS validation
FROM classified_wmb_collisions
GROUP BY stale_worker_id, canonical_worker_id
ORDER BY stale_worker_id;

-- RESULT SET 2: STOP REASON COUNTS
-- Expected result: zero rows.
SELECT
  decision,
  count(*)::bigint AS affected_rows
FROM classified_wmb_collisions
WHERE decision LIKE 'STOP:%'
GROUP BY decision
ORDER BY decision;

-- RESULT SET 3: NON-FK REFERENCES TO THE OVERLAPPING WMB ROW IDs
-- Any stale-row wb anchor and ledger reference must be repointed to the
-- surviving canonical WMB ID before the stale WMB row is deleted.
SELECT
  collision.stale_worker_id,
  collision.canonical_worker_id,
  count(*)::bigint AS overlap_rows,
  COALESCE(sum(stale_anchor.references), 0)::bigint
    AS stale_wb_anchor_references,
  COALESCE(sum(canonical_anchor.references), 0)::bigint
    AS canonical_wb_anchor_references,
  COALESCE(sum(stale_ledger.references), 0)::bigint
    AS stale_ledger_references,
  COALESCE(sum(canonical_ledger.references), 0)::bigint
    AS canonical_ledger_references
FROM classified_wmb_collisions collision
LEFT JOIN LATERAL (
  SELECT count(*)::bigint AS references
  FROM s1_staging.id_map mapping
  WHERE mapping.entity = 'wb'
    AND mapping.s2_id = collision.stale_wmb_id
) stale_anchor ON true
LEFT JOIN LATERAL (
  SELECT count(*)::bigint AS references
  FROM s1_staging.id_map mapping
  WHERE mapping.entity = 'wb'
    AND mapping.s2_id = collision.canonical_wmb_id
) canonical_anchor ON true
LEFT JOIN LATERAL (
  SELECT count(*)::bigint AS references
  FROM ledger ledger_entry
  WHERE ledger_entry.reference_type = 'wmb'
    AND ledger_entry.reference_id = collision.stale_wmb_id
) stale_ledger ON true
LEFT JOIN LATERAL (
  SELECT count(*)::bigint AS references
  FROM ledger ledger_entry
  WHERE ledger_entry.reference_type = 'wmb'
    AND ledger_entry.reference_id = collision.canonical_wmb_id
) canonical_ledger ON true
GROUP BY collision.stale_worker_id, collision.canonical_worker_id
ORDER BY collision.stale_worker_id;

-- RESULT SET 4: CURRENT RELATION MAPPING
-- Expected: each stale relation has one or more relation id_map entries.
SELECT
  relation.stale_worker_id,
  relation.canonical_worker_id,
  relation.stale_relation_id,
  relation.stale_relation_count,
  relation.relation_id_map_count,
  CASE
    WHEN relation.stale_relation_count = 1
     AND relation.relation_id_map_count > 0
      THEN 'READY'
    ELSE 'STOP'
  END AS validation
FROM (
  SELECT
    plan.stale_worker_id,
    plan.canonical_worker_id,
    min(worker_relation.id) AS stale_relation_id,
    count(DISTINCT worker_relation.id)::bigint AS stale_relation_count,
    count(DISTINCT mapping.s1_id)::bigint AS relation_id_map_count
  FROM wmb_collision_worker_plan plan
  LEFT JOIN worker_relations worker_relation
    ON worker_relation.worker_2 = plan.stale_worker_id
  LEFT JOIN s1_staging.id_map mapping
    ON mapping.entity = 'relation'
   AND mapping.s2_id = worker_relation.id
  GROUP BY plan.stale_worker_id, plan.canonical_worker_id
) relation
ORDER BY relation.stale_worker_id;

ROLLBACK;