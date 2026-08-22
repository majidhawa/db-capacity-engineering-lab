# OPS-2201 Incident Replay

## Incident

Patient last-name search collapses under concurrent shift-change load.

Replay workload:

- 200 concurrent VUs
- 30 seconds
- `GET /api/patients/search?lastName=Smith`
- expected p95 SLO: `<300 ms`

## Baseline

Before replay:

- `/healthz` returned HTTP 200
- `/readyz` returned HTTP 200
- single patient search returned HTTP 200 in approximately 0.29s
- response size was 17,392 bytes
- no Prometheus alerts were active

See `baseline.txt`.

## Replay Result

The original OPS-2201 k6 workload was replayed against the rehosted container runtime.

Observed:

- p95 latency: 18.92s
- 578 requests
- 10.03% request failure rate
- 58 failed checks
- connection resets occurred under load
- the `<300 ms` p95 threshold failed

See `replay.txt`.

## Observability

Prometheus detected the latency degradation and `ApiHighP99Latency`
transitioned to FIRING.

The recorded alert value reached approximately 10 seconds.

See:

- `alerts-after-replay.txt`
- `p99-after-replay.txt`

Grafana also showed the `/api/patients/search` latency and throughput spike.

## Recovery

After the replay traffic stopped:

- `/healthz` remained healthy
- `/readyz` continued reporting the database reachable
- a single `/api/patients/search` request returned HTTP 200 in approximately 0.29s
- Prometheus later reported `/api/patients/search` p99 at approximately 0.50s
- the application container remained running
- restart count remained 0
- the container was not OOM-killed

The global `ApiHighP99Latency` alert remained active because `/readyz`
independently showed high p99 latency (~4.98s). This was not attributed to
OPS-2201 because the patient-search route itself had recovered.

See:

- `recovery.txt`
- `route-recovery.txt`

## Result

OPS-2201 was successfully replayed against the rehosted runtime. The incident
produced severe search latency and request failures, Prometheus detected the
latency condition, and the patient-search route recovered after the replay load
ended.
