# Kaiser EDI: confirming the event-based coverage check on real data

## Status

**Not yet verified end-to-end on real data.** The user attempted the shared
check with Carelon on bao-stg; it refused before the start-date phase (see
Results). The original Kaiser instructions below have not been executed.
The development workspace has no staging or
production access, and its own database cannot run a Kaiser feed (the Kaiser
benefit has no carrier identifier and no Kaiser run exists). Staging and
production inspection stays inside the HIPAA boundary, so the steps below are
for an authorized operator; the Results section is filled in from what they
report.

What exists so far:

- three read-only SQL scripts in `scripts/tools/edi-kaiser-verification/`;
- this runbook;
- a local check of the scripts on a disposable PostgreSQL 16 cluster with
  fictional rows (see "Local check of the scripts"). That check shows the
  scripts classify rows as intended. It says nothing about real Kaiser data.

## What is being confirmed

The Trust Provider EDI wizard now takes coverage start dates from `restart`
lifecycle events instead of scanning each person's coverage history month by
month. Two claims rest on synthetic evidence only:

1. start dates and COBRA flags equal the previous rule for members without
   conflicts;
2. the check stays fast with real per-query latency.

## Safety rules for the operator

- Do **not** press Generate on the old run. Regenerating deletes its saved rows
  and rebuilds them under the current rule; the baseline is then lost.
- Do **not** press "Deliver to …" on the new run. Downloading is safe: it uses
  saved rows, does not mark delivery complete and does not contact Kaiser.
- Do **not** correct coverage, relationship or employer records as part of
  this. The wizard and the scripts only read them.
- Do **not** mark maintenance records stale, or switch maintenance off, to
  produce a readiness refusal. Observe that state only if it occurs by itself.
- The scripts open a read-only transaction and end with `ROLLBACK`. Never put a
  connection string into a script, a ticket or a chat.
- Counts and timings may be shared. Record IDs, person IDs, the exclusion
  download and the generated file stay inside the boundary.

## Steps

### 1. Find the baseline run

Run `1-find-runs.sql`. Pick the latest Kaiser run whose `start_dates_from` is
`history scan (old rule)` and `saved_file_rows` is above 0. Note its
`wizard_id` and `as_of_date`. Also note a run with `saved_manual_decisions`
above 0 for step 5.

Open the old run's Deliver step and download the Provider file, so the baseline
also exists as a file. Do not press Generate.

If no old-rule run exists for any month, skip the file comparison: step 4 still
compares every new row with the old rule worked out from today's records. Say
so in the results.

### 2. Run the new check and generate

Create a new Kaiser run with the **same as-of month and the same termination
settings** as the baseline (`termination_settings` in step 1).

1. Coverage sources: let the check finish. Note the summary line (people
   checked, exclusions, warnings).
2. If exclusions are listed: download the exclusion list, read it, tick the
   acknowledgement and press "Acknowledge exclusion list".
3. Generate, and let final validation finish.

Note the wall-clock time of the Coverage sources check and of Generate.

### 3. Collect the timings

The per-phase timings are written to the application's console log (container
or CloudWatch logs), not the in-app log viewer. Search the time window of step
2 for:

```
EDI coverage resources
```

and keep the lines whose `event` is `phase-end`. Each carries `wizardId`,
`runId`, `phase` and `milliseconds`. There is one set for the Coverage sources
check and two for Generate (before generating, and final validation). The
phases are: Resolving benefits, Checking lifecycle events, Reading report-month
coverage, Reading termination evidence, Reading ended families, Reading
supplemental coverage, Reading coverage start events, Describing exclusions,
Fingerprinting evidence, and (Generate only) Generating file rows.

The line for **Reading coverage start events** also carries `anchors`,
`coverageMonthsRead` and `monthsBeforeRunStart`. `monthsBeforeRunStart` must be
`0` in all three sets: it is the measured proof that nothing older than a run
start was read.

If console logs are out of reach, step 4's first result set returns the saved
phase timings of the last Coverage sources check (`coverage_check_timings_ms`).
That does not include `monthsBeforeRunStart` or the Generate timings; record
that gap rather than assuming the value.

### 4. Compare the files

In `2-compare-runs.sql`, paste the old and new wizard ids and run it.

- First result set: both runs. `same_month` must be true, `old_run_rule` must
  be the old rule and `new_run_rule` the new one.
- Second result set: counts by outcome.

Outcomes, and what each needs:

