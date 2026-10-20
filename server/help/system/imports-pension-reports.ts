import type { SystemHelpEntry } from "./index";

export const importsPensionReportsHelp: SystemHelpEntry[] = [
  {
    id: "system:btu-reference-maintenance",
    paths: ["/sitespecific/btu/csgs", "/sitespecific/btu/csgs/new", "/sitespecific/btu/csg/%", "/sitespecific/btu/employer-map", "/sitespecific/btu/territories", "/sitespecific/btu/school-types", "/sitespecific/btu/regions"],
    summary: "Maintain BTU reference records and employer mappings, checking shared uses before changes affect organizing views, imports, or class-size grievance records.",
    details: `
      <h3>Purpose</h3><p>Review BTU CSG records, geographic lists, school types, and employer mappings.</p>
      <h3>Before you start</h3><p>BTU and administrator access are required at these launch pages; individual CSG tabs have additional view/edit policies. Use verified local definitions for geographic and school classifications.</p>
      <h3>How to use this page</h3><ol><li>Open the intended reference list or CSG record.</li><li>Check existing identifiers and employer links before creating another entry.</li><li>Review shared import and organizing uses before saving or deleting mappings.</li></ol>
      <h3>Limitations and common problems</h3><p>An employer mapping is not an employment assignment by itself. Changing shared reference data does not prove old imports were rerun. Fix unmatched mappings against source identifiers rather than guessing from a similar name.</p>`,
  },
  {
    id: "system:btu-worker-import",
    paths: ["/sitespecific/btu/worker-import"],
    summary: "Prepare a BTU worker roster import, reviewing employer mappings, the as-of date, and termination-by-absence before processing employment changes.",
    details: `
      <h3>Purpose</h3><p>Import workers and employment records from a BTU roster.</p>
      <h3>Before you start</h3><p>Administrator access, BTU, a supported input file, and correct employer mappings are required. Inspect existing runs before creating another.</p>
      <h3>How to use this page</h3><ol><li>Open the existing run or launch a new import.</li><li>Upload the roster and use <strong>Map Columns</strong> to check each source field.</li><li>On Configure, verify <strong>As-of Date</strong> and <strong>Terminate workers not present in this file</strong>.</li><li>Before Process, confirm the file is complete for the matched employers: when termination-by-absence is on, absent active workers can be terminated as of that date.</li><li>Review unmatched and processed results before any offered reprocessing.</li></ol>
      <h3>Limitations and common problems</h3><p>Validation is not posting. A partial roster must not be treated as a complete absence report. Correct employer mapping and worker identity issues before reprocessing unmatched rows; an uncertain run needs reconciliation, not a duplicate upload.</p>`,
  },
  {
    id: "system:btu-cardcheck-import",
    paths: ["/sitespecific/btu/cardcheck-import"],
    summary: "Import BTU cardcheck records using the selected definition and BPS employee identifiers, reviewing validation and unmatched workers before processing.",
    details: `
      <h3>Purpose</h3><p>Load cardcheck records from a supported file.</p>
      <h3>Before you start</h3><p>Administrator access, BTU, required source lookup availability, and an existing cardcheck definition are needed.</p>
      <h3>How to use this page</h3><ol><li>Review existing runs before launching an import.</li><li>Upload the file and check <strong>Map Columns</strong> against the actual source headers.</li><li>Choose the intended cardcheck definition on Configure.</li><li>Review validation and BPS employee ID matching before Process creates records.</li><li>Inspect saved results and unmatched rows.</li></ol>
      <h3>Limitations and common problems</h3><p>Do not substitute another identifier type for a missing BPS match. Validation does not obtain a signature or prove all rows posted. Review existing cardchecks before retrying failed or unmatched work.</p>`,
  },
  {
    id: "system:btu-signature-import",
    paths: ["/sitespecific/btu/cardcheck-sig-import"],
    summary: "Preview ZIP signature-file matches by BPS employee ID before importing signatures for the selected BTU cardcheck definition.",
    details: `
      <h3>Purpose</h3><p>Attach signed cardcheck evidence from a ZIP containing signature PDFs.</p>
      <h3>Before you start</h3><p>Administrator access, BTU, the correct cardcheck definition, and supported signature files are required. File names must be interpretable by the import's BPS identifier matching.</p>
      <h3>How to use this page</h3><ol><li>Upload the ZIP in the saved wizard.</li><li>Select the definition on Configure.</li><li>Review Preview for matched and unmatched files and existing cardcheck or signature evidence.</li><li>Before Process, verify the matches; processing imports signatures and creates records.</li><li>Inspect per-file results rather than assuming every ZIP member was accepted.</li></ol>
      <h3>Limitations and common problems</h3><p>Re-uploading invalidates the prior preview. No matched files cannot be processed. Correct file identity and existing-evidence conflicts before retrying; never attach a signature to a similarly named worker to force a match.</p>`,
  },
  {
    id: "system:btu-cardcheck-scraper",
    paths: ["/sitespecific/btu/cardcheck-scrape-import"],
    summary: "Review the selected cardcheck definition before a BTU scraper run fetches remote PDFs and creates signature evidence.",
    details: `
      <h3>Purpose</h3><p>Run the configured remote cardcheck evidence import.</p>
      <h3>Before you start</h3><p>Administrator access, BTU, configured external access, and the correct definition are required. Do not place external credentials in help or wizard notes.</p>
      <h3>How to use this page</h3><ol><li>Review prior runs and select the intended definition in Configure.</li><li>Before Process, understand that the run contacts a remote service, fetches documents, and writes signature/cardcheck evidence.</li><li>Review progress and saved row results.</li></ol>
      <h3>Limitations and common problems</h3><p>A network failure can leave partial work. Inspect existing imported evidence before retrying. This is not a consequence-free connectivity test, and it does not create a new signature by the worker.</p>`,
  },
  {
    id: "system:btu-building-rep-import",
    paths: ["/sitespecific/btu/building-rep-import"],
    summary: "Preview worker matches in a BTU building-representative CSV before processing new steward assignments and reviewing duplicate or unmatched results.",
    details: `
      <h3>Purpose</h3><p>Create steward assignments for matched building representatives.</p>
      <h3>Before you start</h3><p>Administrator access, BTU, supported CSV data, and usable worker and employer identities are required.</p>
      <h3>How to use this page</h3><ol><li>Open an existing run or start a new one.</li><li>Upload the expected building-representative CSV.</li><li>Review Preview, including matched and unmatched workers.</li><li>Before Process, verify each intended employer/worker association.</li><li>Review created, already-assigned, unmatched, and error results.</li></ol>
      <h3>Limitations and common problems</h3><p>Processing creates steward assignments, not merely a report. Existing assignments can be recognized as duplicates. Resolve source identifiers rather than using repeated processing to create another assignment.</p>`,
  },
  {
    id: "system:btu-dues-import",
    paths: ["/sitespecific/btu/dues-allocation"],
    summary: "Validate dues deduction mappings and worker matches before processing an import that creates payments and ledger records.",
    details: `
      <h3>Purpose</h3><p>Import dues deductions matched to workers and compare the resulting allocation evidence.</p>
      <h3>Before you start</h3><p>Administrator access, BTU, required source lookup availability, and the BTU dues charge-plugin configuration are needed. The target account comes from that configuration, not a wizard account selector.</p>
      <h3>How to use this page</h3><ol><li>Review previous runs for this file and period.</li><li>Upload and check <strong>Map Columns</strong> against the dues fields.</li><li>Review validation, monetary values, and worker matching.</li><li>Before Process, confirm the financial target: processing creates payment and ledger records.</li><li>Review results and any offered comparison rescan.</li></ol>
      <h3>Limitations and common problems</h3><p>A comparison rescan is not permission to repost the file. Investigate unmatched rows, wrong accounts, or partial effects before another processing attempt. Recording deductions is not charging a worker's bank account.</p>`,
  },
  {
    id: "system:pension-calculation",
    paths: ["/workers/%/vdb-pension", "/sitespecific/gbhet/pension/payout-calculator", "/sitespecific/gbhet/pension/annual-summaries"],
    summary: "Review pension evidence and calculated benefits using the correct plan year and dates, keeping calculations separate from an approved payable benefit.",
    details: `
      <h3>Purpose</h3><p>Review worker pension information, annual rollups, and payout calculations.</p>
      <h3>Before you start</h3><p>Staff access and GBHET Pension are required. Calculations depend on work evidence and configured plan years, employer plans, accruals, benefit schedules, share values, and actuarial factors.</p>
      <h3>How to use this page</h3><ol><li>Select the intended worker or plan year.</li><li>For the calculator, check <strong>Date of Benefit Commencement (DoBC)</strong> and any termination, payment, spouse-birth, retirement-reason, and factor-year inputs.</li><li>Select <strong>Calculate All Benefits</strong> only after checking the inputs.</li><li>Review component results and warnings against the underlying plan evidence.</li></ol>
      <h3>Limitations and common problems</h3><p>A calculation is not approval, an actual payout, or a guarantee of entitlement. A zero or missing summary may reflect incomplete source data or uncomputed rollups. Ask authorized staff to investigate missing factors rather than changing dates to obtain a desired amount.</p>`,
  },
  {
    id: "system:pension-configuration",
    paths: ["/sitespecific/gbhet/pension/plan-years", "/sitespecific/gbhet/pension/employer-plans", "/sitespecific/gbhet/pension/accrual-tiers", "/sitespecific/gbhet/pension/benefit-schedules", "/sitespecific/gbhet/pension/actuarial-factors", "/sitespecific/gbhet/pension/share-values"],
    summary: "Maintain pension calculation inputs and effective plan data, reviewing existing summaries before shared changes or batch computation.",
    details: `
      <h3>Purpose</h3><p>Configure plan-year methods, employer plans, accrual tiers, schedules, factors, and share values used by pension calculations.</p>
      <h3>Before you start</h3><p>Administrator access and GBHET Pension are required. Use the actual governing plan values; this help does not supply pension policy.</p>
      <h3>How to use this page</h3><ol><li>Choose the table and plan year relevant to the calculation.</li><li>Review existing effective data before adding or changing a value.</li><li>Check method-specific fields, qualification hours, percentages, and share values where offered.</li><li>Before <strong>Batch SLA and Shares Computation</strong>, review the confirmation and selected year; computation writes derived pension results.</li></ol>
      <h3>Limitations and common problems</h3><p>Changing a table does not prove every existing summary has been recomputed. Deleting plan data can affect many calculations. Resolve missing dependencies before rerunning a batch; do not invent a rate to make a calculation complete.</p>`,
  },
  {
    id: "system:reports-and-exports",
    paths: ["/reports", "/reports/%"],
    summary: "Choose an authorized report, review its inputs and saved runs, and protect personal or financial information in downloaded results.",
    details: `
      <h3>Purpose</h3><p>Use report groups and report-type pages to find available reports and reopen prior wizard runs.</p>
      <h3>Before you start</h3><p>Report access varies: many reports require administrator access, while some staff exports and site reports have their own policies and components. Availability is not universal.</p>
      <h3>How to use this page</h3><ol><li>Choose the report for your actual question and read its description.</li><li>Review prior runs before creating another.</li><li>Check the report's period, population, and inputs before running it.</li><li>Inspect result warnings, unmatched records, and counts before downloading or acting on the data.</li></ol>
      <h3>Results and status meanings</h3><p>A completed report describes its selected data and time, not a live guarantee of coverage, compliance, or payment. The shared wizard preserves run and download results; a failed download does not necessarily mean the report failed.</p>
      <h3>Limitations and common problems</h3><p>Report exports can contain sensitive identities and financial amounts. Check scope before downloading, store securely, and do not send them to unapproved recipients. A missing type may reflect access or configuration. Type-specific parameters belong to that report's inputs, not a generic wizard ID.</p>`,
  },
  {
    id: "system:contact-export",
    paths: ["/reports/contact-export"],
    summary: "Export contact information for workers matched by the selected identifier type and uploaded file, reviewing unmatched IDs and download scope.",
    details: `
      <h3>Purpose</h3><p>Match uploaded identifiers to workers and download their contact data.</p>
      <h3>Before you start</h3><p>Authorized staff access, an offered worker ID type, and a supported input file are required. The result contains sensitive personal information.</p>
      <h3>How to use this page</h3><ol><li>Select the identifier type actually present in the file.</li><li>Choose the intended file and check its population before exporting.</li><li>Review matched and unmatched counts and any unmatched identifiers.</li><li>Keep the resulting CSV in an approved location.</li></ol>
      <h3>Limitations and common problems</h3><p>No matches produces no contact download. Check identifier type and source formatting before retrying; do not change type just to obtain similarly named people. This export does not create workers or update their contact records.</p>`,
  },
];
