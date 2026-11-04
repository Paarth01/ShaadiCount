# System Overview

## Decision
Start with a modular monolith, not microservices. One NestJS deployment contains bounded modules with explicit interfaces. Use a responsive web client for organizers and a responsive guest RSVP web app. Run asynchronous workers as separate processes from the same codebase only when needed.

## Components
- Next.js organizer web app: authenticated planner workflows, mobile-first responsive layout.
- Next.js guest web app: token-scoped RSVP, localized and lightweight; no account/app required.
- API: versioned REST `/v1`, validation, authorization and rate limiting.
- Identity/workspace module: authentication, membership and roles.
- Event/guest modules: workspace-scoped data and per-function eligibility.
- RSVP module: token validation, concurrency control and response history.
- Campaign module: scheduling and audience eligibility; live dispatch disabled by default.
- Outbox/worker: reliable handoff from committed database changes to background processing.
- Provider adapters: fake provider by default; official WhatsApp Business Platform or authorized provider, SMS and optional email only after release gates.
- Webhook endpoint: authenticity validation, replay protection and deduplication.
- Reporting module: aggregates, exports and transparent catering calculations.
- Check-in module: function-scoped attendance records and audited corrections.
- PostgreSQL: source of truth, including outbox and scheduled work.
- Optional Redis/BullMQ: add only if selected implementation requires it; not the source of business truth.
- Private object storage: imports/exports with short-lived download URLs when enabled.
- Observability: redacted logs, metrics, alerts and error reporting.

## Explicitly deferred
Native mobile apps, in-product billing/payment gateway, AI attendance prediction, vendor marketplace, accommodation/transport and microservices are not MVP requirements.

## Trust boundaries
1. Public internet to guest RSVP: untrusted, rate-limited, token-scoped.
2. Organizer client to API: authenticated, authorization checked server-side.
3. Provider to webhook: verify signature/token and deduplicate.
4. Worker to provider: outbound credentials kept in secret manager.
5. Tenant data: workspace scope enforced in service layer and tenant-safe database relations; row-level security may be defense in depth.
6. Operations: restricted staff access and audited break-glass support.

## Failure and recovery
- PostgreSQL transaction commits RSVP and outbox event together.
- Outbox relay retries until processed; duplicate jobs are safe.
- Provider timeout can produce `unknown` delivery state; reconcile from callbacks/provider status where supported.
- If an optional queue is lost, recover pending work from PostgreSQL outbox/schedule records.
- Export files expire and are deleted by lifecycle policy.

## API boundaries
REST controllers validate DTOs and call application services. Modules call each other through service interfaces; no module reaches into another module's tables without an agreed contract. Reporting queries may use read-only SQL projections for aggregate performance.
