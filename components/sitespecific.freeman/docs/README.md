# Freeman components

Freeman is three optional components, one directory each:

| Directory | Owns |
| --- | --- |
| `components/sitespecific.freeman` | Crew leads (schema, storage, list, embedded crew UI), second-shift worker UI, Passport export web service, T631 identity strategy, deployment-branch docs and operator tools |
| `components/sitespecific.freeman.authorization` | Bearer authorization vendor, inbound `freeman-bearer` authentication provider, the client authorization tab and the legacy-selection upgrade |
| `components/sitespecific.freeman.edls_migrate` | The EDLS migration vendor, staging table, import/sweep/recovery, and the migration admin page |

`edls_migrate` depends on `edls` and `sitespecific.freeman` (it resolves crew
leads through the base component). `authorization` has no dependencies.
Contracts are documented in `docs/optional-components.md`.

## Installation and removal

Stop the application before adding or removing a directory, then run
`npm run components:discover`, check, build and restart. To retire the
migration tool, delete `components/sitespecific.freeman.edls_migrate`; to
retire bearer authorization, delete `components/sitespecific.freeman.authorization`.
Removing the base directory requires removing `edls_migrate` too (discovery
refuses otherwise). Keep the same component IDs and migration versions on
reinstallation. Source removal does not delete tables, flags, worker
identifiers, vendor configurations or incoming clients.

The three component flags remain independent. Passport export additionally
requires EDLS. T631 synchronization requires the main customization component:
without its identity authority, the entire synchronization refuses before
worker creation, phone/status changes or deactivation. It does not guess
identities from a weaker key.

Incoming clients use a persisted `authenticationProvider` selection in their
data. Startup (in the authorization component) upgrades the old
`freemanBearerAuthorizationConfigId` selection using a compare-and-set write on
the core client record, including when the feature is disabled. Old selections
still work before that upgrade, and remain fail-closed even in a build that
omits the authorization component. A missing or disabled provider never
enables client-secret authentication. Clearing the selection explicitly
chooses client-secret authentication.

The accepted bearer semantics are unchanged: the issued client ID selects
the incoming client; the vendor-backed bearer is the credential check.
IP restrictions and client activity still apply.

## Operations and verification

- The existing auto-approve tool is in `scripts/tools/`.
- `scripts/dev/workflow.toml` preserves the former development branch workflow
  definition; it is not installed in a host that omits this component.
- Branch-specific deployment instructions are in `deployment-branches.md`.
- `scripts/migrate/core/1024_drop_freeman_crewleads.ts` retains its original
  global migration identity. It is not converted into a component migration.
- Run Freeman checks with `npm test -- components/sitespecific.freeman`
  (the prefix matches all three directories).
- The host's generic authentication and missing-strategy tests also run
  without any installed component.

The disposable migration feature and its staged records are intentionally
retained. Correcting migration-artifact data is separate work.