| Outcome | Meaning | Action |
| --- | --- | --- |
| 1 | Identical / same start date and COBRA flag | None |
| 2 | Differs; the person is on the new run's exclusion or warning list | Explained by the list |
| 3 (file) | Differs; the old rule applied to today's records gives the new value | Explained: coverage changed since the old file |
| 3 (rule) | The old rule would have stopped on a conflicting month in the run | Explained: each is a listed warning |
| 4 | Only in the old file; excluded by the new run and listed | Explained by the list |
| 5 | Only in the old file; record gone or ending retired by later coverage | Explained: coverage changed |
| 6 | Only in the new file | Review inside the boundary: coverage added since the old file, or the old run left the member out |
| 9 | UNEXPLAINED | Review each one inside the boundary; any that remains unexplained is a finding |

To review outcomes 5 (rule), 6 and 9, set `edi.detail` to `'on'` and run again:
each such row is returned with its record ids, person id, both files' values
and the old rule's value on today's records. Keep that output inside the
boundary and report only the conclusion per row.

The comparison covers the two fields the change can move: coverage start date
and the COBRA enrollment unit (7000 / 0000).

### 5. Walk through the screens (signed-in administrator)

On the new run:

- [ ] Coverage sources shows the rule text, the summary line, the reason
      badges, "Excluded from this file" and "Warnings (not excluded)".
- [ ] "Download exclusion list" downloads a CSV with one line per coverage
      record.
- [ ] After acknowledging, the page names who acknowledged and when.
- [ ] Results shows the "left out of this file" box above the table, with the
      same counts.
- [ ] Deliver shows the same box with the same exclusion count. Do not send.

On the older run with saved manual decisions:

- [ ] Coverage sources shows "Earlier manual source decisions" as read-only
      entries (saved reason, who decided, when, candidates), with no way to
      change them. Do not press Generate on this run.

### 6. Readiness refusal (only if it happens by itself)

If a Coverage sources check answers "Coverage lifecycle events are not ready:
of N people in this run, … missing for A people, pending for B people, failed
for C people", run `3-readiness-counts.sql` for that run within seconds and
compare `people_in_run`, `missing`, `pending` and `failed` with the message.
The counts move while maintenance runs, so a small difference taken minutes
apart is not a finding.

If the state does not occur, record "not observed". After a check that passes,
the script should return 0 for all three counts.

### 7. Confirm nothing was changed

The wizard reads coverage, relationship and employer records through read-only
transactions, and the scripts run in `BEGIN READ ONLY … ROLLBACK`. To record
this from the system rather than from the design, check the in-app log viewer
for the time window of steps 2–6: there should be no `trust.wmb`, worker
relationship or employer entries attributed to the operator.

## What to send back

- Database name and date.
- Step 1: whether an old-rule Kaiser run existed, its as-of date, and whether a
  run with saved manual decisions existed.
- Step 2: people checked, exclusions, warnings; wall-clock times.
- Step 3: the `phase-end` lines (they contain ids, counts and timings, no
  member data), or `coverage_check_timings_ms` with the gap noted.
- Step 4: both result sets with `edi.detail` off, plus a one-line conclusion for
  each reviewed row.
- Step 5: the checklist, with anything that looked wrong.
- Step 6: the message and the script's counts, or "not observed".
- Step 7: yes/no.

## Results

End-to-end verification remains incomplete. Partial real-data evidence follows.

### Reported Carelon attempt

The user supplied a failed bao-stg Carelon Coverage sources check on
2026-11-19, for coverage month November 2026. There is no Kaiser run history on
the current bao-stg instance; this is evidence for the shared flow, not a Kaiser
file comparison. No member identifiers from the supplied logs are reproduced here.

| Completed phase | Milliseconds |
| --- | ---: |
| Resolving benefits | 31 |
| Checking lifecycle events | 3,288 |
| Reading report-month coverage | 952 |
| Reading termination evidence | 2,282 |

The logs show 22,529 report-month records and 663 termination events.
The check refused after approximately 6,556 milliseconds with 84
`subscriber-missing` person-month groups. That reason covers missing or
non-overlapping relationships, relationships naming a different dependent,
and a subscriber lacking their own benefit coverage in the report month.
The message does not distinguish those causes, and does not establish whether
the underlying data or the matching logic is wrong.

This refusal is raised after reading termination evidence but before reading
coverage start events. It is **not a timeout**, and does not measure the
optimized start-date phase. There is no observed `monthsBeforeRunStart` value,
generated-file comparison, or completed Generate/final validation.
Lifecycle readiness passed; this was not an event-readiness refusal.

`scripts/tools/edi-kaiser-verification/4-carelon-family-refusal-counts.sql`
provides a read-only, counts-only breakdown of the current report-month
refusals for an authorized staging operator. It does not repair records or
relax the exclusion policy. Do not change source records based only on the
combined error message.

