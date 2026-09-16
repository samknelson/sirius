#!/usr/bin/env bash
# Configure the Phase 2 production S1 daily sync. This script never reads or
# prints database secrets. Run from an authenticated AWS CloudShell session.
set -euo pipefail

usage() {
  cat <<'EOF'
Required environment:
  AWS_REGION                    e.g. us-west-2
  ECS_CLUSTER_ARN               production cluster ARN
  MIGRATION_TASK_DEFINITION     proven migration task definition ARN:revision
  MIGRATION_CONTAINER_NAME      normally migration
  PRIVATE_SUBNET_IDS            comma-separated production private subnet IDs
  SECURITY_GROUP_IDS            comma-separated production migration SG IDs
  SCHEDULER_ROLE_ARN            role allowed to ecs:RunTask and iam:PassRole
  S1_SYNC_ALERT_TOPIC_ARN       SNS topic for the operator distribution list
  SCHEDULER_DLQ_ARN             SQS queue ARN for failed Scheduler deliveries

Optional:
  SCHEDULE_GROUP                default sirius-migration
  DAILY_SCHEDULE_NAME           default sirius-s1-daily
  LATE_SCHEDULE_NAME            default sirius-s1-daily-late-check

Usage:
  configure-daily-sync.sh validate
  configure-daily-sync.sh apply
  configure-daily-sync.sh disable
  configure-daily-sync.sh enable

The task definition must already contain the two existing database secret
mappings and a task role allowed to sns:Publish to S1_SYNC_ALERT_TOPIC_ARN.
EOF
}

ACTION="${1:-}"
[[ "$ACTION" =~ ^(validate|apply|disable|enable)$ ]] || { usage >&2; exit 2; }

# The Phase 3 kill switch must keep working even if task/topic/network
# configuration is unavailable or stale.
if [[ "$ACTION" == "disable" ]]; then
  : "${AWS_REGION:?AWS_REGION is required}"
  command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 2; }
  command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }
  GROUP="${SCHEDULE_GROUP:-sirius-migration}"
  DAILY="${DAILY_SCHEDULE_NAME:-sirius-s1-daily}"
  LATE="${LATE_SCHEDULE_NAME:-sirius-s1-daily-late-check}"
  for schedule in "$DAILY" "$LATE"; do
    CURRENT="$(aws scheduler get-schedule --region "$AWS_REGION" --group-name "$GROUP" --name "$schedule" --output json)"
    aws scheduler update-schedule \
      --region "$AWS_REGION" \
      --group-name "$GROUP" \
      --name "$schedule" \
      --state DISABLED \
      --schedule-expression "$(jq -r .ScheduleExpression <<<"$CURRENT")" \
      --schedule-expression-timezone "$(jq -r .ScheduleExpressionTimezone <<<"$CURRENT")" \
      --flexible-time-window "$(jq -c .FlexibleTimeWindow <<<"$CURRENT")" \
      --target "$(jq -c .Target <<<"$CURRENT")" >/dev/null
  done
  echo "disable complete for $DAILY and $LATE"
  exit 0
fi

for name in AWS_REGION ECS_CLUSTER_ARN MIGRATION_TASK_DEFINITION MIGRATION_CONTAINER_NAME \
  PRIVATE_SUBNET_IDS SECURITY_GROUP_IDS SCHEDULER_ROLE_ARN S1_SYNC_ALERT_TOPIC_ARN SCHEDULER_DLQ_ARN; do
  [[ -n "${!name:-}" ]] || { echo "missing required environment variable: $name" >&2; exit 2; }
