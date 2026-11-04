'use client';
import { useEffect, useState } from 'react';
import { ApiError, api, evPath, fnPath } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { Role } from '@/lib/auth';
import { roleCan } from '@/lib/auth';
import { Badge, Button, Card, Confirm, CopyButton, Empty, ErrorBanner, Field, Modal, TextField, useAction, useLoad, useToast } from '../ui';
import { MsgBadge, RsvpBadge } from '../StatusBadges';

export function InvitationsTab({ ws, ev, fn, tz, role }: { ws: string; ev: string; fn: any; tz: string; role: Role }) {
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const list = useLoad(
    () =>
      api.get(fnPath(ws, ev, fn.id, `/invitations?status=${status}&limit=50&page=${page}${q ? `&search=${encodeURIComponent(q)}` : ''}`)),
    [fn.id, status, q, page],
  );
  const [inviting, setInviting] = useState(false);
  const [fix, setFix] = useState<any>(null);
  const [hist, setHist] = useState<any>(null);
  const [revoke, setRevoke] = useState<any>(null);
  const [rotate, setRotate] = useState<any>(null);
  const [size, setSize] = useState<any>(null);
  const [link, setLink] = useState<string | null>(null);
  const canEdit = roleCan.edit(role);
  const toast = useToast();
  const rows: any[] = list.data?.data ?? [];
  const act = async (fnc: () => Promise<unknown>, ok: string) => {
    try {
      await fnc();
      toast(ok);
      list.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Failed', 'bad');
    }
  };
  return (
    <div className="stack">
      <div className="row">
        {canEdit && (
          <Button variant="primary" onClick={() => setInviting(true)}>
            Invite guests
          </Button>
        )}
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          {[
            ['all', 'Everyone'],
            ['yes', 'Yes'],
            ['maybe', 'Maybe'],
            ['no', 'No'],
            ['not_responded', 'Not answered'],
            ['revoked', 'Revoked'],
          ].map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <input
          className="input grow"
          type="search"
          placeholder="Search by name"
          aria-label="Search invitations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <ErrorBanner error={list.error} onRetry={list.reload} />
      {list.loading && !list.data && <div className="skel" style={{ height: 120 }} />}
      {!list.loading && !rows.length && (
        <Card>
          <Empty title="No invitations">
            {status === 'all' ? 'Invite guests to this function to get personal RSVP links.' : 'Nothing matches this filter.'}
          </Empty>
        </Card>
      )}
      <Card style={{ padding: '.2rem 1rem' }}>
        <ul className="list">
          {rows.map((i) => (
            <li key={i.id}>
              <div className="row between top">
                <div>
                  <b>{i.guestName}</b>
                  <div className="muted" style={{ fontSize: '.85rem' }}>
                    {i.group ?? 'No group'} · {i.phoneMasked ?? 'no phone'} · up to {i.partySize}
                  </div>
                </div>
                <div className="row" style={{ gap: '.3rem' }}>
                  <RsvpBadge status={i.status === 'revoked' ? 'revoked' : i.response?.status} />
                  {i.checkedIn && <Badge tone="ok">Checked in</Badge>}
                  <MsgBadge status={i.lastMessageStatus} />
                </div>
              </div>
              {i.response && (
                <p style={{ margin: '.3rem 0 0' }}>
                  {i.response.adultCount} adults{fn.allowChildren ? `, ${i.response.childCount} children` : ''}{' '}
                  <small className="muted">
                    · {i.response.lastActor === 'organizer' ? 'set by organizer' : 'answered'} {fmtDateTime(i.response.respondedAt, tz)}
                  </small>
                </p>
              )}
              <div className="row" style={{ marginTop: '.5rem', gap: '.3rem' }}>
                {canEdit && i.status !== 'revoked' && (
                  <CopyButton
                    label="Copy link"
                    text={async () => (await api.get(fnPath(ws, ev, fn.id, `/invitations/${i.id}/link`))).link}
                  />
                )}
                {canEdit && i.status !== 'revoked' && (
                  <Button size="sm" onClick={() => setFix(i)}>
                    Correct answer
                  </Button>
                )}
                <Button size="sm" onClick={() => setHist(i)}>
                  History
                </Button>
                {canEdit && i.status !== 'revoked' && (
                  <Button size="sm" onClick={() => setSize(i)}>
                    Party size
                  </Button>
                )}
                {canEdit && i.status !== 'revoked' && (
                  <Button size="sm" variant="ghost" onClick={() => setRotate(i)}>
                    New link
                  </Button>
                )}
                {canEdit &&
                  (i.status === 'revoked' ? (
                    <Button
                      size="sm"
                      onClick={() => act(() => api.post(fnPath(ws, ev, fn.id, `/invitations/${i.id}/restore`)), 'Restored')}
                    >
                      Restore
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setRevoke(i)}>
                      Revoke
                    </Button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
        {list.data && list.data.total > 50 && (
          <div className="row between" style={{ padding: '.6rem 0' }}>
            <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <span className="muted">
              Page {page} · {list.data.total} total
            </span>
            <Button size="sm" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </Card>
      {inviting && (
        <InviteGuests
          ws={ws}
          ev={ev}
          fn={fn}
          onClose={() => setInviting(false)}
          onDone={() => {
            setInviting(false);
            list.reload();
          }}
        />
      )}
      {fix && (
        <CorrectModal
          ws={ws}
          ev={ev}
          fn={fn}
          inv={fix}
          onClose={() => setFix(null)}
          onDone={() => {
            setFix(null);
            list.reload();
          }}
        />
      )}
      {hist && <HistoryModal ws={ws} ev={ev} fn={fn} inv={hist} tz={tz} onClose={() => setHist(null)} />}
      {size && (
        <SizeModal
          ws={ws}
          ev={ev}
          fn={fn}
          inv={size}
          onClose={() => setSize(null)}
          onDone={() => {
            setSize(null);
            list.reload();
          }}
        />
      )}
      {revoke && (
        <Confirm
          danger
          title={`Revoke ${revoke.guestName}'s invitation?`}
          confirmLabel="Revoke"
          body="Their link stops working immediately and any unsent messages to them are cancelled. Their previous answer is kept in history."
          onConfirm={async () => {
            await api.post(fnPath(ws, ev, fn.id, `/invitations/${revoke.id}/revoke`), {});
            list.reload();
          }}
          onClose={() => setRevoke(null)}
        />
      )}
      {rotate && (
        <Confirm
          title={`Create a new link for ${rotate.guestName}?`}
          confirmLabel="Create new link"
          body="The old link and QR code stop working at once. Use this if the link was shared with the wrong person."
          onConfirm={async () => {
            const r = await api.post(fnPath(ws, ev, fn.id, `/invitations/${rotate.id}/rotate-token`), { reason: 'Rotated by organizer' });
            setLink(r.link);
          }}
          onClose={() => setRotate(null)}
        />
      )}
      {link && (
        <Modal
          title="New link"
          onClose={() => setLink(null)}
          footer={
            <>
              <CopyButton text={() => link} />
              <Button variant="primary" onClick={() => setLink(null)}>
                Done
              </Button>
            </>
          }
        >
          <p>Send this link to the guest. It is shown only now.</p>
          <code style={{ wordBreak: 'break-all' }}>{link}</code>
        </Modal>
      )}
    </div>
  );
}

function InviteGuests({ ws, ev, fn, onClose, onDone }: { ws: string; ev: string; fn: any; onClose: () => void; onDone: () => void }) {
  const all = useLoad(() => api.get(evPath(ws, ev, '/guests?limit=200')), [ev]);
  const inv = useLoad(() => api.get(fnPath(ws, ev, fn.id, '/invitations?limit=200')), [fn.id]);
  const invited = new Set((inv.data?.data ?? []).map((i: any) => i.guestId));
  const candidates = (all.data?.data ?? []).filter((g: any) => !invited.has(g.id));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [size, setSize] = useState(1);
  const { busy, error, run } = useAction();
  const toast = useToast();
  return (
    <Modal
      title={`Invite to ${fn.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!sel.size}
            onClick={async () => {
              const r = await run(() =>
                api.post(fnPath(ws, ev, fn.id, '/invitations'), { invites: [...sel].map((guestId) => ({ guestId, partySize: size })) }),
              );
              if (r) {
                toast(`${r.createdCount} invited`);
                onDone();
              }
            }}
          >
            Invite {sel.size || ''}
          </Button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <TextField
        label="People per invitation"
        type="number"
        min={1}
        max={50}
        value={String(size)}
        onChange={(v) => setSize(Math.max(1, Number(v) || 1))}
      />
      {all.loading && <div className="skel" style={{ height: 60 }} />}
      {!all.loading && !candidates.length && <Empty title="Everyone is already invited">Add more guests on the Guests page.</Empty>}
      {!!candidates.length && (
        <>
          <label className="check">
            <input
              type="checkbox"
              checked={sel.size === candidates.length}
              onChange={(e) => setSel(e.target.checked ? new Set(candidates.map((g: any) => g.id)) : new Set())}
            />{' '}
            Select all ({candidates.length})
          </label>
          <div style={{ maxHeight: '40dvh', overflow: 'auto' }}>
            {candidates.map((g: any) => (
              <label key={g.id} className="check">
                <input
                  type="checkbox"
                  checked={sel.has(g.id)}
                  onChange={() =>
                    setSel((s) => {
                      const n = new Set(s);
                      if (n.has(g.id)) n.delete(g.id);
                      else n.add(g.id);
                      return n;
                    })
                  }
                />
                {g.displayName} <small className="muted">{g.group?.label}</small>
              </label>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

function CorrectModal({
  ws,
  ev,
  fn,
  inv,
  onClose,
  onDone,
}: {
  ws: string;
  ev: string;
  fn: any;
  inv: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [status, setStatus] = useState(inv.response?.status ?? 'yes');
  const [adults, setAdults] = useState(inv.response?.adultCount ?? 1);
  const [children, setChildren] = useState(inv.response?.childCount ?? 0);
  const [reason, setReason] = useState('');
  const [exceed, setExceed] = useState(false);
  const { busy, error, run } = useAction();
  const over = status !== 'no' && adults + children > inv.partySize;
  return (
    <Modal
      title={`Correct ${inv.guestName}'s answer`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={reason.trim().length < 3 || (over && !exceed)}
            onClick={async () => {
              const r = await run(
                () =>
                  api.put(fnPath(ws, ev, fn.id, `/invitations/${inv.id}/response`), {
                    status,
                    adultCount: adults,
                    childCount: children,
                    reason,
                    allowExceedPartySize: exceed,
                    version: inv.response?.version ?? 0,
                  }),
                'Answer corrected',
              );
              if (r) onDone();
            }}
          >
            Save correction
          </Button>
        </>
      }
    >
      <div className="banner info">
        Use this when a guest told you their answer another way. It is recorded in the history and audit log with your reason.
      </div>
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <div className="seg" role="group" aria-label="Answer" style={{ marginBottom: '.8rem' }}>
        {['yes', 'maybe', 'no'].map((s) => (
          <button key={s} type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === 'yes' ? 'Yes' : s === 'no' ? 'No' : 'Maybe'}
          </button>
        ))}
      </div>
      {status !== 'no' && (
        <div className="grid cols-2">
          <TextField label="Adults" type="number" min={0} value={String(adults)} onChange={(v) => setAdults(Math.max(0, Number(v) || 0))} />
          {fn.allowChildren && (
            <TextField
              label="Children"
              type="number"
              min={0}
              value={String(children)}
              onChange={(v) => setChildren(Math.max(0, Number(v) || 0))}
            />
          )}
        </div>
      )}
      {over && (
        <label className="check">
          <input type="checkbox" checked={exceed} onChange={(e) => setExceed(e.target.checked)} /> Allow more than the invited{' '}
          {inv.partySize} people
        </label>
      )}
      <TextField
        label="Reason (required)"
        value={reason}
        onChange={setReason}
        error={error?.fieldError('reason')}
        placeholder="Guest phoned to confirm"
      />
    </Modal>
  );
}

function HistoryModal({ ws, ev, fn, inv, tz, onClose }: { ws: string; ev: string; fn: any; inv: any; tz: string; onClose: () => void }) {
  const h = useLoad(() => api.get(fnPath(ws, ev, fn.id, `/invitations/${inv.id}/history`)), [inv.id]);
  return (
    <Modal title={`${inv.guestName}: answer history`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      <ErrorBanner error={h.error} />
      {h.data && !h.data.data.length && <Empty title="No answer yet" />}
      <ul className="list">
        {(h.data?.data ?? []).map((e: any) => (
          <li key={e.version}>
            <div className="row between">
              <b>{e.previousStatus ? `${e.previousStatus} → ${e.newStatus}` : `Answered ${e.newStatus}`}</b>
              <small className="muted">{fmtDateTime(e.at, tz)}</small>
            </div>
            <div className="muted">
              {e.newCounts.adults} adults, {e.newCounts.children} children · by{' '}
              {e.actorType === 'guest' ? 'the guest' : `organizer${e.actorName ? ` (${e.actorName})` : ''}`}
              {e.reason ? ` · “${e.reason}”` : ''}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function SizeModal({
  ws,
  ev,
  fn,
  inv,
  onClose,
  onDone,
}: {
  ws: string;
  ev: string;
  fn: any;
  inv: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [n, setN] = useState(inv.partySize);
  const { busy, error, run } = useAction();
  return (
    <Modal
      title={`${inv.guestName}: invited people`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={async () => {
              const r = await run(() => api.patch(fnPath(ws, ev, fn.id, `/invitations/${inv.id}`), { partySize: n }), 'Updated');
              if (r) onDone();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <Field label="Maximum people this invitation covers">
        {(id) => (
          <input
            id={id}
            className="input"
            type="number"
            min={1}
            max={50}
            value={n}
            onChange={(e) => setN(Math.max(1, Number(e.target.value) || 1))}
          />
        )}
      </Field>
    </Modal>
  );
}
