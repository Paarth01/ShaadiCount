'use client';
import { use, useState } from 'react';
import { api, evPath, wsPath } from '@/lib/api';
import { roleCan, type Role } from '@/lib/auth';
import { initials } from '@/lib/format';
import { useWorkspace } from '@/components/Shell';
import { Badge, Button, Card, Confirm, ErrorBanner, Field, Modal, TextField, useAction, useLoad } from '@/components/ui';

const ROLE_INFO: Record<Role, string> = {
  owner: 'Everything, including team, privacy and deletion.',
  organizer: 'Manage events, guests, messaging, exports and settings.',
  planner: 'Run assigned events: guests, RSVPs, reminders, catering, check-in.',
  checkin_staff: 'Check guests in for assigned functions only. Sees minimal guest info.',
  readonly: 'View RSVP dashboards and catering numbers for assigned events.',
  caterer: 'View the aggregate headcount and catering estimate for assigned events. No guest names.',
};
const SCOPED: Role[] = ['planner', 'checkin_staff', 'readonly', 'caterer'];

export default function TeamPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId: ws } = use(params);
  const { role } = useWorkspace();
  const m = useLoad(() => api.get(wsPath(ws, '/members')), [ws]);
  const [adding, setAdding] = useState(false);
  const [assign, setAssign] = useState<any>(null);
  const [remove, setRemove] = useState<any>(null);
  const [roleEdit, setRoleEdit] = useState<any>(null);
  const isOwner = roleCan.owner(role);
  if (!roleCan.manage(role))
    return (
      <div className="banner warn" id="main">
        Only owners and organizers can see the team.
      </div>
    );
  return (
    <div className="stack" id="main">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Team</h1>
        {isOwner && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add member
          </Button>
        )}
      </div>
      <ErrorBanner error={m.error} onRetry={m.reload} />
      <Card style={{ padding: '.2rem 1rem' }}>
        <ul className="list">
          {(m.data?.data ?? []).map((u: any) => (
            <li key={u.userId}>
              <div className="row top">
                <div className="avatar">{initials(u.displayName)}</div>
                <div className="grow">
                  <b>{u.displayName}</b> <Badge tone="brand">{u.role.replace('_', ' ')}</Badge>
                  <div className="muted" style={{ fontSize: '.85rem' }}>
                    {u.email}
                  </div>
                  {SCOPED.includes(u.role) && (
                    <div className="muted" style={{ fontSize: '.85rem' }}>
                      {u.assignments.length ? `${u.assignments.length} assignment(s)` : 'No events assigned yet: they cannot see anything'}
                    </div>
                  )}
                </div>
                {isOwner && (
                  <div className="row" style={{ gap: '.25rem' }}>
                    {SCOPED.includes(u.role) && (
                      <Button size="sm" onClick={() => setAssign(u)}>
                        Assign
                      </Button>
                    )}
                    <Button size="sm" onClick={() => setRoleEdit(u)}>
                      Role
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemove(u)}>
                      Remove
                    </Button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h3>What each role can do</h3>
        <ul style={{ paddingLeft: '1.1rem', margin: 0 }}>
          {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
            <li key={r}>
              <b>{r.replace('_', ' ')}</b>: {ROLE_INFO[r]}
            </li>
          ))}
        </ul>
      </Card>
      {adding && (
        <AddMember
          ws={ws}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            m.reload();
          }}
        />
      )}
      {roleEdit && (
        <RoleModal
          ws={ws}
          u={roleEdit}
          onClose={() => setRoleEdit(null)}
          onDone={() => {
            setRoleEdit(null);
            m.reload();
          }}
        />
      )}
      {assign && (
        <AssignModal
          ws={ws}
          u={assign}
          onClose={() => setAssign(null)}
          onDone={() => {
            setAssign(null);
            m.reload();
          }}
        />
      )}
      {remove && (
        <Confirm
          danger
          title={`Remove ${remove.displayName}?`}
          confirmLabel="Remove"
          body="They lose access immediately. Their past actions stay in the audit log."
          onConfirm={async () => {
            await api.del(wsPath(ws, `/members/${remove.userId}`));
            m.reload();
          }}
          onClose={() => setRemove(null)}
        />
      )}
    </div>
  );
}

