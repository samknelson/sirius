# Sheet worker display-ID download investigation

## Result

The current client has **no consumers** of
`GET /api/edls/sheets/:id/worker-display-ids`. There is no repeated
display-ID download to consolidate. No runtime changes were made: adding
a query/cache for an unused request would add complexity without saving work.

This is an investigation of the code present on November 23, 2026, not a
production traffic measurement. The task's assumption about client consumers
is no longer true.

## Consumer and frequency audit

Searched all client sources for `worker-display-ids`, `workerIdTypeConfigured`,
`displayIdValues`, related display-ID names, and `worker_id_type`; inspected
the sheet layout, Overview, Assignments, Next Assignments, and shared
`SheetDetailsView` request declarations.

- `client/src/pages/edls/sheet-details.tsx`: crews, assignments, and available
  workers; no display-ID query.
- `client/src/pages/edls/sheet-assignments.tsx`: assignments, available workers
  (rating-scoped), component config, ratings, and classifications; no
  display-ID query.
- `client/src/pages/edls/sheet-next-assignments.tsx`: crews, assignments, and
  next assignments; no display-ID query.
- `client/src/components/layouts/EdlsSheetLayout.tsx`: sheet and tab access;
  no display-ID query.
- `client/src/components/edls/SheetDetailsView.tsx`: crew leads and
  classifications; no display-ID query.
- Time on Site still uses `workerIdTypeConfigured`, but receives its data from
  the separate `/api/edls/tos` endpoint. EDLS settings still configure
  `worker_id_type`; neither is a sheet display-ID endpoint consumer.

Git history confirms the Overview and Assignments display-ID queries and
their rendering props were removed on November 19, 2026, in
“Refactor EDL sheet components and clean up unused code.”

### Before/after work for this task

These counts are established by the absence of a request producer in the
current client, **not** by navigating authenticated pages in a browser.

| Operation | Before requests / response-body bytes | After requests / response-body bytes |
| --- | ---: | ---: |
| Open sheet Overview | 0 / 0 | 0 / 0 |
| Open sheet Assignments | 0 / 0 | 0 / 0 |
| Open Next Assignments | 0 / 0 | 0 / 0 |
| Repeat or alternate those views | 0 / 0 | 0 / 0 |
| Change rating or crew filters | 0 / 0 | 0 / 0 |

Counts cover **only this endpoint**, not other sheet requests. They are
independent of roster size. Savings attributable to this task: **0 requests,
0 bytes**. No historical savings are attributed to this task.

## Large-roster response measurements

Although unused by the client, the route still returns a population-sized
mapping when called directly. Measured the actual registered route using
the existing mocked-storage handler harness in
`tests/edls/worker-display-ids.test.ts`, temporarily supplying large fixtures.
No live worker data was read or created.

Each fixture had N active workers, 100 active assigned workers already in
that population, and 100 additional inactive assigned workers. Worker keys
were 36-character UUID-shaped strings; every unique worker had a nine-digit
ID value. All N + 100 distinct mappings, including every inactive assigned
worker, were asserted present.

| Active roster | Inactive assigned | Mapping entries | JSON bytes per direct response, before = after | Illustrative gzip bytes |
| ---: | ---: | ---: | ---: | ---: |
| 1,000 | 100 | 1,100 | 56,142 | 5,673 |
| 10,000 | 100 | 10,100 | 515,142 | 51,466 |
| 50,000 | 100 | 50,100 | 2,555,142 | 254,580 |

JSON size was `Buffer.byteLength(JSON.stringify(response.body))`. Gzip was
`gzipSync(json).byteLength`, not a measured HTTP transfer: sequential
synthetic UUIDs compress unusually well, and deployment compression was
not measured. These are body sizes, excluding HTTP headers, storage latency,
and browser parsing costs.

Fixture construction, sufficient to reproduce the inputs in that harness:

```ts
const workerId = (i: number) =>
  `00000000-0000-4000-8000-${i.toString().padStart(12, "0")}`;
const population = Array.from({ length: N }, (_, i) => workerId(i));
const inactive = Array.from({ length: 100 }, (_, i) => workerId(N + i));
// getPopulationWorkerIds returns population.
// getAssignments returns population.slice(0, 100) + inactive as {workerId} rows.
// getWorkerIds returns each requested ID with value String(100_000_000 + index).
```

The temporary measurement case was run with:

```sh
npx vitest run tests/edls/worker-display-ids.test.ts \
  --silent=false --reporter=verbose --disableConsoleIntercept
```

All nine cases passed, including the temporary three-roster measurement
case and the eight existing route cases. The measurement case was then
removed rather than adding a synthetic benchmark to every future test run.
The existing eight route cases remain unchanged.

## Access, freshness, and behavior

The endpoint and its authentication, component, and `edls.sheet.view`
sheet-ID gate remain unchanged. Each direct request still reads current
settings, unions assigned worker IDs with active-population IDs, deduplicates
them, and queries the configured ID type. No configured type still returns
`{ workerIdTypeConfigured: false, values: {} }` before worker reads.

The existing suite verifies both configured ID types, missing IDs, duplicate
IDs, inactive assigned workers, empty populations, no configured type,
missing sheets, and all three access gates. No caching was added, so there
is no new stale-setting or cross-user cache behavior. There were no changes
to directory pagination, background jobs, counters, assignment behavior,
or the server's full-population response contract.

The application started successfully in preview. The signed-in sheet UI
was not browser-verified; the consumer findings are source-based and the
route verification used mocked storage, not a production roster.

## Separate findings, not changed here

Overview uses `["/api/edls/sheets", sheet.id, "available-workers"]`, while
Assignments uses the same prefix with a trailing `"all"` for its unfiltered
view. These produce the same URL under different query keys. This is a
separate available-workers download issue, not a display-ID request;
consolidating it should preserve rating filters and assignment invalidation.

The unused display-ID endpoint remains available. Any decision to retire it
should first check non-browser integrations and compatibility requirements,
rather than removing an authorized API as an incidental performance change.
