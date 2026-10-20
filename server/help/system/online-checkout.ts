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
    <p>A new method entered here is for this payment only. Use <strong>Manage saved payment methods</strong>, when offered, to add or remove reusable methods separately. Permission to manage methods and permission to use a compatible saved method for payment are separate. A default label does not replace your checkout selection.</p>
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
    <h3>Limitations and common problems</h3>
    <p><strong>Abandoning is not a refund or reversal.</strong> It is offered only for an unconfirmed attempt that the existing flow permits you to cancel. It releases the reservation only after the provider confirms cancellation; it cannot stop a processing or completed payment.</p>
    <p>If <strong>Abandon this payment</strong> is shown and you intend to stop that attempt, select it and wait for <strong>Payment canceled</strong>. The server rechecks the provider, which may refuse if confirmation has begun. If cancellation is unavailable or cannot be confirmed, check the same payment's status or contact support; do not assume its balance has been released.</p>
    <p>Status updates may take time and no posting time is guaranteed. If a request fails, check this receipt again rather than using a new checkout to test the outcome. Give support the confirmation number and displayed status, never sensitive payment details or secure provider links.</p>
  `,
};
