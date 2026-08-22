#!/usr/bin/env bash
#
# Destructive clean rebuild of migration-rehearsal-2026-08-06, followed by
# the real-S1 wet DAILY sync.
#
# Run in the REGULAR AWS CloudShell tab (internet + AWS APIs), not the VPC tab.
# Intentionally does NOT use `set -euo pipefail`.
# Never prints secret values.
#
# Required non-secret values:
#   export CLUSTER='arn:aws:ecs:us-west-2:142403088251:cluster/fc-web-server-4bcead-vm2tt0zzo'
#   export WEB_SERVICE='...'
#   export APP_URL='https://...'
#   export REPO_DIR='/tmp/sirius'
#   export CONFIRM_REHEARSAL_TARGET='migration-rehearsal-2026-08-06'
#   export CONFIRM_DESTRUCTIVE_REBUILD='WIPE migration-rehearsal-2026-08-06'
#
# Optional only after verifying the exact pinned image already exists in ECR:
#   export SKIP_IMAGE_BUILD=1
#
# Safety behavior:
# - Requires the web service to start ACTIVE at desired=1/running=1.
# - Scales web to 0 before bootstrap-target --wipe.
# - Leaves web at 0 if bootstrap fails or sync cannot acquire its write fence.
# - Launches sync while web is down.
# - Restores web to 1 only after CloudWatch proves the sync fence is ACQUIRED.
# - Verifies GET /health=200 and synthetic POST=503/S1_SYNC_WRITE_FENCE.
# - The sync releases its fence automatically at terminal cleanup.

REGION=us-west-2
SHA=1f24ef081cbb1bb373263cff5273177681667c4f
SHORT_SHA=1f24ef08
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
  fail "export CONFIRM_REHEARSAL_TARGET=migration-rehearsal-2026-08-06 after verifying the selected target"
fi
if [ "${CONFIRM_DESTRUCTIVE_REBUILD:-}" != "WIPE migration-rehearsal-2026-08-06" ]; then
  fail "export CONFIRM_DESTRUCTIVE_REBUILD='WIPE migration-rehearsal-2026-08-06' to authorize the populated-target wipe"
fi
if [ ! -d "$REPO_DIR/.git" ]; then
  fail "$REPO_DIR is not a git clone; clone samknelson/sirius with access to origin/bao-dev first"
fi

echo "== 1. Verify exact reviewed source =="
git -C "$REPO_DIR" fetch origin bao-dev || fail "git fetch origin bao-dev"
REMOTE_SHA=$(git -C "$REPO_DIR" rev-parse origin/bao-dev) || fail "resolve origin/bao-dev"
if [ "$REMOTE_SHA" != "$SHA" ]; then
  fail "origin/bao-dev is $REMOTE_SHA, expected $SHA; do not build a different revision"
fi
git -C "$REPO_DIR" checkout --detach "$SHA" || fail "checkout $SHA"
if ! git -C "$REPO_DIR" diff --quiet || ! git -C "$REPO_DIR" diff --cached --quiet; then
  fail "working tree is dirty; build only the reviewed commit"
fi
echo "source SHA verified: $SHA"

echo
echo "== 2. Build or verify the immutable migration image =="
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
    fail "SKIP_IMAGE_BUILD=1 was set, but the pinned image tag does not exist"
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
echo "== 3. Register task-definition revision pinned to the image =="
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
  fail "migration task definition lacks EXTERNAL_DATABASE_URL or S1_DATABASE_URL secret mappings"
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
  if [ -z "$STREAM_PREFIX" ]; then return 1; fi
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
echo "== 4. Verify web is healthy and no migration task is running =="
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
if [ "$SERVICE_STATUS" != "ACTIVE" ] || [ "$DESIRED" != "1" ] || [ "$RUNNING" != "1" ]; then
  fail "web service must begin ACTIVE desired=1 running=1 (got: $SERVICE_ROW)"
fi
GET_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' "$APP_URL/health") ||
  fail "current web health request"
if [ "$GET_STATUS" != "200" ]; then
  fail "current GET /health must be 200 before teardown (got $GET_STATUS)"
fi

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
echo "preconditions verified"

STATE_FILE="$HOME/s1-rebuild-daily-$SHORT_SHA.env"
cat > "$STATE_FILE" <<EOF
REGION=$REGION
CLUSTER=$CLUSTER
WEB_SERVICE=$WEB_SERVICE
LOG_GROUP=$LOG_GROUP
SHA=$SHA
PHASE=pre-teardown
EOF

