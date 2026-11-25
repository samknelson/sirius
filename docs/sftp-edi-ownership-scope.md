# File transfers (SFTP/FTP) and Trust Provider EDI — ownership and extraction scope

Status: **APPROVED (2026-11-25) — Option C: extract SFTP and EDI together in
one change. Not yet implemented.**
Companion to `docs/system-component-relocation.md` (items 4 and 5 of its
"Reviewed later removal design").

## 1. The real blocker (re-verified)

`system.sftp.client` lives in `components/system.sftp.client/` as
`coreRegistered: true`. Its one mandatory consumer, `trust.providers.edi`, is
still core-defined and core-located:

| Link | Where | Nature |
| --- | --- | --- |
| Declared dependency | `shared/components.ts` → `trust.providers.edi.schemaManifest.dependsOnComponents: ["system.sftp.client"]` | enable flow refuses EDI without SFTP |
| Restrict FK | `shared/schema/trust/provider-edi-schema.ts` → `plugin_configs_trust_provider_edi_sftp_client_id_fk` → `sftp_client_destinations.id` `ON DELETE RESTRICT` | a destination used by an EDI config cannot be deleted |
| Direct storage use | `server/plugins/wizards/plugins/trust-provider-edi.ts` → `ctx.storage.sftpClientDestinations.getById` (results + deliver steps) | reads the destination record |
| Direct transfer use | same file → dynamic imports of the connection schema and `file-transfer-client.testUpload` | performs the FTP/SFTP upload |
| Picker endpoint | `server/plugins/trust/provider-edi/index.ts` → `/api/sftp/client-destinations` | EDI config form lists destinations |

Deleting `components/system.sftp.client/` alone fails at compile time (core
imports it). The discovery check only validates `dependsOn` of *directory*
components, so a core-defined dependent is not even reported clearly. Single
directory deletion does not work and must not be claimed to.

## 2. Ownership decision

The owner chose **Option C**. Options A and B are kept for the record.

**Option A — Retain SFTP core-registered (no structural change).**
Record that SFTP stays core-registered as long as EDI is core. Cost: doc and
memory only. SFTP remains non-removable.

