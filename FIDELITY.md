# Fidelity Report — Regional Health Platform

## Purpose

This document records where the local implementation matches the intended
production architecture and where substitutions or limitations were necessary
because the environment is running locally with LocalStack, Docker, Terraform,
and external managed services.

The goal was not to claim that the local environment is identical to AWS
production. Instead, the implementation preserves the important operational
behaviours that can be validated locally and documents the areas where full
cloud fidelity was not possible.

---

## 1. Infrastructure as Code

### Intended architecture

The platform is defined using Terraform and models infrastructure that would
normally be deployed to AWS.

The implementation separates infrastructure concerns into modules, including:

- `modules/data`
- `modules/service`

Terraform validation and formatting checks are included in the verification
workflow.

### Fidelity

High for infrastructure definition.

The Terraform configuration represents the intended infrastructure and can be
validated statically even where the local AWS emulator cannot fully execute
every resource.

---

## 2. Database: RDS to Aiven MySQL

### Intended architecture

The original architecture expected an AWS-managed relational database.

### Local implementation

Aiven MySQL is used as the working database instead of provisioning a full RDS
instance inside LocalStack.

Database credentials are published through the Secrets Manager workflow rather
than being hard-coded into the application.

### Reason for deviation

The local environment cannot reproduce all managed AWS database behaviour with
the same fidelity as a real AWS deployment.

Using Aiven provides a real externally managed MySQL database while preserving
the important application behaviour:

- network database connectivity;
- authentication;
- secret retrieval;
- database readiness checks;
- database error handling.

### Fidelity impact

The database engine and application interaction are real, but the AWS RDS
control plane is not being exercised.

---

## 3. Secrets Manager

The Terraform data module publishes database connection information into
Secrets Manager.

The application runtime retrieves the database configuration rather than
depending on credentials committed to source control.

This preserves an important production pattern:

Application -> Secrets Manager -> Database credentials -> Database

During testing, secret versions could be changed independently of application
source code.

### Fidelity

High for secret-management behaviour.

LocalStack emulates the AWS Secrets Manager API, while the actual database is
hosted externally.

---

## 4. EC2 Runtime

### Intended architecture

The service architecture models an EC2-hosted application runtime.

Terraform contains the service infrastructure required to describe that
deployment.

### Local limitation

The available LocalStack environment does not provide complete production
fidelity for running the intended EC2 workload and associated networking
behaviour.

Therefore, Terraform is used to represent and validate the EC2 infrastructure,
while the application runtime is exercised locally using Docker.

The local runtime is started through:

`scripts/run-app.sh`

### What is still validated

The Docker-backed runtime allows validation of:

- application startup;
- environment configuration;
- secret retrieval;
- database connectivity;
- `/healthz`;
- `/readyz`;
- `/metrics`;
- application failure behaviour;
- recovery behaviour.

### Fidelity impact

The application process and operational behaviour are real, but the compute
control plane is not a real AWS EC2 instance.

---

## 5. Load Balancing / ELBv2

### Intended architecture

The production-style design expects traffic routing through AWS load-balancing
infrastructure.

### Local limitation

Full ELBv2 behaviour could not be reproduced reliably in the available local
environment.

The Terraform configuration therefore represents the intended cloud
architecture, while runtime HTTP validation is performed directly against the
local application endpoint.

### Fidelity impact

Infrastructure intent is preserved as code, but actual AWS load-balancer
routing is not part of the local runtime validation.

---

## 6. Health and Readiness

The application exposes separate health and readiness endpoints.

### `/healthz`

Confirms that the application process is alive.

### `/readyz`

Confirms that the application is ready to serve requests and that the database
is reachable.

During final validation:

- `/healthz` returned HTTP 200;
- `/readyz` returned HTTP 200;
- the database was reported as reachable.

This distinction preserves production-style health semantics even though the
runtime is local.

---

## 7. Observability

The platform includes a local observability stack consisting of:

- Prometheus;
- Grafana;
- application Prometheus metrics;
- PromQL alert rules.

Prometheus scrapes the application's `/metrics` endpoint.

Grafana visualizes operational signals including:

- request throughput;
- p95 latency;
- p99 latency;
- 5xx error rate;
- process memory;
- Node.js heap usage;
- event-loop p99 lag;
- database errors.

### Alert validation

Alert rules include:

- `ApiHighP99Latency`
- `ApiHighErrorRate`
- `ApiMemoryPressure`
- `ApiEventLoopLag`
- `DatabaseErrorsDetected`

A real application/database failure was observed during testing:

`ER_NO_SUCH_TABLE`

The request to the database-dependent endpoint returned HTTP 500 and
incremented the database error metric.

Prometheus subsequently showed `DatabaseErrorsDetected` in the FIRING state.

This demonstrated the complete observability path:

Application failure
-> application metric
-> Prometheus scrape
-> PromQL evaluation
-> alert state
-> Grafana visualization

### Recovery

After the test condition ended, the database-error alert cleared from the
active alert set.

The application remained healthy and the database remained reachable.

---

## 8. Verification Gates

The shared platform includes a `make verify` workflow covering:

- Terraform formatting;
- Terraform validation;
- TFLint;
- Terraform drift/plan checking when a deployed Terraform root is supplied;
- Gitleaks;
- Trivy IaC scanning;
- deployed health checks when a base URL is supplied.

A successful runtime verification completed with:

`VERIFY_EXIT=0`

The security scans reported no blocking findings during the successful
verification run.

---

## 9. Drift Detection Limitation

The verification workflow supports deployed-state drift checking through
`TF_ROOT_DIR` and `TF_CMD`.

For example, the local environment can invoke the Terraform plan through
`tflocal`.

During validation, the LocalStack-backed Terraform plan did not complete in a
reasonable time and was manually interrupted.

Therefore, drift detection is implemented as a verification capability, but a
successful full deployed-state drift run is not claimed as completed evidence.

This limitation is documented rather than treating a skipped or interrupted
plan as a successful drift check.

---

## 10. Fidelity Summary

| Area | Local implementation | Fidelity |
|---|---|---|
| Terraform IaC | Real Terraform configuration | High |
| Database | Real Aiven MySQL | High application fidelity |
| AWS RDS control plane | Replaced by Aiven | Partial |
| Secrets Manager | LocalStack Secrets Manager | High behavioural fidelity |
| EC2 infrastructure | Terraform representation | Partial |
| Application runtime | Local Docker runtime | High application fidelity |
| ELBv2 | Terraform representation only | Partial |
| Health checks | Real HTTP endpoints | High |
| Prometheus | Real local Prometheus | High |
| Grafana | Real local Grafana | High |
| Alert evaluation | Real PromQL alerts | High |
| Security verification | TFLint, Gitleaks and Trivy | High |
| Drift detection | Implemented; full run limited by local environment | Partial |

---

## Conclusion

The local environment intentionally prioritizes behavioural fidelity over
claiming complete AWS service fidelity.

Where LocalStack or the available environment could reproduce the required
behaviour, the behaviour was tested directly.

Where complete cloud-service behaviour could not be reproduced, the intended
architecture remains represented in Terraform and the limitation is explicitly
documented.

No unsupported local behaviour is presented as equivalent to a successful
production AWS deployment.
