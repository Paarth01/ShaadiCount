// Generates api/openapi.yaml. The contract is checked against the live router by apps/api/test/openapi.int.spec.ts,
// so adding a route without documenting it (or vice versa) fails CI.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { stringify } = require('yaml');

const uuid = { type: 'string', format: 'uuid' };
const str = (max, min = 1) => ({ type: 'string', minLength: min, maxLength: max });
const int = (min, max) => ({ type: 'integer', minimum: min, maximum: max });
const obj = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const channel = { type: 'string', enum: ['whatsapp', 'sms', 'email'] };
const lang = { type: 'string', enum: ['en', 'hi'] };
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const generic = { type: 'object', additionalProperties: true };
const list = (item = generic) =>
  obj({ data: { type: 'array', items: item }, page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' } }, [
    'data',
  ]);

const schemas = {
  Error: obj(
    {
      error: obj(
        {
          code: { type: 'string' },
          message: { type: 'string' },
          requestId: { type: 'string' },
          details: { type: 'array', items: obj({ field: { type: 'string' }, message: { type: 'string' } }) },
        },
        ['code', 'message', 'requestId'],
      ),
    },
    ['error'],
  ),
  Register: obj(
    {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 10, maxLength: 128 },
      displayName: str(120),
      workspaceName: str(160),
    },
    ['email', 'password', 'displayName'],
  ),
  Login: obj({ email: { type: 'string' }, password: { type: 'string' } }, ['email', 'password']),
  CreateWorkspace: obj({ name: str(160) }, ['name']),
  UpdateWorkspace: obj({
    name: str(160),
    quietHoursStart: int(0, 23),
    quietHoursEnd: int(0, 23),
    messageSpendCapPaise: { type: ['integer', 'null'], minimum: 0 },
  }),
  Attestation: obj({ confirm: { type: 'boolean', enum: [true] } }, ['confirm']),
  Role: { type: 'string', enum: ['owner', 'organizer', 'planner', 'checkin_staff', 'readonly', 'caterer'] },
  AddMember: obj({ email: { type: 'string', format: 'email' }, role: ref('Role') }, ['email', 'role']),
  UpdateMember: obj({ role: ref('Role') }, ['role']),
  Assignments: obj({ eventIds: { type: 'array', items: uuid, maxItems: 200 }, functionIds: { type: 'array', items: uuid, maxItems: 500 } }),
  CreateEvent: obj(
    {
      name: str(160),
      timezone: { type: 'string', example: 'Asia/Kolkata', description: 'IANA time zone' },
      startDate: { type: ['string', 'null'], format: 'date' },
      endDate: { type: ['string', 'null'], format: 'date' },
      hostName: { type: ['string', 'null'], maxLength: 160 },
    },
    ['name'],
  ),
  UpdateEvent: obj({
    name: str(160),
    timezone: { type: 'string' },
    startDate: { type: ['string', 'null'], format: 'date' },
    endDate: { type: ['string', 'null'], format: 'date' },
    hostName: { type: ['string', 'null'] },
    status: { type: 'string', enum: ['draft', 'active', 'completed', 'cancelled', 'archived'] },
  }),
  CreateFunction: obj(
    {
      name: str(120),
      startsAt: { type: 'string', description: 'Event-local "2027-02-10T17:00" or RFC 3339 instant with offset' },
      venue: { type: ['string', 'null'] },
      capacity: { type: ['integer', 'null'], minimum: 0 },
      rsvpDeadline: { type: ['string', 'null'] },
      allowResponseEdits: { type: 'boolean', default: true },
      allowChildren: { type: 'boolean', default: true },
      status: { type: 'string', enum: ['draft', 'active', 'cancelled', 'completed'], default: 'active' },
    },
    ['name', 'startsAt'],
  ),
  CreateGuest: obj(
    {
      displayName: str(160),
      phone: { type: ['string', 'null'], description: 'Normalised to E.164; 10-digit Indian mobiles default to +91' },
      email: { type: ['string', 'null'] },
      preferredLanguage: lang,
      groupId: { type: ['string', 'null'], format: 'uuid' },
      groupLabel: str(120),
      tags: { type: 'array', items: str(40), maxItems: 10 },
      allowDuplicate: { type: 'boolean', default: false },
      invitations: { type: 'array', items: obj({ functionId: uuid, partySize: int(1, 50) }, ['functionId']) },
    },
    ['displayName'],
  ),
  UpdateGuest: obj({
    displayName: str(160),
    phone: { type: ['string', 'null'] },
    email: { type: ['string', 'null'] },
    preferredLanguage: lang,
    groupId: { type: ['string', 'null'], format: 'uuid' },
    groupLabel: str(120),
    tags: { type: 'array', items: str(40) },
  }),
  Group: obj({ label: str(120) }, ['label']),
  Consent: obj(
    {
      guestIds: { type: 'array', items: uuid, minItems: 1, maxItems: 1000 },
      channel,
      status: { type: 'string', enum: ['granted', 'revoked'] },
      basis: { type: 'string', enum: ['organizer_attestation', 'guest_opt_in'] },
      evidenceNote: str(500, 3),
    },
    ['guestIds', 'channel', 'basis', 'evidenceNote'],
  ),
  ImportPreview: obj(
    {
      csv: { type: 'string', description: 'CSV text, max ~900 KB / 5000 rows' },
      filename: { type: 'string' },
      mapping: obj({
        name: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        language: { type: 'string' },
        group: { type: 'string' },
        functions: { type: 'string' },
        partySize: { type: 'string' },
        tags: { type: 'string' },
      }),
    },
    ['csv'],
  ),
  ImportCommit: obj({ includeDuplicateRows: { type: 'array', items: { type: 'integer', minimum: 2 } } }),
  CreateInvitations: obj(
    { invites: { type: 'array', minItems: 1, maxItems: 500, items: obj({ guestId: uuid, partySize: int(1, 50) }, ['guestId']) } },
    ['invites'],
  ),
  UpdateInvitation: obj({ partySize: int(1, 50) }, ['partySize']),
  Reason: obj({ reason: str(300) }),
  RsvpSubmit: obj(
    {
      status: { type: 'string', enum: ['yes', 'no', 'maybe'] },
      adultCount: int(0, 100),
      childCount: int(0, 100),
      version: { type: 'integer', minimum: 0, description: '0 for a first response, otherwise the version last seen' },
    },
    ['status', 'version'],
  ),
  RsvpOverride: obj(
    {
      status: { type: 'string', enum: ['yes', 'no', 'maybe'] },
      adultCount: int(0, 100),
      childCount: int(0, 100),
      version: int(0, 1e9),
      reason: str(300, 3),
      allowExceedPartySize: { type: 'boolean' },
    },
    ['status', 'reason'],
  ),
  PublicRsvpView: obj({
    guestName: { type: 'string' },
    language: lang,
    event: generic,
    function: generic,
    partySizeMax: { type: 'integer' },
    allowChildren: { type: 'boolean' },
    deadline: { type: ['string', 'null'] },
    state: { type: 'string', enum: ['open', 'locked', 'closed_deadline', 'closed_cancelled', 'closed_completed'] },
    response: { type: ['object', 'null'], additionalProperties: true },
    checkinCode: { type: ['string', 'null'] },
  }),
  CateringSettings: obj({
    maybeWeightPercent: { type: 'number', minimum: 0, maximum: 100 },
    pendingWeightPercent: { type: 'number', minimum: 0, maximum: 100 },
    bufferPercent: { type: 'number', minimum: 0, maximum: 100 },
    mealRounding: int(1, 100),
    adultPricePaise: { type: ['integer', 'null'], minimum: 0 },
    childPricePaise: { type: ['integer', 'null'], minimum: 0 },
  }),
  Snapshot: obj({ label: str(120) }),
  Export: obj({ kind: { type: 'string', enum: ['guests', 'rsvps', 'catering', 'checkins'] }, functionId: uuid }, ['kind']),
  CreateCampaign: obj(
    {
      name: str(160),
      kind: { type: 'string', enum: ['invitation', 'reminder'] },
      channel,
      templateKey: { type: 'string' },
      audience: { type: 'string', enum: ['all_invited', 'not_responded', 'maybe', 'not_yet_messaged'] },
    },
    ['name', 'kind'],
  ),
  ScheduleCampaign: obj({ scheduledAt: { type: 'string' }, confirmRecipientCount: int(0, 1e9), confirmEstimatedCostPaise: int(0, 1e12) }, [
    'confirmRecipientCount',
    'confirmEstimatedCostPaise',
  ]),
  RequiredReason: obj({ reason: str(300, 3) }, ['reason']),
  Simulate: obj({ event: { type: 'string', enum: ['delivered', 'read', 'failed', 'opted_out'] } }, ['event']),
  CheckIn: obj({
    invitationId: uuid,
    code: { type: 'string', pattern: '^[A-Z2-9]{12}$' },
    adults: int(0, 100),
    children: int(0, 100),
    allowUnconfirmed: { type: 'boolean' },
    note: str(300),
  }),
  AddSuppression: obj(
    { channel, contact: str(254, 3), reason: { type: 'string', enum: ['opted_out', 'organizer_added', 'bounce', 'complaint'] } },
    ['channel', 'contact'],
  ),
  LiftSuppression: obj({ liftReason: str(300, 3) }, ['liftReason']),
  DataRequest: obj({ type: { type: 'string', enum: ['export', 'deletion'] }, confirmWorkspaceName: { type: 'string' } }, ['type']),
  WebhookEvent: obj(
    {
      eventId: str(100, 8),
      type: { type: 'string', enum: ['submitted', 'delivered', 'read', 'failed', 'opted_out'] },
      providerMessageId: str(200, 3),
      occurredAt: { type: 'string', format: 'date-time' },
      errorCode: { type: 'string' },
    },
    ['eventId', 'type', 'providerMessageId'],
  ),
};

