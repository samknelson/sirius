# Authenticated help backfill coverage

Reconciled 2026-10-20 against the delivered routes, tab policies, plugin adapters,
page controls, and server consumers. This is the current completion inventory;
the [original audit](in-app-help-coverage-audit.md) remains historical evidence,
not a claim about today's gaps.

## Ownership and verification vocabulary

- **45 scoped families:** F01–F48 except F08, F09, F32. Source coverage is
  implemented below. Family counts are not entry counts or URL counts.
- **F08/F09:** shipped by the separate payment-help work, already present at
  reconciliation. Its evidence is [online payment help](in-app-help-online-payments.md)
  and `tests/ledger/payment-help.test.ts`. This backfill neither authors nor
  changes those entries. Their presence is source evidence, not a live charging
  or signed-in browser verification claim.
- **F32:** existing `system:trust-providers` summary retained unchanged. It was
  summary-only, not one of the 47 missing families.
- **F49/F50, P01–P03, E1–E3 and design artifacts:** excluded. No fictitious
  wizard-step URLs, public help, or new embedded controls were introduced.
- **Source complete:** focused guidance registered, intended path and near-miss
  checked with the real matcher; not a statement that an authorized browser
  session or every optional component was available.
- **B0:** signed-in listing, inline summaries, and interactive Help dialogs
  unavailable in the current browser session. Applies to **every row**, including
  worker/staff/approver and optional-site views. Auth is preserved. See the
  verification record below for the actual anonymous-browser check.

All abbreviated entry IDs below have the literal `system:` prefix. The **first**
ID in each row is the independently checked focus entry for the representative
positive path and negative near-miss. Other IDs identify complementary guidance,
not substitutes for those checks. `tests/help/workflow-coverage.test.ts` executes
these pairs, validates every ID, and checks all new entry patterns separately.
“Pass” concerns matcher/source checks only. B0 is not “pass.”

Evidence abbreviations:

- **R:** `client/src/App.tsx`; **T:** `shared/tabRegistry.ts`;
  **A:** `client/src/components/auth/ProtectedRoute.tsx` and referenced shared
  access policies. These apply to every row, alongside the specific evidence.
- **P:** `client/src/pages/`; **S:** `server/`; **W:**
  `server/plugins/wizards/plugins/`; **K:** `server/plugins/`.
- Exact registered pattern arrays are in the named entries under
  `server/help/system/`. Patterns are browser paths, not route placeholders.
  The table intentionally uses fictional record IDs only.

## Route-to-help family matrix