done
command -v aws >/dev/null || { echo "aws CLI is required" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq is required" >&2; exit 2; }

GROUP="${SCHEDULE_GROUP:-sirius-migration}"
DAILY="${DAILY_SCHEDULE_NAME:-sirius-s1-daily}"
LATE="${LATE_SCHEDULE_NAME:-sirius-s1-daily-late-check}"
FAILURE_RULE="${ECS_FAILURE_RULE_NAME:-sirius-s1-daily-task-failed}"
STARTUP_FAILURE_RULE="${ECS_STARTUP_FAILURE_RULE_NAME:-sirius-s1-daily-task-start-failed}"

TASK_JSON="$(aws ecs describe-task-definition \
  --region "$AWS_REGION" \
  --task-definition "$MIGRATION_TASK_DEFINITION" \
  --query taskDefinition \
  --output json)"

jq -e --arg container "$MIGRATION_CONTAINER_NAME" '
  [.containerDefinitions[] | select(.name == $container)] | length == 1
' >/dev/null <<<"$TASK_JSON" || { echo "migration container is absent or ambiguous" >&2; exit 1; }

jq -e --arg container "$MIGRATION_CONTAINER_NAME" '
  [.containerDefinitions[] | select(.name == $container) | .secrets[]?.name]
  | (index("S1_DATABASE_URL") != null and index("EXTERNAL_DATABASE_URL") != null)
' >/dev/null <<<"$TASK_JSON" || { echo "task definition does not map both required database secrets" >&2; exit 1; }

jq -e '.taskRoleArn != null and .executionRoleArn != null' >/dev/null <<<"$TASK_JSON" ||
  { echo "task definition needs both taskRoleArn (SNS publish) and executionRoleArn" >&2; exit 1; }

TASK_ARN="$(jq -r .taskDefinitionArn <<<"$TASK_JSON")"
TASK_ROLE_ARN="$(jq -r .taskRoleArn <<<"$TASK_JSON")"
EXECUTION_ROLE_ARN="$(jq -r .executionRoleArn <<<"$TASK_JSON")"
IMAGE="$(jq -r --arg container "$MIGRATION_CONTAINER_NAME" '.containerDefinitions[] | select(.name == $container) | .image' <<<"$TASK_JSON")"
[[ "$TASK_ARN" == *:* ]] || { echo "task definition must be pinned to a revision" >&2; exit 1; }
[[ "$IMAGE" == *@sha256:* ]] ||
  { echo "migration image must be pinned by digest (repository@sha256:...)" >&2; exit 1; }

IFS=',' read -r -a SUBNETS <<<"$PRIVATE_SUBNET_IDS"
IFS=',' read -r -a SGS <<<"$SECURITY_GROUP_IDS"
SUBNET_JSON="$(printf '%s\n' "${SUBNETS[@]}" | jq -R . | jq -s .)"
SG_JSON="$(printf '%s\n' "${SGS[@]}" | jq -R . | jq -s .)"

TARGET_BASE="$(jq -n \
  --arg arn "$ECS_CLUSTER_ARN" \
  --arg role "$SCHEDULER_ROLE_ARN" \
  --arg task "$TASK_ARN" \
  --arg dlq "$SCHEDULER_DLQ_ARN" \
  --argjson subnets "$SUBNET_JSON" \
  --argjson sgs "$SG_JSON" \
  '{
    Arn: $arn,
    RoleArn: $role,
    DeadLetterConfig: {Arn: $dlq},
    RetryPolicy: {MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0},
    EcsParameters: {
      TaskDefinitionArn: $task,
      LaunchType: "FARGATE",
      TaskCount: 1,
      NetworkConfiguration: {
        awsvpcConfiguration: {
          Subnets: $subnets,
          SecurityGroups: $sgs,
          AssignPublicIp: "DISABLED"
        }
      }
    }
  }')"

DAILY_TARGET="$(jq \
  --arg container "$MIGRATION_CONTAINER_NAME" \
  --arg topic "$S1_SYNC_ALERT_TOPIC_ARN" \
  '. + {Input: ({
    containerOverrides: [{
      name: $container,
      command: ["npx","tsx","scripts/s1-migration/run-scheduled-daily.ts"],
      environment: [{name:"S1_SYNC_ALERT_TOPIC_ARN",value:$topic}]
    }]
  } | tojson)}' <<<"$TARGET_BASE")"

LATE_TARGET="$(jq \
  --arg container "$MIGRATION_CONTAINER_NAME" \
  --arg topic "$S1_SYNC_ALERT_TOPIC_ARN" \
  '. + {Input: ({
    containerOverrides: [{
      name: $container,
      command: ["npx","tsx","scripts/s1-migration/check-scheduled-daily-late.ts"],
      environment: [{name:"S1_SYNC_ALERT_TOPIC_ARN",value:$topic}]
    }]
  } | tojson)}' <<<"$TARGET_BASE")"

echo "validated taskDefinition=$TASK_ARN image=$IMAGE publicIp=DISABLED timezone=America/Los_Angeles"
echo "validated taskRole=$TASK_ROLE_ARN executionRole=$EXECUTION_ROLE_ARN taskCount=1 retries=0"

upsert_schedule() {
  local name="$1" expression="$2" target="$3" state="$4"
  local common=(
    --region "$AWS_REGION"
    --group-name "$GROUP"
    --name "$name"
    --schedule-expression "$expression"
    --schedule-expression-timezone America/Los_Angeles
    --flexible-time-window '{"Mode":"OFF"}'
    --state "$state"
    --target "$target"
  )
  if aws scheduler get-schedule --region "$AWS_REGION" --group-name "$GROUP" --name "$name" >/dev/null 2>&1; then
    aws scheduler update-schedule "${common[@]}" >/dev/null
  else
    aws scheduler create-schedule "${common[@]}" >/dev/null
  fi
}

