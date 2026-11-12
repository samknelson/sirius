# Legal upload preview and completion

Monthly and corrections uploads use **Upload → Map → Benefits → Validate →
Preview → Process → Review**. Preview is a live, read-only estimate, not a
quote or a reservation. It normalizes worker identity, deduplicates
worker/benefit/period grants, skips existing grants, and uses Legal billing's
account-scoped employer/global override resolution, effective rates and billing
offsets. Missing configuration, accounts or effective rates are reported as
unavailable pricing, not known zero charges. A configured zero rate is known.
An existing keyed charge is reconciled rather than counted as a new charge.

The approval fingerprint binds the uploaded file, mapping, headers, mode,
benefit choices, employer, reporting period, effective configurations and live
worker/grant resolution. The server checks it before acknowledging processing
and again at execution. Upstream edits clear approval. Completed historical
imports can be read without inventing an estimate or uploader.

## Background work

Leaving the page does not cancel an already started server run. Reopen the same
upload for persisted progress and results. This is **not** a durable queue:
application restarts can interrupt processing. No restart recovery or guaranteed
notification delivery is promised.

## Completion event

`sitespecific.gbhet.legal.upload.complete.after`
(`EventType.GBHET_LEGAL_UPLOAD_COMPLETED_AFTER`) is emitted by the Legal Process
step's post-persistence hook. It runs after all awaited WMB charge work,
processing results/actual totals, terminal wizard status, and terminal step
progress are saved and committed. The event bus is best effort. Notification
failures are logged independently and cannot turn saved success into a failed
upload. Reads and historical records do not emit.

Payload:

- `uploadId`, `uploadType`, `employerId`
- `submitter`: trusted effective `userId` and resolved `contactId` captured at
  file submission, or null for older drafts. Later viewers/runners are not the
  submitter.
- `period`: reporting `year` and `month`
- `outcome`: `completed`, `completed_with_errors`, or `failed`
- `totals`: actual distinct new workers, workers receiving new grants, new
  grants, processed/failed rows, posted charge count/amount, charge failures,
  charge-read failure, and unavailable prospective pricing count. An unavailable
  charge total is null, never a fabricated zero.
- `invoices`: all verified account/month destinations from this run's actually
  posted WMB charge references, grouped using statement dates. A destination is
  included only if the existing invoice reader can load it.
- `resultsPath`: the authenticated upload results location

There are no raw uploaded rows, SSNs or delivery destinations in this payload.
Invoice URLs remain authenticated and retain existing ledger permissions.
Invoices are account/month views, not newly generated records.

## Configuration and delivery

Administrators add/enable **Legal Upload Completion** under the existing
event-notifier settings. Select email, SMS and/or in-app channels, employer
contact types, and optionally edit channel templates in Template Studio.
Nothing sends without an enabled configuration.

Recipients are the captured uploader's contact plus selected contact types from
this employer only, deduplicated by contact. No types selected means uploader
only. Self-notification is enabled. Missing contacts, user accounts, email/phone
destinations and consent follow the normal communication rules.

The `wizards` template root exposes only the documented completion projection.
Its summary labels partial failures, reports posted amounts, and avoids an
“invoice ready” claim for unavailable/failed/zero charge creation.
`wizards.invoice_links` renders safe HTML links to **all** available invoices;
`wizards.field(name="invoice_urls")` supplies their absolute text URLs.
`results_url` is absolute for external media and `results_path` is relative for
in-app navigation. When no invoice is available, defaults point to results.
Sample success/error contexts and an admin-gated saved-completion context are
available in the template editor.

Every delivery uses `gbhet-legal-upload-completion:<uploadId>` as its send key,
independent of notifier configuration and selector. The existing comm insert
claim enforces at-most-once per upload/contact/channel, including overlapping
configurations and repeated events. A failed send consumes its key, as normal;
this does not introduce retries or guaranteed delivery.