| Family | Status | Representative positive path | Focus and complementary entry IDs | Negative near-miss for focus ID | Current evidence beyond R/T/A | Matcher | Browser |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F01 | Source complete | /workers/example/benefits/scan | benefits-scan, benefits-recorded-coverage, benefit-exemptions, worker-benefits-summary | /workers/example/benefits/history | P worker-benefits-scan.tsx, worker-benefits-current.tsx, worker-benefits-history.tsx, worker-benefits-eligibility.tsx; existing worker-benefits-summary help and its tests | Pass | B0 |
| F02 | Source complete | /trust/election/example/edit | enrollment-review, elections-current | /workers/example/elections/current | P workers/elections-current.tsx, workers/elections-list.tsx, trust/election-edit.tsx, trust/election-detail.tsx; W enrollment plugins and launch guards | Pass | B0 |
| F03 | Source complete | /bao/dc/cases/example | disability-credit-staff, disability-credit-worker | /workers/example/sitespecific/bao/disability-credit | P sitespecific/bao/dc-case-detail.tsx; S services/sitespecific/bao/dc-workflow.ts, dc-grant.ts; modules/sitespecific/bao/disability-credit.ts | Pass | B0 |
| F04 | Source complete | /bao/cases/example | bao-cases-appeals | /bao/dc/cases/example | P sitespecific/bao/case-detail.tsx, case-new.tsx; S modules/sitespecific/bao/cases.ts, appeal outcome and member-letter consumers | Pass | B0 |
| F05 | Source complete; lifecycle reused | /cobra/cases/example/edit | bao-cobra-case-setup, bao-cobra-lifecycle | /workers/example/sitespecific/bao/cobra | Existing bao-cobra.ts and tests/sitespecific/bao-cobra-help-routes.test.ts; P sitespecific/bao/cobra-add.tsx, cobra-edit.tsx; S modules/sitespecific/bao/cobra.ts | Pass | B0 |
| F06 | Source complete | /workers/example/sitespecific/bao/dp | domestic-partner-worker, domestic-partner-report | /bao/dp/workers | P worker-sitespecific-bao-dp.tsx, sitespecific/bao/dp-workers.tsx; S DP billing/report consumers; current worker status labels, not the stale audit's label count | Pass | B0 |
| F07 | Source complete | /workers/example/sitespecific/bao/beneficiaries | bao-beneficiaries | /workers/example/relations | P worker-sitespecific-bao-beneficiaries.tsx; shared BAO validation; worker.mine write policy | Pass | B0 |
| F08 | Separate owner; shipped source retained | /pay/receipt/example | online-payment-receipt, worker-online-payment-accounts, online-payment-checkout | /pay/example | Existing online-checkout.ts; docs/in-app-help-online-payments.md; tests/ledger/payment-help.test.ts | Pass | B0 |
| F09 | Separate owner; shipped source retained | /workers/example/ledger/payment-methods | worker-payment-methods | /employers/example/ledger/payment_methods | Existing worker-payment-methods.ts; payment help evidence and tests; management versus payment-use gates | Pass | B0 |
| F10 | Source complete | /workers/example/ledger/sitespecific/bao/echp | event-center-hours-purchase | /workers/example/ledger/pay | P worker-sitespecific-bao-echp.tsx; S modules/sitespecific/bao/echp.ts GET quote and POST purchase | Pass | B0 |
| F11 | Source complete | /ea/example/invoices/10/2026 | entity-account-statements, ledger-accounts | /ledger/accounts/example/summary | P ea-invoices.tsx and ea statement/payment/transaction views; ledger account views and ledger storage consumers | Pass | B0 |
| F12 | Source complete | /ledger/payment/example/edit | staff-payment-entry, payment-batches | /ledger/payment-batch/example/edit | P payment-edit.tsx, payment-create.tsx, ea-payment-create.tsx; PaymentForm; S ledger payment and batch validation, provider-managed refusal | Pass | B0 |
| F13 | Source complete | /employers/compliance | employer-compliance-monitor, monthly-upload-monitor, employer-upload-launcher | /employers/monthly-uploads | P employer-compliance-dashboard.tsx, employers-monthly-uploads.tsx, employers/wizards.tsx; W monthly employer upload plugins | Pass | B0 |
| F14 | Source complete | /wizards/example | shared-wizard-runner | /reports | P wizard runner and wizard step components; S plugins/wizards/dispatcher.ts, entity-access.ts, feed processing lifecycle | Pass | B0 |
| F15 | Source complete; compliance retained | /workers/example/comm/send-sms | direct-communications, communication-history, worker-comms-compliance | /workers/example/comm/history | CommSendWrapper and channel composers; S comm sending and token rendering; existing compliance help and tests | Pass | B0 |
| F16 | Source complete | /bulk/example/deliver | bulk-message-delivery, bulk-message-preparation | /bulk/example/message | P bulk delivery, testing, recipient and message tabs; S modules/bulk/deliver.ts and participant processing checks | Pass | B0 |
| F17 | Source complete; defaults retained | /admin/letter-templates/example | letter-template-studio, compose-message-defaults, email-message-defaults, postal-message-defaults | /admin/plugin-configs/event-notifier | P letter template editor and Studio hosts; S template preview/token context policies; existing message-defaults.ts | Pass | B0 |
| F18 | Source complete | /admin/plugin-configs | plugin-configuration-list, eligibility-plugin-configuration, charge-plugin-configuration, notifier-plugin-configuration, cron-plugin-configuration, gateway-plugin-configuration, dashboard-plugin-configuration, retention-plugin-configuration, denorm-plugin-configuration, quicksearch-plugin-configuration, worker-list-plugin-configuration, client-injection-configuration, web-service-plugin-configuration, edi-plugin-configuration | /admin/plugin-configs/event-notifier | K _core configuration adapters and all offered kinds; each concrete adapter has focused guidance, not a generic /admin/plugin-configs/% fallback | Pass | B0 |
| F19 | Source complete | /config/trust/open-enrollment-windows | open-enrollment-windows, benefit-policy-configuration | /config/default-policy | P trust benefit/policy editors and open-enrollment-windows; enrollment date/launch validation | Pass | B0 |
| F20 | Source complete | /config/sitespecific/bao/premium-files | bao-premium-files, bao-member-thresholds, bao-employer-rates, bao-cobra-rates, bao-dp-rates, bao-provider-premium-rates, bao-distance-cache, bao-cobra-triggers, bao-immediate-eligibility | /config/sitespecific/bao/premium-rates | P config/sitespecific/bao dated rates, rate sources, distance cache, premium-files and cobra-triggers; config/trust/sitespecific/bao/thresholds.tsx; employer immediate eligibility; S corresponding BAO consumers | Pass | B0 |
| F21 | Source complete | /workers/example/delete | worker-deletion, worker-directory | /workers/add | P workers directory/create and worker-delete.tsx; worker creation and deletion API gates/constraints | Pass | B0 |
| F22 | Source complete | /workers/example/relations | worker-relationships, worker-identity, contact-information | /workers/example/email | Worker name/ID/contact/date/status editors; relationship editor and shared validation, relationship direction and date consumers | Pass | B0 |
| F23 | Source complete | /hours/example/edit | employment-hours, worker-time-off-sick | /workers/example/benefits/history | P worker employment and hour editors; hour storage and downstream coverage/ledger invalidation | Pass | B0 |
| F24 | Source complete | /workers/example/ratings | worker-ratings, worker-skills-certifications | /workers/example/certifications | P worker-ratings.tsx, worker-skills.tsx, worker-certifications.tsx, certification editor; actual 0–4 scale and immediate selection save | Pass | B0 |
| F25 | Source complete | /workers/example/bans | worker-bans, union-records, cardcheck-records, worker-time-off-sick | /workers/example/union/cardchecks | Worker ban and cardcheck editors; K worker-bans behavior plugins; dispatch acceptance enforcement; union/steward configuration | Pass | B0 |
| F26 | Source complete | /workers/example/files | entity-files, entity-notes, entity-related-work, entity-record-history | /workers/example/notes | EntityFileManager, EntityNotesPanel and reusable entity tabs; S entity-files and entity-notes configuration/policies | Pass | B0 |
| F27 | Source complete | /workers/example/aat | worker-access-tokens, worker-linked-user, record-dashboard | /workers/example/user | Worker AAT editor and actual EDLS response consumer; user linkage views; dashboard target-user policy | Pass | B0 |
| F28 | Source complete | /employers/example/policy-history | employer-policy-history, employer-record-maintenance, employer-onboarding, company-records, facility-records | /employers/example/contacts | P employer policy history and record editors; onboarding wizard; company/facility editors and delete confirmation | Pass | B0 |
| F29 | Source complete | /employers/example/missing-cardchecks | organizing-completeness, worker-political-profile | /workers/example/political | P employer-missing-cardchecks.tsx, organizing and political views; definition/population and sensitive export controls | Pass | B0 |
| F30 | Source complete | /employers/example/ledger/payment_methods | employer-payment-methods, employer-gateway-customer, ledger-accounts | /workers/example/ledger/payment-methods | P employers/payment-methods.tsx, customer.tsx, accounts; gateway attach/default/remove APIs | Pass | B0 |
| F31 | Source complete | /employer-contacts/example/employers | organization-contact-links, contact-information, worker-linked-user | /employers/example/contacts | Employer/provider contact membership, name/contact and user editors; membership removal versus shared contact edits | Pass | B0 |
| F33 | Source complete | /trust/provider-edi | provider-edi, provider-records, bao-premium-files | /trust/providers | P trust/provider-edi-dashboard.tsx and provider record tabs; K trust/provider-edi scope and wizard generation/delivery | Pass | B0 |
| F34 | Source complete | /dispatch/job/example/run/batch | dispatch-run, dispatch-jobs, worker-dispatch-preferences, t631-dispatch-interviews, dispatch-configuration, eligibility-plugin-configuration | /workers/example/dispatch/status | P dispatch/job-run-batch.tsx, job-run.tsx and worker preference tabs; dispatch policy/acceptance and notification consumers | Pass | B0 |
| F35 | Source complete | /edls/sheet/example/manage | edls-scheduling, edls-worker-extensions, edls-configuration | /workers/example/edls | P edls/sheet-manage.tsx and assignment/snapshot views; S EDLS status and response consumers; site-specific migration/fetch pages | Pass | B0 |
| F36 | Source complete | /events/example/scan-checkin | event-scan-checkin, event-management | /events/example/roster | P event-scan-checkin.tsx, event registration/roster/edit/delete; scan-checkin API and QR payload handling | Pass | B0 |
| F37 | Source complete | /grievance/example/timeline | grievance-workflow, grievance-timeline-templates, entity-notes, entity-files | /grievance-timeline-template/example/items | P grievance-timeline.tsx, grievance editors/status history/settlements; template item mappings and date calculation | Pass | B0 |
| F38 | Source complete | /contract/example/articles/edit | contracts-articles | /contractual/example | P contracts and contract article/section editors, outlines and Full Text assembly | Pass | B0 |
| F39 | Source complete | /sitespecific/btu/worker-import | btu-worker-import, btu-reference-maintenance, btu-cardcheck-import, btu-signature-import, btu-cardcheck-scraper, btu-building-rep-import, btu-dues-import | /sitespecific/btu/dues-allocation | P sitespecific/btu launcher and maintenance pages; W six BTU imports and their engine classes; worker absence termination and financial posting verified separately | Pass | B0 |
| F40 | Source complete | /sitespecific/gbhet/pension/payout-calculator | pension-calculation, pension-configuration | /sitespecific/gbhet/pension/plan-years | P sitespecific/gbhet pension calculator, annual summaries, plan and table editors; batch SLA/shares computation confirmation and pension consumers | Pass | B0 |
| F41 | Source complete | /reports/contact-export | contact-export, reports-and-exports, identity-anomaly-reports, ledger-integrity-report, dc-net-grant-report, dc-upload-review-report, edls-spacing-report, edls-population-report, election-only-one-report, gbhet-legal-report, employer-user-report, btu-invalid-cardcheck-report | /reports/workers | P reports.tsx, report-type.tsx, contact-export.tsx; W every report implementation; S modules/wizards.ts manifest uses plugin.id as type name | Pass | B0 |
| F42 | Source complete | /config/options/example/import | dropdown-options, configuration-navigation, entity-files-configuration, entity-notes-configuration, contact-field-configuration | /config/catalogs/example | P config/catalogs.tsx, options-import.tsx, entity-files.tsx, entity-notes.tsx; option import preview/apply plans and context-specific file contracts | Pass | B0 |
| F43 | Source complete; permissions reused | /admin/users/masquerade | masquerade, users-roles-policies, admin-user-permissions, session-flood-administration, auth-provisioning-settings, linked-user-settings | /admin/users/permissions | P config/masquerade.tsx, auth-settings.tsx, config/users editors; request effective-user handling and auth role reconciliation | Pass | B0 |
| F44 | Source complete | /admin/denorm/example | denorm-maintenance, system-status-logs, environment-timezone, record-metadata-maintenance, restart-reload, background-work-monitoring, administrative-file-browser, s1-migration-monitoring | /admin/metadata/backfill | P admin/denorm-detail.tsx, restart.tsx, metadata-backfill.tsx, wmb scan/ebs/file-browser; environment/timezone readers and actual asynchronous maintenance consumers | Pass | B0 |
| F45 | Source complete | /config/sftp/client/example/test | sftp-destinations, incoming-web-services, outgoing-web-services | /admin/ws/clients/example/test | P config/sftp/client-test.tsx, config/ws/client-test.tsx; admin/wc overview/cache/stats; network request, upload, and expiration effects | Pass | B0 |
| F46 | Source complete | /cron-jobs/example/run | cron-jobs, business-calendars | /config/business-calendars/example/test | P cron-job-run.tsx and calendar settings/exception/test views; manual-run consumers and calendar precedence | Pass | B0 |
| F47 | Source complete; defaults retained | /config/ledger/settings | ledger-authorization-settings, message-provider-configuration, gateway-testing-payment-types, ledger-payment-types, email-message-defaults, postal-message-defaults | /config/ledger/payment-types | P config/ledger/settings.tsx, gateway test/compatibility, payment-type editors and config/twilio.tsx; payment authorization validation and historical consent boundary | Pass | B0 |
| F48 | Source complete | /config/components | component-administration, site-appearance, help-text-listing, dashboard-plugin-configuration | /config/site | P config/components.tsx, site.tsx, terminology.tsx, helps.tsx; S help registry/API and component setup consumers | Pass | B0 |

