import type { SystemHelpEntry } from "./index";

export const additionalPluginKindHelp: SystemHelpEntry[] = [
  {
    id: "system:retention-plugin-configuration",
    paths: ["/admin/plugin-configs/data-retention"],
    summary: "Review retention plugin settings before enabling scheduled deletion of expired records or shortening the time evidence remains available.",
    details: `
      <h3>Purpose</h3><p>Configure the retention plugins run by the shared data-retention sweep.</p>
      <h3>Before you start</h3><p>Administrator access is required. Check the selected plugin's record domain and expiration rules; this is not a backup or archive service.</p>
      <h3>How to use this page</h3><ol><li>Select the intended plugin and review its existing settings.</li><li>Before enabling or changing retention, review the records that later sweeps can delete and applicable retention requirements.</li><li>Save only the authorized settings and inspect later sweep history.</li></ol>
      <h3>Limitations and common problems</h3><p>Saving does not mean the sweep ran. Deletion of retained reports, logs, or snapshots does not reverse the underlying business action. Do not shorten retention just to hide failed-run evidence.</p>`,
  },
  {
    id: "system:denorm-plugin-configuration",
    paths: ["/admin/plugin-configs/denorm"],
    summary: "Configure derived-data plugins without confusing enabled configuration with a completed rebuild or fresh evidence for every affected record.",
    details: `
      <h3>Purpose</h3><p>Maintain configurations for stored derived results.</p>
      <h3>Before you start</h3><p>Administrator access and the selected plugin's component are required. Review source data and dependent consumers before disabling a plugin.</p>
      <h3>How to use this page</h3><ol><li>Review the plugin and its supported settings.</li><li>Check enabled state and affected derived domain before saving.</li><li>Use Denorm administration to inspect pending work and supported rebuild actions.</li></ol>
      <h3>Limitations and common problems</h3><p>Disabling pauses processing rather than proving there is no stale work. Saving a configuration does not immediately recompute all records or establish correct source data.</p>`,
  },
  {
    id: "system:quicksearch-plugin-configuration",
    paths: ["/admin/plugin-configs/quicksearch"],
    summary: "Choose search capabilities and explicit audience roles carefully, because the offered roles control access to records returned by that searcher.",
    details: `
      <h3>Purpose</h3><p>Configure which quicksearch implementations are offered to specified roles.</p>
      <h3>Before you start</h3><p>Administrator access is required. Review the selected searcher's returned data before granting it to a role.</p>
      <h3>How to use this page</h3><ol><li>Select the searcher and inspect existing configurations.</li><li>Set <strong>Offered to roles</strong> to the intended nonempty audience.</li><li>Before saving or enabling, review the records that audience may see.</li></ol>
      <h3>Limitations and common problems</h3><p>There is no implicit everyone audience. Holding any offered role grants access to that searcher's returned records; do not assume an additional per-record filter will narrow every result. No offered configuration can legitimately mean no quicksearch results.</p>`,
  },
  {
    id: "system:worker-list-plugin-configuration",
    paths: ["/admin/plugin-configs/worker-list"],
    summary: "Maintain worker-list plugin behavior and overrides, checking selected accounts and definitions before changing how staff discover worker evidence.",
    details: `
      <h3>Purpose</h3><p>Configure the available worker-list implementations and their settings.</p>
      <h3>Before you start</h3><p>Administrator access is required. Optional account or definition choices depend on the plugin and enabled components.</p>
      <h3>How to use this page</h3><ol><li>Choose the list plugin and inspect current enabled configuration.</li><li>Review supported view settings and any account or definition overrides.</li><li>Save and inspect the intended filtered worker list.</li></ol>
      <h3>Limitations and common problems</h3><p>A list configuration changes presentation or filtering, not source worker history. A missing list result does not by itself prove negative evidence. Sensitive exports still need their own authorization and scope review.</p>`,
  },
  {
    id: "system:client-injection-configuration",
    paths: ["/admin/plugin-configs/client-injection"],
    summary: "Review supported browser script or style injection settings carefully, because enabled configurations can affect every visitor's browser.",
    details: `
      <h3>Purpose</h3><p>Maintain configurations for registered client-injection plugins.</p>
      <h3>Before you start</h3><p>Administrator access is required. Use only approved plugin settings and destinations; this page is not permission to insert unreviewed tracking or credentials.</p>
      <h3>How to use this page</h3><ol><li>Inspect the plugin and its existing settings.</li><li>Before enabling or changing it, review privacy, script, style, and site-wide effects.</li><li>Save the intended configuration and check affected presentation.</li></ol>
      <h3>Limitations and common problems</h3><p>Site-wide browser changes can affect users beyond your current session. More than one configuration can exist; ordering and the selected canonical configuration matter. Enabling an injection does not bypass the application's access policies.</p>`,
  },
  {
    id: "system:web-service-plugin-configuration",
    paths: ["/admin/plugin-configs/web-service"],
    summary: "Maintain incoming web-service configurations and stable public aliases while keeping client grants and operation-level authorization separate.",
    details: `
      <h3>Purpose</h3><p>Configure the registered services exposed to authorized external clients.</p>
      <h3>Before you start</h3><p>Administrator access is required. Review existing consumers before changing aliases, enabling a service, or removing a configuration.</p>
      <h3>How to use this page</h3><ol><li>Choose the service and review its supported schema.</li><li>Check enabled state and any offered public alias.</li><li>Review client access separately in Incoming Web Services.</li></ol>
      <h3>Limitations and common problems</h3><p>Configuration IDs differ between databases. A declared public alias can provide a stable address, but ambiguity is refused rather than silently selecting another configuration. Enabling a service does not authorize every client or prove a remote request succeeded.</p>`,
  },
  {
    id: "system:edi-plugin-configuration",
    paths: ["/admin/plugin-configs/trust-provider-edi"],
    summary: "Configure provider EDI benefit scope and delivery settings before generation or transfer, checking the actual selected population rather than provider-name assumptions.",
    details: `
      <h3>Purpose</h3><p>Maintain the EDI configurations consumed by generation and delivery wizards.</p>
      <h3>Before you start</h3><p>Administrator access and Providers EDI are required. Required file and destination settings depend on the selected EDI implementation.</p>
      <h3>How to use this page</h3><ol><li>Review the selected plugin and existing configurations.</li><li>Check benefit identifiers, period behavior, file settings, and destination.</li><li>Before enabling, verify the intended people and coverage scope.</li><li>Use the EDI dashboard to inspect saved generation or delivery runs.</li></ol>
      <h3>Limitations and common problems</h3><p>File population follows configured benefit scope, not an assumed provider-to-benefit relationship. Saving does not generate or transmit a file. A delivery run can contact another system; inspect results before retrying.</p>`,
  },
];
