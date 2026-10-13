# Shared configuration freshness

## Guarantee and limits

Every applicable backend role (`api-user` and `api-ws`) runs one infrastructure
watcher, independent of plugin cron scheduling. Its default interval is **five
seconds**, matching the existing component refresh. In a healthy system, a
committed edit is normally observed within five seconds plus the time needed
to read and reload the affected participants. This is eventual consistency, not
an instantaneous fleet-wide barrier. Already-running requests/jobs/connections
can finish using their previous configuration.

The PostgreSQL revision is durable and changes in the **same transaction** as
the mutation. A rollback changes neither; concurrent arithmetic upserts cannot
lose increments. Revisions are read as decimal strings, not JavaScript numbers.
Deletion, same-value writes, missed polls and process restarts are detectable.
Local storage commits also request a prompt coalesced refresh, and existing
after-commit plugin slice invalidation remains synchronous. Direct SQL writes
are detected at the next poll without needing a process-local event.

During a database outage there is **no finite convergence guarantee**. Failed
revision reads leave prior completion markers untouched. Failed participants
remain pending and retry on the next healthy poll even if no further edit
occurs. Environment overrides, terminology, maintenance and cron retain the last
confirmed state on failed reads. Component gates retain their existing
failure-closed behavior. A failed maintenance read never becomes an exit.
Failure messages are logged; successful sibling refreshes are not repeated
solely because another participant failed.

## Reviewed inventory

| State | Policy | Roles / dependencies |
| --- | --- | --- |
| Enabled plugin-config slices (`plugin-config-cache`) | Lazy invalidation on `plugins` revision; next read rebuilds | Both API roles; per-kind generation rejects obsolete loads |
| Environment override map (`env-overrides`) | Active reload on `environment` | Both API roles; real non-released environment values still take precedence |
| Site terminology (`modules/terminology`) | Active reload on `terminology` | Both API roles; deletion restores default terms |
| Maintenance flag (`maintenance-mode`, import-free `maintenance-flag`) | Active reload on `maintenance` | Both API roles; pool read-only control and vendor refusal use the same flag |
| Live cron schedule (`cron/scheduler`) | Active reload on `cron`; stage before replacing old jobs | `api-user` only; plugin invalidation and maintenance refresh precede it |
| Component state (`component-cache`) | Authoritative storage read **every tick**, including unchanged flags / changed commits | Both API roles; existing permissions, access-cache and catalog listeners retained |
| Derived component permission/catalog caches | Existing component revision/listener invalidation | Not replaced by a generic cache clear |
| Filesystem configuration/providers (`files`) | Explicit selected reload or global admin reload only | Both API roles; override map must succeed first |
| Access policy decisions | Existing five-minute TTL and existing targeted invalidations | Separate authorization consistency concern, not indiscriminately cleared |
| Authentication/provider wiring, session middleware, DB connections, process timezone and module constants | Restart-only where already declared | Override-map freshness does not hot-swap captured wiring |
| Static code registries, signing/encryption material | Intentionally pinned | No blanket clear or rotation |
| Webclient/vendor response caches, geocode answers, mutable business-data caches | Their existing domain-specific lifetimes/invalidations | Outside this configuration framework |

`FILESYSTEMS` remains classified **reload**, not immediate. An ordinary
`ENV_FILESYSTEMS` edit updates the override map but does not reconstruct providers
until a selected or global reload. Restart baselines continue to show
restart-only values waiting on restart. Refreshing the map does not claim to
apply them. Synchronous/lazy environment readers see the new effective override;
boot-captured readers retain their original values.

## Mutation boundary and schema lifecycle

The core migration creates `configuration_revisions`, the trigger function and
an idempotent installer. Triggers cover INSERT / UPDATE / DELETE on:

- `variables`: only `ENV_*`, `site_terminology` and `system_mode` affect scoped
  revisions. Renames evaluate **both old and new names**. Prefix bulk deletes,
  upserts and direct SQL repairs are covered. Unrelated variables do not reload
  configuration. `components` remains independently observed through its
  authoritative row/version read.
- `plugin_configs`: every base mutation invalidates plugin slices; old/new
  `plugin_kind = 'cron'` additionally changes the cron revision.
- Subsidiaries: `plugin_configs_charge`, `plugin_configs_dashboard`,
  `plugin_configs_quicksearch`, `plugin_configs_wc_vendors`,
  `plugin_configs_event_notifier`, `plugin_configs_cron`,
  `plugin_configs_dispatch`, `plugin_configs_benefit_eligibility`,
  `plugin_configs_trust_provider_edi`. Cron subsidiary changes also change the
  cron revision.