schedule_matches() {
  local name="$1" expression="$2" target="$3" state="$4"
  local current
  current="$(aws scheduler get-schedule --region "$AWS_REGION" --group-name "$GROUP" --name "$name" --output json)" || return 1
  jq -e \
    --arg expression "$expression" \
    --arg state "$state" \
    --argjson target "$target" '
      .ScheduleExpression == $expression
      and .ScheduleExpressionTimezone == "America/Los_Angeles"
      and .FlexibleTimeWindow == {Mode:"OFF"}
      and .State == $state
      and .Target == $target
    ' >/dev/null <<<"$current"
}

if [[ "$ACTION" == "validate" ]]; then
  if aws scheduler get-schedule-group --region "$AWS_REGION" --name "$GROUP" >/dev/null 2>&1; then
    schedule_matches "$DAILY" "cron(0 0 * * ? *)" "$DAILY_TARGET" "DISABLED" ||
      { echo "$DAILY is missing or differs from the safe generated target" >&2; exit 1; }
    schedule_matches "$LATE" "cron(0 9 * * ? *)" "$LATE_TARGET" "DISABLED" ||
      { echo "$LATE is missing or differs from the safe generated target" >&2; exit 1; }
    echo "live schedules exactly match the generated task, network, commands, timezone, DLQ, and retry policy"
  else
    echo "schedule group does not exist yet; generated configuration is valid"
  fi
  echo "validation only; no AWS resources changed"
  exit 0
fi

aws scheduler get-schedule-group --region "$AWS_REGION" --name "$GROUP" >/dev/null 2>&1 ||
  aws scheduler create-schedule-group --region "$AWS_REGION" --name "$GROUP" >/dev/null

# Provision the complete safe targets disabled first. Monitoring must be fully
# configured before either schedule is allowed to launch.
upsert_schedule "$DAILY" "cron(0 0 * * ? *)" "$DAILY_TARGET" "DISABLED"
upsert_schedule "$LATE" "cron(0 9 * * ? *)" "$LATE_TARGET" "DISABLED"

CLUSTER_NAME="${ECS_CLUSTER_ARN##*/}"
TASK_FAMILY="$(jq -r .family <<<"$TASK_JSON")"
EVENT_PATTERN="$(jq -n \
  --arg cluster "$ECS_CLUSTER_ARN" \
  --arg family "$TASK_FAMILY" \
  --arg container "$MIGRATION_CONTAINER_NAME" \
  '{
    source:["aws.ecs"],
    "detail-type":["ECS Task State Change"],
    detail:{
      clusterArn:[$cluster],
      lastStatus:["STOPPED"],
      group:["family:" + $family],
      containers:{name:[$container],exitCode:[{"anything-but":0}]}
    }
  }')"
RULE_ARN="$(aws events put-rule \
  --region "$AWS_REGION" \
  --name "$FAILURE_RULE" \
  --state ENABLED \
  --event-pattern "$EVENT_PATTERN" \
  --query RuleArn \
  --output text)"
STARTUP_EVENT_PATTERN="$(jq -n \
  --arg cluster "$ECS_CLUSTER_ARN" \
  --arg family "$TASK_FAMILY" \
  '{
    source:["aws.ecs"],
    "detail-type":["ECS Task State Change"],
    detail:{
      clusterArn:[$cluster],
      lastStatus:["STOPPED"],
      group:["family:" + $family],
      stopCode:["TaskFailedToStart"]
    }
  }')"

NONZERO_TEST_EVENT="$(jq -n \
  --arg cluster "$ECS_CLUSTER_ARN" \
  --arg family "$TASK_FAMILY" \
  --arg container "$MIGRATION_CONTAINER_NAME" \
  '{
    version:"0",id:"test",source:"aws.ecs","detail-type":"ECS Task State Change",
    account:"000000000000",time:"2026-09-16T07:00:00Z",region:"us-west-2",resources:[],
    detail:{
      clusterArn:$cluster,lastStatus:"STOPPED",group:("family:" + $family),
      containers:[
        {name:"sidecar",exitCode:0},
        {name:$container,exitCode:1}
      ]
    }
  }')"
[[ "$(aws events test-event-pattern --region "$AWS_REGION" --event-pattern "$EVENT_PATTERN" --event "$NONZERO_TEST_EVENT" --query Result --output text)" == "True" ]] ||
  { echo "generated nonzero-exit event pattern failed its fixture" >&2; exit 1; }

