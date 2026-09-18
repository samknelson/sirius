---
name: Payment editor lifecycle
description: Why payment editor initialization must not be treated as an account change
---

Treat a payment editor as a local edit session, not a live projection of query-cache data. Initialization and deliberate account changes are different operations.

**Why:** Rendered-control reproduction showed intact saved allocations becoming a blank first participant during cached and cold entry. Native select synchronization and child reset callbacks can occur while account choices are still loading; captured whole-row callbacks can replace hydrated state. Reactive form values also overwrote unsaved input during a background refresh.

**How to apply:** Preserve the local draft until the editor is reopened for a new session; keep attachment/cache refreshes independent. Exercise actual select and statement controls in lifecycle regressions rather than substituting simplified select mocks. Do not infer storage loss from a blank editor.