'use client';
import { use, useState } from 'react';
import { api, wsPath } from '@/lib/api';
import { roleCan } from '@/lib/auth';
import { fmtDateTime, fmtRupees } from '@/lib/format';
import { useWorkspace } from '@/components/Shell';
import { Badge, Button, Card, Empty, ErrorBanner, Field, Modal, Stat, Tabs, TextField, useAction, useLoad } from '@/components/ui';

type Tab = 'general' | 'optouts' | 'audit' | 'privacy';

export default function SettingsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId: ws } = use(params);
  const { role } = useWorkspace();
  const [tab, setTab] = useState<Tab>('general');
  if (!roleCan.manage(role))
    return (
      <div className="banner warn" id="main">
        Only owners and organizers can open settings.
      </div>
    );
  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'optouts', label: 'Opt-outs' },
    { id: 'audit', label: 'Audit log' },
    ...(roleCan.owner(role) ? [{ id: 'privacy' as Tab, label: 'Privacy & data' }] : []),
  ];
  return (
    <div className="stack" id="main">
      <h1>Settings</h1>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'general' && <General ws={ws} />}
      {tab === 'optouts' && <OptOuts ws={ws} />}
      {tab === 'audit' && <Audit ws={ws} />}
      {tab === 'privacy' && <Privacy ws={ws} />}
    </div>
  );
}

function General({ ws }: { ws: string }) {
  const { role } = useWorkspace();
  const w = useLoad(() => api.get(wsPath(ws)), [ws]);
  const u = useLoad(() => api.get(wsPath(ws, '/usage')), [ws]);
  const [f, setF] = useState<any>(null);
  const save = useAction();
  const att = useAction();
  const d = w.data;
  const cur =
    f ??
    (d && {
      name: d.name,
      qs: String(d.quietHoursStart),
      qe: String(d.quietHoursEnd),
      cap: d.messageSpendCapPaise === null ? '' : String(d.messageSpendCapPaise / 100),
    });
  const owner = roleCan.owner(role);
  return (
    <div className="stack">
      <ErrorBanner error={w.error} />
      {d && cur && (
        <Card>
          <h3>Workspace</h3>
          <ErrorBanner error={save.error && !save.error.details.length ? save.error : null} />
          <TextField label="Name" value={cur.name} disabled={!owner} onChange={(v) => setF({ ...cur, name: v })} />
          <div className="grid cols-2">
            <TextField
              label="Quiet hours start (0-23)"
              type="number"
              min={0}
              max={23}
              disabled={!owner}
              value={cur.qs}
              onChange={(v) => setF({ ...cur, qs: v })}
              hint="No messages are sent between start and end, in each event's time zone."
            />
            <TextField
              label="Quiet hours end (0-23)"
              type="number"
              min={0}
              max={23}
              disabled={!owner}
              value={cur.qe}
              onChange={(v) => setF({ ...cur, qe: v })}
            />
          </div>
          <TextField
            label="Message spend cap (₹, optional)"
            type="number"
            min={0}
            disabled={!owner}
            value={cur.cap}
            onChange={(v) => setF({ ...cur, cap: v })}
            hint="Scheduling is refused if the estimated total would exceed this."
            error={save.error?.fieldError('messageSpendCapPaise')}
          />
          {owner ? (
            <Button
              variant="primary"
              busy={save.busy}
              disabled={!f}
              onClick={async () => {
                const r = await save.run(
                  () =>
                    api.patch(wsPath(ws), {
                      name: cur.name,
                      quietHoursStart: Number(cur.qs),
                      quietHoursEnd: Number(cur.qe),
                      messageSpendCapPaise: cur.cap === '' ? null : Math.round(Number(cur.cap) * 100),
                    }),
                  'Saved',
                );
                if (r) {
                  setF(null);
                  w.reload();
                }
              }}
            >
              Save
            </Button>
          ) : (
            <p className="muted">Only owners can change these.</p>
          )}
        </Card>
      )}
      {d && (
        <Card>
          <h3>Messaging</h3>
          <p>
            Mode:{' '}
            <Badge tone={d.messaging.mode === 'fake' ? 'info' : 'warn'}>
              {d.messaging.mode === 'fake' ? 'Test mode (sandbox provider)' : 'Live'}
            </Badge>
          </p>
          {d.messaging.mode === 'fake' && (
            <p className="muted">
              Real WhatsApp/SMS/email sending is switched off. It needs a verified provider integration, approved templates and an opt-out
              policy before it can be enabled by whoever deploys this app.
            </p>
          )}
          <p>
            Authority to contact guests:{' '}
            {d.contactAuthorityAttestedAt ? (
              <Badge tone="ok">Confirmed {fmtDateTime(d.contactAuthorityAttestedAt, 'Asia/Kolkata')}</Badge>
            ) : (
              <Badge tone="warn">Not confirmed</Badge>
            )}
          </p>
          {!d.contactAuthorityAttestedAt && (
            <>
              <ErrorBanner error={att.error} />
              <Button
                variant="primary"
                busy={att.busy}
                onClick={async () => {
                  const r = await att.run(() => api.post(wsPath(ws, '/contact-authority-attestation'), { confirm: true }), 'Confirmed');
                  if (r) w.reload();
                }}
              >
                I am authorised to contact my guests
              </Button>
            </>
          )}
        </Card>
      )}
      {u.data && (
        <div className="grid cols-3">
          <Stat label="Events" value={u.data.events} />
          <Stat label="Guests" value={u.data.guests} />
          <Stat label="Invitations" value={u.data.invitations} />
          <Stat
            label="Messages sent"
            value={u.data.messagesSubmitted}
            hint={`≈ ${fmtRupees(u.data.estimatedSpendPaise)} (placeholder rates)`}
          />
        </div>
      )}
    </div>
  );
}

