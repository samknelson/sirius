#!/usr/bin/env bash
# Operator-run repair of the confirmed missing role used by sirius-migration:45.
# Reads secret/key metadata only, never secret values. Does NOT run ECS tasks,
# modify the application task role, register revisions, or change KMS key policies.
# Stop on partial failure; do not delete/recreate an existing role to retry.
set -euo pipefail

account=142403088251
region=us-west-2
role=fc-ue2ts0zjx-baos2-migrationstage--EcsExecutionRole-NaLRsC8yTnfH
role_arn="arn:aws:iam::$account:role/$role"
secrets='[
  "arn:aws:secretsmanager:us-west-2:142403088251:secret:sirius-migration/EXTERNAL_DATABASE_URL-z9jNFl",
  "arn:aws:secretsmanager:us-west-2:142403088251:secret:sirius-migration/S1_DATABASE_URL-5GbWbN"
]'
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT

command -v jq >/dev/null
test "$(aws sts get-caller-identity --query Account --output text)" = "$account" || {
  echo "Refusing: AWS caller is in a different account." >&2
  exit 1
}
if aws iam get-role --role-name "$role" >/dev/null 2>"$work/role-error"; then
  echo "Refusing: role already exists. Inspect it instead of overwriting it." >&2
  exit 1
elif ! grep -q 'NoSuchEntity' "$work/role-error"; then
  echo "Cannot verify that the role is absent. No IAM changes made." >&2
  cat "$work/role-error" >&2
  exit 1
fi

# Confirm the role/secret/log requirements still match the supplied revision.
aws ecs describe-task-definition --region "$region" \
  --task-definition sirius-migration:45 \
  --query 'taskDefinition.{
    executionRoleArn:executionRoleArn,
    taskRoleArn:taskRoleArn,
    containers:containerDefinitions[].{
      name:name,
      logDriver:logConfiguration.logDriver,
      logGroup:logConfiguration.options."awslogs-group",
      logRegion:logConfiguration.options."awslogs-region",
      registrySecret:repositoryCredentials.credentialsParameter,
      secrets:secrets[].valueFrom
    }
  }' --output json >"$work/task.json"
jq -e --arg execution "$role_arn" --argjson secrets "$secrets" '
  .executionRoleArn == $execution
  and .taskRoleArn == "arn:aws:iam::142403088251:role/sirius-migration-task"
  and (.containers | length) == 1
  and (.containers[0] |
    .name == "migration"
    and .logDriver == "awslogs"
    and .logGroup == "/sirius-migration"
    and .logRegion == "us-west-2"
    and .registrySecret == null
    and (.secrets | sort) == ($secrets | sort))
' "$work/task.json" >/dev/null || {
  echo "Refusing: task requirements differ from the inspected revision." >&2
  exit 1
}

# Resolve only customer-managed keys; never retrieve a database URL.
keys='[]'
while IFS= read -r secret; do
  key_id=$(aws secretsmanager describe-secret --region "$region" \
    --secret-id "$secret" --query KmsKeyId --output text)
  if [[ -n "$key_id" && "$key_id" != None && "$key_id" != null ]]; then
    metadata=$(aws kms describe-key --region "$region" --key-id "$key_id" \
      --query 'KeyMetadata.{Arn:Arn,Manager:KeyManager}' --output json)
    jq -e '(.Manager == "CUSTOMER" or .Manager == "AWS") and
      (.Arn | type == "string" and startswith("arn:aws:kms:us-west-2:142403088251:key/"))' \
      <<<"$metadata" >/dev/null
    if [[ $(jq -r .Manager <<<"$metadata") == CUSTOMER ]]; then
      key_arn=$(jq -er .Arn <<<"$metadata")
      keys=$(jq --arg arn "$key_arn" '. + [$arn] | unique' <<<"$keys")
    fi
  fi
done < <(jq -r '.[]' <<<"$secrets")

jq -n --arg account "$account" '{
  Version: "2012-10-17",
  Statement: [{
    Effect: "Allow", Principal: {Service: "ecs-tasks.amazonaws.com"},
    Action: "sts:AssumeRole",
    Condition: {StringEquals: {"aws:SourceAccount": $account}}
  }]
}' >"$work/trust.json"

jq -n --argjson secrets "$secrets" --argjson keys "$keys" '{
  Version: "2012-10-17",
  Statement: ([
    {
      Sid: "ReadOnlyMigrationDatabaseSecrets",
      Effect: "Allow", Action: "secretsmanager:GetSecretValue", Resource: $secrets
    },
    {
      Sid: "CreateMigrationLogGroup",
      Effect: "Allow", Action: "logs:CreateLogGroup",
      Resource: [
        "arn:aws:logs:us-west-2:142403088251:log-group:/sirius-migration",
        "arn:aws:logs:us-west-2:142403088251:log-group:/sirius-migration:*"
      ]
    }
  ] + (if ($keys | length) > 0 then [{
    Sid: "DecryptMigrationSecretsOnly",
    Effect: "Allow", Action: "kms:Decrypt", Resource: $keys,
    Condition: {StringEquals: {
      "kms:ViaService": "secretsmanager.us-west-2.amazonaws.com",
      "kms:EncryptionContext:SecretARN": $secrets
    }}
  }] else [] end))
}' >"$work/access.json"

echo "Preflight passed. Creating the missing execution role and its policies."
aws iam create-role --role-name "$role" \
  --description "Standalone S1 migration execution role; restored after owning Flightcontrol project removal" \
  --assume-role-policy-document "file://$work/trust.json" \
  --query Role.Arn --output text
aws iam attach-role-policy --role-name "$role" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
aws iam put-role-policy --role-name "$role" \
  --policy-name SiriusMigrationSecretsAndLogGroup \
  --policy-document "file://$work/access.json"
aws iam wait role-exists --role-name "$role"
echo "Execution role restored. No ECS task was launched and the application task role was not changed."
echo "Allow IAM propagation before retrying the original run-task command."
echo "Customer-managed KMS key policies, resource policies, and organizational denies still apply."
