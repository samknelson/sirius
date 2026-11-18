# Separate postal address lines

## Compatibility and import transition

`street` remains line 1. `street2` is nullable; whitespace-only values become
null at storage. No migration rewrites existing street text. Line 2 participates
in address identity and is immutable, just like line 1.

The S1 worker and employer loaders compare the two source lines separately.
Both loader logic versions advance, so an unchanged source fingerprint from
before this change re-enters reconciliation once rather than skipping it.
Previously flattened, import-owned addresses cease matching: the loader
deactivates them through logged address storage, then creates/matches the new
structured address. Other sources are not deactivated. Subsequent identical
loads match the structured active row without repeating that transition.
Existing primary-address protections remain in force.

BTU, HTA and GBHET entry paths now use separate lines. Their update paths use
create-or-match instead of attempting an immutable-field update. They retain
prior addresses; ordinary import/feed priority rules determine whether a new
address becomes primary. These are not bulk historical cleanup operations.

## Verification performed

- 20 focused tests passed: schema blanks/legacy omission, distinct unit identity,
  immutable unit edits, unit-preserving postal verification, help matching and
  sanitization, worker export behavior, and identical import replay after a unit change.
- 20 EDI conformance/casing cases passed across the registered feeds with a
  nonempty second line. Existing widths and order remain unchanged.
- Ten additional regression cases passed: Google parsing of unpunctuated
  input, explicit second lines and building-only answers, plus both S1 loaders'
  unchanged-fingerprint transition. The latter executes the actual classifier
  and address reconciliation blocks with in-memory storage, proving one
  deactivate/create transition followed by a skipped replay.
  Separately delimited city/state/ZIP inputs are covered both locally and
  against building-only Google answers, with and without a genuine unit.
- The complete conformance file reported seven pre-existing missing authoritative
  layout fixtures (the independent inventory assertions); no fixture was invented
  from implementation code to hide those failures.
- A disposable PostgreSQL temporary table exercised the migration twice,
  preserved historical combined text verbatim, and accepted a two-line insert
  after clearing the temporary rows. No real contact was changed by this check.
- An isolated browser fixture entered fictional lines, reviewed both, and
  submitted both through the actual shared form. It used mocked configuration
  and geocoding responses; no vendor calls or authenticated record writes.
- Vite and production server bundles built without running schema push.
- The application restarted and reached fully initialized/ready; its sign-in
  screen rendered. Authenticated address screens and Help dialogs were not
  verified against a real signed-in session.

Built-in help `system:postal-address-lines` covers worker, employer-contact,
provider-contact, facility, and user-contact address tabs. EDI guidance explains
the existing-slot behavior and historical-address limitation. Matching and
sanitized HTML were tested; local database help was not changed.

## Verification boundaries

No live carrier transmission, paid revalidation, production import replay, or
full fresh-database bootstrap was performed. Import replay was exercised with
the actual reconciliation code and in-memory storage, not against a copy of
production S1 staging.
