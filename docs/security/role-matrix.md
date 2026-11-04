# Role and permission matrix (as implemented)

Source of truth: `apps/api/src/auth/permissions.ts` (deny by default). `test/ops.int.spec.ts` probes 15 endpoints × 6 roles against this table, and `src/domain.spec.ts` asserts the invariants.

| Capability | owner | organizer | planner* | check-in staff* | read-only* | caterer* |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Team, roles, assignments, privacy export/deletion | ✅ (owner only) | read team only | - | - | - | - |
| Workspace settings (quiet hours, spend cap) | ✅ | - | - | - | - | - |
| Attest authority to contact guests | ✅ | ✅ | - | - | - | - |
| Create events | ✅ | ✅ | - | - | - | - |
| Edit events/functions | ✅ | ✅ | ✅ | - | - | - |
| Guests: view/add/import/delete | ✅ | ✅ | ✅ | - | - | - |
| Reveal full contact details (audited) | ✅ | ✅ | ✅ | - | - | - |
| Contact export (CSV with phones) | ✅ | ✅ | - | - | - | - |
| Invitations, links, RSVP corrections | ✅ | ✅ | ✅ | - | - | - |
| RSVP dashboard | ✅ | ✅ | ✅ | - | ✅ | - |
| Non-responder list | ✅ | ✅ | ✅ | - | - | - |
| Catering estimate and export | ✅ | ✅ | ✅ (edit) | - | view | view + export |
| Record consent / create + schedule campaigns | ✅ | ✅ | ✅ | - | - | - |
| Opt-out list (view/add/lift) | ✅ | ✅ | - | - | - | - |
| Guest lookup + check-in + correct check-in | ✅ | ✅ | ✅ | ✅ | - | - |
| Audit log | ✅ | ✅ | - | - | - | - |

\* Scoped roles only reach events (or, for check-in staff, functions) they are **assigned** to; anything else is a 404.

Server rules that sit on top of the matrix: workspace membership is looked up on every request; denials are audited (`security.permission_denied`, `security.workspace_access_denied`, `security.export_denied`); removing a member takes effect immediately; the last owner cannot be removed or demoted. The web UI mirrors the matrix only to hide controls (`apps/web/lib/auth.tsx`); the API is the authority.
