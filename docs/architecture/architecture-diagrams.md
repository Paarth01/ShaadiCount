# Architecture Diagrams

## System context
```mermaid
flowchart LR
  Planner[Planner / Organizer] --> WEB[Responsive Organizer Web]
  Guest[Invited Guest] --> RSVP[Guest RSVP Web]
  Staff[Check-in Staff / Caterer] --> Restricted[Restricted Check-in / Aggregate Reports]
  WEB --> API[Versioned REST API]
  RSVP --> API
  Restricted --> API
  API --> DB[(PostgreSQL)]
  DB --> OUTBOX[(Transactional Outbox)]
  OUTBOX --> Worker[Background Worker]
  Worker --> WA[Approved WhatsApp Provider]
  Worker --> SMS[Approved SMS Provider]
  WA --> Hook[Verified Webhook Ingestion]
  SMS --> Hook
  API --> Storage[(Private Import / Export Storage)]
```

## Container/component architecture
```mermaid
flowchart TB
  subgraph Clients
    ORG[Next.js Organizer Web]
    GUEST[Next.js Guest RSVP Web]
  end
  subgraph Application
    REST[REST API / Auth / Rate Limits]
    IAM[Identity and Workspace]
    EVT[Events, Guests and Invitations]
    RSVP[RSVP and History]
    MSG[Campaign and Messaging]
    REP[Reporting and Catering]
    CHECK[Check-in]
    WORKER[Outbox Relay / Worker]
  end
  ORG --> REST
  GUEST --> REST
  REST --> IAM
  REST --> EVT
  REST --> RSVP
  REST --> MSG
  REST --> REP
  REST --> CHECK
  REST --> PG[(PostgreSQL)]
  PG --> WORKER
  WORKER --> PROVIDERS[Provider Adapters]
  PROVIDERS --> EXT[Approved Messaging APIs]
```

## RSVP sequence
```mermaid
sequenceDiagram
  participant G as Guest Browser
  participant A as API
  participant D as PostgreSQL
  G->>A: Open invitation link
  A->>D: Resolve hashed token and invitation scope
  D-->>A: Minimal event/function details
  A-->>G: RSVP form without guest directory
  G->>A: Submit response + version
  A->>D: Validate deadline/cap; write response, history and outbox transactionally
  D-->>A: Commit
  A-->>G: Confirmation
```

## Reminder dispatch sequence
```mermaid
sequenceDiagram
  participant S as Scheduler
  participant D as PostgreSQL
  participant W as Worker
  participant P as Provider Adapter
  S->>D: Find due schedules / create outbox item
  W->>D: Claim due message idempotently
  W->>D: Recheck consent, opt-out, RSVP, deadline and quota
  alt Eligible and live sending enabled
    W->>P: Send approved template
    P-->>W: Accepted/rejected or timeout
    W->>D: Record attempt and status
  else Test mode or ineligible
    W->>D: Simulate or mark skipped
  end
```

## Webhook sequence
```mermaid
sequenceDiagram
  participant P as Provider
  participant H as Webhook API
  participant D as PostgreSQL
  P->>H: Callback + signature/event ID
  H->>H: Verify signature and replay rules
  H->>D: Insert provider event with unique provider/event ID
  D-->>H: New or duplicate
  H-->>P: Acknowledge durable receipt
  H->>D: Apply idempotent normalized state transition
```

## Deployment baseline
```mermaid
flowchart TB
  WEB[Web Hosting / TLS] --> API[Managed API Container]
  API --> PG[(Managed PostgreSQL)]
  PG --> WORKER[Worker Process]
  WORKER --> EXT[Fake Provider in Dev / Approved Provider in Production]
  API --> OBJ[Private Object Storage, if enabled]
  API --> OBS[Logs / Metrics / Alerts]
  WORKER --> OBS
```

## Important asynchronous boundaries
Outbox processing, provider delivery callbacks and import/export jobs are asynchronous. HTTP acceptance must not be presented as final delivery. Every asynchronous item needs a stable ID, retry policy, deduplication key, terminal failure state and documented replay behavior. Payment is outside MVP.
