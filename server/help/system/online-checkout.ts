import type { SystemHelpEntry } from "./index";

export const workerPaymentChooserHelp: SystemHelpEntry = {
  id: "system:worker-online-payment-accounts",
  paths: ["/workers/%/ledger/pay"],
  summary: "Choose an enabled account to pay, compare posted and available balances, and check your unfinished payments before starting another checkout.",
  details: `
    <h3>Purpose</h3>
    <p>Use <strong>Choose an account to pay</strong> to find accounts available for online payment and review money already reserved by unfinished payments.</p>
    <h3>Before you start</h3>
    <p>You must be signed in and have access to this worker's accounting page. Paying requires separate payment permission for your own linked worker record. Staff cannot perform online payment actions, even when they can view accounting records. Only accounts enabled and configured for this payer are listed.</p>
    <p><strong>Do not start another payment while an earlier outcome is unknown.</strong> A failed page load or status request does not prove that a payment failed.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Compare <strong>Posted balance</strong>, <strong>Pending</strong>, and <strong>Available to pay</strong> for the intended account.</li>
      <li>If <strong>Your unfinished payments</strong> appears, select <strong>Check status</strong> for the earlier payment before proceeding.</li>
      <li>When an amount is available and you are authorized to pay, select <strong>Pay this account</strong> to review the current total and payment method. This link does not itself complete a payment.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p>The posted balance reflects ledger entries, including credits. Pending reservations reduce the amount available to pay; they are not proof that funds have cleared. Checkout explains how account credits and pending amounts affect individual statements.</p>
    <p><strong>Awaiting payment details</strong> and <strong>Awaiting confirmation</strong> identify unfinished provider steps. <strong>Processing funds</strong> and <strong>Awaiting ledger posting</strong> are not a cleared ledger payment. Open the receipt for its current status.</p>
    <h3>Limitations and common problems</h3>
    <p><strong>Retry</strong> reloads the account list; it does not resubmit a payment. If there are no enabled accounts, or the requested account is unavailable, contact staff rather than choosing an unrelated account. No available amount can mean credits or pending payments already cover the balance. Unfinished payments shown here belong to you; other reservations can still reduce the available amount.</p>
  `,
};

