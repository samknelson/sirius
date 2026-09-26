---
name: Local WS test in split roles
description: How local-only administrator tests coexist with separately assigned user API and web-service traffic roles.
---

A local-only administrator web-service test must work when the user API and web-service API roles are assigned to separate processes. The user API process may host the dispatcher for its own loopback test request, but its public `/api/ws` traffic remains unowned and refused. The internal permission is per-process, private, and scoped to the local call; it must not turn the user API process into another public web-service endpoint.

**Why:** Sending a local HTTP test from the user API process to `/api/ws` without arranging for a dispatcher there returns a service-role 503. Routing through the gateway or another container would violate the choice to test only the local server, and opening public `/api/ws` on the user API process would weaken the role boundary.

**How to apply:** When changing the admin tester, dispatcher registration, or role guard, verify both co-located and split-role modes. A normal request to `/api/ws` on an api-user-only process must still get the role refusal; the server's own admin test must reach the dispatcher and use its normal credential and grant checks.