The diagnostic was executed locally against disposable fictional PostgreSQL
tables: a valid family was not refused, and five invalid families were counted
under their respective causes (missing link, wrong dependent, future link,
ended link and absent subscriber coverage).

The user subsequently returned the staging diagnostic counts:

| Refusal cause | Person-months |
| --- | ---: |
| Relationship ends before the coverage month | 78 |
| Subscriber has no coverage for this benefit and month | 6 |
| Total | 84 |

This independently reproduces the refusal count from current staging records.
It supports the reported matching conditions, not a conclusion that the
coverage records are invalid: historical monthly benefit grants and current
relationship end dates may need reconciliation under the intended business
rule. No source correction or broader exclusion policy has been authorized.
The next investigation is why those monthly dependent grants survive ended
relationships or missing same-benefit subscriber coverage. Start-date
performance and output equivalence remain unverified.

### Eligibility ownership clarification

The user clarified that eligibility plugins own coverage: feeds must honor an
existing monthly benefit and must not impose relationship-date requirements.
Accordingly, the 78 ended-relationship findings identify an inappropriate
feed guard, not proof that those grants should be removed. This supersedes the
earlier uncertainty about whether the feed should enforce relationship dates.
No application behavior has yet been changed in this investigation.

Individual subscriber scans are a separate diagnostic for stale grants. The
worker Benefits Scan route includes dependents, and its dependent enumeration
includes prior/current attributed coverage even when the relationship is no
longer active. Start with November 2026 in Test mode; inspect proposed changes
and eligibility reasons for each affected dependent before any Live scan.
Live mode can create/delete coverage and is not read-only verification.
The six missing-subscriber cases also require inspection without assuming the
dependent's grant is invalid or silently dropping it from the carrier file.

### Source cause and cleanup

The user reported that fresh subscriber benefit scans resolved the six
missing-subscriber cases. The user traced the remaining cases to active source
relationships with blank dates receiving invented dates on import. Source
inspection confirmed that the missing-start transform manufactures start
2000-01-01 and, absent a source end, end 2000-01-02 regardless of active status.

The clarified rule retains the 2000-01-01 missing-start fallback but leaves a
blank end NULL when source status is ACTIVE. A separate migration-fleet task
has been opened; do not rerun migration before it is fixed.

The Neon-editor cleanup is
`scripts/tools/edi-kaiser-verification/5-clear-fabricated-relationship-ends.sql`.
It targets November Carelon relationships with the importer marker, both exact
sentinel dates, an unambiguous source mapping, explicitly active source status
and blank source start/end. It clears only end_ymd. The default final ROLLBACK
is a preview; the operator must review and save the returned repair receipt,
then change the final statement to COMMIT to apply. SQL bypasses application
audit/event hooks; it does not run eligibility scans or directly alter benefits.
No staging cleanup has been executed by this agent.

Verified on disposable PostgreSQL with fictional records: the two proven
active/blank-date targets were selected; explicit inactive status, real source
end, real source start, missing active status and unrelated coverage were not.
Preview persisted nothing; commit cleared only the two selected ends; a rerun
selected zero rows.

| Item | Result |
| --- | --- |
| Database / date | — |
| Coverage sources check: phase timings | — |
| Generate and final validation: phase timings | — |
| `monthsBeforeRunStart` (three sets) | — |
| File comparison: counts by outcome | — |
| Rule comparison: counts by outcome | — |
| Unexplained rows after review | — |
| Screen walkthrough | — |
| Readiness refusal counts | — |
| Source records unchanged | — |

## Local check of the scripts

Run on a disposable PostgreSQL 16 cluster with no TCP listener and fictional
rows, then removed. It checks the scripts, not the feed.

- `1-find-runs.sql` labelled a run without a saved exclusion digest as the old
  rule and one with it as the new rule, and counted file rows without the saved
  exclusion entries.
- `2-compare-runs.sql` classified fourteen constructed cases as intended:
  identical rows; a member paired by identity after their record id changed; a
  start floored at the Kaiser go-live date; a start that moved because a month
  of coverage was removed after the old file; a COBRA switch; a dependent; a
  member excluded by the new run; an earlier in-run conflict (old rule stops,
  listed warning); a termination row (not floored); an ending retired by later
  coverage; a deleted record; a member only in the new file; and a deliberately
  wrong start date and a deliberately wrong COBRA flag, both reported as
  UNEXPLAINED. With the old run left empty it returned the rule comparison
  alone. With the placeholders unedited it returned no rows.
- `3-readiness-counts.sql` returned the constructed population, missing,
  pending and failed counts per maintenance configuration.
- `1-find-runs.sql` was also run read-only against the development database: no
  Kaiser run exists there.

No permanent test was added: this is a one-off verification.
