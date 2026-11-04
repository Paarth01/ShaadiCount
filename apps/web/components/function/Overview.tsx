'use client';
import { api, fnPath } from '@/lib/api';
import { fmtDateTime, plural } from '@/lib/format';
import { roleCan, type Role } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBanner, Stat, useLoad } from '../ui';
import { ResponseBar } from '../StatusBadges';

export function OverviewTab({
  ws,
  ev,
  fn,
  tz,
  role,
  goto,
}: {
  ws: string;
  ev: string;
  fn: any;
  tz: string;
  role: Role;
  goto: (t: string) => void;
}) {
  const d = useLoad(() => api.get(fnPath(ws, ev, fn.id, '/dashboard')), [fn.id, fn.updatedAt]);
  const nr = useLoad(
    () => (roleCan.guests(role) ? api.get(fnPath(ws, ev, fn.id, '/non-responders?limit=25')) : Promise.resolve(null)),
    [fn.id],
  );
  const x = d.data;
  return (
    <div className="stack">
      <ErrorBanner error={d.error} onRetry={d.reload} />
      {d.loading && !x && <div className="skel" style={{ height: 120 }} />}
      {x && (
        <>
          <div className="grid cols-3">
            <Stat
              label="Confirmed people"
              value={x.people.confirmedTotal}
              hint={`${x.people.confirmedAdults} adults · ${x.people.confirmedChildren} children`}
            />
            <Stat
              label="Maybe (people)"
              value={x.people.tentativeTotal}
              hint={x.people.maybeWithoutCount ? `${x.people.maybeWithoutCount} without a headcount` : undefined}
            />
            <Stat label="Invitations awaiting" value={x.counts.notResponded} hint={`up to ${x.people.pendingMax} people`} />
            <Stat label="Response rate" value={`${x.responseRatePercent}%`} hint={`${x.counts.responded} of ${x.counts.invitations}`} />
          </div>
          <Card>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Answers</h3>
              <span className="muted">
                {x.counts.yes} yes · {x.counts.maybe} maybe · {x.counts.no} no
              </span>
            </div>
            <div style={{ margin: '.6rem 0' }}>
              <ResponseBar yes={x.counts.yes} maybe={x.counts.maybe} no={x.counts.no} />
            </div>
            <div className="row">
              {x.capacity !== null && (
                <Badge tone={x.capacityStatus === 'over' ? 'bad' : x.capacityStatus === 'at_risk' ? 'warn' : 'ok'}>
                  {x.capacityStatus === 'over'
                    ? `Over capacity (${x.people.confirmedTotal}/${x.capacity})`
                    : x.capacityStatus === 'at_risk'
                      ? `Could exceed capacity ${x.capacity}`
                      : `Within capacity ${x.capacity}`}
                </Badge>
              )}
              {x.rsvpDeadline && (
                <Badge tone={new Date(x.rsvpDeadline) < new Date() ? 'warn' : undefined}>RSVP by {fmtDateTime(x.rsvpDeadline, tz)}</Badge>
              )}
              {x.lastResponseAt && <span className="muted">Last answer {fmtDateTime(x.lastResponseAt, tz)}</span>}
            </div>
          </Card>
          {x.checkIn.invitations > 0 && (
            <Card>
              <b>Checked in so far:</b> {x.checkIn.people} people ({x.checkIn.adults} adults, {x.checkIn.children} children)
            </Card>
          )}
        </>
      )}
      {roleCan.guests(role) && (
        <Card>
          <div className="row between">
            <h3 style={{ margin: 0 }}>Haven&apos;t answered</h3>
            {roleCan.messaging(role) && !!nr.data?.total && (
              <Button size="sm" variant="primary" onClick={() => goto('messages')}>
                Send reminder
              </Button>
            )}
          </div>
          {nr.data && !nr.data.total && <Empty title="Everyone has answered">Nice work.</Empty>}
          <ul className="list">
            {(nr.data?.data ?? []).map((r: any) => (
              <li key={r.invitationId}>
                <div className="row between">
                  <div>
                    <b>{r.guestName}</b>
                    <div className="muted" style={{ fontSize: '.85rem' }}>
                      {r.group ?? 'No group'} · {r.phoneMasked ?? 'no phone'} · up to {plural(r.partySize, 'person', 'people')}
                    </div>
                  </div>
                  {r.lastMessageStatus && <Badge tone="info">{r.lastMessageStatus}</Badge>}
                </div>
              </li>
            ))}
          </ul>
          {nr.data && nr.data.total > 25 && (
            <p className="muted">Showing 25 of {nr.data.total}. Use the Invitations tab to see everyone.</p>
          )}
        </Card>
      )}
    </div>
  );
}
