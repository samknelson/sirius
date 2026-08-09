---
name: Loader pre-checks must mirror the storage contract exactly (clock + error taxonomy)
description: Two lessons from chasing relationship-create failures - pre-checks must use the contract's clock, and storage validation-error FIELDS can mislead diagnosis.
---

**Rule 1 — same clock:** when a loader pre-validates rows against a storage contract, use the SAME clock/semantics the storage uses. For date-only "no future date" checks that is `getTodayYmd()` (server-LOCAL calendar date, shared/utils/date), never `new Date().toISOString().slice(0,10)` (UTC). Between local midnight and UTC midnight the UTC date is a day ahead, so "starts tomorrow local" rows slip past a UTC pre-check and die in storage instead of getting the dedicated reject. (Latent bug, fixed; was NOT the observed failure below.)

**Rule 2 — don't trust the validation-error field name:** `WorkerRelationValidationError.field` is a UI form-field pointer, not a cause. The duplicate-overlap guard ("these two workers already have this relationship for an overlapping period") throws on field `startYmd`, so duplicate S1 rows masqueraded as date-validation failures (`validation_startYmd`). Real cause was confirmed only by pulling the raw S1 rows: past dates, duplicate pair+type+window. Classify such known source conditions into their own reject reason (`duplicate_overlapping_relation`) by matching the storage error, not the field.

**How to apply:** when a loader reject wraps a storage error, resolve the actual thrown message/guard before theorizing; verify theories against raw source rows when available. Duplicate-source rejects recur on every rerun (stable count); genuinely transient storage failures don't.
