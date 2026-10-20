import type { SystemHelpEntry } from "./index";

export const benefitsWorkflowHelp: SystemHelpEntry[] = [
  {
    id: "system:benefits-recorded-coverage",
    paths: ["/workers/%/benefits/current", "/workers/%/benefits/history", "/workers/%/benefits/eligibility"],
    summary: "Compare recorded benefit coverage with eligibility evidence, keeping subscriber coverage separate from benefits provided through another worker.",
    details: `
      <h3>Purpose</h3><p>Use Current and History to review benefit records; use Eligibility to understand the rules and evidence used to assess coverage.</p>
      <h3>Before you start</h3><p>You need access to this worker. Available tabs depend on enabled benefits features and your access; reading coverage does not authorize changing it.</p>
      <h3>How to use this page</h3><ol><li>Check the benefit and its recorded dates.</li><li>Distinguish benefits held by this worker from dependent coverage supplied through someone else.</li><li>Compare the relevant month with Eligibility and, where available, the Benefits Summary.</li></ol>
      <h3>Results and status meanings</h3><p>An eligibility result is not an election, payment, or guarantee of coverage. Work months and coverage months can differ; use the month identified by the rule rather than assuming hours grant coverage in the same month.</p>
      <h3>Limitations and common problems</h3><p>No records is not proof of a completed negative coverage decision. Missing hours, unavailable evidence, and pending scans need review. Ask authorized staff to review source records before requesting a scan; do not treat a reload as recalculation.</p>`,
  },
  {
    id: "system:benefits-scan",
    paths: ["/workers/%/benefits/scan"],
    summary: "Preview or apply a worker's monthly benefit scan and review the reasons for created, deleted, or unchanged coverage.",
    details: `
      <h3>Purpose</h3><p>Evaluate configured eligibility rules for a selected month.</p>
      <h3>Before you start</h3><p>This is a staff action. Check elections, hours, policy assignments, exemptions, and required rule configuration first. Live mode can create and delete benefit records.</p>
      <h3>How to use this page</h3><ol><li>Select Year and Month.</li><li>Leave Mode on <strong>Test</strong> and select <strong>Run Test Scan</strong>.</li><li>Review the per-benefit reasons and proposed changes.</li><li>Only after checking the consequences, switch to <strong>Live</strong> and select <strong>Run Live Scan</strong> if authorized.</li></ol>
      <h3>Results and status meanings</h3><p>Test results preview changes without applying them. Live results report created and deleted records; a no-change result does not mean every rule passed. Read the individual reasons.</p>
      <h3>Limitations and common problems</h3><p>A queued or in-progress scan is not a completed decision. If evaluation fails, correct the reported prerequisite and preview again. Do not repeatedly apply a scan to compensate for missing source data.</p>`,
  },
  {
    id: "system:benefit-exemptions",
    paths: ["/workers/%/benefits/exemptions"],
    summary: "Review dated eligibility exemptions and their source before adding or changing exceptions to the worker's benefit rules.",
    details: `
      <h3>Purpose</h3><p>Review exceptions used by eligibility checks, including exemptions created through approved appeal outcomes.</p>
      <h3>Before you start</h3><p>This staff tab requires the exemptions feature. An exemption is not itself an election or a benefit record. Check the source, benefit scope, and dates before changing it.</p>
      <h3>How to use this page</h3><ol><li>Review existing exemptions and their source labels.</li><li>Use the available editor only for changes you are authorized to make.</li><li>Check the affected coverage period and preview the relevant benefit scan after correcting evidence.</li></ol>
      <h3>Limitations and common problems</h3><p>Do not replace an appeal's recorded outcome with an unrelated manual exception. Saving an exemption does not prove that all other eligibility conditions pass or that queued scans have finished.</p>`,
  },
  {
    id: "system:elections-current",
    paths: ["/workers/%/elections/current"],
    summary: "Review the worker's current benefit election, selected benefits, dependents, and effective dates without confusing enrollment with recorded coverage.",
    details: `
      <h3>Purpose</h3><p>Review the election currently applicable to this worker.</p>
      <h3>Before you start</h3><p>The elections feature and worker access are required. Staff review and enrollment launch actions are separate from permission to read Current.</p>
      <h3>How to use this page</h3><ol><li>Check effective dates, employer, selected benefits, and dependent relationships.</li><li>Report incorrect relationships or dates to staff before signing or submitting another enrollment.</li><li>Use Benefits to check actual recorded coverage.</li></ol>
      <h3>Limitations and common problems</h3><p>An election expresses selections; it does not establish eligibility, paid premiums, or coverage by itself. No current election may reflect dates or unfinished processing rather than a lost record.</p>`,
  },
  {
    id: "system:enrollment-review",
    paths: ["/workers/%/elections/list", "/trust/enrollment-queue", "/trust/election/%", "/trust/election/%/edit"],
    summary: "Review enrollment work and election dates, distinguish drafts from posted elections, and check dependents before completing staff actions.",
    details: `
      <h3>Purpose</h3><p>Use the worker election list and enrollment queue to find and review enrollment work.</p>
      <h3>Before you start</h3><p>Staff access and elections configuration are required. First-time enrollment, Open Enrollment, Life Event, and COBRA have different launch guards and date requirements; only offered actions are available for this worker.</p>
      <h3>How to use this page</h3><ol><li>Find the worker or filter the queue for the enrollment type and state you need.</li><li>Open the record and check employer, effective dates, benefits, and dependent selections.</li><li>Complete the offered review and signature steps before posting.</li></ol>
      <h3>Results and status meanings</h3><p>A draft or unfinished wizard is not a posted election. Posting makes the election available to downstream eligibility and billing; it does not by itself create every coverage month or collect premiums.</p>
      <h3>Limitations and common problems</h3><p>Check an existing draft before starting another enrollment. A disabled launch may indicate an existing election or an unavailable enrollment window. Correct date and relationship validation errors rather than changing the enrollment type to bypass them. Editing consequential dates or selections can affect downstream coverage and charges.</p>`,
  },
  {
    id: "system:disability-credit-worker",
    paths: ["/workers/%/sitespecific/bao/disability-credit"],
    summary: "Review this worker's Disability Credit cases and month outcomes, distinguishing approved cases from hours already granted or still queued.",
    details: `
      <h3>Purpose</h3><p>Review the worker's Disability Credit history and available case information.</p>
      <h3>Before you start</h3><p>BAO and access to this worker's Disability Credit tab are required. Staff preparation and designated approver decisions are separate permissions.</p>
      <h3>How to use this page</h3><ol><li>Review the case and the months it covers.</li><li>Check available month outcomes and case history.</li><li>Ask staff to review missing evidence or a case that has returned to draft.</li></ol>
      <h3>Results and status meanings</h3><p>Approval can grant eligible months or queue months for later release. An approved case does not mean every selected month has already received hours. A queued month is not posted hours.</p>
      <h3>Limitations and common problems</h3><p>Missing information is not a denial. Use the case's recorded decision and staff review rather than inferring entitlement from an empty display.</p>`,
  },
  {
    id: "system:disability-credit-staff",
    paths: ["/bao/dc/queue", "/bao/dc/drafts", "/bao/dc/recently-denied", "/bao/dc/fmla-eligible", "/bao/dc/cases/%"],
    summary: "Prepare Disability Credit evidence and months, submit ready cases for approval, and review granted or queued outcomes in the case log.",
    details: `
      <h3>Purpose</h3><p>Use the queues to find cases and the case page to prepare evidence, select months, and follow the approval decision.</p>
      <h3>Before you start</h3><p>BAO staff access is required. Only designated Disability Credit approvers can approve, deny, or return queued cases. Check qualifying basis, required documents, readiness, and grant-configuration warnings.</p>
      <h3>How to use this page</h3><ol><li>Open a draft and complete its readiness checklist and evidence.</li><li>Select permitted DC months and save the selection while the case is in draft.</li><li>Select <strong>Send for Approval</strong> only when readiness passes.</li><li>Approvers review the current case before using <strong>Approve</strong>, <strong>Deny</strong>, or <strong>Return to draft</strong>.</li><li>Review the Disability Credit log for actual grant, queue, release, and reconciliation outcomes.</li></ol>
      <h3>Results and status meanings</h3><p>Changing evidence can return a ready or queued case to draft if readiness no longer passes. Approval can grant or queue individual months. Queued and granted months cannot be edited as ordinary draft selections. <strong>Extend disability</strong> opens a linked case for another review; the approved parent stays approved.</p>
      <h3>Limitations and common problems</h3><p>Decision and withdrawal actions have consequences; read their reason requirements before acting. A duplicate open case or stale state is refused: reload and review the existing case instead of recreating it. A grant-configuration warning needs correction, not repeated approval attempts.</p>`,
  },
  {
    id: "system:bao-cases-appeals",
    paths: ["/bao/cases", "/bao/cases/new", "/bao/cases/%"],
    summary: "Track case ownership and deadlines, and record benefit appeal evidence and formal outcomes through the appeal's dedicated actions.",
    details: `
      <h3>Purpose</h3><p>Use cases for assigned follow-up and Benefit Appeals for the documented appeal workflow.</p>
      <h3>Before you start</h3><p>BAO staff access is required. Check the case type, worker or related record, assignee, deadline, and applicable note and file configuration. Formal appeal outcomes can create dated eligibility exemptions and trigger communications; review those effects before recording a decision. Do not infer a legal deadline from this help.</p>
      <h3>How to use this page</h3><ol><li>Open or create the appropriate case type.</li><li>Review the assignee and Deadline before saving changes.</li><li>For an appeal, verify Benefit, Denial reason, and SPD citation against the actual evidence.</li><li>Use <strong>Record member letter</strong> to attach the received letter, and the dedicated outcome controls to record the trustee decision.</li></ol>
      <h3>Results and status meanings</h3><p>Ordinary status edits are not a substitute for appeal outcome actions. Closing a case can require Resolution and Resolution date. Appeal outcomes may create dated eligibility exemptions; they do not themselves guarantee coverage. A failed denial communication can leave the appeal Submitted; review the displayed communication warning.</p>
      <h3>Limitations and common problems</h3><p>Review all consequences before recording an outcome or closing a case. Staff and administrator override abilities differ. Correct missing configuration or attachments before retrying; do not record a second outcome to disguise a delivery failure.</p>`,
  },
  {
    id: "system:bao-cobra-case-setup",
    paths: ["/cobra/cases", "/cobra/cases/add", "/cobra/cases/%/edit"],
    summary: "Find or prepare a COBRA case with the correct qualifying event and dates before changing continuation coverage records.",
    details: `
      <h3>Purpose</h3><p>Use the staff case list and case form to locate or maintain continuation cases. The accompanying lifecycle help explains payment and status evidence.</p>
      <h3>Before you start</h3><p>BAO and staff case access are required; editing and administrative corrections have additional checks. Search for an existing active case before creating another for the same worker.</p>
      <h3>How to use this page</h3><ol><li>Find the worker's existing case first.</li><li>When creating a case, review the qualifying event, offer date, coverage dates, and status offered by the form.</li><li>Select <strong>Create Case</strong> only after checking the dates; when editing, review the existing election and billing evidence before saving.</li></ol>
      <h3>Limitations and common problems</h3><p>A case is not an election or a payment. Conflicting active cases and invalid dates need review rather than a second case. Date or status corrections can affect eligibility and billing consumers; do not use them as a substitute for allocating an actual payment.</p>`,
  },
  {
    id: "system:domestic-partner-worker",
    paths: ["/workers/%/sitespecific/bao/dp"],
    summary: "Review posted Domestic Partner member charges by coverage month and distinguish paid, partially paid, and unpaid obligations.",
    details: `
      <h3>Purpose</h3><p>Review the Domestic Partner member-charge account and its monthly payment evidence.</p>
      <h3>Before you start</h3><p>BAO and access to this worker's Domestic Partner tab are required. Billing configuration and an account must be available. Access here does not itself authorize online payment.</p>
      <h3>How to use this page</h3><ol><li>Check the account balance and the coverage month for each charge.</li><li>Review the dependent and posted amounts.</li><li>Use the offered payment link only after checking the actual obligation.</li></ol>
      <h3>Results and status meanings</h3><p><strong>Paid</strong>, <strong>Partially paid</strong>, and <strong>Unpaid</strong> describe the displayed monthly obligations, not general benefit eligibility. Pending provider funds are not cleared posted allocations. A month confirmed as no charge needs no payment.</p>
      <h3>Limitations and common problems</h3><p>Unavailable billing configuration or rates must not be read as a zero obligation. A posted charge remains evidence even when historical reconstruction is unavailable. Ask staff to investigate missing or disputed months rather than paying an invented amount.</p>`,
  },
  {
    id: "system:domestic-partner-report",
    paths: ["/bao/dp/workers"],
    summary: "Review workers with Domestic Partner coverage and billing evidence, keeping unavailable calculations distinct from confirmed no-charge months.",
    details: `
      <h3>Purpose</h3><p>Use the staff report to compare Domestic Partner coverage-month and billing evidence.</p>
      <h3>Before you start</h3><p>BAO staff access is required. Rates, relationships, elections, and posted financial records affect what can be established.</p>
      <h3>How to use this page</h3><ol><li>Review the report's selected period and filters.</li><li>Read the status and any billing warning for each worker.</li><li>Open the worker's Domestic Partner account to investigate posted charges and payments.</li></ol>
      <h3>Limitations and common problems</h3><p>A calculation that cannot be reconstructed is not proof that a surviving posted charge should be removed. Unavailable rates or evidence differ from a confirmed no-charge result. This report does not itself post payments, create coverage, or provide a balance notification.</p>`,
  },
  {
    id: "system:bao-beneficiaries",
    paths: ["/workers/%/sitespecific/bao/beneficiaries"],
    summary: "Review or replace the worker's beneficiary list and check that a nonempty list allocates a total of 100 percent.",
    details: `
      <h3>Purpose</h3><p>Maintain beneficiary names, relationships, contact information, and allocation percentages.</p>
      <h3>Before you start</h3><p>BAO and worker-view access allow reading; editing requires the worker-own access check. Beneficiaries are entered here, not automatically taken from enrollment dependents.</p>
      <h3>How to use this page</h3><ol><li>Review every existing row before changing the list.</li><li>Enter each beneficiary's Name and Percent and any available relationship and contact details.</li><li>Check that percentages total 100 for a nonempty list.</li><li>Before saving, check removed rows: saving replaces the stored list, including removals.</li></ol>
      <h3>Limitations and common problems</h3><p>An empty list is permitted; it does not establish a beneficiary designation. Correct percentage, name, or optional identifier validation errors before saving. This help does not determine legal entitlement or replace organization-specific designation requirements.</p>`,
  },
  {
    id: "system:event-center-hours-purchase",
    paths: ["/workers/%/ledger/sitespecific/bao/echp"],
    summary: "Check the Event Center hours purchase quote and target month before confirming a purchase that records additional hours.",
    details: `
      <h3>Purpose</h3><p>Check purchase eligibility, hours needed, threshold, price, and the target work month.</p>
      <h3>Before you start</h3><p>BAO and worker-own access are required. Current rules, hours, employer/status configuration, and purchase timing must permit the transaction. A quote does not purchase hours or grant coverage.</p>
      <h3>How to use this page</h3><ol><li>Read the eligibility message and target month.</li><li>Review hours worked, hours to purchase, threshold, and Price.</li><li>Before confirming, understand that this records hours and may lead to later billing; it does not collect money in this page.</li><li>Use <strong>Confirm purchase</strong> only when the quote and month are correct.</li></ol>
      <h3>Results and status meanings</h3><p>The server reevaluates eligibility and records an ECHP hours entry when permitted. Charges are handled later by the charge-plugin workflow. Coverage still depends on the relevant election and benefit rules.</p>
      <h3>Limitations and common problems</h3><p>An already-purchased month or no additional hours needed is refused. Retroactive coverage cannot be purchased online; ask staff to review prior months. If the result is unclear, reload the hours and quote before attempting another purchase.</p>`,
  },
];
