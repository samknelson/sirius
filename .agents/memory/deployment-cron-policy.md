---
name: Deployment cron policy
description: Why production cron authorization must not come from database-backed environment overrides.
---

Production cron execution must be explicitly authorized by the real deployment environment. A database-backed environment override may describe the configured value, but it cannot authorize cron execution in a production process.

**Why:** Production databases are copied to staging. Treating the copied override as deployment authority would also allow the reverse mistake: a copied or stale database value could enable cron in production when the deployment omitted its safety setting.

**How to apply:** Keep database job enabled flags independent from deployment execution permission. Check the central deployment policy before scheduling and again at the final execution boundary, before fences, run records, or plugin side effects.