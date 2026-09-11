# FC (AWS) Migration Environment — Setup & Re-run Guide

How the S1→S2 migration runs in the Flight Control AWS account, and how to
reproduce the production launch path. The migration procedure itself lives in
`scripts/s1-migration/RUNBOOK.md` — this document is only the AWS plumbing
around it.

All identifiers below are placeholders — fill them from your private values
worksheet (see "Values to save" at the end). Never commit real endpoints,
account IDs, or connection strings to this file.

## Architecture

- **Runner VPC:** production VPC `vpc-08bed2ce763bc0b15`. Every migration
  one-off uses private subnets and the production migration/container security
  group, with `assignPublicIp=DISABLED`.
- **S1 source:** RDS MariaDB reached from the production VPC through the
  production-to-S1 VPC peering route. The restored/frozen source and its
  security group admit port 3306 from the migration task security group.
  Read-only MySQL user `s1ro`.
- **S2 target:** the public-disabled Neon Postgres project reached through its
  PrivateLink endpoint and private DNS. `EXTERNAL_DATABASE_URL` is unchanged;
  private DNS resolves its existing hostname to private endpoint addresses.
  Pooler URLs remain acceptable because the application resolves the direct
  endpoint as before.
- **Runner:** a dedicated `migration` Docker build target of the repo's
  Dockerfile (full source + tsx, no server), pushed to ECR, executed as ECS
  Fargate one-off tasks (`run-task`) — one task per runbook step.
- **Operator console:** use an AWS console/CloudShell session for ECR, ECS,
  Secrets Manager, and CloudWatch commands. Database connectivity is proved by
  an ECS task launched with the exact production task definition and network
  configuration, never by the operator console.

### Production task-start dependencies

Private tasks still need control-plane access before the container starts.
The private subnets must have either NAT egress or VPC endpoints (with private
DNS and security-group access) for:

- ECR API and ECR Docker registry (plus the S3 gateway path used for image
  layers);
- Secrets Manager, for both database URL injections;
- CloudWatch Logs, for `awslogs`.

DNS resolution and network ACLs must also permit the S1 peering route and the
Neon PrivateLink endpoint. Missing startup endpoints usually appear as
`ResourceInitializationError`; missing database routes appear only after the
container starts. Infrastructure owners fix those paths. Do not change
connection strings, enable public Neon access, or add public IPs as a bypass.

## One-time setup (persists in the AWS account)

These survive between sessions — you do NOT redo them for the real migration
unless noted.

### 1. ECR repo + migration image

Operator console. Rebuild/push only when the code changes (always rebuild from
the final frozen commit before the real migration):

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

Operator console. Two secrets; update with `put-secret-value` when values
change (new tasks pick up the latest automatically):

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
`TZ=America/Los_Angeles` too before any parity read or cutover — the
migration gate checks the database and its own process, but it cannot see
the web task's environment. The web services are deployed by Flight Control,
so the variable is set there (project → environment → web service →
*Environment Variables* → `TZ=America/Los_Angeles`, then deploy); there is no
GitHub-side variable for this. Evidence is the web service's CloudWatch boot
line `System time zone: America/Los_Angeles (from TZ in the environment)`
or the in-app environment screen's `TZ` row with source "environment" —
RUNBOOK §12 step 0 has the per-environment checklist.

```bash
aws ecs register-task-definition --cli-input-json file://migration-taskdef.json --region us-west-2
```

Keep `migration-taskdef.json` in your values worksheet. Registration is
per-revision; re-register only if it changes.

## Per-migration setup

### 5. Fresh S1 snapshot → RDS copy

For the real migration this MUST be a snapshot taken at the freeze:

1. Snapshot the live S1 RDS instance.
2. Restore it into the S1-side VPC/subnets already routed to production VPC
   `vpc-08bed2ce763bc0b15` by the production peering connection. Use a DB
   security group that allows 3306 from the production migration task path.
   (Snapshot restores default to the
   VPC default SG — pass `--vpc-security-group-ids` explicitly or fix with
   `modify-db-instance` after.)
