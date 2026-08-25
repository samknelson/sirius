---
name: S1 dangling entity references
description: How to recognize and safely clean Drupal 7 field references left behind after a target node is deleted.
---

A deleted S1 Drupal node can leave live `field_data_*` entity-reference rows on current source entities. Staging is correct to preserve those live rows, and downstream loaders are correct to reject them as unmapped.

**Why:** A deleted trust-benefit node left a live reference on each affected election. The number of live source references exactly matched the loader's unmapped rejects, proving this was source referential cleanup—not stale target staging.

**How to apply:** Before cleanup, prove the target node is absent and every affected current entity retains another valid reference where required. Production S1 Beekeeper access is read-only; perform writes over SSH with a dry-run-first Drush script using Drupal APIs. Create a new current revision, preserve older history, and avoid rewriting unrelated sibling references.