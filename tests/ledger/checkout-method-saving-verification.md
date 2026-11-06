# Checkout method saving verification

## Confirmed defects

- Checkout and management used different method-list cache keys. The global
  infinite stale time could preserve an earlier empty management list.
- Stripe's customer prerequisite ran before opted-in checkout created its
  customer, both at preflight and at the locked configuration recheck.
  The ordinary checkout regression now exercises the real Stripe preflight,
  rather than a permissive provider mock, for card and ACH.

## Checks

- `checkout-method-persistence.test.ts` starts a disposable PostgreSQL cluster.
  It exercises ordinary session creation, the production Stripe normalizer,
  actual method/customer/attempt storage, authorized list responses, replay,
  scheduled recovery, and later saved-method checkout and settlement.
  Provider answers are controlled Stripe-shaped fixtures, not Stripe API calls.
  The payment poster is a controlled database writer; production settlement
  owns the attempt lock and ledger claim. Allocation counts use a controlled
  SQL fixture, not the full production allocation plugin.
- Card and ACH tests prove one durable method for the worker and gateway,
  safe display identifiers, and preserved original save consent on reuse.
  ACH processing does not save. A failure after upsert rolls back the save and
  completion stamp without rolling back the payment; recovery finishes it.
  Wrong provider-customer ownership, unattached/non-reusable evidence,
  cross-worker stored references, denied access, opt-out, failure, and
  cancellation do not create an owned saved method.
- Existing settlement and checkout suites cover webhook signature handling,
  duplicate events, concurrency, reconciliation, separate consent, and
  admin-test isolation. No investigation or behavior change was made to the
  separate admin-test checkout error.
- Component regressions use an infinitely fresh empty cache and verify
  management refresh for both method types and payer-scoped receipt
  invalidation without invalidating another worker's cache.
- `node tests/ledger/checkout-browser.mjs` renders the production checkout,
  receipt, and worker method-management pages with fixture layout/provider
  boundaries and intercepted HTTP. In one browser query client, it visits an
  empty methods page, completes opted-in card checkout, returns without a hard
  reload, and chooses the saved card in later checkout. ACH stays absent while
  processing and appears after simulated delayed settlement and a real browser
  tab visibility change; later checkout selects the saved bank account.
  Both reuse paths omit new save consent. The fixture does not collect real
  financial details or contact an external provider.
- `npm run check` passed.
- The wider ledger run found 14 failures in
  `checkout-credit-posting.test.ts`, `worker-payable-routes.test.ts`, and
  `ea-invoice-balance-order.test.tsx`. Running these same suites on an
  untouched HEAD worktree reproduced all 14 failures. They concern existing
  fixture gaps (linked payment reads, financial type configuration, and a
  missing layout-hook mock), not the save-method changes.

## Help

Updated the registered built-in `system:worker-payment-methods` entry at
`/workers/%/ledger/payment-methods` to describe opt-in checkout saving,
successful-settlement timing, ACH processing, independent save recovery, and
the fact that saving does not authorize later charges. Existing help tests
verify registration, intended/near-miss routes, and shared HTML sanitization.

No checkout-help change was necessary: `system:online-checkout` already
describes separate optional consent, one-off default behavior, unsuccessful
payments not saving a method, ACH waiting for success, and no authorization
for future charges or automatic payments. Receipt save-status presentation
remains out of scope.

## Verification limits

No external Stripe test-mode charge or bank-linking session was run. No live
charge, refund, historical backfill, or production-data mutation was performed.
The browser checks use the real page components with controlled HTTP and
provider fixtures, not an authenticated visit through the complete application
shell. The main preview's signed-in management and Help dialogs were not
verified. Existing provider-verification follow-up work remains applicable;
these results do not claim external Stripe confirmation.

## Integration with administrator payments

The later main-project sync introduced the separate administrator-assisted
worker-payment flow. Resolution preserves its gateway fingerprint, live/test
credential checks, administrator attestation, error handling, and prohibition
on using or saving payer methods. New-customer preflight deferral applies only
to opted-in ordinary checkout; the administrator provider path still rejects
save/customer arguments. Both administrator and historical test checkouts
leave payer method queries disabled, and their receipts do not invalidate
saved-method lists.

After combining the changes, all 327 checks across the 11 focused suites
passed (237 in the first nine suites and 90 in the two route/database suites),
along with `npm run check`. The combined browser fixture passed both the
administrator-payment error/retry flow and ordinary card/ACH saving, refresh,
and later selection.
