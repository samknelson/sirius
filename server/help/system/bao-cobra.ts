import type { SystemHelpEntry } from "./index";

export const baoCobraHelp: SystemHelpEntry = {
  id: "system:bao-cobra-lifecycle",
  paths: ["/workers/%/sitespecific/bao/cobra", "/cobra/cases", "/cobra/cases/%"],
  summary: "COBRA case status tracks election and payment progress; monthly benefit coverage requires its own paid statement-month evidence.",
  details: `
    <h3>Worker self-service</h3>
    <p>Staff and workers viewing their own linked worker can start <strong>Elect COBRA Coverage</strong> from the worker's COBRA tab when an open, unelected case is within its election deadline. Wait for case loading to finish; a lookup error is not permission to elect. Choose the available lost coverage, confirm covered people, sign, review the premium, and post. Posting records the election and initial payment deadline; it does not make a payment. Closed, already elected, or expired cases cannot be elected. Staff case administration and manual New Election are not worker self-service actions.</p>
    <h3>Status meanings</h3>
    <ul>
      <li><strong>New</strong>: no election is recorded. Posting a COBRA election normally moves the case to <strong>Pending First Payment</strong>.</li>
      <li><strong>Pending First Payment</strong>: the initial premium obligation is not yet satisfied. It includes every coverage month from the COBRA effective month through the election month.</li>
      <li><strong>Enrolled</strong>: all initial months have positive posted case premiums and sufficient cleared, posted payment allocations in those same statement months, with no overdue later premium.</li>
      <li><strong>Delinquent</strong>: a posted unpaid obligation is past its payment window. Paying the required months can return an open case to Enrolled.</li>
      <li><strong>Closed</strong>: automatic reconciliation never reopens the case. Staff closure and the maximum coverage period take precedence over payment.</li>
    </ul>
    <h3>Timing and prerequisites</h3>
    <p>The election window remains 60 days from the offer date, and the initial payment deadline remains 45 days after election. The initial deadline applies to initial months; later premiums retain the 30-day grace period measured from the first day of their statement month, never ending before the initial payment deadline. The final day is included. Old unpaid months do not receive a new grace period each month.</p>
    <p>Status reconciliation runs after committed COBRA ledger changes and relevant case or election changes. The configured COBRA status scan recovers missed events and date-driven changes when enabled; it does not collect payments. Pending, failed, unallocated, or insufficient payments, unrelated credits, and empty accounts do not prove the initial obligation is satisfied.</p>
    <h3>Case status is not monthly coverage</h3>
    <p>Each benefit month still requires a matching open case and benefit election, a positive posted case premium, an allocated payment, and an exactly zero statement-month balance. Enrolled or grace status alone does not grant coverage for an unpaid month.</p>
    <h3>Reviewing a blocked case</h3>
    <p>Staff can use <strong>Preview status reconciliation</strong> on the case details page, review proposed changes or blockers, then select <strong>Apply status reconciliation</strong> when available. Applying rechecks current evidence and changes only case status information. It does not bill, allocate, collect, refund, or change financial amounts.</p>
    <p>Missing or ambiguous billing/status configuration, missing case premiums, or a missing matching COBRA election require staff review. Payments shared with other posted obligations in the same statement month, including premiums for a closed case, cannot safely be attributed to this case and block automatic enrollment. Removing an election or shortening its period can remove premium evidence; this is not automatic permission to close or reinstate a case. Restored medical or dental benefits automatically close only unelected cases; elected-case policy is unchanged. An expired election window prevents posting but does not itself close the case.</p>
  `,
};
