---
name: S1 shop JSON is the employer config store
description: Where S1 keeps employer policy history and charge-plugin rate history, and the open rate-import gap
---

S1 (Drupal) shops (`grievance_shop`) have NO dedicated fields for employer policy or rates — both live in the shop's `field_sirius_json` blob, which staging captures whole:

- `ledger.policy.ebh` = employer policy history (`{policy: <S1 policy nid>, date}`), `ledger.policy.nid` = current. Imported by `load-employer-policies.ts` (runbook 5b). ~248 prod shops.
- `charge_plugins.settings.<uuid>.rates.history` = per-employer rate schedules (`{rate, date, ts}`), incl. future-dated negotiated increases. Imported by `load-employer-rates.ts` (RUNBOOK 5c) into `sitespecific_bao_employer_rates`, targeting the single enabled bao-hourly config's account.

**Why the uuids are plural:** S1 hosts (at least) two domains (nids 2124505, 2457501/Santa Monica); each domain configures its own charge-plugin instances, so 9 distinct settings uuids exist across shops. The uuid→plugin-type mapping lives on POLICY nodes (`sirius_json_definition` → `charge_plugins.items`); older instance generations were deleted/recreated, so shop settings keep history under ORPHANED uuids. Ruling (2026-08-09): 5 hourly uuids allow-listed in the loader with precedence order (54a9b912 > 8a1da7c9 > 0f5c5277 > dbf243fa > e367c62c), validated by full reconciliation against the S1 UI rate report (679 rows / 131 employers — every diff explained). Excluded: monthly-type uuids (029b60bf, 13c01f95, 059a34c0, d1a35aeb). Known prod dirt: 2 colon-typo rates (`bad_rate`, superseded elsewhere — allow) and 1 same-uuid same-date conflict shop (`rate_conflict` — fix in S1 or allow to skip that shop).

**How to apply:** any new "where does S1 keep employer-level setting X" question — check the shop's `field_sirius_json` first, then per-domain `variable` rows (`<domain-nid>/sirius_*`). The S1 `variable` table contains LIVE Stripe secret keys — never commit dumps of it; those keys are on the cutover rotation list.
