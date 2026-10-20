import type { SystemHelpEntry } from "./index";

export const financeUploadHelp: SystemHelpEntry[] = [
  {
    id: "system:ledger-accounts",
    paths: ["/ledger/accounts", "/ledger/accounts/%", "/ledger/accounts/%/edit", "/ledger/accounts/%/payments", "/ledger/accounts/%/batches", "/ledger/accounts/%/transactions", "/ledger/accounts/%/summary", "/ledger/accounts/%/participants", "/ledger/accounts/%/settings", "/workers/%/ledger/accounts", "/employers/%/ledger/accounts"],
    summary: "Find ledger accounts and participant balances, then review payments and transactions before changing account settings or financial records.",
    details: `
      <h3>Purpose</h3><p>An account defines the ledger being tracked; an entity account links a participant such as a worker or employer to that ledger.</p>
      <h3>Before you start</h3><p>Ledger and the relevant account or entity access are required. Staff account administration and a participant's statement access are different capabilities. Batch tabs require the batch feature.</p>
      <h3>How to use this page</h3><ol><li>Find the correct account and check its unit and purpose.</li><li>Open Participants or the worker's or employer's Accounts to find the relevant entity account.</li><li>Compare Payments, Transactions, and Summary for the same period.</li><li>Review downstream financial effects before saving account settings.</li></ol>
      <h3>Results and status meanings</h3><p>Charges increase an obligation; credits reduce it according to the payment type. A saved payment, pending provider attempt, or batch membership alone is not posted money. Allocations determine which participant and statement month receives an amount.</p>
      <h3>Limitations and common problems</h3><p>Check dates, account units, allocation, and status before treating a balance as a discrepancy. An account total is not interchangeable with one participant's monthly statement.</p>`,
  },
  {
    id: "system:entity-account-statements",
    paths: ["/ea/%", "/ea/%/invoices", "/ea/%/invoices/%/%", "/ea/%/payments", "/ea/%/transactions", "/ea/%/summary"],
    summary: "Review a participant's statements, payments, and transactions for the selected account and period, separating posted obligations from pending funds.",
    details: `
      <h3>Purpose</h3><p>Use Invoices for statement-month detail, Payments for payment records, Transactions for ledger entries, and Summary for totals.</p>
      <h3>Before you start</h3><p>You need permission to view this entity account. Check the participant and ledger account before interpreting amounts.</p>
      <h3>How to use this page</h3><ol><li>Choose the statement month and year where offered.</li><li>Review charges, credits, and allocated payments for that month.</li><li>Open the underlying records to investigate an unexpected amount.</li></ol>
      <h3>Results and status meanings</h3><p>Cleared posted allocations contribute to financial evidence; pending online funds are not yet posted credit. Account-wide balance and one statement-month balance can differ. Credits in another month do not prove a particular premium month has been paid.</p>
      <h3>Limitations and common problems</h3><p>Reading an invoice does not send it, collect payment, or establish benefit coverage. If a payment is absent, check its account, allocation month, and status before recording it again.</p>`,
  },
  {
    id: "system:staff-payment-entry",
    paths: ["/ledger/payment/%", "/ledger/accounts/%/payments/new", "/ea/%/payments/new", "/ea/%/payments/new/%"],
    summary: "Record and allocate staff-entered payments or adjustments, checking payment direction and clearing status before changing posted ledger effects.",
    details: `
      <h3>Purpose</h3><p>Maintain a payment record and allocate its amount to the intended participant statements.</p>
      <h3>Before you start</h3><p>Staff financial access is required. Check Payment Type and its charge or credit effect. Recording an offline payment is not the same operation as charging a provider.</p>
      <h3>How to use this page</h3><ol><li>Choose Payment Type and enter Amount.</li><li>Review Status, Date Received, Date Cleared, and Memo as offered.</li><li>Allocate the full amount to participants and statement months. Where <strong>Upload source</strong> is offered for employer withholding, select the actual hours uploads instead of inventing statement allocations.</li><li>Review totals and the effect of clearing before saving.</li></ol>
      <h3>Results and status meanings</h3><p>Draft, Canceled, Cleared, and Error are payment states, not proof of a bank transfer. Clearing and later corrections can create, replace, or remove ledger entries. Adjustments use the cleared state. Participant allocations must equal the payment amount, and statement allocations must match their participant amount.</p>
      <h3>Limitations and common problems</h3><p>Before deleting or editing a cleared record, review affected statements and charges. Provider-managed online payments cannot be edited or deleted here. Use the configured Entity Files area for attachments; existing attachments and new-upload prerequisites can differ. If validation fails, correct the account, type, or allocation mismatch rather than changing the amount merely to pass.</p>`,
  },
  {
    id: "system:payment-batches",
    paths: ["/ledger/payment-batch/%"],
    summary: "Group staff payment records into batches while keeping batch membership separate from payment status and posted ledger allocations.",
    details: `
      <h3>Purpose</h3><p>Review a payment batch, its payments, files, and activity history.</p>
      <h3>Before you start</h3><p>Staff access and the payment-batch component are required. A batch organizes payment records; it is not proof that funds cleared.</p>
      <h3>How to use this page</h3><ol><li>Review batch details and its ledger account.</li><li>On Payments, inspect existing payments before adding another.</li><li>Check each payment's type, allocation, and state separately.</li><li>Use Logs to review recorded batch activity.</li></ol>
      <h3>Limitations and common problems</h3><p>Before removing a payment, distinguish removing its batch assignment from deleting the underlying payment. Deleting financial records can affect posted entries. A payment already assigned to a batch can be refused; locate that assignment instead of recreating the payment. New attachments require the Payment Batches Entity Files area to be configured.</p>`,
  },
  {
    id: "system:monthly-upload-monitor",
    paths: ["/employers/monthly-uploads"],
    summary: "Monitor employer uploads over a five-month period using the selected year, month, upload type, and optional status filter.",
    details: `
      <h3>Purpose</h3><p>Use this administrator monitoring page to locate employer upload work, not to assume it has posted successfully.</p>
      <h3>How to use this page</h3><ol><li>Choose Year, Month, and Upload Type.</li><li>Choose Status (Optional) and apply the filters.</li><li>Open the relevant upload to review its saved progress and results.</li></ol>
      <h3>Results and status meanings</h3><p>Draft and In Progress are unfinished work; Error needs investigation. Completed identifies the wizard's saved state, not an independent reconciliation of every resulting financial record. No Upload differs from an upload that exists but is unfinished.</p>
      <h3>Limitations and common problems</h3><p>Status filtering can find an upload anywhere in the displayed period. Check the specific month before contacting an employer. An empty result can reflect the filters; clear them before concluding no employers exist.</p>`,
  },
  {
    id: "system:employer-compliance-monitor",
    paths: ["/employers/compliance"],
    summary: "Compare six months of employer reporting status and selected ledger balances before following up on missing uploads or outstanding obligations.",
    details: `
      <h3>Purpose</h3><p>Review upload completeness and balances for active employers.</p>
      <h3>Before you start</h3><p>Staff access and Ledger are required. Bulk-message actions additionally depend on their own access and component checks.</p>
      <h3>How to use this page</h3><ol><li>Choose Year, Anchor Month, Upload Type, and Ledger Accounts.</li><li>Use Search, Company, Status, and Balance filters to narrow the view.</li><li>Review individual month cells and balances before selecting employers.</li><li>Before exporting or preparing bulk follow-up, check the selected recipients and protect the downloaded financial information.</li></ol>
      <h3>Results and status meanings</h3><p>Missing current month, Current month not completed, and prior-month overdue filters answer different questions. A received upload is not necessarily processed. Balance depends on the chosen accounts and period.</p>
      <h3>Limitations and common problems</h3><p>A canceled upload is not a new completed submission. Inspect saved run results before asking for resubmission. Selection and message preparation are not delivery confirmation.</p>`,
  },
  {
    id: "system:employer-upload-launcher",
    paths: ["/employers/%/wizards"],
    summary: "Find or start an authorized employer upload and review its period, input, validation, preview, and processing results before posting data.",
    details: `
      <h3>Purpose</h3><p>Use Wizards to locate employer submissions and create a supported upload for this employer.</p>
      <h3>Before you start</h3><p>Employer access and an offered wizard type are required. Staff monitoring pages do not grant an employer permission to submit for another organization.</p>
      <h3>How to use this page</h3><ol><li>Review existing work for the intended period before selecting <strong>Create New Wizard</strong>.</li><li>Select Wizard Type and complete its creation form with the correct employer and period.</li><li>Review the input format and mapping in the opened wizard.</li><li>Complete validation and inspect row issues and any preview before Process.</li></ol>
      <h3>Results and status meanings</h3><p>For monthly hours uploads, validation checks input; Process posts accepted work and can affect hours, worker records, and ledger consumers. A preview is not posting. Other offered types have their own steps; do not reuse an hours mapping for an unrelated feed.</p>
      <h3>Limitations and common problems</h3><p>If a type is absent, ask staff to check configuration and access. If Process status cannot be read, reopen the existing run instead of creating a duplicate submission.</p>`,
  },
  {
    id: "system:shared-wizard-runner",
    paths: ["/wizards/%"],
    summary: "Resume saved wizard steps, review validation and processing results, and distinguish unreadable progress from a confirmed failed run.",
    details: `
      <h3>Purpose</h3><p>Follow the steps for the wizard type shown on this saved run.</p>
      <h3>Before you start</h3><p>Access is checked for the wizard's type and linked entity; sign-in alone is not sufficient. The launcher and steps describe the input and effects for this particular type.</p>
      <h3>How to use this page</h3><ol><li>Check the wizard type, entity, period, and saved status.</li><li>Follow the offered steps in order, correcting validation issues before processing.</li><li>Before Process or another run action, review its warning: imports may write records, while reports may generate downloadable files.</li><li>Inspect saved results and row issues after completion; protect downloaded personal or financial data.</li></ol>
      <h3>Results and status meanings</h3><p>Validation, preview, processing, and results are separate stages. In-progress or queued work is not complete. A browser refresh or missing heartbeat is not proof that server work stopped.</p>
      <h3>Limitations and common problems</h3><p>If status cannot be read, reopen or refresh the existing wizard and do not automatically resubmit Process. A failed run can have partial effects; ask staff to reconcile its saved results first. <strong>Delete Wizard</strong> permanently removes the run and associated files, not a guaranteed reversal of posted business data. Deletion can be refused once processing is admitted.</p>`,
  },
  {
    id: "system:employer-gateway-customer",
    paths: ["/employers/%/ledger/customer"],
    summary: "Review the employer's payment-provider customer for the selected gateway without confusing that identity with a ledger account or payment authorization.",
    details: `
      <h3>Purpose</h3><p>Review Customer information and, where offered, open the provider's customer record.</p>
      <h3>Before you start</h3><p>Employer ledger access and a configured gateway are required. External provider access is separate from access to this page.</p>
      <h3>How to use this page</h3><ol><li>Select the intended gateway when a gateway picker is shown.</li><li>Check the customer identity for this employer.</li><li>Use <strong>View in Provider</strong> only if you are authorized to access that external system.</li></ol>
      <h3>Limitations and common problems</h3><p>A missing or failed customer lookup does not prove that no ledger balance exists. Customer identity does not grant method-management or payment-use authority. Do not copy provider identifiers into messages as a substitute for the actual statement.</p>`,
  },
  {
    id: "system:employer-payment-methods",
    paths: ["/employers/%/ledger/payment_methods"],
    summary: "Manage the employer's saved payment methods by gateway, keeping method setup, default choice, and permission to charge separate.",
    details: `
      <h3>Purpose</h3><p>Review saved employer methods and use only the management actions offered for your access.</p>
      <h3>Before you start</h3><p>Ledger, employer account access, gateway configuration, and method-management authority are required. Viewing this tab does not authorize attaching or charging a method.</p>
      <h3>How to use this page</h3><ol><li>Check the employer and gateway section.</li><li>Use provider-hosted setup for sensitive card or bank information; never put those details in names, notes, or tokens.</li><li>If provider setup succeeded but saving the attachment failed, use the offered attachment retry rather than setting up another method.</li><li>Before deleting a method, review the warning that deletion cannot be undone here.</li></ol>
      <h3>Results and status meanings</h3><p>A default is a saved preference, not a charge or consent to every future payment. Gateway compatibility and payment-use grants are checked separately.</p>
      <h3>Limitations and common problems</h3><p>If permissions or gateway details cannot load, resolve the displayed error before changing methods. Deleting a saved method does not cancel an existing payment attempt or refund a posted payment.</p>`,
  },
];
