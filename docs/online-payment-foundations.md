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

`ledger_payment_attempts` remains the single attempt lifecycle. Its existing
IDs, idempotency keys, provider intent references, gateway references, and
payment links remain valid. `ledger_payment_attempt_events` is the same inbox,
now unique by gateway and provider event ID. Receipt and completed processing
are separate; a duplicate receipt can still need its effects retried.

Account/entity relationships are copied from the existing EA during migration.
Historical payer identity, consent, and missing timestamps remain unknown.
Saved-method creator and date come from entity metadata, not new provenance
columns. Legacy duplicate method rows retain their IDs and tokens; only the
canonical row receives the new unique provider identity.

Attempt updates cannot rewrite the account, gateway, currency, amount, payer,
or consent snapshot. The attempt's unique payment link is the canonical
reverse lookup; there is no second checkout-session table or duplicate
payment-side lifecycle. Pending ACH attempts remain reserved and recoverable.
The existing webhook URL remains supported.

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