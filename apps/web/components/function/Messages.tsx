'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { api, fnPath, newKey, wsPath } from '@/lib/api';
import { REASONS, fmtDateTime, fmtRupees } from '@/lib/format';
import { roleCan, type Role } from '@/lib/auth';
import { useWorkspace } from '../Shell';
import { Badge, Button, Card, Confirm, Empty, ErrorBanner, Field, Modal, TextField, useAction, useLoad, useToast } from '../ui';
import { MsgBadge, StatusPill } from '../StatusBadges';

export function MessagesTab({ ws, ev, fn, tz, role }: { ws: string; ev: string; fn: any; tz: string; role: Role }) {
  const { details } = useWorkspace();
  const list = useLoad(() => api.get(fnPath(ws, ev, fn.id, '/campaigns')), [fn.id]);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [inbox, setInbox] = useState(false);
  const [attested, setAttested] = useState(!!details?.contactAuthorityAttestedAt);
  const testMode = details?.messaging?.mode === 'fake';
  const campaigns: any[] = list.data?.data ?? [];
  return (
    <div className="stack">
      {!attested && <AttestationCard ws={ws} role={role} onDone={() => setAttested(true)} />}
      <div className="banner info">
        <b>How messaging works here:</b> we only message guests whose permission you have recorded, never anyone who opted out, and never
        during quiet hours ({details?.quietHoursStart ?? 21}:00–{details?.quietHoursEnd ?? 9}:00 event time). You review the exact
        recipients and estimated cost before anything is scheduled. Need to record permission?{' '}
        <Link href={`/w/${ws}/events/${ev}/guests`}>Open guests</Link>.
      </div>
      <div className="row">
        {roleCan.messaging(role) && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New campaign
          </Button>
        )}
        {testMode && <Button onClick={() => setInbox(true)}>Test inbox</Button>}
      </div>
      <ErrorBanner error={list.error} onRetry={list.reload} />
      {list.loading && !list.data && <div className="skel" style={{ height: 100 }} />}
      {!list.loading && !campaigns.length && (
        <Card>
          <Empty title="No campaigns yet">
            Create an invitation or reminder campaign. Nothing is sent until you preview and schedule it.
          </Empty>
        </Card>
      )}
      <div className="grid cols-2">
        {campaigns.map((c) => (
          <button
            key={c.id}
            className="card card-link"
            style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }}
            onClick={() => setOpen(c.id)}
          >
            <div className="row between">
              <h3 style={{ margin: 0 }}>{c.name}</h3>
              <StatusPill status={c.status} />
            </div>
            <p className="muted" style={{ margin: '.2rem 0' }}>
              {c.kind} · {c.channel} · {c.audience.replaceAll('_', ' ')}
            </p>
            <div className="row" style={{ gap: '.3rem' }}>
              {Object.entries(c.stats ?? {}).map(([k, v]) => (
                <Badge key={k} tone={['delivered', 'read'].includes(k) ? 'ok' : k === 'failed' ? 'bad' : undefined}>
                  {String(v)} {k}
                </Badge>
              ))}
            </div>
          </button>
        ))}
      </div>
      {creating && (
        <CreateCampaign
          ws={ws}
          ev={ev}
          fn={fn}
          onClose={() => setCreating(false)}
          onDone={(id) => {
            setCreating(false);
            list.reload();
            setOpen(id);
          }}
        />
      )}
      {open && (
        <CampaignPanel
          ws={ws}
          ev={ev}
          fn={fn}
          id={open}
          tz={tz}
          role={role}
          attested={attested}
          testMode={testMode}
          onClose={() => {
            setOpen(null);
            list.reload();
          }}
        />
      )}
      {inbox && <Inbox ws={ws} onClose={() => setInbox(false)} />}
    </div>
  );
}

function AttestationCard({ ws, role, onDone }: { ws: string; role: Role; onDone: () => void }) {
  const [ok, setOk] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <div className="banner warn">
      <b>One-time confirmation needed before you can schedule messages</b>
      {roleCan.manage(role) ? (
        <>
          <label className="check" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
            <span>
              I confirm that I am authorised to contact the guests on these lists, that they provided their contact details for this event,
              and that I will honour opt-out requests.
            </span>
          </label>
          <ErrorBanner error={error} />
          <Button
            variant="primary"
            busy={busy}
            disabled={!ok}
            onClick={async () => {
              const r = await run(() => api.post(wsPath(ws, '/contact-authority-attestation'), { confirm: true }), 'Confirmed');
              if (r) onDone();
            }}
          >
            Confirm
          </Button>
        </>
      ) : (
        <p>Ask an owner or organizer to confirm this in the workspace.</p>
      )}
    </div>
  );
}

