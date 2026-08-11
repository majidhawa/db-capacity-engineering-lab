# 🧾 On-Call Lab Journal — Regional Health

**Engineer:** Hawa Majid  **Date:** 11 August 2026

This is your investigation notebook. You are on call for the Regional Health
platform and working the [incident queue](./incidents/README.md). For each
incident you will:

1. **Hypothesis** — from the ticket symptoms alone, predict the cause *before*
   you run anything.
2. **Observation** — record real evidence: k6 output, Grafana/Prometheus
   metrics, `EXPLAIN ANALYZE` plans, lock views, `docker stats`, container logs.
3. **Root cause & mechanism** — explain *why* it happens. Name the database/OS
   mechanic yourself and show the capacity math.
4. **Fix & verify** — make the change, re-run the reproduction, and record the
   before/after.

> There is no answer key. A claim without evidence isn't a diagnosis. "It felt
> slow" is not an observation; `p(95)=1840ms, http_req_failed=32%` is.

---

## How to capture evidence

- **k6:** copy the summary block (`http_req_duration`, `http_req_failed`,
  `iterations`, `vus`).
- **MySQL:** `docker compose exec mysql-db mysql -uroot -plabpassword capacity_lab`
  then run `EXPLAIN ANALYZE ...`, `SHOW CREATE TABLE ...`,
  `SHOW ENGINE INNODB STATUS\G`, or query `performance_schema` / `sys`.
- **Metrics:** Grafana panels or raw Prometheus at http://localhost:9090.
- **Memory / restarts:** `docker stats`, `docker compose logs -f capacity-api`.

Useful Prometheus queries:
```promql
# Throughput (req/s) by route
sum(rate(http_requests_total[1m])) by (route)

# p95 latency by route
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[1m])) by (le, route))

# Application heap in use
nodejs_heap_size_used_bytes

# DB errors by code
sum(rate(db_errors_total[1m])) by (code)
```

---

## Baseline — steady state (do this first)
*Run:* `k6 run load-tests/00-baseline.js` (healthy system, no incident)

Capture the control group you'll compare every incident against.

| Metric              | Value       |
|---------------------|-------------|
| Requests/sec (RPS)  | 49.31 req/s |
| p50 latency         | 4.21 ms     |
| p95 latency         | 21.98 ms    |
| p99 latency         | 147.39 ms   |
| Error rate          | 0.00%       |
| Peak API heap used  | ~23.29 MiB  |

> SLOs you'll hold the incidents to (target p95, max error rate, RPS floor):
> Target p95: <300 ms for OPS-2201; max error rate and RPS floor are not explicitly defined in the provided load test.

---

## Investigation — OPS-2201
*Ticket:* [Patient name search unusably slow at shift change](./incidents/OPS-2201.md)
*Reproduce:* `k6 run load-tests/reproduce-OPS-2201.js`

### Hypothesis
> From the symptoms alone (fast when isolated, collapses under concurrent
> searches, other endpoints unaffected), I suspect the patient search query is
> performing an inefficient scan, possibly because the last_name column is not
> indexed. With approximately 100,000 patient rows, MySQL may need to examine a
> large portion of the table for each search request, and concurrent searches
> could multiply that work and increase latency. I will use EXPLAIN ANALYZE to
> confirm whether the query performs a full table scan and to measure how many
> rows are examined.

### Observation (evidence)
> Investigate how the database executes the search. Paste what you find:
> ```
> 200 VUs for 30s
> 308 completed requests
> 37 interrupted iterations
> p95 = 54.01s
> p99 = 58.88s
> RPS = 5.13
> HTTP failure rate = 0.00%
> Data received = 1.1 GB
>
> EXPLAIN ANALYZE:
> Table scan on patients
> actual rows = 100000
> Filter last_name='Smith'
> actual rows returned = 10000
> ```
| Metric (under load) | Value      | vs. baseline                                              |
|---------------------|------------|-----------------------------------------------------------|
| p95 latency         | 54.01 s    | 21.98 ms → 54.01 s                                        |
| RPS                 | 5.13 req/s | 49.31 → 5.13 req/s                                        |
| Error rate          | 0.00%      | 0.00% → 0.00%                                             |
| Rows examined / req | 100,000    | ~100,000 rows vs baseline endpoint's much smaller indexed access |

