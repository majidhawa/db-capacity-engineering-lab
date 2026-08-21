# Health and Readiness Validation

This evidence validates the application's separate liveness and readiness probes.

## Healthy State

Evidence: `healthy.txt`

Expected and observed:

- `/healthz` returned HTTP 200 with `{"status":"alive"}`
- `/readyz` returned HTTP 200 with `{"status":"ready","database":"reachable"}`

This confirms that the application process was alive and its database dependency was reachable.

## Degraded Database State

Evidence: `readyz-degraded.txt`

The database credential stored in Secrets Manager was deliberately replaced with an invalid password and the application runtime was restarted.

Observed:

- `/healthz` continued returning HTTP 200.
- `/readyz` returned HTTP 503 with `{"status":"not_ready","database":"unreachable"}`.

This demonstrates that loss of database connectivity does not incorrectly mark the application process as dead. Instead, readiness correctly reports that the service should not receive traffic.

## Recovery

Evidence: `recovered.txt`

The valid database credential was restored through Terraform/Secrets Manager and the runtime was restarted.

Observed:

- `/healthz` returned HTTP 200.
- `/readyz` recovered to HTTP 200 with the database reported as reachable.

## Result

The application correctly distinguishes:

- **Liveness:** Is the application process running?
- **Readiness:** Is the application able to serve requests that depend on its database?

The failure test also demonstrates successful recovery after restoring the database secret.