echo
echo "== 5. Stop web traffic before the destructive bootstrap =="
aws ecs update-service \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --service "$WEB_SERVICE" \
  --desired-count 0 >/dev/null ||
  fail "scale web service to 0"
aws ecs wait services-stable \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --services "$WEB_SERVICE" ||
  fail "wait for web service to stop"
RUNNING=$(aws ecs describe-services \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --services "$WEB_SERVICE" \
  --query 'services[0].runningCount' \
  --output text)
if [ "$RUNNING" != "0" ]; then
  fail "web service did not reach running=0"
fi
echo "web service is offline; destructive bootstrap may proceed"
cat >> "$STATE_FILE" <<EOF
PHASE=web-stopped
EOF

echo
echo "== 6. Atomically wipe and bootstrap the rehearsal target =="
BOOTSTRAP_TASK=$(run_task \
  npx tsx scripts/s1-migration/bootstrap-target.ts --wipe) ||
  fail "launch bootstrap-target --wipe; web intentionally remains at 0"
if [ -z "$BOOTSTRAP_TASK" ] || [ "$BOOTSTRAP_TASK" = "None" ]; then
  fail "bootstrap did not return a task ARN; web intentionally remains at 0"
fi
BOOTSTRAP_STREAM=$(task_log_stream "$BOOTSTRAP_TASK") ||
  fail "derive bootstrap CloudWatch stream; web intentionally remains at 0"
cat >> "$STATE_FILE" <<EOF
BOOTSTRAP_TASK=$BOOTSTRAP_TASK
BOOTSTRAP_STREAM=$BOOTSTRAP_STREAM
PHASE=bootstrap-running
EOF
echo "bootstrap task: $BOOTSTRAP_TASK"
echo "bootstrap log:  $BOOTSTRAP_STREAM"
echo "monitor in another tab:"
echo "  aws logs tail '$LOG_GROUP' --region '$REGION' --log-stream-names '$BOOTSTRAP_STREAM' --follow"

aws ecs wait tasks-stopped \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --tasks "$BOOTSTRAP_TASK" ||
  fail "wait for bootstrap task; inspect $BOOTSTRAP_STREAM; web remains at 0"
BOOTSTRAP_EXIT=$(task_exit_code "$BOOTSTRAP_TASK")
if [ "$BOOTSTRAP_EXIT" != "0" ]; then
  fail "bootstrap exit=$BOOTSTRAP_EXIT; inspect $BOOTSTRAP_STREAM; web remains at 0"
fi
if ! aws logs get-log-events \
  --region "$REGION" \
  --log-group-name "$LOG_GROUP" \
  --log-stream-name "$BOOTSTRAP_STREAM" \
  --start-from-head \
  --query 'events[].message' \
  --output text 2>/dev/null | grep -q 'DONE. Next'; then
  fail "bootstrap exited 0 without the completion marker; inspect $BOOTSTRAP_STREAM; web remains at 0"
fi
echo "bootstrap completed successfully; staging was dropped for a fresh extract"
cat >> "$STATE_FILE" <<EOF
PHASE=bootstrap-complete
EOF

echo
echo "== 7. Launch full daily sync while web remains offline =="
SYNC_TASK=$(run_task \
  npx tsx scripts/s1-migration/sync.ts --mode daily --profile production) ||
  fail "launch wet daily sync; web remains at 0"
if [ -z "$SYNC_TASK" ] || [ "$SYNC_TASK" = "None" ]; then
  fail "wet sync did not return a task ARN; web remains at 0"
fi
SYNC_STREAM=$(task_log_stream "$SYNC_TASK") ||
  fail "derive sync CloudWatch stream; web remains at 0"
cat >> "$STATE_FILE" <<EOF
SYNC_TASK=$SYNC_TASK
SYNC_STREAM=$SYNC_STREAM
PHASE=sync-waiting-for-fence
EOF
echo "sync task: $SYNC_TASK"
echo "sync log:  $SYNC_STREAM"