This covers generic routes, direct storage callers, singleton boot repairs,
component enable/disable repairs, legacy backfills, subsidiary namespace writes
and cascading deletes without relying on route hooks. Row triggers do not
cover operator `TRUNCATE` or table replacement: these are not ordinary settings
mutations; reinstall the infrastructure and issue a global invalidation after
such deliberate schema maintenance.

Optional component tables are skipped when absent. Component schema creation
installs missing triggers before configuration backfills. Schema bring-up
reinstalls functions/missing triggers under the existing exclusive boot lock,
before maintenance enforcement, including fresh databases whose bootstrap
stamps past numbered migrations. Retained disabled subsidiaries stay covered.
Revision rows have no storage logging/provenance wrapper: trigger writes create
neither audit entries nor entity metadata and cannot trigger themselves.

## Participant registration contract

`ConfigurationCoherency.register` is the explicit contract, composed in
`configuration-cache-registry` during the shared backend boot:

1. Declare a stable `id`, human-readable `label`, and the scoped revision names.
   Every participant automatically observes the durable global generation.
2. Supply a cheap synchronous `invalidate` for a lazy cache, or an asynchronous
   `refresh` for active state. Invalidation precedes active reloads. Do not
   clear unrelated caches by discovery or by naming convention.
3. Declare `after` edges for actual dependencies, registered first. A failed
   dependency blocks only its dependants. `everyPoll` is reserved for the
   existing authoritative component read.
4. Register executable work only in its owning role. Cron cannot be started by
   a selected reload in `api-ws` or while its named startup deferral is pending.
5. Use `readConfigurationSnapshot` for each database snapshot. It exits both
   ambient transaction and after-commit contexts, checks out a fresh connection,
   and uses READ COMMITTED, READ ONLY, two-second statement/lock timeouts and a
   four-second overall read deadline. Timed-out clients are discarded; late
   checkouts are released without executing the read.
6. A participant that can also be refreshed elsewhere must guard publication
   with a generation/sequence. Never let an older in-flight read overwrite
   newer confirmed state. Cron loads are serialized and invalidated snapshots
   are re-read before an atomic schedule replacement.
   Invalid/unavailable individual cron jobs are skipped and reported in the
   reload summary; they cannot block server startup or healthy jobs' refresh.
   Only a failed snapshot/read preserves the entire prior schedule for retry.
7. Throw on failure; do not silently report completion. Persisted completion is
   per participant and per observed revision, never inferred from an HTTP 200.
   Refresh functions must not initiate unbounded network work. Maintenance-exit
   deferred boot repairs run separately from the watcher and keep their
   existing named failure queue.

Polls are non-overlapping; local commits arriving mid-poll coalesce into a
following pass. Continuous failure never starts overlapping timer work. The
watcher keeps reading while maintenance is active. Checkout initialization waits
for maintenance's session setting before lending a client, and discards it if
the setting fails. There is **no new general write bypass**. Existing sanctioned
system-mode/session writes and the audited administrator reload request retain
their narrowly scoped maintenance escape.

## Administrator reload behavior

The existing Restart & Reload surface still offers its original selected
subsystem reloads. Selected operations remain local, in declared dependency
order. **Reload all** advances the durable `global` revision, then uses the same
participant registry to finish local work. It includes plugin slices,
components, terminology and maintenance as well as the original reloadables.
Failures and dependency-pending results are returned individually and displayed.

The response reports local completion separately from remote **eventual**
convergence, including the five-second interval. There is no fleet membership
or acknowledgment store, so neither UI nor API claims every server acknowledged.
Authorization and actor audit behavior remain on the existing admin endpoint.
Restart-only declarations are untouched.

## Verification and regression value

Focused tests in `tests/components/configuration-*` cover the registry's
generation coalescing, dependency retries, one timer/non-overlap, unrelated-scope
isolation, old snapshot rejection, maintenance read failures and cron ownership.
The PostgreSQL regression uses the exact production DDL, disposable schemas,
two independent cached processes and real environment, terminology, plugin and
maintenance consumers. It checks edits, renames, subsidiary writes, deletes,
concurrent increments, rollback visibility, ambient transaction isolation,
missed polls, process restart, optional-table installation, global requests,
maintenance entry/exit and the sanctioned escape, plus bounded read recovery.
No public configuration is edited, no notifications/cron jobs are run, and no
per-settings-page UI tests are added.
