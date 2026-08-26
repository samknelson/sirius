/*
  READ-ONLY triage for:
    email_owned_by_other_s1_user { uid: 173106, otherUid: 164312 }

  Run on the rehearsal S2 database in Neon's SQL editor. This intentionally
  does not display either email address. It compares normalized values and
  reports only presence, equality, lengths, S2 ids, and migration metadata.
*/
WITH target_source AS (
  SELECT
    ru.uid,
    NULLIF(lower(trim(ru.mail)), '') AS current_mail,
    ru.status
  FROM s1_staging.raw_users ru
  WHERE ru.uid = 173106
),
target_mapping AS (
  SELECT m.s1_id AS uid, m.s2_id, m.stub, m.loader
  FROM s1_staging.id_map m
  WHERE m.entity = 'user' AND m.s1_id = 173106
),
email_clash AS (
  SELECT u.*
  FROM users u
  JOIN target_source t
    ON lower(u.email) = t.current_mail
),
claimed_owner AS (
  SELECT
    c.id AS clash_user_id,
    CASE
      WHEN (c.data -> 's1' ->> 'uid') ~ '^[0-9]+$'
        THEN (c.data -> 's1' ->> 'uid')::bigint
      ELSE NULL
    END AS claimed_uid
  FROM email_clash c
),
owner_source AS (
  SELECT
    ru.uid,
    NULLIF(lower(trim(ru.mail)), '') AS current_mail,
    ru.status
  FROM s1_staging.raw_users ru
  WHERE ru.uid = 164312
),
owner_mapping AS (
  SELECT m.s1_id AS uid, m.s2_id, m.stub, m.loader
  FROM s1_staging.id_map m
  WHERE m.entity = 'user' AND m.s1_id = 164312
)
SELECT
  t.uid AS incoming_uid,
  t.status AS incoming_s1_status,
  t.current_mail IS NOT NULL AS incoming_s1_user_mail_present,
  length(t.current_mail) AS incoming_mail_length,

  tm.s2_id AS incoming_mapped_s2_user_id,
  target_user.id IS NOT NULL AS incoming_mapped_s2_row_exists,
  CASE
    WHEN target_user.id IS NULL OR t.current_mail IS NULL THEN NULL
    ELSE lower(target_user.email) = t.current_mail
  END AS incoming_mapped_row_has_current_mail,

  c.id AS email_clash_s2_user_id,
  c.is_active AS email_clash_is_active,
  c.account_status AS email_clash_account_status,
  length(c.email) AS email_clash_mail_length,
  co.claimed_uid AS email_clash_metadata_s1_uid,
  c.id = tm.s2_id AS clash_is_incoming_uid_mapping,

  o.uid AS reported_other_uid,
  o.status AS other_s1_status,
  o.current_mail IS NOT NULL AS other_current_s1_user_mail_present,
  CASE
    WHEN o.current_mail IS NULL OR t.current_mail IS NULL THEN NULL
    ELSE o.current_mail = t.current_mail
  END AS other_current_s1_mail_matches_incoming,

  om.s2_id AS other_mapped_s2_user_id,
  owner_user.id IS NOT NULL AS other_mapped_s2_row_exists,
  c.id = om.s2_id AS clash_is_other_uid_canonical_mapping,
  CASE
    WHEN owner_user.id IS NULL OR o.current_mail IS NULL THEN NULL
    ELSE lower(owner_user.email) = o.current_mail
  END AS other_mapped_row_has_other_current_mail,

  CASE
    WHEN c.id IS NULL
      THEN 'no_clash_now'
    WHEN co.claimed_uid IS NULL
      THEN 'clash_has_no_s1_owner_metadata'
    WHEN co.claimed_uid <> 164312
      THEN 'reported_owner_metadata_changed'
    WHEN om.s2_id IS NULL OR om.s2_id <> c.id
      THEN 'stale_s1_metadata_not_canonical_owner_mapping'
    WHEN o.current_mail IS NULL
      THEN 'canonical_other_mapping_but_other_now_has_no_mail'
    WHEN o.current_mail <> t.current_mail
      THEN 'canonical_other_mapping_but_email_is_stale'
    ELSE 'current_source_still_assigns_email_to_other_uid'
  END AS diagnosis
FROM target_source t
LEFT JOIN target_mapping tm ON tm.uid = t.uid
LEFT JOIN users target_user ON target_user.id = tm.s2_id
LEFT JOIN email_clash c ON true
LEFT JOIN claimed_owner co ON co.clash_user_id = c.id
LEFT JOIN owner_source o ON o.uid = 164312
LEFT JOIN owner_mapping om ON om.uid = 164312
LEFT JOIN users owner_user ON owner_user.id = om.s2_id;