const W = '/v1/workspaces/{workspaceId}';
const E = `${W}/events/{eventId}`;
const F = `${E}/functions/{functionId}`;
const I = `${F}/invitations/{invitationId}`;
const C = `${F}/campaigns/{campaignId}`;

// [method, path, tag, summary, { body, perm, idem, status, public, query, resp, csv }]
const ops = [
  ['get', '/v1/health', 'System', 'Liveness probe', { public: true }],
  ['get', '/v1/health/ready', 'System', 'Readiness probe (checks the database)', { public: true }],
  [
    'post',
    '/v1/auth/register',
    'Auth',
    'Create an account (optionally with a first workspace)',
    { body: 'Register', public: true, status: 201 },
  ],
  ['post', '/v1/auth/login', 'Auth', 'Log in; sets an HttpOnly session cookie and returns a CSRF token', { body: 'Login', public: true }],
  ['post', '/v1/auth/logout', 'Auth', 'Log out and revoke the session', { status: 204 }],
  ['get', '/v1/auth/me', 'Auth', 'Current user, workspaces and a fresh CSRF token'],
  ['get', '/v1/workspaces', 'Workspaces', 'Workspaces the caller belongs to'],
  ['post', '/v1/workspaces', 'Workspaces', 'Create a workspace (caller becomes owner)', { body: 'CreateWorkspace', status: 201 }],
  ['get', W, 'Workspaces', 'Workspace details and messaging mode', { perm: 'workspace:read' }],
  ['patch', W, 'Workspaces', 'Update name, quiet hours, spend cap', { body: 'UpdateWorkspace', perm: 'workspace:manage' }],
  [
    'post',
    `${W}/contact-authority-attestation`,
    'Workspaces',
    'Attest authority to contact uploaded guests (required before scheduling messages)',
    { body: 'Attestation', perm: 'workspace:attest' },
  ],
  ['get', `${W}/members`, 'Team', 'List members and assignments', { perm: 'members:read' }],
  ['post', `${W}/members`, 'Team', 'Add a registered user with a role', { body: 'AddMember', perm: 'members:manage', status: 201 }],
  ['patch', `${W}/members/{userId}`, 'Team', 'Change a role', { body: 'UpdateMember', perm: 'members:manage' }],
  ['delete', `${W}/members/{userId}`, 'Team', 'Remove a member (access ends immediately)', { perm: 'members:manage', status: 204 }],
  [
    'put',
    `${W}/members/{userId}/assignments`,
    'Team',
    'Replace event/function assignments for scoped roles',
    { body: 'Assignments', perm: 'members:manage' },
  ],
  ['get', `${W}/usage`, 'Workspaces', 'Usage counters (no billing in the MVP)', { perm: 'usage:read' }],
  ['get', `${W}/audit-logs`, 'Audit', 'Append-only audit log', { perm: 'audit:read', query: ['limit', 'before', 'action'] }],
  ['get', E.replace('/{eventId}', ''), 'Events', 'List events visible to the caller', { perm: 'events:read', query: ['includeArchived'] }],
  ['post', E.replace('/{eventId}', ''), 'Events', 'Create an event', { body: 'CreateEvent', perm: 'events:create', status: 201 }],
  ['get', E, 'Events', 'Event with its functions', { perm: 'events:read' }],
  ['patch', E, 'Events', 'Update an event or change its status', { body: 'UpdateEvent', perm: 'events:write' }],
  [
    'post',
    `${E}/functions`,
    'Functions',
    'Create a function (times are event-local or offset instants)',
    { body: 'CreateFunction', perm: 'events:write', status: 201 },
  ],
  ['get', F, 'Functions', 'Function details (UTC + event-local times)', { perm: 'events:read' }],
  ['patch', F, 'Functions', 'Update a function', { body: 'CreateFunction', perm: 'events:write' }],
  ['get', `${E}/guest-groups`, 'Guests', 'List guest groups', { perm: 'guests:read' }],
  ['post', `${E}/guest-groups`, 'Guests', 'Create a group', { body: 'Group', perm: 'guests:write', status: 201 }],
  ['delete', `${E}/guest-groups/{groupId}`, 'Guests', 'Delete a group (guests are kept)', { perm: 'guests:write', status: 204 }],
  [
    'get',
    `${E}/guests`,
    'Guests',
    'List guests (phones masked)',
    { perm: 'guests:read', query: ['search', 'groupId', 'page', 'limit'], resp: 'list' },
  ],
  [
    'post',
    `${E}/guests`,
    'Guests',
    'Create a guest; 409 DUPLICATE_GUEST unless allowDuplicate',
    { body: 'CreateGuest', perm: 'guests:write', status: 201 },
  ],
  [
    'get',
    `${E}/guests/{guestId}`,
    'Guests',
    'Guest detail; ?reveal=true shows contact details (audited, needs guests:write)',
    { perm: 'guests:read', query: ['reveal'] },
  ],
  ['patch', `${E}/guests/{guestId}`, 'Guests', 'Update a guest', { body: 'UpdateGuest', perm: 'guests:write' }],
  [
    'delete',
    `${E}/guests/{guestId}`,
    'Guests',
    "Erase a guest's personal data and revoke invitations",
    { perm: 'guests:write', status: 204 },
  ],
  [
    'post',
    `${E}/consents`,
    'Messaging',
    'Record permission evidence for messaging guests on a channel',
    { body: 'Consent', perm: 'consent:write', status: 201 },
  ],
  [
    'post',
    `${E}/imports/preview`,
    'Import',
    'Validate a CSV and flag errors/duplicates (nothing is saved)',
    { body: 'ImportPreview', perm: 'guests:write', status: 201 },
  ],
  ['get', `${E}/imports/{importId}`, 'Import', 'Import status/result', { perm: 'guests:write' }],
  [
    'post',
    `${E}/imports/{importId}/commit`,
    'Import',
    'Commit valid rows; idempotent. Does NOT grant messaging consent',
    { body: 'ImportCommit', perm: 'guests:write', idem: true, status: 201 },
  ],
  [
    'get',
    `${F}/invitations`,
    'Invitations',
    'List invitations with RSVP and delivery state',
    { perm: 'guests:read', query: ['status', 'search', 'page', 'limit'], resp: 'list' },
  ],
  [
    'post',
    `${F}/invitations`,
    'Invitations',
    'Invite guests to this function',
    { body: 'CreateInvitations', perm: 'invitations:write', status: 201 },
  ],
  ['patch', I, 'Invitations', 'Change invited party size', { body: 'UpdateInvitation', perm: 'invitations:write' }],
  [
    'post',
    `${I}/revoke`,
    'Invitations',
    'Revoke an invitation (link stops working, pending messages cancelled)',
    { body: 'Reason', perm: 'invitations:write' },
  ],
  ['post', `${I}/restore`, 'Invitations', 'Restore a revoked invitation', { perm: 'invitations:write' }],
  [
    'post',
    `${I}/rotate-token`,
    'Invitations',
    'Invalidate the old link/QR and return a new link',
    { body: 'Reason', perm: 'invitations:write' },
  ],
  ['get', `${I}/link`, 'Invitations', 'Personal RSVP link for sharing manually', { perm: 'invitations:write' }],
  ['get', `${I}/history`, 'Invitations', 'Append-only RSVP history', { perm: 'guests:read' }],
  ['put', `${I}/response`, 'RSVP', 'Organizer correction (reason required, audited)', { body: 'RsvpOverride', perm: 'rsvp:override' }],
  [
    'get',
    '/v1/public/rsvp/{token}',
    'Public RSVP',
    'Guest-facing invitation view (token = bearer secret)',
    { public: true, resp: 'PublicRsvpView' },
  ],
  [
    'put',
    '/v1/public/rsvp/{token}/response',
    'Public RSVP',
    'Submit or edit an RSVP (optimistic version + idempotency)',
    { body: 'RsvpSubmit', public: true, idem: true, resp: 'PublicRsvpView' },
  ],
  ['get', `${E}/dashboard`, 'Reporting', 'RSVP dashboard for every visible function', { perm: 'dashboard:read' }],
  ['get', `${F}/dashboard`, 'Reporting', 'RSVP dashboard for one function', { perm: 'dashboard:read' }],
  [
    'get',
    `${F}/non-responders`,
    'Reporting',
    'Invitations without a response (phones masked)',
    { perm: 'nonresponders:read', query: ['page', 'limit'], resp: 'list' },
  ],
  ['get', `${F}/catering`, 'Catering', 'Live catering estimate with assumptions and warnings', { perm: 'catering:read' }],
  [
    'put',
    `${F}/catering/settings`,
    'Catering',
    'Update assumptions (weights, buffer, rounding, prices)',
    { body: 'CateringSettings', perm: 'catering:write' },
  ],
  ['get', `${F}/catering/snapshots`, 'Catering', 'Saved estimates', { perm: 'catering:read' }],
  ['post', `${F}/catering/snapshots`, 'Catering', 'Save the current estimate', { body: 'Snapshot', perm: 'catering:write', status: 201 }],
  [
    'post',
    `${E}/exports`,
    'Exports',
    'Create a CSV export (permission depends on kind)',
    { body: 'Export', perm: 'workspace:read + per-kind', status: 201 },
  ],
  ['get', `${W}/exports/{exportId}/download`, 'Exports', 'Download an export (expires after 7 days)', { perm: 'per-kind', csv: true }],
  ['get', `${F}/campaigns`, 'Messaging', 'List campaigns with delivery stats', { perm: 'campaigns:read' }],
  ['post', `${F}/campaigns`, 'Messaging', 'Create a draft campaign', { body: 'CreateCampaign', perm: 'campaigns:write', status: 201 }],
  ['get', C, 'Messaging', 'Campaign detail and status counts', { perm: 'campaigns:read' }],
  [
    'post',
    `${C}/preview`,
    'Messaging',
    'Dry run: eligible/excluded recipients, cost estimate, exact message text',
    { perm: 'campaigns:read' },
  ],
  [
    'post',
    `${C}/schedule`,
    'Messaging',
    'Schedule after confirming recipient count and estimated cost',
    { body: 'ScheduleCampaign', perm: 'campaigns:send', idem: true },
  ],
  ['post', `${C}/pause`, 'Messaging', 'Pause sending', { perm: 'campaigns:send' }],
  ['post', `${C}/resume`, 'Messaging', 'Resume sending', { perm: 'campaigns:send' }],
  ['post', `${C}/cancel`, 'Messaging', 'Cancel all unsent messages', { body: 'Reason', perm: 'campaigns:send' }],
  [
    'get',
    `${C}/messages`,
    'Messaging',
    'Per-recipient delivery status (contacts masked)',
    { perm: 'campaigns:read', query: ['status', 'page', 'limit'], resp: 'list' },
  ],
  [
    'post',
    `${C}/messages/{messageId}/retry`,
    'Messaging',
    'Replay a failed/unconfirmed message (audited)',
    { body: 'RequiredReason', perm: 'campaigns:send' },
  ],
  [
    'post',
    `${C}/messages/{messageId}/simulate`,
    'Messaging',
    'SANDBOX ONLY: simulate a provider callback (fake mode)',
    { body: 'Simulate', perm: 'messages:simulate' },
  ],
  ['get', `${W}/test-inbox`, 'Messaging', 'SANDBOX ONLY: messages captured by the fake provider', { perm: 'messages:simulate' }],
  ['get', `${F}/checkin/search`, 'Check-in', 'Minimal guest lookup by name', { perm: 'guests:lookup', query: ['q'] }],
  [
    'post',
    `${F}/checkin`,
    'Check-in',
    'Check in by QR code or invitation id; duplicates return 200 {duplicate:true}',
    { body: 'CheckIn', perm: 'checkin:write', idem: 'optional', status: 201 },
  ],
  [
    'post',
    `${F}/checkin/{checkInId}/void`,
    'Check-in',
    'Void a check-in with a reason (audited)',
    { body: 'RequiredReason', perm: 'checkin:correct' },
  ],
  [
    'get',
    `${F}/checkin/reconciliation`,
    'Check-in',
    'RSVP vs actual attendance (partial until function completed)',
    { perm: 'checkin:read or dashboard:read' },
  ],
  ['get', `${W}/suppressions`, 'Privacy', 'Opt-out / suppression list (masked)', { perm: 'suppression:read', query: ['includeLifted'] }],
  [
    'post',
    `${W}/suppressions`,
    'Privacy',
    'Add a contact to the suppression list',
    { body: 'AddSuppression', perm: 'suppression:manage', status: 201 },
  ],
  [
    'post',
    `${W}/suppressions/{suppressionId}/lift`,
    'Privacy',
    'Lift a suppression with a written reason (audited)',
    { body: 'LiftSuppression', perm: 'suppression:manage' },
  ],
  ['get', `${W}/data-requests`, 'Privacy', 'Export/deletion requests', { perm: 'privacy:manage' }],
  [
    'post',
    `${W}/data-requests`,
    'Privacy',
    'Request a data export or a (grace-period) workspace deletion',
    { body: 'DataRequest', perm: 'privacy:manage', status: 201 },
  ],
  ['post', `${W}/data-requests/{requestId}/cancel`, 'Privacy', 'Cancel a scheduled deletion', { perm: 'privacy:manage' }],
  [
    'post',
    '/v1/webhooks/messaging/{provider}',
    'Webhooks',
    'Provider status callback (HMAC-signed raw body, replay window 5 min)',
    { body: 'WebhookEvent', public: true, webhook: true },
  ],
];

