<?php

/**
 * Remove the dangling benefit reference from S1 worker elections.
 *
 * Run from the Drupal 7 root on the S1 host:
 *
 *   drush scr scripts/oneoffs/s1-drush-remove-stale-election-benefit-2457521.php
 *
 * The default is a dry run. To write:
 *
 *   drush scr scripts/oneoffs/s1-drush-remove-stale-election-benefit-2457521.php --apply
 *
 * This deliberately uses Drupal's node API rather than deleting field rows
 * directly. Each changed election receives a new current revision, while the
 * previous revision remains historical.
 */

$field_name = 'field_sirius_trust_benefits';
$election_bundle = 'sirius_trust_worker_election';
$benefit_bundle = 'sirius_trust_benefit';
$stale_benefit_nid = 2457521;
$maximum_expected_rows = 54;
$apply = (bool) drush_get_option('apply', FALSE);

/**
 * Stop with a visible error while keeping the transaction rollback-safe.
 */
function s1_t16_abort($message) {
  drush_log($message, 'error');
  throw new Exception($message);
}

drush_print($apply ? 'T16 stale-benefit cleanup: APPLY mode' : 'T16 stale-benefit cleanup: DRY RUN');
drush_print('Source benefit nid: ' . $stale_benefit_nid);

// The node was proven absent during triage. Re-check it on the live source.
if (node_load($stale_benefit_nid)) {
  s1_t16_abort('Guard failed: benefit nid ' . $stale_benefit_nid . ' still exists.');
}

$stale_query = db_query(
  'SELECT entity_id, revision_id, delta
     FROM {field_data_field_sirius_trust_benefits}
    WHERE entity_type = :entity_type
      AND bundle = :bundle
      AND deleted = 0
      AND field_sirius_trust_benefits_target_id = :benefit_nid
    ORDER BY entity_id, delta',
  array(
    ':entity_type' => 'node',
    ':bundle' => $election_bundle,
    ':benefit_nid' => $stale_benefit_nid,
  )
);

$stale_rows = array();
$rows_by_election = array();
foreach ($stale_query as $row) {
  $election_nid = (int) $row->entity_id;
  $stale_rows[] = $row;
  if (!isset($rows_by_election[$election_nid])) {
    $rows_by_election[$election_nid] = array();
  }
  $rows_by_election[$election_nid][] = $row;
}

$stale_count = count($stale_rows);
$election_count = count($rows_by_election);
drush_print('Remaining live stale rows: ' . $stale_count);
drush_print('Affected elections: ' . $election_count);

// A zero-row run is a successful idempotent no-op.
if ($stale_count === 0) {
  drush_print('NOOP_ALREADY_CLEAN');
  return;
}

if ($stale_count > $maximum_expected_rows) {
  s1_t16_abort(
    'Guard failed: found ' . $stale_count
    . ' stale rows; refusing more than ' . $maximum_expected_rows . '.'
  );
}

foreach ($rows_by_election as $election_nid => $rows) {
  if (count($rows) !== 1) {
    s1_t16_abort(
      'Guard failed: election ' . $election_nid
      . ' has ' . count($rows) . ' stale rows; expected exactly one.'
    );
  }
  if ((int) $rows[0]->delta !== 1) {
    s1_t16_abort(
      'Guard failed: election ' . $election_nid
      . ' stale row has delta ' . (int) $rows[0]->delta . '; expected delta 1.'
    );
  }
}

// Verify the source-side shape before loading or changing any nodes.
$other_query = db_query(
  'SELECT f.entity_id,
          f.delta,
          f.field_sirius_trust_benefits_target_id AS benefit_nid,
          n.type AS benefit_type
     FROM {field_data_field_sirius_trust_benefits} f
     LEFT JOIN {node} n
       ON n.nid = f.field_sirius_trust_benefits_target_id
    WHERE f.entity_type = :entity_type
      AND f.bundle = :bundle
      AND f.deleted = 0
      AND f.entity_id IN (:election_nids)
      AND f.field_sirius_trust_benefits_target_id <> :stale_benefit_nid
    ORDER BY f.entity_id, f.delta',
  array(
    ':entity_type' => 'node',
    ':bundle' => $election_bundle,
    ':election_nids' => array_keys($rows_by_election),
    ':stale_benefit_nid' => $stale_benefit_nid,
  )
);

