variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "localstack_endpoint" {
  type    = string
  default = "http://localhost:4566"
}

variable "db_host" {
  type = string
}

variable "db_port" {
  type    = number
  default = 3306
}

variable "db_username" {
  type    = string
  default = "avnadmin"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "db_name" {
  type    = string
  default = "capacity_lab"
}

variable "allowed_ingress_cidrs" {
  type = list(string)
}

variable "allowed_egress_cidrs" {
  type = list(string)
}