echo
echo "== 8. Wait for sync write fence before restoring web reads =="
FENCE_ACQUIRED=0
for _ in $(seq 1 180); do
  SYNC_LOG=$(aws logs get-log-events \
    --region "$REGION" \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name "$SYNC_STREAM" \
    --start-from-head \
    --limit 500 \
    --query 'events[].message' \
    --output text 2>/dev/null)
  if printf '%s\n' "$SYNC_LOG" | grep -q '\[sync\] app write fence: ACQUIRED'; then
    FENCE_ACQUIRED=1
    break
  fi
  LAST_STATUS=$(aws ecs describe-tasks \
    --region "$REGION" \
    --cluster "$CLUSTER" \
    --tasks "$SYNC_TASK" \
    --query 'tasks[0].lastStatus' \
    --output text 2>/dev/null)
  if [ "$LAST_STATUS" = "STOPPED" ]; then
    fail "sync stopped before acquiring its write fence; inspect $SYNC_STREAM; web remains at 0"
  fi
  sleep 5
done
if [ "$FENCE_ACQUIRED" != "1" ]; then
  fail "sync fence was not confirmed within 15 minutes; inspect $SYNC_STREAM; web remains at 0"
fi
echo "sync write fence confirmed"
cat >> "$STATE_FILE" <<EOF
PHASE=sync-fence-acquired
EOF

echo
echo "== 9. Restore web service under the held sync fence =="
aws ecs update-service \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --service "$WEB_SERVICE" \
  --desired-count 1 >/dev/null ||
  fail "scale web service to 1; sync remains running with its fence"
aws ecs wait services-stable \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --services "$WEB_SERVICE" ||
  fail "wait for web service to become stable; sync remains running with its fence"

HEALTH_OK=0
for _ in $(seq 1 60); do
  GET_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' "$APP_URL/health" 2>/dev/null)
  if [ "$GET_STATUS" = "200" ]; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done
if [ "$HEALTH_OK" != "1" ]; then
  aws ecs update-service \
    --region "$REGION" \
    --cluster "$CLUSTER" \
    --service "$WEB_SERVICE" \
    --desired-count 0 >/dev/null 2>&1
  fail "restored web did not return GET /health=200; scaled it back to 0; sync remains running"
fi

PROBE_BODY=$(mktemp)
POST_STATUS=$(curl -sS -X POST \
  -H 'Content-Type: application/json' \
  -d '{}' \
  -o "$PROBE_BODY" \
  -w '%{http_code}' \
  "$APP_URL/api/__s1-write-fence-probe")
if [ "$POST_STATUS" != "503" ] ||
   ! grep -q '"code":"S1_SYNC_WRITE_FENCE"' "$PROBE_BODY"; then
  aws ecs update-service \
    --region "$REGION" \
    --cluster "$CLUSTER" \
    --service "$WEB_SERVICE" \
    --desired-count 0 >/dev/null 2>&1
  fail "restored web did not honor the held fence; scaled it back to 0; sync remains running"
fi
echo "web restored safely: GET /health=200; mutation probe=503/S1_SYNC_WRITE_FENCE"
cat >> "$STATE_FILE" <<EOF
PHASE=sync-running-web-readable
EOF

echo
echo "CLEAN REBUILD COMPLETE; WET DAILY REHEARSAL IS RUNNING"
echo "  SHA:              $SHA"
echo "  bootstrap task:   $BOOTSTRAP_TASK"
echo "  bootstrap stream: $BOOTSTRAP_STREAM"
echo "  sync task:        $SYNC_TASK"
echo "  sync stream:      $SYNC_STREAM"
echo "  state file:       $STATE_FILE"
echo
echo "Monitor:"
echo "  aws logs tail '$LOG_GROUP' --region '$REGION' --log-stream-names '$SYNC_STREAM' --follow"
echo
echo "After the sync stops:"
echo "  aws ecs wait tasks-stopped --region '$REGION' --cluster '$CLUSTER' --tasks '$SYNC_TASK'"
echo "  aws ecs describe-tasks --region '$REGION' --cluster '$CLUSTER' --tasks '$SYNC_TASK' --query 'tasks[0].[stoppedReason,containers[0].exitCode]'"
echo
echo "Export the complete stream:"
echo "  aws logs get-log-events --region '$REGION' --log-group-name '$LOG_GROUP' --log-stream-name '$SYNC_STREAM' --start-from-head --output json > \"$HOME/s1-rebuild-daily-$SHORT_SHA-full-log.json\""
echo
echo "Do not launch another migration task while this sync task is running."