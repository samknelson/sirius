# Checkout initiation safety

## Failure boundary

An explicitly empty Gateway Payment Types list enables **no** methods.
Absent configuration uses the provider's declared defaults. Checkout intersects
that list with account settings and the provider catalog at preview, submission,
and the authoritative locked submission recheck.

Provider preflight runs before an attempt is inserted. Providers may throw
`PaymentInitiationRejected` only for proven pre-call rejection. HTTP status,
exception text, or a missing provider reference never establishes non-creation.

Every create/replay/recovery call uses the attempt ID as its provider idempotency
identity. New attempts explicitly record that creation has not started, allowing
initial submission, replay, or recovery to claim the first invocation without
guessing about historical rows. The initiation service commits a provider-entry fence before calling
the provider, then holds the attempt lifecycle lock across creation and response
persistence. A fresh first invocation can record a proven rejection as `failed`
with a processed `payment.initiation_rejected` audit event. No ledger payment or
credit is created by that transition. Recovery excludes failed attempts and a
new checkout must use a new application idempotency key.

After uncertain creation (including process death after provider entry), current
configuration rejection is not evidence about the original call. The reservation
stays until retrieval, same-identity recovery, or provider-confirmed cancellation
establishes the actual outcome. Processing ACH is not time-expired.

## Reported employer account: investigation boundary

The requested scope is EA `f08e4a5f-45f4-4e8d-ac00-4813c25812ab`.
Development runtime logs identify `helium/heliumdb`, not production.
The deployment metadata available in this fork reports no Replit-hosted
deployment. The repository documents separately deployed environments on
deployment branches; no verified production database connection or authenticated
production account access was established here. The supplied URL paths alone
do not identify a database/deployment environment.

**No production account state or actual 150-dollar attempt has been verified;
no historical attempt, ledger balance, or charge was modified.** Fixture
reproductions are not evidence that this account's attempt was rejected.

When verified read-only production access is available:

1. Confirm the deployment and database identity independently. Do not substitute
   the development database or Replit's managed replica for an external database.
2. Restrict reads to this EA. Inspect its attempts' amount, creation/status
   history, gateway ID, immutable checkout selection, provider reference, linked
   ledger payment, event receipts, and recovery history. Do not collect card
   data, consent/payer personal data, credentials, or client secrets into reports.
3. Establish whether the reported 150-dollar initiation was rejected before
   provider creation. Current empty configuration or missing reference alone is
   insufficient; a later recovery may have created a payment.
4. If there is a provider reference, retrieve authoritative provider state.
   Cancel only if that provider permits cancellation and confirms it; apply
   the existing normalized evidence transition under the attempt and EA locks.
5. Without a reference, require affirmative evidence ruling out original and
   recovery creation before approving an audited rejection transition. If that
   evidence is missing, keep the reservation and report the unresolved attempt.
   Do not replay a historical create as a diagnostic operation: it can initiate
   a previously nonexistent payment after configuration changes.
6. Re-read scoped balances and unrelated reservations. Do not remove the later
   237-dollar charge or release any other attempt.

## Verification limits

Route, storage, provider-contract, lifecycle-serialization, rendered React,
and Chromium tests exercise the failure mechanism and protected outcomes with
fixtures. They do not charge a provider, contact Stripe, or verify this
production employer. Real-provider confirmation remains separate from these
tests. The application screenshot is unsigned-in; authenticated UI checks use
the fixture browser with production page components and no auth bypass.