const paths = {};
const stdErr = {
  400: 'Malformed request',
  401: 'Not authenticated',
  403: 'Forbidden (role, CSRF or origin)',
  404: "Not found (also used for other tenants' resources)",
  409: 'Conflict (version, duplicate, state)',
  410: 'Gone (revoked/expired)',
  413: 'Body too large',
  422: 'Validation or business rule failure',
  429: 'Rate limited',
};
for (const [method, path, tag, summary, o = {}] of ops) {
  const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: m[1] === 'token' || m[1] === 'provider' ? { type: 'string' } : uuid,
  }));
  for (const q of o.query ?? []) params.push({ name: q, in: 'query', required: false, schema: { type: 'string' } });
  if (o.idem)
    params.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: o.idem === true,
      schema: { type: 'string', minLength: 16, maxLength: 128 },
      description: 'Unique key per logical operation; retries with the same key and body replay the first result',
    });
  const okStatus = String(o.status ?? 200);
  const responses = {
    [okStatus]:
      okStatus === '204'
        ? { description: 'No content' }
        : o.csv
          ? { description: 'File download', content: { 'text/csv': { schema: { type: 'string' } } } }
          : {
              description: 'Success',
              content: { 'application/json': { schema: o.resp === 'list' ? list() : o.resp ? ref(o.resp) : generic } },
            },
  };
  const errs = o.public ? (o.webhook ? [401, 422, 429] : [404, 409, 410, 422, 429]) : [400, 401, 403, 404, 409, 422, 429];
  for (const c of errs) responses[c] = { $ref: `#/components/responses/E${c}` };
  const op = {
    tags: [tag],
    summary,
    operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
    parameters: params.length ? params : undefined,
    responses,
  };
  if (o.perm) op.description = `Required permission: \`${o.perm}\`.`;
  if (o.body) op.requestBody = { required: true, content: { 'application/json': { schema: ref(o.body) } } };
  if (o.public) op.security = [];
  (paths[path] ??= {})[method] = op;
}