### Root cause & mechanism
> My initial hypothesis was partly correct. `EXPLAIN ANALYZE` confirmed that
> MySQL performed a full table scan because `last_name` had no index, examining
> approximately 100,000 rows per request and returning about 10,000 matching
> `Smith` rows.
>
> Adding a B-tree index changed the plan from a table scan to an index lookup,
> but the load test still showed p95 ≈ 54.74 s. This disproved the assumption
> that the missing index alone explained the production symptom.
>
> Further investigation showed that the endpoint used `SELECT *` with no
> result limit and returned all ~10,000 matching patients. A single response
> measured 3,636,195 bytes (~3.47 MiB). With many concurrent searches, the API
> therefore had to fetch, JSON-serialize, and transmit very large responses.
>
> The initial scan cost was ~100,000 rows per request. With the B-tree index,
> locating the matching range is roughly log₂(100,000) ≈ 17 comparisons, then
> the matching entries must still be processed. Because ~10,000 rows match
> `Smith`, the index alone cannot eliminate the cost of returning those rows.
> Bounding the response to 50 rows reduced the amount of data processed and
> transferred dramatically.

### Fix & verify
> The changes made were:
> 1. Added `INDEX idx_patients_last_name (last_name)` to the patients schema.
> 2. Changed the search query to `SELECT * FROM patients WHERE last_name = ? LIMIT 50`.
>
> After the fix, `EXPLAIN ANALYZE` showed:
> - `Index lookup on patients using idx_patients_last_name`
> - `Limit: 50 row(s)`
> - 50 rows returned
> - query execution completed in approximately 0.495 ms
>
> Response size dropped from 3,636,195 bytes (~3.47 MiB) to 17,392 bytes
> (~17 KiB), approximately 209× smaller.
>
> Final load-test result:
> - p95: 54.01 s → 868.74 ms
> - RPS: 5.13 → 323.23 req/s
> - Error rate: 0.00% → 0.10%
> - Throughput improvement: approximately 63×
> - p95 latency improvement: approximately 62×
>
> The fix dramatically improved capacity but still did not meet the team's
> p95 < 300 ms SLO. The remaining latency is not explained by SQL execution:
> the fixed query itself runs in ~0.5 ms. During load, MySQL maintained only
> about three connected threads (two application-pool connections plus the
> monitoring connection), indicating another application-side capacity
> constraint remains. I did not change that shared pool configuration here
> because it requires separate investigation.
>
> Fix commit: `69545bc` (`fix OPS-2201 patient search capacity`)
>
> Trade-off: limiting results to 50 prevents the API from returning every
> matching patient in one response. A production API should expose pagination
> or another bounded result mechanism so users can retrieve additional matches
> without creating an unbounded response.

---

## Investigation — OPS-2202
*Ticket:* [Whole app freezes during surges, DB looks idle](./incidents/OPS-2202.md)
*Reproduce:* `k6 run load-tests/reproduce-OPS-2202.js`

### Hypothesis
> I suspect requests are queueing for database connections in the application's
> MySQL connection pool. The pool is limited to 2 connections, so during a
> sudden concurrency spike many requests may wait in the application tier even
> though the database itself remains mostly idle. I will reproduce the surge
> and compare request latency/throughput with MySQL connection activity and the
> pool configuration to confirm whether connection-pool queueing is the
> bottleneck.

### Observation (evidence)
> Where is time spent between request arrival and query execution? Capture the
> error codes and any queue/timeout evidence from logs and metrics:
> ```
> Surge test: 2,000 VUs
> p95 = 15.00 s
> p99 = 18.53 s
> RPS = 270.01
> Error rate = 1.30% (123 / 9452)
> Failure signature: connection reset by peer
>
> During the surge:
> MySQL Threads_connected ≈ 3
> MySQL Threads_running ≈ 2–3
> Application MySQL pool connectionLimit = 2
> MySQL server max_connections = 151
>
> EXPLAIN ANALYZE for the affected lightweight query:
> Index scan on PRIMARY (reverse), LIMIT 50
> actual time ≈ 0.148 ms
> ```
| Metric                    | Value      | vs. baseline |
|---------------------------|------------|--------------|
| Successful RPS (plateau)  | 270.01     |              |
| p95 / p99 latency         | 15.00 s / 18.53 s |       |
| Error / timeout rate      | 1.30%      |              |
| Avg service time per query (s) | 0.0074 s |           |