3. Master password carries over from the source; reset via
   `modify-db-instance --master-user-password` if unknown.

### 6. Read-only user

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
from the operator console.

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

## Running steps and proving the private launch path

Every runbook step is the same command with a different override — run from
the operator console, sequentially, and wait for exit 0 before the next:

```bash
aws ecs run-task --region us-west-2 \
  --cluster <cluster> \
  --launch-type FARGATE \
  --task-definition sirius-migration \
  --network-configuration 'awsvpcConfiguration={subnets=[<production private subnets>],securityGroups=[<production migration SGs>],assignPublicIp=DISABLED}' \
  --overrides '{"containerOverrides":[{"name":"migration","command":["npx","tsx","scripts/s1-migration/<step>"]}]}'
```

Use the approved production migration subnet and security-group values from
the private worksheet. They must be in `vpc-08bed2ce763bc0b15`; do not copy a
rehearsal service configuration or rely on the removed migration-stage peering.

Before Phase 1, run this exact command with `<step>` set to
`preflight-private-connectivity.ts`. It uses the unchanged
`S1_DATABASE_URL` and `EXTERNAL_DATABASE_URL`, performs no writes, requires
both names to resolve exclusively to private addresses, opens a read-only
session/transaction to each database, and prints only aggregate evidence.
Save the CloudWatch lines from `dns:` through `PASS`, plus task definition
revision, image digest, subnet IDs, security-group IDs, task ARN, timestamp,
and exit code. Do not save hostnames, IP addresses, URLs, credentials, database
names, or source rows.

If the task does not start, DNS is not private, or either connection fails,
record FAIL and stop. Hand the evidence to the AWS/Neon infrastructure owners;
do not alter loader code, hostnames, public-access settings, or URL formats.

Sanitized evidence record:

```text
timestamp=<UTC timestamp>
taskArn=<ARN> taskDefinitionRevision=<revision> imageDigest=<digest>
vpc=vpc-08bed2ce763bc0b15 subnets=<IDs> securityGroups=<IDs> publicIp=DISABLED
[private-connectivity] S1 dns: addresses=<count> families=<families> allPrivate=true
[private-connectivity] S2 dns: addresses=<count> families=<families> allPrivate=true
[private-connectivity] S1 database: reachable readOnlySession=true
[private-connectivity] S2 database: reachable readOnlyTransaction=true
[private-connectivity] PASS
exitCode=0
```

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
- Production migration network config (private subnets, security groups,
  `assignPublicIp=DISABLED`)
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

## Production lifecycle

1. **Phase 1 — frozen initial load.** Rebuild from the approved immutable
   commit, restore the agreed S1 snapshot, recreate `s1ro`, repoint the S1
   secret to that restore, and repoint the external target secret to production
   Neon. Run the private-connectivity preflight. With app traffic stopped,
   bootstrap and run exactly one full frozen loader chain. Validate against the
   frozen S1 restore and the recorded rehearsal baseline. Keep the restore
   until Phase 1 evidence is accepted; then retire it under the infrastructure
   retention procedure.
2. **Phase 2 — daily sync.** Repoint `S1_DATABASE_URL` to the approved live
   read-only S1 endpoint before the first daily run and re-run the connectivity
   preflight. Keep `EXTERNAL_DATABASE_URL` on production Neon. Run
   `sync.ts --mode daily` manually with the app at desired count 1. See RUNBOOK
   §12 for identity scans, verified fingerprints, retries, and findings.
3. **Phase 3 — final freeze and cutover.** Freeze S1 writes, run
   `sync.ts --mode final-freeze`, require every final gate to pass, then follow
   the unchanged manual Okta/canary/cutover sequence in RUNBOOK §4.15–§4.17.
