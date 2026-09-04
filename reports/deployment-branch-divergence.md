# Deployment branch divergence review

Generated: 2026-09-04T20:57:37Z
Current main: 75815817b29e64453086b4f328ffaca5d22e20b1

## bao-stg

- Tip: e2adedc58de2bfc0cff354f8510ec5aab1b4fde1
- Status: ancestor of main; no remote-only commits or changes.
- Main is 40 commits ahead.
- It was not pushed because the workflow pushes staging and the mirror atomically, and the mirror safety check failed.

## bao-replit-main

- Tip: 9c2ec2f49f79848a84461287549c2c2f8abf38c6
- Merge base: 237373a8acef62843981e572c82450f6ac4da233
- Main-only commits: 28
- Remote-only commits: 12

### Remote-only commits
```
9c2ec2f4 (push-workflow/bao-replit-main, push-workflow/bao-prd, push-workflow/bao-dev, origin/bao-replit-main, origin/bao-prd, origin/bao-dev) Reconcile origin/bao-replit-main before deployment push
b421b479 Reconcile origin/bao-dev before deployment push
2b27dfd7 Remove grievance appeal functionality and related migration scripts
a16b5d59 (subrepl-d7k95b0k) Reconcile origin/bao-prd before deployment push
8d0f8e0d Add initial BAO appeal intake and auto-denial wiring
037fb36b Reconcile origin/bao-replit-main before deployment push
9139bb85 Reconcile origin/bao-prd before deployment push
722b3c00 Reconcile origin/bao-dev before deployment push
da0f093b Reconcile origin/bao-replit-main before deployment push
79287cd4 (subrepl-v9enfhmi) Correct 2026 DP member charges: seed workbook member-charge amounts, confirmed no-charge family→family rows, shared DP pricing module for billing + payment gate (confirmed $0 on the subscriber's present benefits = covered free, decided before account/charge checks; provisional/missing fail closed), member-charge terminology in UI, regression tests for billing, eligibility and idempotent rate sync
e03e1403 Correct 2026 DP member charges: seed workbook member-charge amounts, confirmed no-charge family→family rows, shared DP pricing module for billing + payment gate (confirmed $0 = covered free, decided before account/charge checks; provisional/missing fail closed), member-charge terminology in UI, regression tests for billing, eligibility and idempotent rate sync
d7ae8140 Correct 2026 DP member charges: seed workbook member-charge amounts, confirmed no-charge family→family rows, shared DP pricing module for billing + payment gate (confirmed $0 = covered free, provisional/missing fail closed), member-charge terminology in UI, regression tests for billing, eligibility and idempotent rate sync
```

### Remote branch net changes since its merge base

These are the 16 files that caused the safety refusal:
```
M	client/src/App.tsx
M	client/src/hooks/useTabAccess.ts
M	client/src/pages/grievances-add.tsx
D	client/src/pages/grievances-appeal-add.tsx
D	scripts/migrate/components/grievance/030_create_options_grievance_denial_reason.ts
M	scripts/migrate/index.ts
M	server/modules/grievances/grievances.ts
M	server/modules/system/variable-registry.ts
M	server/storage/grievances/grievances.ts
M	server/storage/unified-options.ts
M	shared/components.ts
M	shared/schema.ts
M	shared/schema/grievance/schema.ts
M	shared/tabRegistry.ts
D	tests/grievances/appeal-intake.test.ts
D	tests/grievances/appeal-presentation.test.tsx
```

### Net-change statistics
```
 client/src/App.tsx                                 |   9 -
 client/src/hooks/useTabAccess.ts                   |  11 +-
 client/src/pages/grievances-add.tsx                |  10 +-
 client/src/pages/grievances-appeal-add.tsx         | 354 ----------
 .../030_create_options_grievance_denial_reason.ts  |  61 --
 scripts/migrate/index.ts                           |   1 -
 server/modules/grievances/grievances.ts            |  12 +-
 server/modules/system/variable-registry.ts         |  12 -
 server/storage/grievances/grievances.ts            |   7 -
 server/storage/unified-options.ts                  |   2 -
 shared/components.ts                               |   2 +-
 shared/schema.ts                                   |  12 -
 shared/schema/grievance/schema.ts                  |  87 ---
 shared/tabRegistry.ts                              |  10 +-
 tests/grievances/appeal-intake.test.ts             | 726 ---------------------
 tests/grievances/appeal-presentation.test.tsx      |  72 --
 16 files changed, 7 insertions(+), 1381 deletions(-)
```