**Option B (not chosen) — Relocate EDI next to SFTP, then extract the pair.**
Stage B1 moves EDI into `components/trust.providers.edi/` as
`coreRegistered: true` (move-only, same as the SFTP relocation). Stage B2,
separately approved, extracts both components together. After B2, deleting
SFTP fails discovery with the existing clear message ("depends on
system.sftp.client … remove trust.providers.edi too"); deleting both works.

**Option C (APPROVED) — Extract SFTP and EDI in one step.** Both directories
become optional components (no `coreRegistered`) in one change. Sections 3–5
together are the implementation scope: §3 is the file inventory to move into
`components/trust.providers.edi/`, §4 the contribution wiring that replaces
every core reference listed in §3, §5 the record-go seam. Review the diff as
move-first (import-only bodies), then wiring. After it lands, deleting SFTP
alone fails discovery with the existing clear message; deleting both works.

In every option: the FK stays `RESTRICT` and is not renamed; the dependency
stays declared in the EDI definition; FTP, FTPS/TLS modes and SFTP keep
working; no tables, rows, migrations or URLs change; no transfer capability
or provider abstraction is introduced.

## 3. EDI file inventory (moves into its component directory)

Under Option C the manifest is a full optional manifest (see §4); the B1
`coreRegistered` shape below is kept only as the move list's origin.

Manifest: `components/trust.providers.edi/component.json`
`{ "coreRegistered": true, "schema": ["shared/schema/trust/provider-edi-schema.ts"] }`.
The definition stays in `shared/components.ts` (`schemaPath` updated).

Files moved (imports-only changes):

- `shared/schema/trust/provider-edi-schema.ts` (FK unchanged; import of the
  destination schema now a sibling-component import, allowed by the declared
  dependency).
- `server/plugins/trust/provider-edi/` — `index.ts`, `registry.ts`, `base.ts`.
- `server/plugins/trust/provider-edi/plugins/sitespecific-bao-healthnet.ts`,
  `sitespecific-bao-kaiser.ts` — they register into the EDI registry and keep
  their `requiredComponent: "sitespecific.bao"` gate. They must move with EDI,
  or EDI can never be extracted (core cannot import an optional component).
- `server/plugins/wizards/plugins/trust-provider-edi.ts`.
- `server/modules/trust/provider-edi-dashboard.ts`,
  `server/plugins/dashboard/plugins/edi-summary.ts`.
- `client/src/pages/trust/provider-edi-dashboard.tsx`,
  `client/src/plugins/dashboard/edi-summary/EdiSummary.tsx`,
  `client/src/plugins/wizards/trust_provider_edi/` (4 step components).
- `scripts/migrate/components/trust.providers.edi/001_*`, `002_*`
  (bodies, versions, names and order unchanged).

Core keeps direct references (retargeted imports): `shared/schema.ts`
aggregate, `plugin-configs.ts` / `plugin-configs-subsidiary.ts` subsidiary
storage, `server/plugins/wizards/index.ts`, `server/plugins/dashboard/index.ts`,
`server/app-init.ts`, `server/routes.ts`, `client/src/App.tsx`, menu default
plugin, `scripts/migrate/index.ts`, the storage-encapsulation allowlist,
`tests/edi/`. The client wizard/dashboard globs (`./*/*.tsx`) will no longer
see moved files — B1 must add explicit entries or keep those two client
folders in core until B2 (decide in B1 review; keeping them is simpler).
`configuration-revision-ddl.ts` names the table as a string guarded by
`to_regclass` — unchanged.

Verification: discovery, architecture lint (component imports), production
build, `tests/edi`, typecheck, a source comparison proving import-only diffs,
and an EDI config save + wizard dry run without an external transfer.

## 4. Extraction wiring for both components (approved with Option C)

Reuse existing manifest contributions — `definition`, `schema`, `migrations`,
`storage`, `server` side-effect modules, `startup` (register/registerRoutes/
start), `metadata`, shared `contributions` (menu, tabs), browser `client`
(routes, navigation). These already cover: definitions, schemas, migrations,
destination storage, SFTP routes, EDI routes, kind/plugin/wizard/dashboard
server registration, menu item, `/trust/provider-edi` and `/config/sftp/*`
routes, SFTP tab tree.

Seams that existing contributions do **not** cover (each a small additive,
typed field on an existing manifest contribution — no new loader):

1. **Plugin-config subsidiary storage.** `plugin-configs.ts` holds a closed
   `kind → SubsidiaryStorage` map. Needed: an optional typed storage
   contribution entry for a component-owned subsidiary, refusing duplicate
   kinds at boot.
2. **Client plugin components (dashboard widget, wizard steps).** Both
   registries are core folder globs. Needed: an optional typed browser
   contribution of `{ key, component }` per registry, refusing duplicate keys.
3. **Record-go access requirement** (see §5).
4. **Destination storage typing.** `ctx.storage.sftpClientDestinations` is a
   core `DatabaseStorage` member; it moves to the component `storage`
   contribution and EDI reads it through that (dependency declared).

Stays core: the `trust_providers` / `plugin_configs` tables the EDI FKs point
at, the configuration-revision trigger list (string + `to_regclass`), the
outbound maintenance guard (moves via `maintenanceGuards` for
`file-transfer-client.ts`).

## 5. Record-go: the SFTP access-map entry

Checked existing declarations:

- Component `metadata` contribution (`MetadataRecordContext`): table, label,
  href, component gate — **no access requirement**. The component gate alone
  would drop the `admin` policy, i.e. widen access. Not sufficient.
- Tab registry (`sftpClientDestinationTabTree`, `permission: 'admin'`): a
  client navigation hint, not the server authorization used by /go and
  quicksearch. Reusing it would couple authorization to tab layout. Not
  appropriate.
- Entity-location (token) declarations: describe where records live, not who
  may see them. Not applicable.

So no existing declaration can supply it. Approved (part of the extraction): add an optional
`recordGo?: RecordGoAccessRequirement` field to `MetadataRecordContext` in the
**existing** `metadata` contribution. The SFTP component declares
`sftp_client_destinations` with `{ kind: "policy", id: "admin", componentId:
"system.sftp.client" }` (identical to today). Rules:

- `recordGoAccessRequirement()` returns the core map entry or the component
  declaration; a context id declared by both, or by two components, throws at
  boot (today the spreads silently let core win).
- Absent declaration still fails closed. It is a requirement, never a grant;
  no alter hook, no ability to change another context's requirement.
- The `sftp_client_destinations` metadata context moves from core
  `entity-metadata-record-tables.ts` into the component's `metadata` module.

## 6. Out of scope

Weakening/dropping the FK or dependency, a transfer capability/provider
framework, dropping FTP or TLS modes, data migration or deletion, URL or
permission changes, new permanent UI tests, and extraction of
`system.session_history` (separate boundary, already documented).
