# FC (AWS) Migration Environment — Setup & Re-run Guide

How the S1→S2 migration runs in the Flight Control AWS account, and how to
reproduce the setup from scratch. Written after the first real-data rehearsal
(2026-08-06). The migration procedure itself lives in
`scripts/s1-migration/RUNBOOK.md` — this document is only the AWS plumbing
around it.

All identifiers below are placeholders — fill them from your private values
worksheet (see "Values to save" at the end). Never commit real endpoints,
account IDs, or connection strings to this file.

## Architecture

- **S1 source:** RDS MariaDB instance restored from a snapshot of the live S1
  prod DB, in the FC VPC, private subnets, reachable only from the FC
  container security group. Read-only MySQL user `s1ro`.
- **S2 target:** the Neon Postgres DB the FC web app points at
  (`EXTERNAL_DATABASE_URL`). Pooler URLs are fine — the app rewrites them.
- **Runner:** a dedicated `migration` Docker build target of the repo's
  Dockerfile (full source + tsx, no server), pushed to ECR, executed as ECS
  Fargate one-off tasks (`run-task`) — one task per runbook step.
- **Operator console:** AWS CloudShell, in two flavors (critical distinction):
  - **REGULAR tab** — has internet. Use for: git, docker build/push, ALL
    `aws` CLI commands (ECR, ECS, Secrets Manager, CloudWatch).
  - **VPC environment tab** (+ → Create VPC environment: FC VPC, a private
    subnet, the container SG) — the ONLY place that reaches the private RDS
    instance. Has NO internet: `aws` CLI and `yum` hang there.
  - A command that silently stalls is almost always in the wrong tab.

## One-time setup (persists in the AWS account)

These survive between sessions — you do NOT redo them for the real migration
unless noted.

### 1. ECR repo + migration image

REGULAR tab. Rebuild/push only when the code changes (always rebuild from the
final frozen commit before the real migration):

```bash
cd /tmp
git clone -b bao-dev https://github.com/samknelson/sirius.git   # classic GitHub PAT, repo scope, short expiry; fine-grained tokens don't work for this repo
cd sirius
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr create-repository --repository-name sirius-migration --region us-west-2   # once
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.us-west-2.amazonaws.com
docker build --target migration -t $ACCOUNT_ID.dkr.ecr.us-west-2.amazonaws.com/sirius-migration:latest .
docker push $ACCOUNT_ID.dkr.ecr.us-west-2.amazonaws.com/sirius-migration:latest
```

If the build hits "no space left on device": `docker system prune -af`.
Delete the GitHub token afterward.

### 2. Secrets Manager

REGULAR tab. Two secrets; update with `put-secret-value` when values change
(new tasks pick up the latest automatically):

```bash
aws secretsmanager create-secret --region us-west-2 \
  --name sirius-migration/EXTERNAL_DATABASE_URL --secret-string '<neon url>'
aws secretsmanager create-secret --region us-west-2 \
  --name sirius-migration/S1_DATABASE_URL \
  --secret-string 'mysql://s1ro:<pw>@<rds-endpoint>:3306/smf_prod'
```

Gotchas: single-quote the strings; no trailing whitespace/newline inside the
value (verify with `get-secret-value ... --output text | cat -A` — the line
must end in a bare `$`); keep the s1ro password free of `@ : / #` so the URL
needs no encoding.

### 3. CloudWatch log group

The FC execution role cannot create log groups — create it once yourself:

```bash
aws logs create-log-group --log-group-name /sirius-migration --region us-west-2
```

### 4. Task definition `sirius-migration`

Fargate, 1 vCPU / 2 GB, `awsvpc`, reusing the FC web service's
`executionRoleArn`. Container `migration`, image = the ECR image, `secrets`
mapping the two Secrets Manager ARNs to `EXTERNAL_DATABASE_URL` /
`S1_DATABASE_URL`, awslogs driver → group `/sirius-migration`.