### Current tip-to-tip differences

There are 194 differing files between the branch tips.
The complete list is included below; this includes all newer main work, not just the remote-only patch.
```
M	.agents/memory/MEMORY.md
A	.agents/memory/appeal-outcome-cross-component-grant.md
M	.agents/memory/component-migration-push-parity.md
A	.agents/memory/component-migration-unwired-file.md
A	.agents/memory/context-filtered-picker-resend.md
A	.agents/memory/context-framework-gating.md
A	.agents/memory/dc-coverage-axis-model.md
A	.agents/memory/dc-test-suite-isolation.md
M	.agents/memory/dev-local-auth-curl.md
A	.agents/memory/dev-ui-verification-login.md
M	.agents/memory/dual-db-driver-and-bootstrap.md
A	.agents/memory/entity-files-adapter-fork-extension.md
A	.agents/memory/exemption-provenance-contract.md
M	.agents/memory/migration-version-collision.md
A	.agents/memory/nav-section-fed-by-server-registry.md
A	.agents/memory/notifier-postal-template-channel.md
A	.agents/memory/polymorphic-child-cleanup.md
M	.agents/memory/post-merge-verification.md
A	.agents/memory/task-completion-flow-quirks.md
M	.agents/memory/upstream-merge-playbook.md
A	.agents/memory/whole-job-eligibility-without-facts.md
M	.agents/skills/merge-resolver/SKILL.md
A	attached_assets/Pasted-I-d-like-to-build-support-for-deletions-and-orphan-clea_1788524199320.txt
A	attached_assets/Screenshot_2026-09-04_at_2.48.53_PM_1788547742088.png
M	client/src/App.tsx
M	client/src/components/auth/ProtectedRoute.tsx
M	client/src/components/comm/CommPostal.tsx
M	client/src/components/entity-files/EntityFileManager.tsx
R087	client/src/components/notes/NotesPanel.tsx	client/src/components/entity-notes/EntityNotesPanel.tsx
R097	client/src/components/notes/NoteCard.tsx	client/src/components/entity-notes/NoteCard.tsx
R100	client/src/components/notes/note-display.ts	client/src/components/entity-notes/note-display.ts
M	client/src/components/json-schema-form/widgets/RemoteOptionsWidget.tsx
M	client/src/components/layouts/ConfigurationLayout.tsx
M	client/src/components/layouts/OptionsLayout.tsx
A	client/src/components/shared/BackToOptions.tsx
M	client/src/components/shared/GenericOptionsPage.tsx
A	client/src/components/sitespecific/bao/AppealOutcomeCard.tsx
A	client/src/components/sitespecific/bao/BaoCaseDocumentsCard.tsx
A	client/src/components/sitespecific/bao/CaseLettersCard.tsx
M	client/src/components/sitespecific/bao/CaseListPanel.tsx
M	client/src/components/sitespecific/bao/DcMemberCasePanel.tsx
A	client/src/components/sitespecific/bao/DcMonthStates.tsx
A	client/src/components/sitespecific/bao/GrantedExemptionsCard.tsx
M	client/src/components/sitespecific/bao/dc-shared.tsx
M	client/src/components/template-studio/NotifierTemplateStudio.tsx
M	client/src/components/template-studio/TemplateStudio.tsx
A	client/src/components/trust/ExemptionSourceLabel.tsx
A	client/src/components/type-filter.tsx
M	client/src/config/navigation-registry.ts
A	client/src/hooks/useConfigNavigation.ts
M	client/src/hooks/useTabAccess.ts
M	client/src/pages/config/dispatch-job-types.tsx
M	client/src/pages/config/edls/tasks.tsx
M	client/src/pages/config/entity-files.tsx
A	client/src/pages/config/entity-notes.tsx
M	client/src/pages/config/event-types.tsx
M	client/src/pages/config/index.tsx
M	client/src/pages/config/ledger-payment-types.tsx
A	client/src/pages/config/options-index.tsx
A	client/src/pages/employers/files.tsx
M	client/src/pages/employers/notes.tsx
M	client/src/pages/grievance-notes.tsx
M	client/src/pages/grievances-add.tsx
A	client/src/pages/grievances-appeal-add.tsx
M	client/src/pages/sitespecific/bao/case-detail.tsx
M	client/src/pages/sitespecific/bao/case-new.tsx
M	client/src/pages/sitespecific/bao/dc-case-detail.tsx
M	client/src/pages/sitespecific/bao/dc-queue.tsx
A	client/src/pages/trust-provider-files.tsx
M	client/src/pages/trust-provider-notes.tsx
M	client/src/pages/worker-benefits-exemptions.tsx
M	client/src/pages/worker-ratings.tsx
M	client/src/pages/worker-sitespecific-bao-dc.tsx
A	client/src/pages/workers/files.tsx
M	client/src/pages/workers/notes.tsx
M	replit.md
M	scripts/check-migrations.ts
A	scripts/dev/check-component-manifest-coverage.ts
M	scripts/dev/check-html-utils.ts
M	scripts/dev/lint.ts
D	scripts/migrate/components/grievance/029_create_grievance_files.ts
A	scripts/migrate/components/grievance/030_create_options_grievance_denial_reason.ts
M	scripts/migrate/components/sitespecific.bao/009_create_notes_tags.ts
M	scripts/migrate/components/sitespecific.bao/010_create_case_management.ts
M	scripts/migrate/components/sitespecific.bao/014_dc_extensions_and_notes_retirement.ts
A	scripts/migrate/components/sitespecific.bao/016_benefit_appeal_tables.ts
A	scripts/migrate/components/sitespecific.bao/017_create_case_comms.ts
A	scripts/migrate/components/sitespecific.bao/018_create_case_documents.ts
A	scripts/migrate/components/sitespecific.bao/019_case_status_lapse.ts
A	scripts/migrate/core/1145_create_entity_files.ts
A	scripts/migrate/core/1146_rename_notes_to_entity_notes.ts
A	scripts/migrate/core/1147_rename_entity_notes_entity_type_to_context_id.ts
A	scripts/migrate/core/1148_rename_trust_provider_file_context.ts
A	scripts/migrate/core/1149_create_options_file_type.ts
A	scripts/migrate/core/1150_rename_note_type_entity_types_key.ts
M	scripts/migrate/index.ts
M	scripts/oneoffs/s1-log-notes-bench.ts
M	scripts/s1-migration/load-log-notes.ts
M	server/app-init.ts
M	server/modules/access-policies.ts
A	server/modules/entity-contexts.ts
A	server/modules/entity-files-contexts.ts
M	server/modules/entity-files.ts
A	server/modules/entity-notes-contexts.ts
A	server/modules/entity-notes.ts
M	server/modules/files.ts
D	server/modules/grievances/grievance-files-context.ts
M	server/modules/grievances/grievances.ts
D	server/modules/notes.ts
M	server/modules/options-registry.ts
M	server/modules/options-routes.ts
M	server/modules/options-write-rules.ts
A	server/modules/sitespecific/bao/case-files-context.ts
M	server/modules/sitespecific/bao/cases.ts
M	server/modules/sitespecific/bao/dc-files-context.ts
M	server/modules/sitespecific/bao/disability-credit.ts
M	server/modules/system/variable-registry.ts
M	server/plugins/dispatch/eligibility/index.ts
A	server/plugins/dispatch/eligibility/plugins/started.ts
M	server/plugins/event-notifier/dispatcher.ts
M	server/plugins/event-notifier/index.ts
A	server/plugins/event-notifier/plugins/bao-case-member-notice.ts
A	server/plugins/event-notifier/plugins/bao-case-record.ts
M	server/plugins/event-notifier/plugins/bao-case-status-notifier.ts
M	server/plugins/event-notifier/template-schema.ts
M	server/plugins/event-notifier/token-templates.ts
M	server/plugins/event-notifier/types.ts
M	server/plugins/system/cron/index.ts
A	server/plugins/system/cron/plugins/baoCaseDeadlineLapse.ts
A	server/plugins/system/cron/plugins/filesOrphanSweep.ts
M	server/plugins/system/cron/plugins/notesOrphanSweep.ts
M	server/plugins/tokens/index.ts
M	server/plugins/tokens/plugins/field.ts
A	server/plugins/tokens/plugins/sitespecific-bao-appeal.ts
M	server/plugins/tokens/plugins/sitespecific-bao-case.ts
M	server/routes.ts
A	server/services/entity-files/cleanup.ts
M	server/services/entity-files/config.ts
A	server/services/entity-files/delete-cleanup.ts
M	server/services/entity-files/registry.ts
A	server/services/entity-notes/cleanup.ts
A	server/services/entity-notes/config.ts
A	server/services/entity-notes/delete-cleanup.ts
A	server/services/entity-notes/registry.ts
M	server/services/event-bus.ts
A	server/services/sitespecific/bao/appeal-outcomes.ts
M	server/services/sitespecific/bao/dc-grant.ts
A	server/services/sitespecific/bao/dc-month-map.ts
M	server/services/sitespecific/bao/dc-reporting.ts
M	server/services/sitespecific/bao/dc-workflow.ts
M	server/storage/database.ts
M	server/storage/employers/employers.ts
A	server/storage/entity-files-context-tables.ts
A	server/storage/entity-files.ts
A	server/storage/entity-notes-context-tables.ts
R069	server/storage/notes.ts	server/storage/entity-notes.ts
D	server/storage/grievances/grievance-files.ts
M	server/storage/grievances/grievances.ts
M	server/storage/index.ts
D	server/storage/notes-entity-types.ts
M	server/storage/sitespecific/bao/cases.ts
M	server/storage/sitespecific/bao/disability-credit.ts
M	server/storage/trust/eligibility-exemptions.ts
M	server/storage/trust/providers.ts
M	server/storage/unified-options.ts
M	server/storage/workers.ts
M	shared/components.ts
M	shared/delivery-fields.ts
D	shared/notes.ts
M	shared/schema.ts
M	shared/schema/grievance/schema.ts
M	shared/schema/sitespecific/bao/schema.ts
M	shared/schema/trust/eligibility-exemptions-schema.ts
M	shared/sitespecific/bao/dc-reporting.ts
M	shared/sitespecific/bao/dc-workflow.ts
M	shared/tabRegistry.ts
M	shared/utils/html/index.ts
A	shared/utils/html/letter-page.ts
A	tests/dispatch/job-started-eligibility.test.ts
A	tests/grievances/appeal-intake.test.ts
A	tests/grievances/appeal-presentation.test.tsx
M	tests/notes/bao-note-tags.test.ts
M	tests/notes/bulk-reconcile-migration.test.ts
M	tests/notes/note-display.test.tsx
M	tests/sitespecific/bao-case-management.test.ts
A	tests/sitespecific/bao-case-member-notice.test.ts
M	tests/sitespecific/bao-case-routes.test.ts
M	tests/sitespecific/bao-dc-grant.test.ts
M	tests/sitespecific/bao-dc-routes.test.ts
M	tests/sitespecific/bao-dc-workflow.test.ts
M	tests/sitespecific/bao-disability-credit.test.ts
M	tests/sitespecific/bao-migration-registry.test.ts
A	tests/sitespecific/fixtures/bao-schema.ts
A	tests/storage/table-exists-cache.test.ts
```
