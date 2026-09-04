---
name: Splitting an entity tab into sub-tabs
description: What must move together when a single entity tab (worker/dispatch/etc.) gains children, so no audience loses access and old links survive.
---

# Splitting an entity tab into sub-tabs

Giving a tab `children` in the tab registry is only one of four edits; the
other three are silent failures if skipped.

- Keep the pre-split URL on ONE child. Existing links, bookmarks and any
  hand-written `href` keep working, and the parent's own href points at it.
- The page component for that child must pass the CHILD's tab id as
  `activeTab`, not the parent's — the layout matches sub-tabs on
  `tab.id === activeTab`.
- The route's `ProtectedRoute tabId=` must also name the child. Lookup is
  recursive, so a child id resolves, but an id that matches nothing fails
  closed with a "tab not found" screen.
- Child ids must be unique across the WHOLE entity tree, not just their
  parent's siblings — prefix them with the parent (`edls-status`,
  `edls-assignments`), mirroring the dispatch tabs.

**Why:** access is resolved per tab id, so a child that repeats the parent's
policy/component keeps exactly the audience the single tab had; anything else
either strands a role or widens access silently.