function OptOuts({ ws }: { ws: string }) {
  const l = useLoad(() => api.get(wsPath(ws, '/suppressions')), [ws]);
  const [adding, setAdding] = useState(false);
  const [lift, setLift] = useState<any>(null);
  return (
    <div className="stack">
      <div className="banner info">
        Contacts here are never messaged, even if you record permission again. Entries are stored as masked hashes and survive guest
        deletion.
      </div>
      <div className="row">
        <Button variant="primary" onClick={() => setAdding(true)}>
          Add contact
        </Button>
      </div>
      <ErrorBanner error={l.error} />
      {l.data && !l.data.data.length && (
        <Card>
          <Empty title="No opt-outs yet">Guests who reply STOP are added automatically.</Empty>
        </Card>
      )}
      <Card style={{ padding: '.2rem 1rem' }}>
        <ul className="list">
          {(l.data?.data ?? []).map((s: any) => (
            <li key={s.id} className="row between">
              <div>
                <b>{s.contact}</b> <Badge>{s.channel}</Badge>
                <div className="muted" style={{ fontSize: '.85rem' }}>
                  {s.reason.replaceAll('_', ' ')} · {s.source.replaceAll('_', ' ')} · {fmtDateTime(s.createdAt, 'Asia/Kolkata')}
                </div>
              </div>
              <Button size="sm" onClick={() => setLift(s)}>
                Lift
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      {adding && (
        <AddSuppression
          ws={ws}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            l.reload();
          }}
        />
      )}
      {lift && (
        <LiftModal
          ws={ws}
          s={lift}
          onClose={() => setLift(null)}
          onDone={() => {
            setLift(null);
            l.reload();
          }}
        />
      )}
    </div>
  );
}
function AddSuppression({ ws, onClose, onDone }: { ws: string; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState('whatsapp');
  const [contact, setContact] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal
      title="Add to opt-out list"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={contact.length < 3}
            onClick={async () => {
              const r = await run(() => api.post(wsPath(ws, '/suppressions'), { channel, contact }), 'Added');
              if (r) onDone();
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <Field label="Channel">
        {(id) => (
          <select id={id} className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </select>
        )}
      </Field>
      <TextField label="Phone number or email" value={contact} onChange={setContact} error={error?.fieldError('contact')} />
    </Modal>
  );
}
function LiftModal({ ws, s, onClose, onDone }: { ws: string; s: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal
      title={`Lift opt-out for ${s.contact}?`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            busy={busy}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              const r = await run(() => api.post(wsPath(ws, `/suppressions/${s.id}/lift`), { liftReason: reason }), 'Lifted');
              if (r) onDone();
            }}
          >
            Lift opt-out
          </Button>
        </>
      }
    >
      <div className="banner warn">
        Only lift this if the guest has clearly asked to hear from you again. Permission must be recorded again before messaging.
      </div>
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <TextField label="Reason (required)" value={reason} onChange={setReason} error={error?.fieldError('liftReason')} />
    </Modal>
  );
}

function Audit({ ws }: { ws: string }) {
  const [action, setAction] = useState('');
  const l = useLoad(
    () => api.get(wsPath(ws, `/audit-logs?limit=100${action ? `&action=${encodeURIComponent(action)}` : ''}`)),
    [ws, action],
  );
  return (
    <div className="stack">
      <div className="row">
        <select className="input" style={{ width: 'auto' }} aria-label="Filter" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All activity</option>
          {['security', 'rsvp', 'campaign', 'consent', 'export', 'member', 'invitation', 'checkin', 'privacy', 'suppression'].map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <Button onClick={l.reload}>Refresh</Button>
      </div>
      <ErrorBanner error={l.error} />
      <Card style={{ padding: '.2rem 1rem' }}>
        <ul className="list">
          {(l.data?.data ?? []).map((a: any) => (
            <li key={a.id}>
              <div className="row between">
                <b>{a.action}</b>
                <small className="muted">{fmtDateTime(a.createdAt, 'Asia/Kolkata')}</small>
              </div>
              <div className="muted" style={{ fontSize: '.85rem' }}>
                {a.actorName ?? a.actorType}
                {a.reason && ` · “${a.reason}”`}
              </div>
            </li>
          ))}
          {l.data && !l.data.data.length && <li className="muted">Nothing yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

function Privacy({ ws }: { ws: string }) {
  const { name } = useWorkspace();
  const l = useLoad(() => api.get(wsPath(ws, '/data-requests')), [ws]);
  const exp = useAction();
  const [del, setDel] = useState(false);
  const [typed, setTyped] = useState('');
  const delA = useAction();
  const scheduled = (l.data?.data ?? []).find((r: any) => r.type === 'deletion' && r.status === 'scheduled');
  return (
    <div className="stack">
      <Card>
        <h3>Export workspace data</h3>
        <p className="muted">
          A JSON file with events, guests, RSVPs, check-ins and consent records. Message bodies and links are not included. It expires after
          7 days.
        </p>
        <ErrorBanner error={exp.error} />
        <Button
          busy={exp.busy}
          onClick={async () => {
            const r = await exp.run(() => api.post(wsPath(ws, '/data-requests'), { type: 'export' }));
            if (r) {
              window.location.href = r.downloadPath;
              l.reload();
            }
          }}
        >
          Create and download export
        </Button>
      </Card>
      <Card>
        <h3>Delete this workspace</h3>
        {scheduled ? (
          <>
            <div className="banner warn">
              Deletion is scheduled for <b>{fmtDateTime(scheduled.executeAfter, 'Asia/Kolkata')}</b>. Until then you can cancel it.
            </div>
            <Button
              onClick={async () => {
                await api.post(wsPath(ws, `/data-requests/${scheduled.id}/cancel`));
                l.reload();
              }}
            >
              Cancel deletion
            </Button>
          </>
        ) : (
          <>
            <p className="muted">
              All events, guests, RSVPs and check-ins are permanently deleted after a grace period. Opt-out records and the audit log are
              kept as legal and safety evidence.
            </p>
            <Button variant="danger" onClick={() => setDel(true)}>
              Schedule deletion…
            </Button>
          </>
        )}
      </Card>
      {del && (
        <Modal
          title="Delete workspace?"
          onClose={() => setDel(false)}
          footer={
            <>
              <Button onClick={() => setDel(false)}>Cancel</Button>
              <Button
                variant="danger"
                busy={delA.busy}
                disabled={typed !== name}
                onClick={async () => {
                  const r = await delA.run(
                    () => api.post(wsPath(ws, '/data-requests'), { type: 'deletion', confirmWorkspaceName: typed }),
                    'Deletion scheduled',
                  );
                  if (r) {
                    setDel(false);
                    l.reload();
                  }
                }}
              >
                Schedule deletion
              </Button>
            </>
          }
        >
          <p>
            Type <b>{name}</b> to confirm.
          </p>
          <ErrorBanner error={delA.error && !delA.error.details.length ? delA.error : null} />
          <TextField label="Workspace name" value={typed} onChange={setTyped} />
        </Modal>
      )}
      <Card>
        <h3>Requests</h3>
        {l.data && !l.data.data.length && <p className="muted">None yet.</p>}
        <ul className="list">
          {(l.data?.data ?? []).map((r: any) => (
            <li key={r.id} className="row between">
              <span>
                {r.type} · <Badge>{r.status}</Badge>
              </span>
              <small className="muted">{fmtDateTime(r.requestedAt, 'Asia/Kolkata')}</small>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
