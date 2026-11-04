# Decisions Baseline — MVP

These decisions remove avoidable ambiguity for the coding agent. Product/engineering owners may change them later through a documented ADR.

| Area | MVP decision | Status / caveat |
|---|---|---|
| First customer | Planner-first hypothesis | Validate with interviews/pilot; not proven demand |
| Organizer UI | Responsive web app, mobile-first | Locked for pilot; native app deferred |
| Guest UI | Public responsive RSVP web page | No guest app/account required |
| Backend | NestJS + TypeScript modular monolith | Proposed implementation baseline |
| API | REST `/v1`, OpenAPI contract | Contract must be completed before endpoint is called stable |
| Database | PostgreSQL | Migrations are source of truth; no ORM-specific schema drift |
| Jobs | PostgreSQL outbox + worker abstraction first | Add Redis/BullMQ only if chosen and locally testable |
| Messaging | Provider interface + fake provider by default | Live sending disabled by default and release-gated |
| Authentication | Managed/session or secure short-lived token strategy chosen during foundation phase | Must document CSRF/session or JWT rotation/revocation choices; no insecure DIY password storage |
| Guest link | High-entropy opaque token; store only hash | Expiry/revocation, rate limits, no token logging |
| Time | UTC storage + IANA timezone per event | All schedules and deadlines use event timezone semantics |
| Tenant boundary | Workspace-scoped service authorization plus tenant-safe DB relations | Row-level security may be added; do not treat it as a substitute for service checks |
| Import | CSV first, preview/validate before commit | No arbitrary spreadsheet macro execution or formula execution |
| Catering | Explainable rules-based arithmetic | No AI prediction in MVP |
| Check-in | One active check-in per invitation/function; audited void/correction | Re-entry policy remains configurable/open before pilot |
| Billing | Not in MVP | Manual pilot billing, if any, is outside app until approved |
| Hosting/data region | Not selected | Release blocker; record provider, region, backups and contract review before production |

## Conflict resolution
`ADR-002-client-stack.md` has been updated to match the web-first decision. If a legacy line in another document still describes React Native as the initial client, update it to this baseline rather than building two clients.
