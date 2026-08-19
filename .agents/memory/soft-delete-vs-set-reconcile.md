---
name: Soft-delete vs set-reconcile
description: Check a storage delete method's semantics before building a set-reconcile on it; soft-deleted rows must be filtered from the reconcile read.
---

# Soft-delete vs set-reconcile

Before writing a set-reconcile (add missing / remove vanished) on top of storage methods, check whether "delete" is soft. `deleteContactPostal` flips `is_active=false`; the plain per-contact read returns live AND dead rows, while `findMatchingAddress`/`createOrMatchAddress` match ACTIVE rows only.

**Why:** an unfiltered read makes a reconcile re-"remove" long-dead rows every run (counter churn), and — worse — lets the "equivalent row already exists" check match an INACTIVE row and skip re-creating data the source still has, so it never resurfaces.

**How to apply:** the reconcile read must apply the same liveness filter the app's own match/read paths use (`is_active` etc.). Raw-SQL smoke asserts against such tables must filter liveness too. Applies to any table with deactivation semantics — grep the delete method body before trusting it.
