import type { SystemHelpEntry } from "./index";

export const baoConfigurationHelp: SystemHelpEntry[] = [
  {
    id: "system:bao-member-thresholds",
    paths: ["/config/trust/sitespecific/bao/thresholds"],
    summary: "Set whole-hour thresholds by member status and review the affected eligibility rules before changing values used in future calculations.",
    details: `
      <h3>Purpose</h3><p>Maintain BAO member-status hours thresholds.</p>
      <h3>Before you start</h3><p>Administrator access and BAO are required. Use approved thresholds, not values invented from an individual worker's desired result.</p>
      <h3>How to use this page</h3><ol><li>Find the intended member status.</li><li>Enter a valid whole number in Hours Threshold.</li><li>Check the row and its validation message before saving.</li></ol>
      <h3>Limitations and common problems</h3><p>Saving changes a calculation input, not a worker's recorded coverage. Different work and coverage months must still be respected. Review later scan evidence before concluding all affected months were recalculated.</p>`,
  },
  {
    id: "system:bao-employer-rates",
    paths: ["/config/sitespecific/bao/employer-rates", "/config/sitespecific/bao/rate-sources", "/config/sitespecific/bao/rate-sources/%/rates"],
    summary: "Maintain effective-dated employer fund rates and source groupings, checking employer, account, source, and date before bulk changes.",
    details: `
      <h3>Purpose</h3><p>Manage employer rates and reusable rate sources for fund-account calculations.</p>
      <h3>Before you start</h3><p>Administrator access and BAO are required. Verify the intended employers, fund accounts, and source evidence before editing rates.</p>
      <h3>How to use this page</h3><ol><li>Use View, Employer, Fund (Account), Source, and effective-date filters to inspect existing entries.</li><li>Open the relevant source's Rates when maintaining a shared source.</li><li>Before <strong>Bulk Add / Update Rates</strong>, review every selected employer, fund rate, Effective Date, and optional Source.</li><li>Save and inspect the resulting dated entries.</li></ol>
      <h3>Limitations and common problems</h3><p>Shared sources and bulk edits can affect many employers. Deleting or changing historical rates can alter later reconstruction or billing. Saving does not prove old ledger entries were recalculated; inspect the actual consuming upload or charge results.</p>`,
  },
  {
    id: "system:bao-cobra-rates",
    paths: ["/config/sitespecific/bao/cobra-rates"],
    summary: "Maintain dated monthly COBRA rates by benefit and covered-lives tier without confusing rate configuration with billing or paid coverage.",
    details: `
      <h3>Purpose</h3><p>Define monthly continuation premiums used by COBRA consumers.</p>
      <h3>Before you start</h3><p>Administrator access and BAO are required. Benefit and covered-lives definitions must match the actual case and election.</p>
      <h3>How to use this page</h3><ol><li>Filter by Benefit and Covered Lives.</li><li>Review existing effective dates before Add COBRA Rate or editing.</li><li>Set Monthly Rate ($) and Effective Date for the intended tier.</li><li>Before deleting a rate, review periods and cases that may still need it.</li></ol>
      <h3>Results and status meanings</h3><p>Lookups use the applicable dated rate. A configured rate is not a posted case premium, allocated payment, or proof of monthly benefit coverage.</p>
      <h3>Limitations and common problems</h3><p>Missing rates require configuration review, not an assumption of no charge. Saving a rate does not prove historical obligations or case statuses have already reconciled.</p>`,
  },
  {
    id: "system:bao-dp-rates",
    paths: ["/config/sitespecific/bao/dp-rates"],
    summary: "Set dated Domestic Partner member charges by benefit and tier transition, distinguishing confirmed zero rates from provisional placeholders.",
    details: `
      <h3>Purpose</h3><p>Maintain monthly amounts collected from members, not the imputed-income figure, which is never charged.</p>
      <h3>Before you start</h3><p>Administrator access and BAO are required. Verify the benefit and actual coverage-tier transition. The page explains how Step Child and other dependent relationships contribute to each transition.</p>
      <h3>How to use this page</h3><ol><li>Review the transition descriptions and existing dated rates.</li><li>Select Benefit and Transition.</li><li>Enter Monthly Member Charge ($), Effective Date, and the intended Provisional state.</li><li>Check affected months before saving or deleting a row.</li></ol>
      <h3>Results and status meanings</h3><p>Lookups use the latest rate on or before the date in question. A confirmed $0.00 means no charge for that transition. Provisional rows are placeholders, not confirmed values, and are never billed or waived.</p>
      <h3>Limitations and common problems</h3><p>Missing or provisional rates are not evidence that coverage is free. Changing rates does not authorize removing surviving posted charges or prove historical billing has been recomputed.</p>`,
  },
  {
    id: "system:bao-provider-premium-rates",
    paths: ["/config/sitespecific/bao/premium-rates"],
    summary: "Maintain effective-dated provider premium amounts by benefit and coverage tier, separately from member Domestic Partner charges and COBRA billing.",
    details: `
      <h3>Purpose</h3><p>Set monthly provider premiums used by premium accounting and file workflows.</p>
      <h3>Before you start</h3><p>Administrator access and BAO are required. Check the approved benefit, coverage tier, amount, and period.</p>
      <h3>How to use this page</h3><ol><li>Filter by Benefit and Coverage Tier.</li><li>Review existing dates before adding or editing a rate.</li><li>Set Monthly Premium ($) and Effective Date.</li><li>Review downstream premium evidence before deleting historical rates.</li></ol>
      <h3>Limitations and common problems</h3><p>Provider premiums are not automatically the amount a member owes. Saving rates does not generate a premium file or prove old financial entries were recalculated. Missing rates need review before file generation.</p>`,
  },
  {
    id: "system:bao-premium-files",
    paths: ["/config/sitespecific/bao/premium-files", "/trust/provider/%/premium-files"],
    summary: "Review premium files before generation, which snapshots unpaid provider months and posts offsetting entries rather than merely downloading a report.",
    details: `
      <h3>Purpose</h3><p>Review generated provider premium files and their retained payment evidence.</p>
      <h3>Before you start</h3><p>BAO staff access is required. Verify provider, ledger account, configured rates, and unpaid premium evidence. Generation is a consequential financial action.</p>
      <h3>How to use this page</h3><ol><li>Filter existing files by Provider and inspect prior file contents first.</li><li>Before <strong>Generate File</strong>, check the provider and Ledger Account in the confirmation.</li><li>Generate only when authorized: this snapshots every unpaid premium month for that provider/account and posts offsetting entries to mark those months paid.</li><li>Review and securely download the saved file.</li></ol>
      <h3>Results and status meanings</h3><p>Months already included in a file are protected against double payment by this process. Generation is not proof of an external bank transfer or provider receipt.</p>
      <h3>Limitations and common problems</h3><p>Do not generate another file solely because a download failed. Open the existing saved file and inspect posted entries. Missing or disputed premiums need reconciliation before generation, not an invented rate.</p>`,
  },
  {
    id: "system:bao-distance-cache",
    paths: ["/config/sitespecific/bao/distance-cache"],
    summary: "Inspect cached BAO distance results and review maintenance consequences without treating missing coordinates or distances as confirmed eligibility evidence.",
    details: `
      <h3>Purpose</h3><p>Review retained distance lookup information used by distance-dependent calculations.</p>
      <h3>Before you start</h3><p>Administrator access and BAO are required. Source addresses and usable map coordinates are prerequisites for meaningful distance evidence.</p>
      <h3>How to use this page</h3><ol><li>Inspect the relevant cached result and its source records.</li><li>Check missing addresses or coordinates before any maintenance action.</li><li>Before clearing cached data, review that later consumers may need another lookup.</li></ol>
      <h3>Limitations and common problems</h3><p>A missing cache entry is not a confirmed zero distance. Cache maintenance is not a policy change or an immediate coverage decision. Do not invoke paid or network lookups simply to verify this documentation.</p>`,
  },
  {
    id: "system:bao-cobra-triggers",
    paths: ["/config/sitespecific/bao/cobra-triggers"],
    summary: "Choose which medical or dental eligibility failures can open COBRA cases and check relationship scope before saving automatic trigger rules.",
    details: `
      <h3>Purpose</h3><p>Configure the qualifying failure reasons used when medical or dental coverage ends.</p>
      <h3>Before you start</h3><p>Administrator access and BAO are required. Failure-to-pay reasons are excluded by default. Use verified qualifying-event policy rather than inferring it from this help.</p>
      <h3>How to use this page</h3><ol><li>Review enabled failure reasons.</li><li>Map a qualifying event where needed for auto-created cases.</li><li>Review relationship scope: unrestricted includes all elected covered people; a restricted rule includes only selected qualifying relationships.</li><li>Check effects before <strong>Save</strong>.</li></ol>
      <h3>Limitations and common problems</h3><p>Saving a trigger does not post a COBRA election, collect premiums, or prove existing cases changed. A qualifying failure and an active-case conflict must be investigated through the actual case workflow.</p>`,
  },
  {
    id: "system:bao-immediate-eligibility",
    paths: ["/employers/%/sitespecific-bao-immediate-eligibility"],
    summary: "Review the employer's dated Immediate Eligibility period before adding, changing, or clearing an exception used by later eligibility checks.",
    details: `
      <h3>Purpose</h3><p>Maintain the BAO Immediate Eligibility period attached to this employer.</p>
      <h3>Before you start</h3><p>BAO staff access is required. Confirm the employer and authorized start/end dates.</p>
      <h3>How to use this page</h3><ol><li>Review Start Date and End Date.</li><li>Use the offered add or edit control for the intended period.</li><li>Before <strong>Clear Immediate Eligibility</strong>, review the effect of removing that period.</li></ol>
      <h3>Limitations and common problems</h3><p>This exception is not itself an election or a guarantee of all benefits. A save or clear does not prove historical scans have finished; review affected worker evidence separately.</p>`,
  },
];
