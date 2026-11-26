# Bookmarks

`bookmark` is a normal optional component, enabled by default. It owns the
`bookmark` permission, `bookmarks` table/storage namespace and metadata context,
`/bookmarks` and `/api/bookmarks`, dashboard `bookmarks`, browser view
`bookmarks:Bookmarks`, and singleton flood plugin `bookmark`.

## Compatibility boundaries

- APIs and the page retain the **staff** policy. Buttons and the profile menu
  retain the **bookmark or admin** presentation hint. The dashboard preserves
  that hint and its existing per-user resolver, without adding a staff policy.
  UI permission hints are not an API authorization policy.
- All APIs and dashboard content add component availability checks before
  bookmark storage. Effective masqueraded identity and deletion ownership
  checks are unchanged.
- Worker, employer and company title buttons use lazy named slots. The worker
  slot also hosts EDLS. The bookmark component does not depend on company
  integration or EDLS.
- Company bookmarks can be created, as before, but enrichment and page/widget
  links only explicitly handle worker and employer targets. Company labels
  fall back to the generic identifier and links to `#`. Completing company
  support is a separate product change.
- Provenance is best effort, left-joined with null dates first, descending
  dates and descending ID ties. Bookmark activity does not touch user history.
- The widget renders nothing for loading, missing content, or an empty list.
  Missing dates are displayed honestly rather than hiding records.

## Schema and removal

Historical **global** migrations 1100 `seed_bookmark_provenance` and 1101
`drop_bookmarks_created_at` keep their identities and run in that order. The
seed uses installed ownership even when disabled; missing tables/columns skip.
The drop tolerates an absent table. Completed global migrations do not replay.
Component migration 1 creates an absent table idempotently and adopts existing
tables without rewriting records. Fresh bootstrap uses the current schema and
stamps the normal global and component counters.

Stop the service, remove only `components/bookmark`, regenerate discovery,
rebuild and restart. Saved component switches, role assignments, bookmarks,
provenance, plugin configurations, flood settings and migration counters remain.
Recorded retained ownership excludes the table from the active drift comparison
and refuses destructive schema push while source is absent. Restore the same
directory and ID to recover behavior; re-enable if its saved switch was off.

No forwarding modules or feature branches remain in core. Generated discovery
bridges are expected. The mixed frozen `migrations/0000_wet_wallow.sql` snapshot
is historical, not runtime ownership, and is deliberately unchanged. Other
core matches concern the icon picker or literal browser bookmarks, not this
feature.
