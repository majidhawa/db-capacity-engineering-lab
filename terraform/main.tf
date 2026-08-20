terraform {
  required_version = ">= 1.15.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.60"
    }
  }
}

provider "aws" {
  region                      = var.aws_region
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    ec2            = var.localstack_endpoint
    s3             = var.localstack_endpoint
    dynamodb       = var.localstack_endpoint
    secretsmanager = var.localstack_endpoint
  }
}

module "data" {
  source = "../../regional-health-platform/modules/data"

  db_host     = var.db_host
  db_port     = var.db_port
  db_username = var.db_username
  db_password = var.db_password
  db_name     = var.db_name
}

module "service" {
  source = "../../regional-health-platform/modules/service"

  # The module's default ami_id (ami-df5de72bdb3b) doesn't exist in LocalStack's
  # AMI catalog, so aws_instance creation fails with "couldn't find resource".
  # Override with one LocalStack actually knows about.
  ami_id = "ami-03cf127a"

  secret_arn            = module.data.secret_arn
  allowed_ingress_cidrs = var.allowed_ingress_cidrs
  allowed_egress_cidrs  = var.allowed_egress_cidrs
  create_lb             = false
}