export const onlineCheckoutHelp: SystemHelpEntry = {
  id: "system:online-payment-checkout",
  // EA IDs are generated UUIDs (shared/schema.ts: ledgerEa). A bare /pay/%
  // ALSO matches /pay/receipt/<id>, since % spans slashes. Partition by the
  // UUID's first hex character so receipt pages never get checkout procedures.
  // These are LIKE patterns, not single-segment validation; see matcher tests.
  paths: [..."0123456789abcdef"].map(first => `/pay/${first}%`),
  summary: "Review the available balance, statement credits, payment method, and authorization before continuing to secure provider confirmation for this account.",
  details: `
    <h3>Purpose</h3>
    <p>Use <strong>Make a payment</strong> to review an account's current payable amount and continue to the payment provider's secure confirmation step.</p>
    <h3>Before you start</h3>
    <p>This is a signed-in checkout, not an anonymous payment link. You need payment authority for the named payer and account. Workers can pay only for their own linked worker record with worker payment permission. Employer payers need an active payment grant. Staff cannot perform online payment actions. Seeing an account or managing a saved method does not grant authority to pay.</p>
    <p>The account must have online payments, a compatible gateway and payment type, and current authorization wording configured. If these are unavailable, ask staff or support to arrange a configuration review.</p>
    <p><strong>Confirming with the provider can charge the selected card or bank account.</strong> Review the account, amount, credit transfers, and authorization first. If an earlier attempt is unfinished or its outcome is uncertain, check that attempt's status before starting another payment.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Review <strong>Posted balance</strong>, <strong>Pending payments</strong>, and <strong>Available to pay</strong>. Use <strong>Check status</strong> under <strong>Your unfinished payments</strong> when an earlier attempt is listed.</li>
      <li>Choose <strong>Pay full balance</strong>, or <strong>Pay selected statements</strong> when offered. Statement selection pays the currently unreserved debt on each selected statement, not an arbitrary amount. Full balance also includes account debt not tied to a statement.</li>
      <li>Review <strong>Payment total</strong> and any <strong>Account-credit transfers</strong>. Credits are applied oldest-statement-first and can reduce the cash due. The listed transfers are applied with the successful payment, not merely by viewing this quote.</li>
      <li>Choose an offered saved method, <strong>New credit/debit card</strong>, or <strong>New US bank transfer</strong>. A saved method must be active, available at the provider, belong to this account's gateway, and have an accepted type.</li>
      <li>Read and accept the current authorization, then select <strong>Review payment</strong>. Review the amount and method; use <strong>Edit</strong> if they are incorrect.</li>
      <li>Select <strong>Continue to secure confirmation</strong> only when ready. In <strong>Secure payment confirmation</strong>, enter details or complete verification directly with the provider and confirm there.</li>
      <li>Review the receipt after confirmation, or use <strong>Check this payment's status</strong>. Starting the secure step alone does not complete the payment.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p>Pending attempts reserve amounts so they are not offered again. New charges on a previously selected statement may become payable when the earlier allocation is known. An unknown pending allocation blocks checkout rather than guessing. Credits or pending payments may leave no payment currently available.</p>
    <p>For a new card or US bank account, an authorized payer may optionally select <strong>Save this payment method for future payments</strong>. Leave it unchecked to use the method only for this payment. Saving stores the method for you to choose on a later checkout; a failed or canceled payment does not add it. A US bank account is not added while a transfer is processing; the provider must confirm success first.</p>
    <p>This save consent is separate from the required authorization to charge the current payment. It does not authorize future charges or enable automatic payments. Permission to manage methods and permission to use a compatible saved method for payment are separate. A default label does not replace your checkout selection.</p>
    <h3>Limitations and common problems</h3>
    <p>If balances or authorization change, review the updated selection and accept the current wording. Follow displayed minimum, full-balance, credit-attribution, or pending-allocation messages; staff may need to review the ledger before you can continue.</p>
    <p><strong>Retry</strong> on a loading error reloads information, not a payment. If starting or confirming gives an uncertain result, check unfinished payments or the existing receipt. Do not start a replacement merely because a request failed. If secure entry is unavailable after an attempt starts, use its status link and contact support with its confirmation number. Do not send card details, bank details, or secure provider links to support.</p>
    <p>Leaving checkout does not cancel an attempt or release its reservation. Cancellation, if permitted, is offered on that attempt's receipt; processing or confirmed payments cannot be abandoned here.</p>
  `,
};