STARTUP_TEST_EVENT="$(jq -n \
  --arg cluster "$ECS_CLUSTER_ARN" \
  --arg family "$TASK_FAMILY" \
  '{
    version:"0",id:"test",source:"aws.ecs","detail-type":"ECS Task State Change",
    account:"000000000000",time:"2026-09-16T07:00:00Z",region:"us-west-2",resources:[],
    detail:{
      clusterArn:$cluster,lastStatus:"STOPPED",group:("family:" + $family),
      stopCode:"TaskFailedToStart",containers:[]
    }
  }')"
[[ "$(aws events test-event-pattern --region "$AWS_REGION" --event-pattern "$STARTUP_EVENT_PATTERN" --event "$STARTUP_TEST_EVENT" --query Result --output text)" == "True" ]] ||
  { echo "generated startup-failure event pattern failed its fixture" >&2; exit 1; }

STARTUP_RULE_ARN="$(aws events put-rule \
  --region "$AWS_REGION" \
  --name "$STARTUP_FAILURE_RULE" \
  --state ENABLED \
  --event-pattern "$STARTUP_EVENT_PATTERN" \
  --query RuleArn \
  --output text)"

TOPIC_POLICY="$(aws sns get-topic-attributes \
  --region "$AWS_REGION" \
  --topic-arn "$S1_SYNC_ALERT_TOPIC_ARN" \
  --query Attributes.Policy \
  --output text)"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
PARTITION="$(cut -d: -f2 <<<"$S1_SYNC_ALERT_TOPIC_ARN")"
TARGET_ERROR_ALARM_ARN="arn:${PARTITION}:cloudwatch:${AWS_REGION}:${ACCOUNT_ID}:alarm:sirius-s1-daily-TargetErrorCount"
DROPPED_ALARM_ARN="arn:${PARTITION}:cloudwatch:${AWS_REGION}:${ACCOUNT_ID}:alarm:sirius-s1-daily-InvocationDroppedCount"
DLQ_ALARM_ARN="arn:${PARTITION}:cloudwatch:${AWS_REGION}:${ACCOUNT_ID}:alarm:sirius-s1-daily-scheduler-dlq-not-empty"
TOPIC_POLICY="$(jq \
  --arg topic "$S1_SYNC_ALERT_TOPIC_ARN" \
  --arg rule "$RULE_ARN" \
  --arg startupRule "$STARTUP_RULE_ARN" \
  --arg account "$ACCOUNT_ID" \
  --arg targetAlarm "$TARGET_ERROR_ALARM_ARN" \
  --arg droppedAlarm "$DROPPED_ALARM_ARN" \
  --arg dlqAlarm "$DLQ_ALARM_ARN" \
  '.Statement |= (
    map(select(.Sid != "AllowS1DailyEcsFailureEvents" and .Sid != "AllowS1DailyCloudWatchAlarms"))
    + [{
      Sid:"AllowS1DailyEcsFailureEvents",
      Effect:"Allow",
      Principal:{Service:"events.amazonaws.com"},
      Action:"sns:Publish",
      Resource:$topic,
      Condition:{ArnEquals:{"aws:SourceArn":[$rule,$startupRule]}}
    },{
      Sid:"AllowS1DailyCloudWatchAlarms",
      Effect:"Allow",
      Principal:{Service:"cloudwatch.amazonaws.com"},
      Action:"sns:Publish",
      Resource:$topic,
      Condition:{
        StringEquals:{"aws:SourceAccount":$account},
        ArnEquals:{"aws:SourceArn":[$targetAlarm,$droppedAlarm,$dlqAlarm]}
      }
    }]
  )' <<<"$TOPIC_POLICY")"
aws sns set-topic-attributes \
  --region "$AWS_REGION" \
  --topic-arn "$S1_SYNC_ALERT_TOPIC_ARN" \
  --attribute-name Policy \
  --attribute-value "$TOPIC_POLICY"

FAILURE_INPUT_PATHS='{"taskArn":"$.detail.taskArn","stoppedAt":"$.detail.stoppedAt","stopCode":"$.detail.stopCode","exitCode":"$.detail.containers[0].exitCode"}'
FAILURE_TEMPLATE='{"event":"s1-daily-ecs-task-failed","taskArn":<taskArn>,"stoppedAt":<stoppedAt>,"stopCode":<stopCode>,"exitCode":<exitCode>}'
aws events put-targets \
  --region "$AWS_REGION" \
  --rule "$FAILURE_RULE" \
  --targets "$(jq -n \
    --arg arn "$S1_SYNC_ALERT_TOPIC_ARN" \
    --arg paths "$FAILURE_INPUT_PATHS" \
    --arg template "$FAILURE_TEMPLATE" \
    '[{Id:"s1-daily-alert-topic",Arn:$arn,InputTransformer:{InputPathsMap:($paths|fromjson),InputTemplate:$template}}]')" >/dev/null

