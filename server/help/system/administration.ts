import type { SystemHelpEntry } from "./index";

export const administrationHelp: SystemHelpEntry[] = [
  {
    id: "system:configuration-navigation",
    paths: ["/config", "/config/catalogs", "/config/catalogs/%"],
    summary: "Find available configuration areas and inspect code-defined catalogs, recognizing that visible choices depend on access and enabled components.",
    details: `
      <h3>Purpose</h3><p>Use Config to find settings and Catalogs to inspect the choices and capabilities registered by the application.</p>
      <h3>Before you start</h3><p>Administrator access is required for these pages. Individual destinations retain their own gates. A catalog describes registered capabilities; it is not the same as an editable dropdown list.</p>
      <h3>How to use this page</h3><ol><li>Choose the configuration section for the behavior you intend to change.</li><li>Inspect a catalog's entries and descriptions before opening a related editor.</li><li>Use Dropdown Lists for editable options, not Catalogs for creating new code-defined plugin kinds.</li></ol>
      <h3>Limitations and common problems</h3><p>Loading or Couldn't load is not an empty catalog. Retry the read or ask an administrator to investigate. A missing navigation item may reflect access or a disabled component rather than missing records.</p>`,
  },
  {
    id: "system:dropdown-options",
    paths: ["/config/options", "/config/options/%/list", "/config/options/%/export", "/config/options/%/import"],
    summary: "Maintain a specific dropdown list and preview imports before applying creates, updates, or deletion of records missing from the file.",
    details: `
      <h3>Purpose</h3><p>Review the offered option lists and maintain choices for the selected type.</p>
      <h3>Before you start</h3><p>Administrator access and the list's required component are needed. Some lists use their own dedicated page; do not assume every catalog entry is editable through the generic editor.</p>
      <h3>How to use this page</h3><ol><li>Confirm the list type and existing identifiers before adding or editing a choice.</li><li>Before exporting, review whether the selected list contains sensitive local configuration.</li><li>For import, select intended Create new records and Update matched records options, then inspect Preview.</li><li>Before enabling <strong>Delete records missing from the file</strong>, verify the file is complete: applying can permanently remove omitted choices.</li><li>Apply only the reviewed plan and inspect results.</li></ol>
      <h3>Limitations and common problems</h3><p>A preview does not write changes. Shared choices can be referenced by many records; deleting or changing them can alter offered workflows or be refused by references. Do not import one list's file into another type.</p>`,
  },
  {
    id: "system:entity-files-configuration",
    paths: ["/config/entity-files"],
    summary: "Configure each attachment area with its own filesystem, directory, and extension rules before enabling uploads or changing record-tab availability.",
    details: `
      <h3>Purpose</h3><p>Maintain the file areas used by entity attachments and published template images.</p>
      <h3>Before you start</h3><p>Administrator access and an available configured filesystem are required. Each area's component and Configured switch determine availability.</p>
      <h3>How to use this page</h3><ol><li>Find the intended entity area, such as Payments or Payment Batches.</li><li>Choose Filesystem and set Directory using the tokens offered for that area.</li><li>Set Allowed extensions and review the Configured switch before saving.</li><li>For published template images, follow the public-storage and reachable HTTPS requirements shown on the card.</li></ol>
      <h3>Results and status meanings</h3><p>Disabling an area can hide its tab and refuse its routes. Existing migrated attachments may remain readable even when new-upload prerequisites are missing. Published images are immutable retained assets, including uploads from canceled edits.</p>
      <h3>Limitations and common problems</h3><p>Changing configuration does not move or repair every existing stored object. Published images accept PNG/JPEG up to 1 MB and must remain reachable by recipients. Do not delete published assets because a draft no longer uses them.</p>`,
  },
  {
    id: "system:entity-notes-configuration",
    paths: ["/config/entity-notes"],
    summary: "Enable notes for the intended entity areas and check applicable note types before changes hide or expose note workflows.",
    details: `
      <h3>Purpose</h3><p>Control where the Entity Notes framework is available.</p>
      <h3>Before you start</h3><p>Administrator access is required. Notes also need types configured for the intended record context.</p>
      <h3>How to use this page</h3><ol><li>Review the entity area and its component availability.</li><li>Change only the intended area's configured state.</li><li>Save and check the relevant record's Notes tab.</li></ol>
      <h3>Limitations and common problems</h3><p>Disabling an area hides its tab and refuses its routes; it is not a deletion of all notes. A missing type can prevent authoring even when the area is enabled. Configure the applicable type rather than borrowing one meant for another entity.</p>`,
  },
  {
    id: "system:contact-field-configuration",
    paths: ["/config/addresses", "/config/phone-numbers"],
    summary: "Review shared contact-field settings before changes affect address or phone entry and validation across linked records.",
    details: `
      <h3>Purpose</h3><p>Maintain the contact settings offered for postal addresses and phone numbers.</p>
      <h3>Before you start</h3><p>Administrator access is required. These are shared settings, not an editor for one worker's contact details.</p>
      <h3>How to use this page</h3><ol><li>Read the current settings and their field descriptions.</li><li>Review the population affected before saving a shared change.</li><li>Use an entity's contact tabs for individual corrections.</li></ol>
      <h3>Limitations and common problems</h3><p>Configuration does not verify every existing contact or establish communication consent. Address or phone validation failures should be checked against the actual input and supported formats.</p>`,
  },
  {
    id: "system:users-roles-policies",
    paths: ["/admin/users/list", "/admin/users/roles", "/admin/users/policies", "/admin/roles", "/admin/permissions", "/config/users/list", "/config/users/roles", "/config/users/policies", "/config/users/permissions"],
    summary: "Review users, roles, permissions, and access policies before changing shared access that may affect many accounts.",
    details: `
      <h3>Purpose</h3><p>Manage user accounts and role assignments and inspect the application's permission and access-policy definitions.</p>
      <h3>Before you start</h3><p>Administrator access is required. Roles group permissions; policies also evaluate record scope and other requirements. Viewing a definition is not authority to edit that definition.</p>
      <h3>How to use this page</h3><ol><li>Confirm the intended user or role.</li><li>Review existing assignments and affected accounts.</li><li>Before changing active state or permissions, preserve a known authorized administrator path so staff are not locked out.</li><li>Use Permissions for role-permission assignments and read the dedicated assignment help there.</li></ol>
      <h3>Limitations and common problems</h3><p>A permission does not override a disabled component or a record-specific policy. Changes can affect more than one user. Do not assume the application prevents every last-administrator lockout; check your approved recovery arrangements before removing access.</p>`,
  },
  {
    id: "system:session-flood-administration",
    paths: ["/admin/users/sessions", "/config/users/sessions", "/admin/users/flood-events", "/admin/users/flood-events/config"],
    summary: "Review sign-in sessions and rate-limit events before removing sessions or changing flood controls that protect application access.",
    details: `
      <h3>Purpose</h3><p>Inspect sessions and flood events, which record activity used by configured rate limits.</p>
      <h3>Before you start</h3><p>Administrator access is required. Distinguish a legitimate blocked user from repeated abusive or automated activity before changing protection.</p>
      <h3>How to use this page</h3><ol><li>Review the relevant user, event type, dates, and available filters.</li><li>Before deleting a session, understand that the associated browser can lose its sign-in session.</li><li>Review the scope of a flood-control change or reset before applying it.</li></ol>
      <h3>Limitations and common problems</h3><p>Removing evidence or relaxing a limit is not a password reset or permission grant. Sessions and external identity-provider sessions are separate. Keep sensitive session or log details out of broadly shared help and messages.</p>`,
  },
  {
    id: "system:masquerade",
    paths: ["/admin/users/masquerade"],
    summary: "Review the target account before starting masquerade, because actions run with that user's identity until you stop the session.",
    details: `
      <h3>Purpose</h3><p>Use authorized masquerade to inspect the application as another user.</p>
      <h3>Before you start</h3><p>The masquerade policy must grant access. Do not use this workflow to perform unapproved business actions or collect private credentials.</p>
      <h3>How to use this page</h3><ol><li>Search User by Email and verify the exact target.</li><li>Before <strong>Start Masquerade</strong>, understand that subsequent actions use the effective target user, including notifications and audit attribution with masquerade provenance.</li><li>Select <strong>Stop Masquerade</strong> in the header when finished.</li></ol>
      <h3>Limitations and common problems</h3><p>Stop the current masquerade before starting another. Merely viewing a dashboard for another user is not masquerade. Avoid mutations when investigating a display problem.</p>`,
  },
  {
    id: "system:auth-provisioning-settings",
    paths: ["/config/auth-settings"],
    summary: "Review configured sign-in provisioning and SAML role mappings before changing who can receive a new local account and provider-managed roles.",
    details: `
      <h3>Purpose</h3><p>Control provisioning for the configured sign-in providers and the offered SAML attribute-to-role mappings.</p>
      <h3>Before you start</h3><p>Administrator access is required. This page configures supported application behavior; it does not create an external identity-provider connection or recover a lost credential.</p>
      <h3>How to use this page</h3><ol><li>Review which providers are configured and which provisioning choices they offer.</li><li>Check Reject versus Create for new-account provisioning.</li><li>For SAML mappings, verify attribute, optional matching value, and intended role.</li><li>Before saving, review the access that future sign-ins can receive.</li></ol>
      <h3>Limitations and common problems</h3><p>Local accounts do not use automatic provider provisioning here. Provider-managed role reconciliation differs from manually assigned local roles. Do not add fictitious group mappings for a provider that does not offer them on this page.</p>`,
  },
  {
    id: "system:linked-user-settings",
    paths: ["/config/employers/user-settings", "/config/trust/providers/user-settings", "/config/workers/user-settings", "/config/workers/list-settings"],
    summary: "Configure linked-user defaults or worker-list behavior for the selected audience without assuming those settings create every account or grant universal access.",
    details: `
      <h3>Purpose</h3><p>Maintain employer, provider, or worker user defaults, or the separate worker-list settings shown by the page.</p>
      <h3>Before you start</h3><p>Administrator access and each required login or cardcheck component are needed. Worker, employer, and provider roles serve different scopes.</p>
      <h3>How to use this page</h3><ol><li>Confirm the audience named by the page.</li><li>Review configured required and optional roles or list settings.</li><li>Before saving, check how linked users or filtered worker lists will be affected.</li></ol>
      <h3>Limitations and common problems</h3><p>A default role does not authorize all organization records. Changing list settings is not changing worker evidence. Existing account linkage and sign-in-provider identity require separate review.</p>`,
  },
  {
    id: "system:system-status-logs",
    paths: ["/config/system-status", "/config/logs", "/admin/debug/event-bus"],
    summary: "Inspect system status, retained logs, or debug events without treating a missing entry as proof that background work never ran.",
    details: `
      <h3>Purpose</h3><p>Use read-only status and log views to identify the failing subsystem and available evidence.</p>
      <h3>Before you start</h3><p>Administrator access is required; Event Bus also requires Debug. Logs can contain sensitive operational information and must not be copied into global help.</p>
      <h3>How to use this page</h3><ol><li>Check the selected time range and filters.</li><li>Read the actual failure or blocker and identify its source workflow.</li><li>Before any clear, purge, or debug action, review whether evidence or business behavior will change.</li></ol>
      <h3>Limitations and common problems</h3><p>Not every console event is retained in the administrative log viewer. A missing log does not prove no work occurred. A ready server does not prove every scheduled job, vendor, or queue is healthy.</p>`,
  },
  {
    id: "system:environment-timezone",
    paths: ["/config/env", "/config/timezone", "/config/system-mode", "/config/worker-sirius-id-authority"],
    summary: "Review effective environment settings, site time, and system identity before changing shared behavior or settings that require reload or restart.",
    details: `
      <h3>Purpose</h3><p>Inspect effective application settings, database source information, site/system time, and worker identifier authority.</p>
      <h3>Before you start</h3><p>Administrator access is required. Confirm the environment before any change. Sensitive values belong only in approved secure configuration, not help, screenshots, or copied logs.</p>
      <h3>How to use this page</h3><ol><li>Review the effective value and its source, including any environment override.</li><li>Check whether the field takes effect immediately, by reload, or after restart.</li><li>For time, distinguish the site's system zone from a person's display zone.</li><li>Before changing system mode or identifier authority, review the displayed warning and affected workflows.</li></ol>
      <h3>Results and status meanings</h3><p>Personal display-zone changes do not move the site's calendar boundaries or scheduled processing. A saved value waiting on restart is not yet proof of a new running configuration. System mode is not proof that a database is development or production.</p>
      <h3>Limitations and common problems</h3><p>Do not allocate replacement worker IDs to bypass an external authority. Do not change the site zone to repair one person's display. Use the approved operations procedure for environment changes; this help is not a deployment runbook.</p>`,
  },
  {
    id: "system:denorm-maintenance",
    paths: ["/admin/denorm", "/admin/denorm/%"],
    summary: "Inspect derived-data status before rebuilding, and distinguish queued recomputation from completed fresh results.",
    details: `
      <h3>Purpose</h3><p>Review denormalized data: stored derived results used to make later reads and decisions faster.</p>
      <h3>Before you start</h3><p>Administrator access and the relevant plugin/component are required. Investigate source data before rebuilding derived results.</p>
      <h3>How to use this page</h3><ol><li>Find the intended plugin configuration and inspect its status.</li><li>Read the scope and warning before any rebuild or backfill action.</li><li>After requesting work, monitor stale work and subsequent consumer results.</li></ol>
      <h3>Results and status meanings</h3><p>A rebuild/backfill request can enqueue stale rows and remove orphaned derived rows. Computation and writes happen later through the stale-work processor. Disabled processing is paused, not proof no work is owed.</p>
      <h3>Limitations and common problems</h3><p>Queued does not mean freshly recomputed. Repeated rebuilds can add load without fixing invalid source configuration. Do not use a rebuild as proof that coverage, assignments, or balances were independently reconciled.</p>`,
  },
  {
    id: "system:record-metadata-maintenance",
    paths: ["/admin/metadata", "/admin/metadata/list", "/admin/metadata/backfill"],
    summary: "Inspect retained record provenance and backfill availability without inventing historical actors or dates that were never retained.",
    details: `
      <h3>Purpose</h3><p>Review Record History metadata and maintain supported record contexts.</p>
      <h3>Before you start</h3><p>Administrator access is required. Availability depends on actual database tables and registered record contexts, not every process or queue.</p>
      <h3>How to use this page</h3><ol><li>Choose the context and filters in the listing.</li><li>Inspect retained actor/date evidence and unknown values honestly.</li><li>Before backfill, review the selected context, missing-row count, and action scope.</li><li>Inspect results before requesting another batch.</li></ol>
      <h3>Limitations and common problems</h3><p>Backfill writes metadata; it does not reconstruct lost audit events or establish a historical person/date without evidence. It is not a replay of business workflows. Unavailable contexts need setup review, not arbitrary table names.</p>`,
  },
  {
    id: "system:restart-reload",
    paths: ["/admin/restart"],
    summary: "Review pending configuration changes and restart readiness before reloading supported settings or interrupting the application with a restart.",
    details: `
      <h3>Purpose</h3><p>Use Restart &amp; Reload to distinguish reloadable configuration from settings requiring a new process.</p>
      <h3>Before you start</h3><p>Administrator access is required. A restart interrupts requests and relies on a supervisor to bring the process back. Read the restart prediction and blockers before acting.</p>
      <h3>How to use this page</h3><ol><li>Review pending changes and their effect classification.</li><li>Use the reload control for supported settings and inspect per-setting successes or errors.</li><li>Before restart, review the impact and required confirmation.</li><li>Check that the application reports a new ready boot before reloading the page.</li></ol>
      <h3>Limitations and common problems</h3><p>A successful reload is not a process restart. A normal HTTP response alone does not prove a restart occurred. If confirmation times out or supervision is unknown, use the approved operator procedure rather than repeatedly requesting restart.</p>`,
  },
  {
    id: "system:background-work-monitoring",
    paths: ["/admin/ebs", "/admin/wmb-scan-queue", "/admin/wmb-scan/%"],
    summary: "Review scheduled events and benefit-scan queue evidence, distinguishing waiting, running, failed, and completed work before retry or cleanup actions.",
    details: `
      <h3>Purpose</h3><p>Inspect the saved state and results of deferred events or monthly benefit scans.</p>
      <h3>Before you start</h3><p>Administrator access and relevant scan components are required. These are different queues; an event scheduler is not a benefit decision history.</p>
      <h3>How to use this page</h3><ol><li>Check the queue type, period, record, and current filters.</li><li>Open the saved item and inspect results or failure information.</li><li>Before retry, run, cancel, or cleanup controls, review whether work can send notifications or change coverage records.</li></ol>
      <h3>Limitations and common problems</h3><p>Waiting work can depend on environment scheduling and component state. A stale browser view is not proof the worker stopped. Inspect committed effects before retrying; removal of queue evidence is not a reversal of business effects.</p>`,
  },
  {
    id: "system:administrative-file-browser",
    paths: ["/admin/file-browser", "/admin/file-browser/%"],
    summary: "Inspect stored-file metadata and authorized downloads while checking references and permanent deletion consequences before removing an object.",
    details: `
      <h3>Purpose</h3><p>Review files available through the administrative storage browser.</p>
      <h3>Before you start</h3><p>Administrator access and usable filesystem configuration are required. Stored files can contain personal evidence or assets referenced by sent communications.</p>
      <h3>How to use this page</h3><ol><li>Find the intended object and inspect its metadata.</li><li>Download only when authorized and keep the content securely.</li><li>Before any deletion, check entity and published-asset references and the displayed warning.</li></ol>
      <h3>Limitations and common problems</h3><p>A missing file can reflect inaccessible storage, not absence of a database record. Removing an object is not an approved replacement for entity attachment cleanup. Sent messages can outlive their templates and still need published images.</p>`,
  },
  {
    id: "system:s1-migration-monitoring",
    paths: ["/config/s1-migration"],
    summary: "Review migration configuration and retained progress evidence without treating a ready application or checkpoint as proof that every source relationship migrated.",
    details: `
      <h3>Purpose</h3><p>Inspect the available S1 migration administration surface.</p>
      <h3>Before you start</h3><p>Administrator access and the S1 migration feature are required. Source and target authority, maintenance requirements, and operational approval must be established outside this help.</p>
      <h3>How to use this page</h3><ol><li>Review the selected source/target context and saved progress.</li><li>Inspect refusal reasons and retained evidence before considering operational actions.</li><li>Before any run, reset, or cleanup action, follow the approved migration procedure; those controls can change data.</li></ol>
      <h3>Limitations and common problems</h3><p>A checkpoint is not independent proof of full business reconciliation. Do not change worker identifier authority or reprocess financial records simply to dismiss a warning. Credentials and deployment-specific migration procedures do not belong in globally readable help.</p>`,
  },
];
