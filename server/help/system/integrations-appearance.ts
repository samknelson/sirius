import type { SystemHelpEntry } from "./index";

export const integrationsAppearanceHelp: SystemHelpEntry[] = [
  {
    id: "system:incoming-web-services",
    paths: ["/admin/ws", "/admin/ws/services", "/admin/ws/stats", "/admin/ws/clients", "/admin/ws/clients/%"],
    summary: "Review incoming web-service capabilities and client access, checking authorization and real request effects before testing an operation.",
    details: `
      <h3>Purpose</h3><p>Inspect services called by external clients and maintain the client settings, allowed access, and IP rules offered here.</p>
      <h3>Before you start</h3><p>Administrator access is required. Client credentials and allowed operations are sensitive; use approved secure handling and never put them in help, shared screenshots, or messages.</p>
      <h3>How to use this page</h3><ol><li>Review Services and the intended client's settings.</li><li>Check scope, IP rules, and available Swagger documentation before changing access.</li><li>Before Test, review Service, Operation, Method, query parameters, and body: a test can execute a real operation and change records.</li><li>Inspect the response and client Logs for the actual outcome.</li></ol>
      <h3>Limitations and common problems</h3><p>A successful HTTP response is not proof of a successful business result; read the response outcome. Rotating or removing credentials can interrupt external clients. Do not relax IP or service restrictions merely to dismiss a test failure.</p>`,
  },
  {
    id: "system:outgoing-web-services",
    paths: ["/admin/wc", "/admin/wc/overview", "/admin/wc/cache", "/admin/wc/stats"],
    summary: "Review outbound request types, retained responses, and usage without confusing a cached answer with a new vendor call.",
    details: `
      <h3>Purpose</h3><p>Inspect requests the application makes to other systems and their retained answers.</p>
      <h3>Before you start</h3><p>Administrator access is required. Responses can contain sensitive business data. Cached, uncached, held, or local outcomes have different meanings; inspect the displayed mode and outcome.</p>
      <h3>How to use this page</h3><ol><li>Use Overview to identify the owning request type and freshness behavior.</li><li>Filter Cache to inspect a saved response, its age, and outcome.</li><li>Before expiring a response, understand that a later consumer may make a new network or paid vendor call.</li><li>Use Stats for observed usage rather than inferring billing from one browser visit.</li></ol>
      <h3>Limitations and common problems</h3><p>A cached response can serve many callers without a new vendor request. Expire is not a refund, remote deletion, or automatic refresh. Transport success alone may not establish a usable answer; inspect the recorded business outcome.</p>`,
  },
  {
    id: "system:sftp-destinations",
    paths: ["/config/sftp/clients", "/config/sftp/client/%"],
    summary: "Maintain SFTP destinations and inspect connection results carefully, because test-page uploads and remote operations are real network actions.",
    details: `
      <h3>Purpose</h3><p>Review SFTP client destinations, connection settings, logs, and supported test operations.</p>
      <h3>Before you start</h3><p>Administrator access and SFTP Client are required. Confirm the intended remote organization and use approved credential handling; never store connection secrets in help.</p>
      <h3>How to use this page</h3><ol><li>Review destination identity and Connection before changing settings.</li><li>Read Logs to investigate an existing failure first.</li><li>Before a connection test, listing, directory change, or upload, confirm authorization for that remote system.</li><li>For upload, verify Current Path and the actual file: this sends content to the remote destination.</li></ol>
      <h3>Limitations and common problems</h3><p>A successful connection does not prove directory permissions or downstream file acceptance. A failed response after upload is not proof the remote file was absent. Inspect remote outcomes through approved procedures before retrying.</p>`,
  },
  {
    id: "system:business-calendars",
    paths: ["/config/business-calendars", "/config/business-calendars/%"],
    summary: "Maintain business-day rules and dated exceptions, using the calendar test to check the resulting date before relying on a deadline calculation.",
    details: `
      <h3>Purpose</h3><p>Configure business calendars used by workflows that count working days.</p>
      <h3>Before you start</h3><p>Administrator access is required. Check the calendar's sources, weekend rules, holidays, closed days, vacation ranges, and forced-open exceptions.</p>
      <h3>How to use this page</h3><ol><li>Open the calendar used by the intended workflow.</li><li>Review settings and the dated Closed Days, Vacations, and Open Days before changing exceptions.</li><li>Use Test to inspect a date or add Business days (N) to a Start date.</li><li>Review the rule label explaining why a day is open or closed.</li></ol>
      <h3>Results and status meanings</h3><p>A forced-open override can make a day open despite closure rules. Calendar tests inspect configured date logic; they do not change a grievance status or complete scheduled work.</p>
      <h3>Limitations and common problems</h3><p>Use the site's calendar-day interpretation, not an assumption based on your personal display time zone. A calendar edit does not prove every existing deadline has been recomputed. Verify legal deadlines through local procedure.</p>`,
  },
  {
    id: "system:cron-jobs",
    paths: ["/cron-jobs", "/admin/cron-jobs", "/cron-jobs/%/view", "/cron-jobs/%/run", "/cron-jobs/%/history"],
    summary: "Inspect job configuration and run history before manual execution, which can change records, contact vendors, or send messages.",
    details: `
      <h3>Purpose</h3><p>Review scheduled jobs and distinguish automatic scheduling from an explicit manual run.</p>
      <h3>Before you start</h3><p>Job viewing and running have separate permissions. Required components, enabled configuration, and environment scheduling policy still apply.</p>
      <h3>How to use this page</h3><ol><li>Read the job's description, scope, and current settings.</li><li>Inspect History for an existing running or recent failed attempt.</li><li>Before the Run action, review its warning and inputs; a manual run is not a read-only test.</li><li>Inspect the saved run status, output, and errors after execution.</li></ol>
      <h3>Results and status meanings</h3><p>Enabled or due does not mean the job ran successfully. The site's time and the deployed environment's execution policy affect automatic work. Queued and running are not final results.</p>
      <h3>Limitations and common problems</h3><p>A polling error does not prove the server job stopped. Check retained history before another run. Success at the job level does not independently prove every external recipient or downstream consumer completed.</p>`,
  },
  {
    id: "system:message-provider-configuration",
    paths: ["/config/twilio", "/config/email", "/config/postal"],
    summary: "Review delivery-provider settings and restrictions before changing shared sending behavior or invoking a real provider connection test.",
    details: `
      <h3>Purpose</h3><p>Configure the provider used by SMS, email, or postal delivery. Existing defaults help separately explains automatic letterheads and postal layout.</p>
      <h3>Before you start</h3><p>Administrator access and a supported provider are required. Keep credentials in approved secure settings, not help or template content. Provider mode, allowlists, sender identity, and consent remain relevant.</p>
      <h3>How to use this page</h3><ol><li>Review the current provider and effective settings.</li><li>Check sender and destination restrictions before saving changes.</li><li>Before <strong>Test Connection</strong> or another test action, inspect its stated effects; provider calls may create records or incur costs.</li><li>Review actual test results and communication records rather than assuming a saved setting proves delivery.</li></ol>
      <h3>Limitations and common problems</h3><p>A successful connection is not proof a message will reach every contact. Offline recording, provider acceptance, delivery, and reading are different outcomes. Do not weaken consent or destination controls to bypass a failure.</p>`,
  },
  {
    id: "system:ledger-authorization-settings",
    paths: ["/config/ledger/settings"],
    summary: "Maintain payment defaults and approved consumer and business authorization text, keeping current configuration separate from a payer's recorded historical consent.",
    details: `
      <h3>Purpose</h3><p>Configure ledger payment defaults and online payment authorization wording.</p>
      <h3>Before you start</h3><p>Administrator access and Ledger are required. Use approved wording and version identifiers; this help does not supply legal authorization language.</p>
      <h3>How to use this page</h3><ol><li>Review the stored authorization format and any load or validation warning.</li><li>Check consumer and business Version and Approved authorization text separately.</li><li>Review default payment type and its direction before saving.</li></ol>
      <h3>Results and status meanings</h3><p>New wording configures subsequent payment authorization. It does not retroactively prove what a historical payer agreed to, identify an unknown payer, or authorize a new charge.</p>
      <h3>Limitations and common problems</h3><p>If stored authorization needs review, it is not silently replaced; resolve that warning before saving. Method management, payment-use grants, and actual consent are distinct prerequisites.</p>`,
  },
  {
    id: "system:gateway-testing-payment-types",
    paths: ["/config/ledger/payment-gateways/test", "/config/ledger/payment-gateways/payment-types"],
    summary: "Review gateway capabilities and compatible payment types before tests or configuration changes affect provider requests and available payment methods.",
    details: `
      <h3>Purpose</h3><p>Inspect gateway account information and maintain offered gateway/payment-type compatibility.</p>
      <h3>Before you start</h3><p>Administrator access, Ledger, and configured gateways are required. Confirm test versus live mode before any test call; not every operation labeled test is a simulation.</p>
      <h3>How to use this page</h3><ol><li>Select the intended gateway.</li><li>Review capabilities and existing payment-type choices.</li><li>Before testing, read the operation's effects and provider mode.</li><li>Check the returned result before saving compatibility changes or investigating a failed payment.</li></ol>
      <h3>Limitations and common problems</h3><p>A compatible type does not grant payer authority or guarantee sufficient funds. A connectivity result is not a settled payment. Do not use a live charge simply to verify configuration documentation.</p>`,
  },
  {
    id: "system:ledger-payment-types",
    paths: ["/config/ledger/payment-types"],
    summary: "Maintain payment-type definitions and their charge or credit effect, reviewing historical financial use before changing a shared type.",
    details: `
      <h3>Purpose</h3><p>Define payment categories used by staff entry and financial consumers.</p>
      <h3>Before you start</h3><p>Staff access and Ledger are required; offered maintenance actions can have additional checks. Check existing payment use and gateway compatibility before changing a type.</p>
      <h3>How to use this page</h3><ol><li>Find the intended type and inspect its direction and category.</li><li>Review affected payment and account use before saving or deleting.</li><li>For historical direction correction, use the reviewed correction workflow offered by the application rather than treating it as a harmless label edit.</li></ol>
      <h3>Limitations and common problems</h3><p>Changing charge versus credit meaning after clearing can affect financial reconciliation. Do not blindly reverse signs or recreate payments to compensate. A payment type is not a provider method or consent record.</p>`,
  },
  {
    id: "system:site-appearance",
    paths: ["/config/site", "/config/terminology"],
    summary: "Maintain shared site presentation and terminology, checking selected menus and labels without assuming cosmetic changes alter access or business rules.",
    details: `
      <h3>Purpose</h3><p>Configure site presentation, naming, and the offered main-menu selection.</p>
      <h3>Before you start</h3><p>Administrator access is required. Terminology is deployment-specific; use names understood by your organization.</p>
      <h3>How to use this page</h3><ol><li>Review the current site settings and labels.</li><li>Check the intended menu and affected labels before saving.</li><li>Reload the relevant view to inspect presentation after a successful save.</li></ol>
      <h3>Limitations and common problems</h3><p>Renaming a label does not change permissions, data ownership, or benefit policy. Menu items still depend on access and enabled components. Use dedicated provider defaults for delivered message branding.</p>`,
  },
  {
    id: "system:component-administration",
    paths: ["/config/components"],
    summary: "Review component dependencies and availability before enabling or disabling features that can change routes, tabs, configuration, and database requirements.",
    details: `
      <h3>Purpose</h3><p>Control which optional application components are enabled.</p>
      <h3>Before you start</h3><p>Administrator access is required. This is not merely a cosmetic switch: schema-managing components can need database setup and may refuse changes when prerequisites are not satisfied.</p>
      <h3>How to use this page</h3><ol><li>Read the component description, dependencies, and current state.</li><li>Before changing state, review users, workflows, and plugin configurations that rely on it.</li><li>Apply the intended change and inspect the returned result before assuming the feature is available.</li></ol>
      <h3>Limitations and common problems</h3><p>Disabling a component can hide tabs and refuse related routes or actions; it does not prove all pending work or retained data were deleted. If setup fails, investigate the stated blocker rather than repeatedly toggling the component.</p>`,
  },
  {
    id: "system:help-text-listing",
    paths: ["/config/helps"],
    summary: "Review built-in and local page guidance, using path and content filters before changing organization-specific help.",
    details: `
      <h3>Purpose</h3><p>Review the help shown inline and in expanded Help dialogs throughout the application.</p>
      <h3>Before you start</h3><p>Administrator access is required here. Help reads elsewhere require sign-in, but entries are matched by path, not by the reader's role; never put restricted procedures or credentials in help.</p>
      <h3>How to use this page</h3><ol><li>Use <strong>Filter by path…</strong> and <strong>Filter by content (summary or details)…</strong> to find entries.</li><li>Review Paths, Summary, and Details.</li><li>Before adding or changing local help, check overlapping built-ins and use narrow real browser paths.</li><li>Visit a matching page and select <strong>more</strong> to inspect expanded guidance.</li></ol>
      <h3>Results and status meanings</h3><p><strong>System</strong> and <strong>Built-in</strong> identify shipped product guidance that cannot be edited here. Local entries remain independently editable and appear alongside built-ins; they do not override them. Yes in Details means expanded content is available.</p>
      <h3>Limitations and common problems</h3><p>The percent wildcard can match empty text and multiple path segments; it is not limited to one record ID. Check sibling tabs and unrelated paths. Summary is plain text and details are sanitized HTML, not Markdown. Deleting local help permanently removes that guidance; it does not delete a system entry. After a change, reload matching pages to avoid cached lookups.</p>`,
  },
  {
    id: "system:dashboard-plugin-configuration",
    paths: ["/admin/plugin-configs/dashboard"],
    summary: "Configure dashboard widgets and audience settings while keeping displayed content subject to the target user's actual access.",
    details: `
      <h3>Purpose</h3><p>Maintain dashboard configurations, ordering, and supported widget-specific settings.</p>
      <h3>Before you start</h3><p>Administrator access is required. A widget's own data, component, and audience gates still apply.</p>
      <h3>How to use this page</h3><ol><li>Choose the intended widget and review existing enabled configurations.</li><li>Check audience, ordering, and required fields before saving.</li><li>Review the resulting dashboard for the intended authorized user.</li></ol>
      <h3>Limitations and common problems</h3><p>Enabling a widget does not grant access to its underlying records. A missing widget can reflect target-user restrictions rather than failed configuration. Viewing another user's dashboard is not permission to bypass those gates.</p>`,
  },
];
