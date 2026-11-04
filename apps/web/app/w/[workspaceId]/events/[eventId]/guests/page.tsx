'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { api, evPath } from '@/lib/api';
import { roleCan } from '@/lib/auth';
import { useWorkspace } from '@/components/Shell';
import { Badge, Button, Card, Confirm, Empty, ErrorBanner, useLoad } from '@/components/ui';
import { ConsentModal, GuestFormModal, ImportWizard, InviteModal } from '@/components/GuestTools';
import { IPlus, ISearch, IUpload } from '@/components/icons';
import { RsvpBadge } from '@/components/StatusBadges';

export default function GuestsPage({ params }: { params: Promise<{ workspaceId: string; eventId: string }> }) {
  const { workspaceId: ws, eventId } = use(params);
  const { role } = useWorkspace();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [groupId, setGroupId] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);
  const ev = useLoad(() => api.get(evPath(ws, eventId)), [ws, eventId]);
  const groups = useLoad(() => api.get(evPath(ws, eventId, '/guest-groups')), [ws, eventId]);
  const list = useLoad(
    () =>
      api.get(
        evPath(
          ws,
          eventId,
          `/guests?limit=50&page=${page}${q ? `&search=${encodeURIComponent(q)}` : ''}${groupId ? `&groupId=${groupId}` : ''}`,
        ),
      ),
    [ws, eventId, q, groupId, page],
  );
  const [modal, setModal] = useState<null | 'add' | 'import' | 'consent' | 'invite'>(null);
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const guests: any[] = list.data?.data ?? [];
  const fns: any[] = ev.data?.functions ?? [];
  const fnName = Object.fromEntries(fns.map((f) => [f.id, f.name]));
  const canWrite = roleCan.guests(role);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const reload = () => {
    list.reload();
    groups.reload();
  };
  if (!canWrite)
    return (
      <div className="banner warn" id="main">
        Your role does not include access to the guest list.
      </div>
    );
  return (
    <div className="stack" id="main">
      <div>
        <p className="muted" style={{ margin: 0 }}>
          <Link href={`/w/${ws}/events/${eventId}`}>{ev.data?.name ?? 'Event'}</Link> /
        </p>
        <h1>Guests</h1>
      </div>
      <div className="row">
        <Button variant="primary" onClick={() => setModal('add')}>
          <IPlus /> Add guest
        </Button>
        <Button onClick={() => setModal('import')}>
          <IUpload /> Import CSV
        </Button>
      </div>
      <div className="row">
        <div className="grow" style={{ position: 'relative' }}>
          <input
            className="input"
            type="search"
            placeholder="Search guests"
            aria-label="Search guests"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36 }}
          />
          <span style={{ position: 'absolute', left: 10, top: 12, color: 'var(--muted)' }}>
            <ISearch />
          </span>
        </div>
        <select
          className="input"
          style={{ width: 'auto' }}
          aria-label="Filter by group"
          value={groupId}
          onChange={(e) => {
            setGroupId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All groups</option>
          {(groups.data?.data ?? []).map((g: any) => (
            <option key={g.id} value={g.id}>
              {g.label} ({g.guestCount})
            </option>
          ))}
        </select>
      </div>
      <ErrorBanner error={list.error ?? ev.error} onRetry={reload} />
      {list.loading && !list.data && <div className="skel" style={{ height: 120 }} />}
      {!list.loading && !guests.length && (
        <Card>
          <Empty title={q || groupId ? 'No guests match' : 'No guests yet'}>
            {!q && !groupId && 'Add guests one by one or import a spreadsheet exported as CSV.'}
          </Empty>
        </Card>
      )}
      <Card style={{ padding: '.2rem 1rem' }}>
        <ul className="list">
          {guests.map((g) => (
            <li key={g.id}>
              <div className="row top">
                <input
                  type="checkbox"
                  aria-label={`Select ${g.displayName}`}
                  style={{ width: 22, height: 22, marginTop: 8, accentColor: 'var(--brand)' }}
                  checked={selected.has(g.id)}
                  onChange={() => toggle(g.id)}
                />
                <div className="grow">
                  <div className="row between">
                    <b>{g.displayName}</b>
                    <div className="row" style={{ gap: '.3rem' }}>
                      {g.consents?.whatsapp === 'granted' ? (
                        <Badge tone="ok">WhatsApp OK</Badge>
                      ) : g.consents?.whatsapp === 'revoked' ? (
                        <Badge tone="bad">Opted out</Badge>
                      ) : (
                        <Badge>No permission yet</Badge>
                      )}
                    </div>
                  </div>
                  <div className="muted" style={{ fontSize: '.88rem' }}>
                    {g.group?.label ?? 'No group'} · {g.phoneMasked ?? 'no phone'} · {g.language === 'hi' ? 'हिन्दी' : 'English'}
                  </div>
                  <div className="row" style={{ gap: '.3rem', marginTop: '.35rem' }}>
                    {g.invitations.map((i: any) => (
                      <span key={i.invitationId} className="row" style={{ gap: '.25rem' }}>
                        <small>{fnName[i.functionId] ?? 'Function'}</small>
                        <RsvpBadge status={i.status === 'pending' ? null : i.status} />
                      </span>
                    ))}
                    {!g.invitations.length && <small className="muted">Not invited to any function</small>}
                  </div>
                </div>
                <div className="row" style={{ gap: '.25rem' }}>
                  <Button size="sm" onClick={() => setEditing(g)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(g)} aria-label={`Delete ${g.displayName}`}>
                    Delete
                  </Button>
                </div>
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
              Page {page} of {Math.ceil(list.data.total / 50)} · {list.data.total} guests
            </span>
            <Button size="sm" disabled={page * 50 >= list.data.total} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </div>
        )}
      </Card>
      {selected.size > 0 && (
        <div
          className="card"
          style={{
            position: 'sticky',
            bottom: 'calc(var(--nav-h) + .5rem)',
            display: 'flex',
            gap: '.5rem',
            flexWrap: 'wrap',
            alignItems: 'center',
            zIndex: 20,
          }}
        >
          <b>{selected.size} selected</b>
          <Button size="sm" onClick={() => setModal('invite')}>
            Invite to function
          </Button>
          <Button size="sm" onClick={() => setModal('consent')}>
            Record permission
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
        </div>
      )}
      {modal === 'add' && (
        <GuestFormModal
          ws={ws}
          eventId={eventId}
          functions={fns}
          groups={groups.data?.data ?? []}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            reload();
          }}
        />
      )}
      {editing && (
        <GuestFormModal
          ws={ws}
          eventId={eventId}
          functions={fns}
          guest={editing}
          groups={groups.data?.data ?? []}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {modal === 'import' && (
        <ImportWizard
          ws={ws}
          eventId={eventId}
          onClose={() => setModal(null)}
          onDone={reload}
          onRecordConsent={() => {
            setSelected(new Set(guests.map((g) => g.id)));
            setModal('consent');
          }}
        />
      )}
      {modal === 'consent' && (
        <ConsentModal
          ws={ws}
          eventId={eventId}
          guestIds={[...selected]}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            setSelected(new Set());
            reload();
          }}
        />
      )}
      {modal === 'invite' && (
        <InviteModal
          ws={ws}
          eventId={eventId}
          functions={fns}
          guestIds={[...selected]}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            setSelected(new Set());
            reload();
          }}
        />
      )}
      {deleting && (
        <Confirm
          danger
          title="Delete this guest?"
          confirmLabel="Delete guest"
          body={`${deleting.displayName}'s name and contact details will be erased and their invitation links stop working. Anonymous RSVP counts are kept. Opt-out records are never deleted.`}
          onConfirm={async () => {
            await api.del(evPath(ws, eventId, `/guests/${deleting.id}`));
            reload();
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
