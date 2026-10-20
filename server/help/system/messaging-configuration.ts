import type { SystemHelpEntry } from "./index";

const contactRoots = ["/workers/%", "/users/%", "/employer-contacts/%", "/trust-provider-contacts/%"];

export const messagingConfigurationHelp: SystemHelpEntry[] = [
  {
    id: "system:direct-communications",
    paths: contactRoots.flatMap(root => ["email", "sms", "postal", "inapp"].map(medium => `${root}/comm/send-${medium}`)),
    summary: "Compose a message for the displayed contact, verify its rendered content and destination, and review delivery restrictions before sending.",
    details: `
      <h3>Purpose</h3><p>Send Email, SMS, Postal, or In-App messages using the contact and channel shown on this page.</p>
      <h3>Before you start</h3><p>You need access to the contact's send action and a configured delivery method. The channel needs a usable address or linked user. Consent, provider restrictions, and destination allowlists still apply.</p>
      <h3>How to use this page</h3><ol><li>Check whose contact record and destination you are using.</li><li>Complete the channel's required fields. Email needs a subject and body; SMS needs text; In-App requires its displayed message fields; postal needs valid mailing and letter settings.</li><li>Use the offered template or Studio tools and review the rendered content with this contact's records.</li><li>Before sending, check destination, content, links, and cost: sending or a real test can notify the contact and incur provider charges.</li><li>Inspect the resulting communication record rather than sending again because a browser request was slow.</li></ol>
      <h3>Results and status meanings</h3><p>Applying a template or previewing content does not send it. A recorded or accepted communication is not proof that a person received or read it; provider status may change later. Offline recording is not online delivery.</p>
      <h3>Limitations and common problems</h3><p>Unresolved tokens, blank required fields, missing addresses, and refused postal layouts must be corrected before delivery. A saved contact address is not proof of consent. Worker Communications Compliance reports recorded communication evidence; it is not proof of consent or current delivery eligibility.</p>`,
  },
  {
    id: "system:communication-history",
    paths: [...contactRoots.map(root => `${root}/comm/history`), "/comm/%"],
    summary: "Review saved communication content and delivery status, distinguishing a recorded message from confirmed provider delivery or a recipient reading it.",
    details: `
      <h3>Purpose</h3><p>Find prior communications for the contact and open a communication's details to investigate what was recorded.</p>
      <h3>Before you start</h3><p>History and individual communication access are checked separately from send actions. Saved messages may contain sensitive contact information.</p>
      <h3>How to use this page</h3><ol><li>Find the relevant channel and communication.</li><li>Review saved destination, content, status, and any provider information available.</li><li>Check failure information before considering another send.</li></ol>
      <h3>Results and status meanings</h3><p>History retains the delivered content and effective settings recorded at send time. Editing a communication record is not a recall or a replacement message in the recipient's inbox. Later template or branding changes do not rewrite old delivery evidence.</p>
      <h3>Limitations and common problems</h3><p>Accepted, sent, delivered, and read are different evidence. If status is uncertain, investigate the existing record instead of assuming a failed browser request means no message was sent.</p>`,
  },
  {
    id: "system:bulk-message-preparation",
    paths: ["/bulk/list", "/bulk/%", "/bulk/%/edit", "/bulk/%/message", "/bulk/%/recipients/list", "/bulk/%/recipients/add", "/bulk/%/logs"],
    summary: "Prepare reusable bulk content and an explicit recipient list, then inspect tokens and channel eligibility before queuing actual delivery.",
    details: `
      <h3>Purpose</h3><p>Maintain the bulk message, selected recipients, and content for each offered medium.</p>
      <h3>Before you start</h3><p>Bulk access requires its component and the bulk-edit access policy; ordinary staff access alone is not sufficient. Recipient addition and delivery have their own validation.</p>
      <h3>How to use this page</h3><ol><li>Open the intended message and check its description and state.</li><li>Add and review recipients and their media. The saved participant list is not every future result of the original search.</li><li>Save each medium's required fields in Message; use Studio for tokenized content.</li><li>Check token coverage and defaults for recipients with missing data.</li><li>Review recipient status and Logs before delivery. Protect recipient exports as personal information.</li></ol>
      <h3>Results and status meanings</h3><p>Saving content or adding a recipient does not send. A participant can be processed with a linked communication or fail before one is created. Inspect the communication's own delivery status when present.</p>
      <h3>Limitations and common problems</h3><p>Duplicate participants for the same media may be skipped or refused. Missing token data can use defaults, which may still produce misleading text; review the warning before queuing. Contact, consent, and provider restrictions can prevent delivery even when someone is in the recipient list.</p>`,
  },
  {
    id: "system:bulk-message-delivery",
    paths: ["/bulk/%/deliver", "/bulk/%/test"],
    summary: "Check real test destinations and recipient readiness before delivery, then follow participant and communication outcomes rather than the message label alone.",
    details: `
      <h3>Purpose</h3><p>Use Test for a selected contact and Deliver to manage the saved message's delivery queue.</p>
      <h3>Before you start</h3><p>Bulk-edit access is required. A test actually sends to the selected contact and can incur charges. Check Test Medium and destination before selecting <strong>Send Test</strong>.</p>
      <h3>How to use this page</h3><ol><li>Review saved content and token coverage.</li><li>If testing, deliberately select an authorized test contact and inspect the resulting communication.</li><li>Before actual delivery, check the full recipient list and missing-token warning.</li><li>Set a future Send Date if needed and select <strong>Queue for Delivery</strong>.</li><li>Monitor Delivery Progress and individual recipient failures.</li></ol>
      <h3>Results and status meanings</h3><p>Queued work waits for delivery processing. <strong>Mark Sent</strong> changes the message label; it is not evidence that each recipient received it. <strong>Cancel</strong> removes queued intent, not messages already sent. <strong>Reset to Draft</strong> does not undo delivery or automatically erase processed participant evidence.</p>
      <h3>Limitations and common problems</h3><p>Do not assume resetting and requeuing safely resends every recipient. Already processed participants are guarded against duplicate processing. Investigate failed and linked communication records before choosing a retry action.</p>`,
  },
  {
    id: "system:letter-template-studio",
    paths: ["/admin/letter-templates", "/admin/letter-templates/%"],
    summary: "Maintain reusable message templates for the correct medium and token context, previewing records before applying content to a sending workflow.",
    details: `
      <h3>Purpose</h3><p>Letter Templates stores reusable message fields. Studio edits tokenized content inside templates and supported compose or configuration hosts; it is not a standalone send page.</p>
      <h3>Before you start</h3><p>These routes require staff access. Preview records must also pass their own access checks. A template's medium and selected contexts determine where it is offered.</p>
      <h3>How to use this page</h3><ol><li>Choose the intended medium and applicable contexts.</li><li>Open Studio for one selected context and use its offered tokens.</li><li>Review available preview records and loading or missing-data messages; do not assume fictional fallback data represents a worker.</li><li>Inspect Design and Source where offered, then apply the content and save the template.</li></ol>
      <h3>Results and status meanings</h3><p>Preview and Apply do not send a message. Applying Studio content returns it to its host; the host still needs saving or sending. Tokens render against the sending workflow's records and may differ from a preview.</p>
      <h3>Limitations and common problems</h3><p>Check medium-required fields and token context before reuse. Removing a template does not recall sent messages. Do not delete an uploaded image merely because it was removed from a draft: sent messages and copied HTML can still reference it. Existing defaults guidance explains delivery branding.</p>`,
  },
  {
    id: "system:plugin-configuration-list",
    paths: ["/admin/plugin-configs"],
    summary: "Find the plugin configuration kind you need and review enabled configurations without confusing a saved configuration with a completed run.",
    details: `
      <h3>Purpose</h3><p>Browse available kinds of configured system behavior.</p>
      <h3>Before you start</h3><p>Administrator access is required. The catalog filters kinds and plugins by component availability and configuration scope.</p>
      <h3>How to use this page</h3><ol><li>Choose the kind matching the behavior you intend to change.</li><li>Review existing configurations before adding another.</li><li>Open that kind's help and schema before changing fields or enabled state.</li></ol>
      <h3>Limitations and common problems</h3><p>Plugin kinds are not interchangeable. Enabling a configuration may affect subsequent events or scheduled work, not immediately recompute old records. An absent kind may be unavailable in this deployment rather than missing from the database.</p>`,
  },
  {
    id: "system:eligibility-plugin-configuration",
    paths: ["/admin/plugin-configs/trust-eligibility", "/policies/%/eligibility", "/admin/plugin-configs/dispatch-eligibility", "/config/dispatch-job-type/%/eligibility-plugins"],
    summary: "Configure scoped eligibility checks and review which records they apply to before enabling rules used by benefits or dispatch decisions.",
    details: `
      <h3>Purpose</h3><p>Maintain eligibility conditions for benefits or dispatch in the scope shown by the host page.</p>
      <h3>Before you start</h3><p>Administrator access and the relevant component are required. Benefit eligibility is not dispatch eligibility; use the correct kind and policy or job-type scope.</p>
      <h3>How to use this page</h3><ol><li>Review existing enabled configurations in this scope.</li><li>Choose an offered plugin and fill its required fields and applicability.</li><li>Review start or continuation conditions where offered and any unavailable-choice warnings.</li><li>Save and enable only after checking the affected population.</li></ol>
      <h3>Results and status meanings</h3><p>Rules are consumed by later eligibility evaluation. A saved rule is not an assignment, election, or coverage grant. Dispatch eligibility does not establish a worker's availability or acceptance.</p>
      <h3>Limitations and common problems</h3><p>Do not assume a save reruns historical decisions. A selected unavailable value may need clearing before an otherwise unrelated edit can save. Check the plugin's validation and scope instead of copying settings from a different kind.</p>`,
  },
  {
    id: "system:charge-plugin-configuration",
    paths: ["/admin/plugin-configs/charge"],
    summary: "Configure financial charge rules with the correct account, payment type, scope, and dates before enabling downstream billing behavior.",
    details: `
      <h3>Purpose</h3><p>Maintain the configured rules used to calculate and reconcile charges.</p>
      <h3>Before you start</h3><p>Administrator access and required ledger or site features are needed. Verify the account, payment type direction, rates, and plugin-specific prerequisites before enabling a financial rule.</p>
      <h3>How to use this page</h3><ol><li>Inspect existing enabled rules for overlapping scope.</li><li>Choose the intended plugin and complete its schema.</li><li>Review effective dates and financial targets before saving or enabling.</li><li>Review subsequent ledger evidence through the relevant workflow.</li></ol>
      <h3>Limitations and common problems</h3><p>A save is not proof of a charge run or a provider collection. Consumers can reconcile later; do not promise historical recalculation from a configuration edit. Missing rates or ambiguous configuration need correction before processing affected work.</p>`,
  },
  {
    id: "system:notifier-plugin-configuration",
    paths: ["/admin/plugin-configs/event-notifier"],
    summary: "Configure event-triggered recipients and message fields, previewing each medium before enabling notifications that may send on later events.",
    details: `
      <h3>Purpose</h3><p>Control which supported events produce notifications and how each configured medium renders them.</p>
      <h3>Before you start</h3><p>Administrator access is required. Offered notifier plugins and channels depend on enabled features. Recipient rules and send-time checks still apply.</p>
      <h3>How to use this page</h3><ol><li>Choose the notifier and review its event and filters.</li><li>Check recipients and each medium's required fields.</li><li>Open the embedded Studio and preview with available authorized event records.</li><li>Before enabling, review whether subsequent matching events will send real messages and incur costs.</li></ol>
      <h3>Results and status meanings</h3><p>Apply returns content to the configuration; save persists it. Neither is a send. Messages are composed per recipient, so one preview does not prove all recipients have the same token evidence.</p>
      <h3>Limitations and common problems</h3><p>Hidden or unavailable channel choices do not authorize delivery. Blank required fields can produce recorded recipient failures. Check communication evidence rather than repeatedly creating the triggering event to test delivery.</p>`,
  },
  {
    id: "system:cron-plugin-configuration",
    paths: ["/admin/plugin-configs/cron"],
    summary: "Maintain scheduled plugin settings while keeping enabled configuration, environment scheduling policy, and actual successful runs separate.",
    details: `
      <h3>Purpose</h3><p>Configure the supported scheduled work offered by this kind.</p>
      <h3>Before you start</h3><p>Administrator access and the plugin's required component are needed. Automatic execution also depends on the real environment's scheduling policy.</p>
      <h3>How to use this page</h3><ol><li>Review the selected job's required configuration and existing entries.</li><li>Check its scope and schedule before saving or enabling.</li><li>Use Cron Jobs history to establish actual execution.</li></ol>
      <h3>Limitations and common problems</h3><p>Enabled does not mean running or completed. Manual run controls can write records or send messages; review their warning before using them. Do not add duplicate configurations to compensate for paused schedules.</p>`,
  },
  {
    id: "system:gateway-plugin-configuration",
    paths: ["/admin/plugin-configs/payment-gateway"],
    summary: "Configure supported payment gateways without mistaking a saved connection for authority to charge a payer or proof of a successful payment.",
    details: `
      <h3>Purpose</h3><p>Maintain gateway configurations used by method setup and payment workflows.</p>
      <h3>Before you start</h3><p>Administrator access and the provider's supported mode and configuration are required. Keep credentials in the approved secure configuration flow, never help or message text.</p>
      <h3>How to use this page</h3><ol><li>Select an offered gateway plugin and review its schema.</li><li>Check account and payment-type compatibility and test versus live mode.</li><li>Review financial and vendor consequences before enabling or invoking any test.</li></ol>
      <h3>Limitations and common problems</h3><p>Saving is not a payment. Method-management authority, payer consent, and payment-use grants are separate. A provider test may make network calls or create provider records; it is not automatically consequence-free.</p>`,
  },
  {
    id: "system:benefit-policy-configuration",
    paths: ["/trust-benefits", "/trust-benefits/add", "/trust-benefits/%", "/policies/%", "/policies/%/edit", "/policies/%/benefits", "/config/policies", "/config/default-policy"],
    summary: "Maintain benefits and policy membership, checking assignment dates and eligibility rules before changes affect later coverage evaluation.",
    details: `
      <h3>Purpose</h3><p>Define benefit records, their policy membership, and the default policy used by the application.</p>
      <h3>Before you start</h3><p>Benefit and policy editing have separate staff or administrator checks. Default policy changes require administrator access. Check existing employer policy history and the intended benefit type.</p>
      <h3>How to use this page</h3><ol><li>Review the existing benefit or policy before adding another.</li><li>Check active dates, linked benefits, and applicable eligibility configuration.</li><li>Review who receives a changed default before saving it.</li><li>Use the relevant worker scan preview to assess later coverage effects.</li></ol>
      <h3>Limitations and common problems</h3><p>A policy assignment is not an election or coverage grant. Changing a default or benefit definition does not prove existing recorded coverage has been recalculated. Resolve missing policy or benefit links rather than treating empty eligibility as a positive decision.</p>`,
  },
  {
    id: "system:open-enrollment-windows",
    paths: ["/config/trust/open-enrollment-windows"],
    summary: "Define the plan year and opening and closing dates that control when the Open Enrollment workflow is offered.",
    details: `
      <h3>Purpose</h3><p>Maintain dated Open Enrollment availability.</p>
      <h3>Before you start</h3><p>Administrator access and Elections are required. A window is not a posted election for any worker.</p>
      <h3>How to use this page</h3><ol><li>Review existing windows for the plan year.</li><li>Set <strong>Plan year</strong>, <strong>Opens on</strong>, and <strong>Closes on</strong>.</li><li>Check the dates before saving; changing or deleting a window can change which launches are offered.</li></ol>
      <h3>Limitations and common problems</h3><p>Correct date validation errors before retrying. A window alone does not satisfy a worker's other enrollment guards or post an election. Existing drafts and recorded coverage must be reviewed separately.</p>`,
  },
];
