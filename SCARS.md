# Scar Log — Regional Health

## OPS-2201 — Patient search collapses 
under concurrent load

- **S — Symptom:** At 200 concurrent 
VUs, patient last-name search reached 
p95=54.01s and only 5.13 req/s, while 
the baseline p95 was 21.98ms.

- **C — Cause:** The initial query 
performed a full table scan of 
~100,000 patient rows because 
`last_name` was not indexed. However, 
adding the index alone did not resolve 
the incident. The endpoint also 
returned ~10,000 matching `Smith` 
records using an unbounded `SELECT *`, 
producing a ~3.47 MiB response per 
request.

- **A — Action:** Added `INDEX 
idx_patients_last_name (last_name)` 
and bounded the search query with 
`LIMIT 50`.

- **R — Result:** Response size fell 
from 3,636,195 bytes to 17,392 bytes 
(~209× smaller). Throughput increased 
from 5.13 to 323.23 req/s (~63×), and 
p95 improved from 54.01s to 868.74ms 
(~62×). The p95 <300ms SLO was still 
not met, showing another capacity 
constraint remains.

- **Scar / lesson:** A better query 
plan does not guarantee a healthy 
endpoint. After the index changed the 
full scan to an index lookup, the load 
test remained slow because the 
application still returned an enormous 
result set. Monitor query plans, 
response sizes, p95 latency, 
throughput, and application-side 
queueing together.

- **Evidence:** `LAB_JOURNAL.md` — 
Investigation OPS-2201; fix commit 
`69545bc`.

## OPS-2202 — API freezes during registration surges

- **S — Symptom:** During a 2,000-VU registration surge, even the lightweight
  recent-patients endpoint reached p95=15.00s while MySQL remained mostly idle.

- **C — Cause:** The application MySQL connection pool was limited to 2
  connections with an unbounded queue. Requests accumulated in the application
  waiting for a connection even though MySQL allowed 151 connections and the
  query itself executed in approximately 0.148ms.

- **A — Action:** Increased the application MySQL pool from 2 to 4 connections.
  A test with 10 connections was rejected because it increased API CPU and
  produced a 14.37% failure rate.

- **R — Result:** Throughput increased from 270.01 to 393.53 req/s while the
  error rate remained below the 5% threshold at 2.35%. p95 remained 15.00s,
  showing that pool sizing improved throughput but burst queueing still exists.

- **Scar / lesson:** An idle database does not mean the database path is
  healthy. Requests can be waiting in the application's connection pool before
  SQL ever reaches the database. Increasing pool size indefinitely only moves
  the bottleneck elsewhere; bounded queues, concurrency limits, rate limiting,
  or load shedding are needed for graceful overload behaviour.

- **Evidence:** `LAB_JOURNAL.md` — Investigation OPS-2202; fix commit
  `4c12fe4`.

## OPS-2203 — Bed admissions serialize on a hot row

- **S — Symptom:** At 500 concurrent VUs admitting to the same hospital,
  p95 reached 56.91s, throughput collapsed to 1.95 req/s, and 441 iterations
  were interrupted.

- **C — Cause:** Each admission updated the same `hospitals` row and then
  waited ~500ms for `notifyBedRegistry()` before committing. InnoDB therefore
  held the PRIMARY-key row lock across external network I/O. Lock-wait evidence
  from `sys.innodb_lock_waits` showed transactions blocking one another on
  `capacity_lab.hospitals` PRIMARY. With a ~0.5s lock-holding critical section,
  maximum throughput was approximately 1 / 0.5 = 2 admits/sec, matching the
  measured ~1.95 req/s.

- **A — Action:** Committed the hospital update and released the MySQL
  connection before calling `notifyBedRegistry()`, removing the external
  network wait from the database transaction.

- **R — Result:** Throughput increased from 1.95 to 109.12 req/s (~56×).
  p95 improved from 56.91s to 6.03s (~9.4×). The fixed run completed 3,670
  iterations with zero interrupted iterations and a 0.62% failure rate.
  The <5% error-rate threshold passed, although the p95 <1s threshold remains
  unmet.

- **Scar / lesson:** Keep database transactions and lock-holding critical
  sections short. Never hold a hot-row lock across slow external network I/O
  unless atomicity genuinely requires it. Moving the external call after
  commit improves concurrency but introduces consistency risk if notification
  fails, so production systems should consider an outbox/event-driven design.

- **Evidence:** `LAB_JOURNAL.md` — Investigation OPS-2203; fix commit
  `2268046`.