export const onlinePaymentReceiptHelp: SystemHelpEntry = {
  id: "system:online-payment-receipt",
  paths: ["/pay/receipt/%"],
  summary: "Check one payment's provider and ledger status, keep its confirmation number, and resolve uncertainty before considering another payment.",
  details: `
    <h3>Purpose</h3>
    <p>Use <strong>Payment receipt</strong> to follow an existing attempt through provider confirmation, processing, and ledger posting.</p>
    <h3>Before you start</h3>
    <p>You must be signed in as the checkout creator and still have payment authority for this payer. The receipt URL alone does not grant access. Staff cannot perform online payment actions.</p>
    <p><strong>Do not pay again while the outcome is unknown, processing, or awaiting ledger posting.</strong> A status error is not evidence of payment failure. Leaving this page does not cancel the payment.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Read the status heading, <strong>Amount</strong>, and <strong>Confirmation</strong>. When present, compare <strong>Ledger status</strong>, <strong>Received</strong>, and <strong>Cleared</strong>.</li>
      <li>Use <strong>Check status</strong> when offered. <strong>Retry</strong> after a status-loading error checks this same payment; it does not submit a replacement.</li>
      <li>If details or confirmation are still required, return to the original secure confirmation step only if it is still open. This receipt does not recreate that step. Otherwise contact support with the confirmation number.</li>
      <li>Use <strong>View account</strong>, <strong>Worker accounts</strong>, or <strong>View ledger payment</strong> when shown and permitted. A link is not a guarantee of access to the destination.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <ul>
      <li><strong>Awaiting payment details or confirmation</strong> or <strong>Awaiting payment confirmation</strong>: provider steps remain unfinished; no payment has been posted, but the attempt reserves the available balance.</li>
      <li><strong>Payment processing</strong> or <strong>Payment pending</strong>: funds are not yet cleared. Bank (ACH) payments can take several business days. The pending amount remains accounted for in the available balance.</li>
      <li><strong>Payment confirmed — awaiting ledger posting</strong>: the provider confirmed the payment, but ledger posting is not complete. Do not pay again.</li>
      <li><strong>Payment cleared</strong>: the payment is recorded as cleared in the ledger. A confirmation number or received date alone does not establish this.</li>
      <li><strong>Payment status unavailable</strong>: the outcome is uncertain. Contact support with the confirmation number; do not submit another payment.</li>
      <li><strong>Payment failed</strong>, <strong>Payment canceled</strong>, or <strong>Payment expired</strong>: review the explanation and current account balance. <strong>Try again</strong> is offered for these ended attempts, not as recovery from a failed status request.</li>
    </ul>
    <p><strong>Check status</strong> reconciles this same payment with the provider; it does not charge again. When a processing bank payment succeeds, the existing pending ledger payment is cleared with its original received date and checkout allocation. Open payment lists refresh while an online payment is pending.</p>
    <p>If you separately agreed to save the method during checkout, saving waits for confirmed success and verified ownership. A temporary save failure can be retried without charging again; a cleared payment does not by itself prove its method has been saved.</p>
    <h3>Limitations and common problems</h3>
    <p><strong>Abandoning is not a refund or reversal.</strong> It is offered only for an unconfirmed attempt that the existing flow permits you to cancel. It releases the reservation only after the provider confirms cancellation; it cannot stop a processing or completed payment.</p>
    <p>If <strong>Abandon this payment</strong> is shown and you intend to stop that attempt, select it and wait for <strong>Payment canceled</strong>. The server rechecks the provider, which may refuse if confirmation has begun. If cancellation is unavailable or cannot be confirmed, check the same payment's status or contact support; do not assume its balance has been released.</p>
    <p>Status updates may take time and no posting time is guaranteed. If a request fails, check this receipt again rather than using a new checkout to test the outcome. Give support the confirmation number and displayed status, never sensitive payment details or secure provider links.</p>
  `,
};

export const adminTestPaymentHelp: SystemHelpEntry = {
  id: "system:admin-test-payment",
  paths: [
    "/employers/%/ledger/accounts",
    "/admin-test-pay/%/%/%",
    "/admin-test-pay/receipt/%",
  ],
  summary: "Admins can run a payment only through a gateway positively verified as test mode; successful tests post to the selected ledger.",
  details: `
    <h3>Purpose</h3>
    <p>Use <strong>Test payment</strong> on an employer ledger account to check its online payment setup without masquerading as that payer. Worker Accounts now offers <strong>Make payment</strong> for administrator payments on behalf; existing worker test receipts remain test-only.</p>
    <h3>Before you start</h3>
    <p>Only an administrator who is not currently masquerading can start or manage this flow. The selected ledger account must have online payments enabled and its gateway must positively identify itself as test mode. Live-mode gateways and gateways without a reliable test-mode signal are refused before payment creation.</p>
    <p><strong>A successful test payment is posted to the selected account's ledger</strong> and applies to the displayed balance and statement allocation. Review the amount and affected ledger allocation before continuing. This action cannot be used to charge a live account.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Open the employer's <strong>Accounts</strong> page and select <strong>Test payment</strong> beside the intended ledger account.</li>
      <li>Review the posted balance, pending payments, available amount, statement selection, credits, and total.</li>
      <li>Enter a test purpose, select a new payment method, and confirm that you understand this test can post to the ledger.</li>
      <li>Select <strong>Review test payment</strong>, verify the amount and allocation, then select <strong>Start test payment</strong>.</li>
      <li>Complete any secure test-provider step and use the receipt to check the final status.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p>The attempt and posted ledger payment retain the worker or employer as the account owner and record the acting administrator and test purpose separately. The attempt does not store payer authorization. Administrator confirmation is not the worker's or employer's legal payment consent.</p>
    <p>A test-provider success can post a clearly labeled <strong>Admin test payment</strong> to the ledger, but it is not evidence of real funds or payer consent. Pending and processing states reserve the selected account amount until the existing payment lifecycle confirms an outcome.</p>
    <h3>Limitations and common problems</h3>
    <p>Admin test checkout uses a new payment method for one attempt; it does not use or save a payer's stored methods. A live or unknown gateway, disabled online payments, unsupported payment types, or missing secure payment entry prevents checkout. Do not use ordinary <strong>Pay online</strong> to perform an administrator test.</p>
    <p>If a test attempt is unfinished or its status is uncertain, check the same receipt before starting another. Cancellation releases the reservation only after the provider confirms it. Never treat a test result as a real payment or evidence of payer approval.</p>
  `,
};

