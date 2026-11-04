# Screen Specifications

## Organizer navigation
Bottom tabs: Overview, Events, Guests, Messages, Settings. Event detail contains Functions, Guest list, Campaigns, Catering, Check-in and Reports.

## Screen inventory and behavior
- Login/onboarding: email/phone identity provider choice after feasibility review; show validation, recovery and loading states.
- Workspace dashboard: upcoming events, pending tasks, recent delivery failures and plan usage.
- Create event: name, time zone, date range, host contact and workspace; validate required fields.
- Event/function editor: date/time/venue, RSVP deadline, capacity, child-count policy and status.
- Guest list: search/filter by group, tag, invitation status and function; avoid displaying full phone numbers by default.
- Import guests: upload, map columns, preview duplicates/errors, confirm import, show progress and downloadable row-error report.
- Campaign setup: choose function/audience, approved template, channel, schedule, quiet hours and test send; preview exact localized message.
- Message analytics: queued/submitted/delivered/read-if-supported/failed/unknown counts; never conflate accepted with delivered.
- Catering dashboard: confirmed adult/child totals, tentative and pending separately, scenario buffer, per-person cost and timestamp.
- Guest RSVP: event/function details, localized Yes/No/Maybe, adult/child count controls capped at invitation limit, privacy note and submit.
- Guest confirmation: response summary, edit action if allowed, event details and no unnecessary account prompt.
- Check-in: QR scan/manual search, guest/function confirmation, duplicate warning and role-limited access.
- Subscription/billing: current plan, usage, invoice/payment state, cancellation and support.
- Reports: date-stamped export with role-based field selection and expiring download URL.

## Wireframe conventions
Use a single primary action per screen, progressive disclosure for advanced settings, 44px minimum touch targets, visible field labels, inline errors and persistent save/submit feedback. Use INR formatting (`₹`) and Indian date display while storing UTC timestamps plus IANA time zone. Support English/Hindi language switching without losing form state.

## Guest flow
Open link → verify invitation scope → view event details → choose Yes/No/Maybe → enter allowed counts → review → submit → confirmation. The guest page must be lightweight, responsive and install-free.

## Accessibility and states
Keyboard navigation, screen-reader labels, contrast checks, focus visibility, error summaries, reduced motion and non-color-only status. Every screen specifies loading, empty, retryable error, terminal error and success states. Do not lose a typed response on a recoverable network failure.
