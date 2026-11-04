# Acceptance Criteria

## RSVP
- Given a valid invitation token and an open RSVP window, when the guest submits a permitted response, then response and history are committed atomically.
- Given an invitation cap of four, when a guest submits five attendees, then the API rejects the submission and leaves the previous response unchanged.
- Given a guest has a reception invitation only, when they submit a reception RSVP, then no mehendi response or count changes.
- Given two updates race, when both submit against the same response version, then optimistic concurrency rejects the stale update with a conflict response.
- Given an expired or revoked token, when used, then no guest details are disclosed and no response is changed.

## Messaging
- Given a scheduled reminder, when dispatch starts, then current RSVP, event status, deadline, quiet hours, opt-out and rate-limit rules are rechecked.
- Given the provider times out after accepting a request, when retry occurs, then the system uses provider idempotency where available and records delivery as unknown until reconciled.
- Given the same webhook event arrives twice, then only one logical transition is applied.
- Given a guest opts out, then unsent eligible marketing messages are suppressed; necessary event communications follow the approved policy and legal review.

## Import
- Given a CSV with valid and invalid rows, then preview identifies row-level issues before persistence.
- Given a retry of the same import commit request, then the same import result is returned rather than duplicating guests.
- Given spreadsheet formula-like values, then exported CSV values are escaped to prevent formula execution.

## Tenant and roles
- Given a user from workspace A requests a workspace B resource, then access is denied regardless of guessed identifiers.
- Given a caterer role, then guest contact fields and collaborator management are unavailable unless explicitly granted.
- Given staff access is revoked, then subsequent API requests fail authorization.

## Check-in and reports
- Given an attendee is already checked in, then a second scan returns a duplicate indication without creating a second active check-in.
- Given the event has not finished, then actual attendance is labelled partial.
- Given catering output, then confirmed counts, tentative counts, planning buffer, meal rounding and estimate timestamp are visible.
