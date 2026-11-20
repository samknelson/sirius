# Maintained carrier coverage spans

## Contract and cutover

Migration **1225** creates core `denorm_span` and `denorm_issue` payload tables
without foreign keys to optional benefit tables. Both cascade from the existing
entity/config denorm status. All month boundaries are first-of-month dates.
Indexes support owner replacement and actual-benefit/month or termination lookup.
Carrier identifiers do not participate in the stored grain.

The producer retains receiver, actual benefit, source relationship, subscriber,
COBRA classification, usable interval, class continuity start, evidenced ending,
structured reason and event/scan references. Ordinary employer changes do not
split continuity. Source/classification changes do; a continuing benefit never
terminates merely because its classification changes.

An excluded historical conflict splits usable intervals without losing the
original class continuity start. Its complete person/benefit/month source records
remain issues and appear as warnings when a later file relies on that continuity.
Missing/invalid families and unsupported or contradicted endings remain issues.
Last-covered month alone never establishes termination.

The consumer now uses maintained starts, issues and endings. It may hydrate report
and last-covered month member/family records for carrier fields and counts, but
does not reconstruct continuous history or inspect continuation scan JSON.
Verification-only readers are explicitly prefixed `readSource…`. No incomplete
span state invokes them as a fallback.

## Freshness, maintenance and recovery

Both payload stores replace inside the existing claimed generation transaction.
The status row is retained, so generations remain monotonic. Failed writes roll
back status, spans and issues together. Source invalidations cancel old claims.
Payload IDs are deliberately rebuild-unstable and excluded from fingerprints.
Generation/freshness plus stable file facts protect generation and delivery.

The authoritative backfill population is workers, including computed-empty
workers. Readiness reports missing initial backfill, stale/processing and failed
counts separately; no span rows alone cannot establish absence or termination.
The entire producer population must be ready. For ending-enabled files,
`trust-wmb-terminate` must also be configured, enabled and current across that
population; its generation contributes to the revision. This prevents an empty
downstream result from concealing unfinished upstream termination maintenance.
This intentionally favors safety
over allowing a feed while unrelated workers are still being initialized.

Use the existing denorm backfill, recompute and rebuild controls for
**Worker benefit coverage spans**. Backfill enqueues bounded batches; computation
is separate. Disabled configurations retain invalidations. Failed records need
inspection before re-enqueueing. Never manually mark rows ready. Worker/contact
deletion removes the status and cascades both payload stores; ordinary widow
cleanup remains available through the existing framework.

Source writes, relationship changes, employer Sirius-ID classification changes,
retained event reconciliation, scan completion and scan resets (including manual
single-worker requeue and retained family recipients) invalidate affected
receivers/families. No source eligibility, relationship or employer records are
rewritten by the derivation.

## Reproducible local verification

```
EDI_COVERAGE_STARTS_PG=1 npx vitest run tests/edi tests/help tests/s1-migration/relationship-dates.test.ts
npm run check
npm run lint
```

The isolated PostgreSQL suites create temporary socket-only clusters and do not
read application database credentials. The final full run, including the
backfill benchmark and final bulk-reset regressions, passed **688 tests** across
16 files. The isolated PostgreSQL suite includes 13 tests. Server/client type checks and all 16
architecture lint rules passed. The development application applied migration
1225 and passed its schema drift gate.

The authored migration is exercised directly and idempotently in the isolated
fixture without the optional benefit schema. Coverage checks include split/merge
behavior, ordinary-employer/COBRA/source transitions, conflicting subscribers and
dependents, missing families, unsupported/inferred/confirmed endings,
reinstatement, delete/reinsert corrections, invalid month constraints,
initial/stale/error/ready/empty states, competing claims, intervening invalidation,
failed atomic replacement, cleanup and source-read comparison.

Completion-review regressions also exercise manual completed-scan requeue with
current and retained family recipients; downstream-ready/upstream-missing, stale,
failed and disabled termination maintenance; transactional downstream invalidation
when upstream events are saved; and subscriber-only/dependent-only policies with
opposite-role unsupported or contradicted ending issues. Unclassifiable ending
issues remain fail-closed.

