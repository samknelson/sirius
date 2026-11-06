# Screen-only Mask Mode

## Current contract

The approved screen-only contract supersedes the previous strict training
view. Historical audits under `docs/tasks/808-mask-mode-implementation.md`
describe retired behavior, not current guarantees.

Mask Mode is an optional, disabled-by-default component. An active original
administrator controls the preference for their login, including while
masquerading. Ordinary authorization still uses the effective actor. The
cookie-bound session stores only mode and a revision; there are no aliases,
generated identities, changed person records or per-person masking requests.

The normal application remains available. HTTP handlers, downloads,
communications, mutations and authenticated WebSocket deliveries do not
consult the display preference. WebSocket expiry/actor checks and normal
HTTP authentication remain in place. Revision CAS protects concurrent
preference changes, not response delivery. Ordinary session saves preserve
the authoritative preference and cannot resurrect a deleted session.

Legacy unknown, masked and revoked sessions can use the application.
Unknown preferences display OFF and an administrator can toggle them using
revision zero. Obsolete `/mask-mode` and script URLs redirect to `/`.
The removed sample API returns 410. Component transitions reset existing ON
preferences to OFF transactionally, without ending authentication. The
Components screen warns before disabling; enable does not restore ON.

## Display inventory and integration

`scripts/build/personal-displays.ts` is the semantic JSX inventory used by
the same Vite pre-transform in development and production. It examines
source identifiers, not record contents or rendered DOM text. Recognized
personal text slots receive reactive `PersonalValue` components. Tooltips,
accessible identity labels and title props receive a reactive
`PersonalSurface`. Known form controls receive a personal-field annotation.
Ambiguous generic `name` and `value` require a known person source or a
surface-specific declaration. Organization/configuration display names are
not people. New ambiguous displays should use explicit `PersonalText` or
`data-personal`, not extend content matching.

Formatting occurs after the normal display formatter. Conditional branches
and template interpolations are formatted separately, retaining action
labels, relationship/gender labels, organization names and other prose.
Nothing rewrites API records, React Query caches, IDs, URLs, event handlers,
sort keys, filter predicates or mutation payloads. No HTML/body sanitization
or content scanning is part of Mask Mode.

The implementation inventory covers:

| Area | Structured fields / integration |
| --- | --- |
| Worker table and Summary | Names, worker IDs, email, phone, SSN, DOB, postal fields, contact hover cards |
| Worker layouts and identities | Page/browser title, header user and original masquerader, quick masquerade, worker headings |
| Worker management tabs | Name parts, SSN and external IDs, email, phone, postal fields, DOB; canonical edit state remains separate |
| Relations and benefits | Worker relation labels, selected-worker labels, eligibility subscriber/dependent headings |
| Enrollment / beneficiaries | Dependent names, DOB and already-partially-masked SSNs; beneficiary form name controls; review labels |
| Employer/provider contacts | Lists, profiles, contact headers, names, emails, phones, postal fields; organization names remain ordinary |
| Search / pickers | Worker quick-search results, worker/user/contact options and selected labels, staff recipient selections |
| Other person-bearing screens | Dispatch/EDLS workers and staff, stewards, event rosters, duplicate-SSN reports, user administration, active sessions, structured note-author identity, worker bookmarks and worker account headings |
| Communications | Structured recipients / postal fields, separate from unchanged message subjects, bodies and previews |
| COBRA cases | Covered Person and Subscriber names in lists and People fields; person-bearing case heading and browser title; missing-name and case-ID fallbacks remain ordinary |
| BAO cases (shared lists and details) | Worker entity names and repeated worker headings only; employer/provider organization names, case types, statuses, narratives, notes, documents and letters remain unchanged |
| Ledger account Participants and Transactions | Worker entity names in rows and the shared transaction detail dialog; organizations, missing-name placeholders, transaction memos, balances, filters, sort keys and CSV originals remain unchanged |
| Generic hosts | Personal input overlays and native controls; avatar fallback initials (not photographs) |

Focused source-inventory tests assert representative real call sites and
exclude message bodies, notes, template content, filenames, benefits,
organization/configuration names and non-DOB dates. Browser fixtures run the
same compiler and real shared controls; they are not a substitute for
authenticated live-data UI verification.

## Field rules

* Names: retain the first character of each whitespace-separated part and
  mask subsequent letters/numbers; retain punctuation and whitespace.
* Email: retain the first local-part character and full domain.
* Phone, SSN, personal identifiers and addresses: retain the first character
  and separators, masking subsequent letters/numbers. Valid phone/SSN values
  therefore retain their first digit.
* DOB: retain the normally formatted date, replacing all digits after the
  first digit. Month text and separators retain their normal formatting.
* Empty values and explicit no-data labels stay unchanged. Unicode code
  points are handled deterministically; malformed values never fall back to
  the complete original value.

Input overlays never enter canonical form state. Focus, selection, editing,
validation, save/cancel and toggling work on the real HTML value. Controlled
and uncontrolled input nodes remain mounted across toggles. Selection/copy
continues to use originals. Native date validity is retained; the calendar
popup is hidden while ON and keyboard date editing remains possible.

The session preference survives refresh/navigation. Broadcasts invalidate
other tabs, which reread their own login; focus/pageshow and a periodic
refresh cover missed broadcasts. Loading initially checks the preference
before the application paints. Errors show an honest warning and retry
control, never the obsolete restricted application. The last confirmed
preference is retained on a refresh error.

## Explicit exclusions

This is not de-identification, egress protection, comprehensive identity
concealment, HIPAA certification, Safe Harbor or Expert Determination.

Real data remains in responses, developer tools, memory, caches and storage.
Clipboard originals, downloaded/exported originals, printing, public links
and external sites are unchanged. Notes, documents/files, photographs,
message bodies, templates and their previews remain exactly as before,
even when they identify people. No extra reveal step is introduced.

## Verification

* `npx vitest run tests/privacy tests/auth tests/help`
* `npm run test:browser:mask-mode` — fictional HTTP/WebSocket data; actual
  NameManagement edits, structured displays, exclusions, tab/reload sync,
  component transitions, errors and real built-in-help listing/dialog.
  Real COBRA and BAO case pages, account Participants/Transactions and their
  shared hosts run against fictional data for ON/OFF/disabled restoration,
  computed titles, generic detail fields, mixed entity types, missing names,
  unchanged notes/memos, raw-name sorting, filters, pagination and CSV integrity.
  Only tab-access chrome is stubbed in this isolated case/ledger fixture;
  it does not verify application authorization.
* `node --import tsx tests/privacy/component-storage.mts` — temporary shadow
  tables inside an intentionally rolled-back transaction; no public data
  or schema changes.
* Production bundles must be built without `npm run build` here because that
  script also runs `db:push`. Use Vite and esbuild directly with an ignored
  output directory. A `BRINGUP_REPORT_ONLY=1` production boot checks bundle
  imports/read-only bring-up, not normal production readiness.

The actual signed-in worker, enrollment, employer/provider, communications
and component screens have not been exercised with a live authorized login.
The ordinary signed-out login was inspected in the running application's
preview; authenticated behavior uses fictional component/route fixtures. No production
configuration, schema, sends, payments, exports or stored people are changed
by the fictional browser tests.
