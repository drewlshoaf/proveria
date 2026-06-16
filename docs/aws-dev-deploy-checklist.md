# AWS Dev Deploy Checklist

Use this checklist for the first cost-conscious AWS deployment test. This is
for the ephemeral ECS dev stack in `infra/terraform`, not production.

## Before Applying

- [ ] Confirm which AWS account and region we are using.
- [ ] Confirm the AWS CLI profile can create VPC, ECS, ECR, RDS, ElastiCache,
  S3, IAM, Secrets Manager, CloudWatch, and load balancer resources.
- [ ] Confirm Docker is running locally.
- [ ] Confirm Terraform is installed.
- [ ] Confirm `infra/terraform/terraform.tfvars` exists and is not committed.
- [ ] Confirm `service_desired_count` is zero for API, worker, and verifier.

## Base Infrastructure

- [ ] Run `terraform -chdir=infra/terraform init`.
- [ ] Run `terraform -chdir=infra/terraform plan`.
- [ ] Review expected resources and estimated cost-sensitive items.
- [ ] Run `terraform -chdir=infra/terraform apply`.
- [ ] Confirm ECR repositories exist.
- [ ] Confirm RDS, Redis, and S3 artifacts bucket exist.

## Images And Migrations

- [ ] Run `cd infra/terraform`.
- [ ] Run `IMAGE_TAG=dev ./bin/build-and-push-images.sh`.
- [ ] Confirm API, worker, and verifier images are present in ECR.
- [ ] Run `./bin/run-migrations.sh`.
- [ ] Confirm the migration ECS task exits successfully.
- [ ] Check CloudWatch migration logs for `[migrate] done`.

## Start Services

- [ ] Set desired counts to `1` for API, worker, and verifier.
- [ ] Run `terraform apply` again.
- [ ] Confirm all ECS services are stable.
- [ ] Confirm API health responds through the ALB.
- [ ] Open `terraform output -raw app_url`.
- [ ] Confirm verifier loads.

## Teardown

- [ ] If pausing but keeping infrastructure, set all desired counts to zero and
  run `terraform apply`.
- [ ] If done testing, run `terraform destroy`.
- [ ] Confirm RDS, Redis, ALB, ECS, and S3 resources are gone.
- [ ] Confirm no unexpected running resources remain in the AWS console.

