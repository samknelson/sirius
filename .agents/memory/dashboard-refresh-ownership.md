---
name: Dashboard refresh ownership
description: Shared refresh ownership, query lifetime and protected stale-data behavior.
---

Dashboard auto-refresh is a per-configuration framework feature, not a widget feature. Existing configurations must remain opted out unless explicitly enabled.

**Why:** The user explicitly rejected bespoke EDLS refresh behavior and wants consistent settings, controls and failure indicators across widgets.

**How to apply:** Let the existing content-query observers schedule fetching; the wrapper observes their state rather than mounting another fetching observer. Track mounted, enabled requests, not every cached date/filter. Never unmount children during ordinary background fetches. A transient error may retain the same authorized content; widget-level error branches must not replace that content just because `isError` is true. An access refusal must instead remove protected content and remain refused after the child unregisters, or clearing the registration can cause a hide/remount loop.
