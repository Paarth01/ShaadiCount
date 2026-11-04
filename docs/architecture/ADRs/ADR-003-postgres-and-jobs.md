# ADR-003: PostgreSQL Source of Truth, Durable Outbox, Redis Queue

> **Superseded for the MVP by [ADR-007](ADR-007-postgres-worker-no-redis-mvp.md):** the implementation uses a PostgreSQL outbox plus a polling worker (no Redis). The Redis/BullMQ option remains the documented scale-out path.


- **Status:** Proposed
- **Decision:** PostgreSQL stores business state and an outbox/scheduled intent; Redis + BullMQ executes jobs. Jobs are at-least-once and idempotent.
- **Alternatives:** PostgreSQL-only polling; managed cloud queue; Kafka; Redis-only schedules.
- **Rationale:** Relational integrity is central to per-function attendance and tenant relationships. Redis queue is operationally familiar for a TypeScript stack, while PostgreSQL prevents queue loss from becoming loss of business intent.
- **Risks:** Redis and PostgreSQL both require operations; queue semantics and provider idempotency differ.
- **Mitigation:** Outbox relay, unique job keys, DB eligibility recheck, dead-letter table, reconciliation and restore tests.
- **Revisit:** Compare managed queue economics and operational burden after traffic/ops evidence.