export const adminAssistedWorkerPaymentHelp: SystemHelpEntry = {
  id: "system:admin-assisted-worker-payment",
  paths: ["/workers/%/ledger/accounts", "/admin-pay/worker/%/%", "/admin-pay/receipt/%"],
  summary: "Administrators can make payments on a worker's behalf using newly entered details; confirmed payments apply to the worker's ledger.",
  details: `
    <h3>Purpose</h3>
    <p>Use <strong>Make payment</strong> on a worker's Accounts page to make a payment on their behalf without masquerading as them.</p>
    <h3>Before you start</h3>
    <p>You must be an administrator and must stop masquerading first. The selected account must be active, enabled for worker online payments, and have a compatible configured gateway, payment type, and signed webhook.</p>
    <p><strong>Confirming with the payment provider can charge real funds.</strong> Only proceed when authorized to make this payment on the worker's behalf. Administrator authority is not evidence of the worker's consent. The gateway's configured credentials determine whether it processes live or test transactions; this flow does not depend on system mode or turn test credentials into a live gateway.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Select <strong>Make payment</strong> beside the intended worker ledger account.</li>
      <li>Review the worker, account, posted and available balances, unfinished payments, statement selection, credits, and total. Check an unfinished payment's status before starting another.</li>
      <li>Choose a new card or US bank transfer when offered. These details are used for this payment only; you cannot use or save the worker's stored payment methods here.</li>
      <li>Accept the administrator authorization, select <strong>Review payment</strong>, and verify the total and allocation.</li>
      <li>Select <strong>Continue to secure confirmation</strong>, enter the payment details directly with the provider, and confirm there. Starting this step alone does not complete payment.</li>
      <li>Read the <strong>Administrator payment receipt</strong> or use <strong>Check this payment's status</strong> to follow this same attempt.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p>The worker remains the ledger owner. The acting administrator and their versioned authorization are recorded separately; the attempt does not record the worker's own payment consent. Confirmed payments use the existing statement and account-credit allocation, not a separate ledger.</p>
    <p>Awaiting details or confirmation means provider steps remain unfinished. Processing funds and awaiting ledger posting do not mean cleared funds. A configured test gateway does not establish real funds. Only the checkout's acting administrator can use this receipt and cancel its unconfirmed payment, while still holding administrator authority.</p>
    <h3>Limitations and common problems</h3>
    <p><strong>Do not start another payment while its outcome is unknown.</strong> Retry reloads the same checkout or receipt; it does not submit a replacement payment. If creation or status checking fails, check unfinished payments or contact support with the confirmation number, never card details, bank details, or secure provider links.</p>
    <p><strong>Abandon this payment</strong>, when offered, is not a refund. It releases the reservation only after the provider confirms cancellation; processing or completed payments cannot be abandoned here. Leaving a page does not cancel a payment.</p>
    <p>Do not change the account's gateway credentials while a payment is unfinished. Automatic recovery will not recreate an attempt using different credentials, including a switch between test and live keys. Ask support to reconcile the original payment first.</p>
    <p>Ordinary worker and employer checkout permissions are unchanged. Employer <strong>Test payment</strong> remains a separate test-only workflow.</p>
  `,
};
