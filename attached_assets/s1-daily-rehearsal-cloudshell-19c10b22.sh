#!/usr/bin/env bash
#
# Real-S1 wet DAILY sync rehearsal launcher with fingerprint-based incremental
# reconciliation and independent-failure collection.
# Run in the REGULAR AWS CloudShell tab (internet + AWS APIs), not the VPC tab.
#
# Intentionally does NOT use `set -euo pipefail`.
# It never prints secret values. Existing task-definition secrets must already
# point to the real read-only S1 and the migration-rehearsal S2 target.
#
# Before running, set these non-secret operator values in CloudShell:
#   export CLUSTER='...'
#   export WEB_SERVICE='...'
#   export APP_URL='https://...'
#   export REPO_DIR='/tmp/sirius'   # clone with origin/bao-dev already available
#   export CONFIRM_REHEARSAL_TARGET='migration-rehearsal-2026-08-06'
# Optional only after verifying the pinned image tag exists in ECR:
#   export SKIP_IMAGE_BUILD=1

REGION=us-west-2
SHA=a8ef937ba04d9cd7a0a46536046ed6b7d2fcd220
SHORT_SHA=a8ef937b
SUBNET=subnet-0dbb13264c6f67de8
SECURITY_GROUP=sg-0706494f584922bae
TASK_FAMILY=sirius-migration
LOG_GROUP=/sirius-migration
REPO_DIR="${REPO_DIR:-/tmp/sirius}"
AWS_PAGER=""

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [ -z "${CLUSTER:-}" ]; then fail "export CLUSTER before running"; fi
if [ -z "${WEB_SERVICE:-}" ]; then fail "export WEB_SERVICE before running"; fi
if [ -z "${APP_URL:-}" ]; then fail "export APP_URL before running"; fi
if [ "${CONFIRM_REHEARSAL_TARGET:-}" != "migration-rehearsal-2026-08-06" ]; then
  fail "export CONFIRM_REHEARSAL_TARGET=migration-rehearsal-2026-08-06 after verifying the selected service/task target"
fi
if [ ! -d "$REPO_DIR/.git" ]; then
  fail "$REPO_DIR is not a git clone; clone samknelson/sirius with access to origin/bao-dev first"
fi

echo "== 1. Verify pinned reviewed source =="
git -C "$REPO_DIR" fetch origin bao-dev || fail "git fetch origin bao-dev"
REMOTE_SHA=$(git -C "$REPO_DIR" rev-parse origin/bao-dev) || fail "resolve origin/bao-dev"
if ! git -C "$REPO_DIR" merge-base --is-ancestor "$SHA" "$REMOTE_SHA"; then
  fail "origin/bao-dev ($REMOTE_SHA) does not contain pinned source $SHA"
fi
git -C "$REPO_DIR" checkout --detach "$SHA" || fail "checkout $SHA"
if ! git -C "$REPO_DIR" diff --quiet || ! git -C "$REPO_DIR" diff --cached --quiet; then
  fail "working tree is dirty; build only the reviewed commit"
fi
echo "source SHA verified: $SHA"

echo
echo "== 2. Build and push immutable migration image =="
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --region "$REGION") ||
  fail "AWS identity lookup"
ECR="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
IMAGE="$ECR/sirius-migration:$SHA"
if [ "${SKIP_IMAGE_BUILD:-0}" = "1" ]; then
  aws ecr describe-images \
    --region "$REGION" \
    --repository-name sirius-migration \
    --image-ids "imageTag=$SHA" \
    --query 'imageDetails[0].imageDigest' \
    --output text >/dev/null ||
    fail "SKIP_IMAGE_BUILD=1 was set, but the pinned ECR image tag does not exist"
  echo "reusing verified ECR image: sirius-migration:$SHA"
else
  aws ecr get-login-password --region "$REGION" |
    docker login --username AWS --password-stdin "$ECR" >/dev/null ||
    fail "ECR login"
  docker build --pull --target migration \
    --label "org.opencontainers.image.revision=$SHA" \
    -t "$IMAGE" "$REPO_DIR" ||
    fail "migration image build"
  docker push "$IMAGE" || fail "migration image push"
  echo "image pushed: sirius-migration:$SHA"
fi

echo
echo "== 3. Register task-definition revision pinned to immutable image =="
BASE_TD=$(mktemp)
NEXT_TD=$(mktemp)
aws ecs describe-task-definition \
  --region "$REGION" \
  --task-definition "$TASK_FAMILY" \
  --query taskDefinition > "$BASE_TD" ||
  fail "describe task definition"

if ! jq -e '
  .containerDefinitions[]
  | select(.name == "migration")
  | ([.secrets[]?.name] | index("EXTERNAL_DATABASE_URL") != null)
    and ([.secrets[]?.name] | index("S1_DATABASE_URL") != null)
