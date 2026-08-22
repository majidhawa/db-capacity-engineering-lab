# OPS-2202 Incident Replay

## Incident

Application freezes during registration surges even though the database query
itself is lightweight.

The original investigation identified application-side MySQL connection-pool
queueing as the primary mechanism.

## Runtime Configuration

The rehosted runtime uses:

- MySQL pool `connectionLimit: 4`
- `waitForConnections: true`
- unbounded pool queue (`queueLimit: 0`)
- Aiven MySQL
- Docker application runtime

## Replay Workload

The original OPS-2202 workload was replayed unchanged:

- ramp to 2,000 VUs over 5 seconds
- remain at 2,000 VUs for 25 seconds
- `GET /api/patients/recent`
- expected HTTP failure rate `<5%`

## Replay Result

Observed:

- 2,000 maximum VUs
- 226 completed iterations
- 1,968 interrupted iterations
- average latency: 15.35s
- p95 latency: 31.75s
- maximum latency: 34.39s
- throughput: 6.43 req/s
- completed-request failure rate: 0%

The HTTP failure threshold technically passed because completed requests
returned HTTP 200. However, the very low completed throughput, multi-second
latency, and large number of interrupted iterations demonstrate severe
queueing under the 2,000-VU burst.

See `replay.txt`.

## Observability

Grafana showed a large latency increase for `/api/patients/recent` during the
surge.

Prometheus transitioned `ApiHighP99Latency` to FIRING.

`ApiHighErrorRate` remained inactive, which is consistent with the incident:
the dominant failure mode is waiting/queueing rather than HTTP 5xx responses.

See:

- `alerts-after-replay.txt`
- `p99-after-replay.txt`
- `throughput-after-replay.txt`

## Pool Attribution

The original Assignment 1 investigation established that this workload was
limited by the application MySQL pool and an unbounded waiting queue.

The current C7 Prometheus instrumentation does not expose direct pool queue
depth or active/waiting connection metrics. Therefore this replay demonstrates
the same observable queueing symptom but does not claim direct measurement of
the pool queue itself.

## Recovery

After surge traffic stopped, health, readiness, request latency, alert state,
and container stability were checked again.

See `recovery.txt`.

## Result

OPS-2202 was successfully replayed against the rehosted runtime.

Unlike an error-driven outage, this replay showed that a service can remain
technically successful at the HTTP level while becoming operationally
unusable because requests wait for limited application-side capacity.