The final bulk-reset finding was corrected after completion review: month-wide
enqueue and single/bulk invalidation now lock and capture queue owners plus every
retained `people`/`actions` recipient before clearing summaries. The same helper is
used by manual requeue. Three PostgreSQL regressions use live former recipients
with no current relationship and prove that recomputing only the owner cannot
make their old endings pass readiness.

Existing carrier layout, native/QA output, termination policies, conflict
acknowledgment/download/count and permissions tests remain in the EDI suite.
Older lifecycle query tests now explicitly exercise the source-comparison
baseline rather than pretending to cover the maintained runtime query.

### Local measurements — not staging claims

Observed on the isolated local PostgreSQL fixture:

| Measurement | Result |
|---|---|
| Indexed ending lookup over 100,000 synthetic spans | 84 matches; 0.178 ms execution; `denorm_span_subject_termination_idx`; 86 shared buffers hit |
| One-worker source/maintained start and ending comparison | No differences; 36 ms; 12 read calls |
| Comparison heap used | 46,837,184 → 48,188,912 bytes |
| Bounded backfill | 1,000 missing workers, five batches of 200 |
| Drain | 1,003 claimed rows including three existing fixture rows; 24 synthetic coverage months per worker compressed to one span |
| Enqueue + derivation + apply + readiness | 2,433 ms |
| Final readiness query | 4 ms for 1,003 live workers |
| Backfill heap used | 47,069,472 → 50,109,864 bytes |
| Backfill RSS | 136,122,368 → 147,845,120 bytes |

These measurements are not comparable to hosted round-trip latency and are not
peak-memory measurements. They prove local query selection, bounded batching and
observed retained-memory change, not Carelon staging throughput or file parity.

### Comparison API and known semantic differences

`server/services/coverage-spans/compare.ts` exports
`compareCoverageSpanEvidence(ctx, anchorIds, benefitIds)`. Supply an authorized,
read-only EDI context for a pinned snapshot and at most 500 anchors/20 benefits.
The result includes start differences, ending differences, elapsed time and
memory snapshots. Differences are returned for review, not automatically accepted
or “fixed” by modifying source evidence.

Intentional changes to the old baseline:

- Relationship dates no longer independently veto already-granted coverage;
  family identity and subscriber coverage still must be valid.
- Spans summarize authoritative monthly coverage directly. A missing/behind
  restart event is not itself an entitlement decision; the comparison exposes
  any resulting start difference for review.
- Incomplete maintained data refuses the feed rather than invoking the source
  reader. The authoritative worker population, not payload presence, defines
  completion.

## Authorized Carelon staging verification procedure

No staging measurement or historical Kaiser parity is claimed here. No carrier
file was delivered and no deployment was performed.

1. Pin the staging snapshot, Carelon config, report month and termination policy.
   Record enabled components and the coverage producer config.
2. Do not run eligibility scans, repair source records, change migration date
   rules, deploy code, or deliver carrier files as part of this check.
3. Run the bounded comparison API with the authorized read-only context and exact
   anchors. Record all differences and review source/class changes, conflicts,
   inference, reinstatement and missing lifecycle evidence separately.
4. Record missing/stale/error counts and backfill batch/drain totals. Do not
   advance while maintained evidence is incomplete.
5. Run Coverage sources, Generate and final validation without delivery. Record
   their existing phase timings, read counts and process memory, plus query plans
   for the actual populated and empty cases. Confirm no runtime scan-summary or
   historical continuity reconstruction query is executed.
6. Compare native carrier and QA files/counts. Change a fixture source between
   checking and generating to verify obsolete evidence cannot be accepted.
   Exercise exclusions downloads and acknowledgment invalidation.

## Help and reversal

Updated `system:edi-termination-guidance` in the existing help framework with
maintenance/readiness and recovery wording. Help registry/routing/sanitization
tests passed. The application sign-in page rendered after restart; the signed-in
help dialog was not visually verified.

A consumer reversal must explicitly restore the previous consumer and its
readiness contract; it must not introduce an automatic fallback. Payload tables
may remain during reversal. Preserve source WMB, relationship, employer, scan and
lifecycle evidence. Never delete source records to make comparison results agree.
