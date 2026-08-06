---
name: FC migration ECS ops
description: How the S1 migration runs in the Flight Control AWS env — CloudShell tabs, image, task def, networking
---
Operational setup for running the S1 migration in the FC AWS account (us-west-2):

- **Two CloudShell environments with a hard split:** the REGULAR tab has internet (git clone, docker build/push to ECR, all `aws` CLI incl. Secrets Manager); the **VPC environment** tab (created via + → Create VPC environment: FC VPC, private subnet, container SG) is the ONLY place that reaches the private RDS S1 copy — and it has NO internet, so `aws` API calls and yum may hang there. A silent stall almost always means the command is in the wrong tab.
- Migration image: `docker build --target migration` from a bao-dev clone (HTTPS + short-lived GitHub classic token; fine-grained tokens don't work — repo owner not offerable as resource owner). Pushed to ECR repo `sirius-migration`.
- Task def `sirius-migration`: Fargate 1 vCPU/2GB, secrets `sirius-migration/EXTERNAL_DATABASE_URL` + `sirius-migration/S1_DATABASE_URL` from Secrets Manager, awslogs group `/sirius-migration`, reuses FC web taskdef's executionRoleArn. Each runbook step = one `run-task` with a containerOverrides command; tasks survive CloudShell timeouts.
- S1 copy: RDS `s1-migration-copy`, db `smf_prod` (~9.2M node rows), read-only user `s1ro` (SELECT + SHOW VIEW). DSN passwords must avoid `@ : / #` (no URL-encoding in the loaders' DSN parsing assumption).

**Why:** first FC rehearsal (2026-08) burned time on tab confusion (mysql hanging in regular tab, secretsmanager hanging in VPC tab).
**How to apply:** any future FC migration run or debugging session — check which tab before diagnosing "stalls".