function CreateCampaign({
  ws,
  ev,
  fn,
  onClose,
  onDone,
}: {
  ws: string;
  ev: string;
  fn: any;
  onClose: () => void;
  onDone: (id: string) => void;
}) {
  const [f, setF] = useState({ name: '', kind: 'invitation', channel: 'whatsapp', audience: '' });
  const { busy, error, run } = useAction();
  const defaultAudience = f.kind === 'invitation' ? 'not_yet_messaged' : 'not_responded';
  return (
    <Modal
      title="New campaign"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!f.name.trim()}
            onClick={async () => {
              const r = await run(() =>
                api.post(fnPath(ws, ev, fn.id, '/campaigns'), {
                  name: f.name,
                  kind: f.kind,
                  channel: f.channel,
                  audience: f.audience || defaultAudience,
                }),
              );
              if (r) onDone(r.id);
            }}
          >
            Create draft
          </Button>
        </>
      }
    >
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <TextField
        label="Name"
        placeholder={`${fn.name} reminder`}
        value={f.name}
        onChange={(v) => setF({ ...f, name: v })}
        error={error?.fieldError('name')}
        autoFocus
      />
      <div className="grid cols-2">
        <Field label="Type">
          {(id) => (
            <select id={id} className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, audience: '' })}>
              <option value="invitation">Invitation (with RSVP link)</option>
              <option value="reminder">Reminder to answer</option>
            </select>
          )}
        </Field>
        <Field label="Channel">
          {(id) => (
            <select id={id} className="input" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          )}
        </Field>
      </div>
      <Field label="Who">
        {(id) => (
          <select
            id={id}
            className="input"
            value={f.audience || defaultAudience}
            onChange={(e) => setF({ ...f, audience: e.target.value })}
          >
            <option value="not_yet_messaged">Not messaged yet</option>
            <option value="not_responded">Haven&apos;t answered</option>
            <option value="maybe">Answered “maybe”</option>
            <option value="all_invited">Everyone invited</option>
          </select>
        )}
      </Field>
      <p className="muted">Creating a draft sends nothing. You will review the recipients next.</p>
    </Modal>
  );
}

