# Scalability and Reliability

## Initial workload model
Do not claim capacity until measured. Pilot test profile to validate: 10,000 invitations in an event, 1,000 RSVP submissions over 10 minutes, and a campaign scheduled across a controlled window. These are test assumptions, not capacity guarantees; adjust after customer discovery.

## SLO proposals
- API availability: 99.5% monthly initial target.
- Ordinary authenticated API p95 latency: <500 ms at agreed load.
- RSVP durability: every acknowledged successful RSVP survives process restart and database failover within configured database guarantees.
- Reminder processing: 95% of eligible jobs begin within 2 minutes of scheduled time during normal operation; provider delivery is separate.
- Initial recovery objectives: propose RPO 15 minutes and RTO 4 hours, subject to hosting capability and business approval.

## Scale path
- Index tenant/event/function/status and scheduled-time access paths.
- Use connection pooling and bounded worker concurrency.
- Cache only derived/read-heavy data with explicit invalidation; PostgreSQL remains source of truth.
- Queue backpressure and per-tenant quotas protect noisy-neighbor fairness.
- Move large reports to async export jobs.
- Add read replicas only after query/CPU evidence and acceptable replication lag semantics.
- Partition high-volume append tables only after measured maintenance/query pressure.
- Extract a service only when independent scaling/release or team ownership has measurable benefit.
- Load test RSVP bursts, simultaneous campaigns, webhook spikes, exports and provider throttling.
