# Implementation Contract

This document is the source of truth for MVP implementation boundaries. If other documents conflict, follow this contract and record a proposed correction in an ADR.

## Primary user and job
Initial user hypothesis: a wedding/event planner coordinating several functions for one event. The core job is to know, per function, who is invited, who has responded, the current expected headcount, and how actual attendance compares with responses. Families/hosts are a secondary pilot segment.

## MVP capabilities
1. Workspace and members with role-based access.
2. Create/edit/archive event and its functions; each function has venue, start time, IANA timezone, RSVP deadline and optional capacity.
3. Guest records and household/group association; CSV import with preview, validation, duplicate detection and explicit commit.
4. Function-specific invitations; a guest may be invited to some functions but not others.
5. Secure guest RSVP link without requiring account creation; yes/no/maybe and counts, within allowed invitation party size; show only the minimum necessary event details.
6. RSVP edit history and organizer corrections with actor/reason.
7. Per-function dashboard: invited, responded, yes, maybe, no, non-responders, confirmed adults/children and last updated time.
8. Message campaign draft, preview, eligible recipient count, schedule/pause/cancel, delivery status and test provider. Live channel provider behind feature flags.
9. Check-in by invitation lookup or QR/token; duplicate prevention and audited correction.
10. Transparent catering estimate: confirmed counts + configurable treatment of maybe/non-responders + buffer; record assumptions and allow export.
11. CSV exports with role restrictions, expiry and audit events.
12. Workspace-level deletion/export request workflow, opt-out/suppression management and audit records.

## Explicitly out of MVP
- Native Android/iOS app.
- AI attendance prediction or claims of preventing food waste.
- Payments/subscriptions and automated invoicing.
- Vendor marketplace, accommodation, transport or seating chart.
- Public searchable events or social features.
- Unofficial WhatsApp automation, scraping or personal-account automation.
- Complex enterprise SSO, multi-region active-active deployment and microservices.

## Default business rules (implement as configuration where practical)
- Each invitation is scoped to one guest/contact and one event function; household/group is an organizational relationship, not the authorization boundary.
- `yes`, `no`, `maybe`, and no response are distinct states. A no-response is not the same as a decline.
- For `yes`, adult + child count must be at least one and cannot exceed the invitation's permitted party size unless an explicit authorized organizer override is recorded.
- For `no`, counts are zero. For `maybe`, counts may be zero or a provisional estimate, but the dashboard must not treat them as confirmed.
- Once an RSVP deadline passes, public edits are rejected by default; organizer override is permitted with an audit reason. Product owner can change this before pilot.
- A message send is eligible only when the channel is enabled, the recipient is eligible under applicable rules, the contact is valid, no opt-out/suppression exists, required permission evidence is present, and template/provider configuration is valid.
- A delivery receipt is not proof that a guest read, understood, or will act on a message.
- Catering estimates are calculations, not predictions. Show inputs, assumptions, last calculation time and separate confirmed/tentative/unanswered counts.
- Check-in records represent observed attendance, not proof of meal consumption.

## Roles and minimum permissions
- `owner`: workspace configuration, member management, all event operations, exports and deletion requests.
- `organizer`: event/function/guest/RSVP/campaign/check-in operations; cannot change ownership or bypass security policy.
- `planner`: assigned event operations; workspace membership scope still applies.
- `checkin_staff`: read minimal guest lookup and create/correct check-ins for assigned functions only.
- `readonly`: read permitted event dashboards only; no contact export or message send by default.
- `caterer`: read only the approved function-level headcount/catering report; no guest contact details by default.

Permission checks must be enforced in backend services, not only hidden in UI.

## MVP success measurements
Instrument response rate, response latency, non-responder follow-up time, delivery failure/opt-out/complaint rates, headcount changes, check-in reconciliation, organizer time spent and paid conversion in pilot. Define a baseline and collect comparable data before claiming improvement. Do not treat the illustrative thresholds in research as industry benchmarks.
