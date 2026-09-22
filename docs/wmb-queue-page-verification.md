# Worker queue page verification (Task 612)

## Scope and reproduction

Run `node tests/wmb/browser.mjs` with local Chromium available (or set
`CHROMIUM_PATH`). This follows the existing
`tests/postal-templates/browser.mjs` isolated Vite + Puppeteer pattern.
It renders the **production WorkerLayout, WorkerView, Current Benefits page,
AuthProvider, and query-client defaults** inside a test-only routing shell.
Vite loads neither application configuration nor environment files. Every API
response is an explicitly mocked fixture; unexpected API or external requests
fail the test. No real session, secrets, database, or provider is used.

These results demonstrate browser dependency isolation, **not production page
latency or SQL performance**. Network times below are intercepted fixture times.
The injected slow request is deliberately held until benefits have painted,
then for at least another 1.2 seconds; it is not a simulated database benchmark.

## Regression results

Local Chromium 152.0.7977.64: **3/3 scenarios passed**.

1. **Pending scan-state:** Current Benefits renders Fixture Medical while the
   scan-state request remains unresolved. No scan-state line is shown yet.
   Releasing the successful response displays the last-scan line without removing
   benefits.
2. **Failed scan-state:** HTTP 503 on scan-state does not prevent Fixture Medical
   from rendering. Benefits remain after the error response completes; no fabricated
   last-scan data is displayed. The production query defaults have retries disabled.
3. **Worker details:** the current-month benefit renders and the captured request
   list contains **no scan or queue endpoint**.

Each scenario also asserts no unhandled browser exception or unexpected network
request. Output artifacts are regenerated in `screenshots/wmb-queue-{slow,error,details}.png`
and `screenshots/wmb-queue-waterfall.json`.

The first cold harness attempt exceeded Puppeteer's default 30-second navigation
timeout during frontend startup. The harness now permits 90 seconds for initial
navigation; the successful run's cold first-page startup is reported rather than
hidden. Benefits assertions still have a separate 30-second bound.

## Representative request waterfall

All times are milliseconds relative to navigation start, rounded from the
browser Resource Timing API. “Visible” is when the assertion observes the benefit
row, not a precise paint/FCP measurement.

| Fixture scenario | Auth start–end | Worker start–end | Benefits start–end | Scan-state start–end | Benefits visible |
| --- | ---: | ---: | ---: | ---: | ---: |
| Slow, first/cold page | 32383–32387 | 32423–32426 | 32458–32461 | 32458–33705 | 32486 |
| Error, subsequent page | 339–344 | 371–375 | 387–390 | 388–390 (503) | 406 |
| Details, subsequent page | 277–281 | 308–315 | 339–348 | No request | 382 |

The cold page spends roughly 32 seconds **before authentication starts**, during
test frontend startup/module loading; this is not queue time. Once the worker
loads, Current Benefits and scan-state begin together (same millisecond in the
slow case). Benefits are observed 1,219 ms before scan-state finishes.

Worker details starts addresses, phone numbers, IDs, benefits, option lists,
current employment, and contact requests together around 338–342 ms. This is
separate from the queue path.

## Code findings and limitations

- `client/src/pages/worker-benefits-current.tsx` has independent benefit and
  scan-state queries. Its content loading branch uses only the benefits query's
  `isLoading`. Scan state only adds optional header text.
- `client/src/pages/worker-view.tsx` requests the worker's benefits collection and
  filters it to the current month locally; it does not request scan-state.
- `client/src/components/layouts/WorkerLayout.tsx` gates content on worker/tab
  loading, not queue loading. Component-specific auxiliary requests can differ
  by installed components and access rights.
- `server/routes.ts` exposes current benefits and scan-state as separate routes.
  Browser independence does not exclude shared backend resource contention.
- No production UI changes were needed to establish loading/error isolation.
  This test does not claim to cover queued-state polling, authorization enforcement,
  slow benefits themselves, or real signed-in production navigation. Database
  performance and query-plan measurements are separate evidence.