import type { SystemHelpEntry } from "./index";

export const workerBenefitsSummaryHelp: SystemHelpEntry = {
  id: "system:worker-benefits-summary",
  paths: ["/workers/%/benefits/summary"],
  summary: "Review monthly coverage decisions, subscriber benefits, work-month evidence, and the dependents recorded through this worker.",
  details: `
    <h3>Purpose</h3>
    <p>Use the Benefits Summary monthly history to review recorded coverage without changing benefits, eligibility, scans, or charges.</p>
    <h3>Before you start</h3>
    <p>You need access to this worker's Benefits Summary. Available evidence determines which details can be shown.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Expand a monthly coverage span to see its recorded evidence.</li>
      <li>Select a coverage month to see subscriber benefits, hours from three months earlier, and the dependents evidenced for that month.</li>
      <li>Select <strong>Load older months</strong> to extend the loaded history.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p><strong>Active</strong> means positive coverage is recorded. <strong>Inactive</strong> means a completed scan decision or verified imported history without recorded positive coverage. Imported months say <strong>Imported coverage history — scanned in the previous system.</strong> This is a previous-system explanation, not a newly run scan.</p>
    <p><strong>Unenrolled</strong> means the scan's sole recorded failure is <strong>No Election</strong>. Missing benefits or hours alone never establish this status.</p>
    <p>Consecutive Inactive months can combine imported history and scan decisions. The span identifies imported month counts and scan reasons by month; select a month for its own explanation.</p>
    <p>Each dependent appears once in the loaded span, by name and retained relationship label, even when benefits change or appearances are separated. The selected month lists only dependents evidenced for that month. Individual dependent dates, ranges, and benefits are not shown; subscriber benefits remain separate.</p>
    <h3>Limitations and common problems</h3>
    <p><strong>Scan pending</strong> means a scan is still in progress. <strong>Coverage unavailable</strong> means reliable decision evidence is missing, unreadable, or could not be loaded. Neither is an inactive coverage decision. Missing import provenance, incomplete imports, unavailable source evidence, or months outside verified imported history cannot establish a previous-system decision.</p>
    <p>An empty recorded dependent list differs from unavailable evidence. Lists can be incomplete when months have not loaded or dependent evidence is unavailable. Names and relationship labels use retained metadata, not historical identity snapshots. Dependents in a span need not be covered every month.</p>
    <p>If loading fails, use <strong>Retry</strong>. Work hours alone do not decide coverage, and missing history must not be interpreted as a negative decision.</p>
  `,
};
