# ShaadiCount — Build Specification

**Package status:** implementation baseline for an MVP, not a production approval  
**Last updated:** 2026-10-27  
**Product name:** ShaadiCount (working name; trademark review pending)

ShaadiCount helps wedding/event planners collect function-specific RSVPs, send permission-based reminders through approved channels, produce transparent catering headcount estimates, and reconcile RSVPs with actual check-ins. It must not claim to guarantee attendance or eliminate food waste.

## Start here
1. Read `CODING_AGENT_INSTRUCTIONS.md` and `docs/project/implementation-contract.md`.
2. Read `docs/project/decisions-baseline.md` and the architecture ADRs. The MVP is **web-first**; do not build a native mobile app in the initial pilot.
3. Read the PRD, acceptance criteria, screen specifications, API guide/OpenAPI file, database docs, security/privacy docs and testing plan.
4. Implement in phases. Keep `docs/project/open-questions.md` updated; do not silently invent policy decisions.
5. Run the verification commands and tests described in `docs/devops/local-development.md` and report actual results.

## Locked MVP direction
- Organizer experience: responsive web app, mobile-first layout.
- Guest experience: responsive, no-install RSVP web page.
- Backend: NestJS + TypeScript modular monolith; REST API under `/v1`.
- Data: PostgreSQL. Use migrations as the source of truth.
- Background work: begin with a PostgreSQL-backed outbox and a worker abstraction. Add Redis/BullMQ only if the deployment requires it and the worker behavior is tested; avoid introducing infrastructure solely for theoretical scale.
- Messaging: provider adapter with fake/test provider by default. Live WhatsApp/SMS must be feature-flagged and disabled until onboarding, opt-in, templates, opt-outs, pricing and legal requirements are verified.
- Deployment: local Docker Compose for development; production hosting and region remain a release decision.

## Repository map
- `docs/product/`: product requirements, stories and acceptance criteria
- `docs/architecture/`: architecture, diagrams and ADRs
- `docs/database/` and `db/`: schema contract and migration plan/starter
- `docs/api/` and `api/`: API guide, auth/error conventions and OpenAPI starter
- `docs/security/`, `docs/privacy/`: security and data protection requirements
- `docs/messaging/`: provider adapter, templates, policy and scheduler requirements
- `docs/ux/`: information architecture and screen behavior
- `docs/testing/`: test strategy and acceptance matrix
- `docs/devops/`: local setup, environment variables and deployment
- `docs/project/`: build contract, decisions, roadmap, risks, traceability and release checklist

## Status labels
- **Locked MVP decision:** implement unless a documented ADR supersedes it.
- **Assumption:** provisional; validate in pilot.
- **Open decision:** do not invent a final answer; use a safe configurable default or stub and document the blocker.
- **Release blocker:** do not enable production functionality until the requirement is met.

## Important scope boundary
This ZIP is a specification package, not a prebuilt application repository. It does not contain a finished application, verified provider credentials, legal opinion, production secrets, or proof of provider approval. The coding agent is expected to create the application scaffold, source code, migrations, tests and CI in the implementation repository. The SQL migration and OpenAPI file are starting points and must be reconciled with the requirements before being treated as complete.

## Excluded from this lean build package
Detailed competitor analysis, market sizing/pricing research, interview scripts and commercial validation materials were intentionally removed. The product must still be validated with planners and caterers before broad launch; see the MVP scope and release gates for product validation dependencies.
