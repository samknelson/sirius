import type { SystemHelpEntry } from "./index";

export const workerPaymentMethodsHelp: SystemHelpEntry = {
  id: "system:worker-payment-methods",
  paths: ["/workers/%/ledger/payment-methods"],
  summary: "Review saved worker cards and US bank accounts, and add, mark a default, or remove a method when management is permitted.",
  details: `
    <h3>Purpose</h3>
    <p>Use <strong>Payment methods</strong> to manage reusable methods separately from making a payment.</p>
    <h3>Before you start</h3>
    <p>You must be signed in and authorized to view this worker's methods. Management requires worker payment-method permission for your own linked worker record. Staff may have read access but cannot perform these online payment actions. If permissions cannot be verified, management controls are unavailable.</p>
    <p>Saving requires current payment authorization wording and an available provider that supports reusable methods. Your sensitive details go directly to the provider; do not put them in notes, help, or support messages. Do not assume a provider is in test mode.</p>
    <p><strong>Saving or setting a default does not pay a balance or authorize someone to charge it.</strong> Checkout requires separate payment authority and confirmation. Removing a method makes it inactive for future checkout selection; it does not cancel, reverse, or refund an existing payment. Check unfinished payment status separately before deciding to pay again.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Review the saved methods and any provider error. <strong>No saved payment methods yet.</strong> means none are listed, not that there is no balance due.</li>
      <li>When permitted, select <strong>Add payment method</strong>, read and accept the authorization, then use <strong>Select a payment provider</strong>. Complete the provider's secure setup. Wait for <strong>Payment method added</strong> and the refreshed list.</li>
      <li>To mark a usable non-default method, use its <strong>Set default</strong> control. Look for the <strong>Default</strong> label. You must still choose a compatible method in checkout; this does not start automatic payments.</li>
      <li>Before removal, consider any unfinished payment separately: removal is not cancellation. Use the method's <strong>Remove</strong> control, review <strong>Remove payment method?</strong>, then choose <strong>Remove</strong> to proceed or <strong>Cancel</strong> to leave it unchanged.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p><strong>Payment method removed</strong> means the worker method has been marked inactive locally and is no longer eligible for a new checkout. Its record is retained for payment history and can remain listed. The app attempts provider detachment, but local removal does not guarantee the provider has removed it. Adding it again later requires secure setup.</p>
    <p>A saved method is not necessarily usable for every account. Checkout requires an active method on the account's gateway, an accepted card or US bank account type, and available provider details. A <strong>Default</strong> label does not override these checks.</p>
    <h3>Limitations and common problems</h3>
    <p><strong>Retry</strong> beside a loading error reloads the list or authorization only. If saving gives an uncertain result, reload the list before adding the same method again. Read provider and permission errors; ask support if setup, authorization, or the provider remains unavailable. Do not send payment details or secure provider links.</p>
    <p>This page does not show whether funds have settled. Use the existing payment receipt to check a payment; removing its method or closing a setup dialog does not abandon that payment.</p>
  `,
};
