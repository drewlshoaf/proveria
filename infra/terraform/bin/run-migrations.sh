#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform"

cluster="$(terraform -chdir="$TF_DIR" output -raw ecs_cluster)"
task_definition="$(terraform -chdir="$TF_DIR" output -raw migration_task_definition)"
subnets="$(terraform -chdir="$TF_DIR" output -raw migration_subnets_csv)"
security_group="$(terraform -chdir="$TF_DIR" output -raw migration_security_group)"

aws ecs run-task \
  --cluster "$cluster" \
  --task-definition "$task_definition" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$security_group],assignPublicIp=ENABLED}"
