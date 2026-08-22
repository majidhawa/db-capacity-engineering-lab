# OPS-2203 Incident Replay

## Incident

Concurrent admissions to the same hospital create severe contention on a hot
database row.

The original Assignment 1 root cause was a transaction that held the hospital
row lock while waiting for a simulated external registry call.

## Verified Fix

The rehosted runtime was verified to contain the Assignment 1 fix:

1. update the hospital row;
2. commit the transaction;
3. release the MySQL connection;
4. call `notifyBedRegistry()` afterward.

This confirms the external 500 ms wait is no longer inside the database
transaction.

## Replay Workload

The original workload was replayed unchanged:

- 500 concurrent VUs
- 30 seconds
- all requests target hospital id `1`
- `POST /api/hospitals/1/admit`

## Replay Result

The first clean replay produced:

- 142 completed requests
- 411 interrupted iterations
- throughput: 2.37 req/s
- average latency: 36.22s
- p95 latency: 57.68s
- maximum latency: 59.78s
- completed-request HTTP failure rate: 2.11%

The latency SLO (`p95 < 1s`) failed.

## Runtime Behaviour

The application process itself remained alive:

- container remained `running`
- restart count remained `0`
- `OOMKilled=false`
- `/healthz` continued returning HTTP 200

However, `/readyz` temporarily timed out after the replay, showing that the
database-dependent path was saturated even though the process itself was alive.

Readiness recovered naturally shortly afterward:

- first recovery check timed out after 3 seconds;
- approximately 13 seconds later `/readyz` returned HTTP 200;
- database reported reachable.

## Database State After Recovery

After the workload drained, the Aiven process list showed only idle application
connections plus the diagnostic query, with no long-running admission query
remaining.

## Fidelity Note

The same fixed application code behaved differently against remote Aiven MySQL
than it did during the original local-MySQL Assignment 1 verification.

Original post-fix Assignment 1 result:

- throughput: 109.12 req/s
- p95: 6.03s

C7 Aiven replay:

- throughput: 2.37 req/s
- p95: 57.68s

The replay therefore demonstrates a significant rehosting capacity difference.

This C7 evidence does not claim direct observation of InnoDB lock wait rows,
because `sys.innodb_lock_waits` was not captured while the replay was active.

## Result

OPS-2203 was successfully replayed against the rehosted runtime.

The service remained alive but experienced severe database-path saturation
under 500 concurrent writes to the same hospital. Readiness degraded
temporarily and recovered after the backlog drained.
