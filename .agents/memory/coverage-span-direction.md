---
name: Maintained carrier coverage evidence
description: User-authorized replacement of event-only runtime reconstruction with denorm spans.
---

The user explicitly authorized maintained carrier-neutral coverage spans and
issues through the existing denorm framework, covering BOTH continuity and
termination evidence. This supersedes the older event-only runtime direction.
Eligibility plugins retain entitlement authority; relationship identity matters,
but relationship dates must not become a separate feed eligibility rule.

**Why:** Real Carelon staging repeatedly cancelled termination/continuation-summary
reads near ten seconds even after start-date optimization. Caching starts alone
does not address that failure. Carelon is the available staging carrier; comparable
historical Kaiser output must not be assumed.

**How to apply:** Keep source evidence and lifecycle consumers intact. Missing,
disabled, pending, stale or failed derivation must fail closed, never trigger a
runtime historical reconstruction. Label synthetic verification separately from
authorized staging evidence. No deployment, eligibility scans or carrier delivery
is authorized by this implementation work.

Upstream recomputation alone is not a new source observation: only semantic
evidence changes should invalidate ready consumers. A zero-stale observation
is neither a durable promise nor proof that upstream maintenance has finished.

**Why:** termination replacement could requeue spans even for empty or identical
event sets. Finite upstream catch-up could thus create new downstream work after
an operator observed zero. That mechanism does not by itself prove an infinite
loop or explain a remote count without contemporaneous producer evidence.

**How to apply:** keep actual source changes and invalidation in one transaction,
preserve inferred-versus-confirmed authority, compare the same config and
observation time, and distinguish saved wizard failures from fresh readiness.
Never suppress genuine invalidation just to restore a zero-stale display.

Readiness of a derived consumer does not prove completeness of an upstream
derived source. Ending-enabled feeds must gate both maintained spans and the
termination-event producer; a span may otherwise compute an empty ending before
the upstream producer discovers it.

**Why:** Scan completion enqueues those producers independently. A perfectly
atomic span apply can still summarize incomplete upstream events.

**How to apply:** Include upstream readiness/revision in the consumption barrier,
retain transactional downstream invalidation on upstream writes and scan resets,
and test the downstream-ready/upstream-missing, stale, failed and disabled cases.

Every scan-summary reset must capture retained `people` and `actions` recipients
before clearing evidence, not just the queue owner or today's relationships.

**Why:** A former family recipient can still have a live ending supported by
that scan. Once runtime reconstruction is removed, losing the summary without
invalidating that recipient leaves the old ending falsely ready.

**How to apply:** Lock and snapshot recipients in the reset transaction for
monthly enqueue, manual requeue and single/bulk invalidation alike; verify that
recomputing the owner alone cannot make the former recipient ready.
