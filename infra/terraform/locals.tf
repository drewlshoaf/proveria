data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project}-${var.environment}"
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)

  public_subnet_cidrs  = [for index, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, index)]
  private_subnet_cidrs = [for index, _ in local.azs : cidrsubnet(var.vpc_cidr, 8, index + 10)]

  api_paths = {
    health       = { priority = 10, path = "/healthz" }
    ready        = { priority = 11, path = "/readyz" }
    auth         = { priority = 20, path = "/auth/*" }
    me           = { priority = 21, path = "/me/*" }
    tenants      = { priority = 22, path = "/tenants/*" }
    attestations = { priority = 23, path = "/attestations/*" }
    links        = { priority = 24, path = "/links/*" }
    admin        = { priority = 25, path = "/admin/*" }
    public_api   = { priority = 26, path = "/public-v1/*" }
    receipt_pdf  = { priority = 27, path = "/v/*.pdf" }
  }

  ecr_images = {
    api      = "${aws_ecr_repository.service["api"].repository_url}:${var.image_tag}"
    worker   = "${aws_ecr_repository.service["worker"].repository_url}:${var.image_tag}"
    verifier = "${aws_ecr_repository.service["verifier"].repository_url}:${var.image_tag}"
  }

  images = merge(local.ecr_images, var.container_images)

  app_url      = "http://${aws_lb.app.dns_name}"
  database_url = "postgres://proveria:${random_password.db.result}@${aws_db_instance.postgres.address}:5432/proveria?sslmode=require"
  redis_url    = "redis://${aws_elasticache_replication_group.redis.primary_endpoint_address}:6379"

  tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }
}
