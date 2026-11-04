# ADR-001: Modular Monolith First

- **Status:** Proposed
- **Date:** 2026-10-27
- **Decision owner:** Technical lead
- **Context:** Early-stage product, uncertain demand, one small team, several tightly related workflows.
- **Decision:** Use NestJS modular monolith with explicit modules and a separate worker process from the same codebase.
- **Alternatives:** Microservices; serverless functions for every workflow; monolith with no module boundaries.
- **Why:** Lower operational burden, simpler transactions for RSVP + outbox, faster development and easier local testing.
- **Consequences:** Deployment scaling is initially coarse-grained; module boundaries must be maintained. Worker process can scale separately.
- **Revisit when:** a module requires independent scaling/release, has sustained resource contention, or team ownership makes deployment coupling measurably costly.
- **Validation:** Load test and inspect p95 latency, DB saturation, queue lag, deploy frequency and incident data before extraction.
