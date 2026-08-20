---
name: Regression-smoke failure cleanup
description: Failure-path teardown for disposable fixtures that intentionally make a regression observable.
---

Regression smokes that install a runnable plugin/config must tear down any plugin-owned output created when the tripwire fires, before removing the fixture config and source rows.

**Why:** A smoke that only cleans its setup data succeeds cleanly but contaminates the scratch database on the exact failure path it exists to detect, making later runs noisy or leaving orphaned output.

**How to apply:** Give each fixture a unique ownership key, remove rows tied to that key first, then remove config/source rows and fixture-created shared records. Keep the failed assertion visible while cleanup runs in `finally`.