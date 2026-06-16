#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform"
REGION="$(terraform -chdir="$TF_DIR" output -raw aws_region)"
IMAGE_TAG="${IMAGE_TAG:-dev}"

api_repo="$(terraform -chdir="$TF_DIR" output -raw api_ecr_repository)"
worker_repo="$(terraform -chdir="$TF_DIR" output -raw worker_ecr_repository)"
verifier_repo="$(terraform -chdir="$TF_DIR" output -raw verifier_ecr_repository)"
registry="${api_repo%%/*}"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$registry"

docker buildx build \
  --platform linux/amd64 \
  -f "$ROOT_DIR/apps/api/Dockerfile" \
  -t "$api_repo:$IMAGE_TAG" \
  --push \
  "$ROOT_DIR"

docker buildx build \
  --platform linux/amd64 \
  -f "$ROOT_DIR/apps/worker/Dockerfile" \
  -t "$worker_repo:$IMAGE_TAG" \
  --push \
  "$ROOT_DIR"

docker buildx build \
  --platform linux/amd64 \
  -f "$ROOT_DIR/apps/verifier/Dockerfile" \
  -t "$verifier_repo:$IMAGE_TAG" \
  --push \
  "$ROOT_DIR"

printf 'Pushed images with tag %s\n' "$IMAGE_TAG"
