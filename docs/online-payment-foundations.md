# Online payment foundations

Online checkout is opt-in per ledger account. The account's `data.onlinePayments`
object is validated by `shared/ledger/online-payments.ts`.

## Account settings

- `enabled` defaults to `false`. An account is never payable merely because it
  has a gateway.
- `payerTypes` accepts only `worker` and `employer`.
- `allowPartial` defaults to `true`.
- `minAmount` defaults to `1` and must be a positive amount with no more than
  two decimal places.
- `paymentTypes`, when present, accepts only the initial financial methods
  `card` and `us_bank_account`. Omitting it lets checkout narrow the gateway's
  configured types to that same supported set.

The API validates this block on account create, update, and data-only patch.
Existing accounts without the block remain disabled.

## Ledger payment type mapping

Successful online charges use stable option ids rather than mutable names:

| Provider method | Ledger payment type id | Display name |
| --- | --- | --- |
| `card` | `online-card` | Online - Card |
| `us_bank_account` | `online-bank-ach` | Online - Bank (ACH) |

The schema migration that introduces online payment records owns seeding these
two financial option rows.

## Authorization text

Current authorization copy is stored in the existing `variables` framework
under `ledger.online_payment_authorizations`. Its value must contain both:

```json
{
  "consumer": { "version": "configured-version", "text": "Configured text" },
  "business": { "version": "configured-version", "text": "Configured text" }
}
```

No authorization wording or version is supplied as a code fallback. Checkout
must refuse flows requiring consent when the applicable configured text is
missing. A recorded consent must retain the rendered text and version accepted
at that time; changing this variable only affects future checkouts.

## History protection

Ledger history prevents deletion of its entity account. The EA delete endpoint
returns HTTP 409 with a readable explanation when a foreign-key restriction
blocks deletion.

## Durable records and compatibility

The ledger payment owns checkout from initiation onward. Checkout state is
separate from accounting status: a draft has no received date or postings;
processing becomes pending, and successful settlement clears and posts the
same payment. The checkout session ID and payment ID are the same.

Private checkout columns enforce unique client keys, gateway-scoped provider
references and restrictive references. The bounded, versioned lifecycle
snapshot stores consent, immutable allocation evidence and separately retryable
method saving. Generic payment responses omit the private columns.

Verified webhooks reconcile provider state directly. Unknown payments receive
503 so the provider retries; no payment is manufactured. A successful response
is sent only after internal effects finish. Scheduled bounded scans retry
incomplete payments and method saving, fairly rotating both successful polls
and failures. Missing provider references are recovered using the original key.
The existing webhook and receipt URL formats remain supported.

### Pre-release destructive cutover

The owner confirmed that this product has not shipped and expressly authorized
discarding old attempt-based development payments, their related postings and
event evidence without an archive. Migration 1222 performs that cleanup in one
transaction, refuses inconsistent payment links, and drops both former tables.
Unrelated manual/imported payments are retained. An exclusive table lock waits
for existing settlement transactions; old binaries then fail on the removed
tables rather than independently settling. Stop all old application processes
before starting the cutover version. Do not use a rolling deployment.

This is not a preservation migration for live financial data. Deleted test
payments and their URLs cannot be restored by reverting code; restoration
requires an independently retained pre-cutover database backup. No backup is
created by this migration, as expressly authorized. Never run this cleanup on
future live payments.

## Staged activation

1. Deploy the registered migration and provider contracts first. Keep new
   account checkout settings disabled. Do not delete or replace gateway configs
   referenced by pending attempts.
2. Configure approved, versioned consumer and business authorization text.
   Verify gateway credentials, signing secret, enabled method types, financial
   payment-type mapping, and required components. Initial online mappings are
   USD card and ACH only.
3. The downstream authorization/checkout work must enforce login, worker
   ownership or explicit employer-contact grants, and refusal of staff-assisted
   checkout under the effective actor, including masquerade. A configured account alone does not grant access.
4. That checkout must validate current balances and selections server-side,
   enforce the account minimum/partial policy, and leave saving unchecked.
   New and saved methods use the same durable attempt record.
5. Exercise dummy outcomes and Stripe test mode before enabling any account.
   This foundation does not authorize live charges, add checkout UI, or enable
   notifications, refunds, disputes, or recurring payments.

## Employer checkout rollout

Employer checkout is now wired to the same account checkout and receipt as
worker payments. Keep each ledger account's online payment setting disabled
until its gateway, financial payment types, and business authorization text
have been checked. Enable `employer` in the account's payer types only on
accounts intended to accept employer payments. Account restrictions (including
ACH-only, minimum amount and full-balance requirements) are enforced by the
server at session creation, not just by the form. Invoice links carry only an
invoice number; checkout obtains its balance from the current server response.

Staff grant `Pay employer balances` and `Manage saved payment methods`
independently on each employer-contact relationship's user administration
page. Billing contact type alone grants neither capability. A contact with
only pay authority may make a one-time payment or use an existing saved
method but cannot save or manage methods. Normal staff cannot check out;
masquerade uses the effective user's ownership and grants, not the staff user's
privileges. Revocation is checked on every payment request.

Before live activation, rehearse successful and failed dummy gateway outcomes
for worker and employer accounts, ACH processing/settlement and receipt
refreshes, plus staff manual payment allocation. Then verify card and bank
flows against **real Stripe test mode** (tracked separately), including
webhook delivery and delayed ACH outcomes. The dummy gateway checks do not
prove Stripe behavior; do not treat them as permission to enable live charging.

The existing worker test checkout remains a compatibility path during this
staged rollout; the new account settings are a contract for its authorized
replacement, not a silent change to historical worker access rules.