Time zone: the image bakes in `TZ=America/Los_Angeles` (RUNBOOK §1 "Time
zone pin"); put nothing about `TZ` in the task definition or in run-task
overrides. The **web service's** task definition must carry
`TZ=America/Los_Angeles` too (GitHub `APP_TZ` for the deploy workflow) before
any parity read or cutover — the migration gate checks the database and its
own process, but it cannot see the web task's environment.

```bash
aws ecs register-task-definition --cli-input-json file://migration-taskdef.json --region us-west-2
```

Keep `migration-taskdef.json` in your values worksheet. Registration is
per-revision; re-register only if it changes.

## Per-rehearsal / per-migration setup (redo each time)

### 5. Fresh S1 snapshot → RDS copy

For the real migration this MUST be a snapshot taken at the freeze:

1. Snapshot the live S1 RDS instance.
2. Restore it into the FC VPC: private subnet group, DB security group that
   allows 3306 from the FC container SG. (Snapshot restores default to the
   VPC default SG — pass `--vpc-security-group-ids` explicitly or fix with
   `modify-db-instance` after.)
3. Master password carries over from the source; reset via
   `modify-db-instance --master-user-password` if unknown.

### 6. Read-only user (VPC tab)

```bash
sudo yum install -y mariadb105
mysql -h <rds-endpoint> -u <master-user> -p
```
```sql
SHOW DATABASES;   -- confirm smf_prod
CREATE USER 's1ro'@'%' IDENTIFIED BY '<alphanumeric password>';
GRANT SELECT, SHOW VIEW ON smf_prod.* TO 's1ro'@'%';
```

Test: `mysql -h <rds-endpoint> -u s1ro -p -e "SELECT COUNT(*) FROM smf_prod.node;"`
(prod shows ~9.2M). Then update the `sirius-migration/S1_DATABASE_URL` secret
(REGULAR tab).

### 7. Choose the target traffic mode

For the initial operator-paced bootstrap/manual loader chain, stop app traffic
because the standalone loader commands do not take the app-write fence:

```bash
aws ecs update-service --region us-west-2 --cluster <cluster> \
  --service <fc-web-service> --desired-count 0
```

Scale back to 1 whenever you want to check the migration dashboard
(`/config/s1-migration`, component `sitespecific.bao.s1migration`), back to 0
before the next standalone loader. Leave it up after parity gates pass.

For one-command wet daily or final-freeze runs (`sync.ts`), keep desired count
at **1**. The sync waits for in-flight writes, keeps reads online, returns
retryable 503s for new mutations, and defers cron/WMB work until it releases
the fence automatically.

## Running steps

Every runbook step is the same command with a different override — REGULAR
tab, sequentially, wait for exit 0 before the next:

```bash
aws ecs run-task --region us-west-2 \
  --cluster <cluster> \
  --launch-type FARGATE \
  --task-definition sirius-migration \
  --network-configuration 'awsvpcConfiguration={subnets=[<web service subnets>],securityGroups=[<web service SGs>],assignPublicIp=ENABLED}' \
  --overrides '{"containerOverrides":[{"name":"migration","command":["npx","tsx","scripts/s1-migration/<step>"]}]}'
```

**Network config: copy the FC web service's own** (`describe-services ...
--query 'services[0].networkConfiguration.awsvpcConfiguration'`). Two failures
you'll hit otherwise:
- Private subnets without NAT → `ResourceInitializationError ... Secrets
  Manager ... context deadline exceeded`.
- Public subnets with `assignPublicIp=DISABLED` → same error. It must be
  ENABLED there.

The web service SG list already includes the container SG the RDS copy
admits.

Monitoring:

```bash
aws logs tail /sirius-migration --region us-west-2 --follow
aws ecs list-tasks --region us-west-2 --cluster <cluster>                      # running
aws ecs list-tasks --region us-west-2 --cluster <cluster> --desired-status STOPPED
aws ecs describe-tasks --region us-west-2 --cluster <cluster> --tasks <arn> \
  --query 'tasks[0].[stoppedReason,containers[0].exitCode]'
```

Tasks keep running when CloudShell times out. Long poles (stage, hours,
benefit-history) can run for hours — normal.

Step sequence and flags: follow `scripts/s1-migration/RUNBOOK.md` §3–§5
exactly (bootstrap-target [--wipe if target has data] → stage.ts →
seed-trust-config.ts → loaders in order → parity gates). No
`--allow-rejects` on first runs; `--migration-mode` is mandatory on
hours/log-notes/packet-tags.

## Values to save (private worksheet — NOT in the repo)

- AWS account ID, region (us-west-2), FC ECS cluster name, FC web service name
- FC web service network config (subnets, security groups, assignPublicIp)
- FC execution role ARN
- `migration-taskdef.json` (full file)
- RDS copy: instance identifier, endpoint, master username/password,
  DB name (`smf_prod`), DB security group id, subnet group name
- s1ro password
- Snapshot identifier used
- Neon target URL (also in Secrets Manager)
- The two Secrets Manager secret names/ARNs
- GitHub: none (tokens are disposable — make a fresh short-lived one per clone)

Everything except the RDS copy and its passwords persists in AWS between
sessions; the worksheet is mainly so you can rebuild after a teardown.

## For the real migration

Same procedure with these differences:
1. Rebuild the image from the **final frozen commit** and push.
2. Fresh snapshot **at freeze time** → new RDS restore → recreate `s1ro` →
   update the S1 secret.
3. Target = the real production Neon DB (update the EXTERNAL secret) —
   bootstrap-target will demand `--wipe` if it holds data; be sure that is
   intended.
4. Web app stays scaled to 0 for the initial standalone loader chain. During
   later wet daily/final-freeze `sync.ts` runs it stays at desired count 1
   under the app-write fence. Sirius_id collisions must already be renumbered
   in S1 (loader aborts otherwise, no override).
5. After parity gates: Okta pre-provisioning real run + cutover steps per
   RUNBOOK.