## Pattern scope, boundaries, and source corrections

- Root record patterns such as `/ea/%`, `/dispatch/job/%`,
  `/contract/%`, `/events/%`, and `/trust/provider/%` necessarily also match
  nested tabs because `%` crosses slashes. They provide supplemental entity
  context only. They are **not** the completion evidence for scan, deletion,
  token issuance, sending, payment entry, file generation, or unrelated
  configuration. Those actions have focused entries and independent tests.
  The existing framework cannot express “one dynamic segment only.”
- `/workers/:id` is intentionally not bound to identity-editor help: the only
  available `/workers/%` spelling would also put identity-editing instructions
  on checkout, coverage, and other unrelated workflows. F22 is completed through
  its six identity editors, relationships, and contact editors, not a claimed
  root match. This precise route-level limitation is retained in the tests.
- Tests check list/detail boundaries, sibling tabs, nested wildcard behavior,
  case sensitivity, literal underscores, suffix near-misses, and trailing
  slashes. Exact-suffix patterns intentionally do not match an added slash.
  Terminal `%` patterns do; tests preserve that honest distinction.
- Plugin configuration uses concrete, offered adapter-kind paths. Noneditable
  manifest kinds (for example token/menu/wizard catalogs) are not invented CRUD
  pages. Eligibility, charging, notifications, cron, payment gateway,
  dashboard, data retention, denorm, quicksearch, worker-list, client injection,
  web service, and provider EDI have different guidance. `%` is not used as a
  generic kind fallback.