const doc = {
  openapi: '3.1.0',
  info: {
    title: 'ShaadiCount API',
    version: '0.1.0',
    description:
      "Versioned REST API for the ShaadiCount MVP. Session cookie (HttpOnly) + X-CSRF-Token header on every state-changing request. Workspace is always taken from the URL and verified against the caller's membership server-side; non-members receive a generic 404. Real WhatsApp/SMS sending is disabled by default: the fake provider is used unless every live safeguard is configured.",
  },
  servers: [{ url: 'http://localhost:4000', description: 'Local API (the web app proxies /v1 to it)' }],
  tags: [...new Set(ops.map((o) => o[2]))].map((name) => ({ name })),
  security: [{ cookieAuth: [], csrfToken: [] }],
  paths,
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'sc_session' },
      csrfToken: {
        type: 'apiKey',
        in: 'header',
        name: 'X-CSRF-Token',
        description: 'Value returned by login/register//v1/auth/me; required on POST/PUT/PATCH/DELETE',
      },
    },
    schemas,
    responses: Object.fromEntries(
      Object.entries(stdErr).map(([c, d]) => [`E${c}`, { description: d, content: { 'application/json': { schema: ref('Error') } } }]),
    ),
  },
};
writeFileSync(new URL('../api/openapi.yaml', import.meta.url), stringify(JSON.parse(JSON.stringify(doc)), { lineWidth: 0 }));
console.log(`wrote api/openapi.yaml with ${ops.length} operations`);
