-- S1 rehearsal target: WMB authority + non-FK reference preflight
--
-- READ-ONLY OVERALL: temporary plan inside a transaction, ending ROLLBACK.
-- Run this entire file as one SQL submission/session against the confirmed
-- migration-rehearsal-2026-08-06 target.
--
-- The prior collision preflight found 727 trust_wmb key overlaps across these
-- 12 duplicate-worker pairs. This query compares both live rows to T17's
-- persisted desired spans, but only trusts spans whose logic version and
-- consumed fingerprint still match the current staged S1 source record.

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
SELECT
  plan.stale_worker_id,
  plan.canonical_worker_id,
  stale_wmb.id AS stale_wmb_id,
  canonical_wmb.id AS canonical_wmb_id,
  stale_wmb.source_relation_id AS stale_source_relation_id,
  canonical_wmb.source_relation_id AS canonical_source_relation_id,
  desired.matching_span_count,
  desired.current_span_count,
  desired.desired_source_relation_id,
  CASE
    WHEN desired.matching_span_count = 0
      THEN 'STOP: no T17 desired span covers this WMB key'
    WHEN desired.current_span_count <> desired.matching_span_count
      THEN 'STOP: T17 desired span fingerprint is stale'
    WHEN desired.desired_source_relation_id
         IS NOT DISTINCT FROM stale_wmb.source_relation_id
     AND desired.desired_source_relation_id
         IS NOT DISTINCT FROM canonical_wmb.source_relation_id
      THEN 'READY: both rows already match desired provenance'
    WHEN desired.desired_source_relation_id
         IS NOT DISTINCT FROM stale_wmb.source_relation_id
      THEN 'READY: adopt stale relationship provenance on canonical row'
    WHEN desired.desired_source_relation_id
         IS NOT DISTINCT FROM canonical_wmb.source_relation_id
      THEN 'READY: keep canonical relationship provenance'
    ELSE 'STOP: neither live WMB row matches T17 desired provenance'
  END AS decision
FROM wmb_collision_worker_plan plan
JOIN trust_wmb stale_wmb
  ON stale_wmb.worker_id = plan.stale_worker_id
JOIN trust_wmb canonical_wmb
  ON canonical_wmb.worker_id = plan.canonical_worker_id
 AND canonical_wmb.month = stale_wmb.month
 AND canonical_wmb.year = stale_wmb.year
 AND canonical_wmb.employer_id = stale_wmb.employer_id
 AND canonical_wmb.benefit_id = stale_wmb.benefit_id
LEFT JOIN LATERAL (
  SELECT
    count(*)::bigint AS matching_span_count,
    count(*) FILTER (
      WHERE staged.nid IS NOT NULL
        AND span.logic_version = 1
        AND span.consumed_fingerprint IS NOT DISTINCT FROM staged.content_hash
    )::bigint AS current_span_count,
    (array_agg(span.source_relation_id ORDER BY span.nid))[1]
      AS desired_source_relation_id
  FROM s1_staging.t17_desired_spans span
  LEFT JOIN s1_staging.records staged
    ON staged.bundle = 'sirius_trust_worker_benefit'
   AND staged.nid = span.nid
  WHERE span.worker_id = plan.canonical_worker_id
    AND span.employer_id = stale_wmb.employer_id
    AND span.benefit_id = stale_wmb.benefit_id
    AND (stale_wmb.year * 12 + stale_wmb.month - 1)
        BETWEEN span.start_idx
            AND COALESCE(
                  span.end_idx,
                  stale_wmb.year * 12 + stale_wmb.month - 1
                )
) desired ON true;

-- RESULT SET 1: SOURCE-AUTHORITY CLASSIFICATION
-- Expected total overlap rows: 727.
-- Any decision beginning with STOP blocks the execution transaction.
SELECT
  stale_worker_id,
  canonical_worker_id,
  count(*)::bigint AS overlap_rows,
  count(*) FILTER (
    WHERE decision = 'READY: adopt stale relationship provenance on canonical row'
  )::bigint AS adopt_stale_provenance,
  count(*) FILTER (
    WHERE decision = 'READY: keep canonical relationship provenance'
  )::bigint AS keep_canonical_provenance,
  count(*) FILTER (
    WHERE decision = 'READY: both rows already match desired provenance'
  )::bigint AS both_match_desired,
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
-- Expected result: zero rows. Counts only; no source/person data.
SELECT
  decision,
  count(*)::bigint AS affected_rows
FROM classified_wmb_collisions
WHERE decision LIKE 'STOP:%'
GROUP BY decision
ORDER BY decision;

-- RESULT SET 3: NON-FK REFERENCES TO OVERLAPPING WMB ROW IDs
-- The final transaction must repoint every stale-row wb anchor and ledger
-- reference to the surviving canonical WMB row before deleting the stale row.
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
  FROM ledger entry
  WHERE entry.reference_type = 'wmb'
    AND entry.reference_id = collision.stale_wmb_id
) stale_ledger ON true
LEFT JOIN LATERAL (
  SELECT count(*)::bigint AS references
  FROM ledger entry
  WHERE entry.reference_type = 'wmb'
    AND entry.reference_id = collision.canonical_wmb_id
) canonical_ledger ON true
GROUP BY collision.stale_worker_id, collision.canonical_worker_id
ORDER BY collision.stale_worker_id;

-- RESULT SET 4: RELATION AUTHORITY
-- Every stale relationship should be a current id_map target and every desired
-- provenance selected above must point to that same relation before it is
-- reparented from stale worker_2 to canonical worker_2.
WITH stale_relations AS (
  SELECT
    plan.stale_worker_id,
    plan.canonical_worker_id,
    relation.id AS stale_relation_id,
    (
      SELECT count(*)::bigint
      FROM s1_staging.id_map mapping
      WHERE mapping.entity = 'relation'
        AND mapping.s2_id = relation.id
    ) AS relation_anchor_count,
    (
      SELECT count(*)::bigint
      FROM classified_wmb_collisions collision
      WHERE collision.stale_worker_id = plan.stale_worker_id
        AND collision.desired_source_relation_id = relation.id
    ) AS desired_overlap_rows
  FROM wmb_collision_worker_plan plan
  JOIN worker_relations relation
    ON relation.worker_2 = plan.stale_worker_id
)
SELECT
  stale_worker_id,
  canonical_worker_id,
  stale_relation_id,
  relation_anchor_count,
  desired_overlap_rows,
  CASE
    WHEN relation_anchor_count = 0
      THEN 'STOP: stale relation is not an authoritative S1 relation target'
    WHEN desired_overlap_rows = 0
      THEN 'STOP: T17 does not select the stale relation for any overlap'
    ELSE 'READY'
  END AS validation
FROM stale_relations
ORDER BY stale_worker_id;

ROLLBACK;