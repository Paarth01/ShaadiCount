'use client';
import Link from 'next/link';
import { api, fnPath } from '@/lib/api';
import { Badge, Card, ErrorBanner, Stat, useLoad } from '../ui';

export function CheckInTab({ ws, ev, fn, canCheckIn }: { ws: string; ev: string; fn: any; canCheckIn: boolean }) {
  const r = useLoad(() => api.get(fnPath(ws, ev, fn.id, '/checkin/reconciliation')), [fn.id]);
  const x = r.data;
  return (
    <div className="stack">
      {canCheckIn && (
        <Link className="btn primary" href={`/w/${ws}/events/${ev}/functions/${fn.id}/checkin`}>
          Open check-in mode
        </Link>
      )}
      <ErrorBanner error={r.error} onRetry={r.reload} />
      {x && (
        <>
          {x.partial && <div className="banner warn">{x.label}</div>}
          <div className="grid cols-3">
            <Stat label="Said yes (people)" value={x.rsvpYesPeople} />
            <Stat label="Checked in" value={x.checkedInPeople} hint={`${x.checkedInAdults} adults · ${x.checkedInChildren} children`} />
            <Stat label="Yes, not arrived" value={x.yesNotYetArrived} />
            <Stat label="Arrived without Yes" value={x.arrivedWithoutYes} />
          </div>
          <Card>
            <div className="row between">
              <span>Attendance vs confirmed</span>
              <Badge tone={x.partial ? 'warn' : 'info'}>
                {x.attendanceRatePercent}% {x.partial ? '(partial)' : '(final)'}
              </Badge>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
