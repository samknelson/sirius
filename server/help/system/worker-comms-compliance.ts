import type { SystemHelpEntry } from "./index";

export const workerCommsComplianceHelp: SystemHelpEntry = {
  id: "system:worker-comms-compliance",
  paths: ["/workers/comms-compliance"],
  summary: "Find workers with or without matching tagged communications using saved population and communication criteria, then prepare recipients for a draft message.",
  details: `
    <h3>Purpose</h3>
    <p>Compare a worker population with recorded communication evidence. Each worker appears once; one communication must meet all selected communication criteria.</p>
    <h3>Before you start</h3>
    <p>You need staff access and the Worker Comms Compliance component enabled. Only admins can create, edit, or delete definitions. Bulk handoff also requires Bulk Messaging and bulk-message access. Benefit, bargaining-unit, and representative filters require their corresponding components.</p>
    <h3>How to use this page</h3>
    <ol>
      <li>Choose a saved definition. Admins can use <strong>New definition</strong> to choose population filters, a communication tag, statuses, channel, and sent dates.</li>
      <li>Choose <strong>Everyone</strong>, <strong>With evidence</strong>, or <strong>Missing</strong>. Choices within member statuses or benefits are alternatives; different population filters must all match.</li>
      <li>Review the counts and pages. Benefit membership uses monthly facts: current month (the default), ever through the current month, the current month plus the preceding N minus one months, or any month overlapping an inclusive date range. One qualifying month suffices; continuous coverage is not required. Future-only facts do not qualify for ever.</li>
      <li>Before adding recipients, review the population and view carefully. Select rows or all matching workers, then use <strong>Bulk Action</strong> to create a new draft or add to an existing eligible draft. Existing draft content and channels remain unchanged. Neither action sends a message.</li>
    </ol>
    <h3>Results and status meanings</h3>
    <p>The with and without counts sum to the population. Communication sent-date boundaries include both calendar days and affect evidence only, not benefit membership. Dates use the site's calendar; a monthly fact cannot establish an exact day of coverage. The newest matching communication is shown.</p>
    <p>Queued is not proof of delivery; offline records are not proof of physical receipt. Other statuses describe recorded communication processing, not proof that a person read a message.</p>
    <h3>Limitations and common problems</h3>
    <p>If a selected option disappears or its component is disabled, the report refuses to run rather than dropping that filter. Ask an admin to edit the definition. Refresh and select again when workers no longer match at handoff. Existing messages must still be drafts with channels and no delivery started; duplicate recipient/channel entries are skipped. Deleting a definition does not delete communications or drafts already created.</p>
  `,
};
