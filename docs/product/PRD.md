# Product Requirements Document

## 1. Vision
Help Indian wedding and event organizers make better catering and staffing decisions by collecting function-specific guest responses, automating appropriate follow-ups, and recording actual attendance.

## 2. Problem
Guest lists are often maintained in spreadsheets and chat threads. Hosts cannot easily distinguish confirmed, declined, tentative and unanswered invitations; families may change party counts; and function-specific attendance differs. Manual follow-up is time-consuming and catering estimates are uncertain.

## 3. Target users and jobs
- **Family host:** know who is likely to attend each function and reduce manual follow-up.
- **Wedding planner:** manage multiple clients/events with controlled collaborator access.
- **Caterer:** receive a time-stamped, restricted headcount report, not unrelated guest contact data.
- **Check-in staff:** find an invitee and record attendance quickly.
- **SaaS operator:** maintain tenant isolation, provider health, abuse controls and billing.

## 4. Product outcomes
Primary outcome: higher-quality attendance information before catering decisions. Do not promise zero waste or perfect predictions.

Proposed measurable KPIs:
- RSVP response rate = invitations with a valid response / invitations successfully issued; report both household and invitee-person denominators where relevant.
- On-time confirmation rate = invitations with Yes/No before deadline / invitations issued.
- Reminder response rate = responses within a defined attribution window after reminder / reminders delivered; label attribution as observational, not causal.
- Cost per collected RSVP = attributable channel spend / valid responses collected.
- Attendance error = absolute(actual checked-in people - final confirmed people) / max(actual checked-in people, 1); report per function and overall.
- Host time saved: self-reported baseline versus post-event survey.
- Estimated catering difference: planned meals and cost versus actual check-ins and actual organizer-entered cost; estimates are not verified savings.
- SaaS metrics: activation, paid conversion, gross revenue retention, churn, support tickets per event.

Set numeric targets only after a pilot baseline is measured.

## 5. MVP scope
- Account registration/login, workspace and role management.
- Events containing multiple functions, each with venue, local time, RSVP deadline and status.
- Guest groups, contacts, language, CSV import preview/error report and duplicate review.
- Per-function invitation with party-size cap and secure RSVP link.
- Yes/No/Maybe, adult/child counts, response edit before deadline, audit history.
- One approved outbound channel integration plus provider abstraction; SMS and email can be added after compliance/provider validation.
- Scheduled reminders with eligibility re-check, opt-out/suppression and delivery status.
- Dashboard, CSV/PDF report, configurable catering scenarios.
- Online QR/manual check-in.
- Basic plan/usage records; production billing can follow MVP if pilot is manually billed.

## 6. Exclusions from MVP
No individual no-show prediction, public guest directory, marketing campaigns, mandatory guest accounts, sensitive medical profiling, full offline check-in sync, native caterer integrations, or microservices/Kubernetes.

## 7. Functional requirements
- FR-001: users can create/join workspaces.
- FR-002: workspace roles restrict event and guest access.
- FR-003: an event can contain multiple functions.
- FR-004: invitations are scoped to one function and a permitted party size.
- FR-005: guests can respond without a platform account using a high-entropy revocable token.
- FR-006: valid response changes are transactionally recorded and audited.
- FR-007: message jobs re-check eligibility immediately before dispatch.
- FR-008: provider callbacks are authenticated, deduplicated and stored.
- FR-009: dashboards distinguish confirmed, declined, maybe and pending counts.
- FR-010: catering scenarios use explicit inputs and rounding rules.
- FR-011: check-in is permissioned and duplicate-resistant.
- FR-012: data export/deletion and retention are documented and operationally supported.

## 8. Non-functional requirements
- Security: tenant isolation, least privilege, encrypted transport/storage, secure secrets, audited privileged actions.
- Reliability: idempotent writes and jobs; recoverable queue/outbox.
- Performance: propose p95 API latency under 500 ms for ordinary non-reporting requests at the agreed pilot load; validate with load tests, not a guarantee.
- Availability: initial proposed monthly API availability SLO 99.5%, excluding explicitly defined maintenance/dependencies; review after pilot.
- Localization: English and Hindi initially; architecture supports additional languages.
- Accessibility: target WCAG 2.2 AA for guest web where practical; test with assistive technology.
- Maintainability: modular monolith, typed contracts, migration discipline, automated CI.

## 9. Key user stories
- US-001 As host, I create a wedding and multiple functions so attendance can differ by function.
- US-002 As host, I import a spreadsheet and review invalid/duplicate rows before commit.
- US-003 As guest, I respond from a mobile link without installing an app.
- US-004 As guest, I cannot exceed the party size invited by the host.
- US-005 As host, I see separate confirmed, declined, tentative and pending counts.
- US-006 As planner, I schedule reminders and see accepted/delivered/failed status distinctly.
- US-007 As caterer, I receive only the report fields authorized by the host.
- US-008 As staff, I check in an invitee once and see if a duplicate scan occurred.
- US-009 As tenant owner, I export or request deletion of workspace data under defined policy.
- US-010 As platform operator, I replay a failed job safely without duplicate messages.

## 10. Acceptance criteria summary
- RSVP cannot change another function's response.
- A response count update and response history write commit atomically.
- A response is rejected after deadline unless event policy allows late changes.
- `Maybe` is counted separately and never silently added to confirmed headcount.
- A reminder is skipped if response, opt-out, event cancellation or deadline makes it ineligible.
- Duplicate provider webhook IDs do not duplicate state transitions.
- Every organizer override includes actor, timestamp and reason.
- Every cross-tenant access attempt is denied and security-logged without exposing data.

## 11. MVP analytics events
Track event names such as `workspace_created`, `event_created`, `guest_import_completed`, `invitation_link_opened`, `rsvp_submitted`, `campaign_scheduled`, `message_status_changed`, `report_exported`, `checkin_recorded`, `subscription_status_changed`. Analytics properties use tenant/event pseudonymous IDs and aggregate counts; exclude names, phone numbers, RSVP tokens and free-text requests.

## 12. Assumptions and open questions
See `docs/project/open-questions.md`. Initial assumption: hosts are responsible for having authority to share guest contact details and invite them through the selected channel. This must be confirmed in onboarding and reviewed by counsel.

## 13. Competitive and evidence constraints (added 2026-10-27)
- Basic invitation pages, guest import, RSVP forms, reminders, household groups, multi-function RSVP and exports are established competitor features. Product requirements must not describe these as unique by themselves. See `docs/business/competitive-gap-analysis.md`.
- Product differentiation to test: planner-first multi-event operations, explicit RSVP-to-check-in reconciliation, and transparent catering scenarios with assumptions and a vendor-ready restricted report.
- Add a pilot requirement: collect a baseline workflow before rollout and post-event actuals afterward. If actual attendance or meal data is unavailable, label the evaluation incomplete rather than estimating benefits.
- No AI no-show prediction or quantified food-waste-reduction claim in MVP. These require separate data, evaluation design and evidence.
- Add a pre-send review showing recipients, function, template/language, authorization eligibility, estimated message cost and spend cap. Require an explicit send confirmation.
- Guest contact import must not automatically authorize messaging. Store channel eligibility/suppression and honor opt-outs before every dispatch.
- The responsive guest RSVP web flow is the no-install priority. Validate the need for a native organizer app during pilots before committing to native mobile as a launch dependency.