' "$BASE_TD" >/dev/null; then
  fail "migration task definition lacks required secret mappings"
fi

jq --arg image "$IMAGE" '
  del(
    .taskDefinitionArn,
    .revision,
    .status,
    .requiresAttributes,
    .compatibilities,
    .registeredAt,
    .registeredBy
  )
  | .containerDefinitions |= map(
      if .name == "migration" then .image = $image else . end
    )
' "$BASE_TD" > "$NEXT_TD" ||
  fail "prepare task definition"

PINNED_TD=$(aws ecs register-task-definition \
  --region "$REGION" \
  --cli-input-json "file://$NEXT_TD" \
  --query taskDefinition.taskDefinitionArn \
  --output text) ||
  fail "register pinned task definition"
echo "task definition registered: ${PINNED_TD##*/}"

echo
echo "== 4. Verify web service online and no competing migration task =="
SERVICE_ROW=$(aws ecs describe-services \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --services "$WEB_SERVICE" \
  --query 'services[0].[status,desiredCount,runningCount,taskDefinition]' \
  --output text) ||
  fail "describe web service"
SERVICE_STATUS=$(printf '%s\n' "$SERVICE_ROW" | awk '{print $1}')
DESIRED=$(printf '%s\n' "$SERVICE_ROW" | awk '{print $2}')
RUNNING=$(printf '%s\n' "$SERVICE_ROW" | awk '{print $3}')
WEB_TD=$(printf '%s\n' "$SERVICE_ROW" | awk '{print $4}')
if [ "$SERVICE_STATUS" != "ACTIVE" ] || [ "$DESIRED" != "1" ] || [ "$RUNNING" != "1" ]; then
  fail "web service must be ACTIVE desired=1 running=1 (got: $SERVICE_ROW)"
fi
echo "web service online: desired=$DESIRED running=$RUNNING task=${WEB_TD##*/}"

echo "database target equivalence will be verified behaviorally by the deployed fence probe"

RUNNING_MIGRATIONS=$(aws ecs list-tasks \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --family "$TASK_FAMILY" \
  --desired-status RUNNING \
  --query 'taskArns' \
  --output text) ||
  fail "list migration tasks"
if [ -n "$RUNNING_MIGRATIONS" ] && [ "$RUNNING_MIGRATIONS" != "None" ]; then
  fail "a migration task is already running: $RUNNING_MIGRATIONS"
fi
echo "no competing migration task"

run_task() {
  COMMAND_JSON=$(printf '%s\n' "$@" | jq -R . | jq -s .) || return 1
  OVERRIDES=$(jq -cn --argjson command "$COMMAND_JSON" \
    '{containerOverrides:[{name:"migration",command:$command}]}') || return 1
  aws ecs run-task \
    --region "$REGION" \
    --cluster "$CLUSTER" \
    --launch-type FARGATE \
    --task-definition "$PINNED_TD" \
    --network-configuration \
      "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
    --overrides "$OVERRIDES" \
    --query 'tasks[0].taskArn' \
    --output text
}