- Report-specific guidance is at verified `/reports/<plugin.id>` launch hosts,
  not `/wizards/<invented-type>`. BTU imports likewise use their six real
  launcher paths; the opaque runner gets only resumability/processing guidance.
- Current DP worker billing has Paid, Partially paid, and Unpaid. The original
  audit's “five labels” is not used to invent additional statuses.
- An ECHP confirmation records ECHP hours; it does not collect a payment on that
  page. Later charge consumers are separate. Premium-file generation, in
  contrast, posts offsetting payment entries and is not merely an export.
- COBRA lifecycle content was already shipped. Its entry and behavior are
  unchanged; the added setup entry covers finding/creating/editing cases only.
- Worker Communications Compliance describes recorded communication evidence,
  not a universal delivery-consent test. Existing stable guidance is retained.
- Staff bulk access is not implied by staff status: actual bulk policy and
  component prerequisites apply. Worker-own, staff, approver, and administrator
  capabilities are stated separately where consequential.

## Local overlap and preservation

The development database was inspected read-only using:

```sql
SELECT id, paths, summary, details FROM help ORDER BY id LIMIT 100;
```

The result contained zero rows, so no development-local overlap or contradiction
was available to inspect. No help database mutation or seeding was performed.
This does **not** establish that staging, production, or another organization's
database has no local help. Their local content and deployment-specific
procedures were unavailable and are not certified. Built-ins add alongside local
guidance; they do not replace it.

