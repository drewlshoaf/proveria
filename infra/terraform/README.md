# Proveria AWS Dev Stack

This Terraform stack is the first AWS deployment scaffold for Proveria. It is
intentionally optimized for an ephemeral dev environment: bring it up, test the
system, and tear it down when you are done.

## What It Creates

- VPC with public ECS subnets and private data subnets
- Application Load Balancer
- ECS Fargate cluster and services for API, worker, and verifier
- ECR repositories for API, worker, and verifier images
- RDS Postgres
- ElastiCache Redis
- S3 artifact bucket
- Secrets Manager entries for database, Redis, and session secrets
- IAM roles for ECS task execution and app access to S3/secrets
- CloudWatch log groups

The ECS tasks run in public subnets behind the ALB to avoid NAT gateway cost
while we iterate. Treat this as a dev architecture. A production architecture
should move workloads into private subnets and add NAT gateways or VPC
endpoints.

## Prerequisites

- Terraform installed locally
- AWS CLI configured with a profile that can create VPC, ECS, ECR, RDS,
  ElastiCache, IAM, Secrets Manager, S3, and CloudWatch resources
- Docker available locally for image builds

## Configure

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` and set at least:

```hcl
aws_profile = "your-profile"
aws_region  = "us-east-1"
```

## Create The Base Stack

The default `service_desired_count` is `0`, so Terraform can create the
networking, data stores, repositories, and ECS services without trying to run
containers before images are pushed.

```bash
terraform init
terraform plan
terraform apply
```

## Build And Push Images

After `terraform apply`, build and push all three images:

```bash
IMAGE_TAG=dev ./bin/build-and-push-images.sh
```

The script reads the ECR repository URLs from Terraform outputs, logs Docker in
to ECR, builds the API, worker, and verifier images, and pushes them with the
selected tag.

## Run Migrations

Run the one-off migration task after images are pushed and before scaling API or
worker above zero:

```bash
./bin/run-migrations.sh
```

The script starts the ECS task and prints the task ARN. Check the task logs in
CloudWatch under the API log group with the `migrate` stream prefix.

## Start Services

Set desired counts in `terraform.tfvars`:

```hcl
service_desired_count = {
  api      = 1
  worker   = 1
  verifier = 1
}
```

Then apply:

```bash
terraform apply
```

The verifier URL is available in the `app_url` output.

## Tear Down

When you are done testing:

```bash
terraform destroy
```

The dev defaults set `force_destroy_artifacts = true`,
`skip_final_snapshot = true`, and `deletion_protection = false` so teardown is
not blocked by disposable state.

## Current Limitations

- HTTP only; no custom domain or ACM certificate yet.
- Dev Dockerfiles run the app in watch/dev mode.
- Database migrations are modeled as a one-off ECS task, but the runbook does
  not yet wait for task completion or stream migration logs.
- No autoscaling or production-grade private subnet egress.
- OIDC client secrets are not wired into Terraform yet.

## First Apply Checklist

Use this sequence for the first AWS test pass:

- Confirm AWS CLI auth with `aws sts get-caller-identity`.
- Copy `terraform.tfvars.example` to `terraform.tfvars`.
- Set `aws_profile`, `aws_region`, and keep `service_desired_count` at zero.
- Run `terraform init`, `terraform plan`, and `terraform apply`.
- Run `IMAGE_TAG=dev ./bin/build-and-push-images.sh`.
- Run `./bin/run-migrations.sh` and confirm the migration task exits
  successfully in CloudWatch.
- Set API, worker, and verifier desired counts to `1`.
- Run `terraform apply` again.
- Open `terraform output -raw app_url`.
- When done, set desired counts back to zero or run `terraform destroy`.
