variable "aws_region" {
  description = "AWS region for the stack."
  type        = string
  default     = "us-east-1"
}

variable "aws_profile" {
  description = "Optional local AWS CLI profile name."
  type        = string
  default     = ""
}

variable "project" {
  description = "Short project name used in resource names."
  type        = string
  default     = "proveria"
}

variable "environment" {
  description = "Environment name used in resource names."
  type        = string
  default     = "dev"
}

variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.42.0.0/16"
}

variable "image_tag" {
  description = "Default image tag used for all service images."
  type        = string
  default     = "dev"
}

variable "container_images" {
  description = "Optional explicit image URIs by service name."
  type        = map(string)
  default     = {}
}

variable "service_desired_count" {
  description = "Desired ECS task count by service. Defaults to zero to avoid running cost before images are pushed."
  type        = map(number)
  default = {
    api      = 0
    worker   = 0
    verifier = 0
  }
}

variable "log_retention_days" {
  description = "CloudWatch log retention in days."
  type        = number
  default     = 7
}

variable "db_instance_class" {
  description = "RDS instance class for the dev database."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_engine_version" {
  description = "Postgres engine version for RDS."
  type        = string
  default     = "16"
}

variable "redis_node_type" {
  description = "ElastiCache Redis node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "force_destroy_artifacts" {
  description = "Allow Terraform destroy to delete a non-empty artifacts bucket."
  type        = bool
  default     = true
}

variable "api_cpu" {
  description = "API task CPU units."
  type        = number
  default     = 512
}

variable "api_memory" {
  description = "API task memory in MiB."
  type        = number
  default     = 1024
}

variable "worker_cpu" {
  description = "Worker task CPU units."
  type        = number
  default     = 1024
}

variable "worker_memory" {
  description = "Worker task memory in MiB."
  type        = number
  default     = 2048
}

variable "verifier_cpu" {
  description = "Verifier task CPU units."
  type        = number
  default     = 512
}

variable "verifier_memory" {
  description = "Verifier task memory in MiB."
  type        = number
  default     = 1024
}

