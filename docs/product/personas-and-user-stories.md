# Personas and User Stories

## Personas
### Family host
Needs a simple interface, WhatsApp-friendly links, clear headcounts and minimal setup. May have a large family group sharing one contact number. Risk: guest count is confused with household count.

### Wedding planner
Runs several client workspaces/events, delegates work and needs reusable templates. Risk: access to one client's guest list leaks into another client.

### Caterer
Needs per-function counts, update timestamp, child/adult split and planning assumptions. Should not see phone numbers unless explicitly necessary and authorized.

### Check-in operator
Needs fast lookup, clear duplicate warnings and limited access. Must not export the entire guest database.

### Guest
Wants a short, trustworthy, localized mobile page and the ability to correct their response. Does not want to install an app or create an account.

### SaaS support administrator
Needs operational metadata and support workflows, but access to guest PII should be exceptional, time-limited, justified and audited.

## User stories
- US-001 Create multi-function event.
- US-002 Import guests with preview, validation and row-level errors.
- US-003 Detect likely duplicates without silently merging distinct people.
- US-004 Create function-specific invitations and caps.
- US-005 Submit/update RSVP securely.
- US-006 Schedule reminders with quiet hours.
- US-007 Review message delivery lifecycle.
- US-008 Export least-privilege catering report.
- US-009 Record check-in exactly once.
- US-010 Manage roles and revoke collaborator access.
- US-011 Apply opt-out and suppression immediately.
- US-012 Review audit trail and export/delete tenant data.
- US-013 View plan usage and billing status.
- US-014 Platform operator investigates provider outage without exposing message content unnecessarily.
