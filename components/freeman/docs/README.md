# Freeman package

This directory owns the component definitions, migrations, routes, embedded
crew-lead UI, second-shift worker UI, Passport export, bearer authentication,
T631 identity strategy, vendor operations, maintenance declarations and tools.
Host contribution contracts are documented in `docs/component-packages.md`.

## Installation and removal

Stop the application before adding or removing the directory, then run
`npm run packages:discover`, check, build and restart. Keep the same component
IDs and migration versions on reinstallation. Source removal does not delete
tables, flags, worker identifiers, vendor configurations or incoming clients.

The three component flags remain independent. Passport export additionally
requires EDLS. T631 synchronization requires the main customization component:
without its identity authority, the entire synchronization refuses before
worker creation, phone/status changes or deactivation. It does not guess
identities from a weaker key.

Incoming clients use a persisted `authenticationProvider` selection in their
data. Startup upgrades the old `freemanBearerAuthorizationConfigId` selection
using a compare-and-set write on the core client record, including when the
feature is disabled. Old selections still work before that upgrade, and
remain fail-closed even in a build that omits this package. A missing or
disabled provider never enables client-secret authentication. Clearing the
selection explicitly chooses client-secret authentication.

The accepted bearer semantics are unchanged: the issued client ID selects
the incoming client; the vendor-backed bearer is the credential check.
IP restrictions and client activity still apply.

## Operations and verification

- The existing auto-approve tool is in `scripts/tools/`.
- `scripts/dev/workflow.toml` preserves the former development branch workflow
  definition; it is not installed in a host that omits this package.
- Branch-specific deployment instructions are in `deployment-branches.md`.
- `scripts/migrate/core/1024_drop_freeman_crewleads.ts` retains its original
  global migration identity. It is not converted into a component migration.
- Run package checks with `npm test -- components/freeman/tests`.
- The host's generic authentication and missing-strategy tests also run
  without any installed package.

The disposable migration feature and its staged records are intentionally
retained. Correcting migration-artifact data is separate work.