$valid_other_by_election = array_fill_keys(array_keys($rows_by_election), 0);
foreach ($other_query as $row) {
  if ($row->benefit_type === $benefit_bundle) {
    $valid_other_by_election[(int) $row->entity_id]++;
  }
}

foreach ($valid_other_by_election as $election_nid => $valid_other_count) {
  if ($valid_other_count < 1) {
    s1_t16_abort(
      'Guard failed: election ' . $election_nid
      . ' has no other valid ' . $benefit_bundle . ' reference.'
    );
  }
}

drush_print('Guard: target benefit absent');
drush_print('Guard: one delta-1 stale row per election');
drush_print('Guard: every election has another valid benefit');

if (!$apply) {
  drush_print('DRY_RUN_ONLY: no nodes were changed. Re-run with --apply to write.');
  return;
}

$transaction = db_transaction();
$saved_count = 0;

try {
  foreach (array_keys($rows_by_election) as $election_nid) {
    $node = node_load($election_nid);
    if (!$node || $node->type !== $election_bundle) {
      s1_t16_abort('Guard failed during apply: election node ' . $election_nid . ' is missing or has the wrong type.');
    }

    $removed_count = 0;
    $valid_other_count = 0;

    if (!isset($node->{$field_name}) || !is_array($node->{$field_name})) {
      s1_t16_abort('Guard failed during apply: election ' . $election_nid . ' has no benefit field payload.');
    }

    foreach ($node->{$field_name} as $language => $items) {
      if (!is_array($items)) {
        continue;
      }

      foreach ($items as $delta => $item) {
        if (!is_array($item) || !isset($item['target_id'])) {
          continue;
        }

        $target_id = (int) $item['target_id'];
        if ($target_id === $stale_benefit_nid) {
          unset($node->{$field_name}[$language][$delta]);
          $removed_count++;
        } elseif ($target_id > 0) {
          $benefit = node_load($target_id);
          if ($benefit && $benefit->type === $benefit_bundle) {
            $valid_other_count++;
          }
        }
      }

      // Keep Drupal's current field payload compact after removing delta 1.
      $node->{$field_name}[$language] = array_values($node->{$field_name}[$language]);
    }

    if ($removed_count !== 1 || $valid_other_count < 1) {
      s1_t16_abort(
        'Guard failed during apply: election ' . $election_nid
        . ' removed=' . $removed_count
        . ', valid_other=' . $valid_other_count . '.'
      );
    }

    // Create a new current revision. The pre-cleanup revision remains history.
    $node->revision = 1;
    $node->log = 'S1 cleanup: remove dangling reference to deleted benefit nid ' . $stale_benefit_nid;
    node_save($node);
    $saved_count++;
  }

  $remaining = (int) db_query(
    'SELECT COUNT(*)
       FROM {field_data_field_sirius_trust_benefits}
      WHERE entity_type = :entity_type
        AND bundle = :bundle
        AND deleted = 0
        AND field_sirius_trust_benefits_target_id = :benefit_nid',
    array(
      ':entity_type' => 'node',
      ':bundle' => $election_bundle,
      ':benefit_nid' => $stale_benefit_nid,
    )
  )->fetchField();

  if ($saved_count !== $election_count || $remaining !== 0) {
    s1_t16_abort(
      'Post-check failed: saved=' . $saved_count
      . ', expected=' . $election_count
      . ', remaining stale rows=' . $remaining . '.'
    );
  }

  unset($transaction);
  drush_print('COMMITTED');
  drush_print('Saved elections: ' . $saved_count);
  drush_print('Remaining live stale rows: 0');
}
catch (Exception $exception) {
  // The transaction object rolls back when it goes out of scope without being
  // unset/committed. Re-throw so Drush exits non-zero.
  drush_log('ROLLBACK: ' . $exception->getMessage(), 'error');
  throw $exception;
}
