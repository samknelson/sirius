# Legal upload preview and completion

Monthly and corrections uploads use **Upload → Map → Benefits → Validate →
Preview → Process → Confirmation and Payment → Review**. Preview is a live, read-only estimate, not a
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

## New-worker addresses

Both monthly and corrections uploads require **Address 1, City, State and
Postal/ZIP Code** for rows that would create a new worker. Map these four columns
when adding workers; Address 2 remains optional. Whitespace-only cells count as
missing. A row that resolves to an existing worker through either SSN or an
Alternate Tax ID can still omit an address, including in create/upsert mode.
Validation identifies the missing fields by row. Preview, processing readiness
and the creation boundary enforce the same requirement, including saved uploads
with older validation results. Other wizard types are unchanged.

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

## Confirmation and payment

For new monthly and corrections runs, processing opens **Confirmation and
Payment**. Review remains available for detailed row results. Processing is
complete independently of payment information; saving or submitting a
remittance never reruns processing or emits another completion notification.

The persisted completion projection includes actual worker creation observations,
successful row membership, pre-import contact differences, benefit populations
for the mapped benefits' three-month-offset period, and posted charge groups.
SSNs and Alternate Tax IDs use the importer's shared resolver and conflict
rules. Different identifiers resolving to one worker count once. Unmatched
identifiers do not count as new workers unless creation actually occurred.
Failed/unresolved identities are separate from confirmed workers without
benefits. These measurements never contain raw tax identifiers or contact values.
Contact differences describe meaningful submitted differences, not a guarantee
that a worker-reported primary address was replaced. Known contact failures and
differences on unconfirmed workers are reported separately.

Charges are grouped by employer ledger account and currency, including the net
change when an existing keyed charge was reconciled. Confirmation reads live
authoritative account balances and links to each account's invoice summary.
Missing historical measurements or failed reads are unavailable, not zero.
Multiple currencies are never combined into one amount. No account, grant,
charge or invoice is created by reading confirmation.

Employers may save incomplete check/wire details as wizard form state. Only a
positive valid amount plus an explicitly selected configured financial payment
type creates a real ledger receipt. Under **Payment Types**, staff must set
**Legal remittance method** to Check or Wire on each eligible financial type.
Type names are not used to guess this setting. The type must match the charged
account's currency. Reference, payer, timing, planned/sent date, bank/account
nickname and notes are optional; never enter full banking numbers or credentials.
Receipt and clearance dates remain unknown until staff record them.

The receipt status is **Employer submitted — awaiting review**
(`employer_submitted`). Pending receipts do not reduce balances or satisfy paid
invoice logic. The projection shows the effect only after receipt/clearance,
including older debt, underpayment, full payment and credits/overpayment.
Each account is funded independently; no automatic allocation across accounts.

The dispatcher locks the upload through submission and form-state persistence.
The unique `(upload_wizard_id, ledger_ea_id)` constraint makes the receipt identity
stable across retries. Employers edit the same pending receipt; staff-cleared,
canceled or staff-draft receipts cannot be overwritten from the upload.
Upload-linked receipts are canceled rather than deleted to preserve that identity.

Staff use **Ledger → Employer Payment Review**, a server-paginated pending queue,
then the existing payment view/edit flow to verify, edit, clear or cancel the
original receipt. Clearance reconciliation is serialized on that receipt.
The saving route awaits charge reconciliation once; its after-commit saved
event is marked as already handled so the charge listener cannot run billing
a second time. Legacy event-only payment saves still run through that listener.
Generic payment writes and review endpoints remain staff-only; wizard submission
also requires the Legal and Ledger components, completed results, the owning
employer, the charged account's access policy, and valid method/currency.

### Schema rollout

The schema source adds `ledger_payments.upload_wizard_id` and the named unique
constraint. Apply this additive shape in development and carry it to managed
production through Publish. Registered migration `legal_payment_upload_link`
only verifies the published shape; it deliberately performs no production
startup DDL. Existing receipt rows keep a null link. Historical completed uploads
remain viewable without invented population measurements, retroactive payment
requirements, reprocessing or notification replay.