Existing Benefits Summary, worker communications compliance, user permissions,
message defaults, Trust Providers, payment help, and COBRA lifecycle files and
IDs remain unchanged.

## Verification record

- Pure registry/matcher/sanitization tests: see
  `tests/help/workflow-coverage.test.ts`, plus existing benefit-summary,
  worker-comms, COBRA, and payment-help tests. Content contracts cover
  high-consequence distinctions without snapshots of all prose.
- Source/API contract checks use the actual help registry, matcher, sanitizer,
  and help routes with a **test-only** authorization/storage harness. These do
  not establish a real signed-in session or deployment-local data.
- No scans, imports, message delivery, configuration changes, token issuance,
  paid-provider tests, or business-record mutations were used for verification.
- Browser and workflow observations are recorded below after the application
  restart. B0 remains explicit for protected pages; a sign-in screenshot cannot
  verify a dialog opened by clicking <strong>more</strong>.

### Observed results, 2026-10-20

- `npm test -- tests/help tests/sitespecific/worker-benefits-summary-help.test.ts tests/comm/worker-comms-help.test.ts tests/sitespecific/bao-cobra-help-routes.test.ts tests/ledger/payment-help.test.ts`:
  **6 files, 104 tests passed**. This includes the new 47-row inventory checks,
  scoped route expansion, pattern-host validation, semantic HTML/sanitization,
  safety distinctions, and authenticated-handler read harness.
- Registry contains **158 built-ins**, including the 12 pre-existing entries.
  None of those pre-existing content files were changed.
- `Start application` restarted on port 5000 and reported
  **Application fully initialized and ready**. This was a normal application
  startup; no manual cron run or business verification action was invoked.
- Real unauthenticated development requests to `/api/helps` and
  `/api/helps/lookup?path=%2Fconfig%2Fhelps` returned **401**, as intended.
- Desktop capture of `/config/helps` at 1280 × 900 rendered the sign-in page,
  not Help Text. Signed-in listing, inline summaries, expanded dialogs,
  mobile/long-content interaction, and alternate-role/optional-component views
  remain **not browser verified**. No account was created, credential read,
  or auth bypass installed to manufacture access.
- The capture browser logged a development hot-reload WebSocket connection
  refusal against its local capture origin. The page rendered and proxied HTTP
  auth checks answered; that log is not evidence about signed-in help rendering.
- `git diff --check` passed. The configured lint, typecheck, and migration
  gates run through task completion; they are separate from the results above.