### Root cause & mechanism
> Explain the paradox: idle database, trivial query, stalled app. What finite
> resource is being contended, and where does it live? Derive the *right* size
> for that resource from your measured throughput and service time (state the
> relationship you used):
> - Measured avg service time W = 0.0074 s
> - Target throughput λ = 270.01 req/s
> - Required capacity = 2 connections  (show your working)
>
> Using Little's Law, L = λ × W.
> With L = 2 pooled connections and measured λ ≈ 270.01 req/s:
> W ≈ 2 / 270.01 ≈ 0.0074 s = 7.4 ms.
>
> This matches the observed throughput plateau: two connections occupied for
> about 7.4 ms each can sustain roughly 270 req/s. The multi-second HTTP latency
> is therefore dominated by waiting for a pool connection rather than SQL execution.
>
> Why does making it arbitrarily large eventually stop helping? Making the
> pool arbitrarily large eventually stops helping because the bottleneck moves
> elsewhere. With `connectionLimit: 10`, throughput increased only modestly
> while the API CPU rose to ~125–137% and the error rate worsened to 14.37%.
> More DB connections simply allowed more concurrent work into the application
> until the API itself became the limiting resource.

### Fix & verify
> I tested increasing the MySQL application pool from 2 connections to 10, but
> this made reliability worse: p95 remained ~16.59 s and the error rate rose to
> 14.37%, while API CPU reached ~125–137%.
>
> I then reduced the pool to 4 connections. This produced the best balance:
> RPS increased from 270.01 to 393.53 req/s, while the error rate stayed below
> the lab threshold at 2.35%. p95 remained ~15.00 s, showing that pool sizing
> improved throughput but did not eliminate burst queueing.
>
> New RPS: 393.53 req/s
> New error rate: 2.35%
> New p95: 15.00 s
>
> An upstream protection such as a bounded request queue, concurrency limiter,
> rate limiter, or load-shedding mechanism would prevent an unlimited burst
> from accumulating inside the application. Instead of allowing thousands of
> requests to wait indefinitely, excess traffic should be rejected or delayed
> in a controlled way so the service degrades gracefully.
>
> Trade-off: a smaller bounded pool protects the database and application from
> overload, but callers may need to wait or receive a controlled rejection
> during extreme bursts.

---

## Investigation — OPS-2203
*Ticket:* [Bed admissions fail with DB errors under load](./incidents/OPS-2203.md)
*Reproduce:* `k6 run load-tests/reproduce-OPS-2203.js`

### Hypothesis
> Given that one-at-a-time admissions succeed, concurrent admissions to the
> same hospital fail, and different hospitals interfere less with each other,
> I suspect multiple transactions are contending for a row lock on the same
> hospitals record. I expect the failure to appear as lock waits, timeouts, or
> sharply reduced throughput. I will reproduce the load and inspect
> `performance_schema.data_locks`, `sys.innodb_lock_waits`, and
> `SHOW ENGINE INNODB STATUS` while the incident is active.

### Observation (evidence)
> While the reproduction runs, inspect concurrent writers to one row:
> ```sql
> SELECT * FROM performance_schema.data_locks\G
> SELECT * FROM sys.innodb_lock_waits\G
> SHOW ENGINE INNODB STATUS\G   -- TRANSACTIONS section
> ```
> Paste the most telling waiter/blocker rows and the failure signature you saw
> (a DB error + code, a timeout, or stalled/near-zero throughput):
> ```
> 500 concurrent VUs targeting hospital id=1
> First run:
> p95 = 56.91 s
> p99 = 59.27 s
> RPS = 1.95 req/s
> Error rate = 0.00%
> 117 completed, 441 interrupted
>
> Second run:
> p95 = 51.09 s
> p99 = 57.99 s
> RPS = 5.67 req/s
> Error rate = 65.58%
> 117 succeeded / 223 failed
>
> Lock evidence from `sys.innodb_lock_waits` showed multiple waiting
> transactions blocked on `capacity_lab.hospitals`, PRIMARY index,
> with one transaction blocking others on the same hot row.
> ```
| Metric                     | Value                    | vs. baseline |
|----------------------------|--------------------------|--------------|
| p95 / p99 latency          | 56.91 s / 59.27 s        |              |
| Max successful admits/sec  | ~1.95 req/s              |              |
| DB error(s) + code         | No MySQL error code captured; lock waits observed in `sys.innodb_lock_waits` |              |
| Error rate                 | 0.00% → 65.58% (run 2)  |              |