task_log_stream() {
  TASK_ARN="$1"
  TASK_DEF_ARN=$(aws ecs describe-tasks \
    --region "$REGION" \
    --cluster "$CLUSTER" \
    --tasks "$TASK_ARN" \
    --query 'tasks[0].taskDefinitionArn' \
    --output text) || return 1
  TASK_DEF_JSON=$(mktemp)
  aws ecs describe-task-definition \
    --region "$REGION" \
    --task-definition "$TASK_DEF_ARN" \
    --query taskDefinition > "$TASK_DEF_JSON" || return 1
  STREAM_PREFIX=$(jq -r '
    .containerDefinitions[]
    | select(.name == "migration")
    | .logConfiguration.options["awslogs-stream-prefix"] // empty
  ' "$TASK_DEF_JSON")
  if [ -z "$STREAM_PREFIX" ]; then
    return 1
  fi
  TASK_ID=${TASK_ARN##*/}
  printf '%s/migration/%s\n' "$STREAM_PREFIX" "$TASK_ID"
}

task_exit_code() {
  aws ecs describe-tasks \
    --region "$REGION" \
    --cluster "$CLUSTER" \
    --tasks "$1" \
    --query 'tasks[0].containers[?name==`migration`].exitCode | [0]' \
    --output text
}

echo
echo "== 5. Verify the DEPLOYED web image honors the write fence =="
PREFLIGHT_TASK=$(run_task \
  npx tsx scripts/s1-migration/preflight-write-fence.ts --seconds 120) ||
  fail "launch write-fence preflight"
if [ -z "$PREFLIGHT_TASK" ] || [ "$PREFLIGHT_TASK" = "None" ]; then
  fail "preflight did not return a task ARN"
fi
echo "preflight task: $PREFLIGHT_TASK"
PREFLIGHT_STREAM=$(task_log_stream "$PREFLIGHT_TASK") ||
  fail "preflight CloudWatch stream did not appear"

READY=0
for _ in $(seq 1 120); do
  PREFLIGHT_LOG=$(aws logs get-log-events \
    --region "$REGION" \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name "$PREFLIGHT_STREAM" \
    --start-from-head \
    --limit 200 \
    --query 'events[].message' \
    --output text 2>/dev/null)
  if printf '%s\n' "$PREFLIGHT_LOG" | grep -q '\[fence-preflight\] READY'; then
    READY=1
    break
  fi
  sleep 2
done
if [ "$READY" != "1" ]; then
  fail "preflight never reported READY; inspect $PREFLIGHT_STREAM"
fi

PROBE_BODY=$(mktemp)
GET_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' "$APP_URL/health")
POST_STATUS=$(curl -sS -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  -o "$PROBE_BODY" \
  -w '%{http_code}' \
  "$APP_URL/api/__s1-write-fence-probe")
if [ "$GET_STATUS" != "200" ]; then
  fail "GET /health must stay online during fence (got $GET_STATUS)"
fi
if [ "$POST_STATUS" != "503" ]; then
  fail "POST fence probe must return 503 (got $POST_STATUS)"
fi
if ! grep -q '"code":"S1_SYNC_WRITE_FENCE"' "$PROBE_BODY"; then
  fail "POST 503 lacks stable S1_SYNC_WRITE_FENCE code"
fi
echo "deployed fence verified: GET /health=200, POST probe=503 with stable code"

aws ecs wait tasks-stopped \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --tasks "$PREFLIGHT_TASK" ||
  fail "wait for preflight task"
PREFLIGHT_EXIT=$(task_exit_code "$PREFLIGHT_TASK")
if [ "$PREFLIGHT_EXIT" != "0" ]; then
  fail "preflight task exit=$PREFLIGHT_EXIT"
fi
echo "preflight released cleanly: exit=0"

echo
echo "== 6. Launch the WET incremental daily full-fleet rehearsal =="
RUNNING_MIGRATIONS=$(aws ecs list-tasks \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --family "$TASK_FAMILY" \
  --desired-status RUNNING \
  --query 'taskArns' \
  --output text)
if [ -n "$RUNNING_MIGRATIONS" ] && [ "$RUNNING_MIGRATIONS" != "None" ]; then
  fail "a migration task appeared after preflight: $RUNNING_MIGRATIONS"
fi

SYNC_TASK=$(run_task \
  npx tsx scripts/s1-migration/sync.ts \
    --mode daily \
    --profile production \
    --keep-going) ||
  fail "launch wet daily sync"
if [ -z "$SYNC_TASK" ] || [ "$SYNC_TASK" = "None" ]; then
  fail "wet sync did not return a task ARN"
fi
SYNC_STREAM=$(task_log_stream "$SYNC_TASK") ||
  fail "wet sync CloudWatch stream did not appear"

STATE_FILE="$HOME/s1-daily-$SHORT_SHA.env"
cat > "$STATE_FILE" <<EOF
REGION=$REGION
CLUSTER=$CLUSTER
SYNC_TASK=$SYNC_TASK
SYNC_STREAM=$SYNC_STREAM
LOG_GROUP=$LOG_GROUP
SHA=$SHA
EOF

echo
echo "WET DAILY REHEARSAL LAUNCHED"
echo "  SHA:        $SHA"
echo "  task:       $SYNC_TASK"
echo "  log stream: $SYNC_STREAM"
echo "  state file: $STATE_FILE"
echo
echo "Monitor (safe if CloudShell later disconnects):"
echo "  aws logs tail '$LOG_GROUP' --region '$REGION' --log-stream-names '$SYNC_STREAM' --follow"
echo
echo "After it stops, verify exit code:"
echo "  aws ecs wait tasks-stopped --region '$REGION' --cluster '$CLUSTER' --tasks '$SYNC_TASK'"
echo "  aws ecs describe-tasks --region '$REGION' --cluster '$CLUSTER' --tasks '$SYNC_TASK' --query 'tasks[0].[stoppedReason,containers[0].exitCode]'"
echo
echo "Export the COMPLETE CloudWatch stream (not only stage output):"
echo "  aws logs get-log-events --region '$REGION' --log-group-name '$LOG_GROUP' --log-stream-name '$SYNC_STREAM' --start-from-head --output json > \"$HOME/s1-daily-$SHORT_SHA-full-log.json\""
echo
echo "Do not start another migration command while this task is RUNNING."