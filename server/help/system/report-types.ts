import type { SystemHelpEntry } from "./index";

export const reportTypeHelp: SystemHelpEntry[] = [
  {
    id: "system:identity-anomaly-reports",
    paths: ["/reports/report_workers_duplicate_ssn", "/reports/report_workers_invalid_ssn", "/reports/report_workers_missing_ssn"],
    summary: "Review missing, invalid, or shared Social Security Number findings as sensitive identity anomalies, not permission to merge or overwrite worker records.",
    details: `
      <h3>Purpose</h3><p>Run the selected Missing SSN, Invalid SSN, or Duplicate SSN report across worker records.</p>
      <h3>Before you start</h3><p>Administrator access and required source-query availability are needed. Results contain sensitive identity information.</p>
      <h3>How to use this page</h3><ol><li>Choose the anomaly type that answers your question.</li><li>Review existing runs before creating a report.</li><li>Inspect findings and source identity evidence before an authorized correction.</li><li>Protect downloaded results.</li></ol>
      <h3>Limitations and common problems</h3><p>These reports do not repair, merge, or delete workers. A shared number does not prove records represent the same person. Missing data differs from an invalid value; investigate the actual worker evidence.</p>`,
  },
  {
    id: "system:ledger-integrity-report",
    paths: ["/reports/report_ledger_integrity"],
    summary: "Compare posted ledger entries with charge-plugin expectations for the selected date range, without treating a mismatch report as an automatic correction.",
    details: `
      <h3>Purpose</h3><p>Find differences between posted entries and expected charges.</p>
      <h3>Before you start</h3><p>Administrator access is required. Review the relevant charge configuration and retained financial evidence.</p>
      <h3>How to use this page</h3><ol><li>Open a saved run or create the report.</li><li>On Inputs, choose charge plugins and date range; leaving them empty checks all supported scope.</li><li>Run and inspect mismatches and errors.</li><li>Review original payments and source evidence before any separately authorized repair.</li></ol>
      <h3>Limitations and common problems</h3><p>A mismatch can reflect missing source data, configuration, or real posting differences. A clean selected scope does not certify unrelated accounts. Running this report is not authorization to reverse or recreate transactions.</p>`,
  },
  {
    id: "system:dc-net-grant-report",
    paths: ["/reports/report_bao_dc_net_grants"],
    summary: "Review trailing-year Disability Credit grant activity by work month, keeping net grant events separate from future queued grants and coverage months.",
    details: `
      <h3>Purpose</h3><p>Export net Disability Credit activity derived live from grant events, grouped by work month.</p>
      <h3>Before you start</h3><p>BAO staff access and required source-query availability are needed. The report includes at least the trailing year of work-month activity.</p>
      <h3>How to use this page</h3><ol><li>Review existing runs or create DC Net Grant Activity.</li><li>Continue through Inputs and Run.</li><li>Inspect net results and their work-month labels before downloading.</li></ol>
      <h3>Limitations and common problems</h3><p>Net activity can reflect grant reversals; it is not a count of future queued months or proof of benefit coverage. Use the worker case and monthly grant evidence to investigate a discrepancy.</p>`,
  },
  {
    id: "system:dc-upload-review-report",
    paths: ["/reports/report_bao_dc_upload_review"],
    summary: "Review live Disability Credit upload anomalies before staff corrections, distinguishing retired status rows, unreported FMLA gaps, and reconciliation findings.",
    details: `
      <h3>Purpose</h3><p>Export current findings from hours, cases, and grants for staff review.</p>
      <h3>Before you start</h3><p>BAO staff access and required source-query availability are needed.</p>
      <h3>How to use this page</h3><ol><li>Open or create DC Upload Review.</li><li>Continue through Inputs and Run.</li><li>Review each finding's worker, month, employer, and detail before any separate correction.</li></ol>
      <h3>Results and status meanings</h3><p>Findings include retired Disability status rows, unreported gaps after FMLA, and actionable reconciliation conditions. A gap is missing evidence, not proof of a denied claim.</p>
      <h3>Limitations and common problems</h3><p>This report does not itself approve, deny, grant, or repair a case. An older saved run can differ from today's live findings; inspect the underlying evidence before acting.</p>`,
  },
  {
    id: "system:edls-spacing-report",
    paths: ["/reports/report_edls_scheduled_too_soon"],
    summary: "Find consecutive EDLS shift starts closer together than the configured minimum, without confusing start-time spacing with hours of rest after shift end.",
    details: `
      <h3>Purpose</h3><p>Review EDLS assignments with insufficient separation between consecutive shift start times.</p>
      <h3>Before you start</h3><p>Administrator access, EDLS, and required source-query availability are needed.</p>
      <h3>How to use this page</h3><ol><li>Check Settings: Minimum hours between shift starts, Start date, and End date.</li><li>Review defaults: 24 hours, today, and ten days after the start when dates are left blank.</li><li>Run and inspect the assignment pairs before a separate scheduling change.</li></ol>
      <h3>Limitations and common problems</h3><p>The comparison is start-to-start, not an end-to-next-start rest calculation or a legal determination. Report generation does not change sheets or notify workers.</p>`,
  },
  {
    id: "system:edls-population-report",
    paths: ["/reports/report_edls_soop"],
    summary: "Find future EDLS assignments whose workers are no longer in the scheduling population, reviewing source status before changing an assignment.",
    details: `
      <h3>Purpose</h3><p>Run EDLS Scheduled Out of Population for assignments dated today or later.</p>
      <h3>Before you start</h3><p>Administrator access and EDLS are required. Population membership differs from a worker's final response or general eligibility.</p>
      <h3>How to use this page</h3><ol><li>Open a saved run or create the report.</li><li>Run and inspect the reported worker and sheet.</li><li>Check current population and sheet evidence before any separate assignment action.</li></ol>
      <h3>Limitations and common problems</h3><p>This does not scan all historical assignments or cancel work. A changed population can leave existing future assignments needing staff review; do not infer a worker declined from this finding.</p>`,
  },
  {
    id: "system:election-only-one-report",
    paths: ["/reports/report_elections_only_one_violations"],
    summary: "Find elections with multiple benefits of a currently single-choice benefit type, reviewing historical context before changing an election or shared definition.",
    details: `
      <h3>Purpose</h3><p>Identify elections violating current Only one of this type settings.</p>
      <h3>Before you start</h3><p>Administrator access and Benefits are required. This checks current, ended, and future elections against today's benefit-type settings.</p>
      <h3>How to use this page</h3><ol><li>Open or create Only-One Election Violations.</li><li>Continue through Inputs and Run.</li><li>Inspect the election and type definition before any authorized correction.</li></ol>
      <h3>Limitations and common problems</h3><p>A finding does not establish that a historical election was invalid under the rules then in effect. The report does not rewrite elections or recalculate coverage.</p>`,
  },
  {
    id: "system:gbhet-legal-report",
    paths: ["/reports/report_gbhet_legal_compliance"],
    summary: "Compare qualifying GBHET work months with recorded legal-benefit coverage three months later, reviewing missing evidence before drawing compliance conclusions.",
    details: `
      <h3>Purpose</h3><p>Find workers with at least 80 work-month hours missing the legal benefit after the three-month lag.</p>
      <h3>Before you start</h3><p>Administrator access, GBHET Legal, and required source-query availability are needed. This is the implemented report criterion, not a general benefit-policy statement.</p>
      <h3>How to use this page</h3><ol><li>Check From Work Month and To Work Month in YYYY-MM format; blanks include all months.</li><li>Run and inspect the source work month and resulting benefit month, such as January work to April benefit.</li><li>Review actual hours and coverage evidence before any separately authorized repair.</li></ol>
      <h3>Limitations and common problems</h3><p>The report does not grant benefits or certify legal compliance. Missing or stale source data can produce findings requiring investigation.</p>`,
  },
  {
    id: "system:employer-user-report",
    paths: ["/reports/report_employer_users"],
    summary: "Review employer-linked user accounts and access evidence, protecting exported account details and distinguishing contacts from actual sign-in users.",
    details: `
      <h3>Purpose</h3><p>Produce the employer-user report from linked account evidence.</p>
      <h3>Before you start</h3><p>Administrator access and required source-query availability are needed. Links do not replace the user's roles or organization scope checks.</p>
      <h3>How to use this page</h3><ol><li>Review existing runs or create the report.</li><li>Run with the offered inputs and inspect linked user/employer results.</li><li>Protect any downloaded account data.</li></ol>
      <h3>Limitations and common problems</h3><p>An employer contact without a linked user is not automatically a sign-in account. A report row does not prove a person recently signed in or can access every employer.</p>`,
  },
  {
    id: "system:btu-invalid-cardcheck-report",
    paths: ["/reports/report_btu_workers_invalid_cardcheck"],
    summary: "Review BTU workers whose cardcheck evidence does not satisfy the report criteria, checking the selected population and actual signed records before correction.",
    details: `
      <h3>Purpose</h3><p>Identify cardcheck evidence needing review for the BTU report population.</p>
      <h3>Before you start</h3><p>Administrator access, BTU, and required source-query availability are needed. Select a cardcheck definition; the optional employer filter narrows the population. This checks whether recorded answers still satisfy the selected definition.</p>
      <h3>How to use this page</h3><ol><li>On Inputs, choose the required definition and optional employer.</li><li>Run and review the worker, bargaining-unit, and cardcheck evidence in the results.</li><li>Check the original answers and signature evidence before any authorized correction.</li></ol>
      <h3>Limitations and common problems</h3><p>A finding is not permission to fabricate a signature or copy one from another worker. The report does not import, sign, or delete cardchecks.</p>`,
  },
];