### Root cause & mechanism
> The transaction updates one hospital row and then waits ~500 ms for the
> simulated external registry call before committing. Because the row lock is
> held for roughly W = 0.5 s, maximum serialized throughput on that one hot row
> is approximately:
>
> 1 / W = 1 / 0.5 = 2 admits/sec
>
> This matches the measured first-run throughput of ~1.95 req/s.
>
> Which of the transactional guarantees is enforcing the wait? InnoDB's
> row-level locking ensures only one writer can hold the exclusive lock on the
> hospitals row at a time. All other concurrent transactions must wait until
> the lock is released at COMMIT, serializing all admits to the same hospital.

### Fix & verify
> The change you made: Moved the external `notifyBedRegistry()` call outside
> the database transaction. The hospital row is now updated and committed
> immediately, releasing the InnoDB row lock before the simulated ~500 ms
> external network call. The MySQL connection is also released before waiting
> for the registry response.
>
> Re-run evidence:
> - 500 VUs for 30 s
> - 3,670 completed iterations
> - 0 interrupted iterations
> - RPS = 109.12 req/s
> - p95 = 6.03 s
> - p99 = 6.84 s
> - Error rate = 0.62% (23 / 3,670)
>
> Before the fix, the first reproduction achieved only 1.95 req/s with
> p95 = 56.91 s and 441 interrupted iterations. The ~500 ms external call was
> inside the transaction, so the hot hospital row could sustain only roughly
> 1 / 0.5 = 2 updates/s. The observed 1.95 req/s closely matched that
> theoretical serialization ceiling.
>
> After moving the external call outside the transaction, throughput increased
> from 1.95 to 109.12 req/s, approximately 56×, while p95 fell from 56.91 s
> to 6.03 s, approximately 9.4×. No iterations were interrupted.
>
> The error-rate threshold (<5%) now passes at 0.62%. The p95 <1000 ms
> threshold still fails, so another request-path capacity constraint remains
> under 500 concurrent VUs. However, the original hot-row serialization
> mechanism is no longer the ~2 req/s throughput ceiling.
>
> Trade-off: committing before notifying the external registry shortens the
> database critical section dramatically, but the database update and external
> notification are no longer atomic. If the registry call fails after commit,
> the database has already changed. A production implementation could use an
> outbox/event-driven pattern with retries to preserve reliable notification
> without holding a database lock during network I/O.

---

## Investigation — OPS-2204
*Ticket:* [Nightly export crashes the service repeatedly](./incidents/OPS-2204.md)
*Reproduce:* `k6 run load-tests/reproduce-OPS-2204.js`

### Hypothesis
> Given memory spikes right before each restart and only the big export is
> affected, I think the cause is ___________________________________________
> because __________________________________________________________________.

### Observation (evidence)
> Watch `nodejs_heap_size_used_bytes`, GC pauses, and restarts:
> ```bash
> docker stats
> docker compose logs -f capacity-api
> ```
| Metric                          | Value |
|---------------------------------|-------|
| Approx. payload size per request|       |
| Peak heap before crash          |       |
| Time-to-first-crash             |       |
| Container restart count         |       |
| GC pause trend                  |       |

> Paste the crash / exit log lines:
> ```
>
> ```

### Root cause & mechanism
> Estimate per-row size, then the full payload: rows × bytes/row = ______ MB.
> With C concurrent callers, peak resident memory ≈ ______ MB — compare to the
> container's memory budget (160MB locally / 256MB in prod). Explain what happens
> to GC frequency, CPU, and
> throughput as live heap approaches the limit, and why the current approach
> uses O(N) memory while a better one could use far less. ____________________

### Fix & verify
> The change you made (consider: bounding how much of the result set is in
> memory at once, streaming to the response, sensible page sizes, compression):
> ____________________________________________________________________________
> Re-run evidence — new peak heap: ______  restarts: ______  error rate: ______

---

## Post-incident review (synthesis)

> Rank the four incidents by **blast radius** (threat to overall availability at
> scale), justified with your measured numbers:
> 1. ____________________________________________________________________
> 2. ____________________________________________________________________
> 3. ____________________________________________________________________
> 4. ____________________________________________________________________
>
> If you could ship only **one** fix before a launch, which and why?
> ____________________________________________________________________________
>
> For each incident, what alert or dashboard would have caught it in production
> *before* a user filed a ticket? ____________________________________________
