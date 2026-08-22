# OPS-2204 Incident Replay

## Incident

The nightly patient export previously crashed the API because the endpoint
loaded and serialized the entire patient dataset in memory.

## Verified Fix

The rehosted runtime uses the Assignment 1 streaming implementation:

- keyset pagination
- 1,000-row batches
- incremental JSON response streaming

The runtime was also configured with the same 160 MiB Docker memory limit used
for the original investigation.

## Replay Workload

The original OPS-2204 workload was replayed unchanged:

- 50 concurrent VUs
- 2-minute duration
- `GET /api/patients/export`
- 120-second request timeout

## Replay Result

Observed:

- 50 requests
- 50 timed out
- 100% k6 request failure rate
- p95 approximately 120 seconds
- about 142 MB received before client timeout

The failure mode was request timeout rather than process crash.

## Memory Behaviour

Container memory was monitored continuously during replay.

Observed memory rose from approximately 32 MiB and stabilized around
80–84 MiB while the container had a 160 MiB memory limit.

CPU increased significantly during export processing and exceeded 100% during
parts of the replay.

Unlike the original broken implementation, memory remained bounded below the
container limit.

See `memory-during-replay.txt`.

## Container Stability

After replay, container state was checked for:

- runtime status
- restart count
- OOMKilled state

See `container-after-replay.txt`.

## Observability

Prometheus collected API process memory through:

`process_resident_memory_bytes{job="capacity-api"}`

The memory alert was corrected during C7 to scope the metric specifically to
the `capacity-api` job. Without this selector, Prometheus's own process memory
could incorrectly trigger `ApiMemoryPressure`.

See:

- `alerts-after-replay.txt`
- `memory-prometheus.txt`

## Result

OPS-2204 was successfully replayed against the rehosted runtime.

The streaming fix prevented the original OOM/restart-loop failure. Under 50
concurrent full exports, the remaining bottleneck is throughput and request
latency: clients reached the 120-second timeout, but application memory remained
bounded and the runtime did not require increasing memory to complete the test.

This confirms that the incident changed from a memory-safety failure to a
capacity/latency failure.