STARTUP_INPUT_PATHS='{"taskArn":"$.detail.taskArn","stoppedAt":"$.detail.stoppedAt","stopCode":"$.detail.stopCode"}'
STARTUP_TEMPLATE='{"event":"s1-daily-ecs-task-start-failed","taskArn":<taskArn>,"stoppedAt":<stoppedAt>,"stopCode":<stopCode>}'
aws events put-targets \
  --region "$AWS_REGION" \
  --rule "$STARTUP_FAILURE_RULE" \
  --targets "$(jq -n \
    --arg arn "$S1_SYNC_ALERT_TOPIC_ARN" \
    --arg paths "$STARTUP_INPUT_PATHS" \
    --arg template "$STARTUP_TEMPLATE" \
    '[{Id:"s1-daily-startup-alert-topic",Arn:$arn,InputTransformer:{InputPathsMap:($paths|fromjson),InputTemplate:$template}}]')" >/dev/null

for metric in TargetErrorCount InvocationDroppedCount; do
  aws cloudwatch put-metric-alarm \
    --region "$AWS_REGION" \
    --alarm-name "sirius-s1-daily-${metric}" \
    --alarm-description "EventBridge Scheduler could not launch the S1 daily ECS task" \
    --namespace AWS/Scheduler \
    --metric-name "$metric" \
    --dimensions "Name=ScheduleGroup,Value=$GROUP" \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 1 \
    --datapoints-to-alarm 1 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --treat-missing-data notBreaching \
    --alarm-actions "$S1_SYNC_ALERT_TOPIC_ARN"
done

DLQ_NAME="${SCHEDULER_DLQ_ARN##*:}"
aws cloudwatch put-metric-alarm \
  --region "$AWS_REGION" \
  --alarm-name "sirius-s1-daily-scheduler-dlq-not-empty" \
  --alarm-description "EventBridge Scheduler exhausted delivery for an S1 automation task" \
  --namespace AWS/SQS \
  --metric-name ApproximateNumberOfMessagesVisible \
  --dimensions "Name=QueueName,Value=$DLQ_NAME" \
  --statistic Maximum \
  --period 300 \
  --evaluation-periods 1 \
  --datapoints-to-alarm 1 \
  --threshold 1 \
  --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$S1_SYNC_ALERT_TOPIC_ARN"

echo "configured Scheduler/DLQ alarms plus ECS startup/nonzero-exit rules for cluster=$CLUSTER_NAME family=$TASK_FAMILY"
echo "manual proof command uses the exact daily target:"
printf 'aws ecs run-task --region %q --cluster %q --launch-type FARGATE --task-definition %q --network-configuration %q --overrides %q\n' \
  "$AWS_REGION" "$ECS_CLUSTER_ARN" "$TASK_ARN" \
  "awsvpcConfiguration={subnets=[$PRIVATE_SUBNET_IDS],securityGroups=[$SECURITY_GROUP_IDS],assignPublicIp=DISABLED}" \
  "$(jq -r .Input <<<"$DAILY_TARGET")"
if [[ "$ACTION" == "enable" ]]; then
  rollback_enable() {
    set +e
    echo "enable failed; disabling both schedules" >&2
    upsert_schedule "$DAILY" "cron(0 0 * * ? *)" "$DAILY_TARGET" "DISABLED"
    upsert_schedule "$LATE" "cron(0 9 * * ? *)" "$LATE_TARGET" "DISABLED"
  }
  trap rollback_enable ERR
  upsert_schedule "$DAILY" "cron(0 0 * * ? *)" "$DAILY_TARGET" "ENABLED"
  upsert_schedule "$LATE" "cron(0 9 * * ? *)" "$LATE_TARGET" "ENABLED"
  schedule_matches "$DAILY" "cron(0 0 * * ? *)" "$DAILY_TARGET" "ENABLED"
  schedule_matches "$LATE" "cron(0 9 * * ? *)" "$LATE_TARGET" "ENABLED"
  trap - ERR
  echo "configured and verified both schedules state=ENABLED"
else
  echo "configured and verified both schedules state=DISABLED"
  echo "After the preflight, manual sync, and alert exercises pass, run: $0 enable"
fi
