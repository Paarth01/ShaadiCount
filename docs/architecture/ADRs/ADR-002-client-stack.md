# ADR-002: TypeScript Web-First Client Stack

- **Status:** Accepted for MVP pilot; revisit after validation.
- **Decision:** Use a responsive Next.js + TypeScript organizer web app and a responsive guest RSVP web experience. Use NestJS + TypeScript for the REST API. The organizer UI must be usable on mobile browsers, but a native app is out of scope for the pilot.
- **Rationale:** Reduces delivery and support cost, allows planners to work from desktop/tablet/mobile, and lets guests RSVP without installing an app. One language ecosystem also simplifies validation and hiring.
- **Alternatives:** React Native organizer app; Flutter; native Swift/Kotlin; Flutter web; separate backend language.
- **Trade-offs:** Browser access to device features may be limited; responsive UI and offline behavior must be tested explicitly. Native push notifications are not an MVP dependency.
- **Migration:** If pilot evidence supports a native client later, it can consume the same documented REST/OpenAPI contract. Do not couple clients to backend internals.
- **Validation:** Test organizer workflows and guest RSVP on low-end Android browsers, desktop and tablet; test keyboard accessibility, screen-reader basics, Hindi/English rendering and slow networks.
