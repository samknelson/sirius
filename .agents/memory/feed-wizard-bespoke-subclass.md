---
name: Bespoke feed wizard subclass
description: What a feed-import wizard that is not "create/update workers by SSN" has to supply itself, and the traps around mapping orientation and audit attribution.
---

The `FeedWizard` base gives you file parsing, the column-mapping plumbing and
the shared upload/map/validate/process/results step builders. Its
`validateFeedData` / `processFeedData` pair, however, is specific to creating
and updating workers by SSN. Any other import overrides BOTH.

**Rule: one resolution routine, two passes.** The override pair must call the
same row-resolution function — validation is that function run read-only.
Anything validation reports and processing then decides differently is a lie
told to the user before they press Process.

**Why:** validation that is allowed to disagree with processing turns "3 rows
will be skipped" into a number nobody can trust, and the two copies drift the
first time a resolution rule changes.

**How to apply:** resolve every row up front into `{issues[], ...resolved}`,
then let validate count/report and process act. Cross-row rules (e.g. the same
key named twice) are decided in that one routine as well, so processing order
cannot change the outcome.

## Traps

- **Mapping orientation flips between client and server.** The server's
  `normalizeColumnMapping` normalizes to `{col_N: fieldId}`; the client's
  FeedMap normalizes to the flipped `{fieldId: colKey}`. A subclass parsing the
  mapping itself must iterate the SERVER orientation, and should reuse the
  exported helpers (`filterEmptyColumns`, `normalizeColumnMapping`,
  `validateMappingDuplicates`) rather than re-deriving them.
- **Non-blocking validation is a step-builder decision, not an engine one.**
  `buildValidateStep(feed, { isComplete })` is what decides whether bad rows
  stop the wizard; the engine just reports.
- **Audit attribution rides the request-context ALS.** The dispatcher spawns a
  run step's work inside the request scope, so per-row storage writes are
  logged against the running user for free. The same engine driven from a
  script or a cron logs those rows with no user at all — wrap the call in
  `requestContext.run({ userId, userEmail }, ...)` when you want a script's
  writes attributed.
- **A mapped-but-blank cell is not automatically an error.** Mark such a field
  `required: true` so the map step still forces a column onto it, and let the
  subclass's own validation give the blank cell its meaning; the base
  `validateRow` would reject it.
