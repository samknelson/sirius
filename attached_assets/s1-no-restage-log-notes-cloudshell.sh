#!/usr/bin/env bash
#
# Run the production-profile S1 sync fleet against the existing staging
# snapshot. This intentionally skips stage.ts, but retains the fleet's
# migration advisory lock, deployed-app write fence, loader gates, and parity
# checks. The log-notes step runs after contacts-workers.
#
# Run in the REGULAR AWS CloudShell tab after setting:
#   export CLUSTER='...'
#   export APP_URL='https://...'
#   export CONFIRM_REHEARSAL_TARGET='migration-rehearsal-2026-08-06'
#
# This script never builds an image. The immutable ECR image below must already
# exist. It never prints secret values; the task-definition secret mappings are
# inherited unchanged.

REGION=us-west-2
SUBNET=subnet-0dbb13264c6f67de8
SECURITY_GROUP=sg-0706494f584922bae
TASK_FAMILY=sirius-migration
LOG_GROUP=/sirius-migration
SOURCE_SHA=1c0db72098985c471d54dad43f335f947900c607
AWS_PAGER=""

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

if [ -z "${CLUSTER:-}" ]; then fail "export CLUSTER before running"; fi
if [ -z "${APP_URL:-}" ]; then fail "export APP_URL before running"; fi
if [ "${CONFIRM_REHEARSAL_TARGET:-}" != "migration-rehearsal-2026-08-06" ]; then
  fail "export CONFIRM_REHEARSAL_TARGET=migration-rehearsal-2026-08-06 after verifying the target"
fi

ACCOUNT_ID=$(aws sts get-caller-identity \
  --region "$REGION" \
  --query Account \
  --output text) || fail "AWS identity lookup"
ECR="$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com"
IMAGE="$ECR/sirius-migration:$SOURCE_SHA"

aws ecr describe-images \
  --region "$REGION" \
  --repository-name sirius-migration \
  --image-ids "imageTag=$SOURCE_SHA" \
  --query 'imageDetails[0].imageDigest' \
  --output text >/dev/null ||
  fail "immutable migration image sirius-migration:$SOURCE_SHA does not exist in ECR"

HEALTH_BODY=$(mktemp) || fail "create health temp file"
HEALTH_STATUS=$(curl -sS \
  --max-time 15 \
  -o "$HEALTH_BODY" \
  -w '%{http_code}' \
  "$APP_URL/health") || fail "query deployed web health"
HEALTH_STATE=$(jq -r '.status // empty' "$HEALTH_BODY" 2>/dev/null)
if [ "$HEALTH_STATUS" != "200" ] || [ "$HEALTH_STATE" != "ready" ]; then
  fail "web application must report HTTP 200 status=ready (got HTTP=$HEALTH_STATUS status=${HEALTH_STATE:-none})"
fi

RUNNING_MIGRATIONS=$(aws ecs list-tasks \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --family "$TASK_FAMILY" \
  --desired-status RUNNING \
  --query taskArns \
  --output text) || fail "list migration tasks"
if [ -n "$RUNNING_MIGRATIONS" ] && [ "$RUNNING_MIGRATIONS" != "None" ]; then
  fail "a migration task is already running: $RUNNING_MIGRATIONS"
fi

BASE_TD=$(mktemp) || fail "create task-definition temp file"
NEXT_TD=$(mktemp) || fail "create next task-definition temp file"
aws ecs describe-task-definition \
  --region "$REGION" \
  --task-definition "$TASK_FAMILY" \
  --query taskDefinition > "$BASE_TD" ||
  fail "describe migration task definition"

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
  fail "prepare immutable task definition"

PINNED_TD=$(aws ecs register-task-definition \
  --region "$REGION" \
  --cli-input-json "file://$NEXT_TD" \
  --query taskDefinition.taskDefinitionArn \
  --output text) ||
  fail "register immutable task definition"

COMMAND_JSON=$(printf '%s\n' \
  npx \
  tsx \
  scripts/s1-migration/sync.ts \
  --mode daily \
  --profile production \
  --skip-stage \
  --keep-going |
  jq -R . |
  jq -s .) || fail "build command override"
OVERRIDES=$(jq -cn --argjson command "$COMMAND_JSON" \
  '{containerOverrides:[{name:"migration",command:$command}]}') ||
  fail "build ECS overrides"

TASK_ARN=$(aws ecs run-task \
  --region "$REGION" \
  --cluster "$CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$PINNED_TD" \
  --network-configuration \
    "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
  --overrides "$OVERRIDES" \
  --query 'tasks[0].taskArn' \
  --output text) ||
  fail "launch no-restage sync"
if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  fail "ECS did not return a migration task ARN"
fi

TASK_ID=${TASK_ARN##*/}
STREAM_PREFIX=$(jq -r '
  .containerDefinitions[]
  | select(.name == "migration")
  | .logConfiguration.options["awslogs-stream-prefix"] // empty
' "$NEXT_TD")
if [ -z "$STREAM_PREFIX" ]; then
  fail "migration task definition lacks an awslogs stream prefix"
fi
LOG_STREAM="$STREAM_PREFIX/migration/$TASK_ID"

cat > "$HOME/s1-log-notes-current.env" <<EOF
export S1_LOG_NOTES_TASK_ARN='$TASK_ARN'
export S1_LOG_NOTES_LOG_GROUP='$LOG_GROUP'
export S1_LOG_NOTES_LOG_STREAM='$LOG_STREAM'
export S1_LOG_NOTES_SOURCE_SHA='$SOURCE_SHA'
EOF

echo "No-restage production sync launched."
echo "source image: sirius-migration:$SOURCE_SHA"
echo "task: $TASK_ARN"
echo "log stream: $LOG_STREAM"
echo
echo "Follow aggregate-only logs:"
echo "  source \"\$HOME/s1-log-notes-current.env\""
echo "  aws logs tail \"\$S1_LOG_NOTES_LOG_GROUP\" --region \"$REGION\" --log-stream-names \"\$S1_LOG_NOTES_LOG_STREAM\" --follow"
echo
echo "This command runs the full fleet with --skip-stage --keep-going."
echo "It does not use --force-reconcile."