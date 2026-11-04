'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { api, evPath } from '@/lib/api';
import { roleCan } from '@/lib/auth';
import { fmtDate, fmtDateTime, plural } from '@/lib/format';
import { useWorkspace } from '@/components/Shell';
import { Button, Card, Confirm, Empty, ErrorBanner, useLoad } from '@/components/ui';
import { ResponseBar, StatusPill } from '@/components/StatusBadges';
import { FunctionModal } from '@/components/FunctionModal';

export default function EventPage({ params }: { params: Promise<{ workspaceId: string; eventId: string }> }) {
  const { workspaceId: ws, eventId } = use(params);
  const { role } = useWorkspace();
  const ev = useLoad(() => api.get(evPath(ws, eventId)), [ws, eventId]);
  const dash = useLoad(
    () => (roleCan.dashboard(role) ? api.get(evPath(ws, eventId, '/dashboard')) : Promise.resolve(null)),
    [ws, eventId, role],
  );
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<null | 'completed' | 'cancelled' | 'archived'>(null);
  const e = ev.data;
  const byFn: Record<string, any> = Object.fromEntries((dash.data?.functions ?? []).map((f: any) => [f.functionId, f]));
  const reloadAll = () => {
    ev.reload();
    dash.reload();
  };
  return (
    <div className="stack" id="main">
      <ErrorBanner error={ev.error} onRetry={ev.reload} />
      {ev.loading && !e && <div className="skel" style={{ height: 80 }} />}
      {e && (
        <>
          <div className="row between top">
            <div>
              <p className="muted" style={{ margin: 0 }}>
                <Link href={`/w/${ws}/events`}>Events</Link> /
              </p>
              <h1 style={{ margin: 0 }}>{e.name}</h1>
              <p className="muted">
                {e.startDate ? fmtDate(e.startDate) : 'Dates not set'}
                {e.endDate && e.endDate !== e.startDate ? ` – ${fmtDate(e.endDate)}` : ''} · {e.timezone} {e.hostName && `· ${e.hostName}`}
              </p>
            </div>
            <StatusPill status={e.status} />
          </div>
          <div className="row">
            {roleCan.guests(role) && (
              <Link className="btn primary" href={`/w/${ws}/events/${eventId}/guests`}>
                Guests
              </Link>
            )}
            {roleCan.edit(role) && <Button onClick={() => setAdding(true)}>Add function</Button>}
            {roleCan.createEvent(role) && e.status !== 'completed' && (
              <Button onClick={() => setConfirm('completed')}>Mark completed</Button>
            )}
            {roleCan.createEvent(role) && e.status !== 'cancelled' && (
              <Button variant="ghost" onClick={() => setConfirm('cancelled')}>
                Cancel event
              </Button>
            )}
            {roleCan.createEvent(role) && e.status !== 'archived' && (
              <Button variant="ghost" onClick={() => setConfirm('archived')}>
                Archive
              </Button>
            )}
          </div>
          <h2>Functions</h2>
          {!e.functions.length && (
            <Card>
              <Empty title="No functions yet">
                Add each ceremony separately (Mehendi, Sangeet, Wedding…) so guests can answer function by function.
              </Empty>
            </Card>
          )}
          <div className="grid cols-2">
            {e.functions.map((f: any) => {
              const d = byFn[f.id];
              return (
                <Link key={f.id} href={`/w/${ws}/events/${eventId}/functions/${f.id}`} className="card card-link">
                  <div className="row between">
                    <h3 style={{ margin: 0 }}>{f.name}</h3>
                    <StatusPill status={f.status} />
                  </div>
                  <p className="muted" style={{ margin: '.25rem 0' }}>
                    {fmtDateTime(f.startsAt, e.timezone)}
                    {f.venue && ` · ${f.venue}`}
                  </p>
                  {d ? (
                    <>
                      <div className="row between" style={{ margin: '.5rem 0 .3rem' }}>
                        <b>{d.people.confirmedTotal} confirmed</b>
                        <span className="muted">{plural(d.counts.notResponded, 'invite')} awaiting</span>
                      </div>
                      <ResponseBar yes={d.counts.yes} maybe={d.counts.maybe} no={d.counts.no} />
                      <p className="muted" style={{ margin: '.4rem 0 0', fontSize: '.85rem' }}>
                        {d.counts.yes} yes · {d.counts.maybe} maybe · {d.counts.no} no{d.capacity !== null && ` · capacity ${d.capacity}`}
                      </p>
                      {d.capacityStatus === 'over' && <p className="err">Over capacity</p>}
                    </>
                  ) : (
                    f.rsvpDeadline && (
                      <p className="muted" style={{ margin: 0 }}>
                        RSVP by {fmtDateTime(f.rsvpDeadline, e.timezone)}
                      </p>
                    )
                  )}
                </Link>
              );
            })}
          </div>
          {adding && (
            <FunctionModal
              ws={ws}
              eventId={eventId}
              onClose={() => setAdding(false)}
              onDone={() => {
                setAdding(false);
                reloadAll();
              }}
            />
          )}
          {confirm && (
            <Confirm
              title={`${confirm === 'completed' ? 'Mark event completed' : confirm === 'cancelled' ? 'Cancel event' : 'Archive event'}?`}
              danger={confirm !== 'completed'}
              confirmLabel="Yes, continue"
              body={
                confirm === 'cancelled'
                  ? 'Guests will see that RSVPs are closed and no more messages will be sent.'
                  : confirm === 'completed'
                    ? 'RSVPs close and reports are marked final once functions are completed.'
                    : 'The event is hidden from the default list. You can still open it.'
              }
              onConfirm={async () => {
                await api.patch(evPath(ws, eventId), { status: confirm });
                reloadAll();
              }}
              onClose={() => setConfirm(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
