'use client';
import Link from 'next/link';
import { use, useState } from 'react';
import { api, evPath } from '@/lib/api';
import { roleCan } from '@/lib/auth';
import { fmtDateTime } from '@/lib/format';
import { useWorkspace } from '@/components/Shell';
import { Button, ErrorBanner, Tabs, useLoad } from '@/components/ui';
import { StatusPill } from '@/components/StatusBadges';
import { OverviewTab } from '@/components/function/Overview';
import { InvitationsTab } from '@/components/function/Invitations';
import { MessagesTab } from '@/components/function/Messages';
import { CateringTab } from '@/components/function/Catering';
import { CheckInTab } from '@/components/function/CheckInSummary';
import { FunctionModal } from '@/components/FunctionModal';

export default function FunctionPage({ params }: { params: Promise<{ workspaceId: string; eventId: string; functionId: string }> }) {
  const { workspaceId: ws, eventId: ev, functionId } = use(params);
  const { role } = useWorkspace();
  const event = useLoad(() => api.get(evPath(ws, ev)), [ws, ev]);
  const fnq = useLoad(() => api.get(evPath(ws, ev, `/functions/${functionId}`)), [ws, ev, functionId]);
  const tabs = [
    roleCan.dashboard(role) && { id: 'overview', label: 'RSVPs' },
    roleCan.guests(role) && { id: 'invitations', label: 'Invitations' },
    roleCan.messaging(role) && { id: 'messages', label: 'Messages' },
    roleCan.catering(role) && { id: 'catering', label: 'Catering' },
    roleCan.checkin(role) && { id: 'checkin', label: 'Check-in' },
  ].filter(Boolean) as { id: string; label: string }[];
  const [tab, setTab] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const fn = fnq.data;
  const tz = event.data?.timezone ?? 'Asia/Kolkata';
  const active = tab || tabs[0]?.id;
  return (
    <div className="stack" id="main">
      <ErrorBanner
        error={fnq.error ?? event.error}
        onRetry={() => {
          fnq.reload();
          event.reload();
        }}
      />
      {fnq.loading && !fn && <div className="skel" style={{ height: 70 }} />}
      {fn && (
        <>
          <div className="row between top">
            <div>
              <p className="muted" style={{ margin: 0 }}>
                <Link href={`/w/${ws}/events/${ev}`}>{event.data?.name ?? 'Event'}</Link> /
              </p>
              <h1 style={{ margin: 0 }}>{fn.name}</h1>
              <p className="muted">
                {fmtDateTime(fn.startsAt, tz)}
                {fn.venue && ` · ${fn.venue}`}
                {fn.rsvpDeadline && ` · RSVP by ${fmtDateTime(fn.rsvpDeadline, tz)}`}
              </p>
            </div>
            <div className="row">
              <StatusPill status={fn.status} />
              {roleCan.edit(role) && (
                <Button size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>
          </div>
          {!tabs.length ? (
            <div className="banner warn">Your role does not include any views for this function.</div>
          ) : (
            <>
              <Tabs tabs={tabs as any} value={active as any} onChange={setTab} />
              {active === 'overview' && <OverviewTab ws={ws} ev={ev} fn={fn} tz={tz} role={role} goto={setTab} />}
              {active === 'invitations' && <InvitationsTab ws={ws} ev={ev} fn={fn} tz={tz} role={role} />}
              {active === 'messages' && <MessagesTab ws={ws} ev={ev} fn={fn} tz={tz} role={role} />}
              {active === 'catering' && <CateringTab ws={ws} ev={ev} fn={fn} tz={tz} role={role} />}
              {active === 'checkin' && <CheckInTab ws={ws} ev={ev} fn={fn} canCheckIn={roleCan.checkin(role)} />}
            </>
          )}
          {editing && (
            <FunctionModal
              ws={ws}
              eventId={ev}
              fn={fn}
              onClose={() => setEditing(false)}
              onDone={() => {
                setEditing(false);
                fnq.reload();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