function RoleSelect({ value, onChange }: { value: string; onChange: (v: Role) => void }) {
  return (
    <Field label="Role" hint={ROLE_INFO[value as Role]}>
      {(id) => (
        <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value as Role)}>
          {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
            <option key={r} value={r}>
              {r.replace('_', ' ')}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
function AddMember({ ws, onClose, onDone }: { ws: string; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('planner');
  const { busy, error, run } = useAction();
  return (
    <Modal
      title="Add team member"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!email}
            onClick={async () => {
              const r = await run(() => api.post(wsPath(ws, '/members'), { email, role }), 'Member added');
              if (r) onDone();
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <p className="muted">They need a ShaadiCount account first. Ask them to register, then add their email here.</p>
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <TextField label="Their email" type="email" value={email} onChange={setEmail} error={error?.fieldError('email')} />
      <RoleSelect value={role} onChange={setRole} />
    </Modal>
  );
}
function RoleModal({ ws, u, onClose, onDone }: { ws: string; u: any; onClose: () => void; onDone: () => void }) {
  const [role, setRole] = useState<Role>(u.role);
  const { busy, error, run } = useAction();
  return (
    <Modal
      title={`Role for ${u.displayName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={role === u.role}
            onClick={async () => {
              const r = await run(() => api.patch(wsPath(ws, `/members/${u.userId}`), { role }), 'Role changed');
              if (r) onDone();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <RoleSelect value={role} onChange={setRole} />
    </Modal>
  );
}
function AssignModal({ ws, u, onClose, onDone }: { ws: string; u: any; onClose: () => void; onDone: () => void }) {
  const events = useLoad(async () => {
    const l = (await api.get(wsPath(ws, '/events'))).data as any[];
    return Promise.all(l.map((e) => api.get(evPath(ws, e.id))));
  }, [ws]);
  const [evSel, setEvSel] = useState<Set<string>>(new Set(u.assignments.filter((a: any) => !a.functionId).map((a: any) => a.eventId)));
  const [fnSel, setFnSel] = useState<Set<string>>(new Set(u.assignments.filter((a: any) => a.functionId).map((a: any) => a.functionId)));
  const { busy, error, run } = useAction();
  const flip = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  };
  const fnOnly = u.role === 'checkin_staff';
  return (
    <Modal
      title={`Assign ${u.displayName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={async () => {
              const r = await run(
                () => api.put(wsPath(ws, `/members/${u.userId}/assignments`), { eventIds: [...evSel], functionIds: [...fnSel] }),
                'Assignments saved',
              );
              if (r) onDone();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <p className="muted">
        {fnOnly
          ? 'Choose the functions this person checks guests in for.'
          : 'Choose events (everything in the event) or individual functions.'}
      </p>
      <ErrorBanner error={error} />
      {events.loading && <div className="skel" style={{ height: 60 }} />}
      {(events.data ?? []).map((e: any) => (
        <div key={e.id} style={{ marginBottom: '.7rem' }}>
          {!fnOnly && (
            <label className="check">
              <input type="checkbox" checked={evSel.has(e.id)} onChange={() => flip(evSel, e.id, setEvSel)} />
              <b>{e.name}</b> <small className="muted">whole event</small>
            </label>
          )}
          {fnOnly && <b>{e.name}</b>}
          <div style={{ paddingLeft: fnOnly ? 0 : '1.6rem' }}>
            {e.functions.map((f: any) => (
              <label key={f.id} className="check">
                <input type="checkbox" checked={fnSel.has(f.id)} onChange={() => flip(fnSel, f.id, setFnSel)} />
                {f.name}
              </label>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  );
}
