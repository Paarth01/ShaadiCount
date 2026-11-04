export const ROLES = ['owner', 'organizer', 'planner', 'checkin_staff', 'readonly', 'caterer'] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | 'workspace:read'
  | 'workspace:manage'
  | 'workspace:attest'
  | 'members:read'
  | 'members:manage'
  | 'events:read'
  | 'events:create'
  | 'events:write'
  | 'guests:read'
  | 'guests:write'
  | 'guests:export'
  | 'guests:lookup'
  | 'consent:write'
  | 'suppression:read'
  | 'suppression:manage'
  | 'invitations:write'
  | 'rsvp:override'
  | 'dashboard:read'
  | 'nonresponders:read'
  | 'campaigns:read'
  | 'campaigns:write'
  | 'campaigns:send'
  | 'messages:simulate'
  | 'checkin:read'
  | 'checkin:write'
  | 'checkin:correct'
  | 'catering:read'
  | 'catering:write'
  | 'exports:rsvps'
  | 'exports:checkins'
  | 'audit:read'
  | 'privacy:manage'
  | 'usage:read';

const OWNER_ONLY: Permission[] = ['workspace:manage', 'members:manage', 'privacy:manage'];
const MANAGE: Permission[] = [
  'workspace:read',
  'workspace:attest',
  'members:read',
  'events:read',
  'events:create',
  'events:write',
  'guests:read',
  'guests:write',
  'guests:export',
  'guests:lookup',
  'consent:write',
  'suppression:read',
  'suppression:manage',
  'invitations:write',
  'rsvp:override',
  'dashboard:read',
  'nonresponders:read',
  'campaigns:read',
  'campaigns:write',
  'campaigns:send',
  'messages:simulate',
  'checkin:read',
  'checkin:write',
  'checkin:correct',
  'catering:read',
  'catering:write',
  'exports:rsvps',
  'exports:checkins',
  'audit:read',
  'usage:read',
];

/** Deny-by-default role matrix (documented in docs/security/role-matrix.md). */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set([...MANAGE, ...OWNER_ONLY]),
  organizer: new Set(MANAGE),
  planner: new Set<Permission>([
    'workspace:read',
    'events:read',
    'events:write',
    'guests:read',
    'guests:write',
    'guests:lookup',
    'consent:write',
    'invitations:write',
    'rsvp:override',
    'dashboard:read',
    'nonresponders:read',
    'campaigns:read',
    'campaigns:write',
    'campaigns:send',
    'checkin:read',
    'checkin:write',
    'checkin:correct',
    'catering:read',
    'catering:write',
    'exports:rsvps',
    'exports:checkins',
  ]),
  checkin_staff: new Set<Permission>([
    'workspace:read',
    'events:read',
    'guests:lookup',
    'checkin:read',
    'checkin:write',
    'checkin:correct',
  ]),
  readonly: new Set<Permission>(['workspace:read', 'events:read', 'dashboard:read', 'catering:read']),
  caterer: new Set<Permission>(['workspace:read', 'events:read', 'catering:read']),
};

/** Roles that only see events/functions they are explicitly assigned to. */
export const SCOPED_ROLES: ReadonlySet<Role> = new Set<Role>(['planner', 'checkin_staff', 'readonly', 'caterer']);

export const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role].has(p);
