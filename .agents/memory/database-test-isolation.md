---
name: Database test isolation
description: Use a dedicated schema for integration-test tables so interrupted tests cannot block application startup.
---

Real-database integration tests must put scratch tables in their own schema, not the application's public schema, and remove that schema afterward.

**Why:** A forcibly interrupted test can miss cleanup. The startup drift gate correctly refuses unknown public tables, so abandoned fixtures can prevent the application from starting.

**How to apply:** Give each test process a distinct schema and scope every fixture query to it. Never disable the drift gate to accommodate fixtures. Remember that pg Pool.connect supports both promise and callback callers when instrumenting it; a promise-only replacement can hang pool.query.
