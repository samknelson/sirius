# System child relocation handoff

## Status and inventory

`system.session_history` and `system.sftp.client` use the existing
`coreRegistered: true` contract. **Directory deletion is not yet supported.**
These are the only two registered `system.*` component IDs. The directories
preserve host-relative paths; implementations were moved, not copied.

Under `components/system.session_history/`:

- `shared/schema/system/session-history-schema.ts` and `shared/session-history.ts`
  (the dedicated paging/response contract).
- `server/storage/system/session-history.ts`, `server/services/session-history.ts`.
- `client/src/pages/admin/user-session-history.tsx`.
- `server/plugins/event-notifier/plugins/new-ip-sign-in.ts`.
- `server/plugins/system/data-retention/plugins/sessionHistory.ts`.
- All three `scripts/migrate/components/system.session_history/` migrations:
  version 1 `create_session_history`, version 2 `add_device_id`, version 3
  `require_user_id`. Bodies, component scope, names, versions and invocation
  order are unchanged; only imports changed. No new DDL, backfill or replay
  mechanism was introduced.

Under `components/system.sftp.client/`:

- `shared/schema/system/sftp-client-schema.ts`.
- `server/storage/sftp-client-destinations.ts`,
  `server/modules/sftp-client-destinations.ts`,
  `server/services/file-transfer-client.ts`.
- `client/src/components/layouts/SftpClientLayout.tsx`.
- All six `client/src/pages/config/sftp/` pages: clients, details, connection,
  test, edit and logs. The execution branch had two more wholly owned pages
  than the initial four-page inventory.

Both FTP and SFTP, TLS modes, transfer operations, logging, existing URLs,
authorization, tabs and switches remain unchanged. History remains
user-associated, without storage audit logging or entity metadata; retention
still requires explicit opt-in.

## Retained mixed files and direct references

Core retains component definitions in `shared/components.ts`, aggregate
`shared/schema.ts` and `server/storage/database.ts`, the history API in
`server/modules/users.ts`, the Passport observer in `server/auth/sign-in-events.ts`,
listener initialization in `server/app-init.ts`, plugin index imports in
`server/plugins/event-notifier/index.ts` and
`server/plugins/system/data-retention/index.ts`, route registration in
`server/routes.ts`, and explicit historical imports in `scripts/migrate/index.ts`.
Their direct imports now point into the transitional directories.

`client/src/App.tsx` keeps its explicit lazy routes with corrected imports.
`shared/tabRegistry.ts`, `client/src/config/navigation-registry.ts` and
`server/services/record-go.ts` retain their unchanged declarations/access map.
Test imports/mocks follow the new paths. Discovery regenerates the schema
loaders; the outbound maintenance scanner's module and exemption keys follow
the transfer service to preserve its existing coverage.

Trust EDI stays in its current ownership:
`shared/schema/trust/provider-edi-schema.ts` directly imports the destination
schema and retains the restrict FK;
`server/plugins/wizards/plugins/trust-provider-edi.ts` directly imports the
connection schema and transfer service, and still uses destination storage.
The `trust.providers.edi` dependency on `system.sftp.client` is unchanged.

Generic authentication/provider verification, restoration, device-cookie
provisioning, browser-profile UUID infrastructure, request context, live
sessions, system plugin kinds, processes and semaphores remain core.

## Reviewed later removal design — not implemented

1. **Reuse normal manifest contributions.** Existing definitions, schema,
   migrations, storage factories, side-effect server modules, startup
   register/registerRoutes/start, metadata, shared tabs and browser
   routes/navigation already cover declarations. Replace explicit composition
   with these contributions in a separately approved extraction. Do not add a
   parallel loader, route registry, storage or transfer-provider framework.
2. **Separate the actual history invocation boundary.** The moved history
   service still orchestrates the generic successful-sign-in event, including
   when history is disabled. That mixed responsibility was moved intact.
   Later leave successful-login observation/event delivery in core and register
   a narrowly typed history observer/enricher for its history-specific work.
   Preserve history-before-notifier classification, session-save duplicate
   suppression and restored-upstream-authentication suppression. Absent/disabled
   history must yield null history decisions and no history-table access,
   never a failed login. Do not publish session IDs, authentication correlation
   references or browser-profile UUIDs on the general bus. Reuse session
   save/touch subscriptions, register before requests, and retain independent
   transactions and failure isolation.
3. **Keep shared auth core.** Component startup should eventually own history
   subscribers, retention/notifier registration, storage and the current
   `/api/admin/users/:id/session_history` route with identical admin
   authorization. Do not extract shared authentication to eliminate an import.
   History storage must stay outside audit logging and entity metadata.
4. **Coordinate the real EDI dependent.** Full optional SFTP extraction requires
   separately reviewed relocation/extraction of its mandatory EDI consumer,
   or keeping SFTP core-registered. Preserve the FK and explicit dependency.
   Do not hide them behind a transfer capability abstraction, weaken them,
   discard data or silently disable behavior. Missing required dependencies
   should fail discovery clearly. Deleting only SFTP cannot work yet.
5. **Resolve record-go's declaration seam.** First check whether an existing
   component-owned entity/access declaration can provide its SFTP requirement.
   If none can, add a small additive typed mapping registration preserving
   authorization and duplicate handling, not an access-granting alter hook.

## Verification

- Discovery and production build passed.
- Architecture lint passed all 16 rules, including component imports,
  schema/FK table ordering, storage encapsulation and maintenance guards.
- Broad existing auth/history/notifier/retention/retained-schema checks:
  604 passed, one pre-existing failure in
  `tests/auth/account-revocation-storage.test.ts` (its event-bus mock lacks
  `registerComponentEvent` required by the T631 interviews component).
  Reproduced the identical failure from unchanged HEAD in an isolated
  temporary checkout; no unrelated test repair was included.
- Temporary route smoke checks exercise SFTP unauthenticated/admin/disabled
  refusals and saving FTP/SFTP connection settings without external transfers.
  The existing history API tests exercise admin/component refusal, paging,
  cache policy and failure redaction. No new permanent tests were added.
- A source comparison verified all 21 moved implementations differ only in
  imports, including the three historical migration bodies. The application
  restarted and served the existing sign-in screen at the SFTP address.
  Signed-in pages were not visually verified; production browser compilation
  and the route checks cover their resolution and guards.
