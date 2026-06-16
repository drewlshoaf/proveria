output "app_url" {
  description = "Public ALB URL. Verifier is the default app; API routes are path-routed through the same ALB."
  value       = local.app_url
}

output "aws_region" {
  description = "AWS region used by this stack."
  value       = var.aws_region
}

output "artifact_bucket" {
  description = "S3 bucket used for Proveria artifacts."
  value       = aws_s3_bucket.artifacts.bucket
}

output "ecr_repositories" {
  description = "ECR repository URLs by service."
  value       = { for name, repo in aws_ecr_repository.service : name => repo.repository_url }
}

output "api_ecr_repository" {
  description = "API ECR repository URL."
  value       = aws_ecr_repository.service["api"].repository_url
}

output "worker_ecr_repository" {
  description = "Worker ECR repository URL."
  value       = aws_ecr_repository.service["worker"].repository_url
}

output "verifier_ecr_repository" {
  description = "Verifier ECR repository URL."
  value       = aws_ecr_repository.service["verifier"].repository_url
}

output "ecs_cluster" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.main.name
}

output "api_service" {
  description = "API ECS service name."
  value       = aws_ecs_service.api.name
}

output "migration_task_definition" {
  description = "One-off ECS task definition for database migrations."
  value       = aws_ecs_task_definition.migrate.arn
}

output "migration_subnets" {
  description = "Subnet ids to use when running the migration ECS task."
  value       = [for subnet in aws_subnet.public : subnet.id]
}

output "migration_subnets_csv" {
  description = "Comma-separated subnet ids to use when running the migration ECS task."
  value       = join(",", [for subnet in aws_subnet.public : subnet.id])
}

output "migration_security_group" {
  description = "Security group id to use when running the migration ECS task."
  value       = aws_security_group.ecs.id
}

output "worker_service" {
  description = "Worker ECS service name."
  value       = aws_ecs_service.worker.name
}

output "verifier_service" {
  description = "Verifier ECS service name."
  value       = aws_ecs_service.verifier.name
}
