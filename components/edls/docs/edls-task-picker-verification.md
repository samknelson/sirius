# EDLS task picker verification

## Reproduction and scope

The original reporter's authenticated browser session was not available.
Verification used the real `EdlsSheetForm`, shared Select/Dialog components,
query client, and compiled application CSS in Chromium. Only authentication
context and HTTP responses were fixtures; no application authentication bypass
or persistent test data was added.

With the original code and a fresh response containing 40 tasks in Department A
and one in Department B:

- Create and Edit each rendered None plus the same 40 department-filtered tasks.
- Create's viewport was 648px tall with 1320px of scrollable content.
- A wheel movement changed Create's scrollTop from 0 to 360.
- Edit's wheel movement changed scrollTop from 62 to 422.

This did **not** reproduce a portal or viewport-sizing defect.

A separate failure was reproducible: prime the original
`["/api/edls/tasks/options"]` query with an empty successful result, then
invalidate `["/api/edls/tasks"]`, as task configuration mutations do. Open
Create and choose Department A. Only None appeared and no options request
was made, despite the fixture endpoint now offering tasks. Array query-key
matching does not treat a URL string as a path prefix, and the application
default stale time is infinite.

This establishes a stale-cache failure, not definitive attribution of the
original user's report.

## Correction

The form and task hook now use `["/api/edls/tasks", "options"]`, which the
existing query serializer resolves to the unchanged endpoint. Existing
configuration mutations now invalidate this child query. A zero stale time
also refreshes tasks when a form mounts again, including after changes in
another session. No shared Select, department filtering, server permission,
eligibility, or protection behavior changed.

The form distinguishes loading, refreshing, request failure with retry, and
successful empty department results. Existing selections are not cleared by
request failures.

## Results

One-off Chromium checks passed for:

- Fresh and warmed empty caches; the latter now fetched once and displayed tasks.
- Active options refresh following task configuration's query invalidation.
- Mouse selection, keyboard End/Enter selection, None, and wheel scrolling
  inside the create dialog.
- Form submission carrying the selected `taskId`, followed by seeding Edit
  from that submitted data and retaining the selection.
- Edit offering the same department's tasks and scrolling normally.
- Department B offering only its own task; a department without tasks offering
  only None with an explicit empty-state message.
- A delayed response disabling the task control and displaying loading.
- A failed response displaying an error rather than empty state, followed by
  successful recovery through Retry tasks.

Existing checks: 54 tests passed across
`tests/edls/sheet-write-routes.test.ts` and
`tests/edls/sheets-storage-writes.test.ts`.
`git diff --check` passed. The configured completion checks run separately.
No permanent page-rendering test suite was added.

The application was restarted and logged successful initialization. The
unauthenticated preview rendered the sign-in page. **A live authenticated
database create/reopen was not verified**; the round-trip above verifies the
real form's submitted and restored state, not database persistence.

Disposable browser screenshots/bundles from verification were retained at
`/tmp/sirius-edls-picker-yI5p25` and original-code reproduction at
`/tmp/sirius-edls-picker-miNSOp`. These locations are temporary, not archives.