function CampaignPanel({
  ws,
  ev,
  fn,
  id,
  tz,
  role,
  attested,
  testMode,
  onClose,
}: {
  ws: string;
  ev: string;
  fn: any;
  id: string;
  tz: string;
  role: Role;
  attested: boolean;
  testMode: boolean;
  onClose: () => void;
}) {
  const base = fnPath(ws, ev, fn.id, `/campaigns/${id}`);
  const c = useLoad(() => api.get(base), [id]);
  const [status, setStatus] = useState('');
  const msgs = useLoad(() => api.get(`${base}/messages?limit=100${status ? `&status=${status}` : ''}`), [id, status, c.data?.status]);
  const [pv, setPv] = useState<any>(null);
  const [reviewed, setReviewed] = useState(false);
  const [when, setWhen] = useState('');
  const keyRef = useRef(newKey());
  const prev = useAction();
  const sched = useAction();
  const ctl = useAction();
  const toast = useToast();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [retry, setRetry] = useState<any>(null);
  const d = c.data;
  const canSend = roleCan.messaging(role);
  const preview = async () => {
    const r = await prev.run(() => api.post(`${base}/preview`));
    if (r) {
      setPv(r);
      setReviewed(false);
      keyRef.current = newKey();
    }
  };
  const schedule = async () => {
    const r = await sched.run(
      () =>
        api.post(
          `${base}/schedule`,
          {
            confirmRecipientCount: pv.eligibleCount,
            confirmEstimatedCostPaise: pv.estimatedCostPaise,
            ...(when ? { scheduledAt: when } : {}),
          },
          { idempotencyKey: keyRef.current },
        ),
      'Campaign scheduled',
    );
    if (r) {
      setPv(null);
      c.reload();
    } else if (sched.error?.code === 'CONFIRMATION_MISMATCH') await preview();
  };
  const control = async (a: 'pause' | 'resume') => {
    await ctl.run(() => api.post(`${base}/${a}`), a === 'pause' ? 'Paused' : 'Resumed');
    c.reload();
  };
  return (
    <Modal title={d?.name ?? 'Campaign'} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <ErrorBanner error={c.error} />
      {d && (
        <>
          <div className="row">
            <StatusPill status={d.status} />
            <Badge>{d.kind}</Badge>
            <Badge>{d.channel}</Badge>
            <Badge>{d.audience.replaceAll('_', ' ')}</Badge>
          </div>
          {d.status === 'draft' && (
            <div style={{ marginTop: '.8rem' }}>
              {!pv ? (
                <>
                  <p>Review who would receive this before anything is scheduled.</p>
                  <ErrorBanner error={prev.error} />
                  <Button variant="primary" busy={prev.busy} onClick={preview}>
                    Preview recipients
                  </Button>
                </>
              ) : (
                <>
                  <div className="banner ok">
                    <b>{pv.eligibleCount} guests will be messaged</b> · estimated cost {fmtRupees(pv.estimatedCostPaise)}
                    <br />
                    <small>{pv.costNote}</small>
                  </div>
                  {pv.messagingMode === 'fake' && (
                    <div className="banner info">Test mode: this goes to the sandbox provider only. Nobody is contacted.</div>
                  )}
                  {Object.keys(pv.excludedCounts).length > 0 && (
                    <div className="banner warn">
                      <b>Not included:</b>
                      <ul style={{ margin: '.3rem 0 0' }}>
                        {Object.entries(pv.excludedCounts).map(([k, v]) => (
                          <li key={k}>
                            {String(v)} × {REASONS[k] ?? k}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {pv.sample.length > 0 && (
                    <>
                      <h3>Message preview</h3>
                      {pv.sample.map((s: any, i: number) => (
                        <div key={i} className="card" style={{ marginBottom: '.5rem', background: 'var(--surface-2)' }}>
                          <small className="muted">
                            To {s.guestName} ({s.language === 'hi' ? 'Hindi' : 'English'})
                          </small>
                          <p style={{ margin: '.2rem 0 0', whiteSpace: 'pre-wrap' }}>{s.text}</p>
                        </div>
                      ))}
                    </>
                  )}
                  <details>
                    <summary>See recipients ({pv.recipients.length})</summary>
                    <ul className="list">
                      {pv.recipients.map((r: any) => (
                        <li key={r.invitationId} className="row between">
                          <span>
                            {r.guestName} <small className="muted">{r.contact}</small>
                          </span>
                          {r.eligible ? <Badge tone="ok">will receive</Badge> : <Badge tone="warn">{REASONS[r.reason] ?? r.reason}</Badge>}
                        </li>
                      ))}
                    </ul>
                  </details>
                  {pv.attestationRequired && !attested && (
                    <div className="banner warn">Confirm the one-time authority statement on the Messages tab first.</div>
                  )}
                  <Field
                    label="Send at (optional, event time)"
                    hint="Leave empty to send as soon as the worker picks it up (outside quiet hours)."
                  >
                    {(id) => (
                      <input id={id} className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                    )}
                  </Field>
                  <label className="check">
                    <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I have reviewed the
                    recipients, message and estimated cost.
                  </label>
                  <ErrorBanner error={sched.error} />
                  {canSend && (
                    <div className="row">
                      <Button
                        variant="primary"
                        busy={sched.busy}
                        disabled={!reviewed || pv.eligibleCount === 0 || !attested}
                        onClick={schedule}
                      >
                        Schedule {pv.eligibleCount} messages
                      </Button>
                      <Button onClick={preview}>Refresh preview</Button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {d.status !== 'draft' && (
            <>
              <div className="row" style={{ margin: '.8rem 0' }}>
                {Object.entries(d.stats).map(([k, v]) => (
                  <Badge key={k} tone={['delivered', 'read'].includes(k) ? 'ok' : k === 'failed' ? 'bad' : undefined}>
                    {String(v)} {k}
                  </Badge>
                ))}
                {d.scheduledAt && <small className="muted">scheduled {fmtDateTime(d.scheduledAt, tz)}</small>}
              </div>
              {Object.keys(d.skipReasons).length > 0 && (
                <p className="muted">
                  Skipped/cancelled:{' '}
                  {Object.entries(d.skipReasons)
                    .map(([k, v]) => `${v} ${REASONS[k] ?? k}`)
                    .join(', ')}
                </p>
              )}
              <ErrorBanner error={ctl.error} />
              {canSend && (
                <div className="row">
                  {['scheduled', 'running'].includes(d.status) && (
                    <Button onClick={() => control('pause')} busy={ctl.busy}>
                      Pause
                    </Button>
                  )}
                  {d.status === 'paused' && (
                    <Button variant="primary" onClick={() => control('resume')} busy={ctl.busy}>
                      Resume
                    </Button>
                  )}
                  {!['cancelled', 'completed'].includes(d.status) && (
                    <Button variant="danger" onClick={() => setConfirmCancel(true)}>
                      Cancel unsent
                    </Button>
                  )}
                </div>
              )}
              <h3 style={{ marginTop: '1rem' }}>Messages</h3>
              <select
                className="input"
                style={{ width: 'auto', marginBottom: '.5rem' }}
                aria-label="Filter messages"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All</option>
                {['scheduled', 'submitted', 'delivered', 'read', 'failed', 'unknown', 'skipped', 'cancelled'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <ul className="list">
                {(msgs.data?.data ?? []).map((m: any) => (
                  <li key={m.id}>
                    <div className="row between">
                      <div>
                        <b>{m.guestName}</b> <small className="muted">{m.contact}</small>
                        {(m.skipReason || m.lastErrorCode) && (
                          <div className="muted" style={{ fontSize: '.82rem' }}>
                            {m.skipReason ? (REASONS[m.skipReason] ?? m.skipReason) : m.lastErrorCode}
                            {m.attempts > 1 && ` · ${m.attempts} attempts`}
                          </div>
                        )}
                      </div>
                      <div className="row" style={{ gap: '.3rem' }}>
                        <MsgBadge status={m.status} />
                        {canSend && ['failed', 'unknown'].includes(m.status) && (
                          <Button size="sm" onClick={() => setRetry(m)}>
                            Retry
                          </Button>
                        )}
                        {testMode && roleCan.manage(role) && ['submitted', 'delivered'].includes(m.status) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              await api.post(`${base}/messages/${m.id}/simulate`, {
                                event: m.status === 'submitted' ? 'delivered' : 'read',
                              });
                              toast('Simulated');
                              msgs.reload();
                            }}
                          >
                            Simulate {m.status === 'submitted' ? 'delivered' : 'read'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
                {msgs.data && !msgs.data.data.length && <li className="muted">No messages.</li>}
              </ul>
            </>
          )}
        </>
      )}
      {confirmCancel && (
        <Confirm
          danger
          title="Cancel unsent messages?"
          confirmLabel="Cancel campaign"
          body="Messages not yet sent will not be sent. Messages already handed to the provider cannot be recalled."
          onConfirm={async () => {
            await api.post(`${base}/cancel`, {});
            c.reload();
          }}
          onClose={() => setConfirmCancel(false)}
        />
      )}
      {retry && (
        <RetryModal
          base={base}
          m={retry}
          onClose={() => setRetry(null)}
          onDone={() => {
            setRetry(null);
            msgs.reload();
            c.reload();
          }}
        />
      )}
    </Modal>
  );
}

function RetryModal({ base, m, onClose, onDone }: { base: string; m: any; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal
      title={`Retry message to ${m.guestName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              const r = await run(() => api.post(`${base}/messages/${m.id}/retry`, { reason }), 'Queued for retry');
              if (r) onDone();
            }}
          >
            Retry
          </Button>
        </>
      }
    >
      <p className="muted">
        Last result: {m.status}
        {m.lastErrorCode ? ` (${m.lastErrorCode})` : ''}. Eligibility is checked again before sending, and a message the provider already
        accepted is never sent twice.
      </p>
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <TextField label="Reason (required)" value={reason} onChange={setReason} error={error?.fieldError('reason')} />
    </Modal>
  );
}

function Inbox({ ws, onClose }: { ws: string; onClose: () => void }) {
  const inbox = useLoad(() => api.get(wsPath(ws, '/test-inbox')), [ws]);
  return (
    <Modal
      title="Test inbox (sandbox)"
      onClose={onClose}
      footer={
        <>
          <Button onClick={inbox.reload}>Refresh</Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="banner info">Messages captured by the sandbox provider. Open a guest link to try the guest experience.</div>
      <ErrorBanner error={inbox.error} />
      {inbox.data && !inbox.data.data.length && (
        <Empty title="Nothing sent yet">Schedule a campaign and wait a few seconds for the worker.</Empty>
      )}
      <ul className="list">
        {(inbox.data?.data ?? []).map((m: any) => {
          const link = /https?:\/\/[^\s]+\/r#[A-Za-z0-9_-]{43}/.exec(m.body ?? '')?.[0];
          const path = link ? link.replace(/^https?:\/\/[^/]+/, '') : null;
          return (
            <li key={m.providerMessageId}>
              <small className="muted">
                {m.channel} to {m.to} · {m.language}
              </small>
              <p style={{ margin: '.2rem 0', whiteSpace: 'pre-wrap' }}>{m.body ?? '(body not stored)'}</p>
              {path && (
                <a className="btn sm" href={path} target="_blank" rel="noreferrer">
                  Open guest link
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
