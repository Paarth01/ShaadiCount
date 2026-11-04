'use client';
import Link from 'next/link';
import { use } from 'react';
import { api, wsPath } from '@/lib/api';
import { roleCan } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useWorkspace } from '@/components/Shell';
import { Badge, Card, Empty, ErrorBanner, useLoad } from '@/components/ui';
import { StatusPill } from '@/components/StatusBadges';

export default function Overview({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  const { role, name } = useWorkspace();
  const { data, error, loading, reload } = useLoad(() => api.get(wsPath(workspaceId, '/events')), [workspaceId]);
  const events: any[] = data?.data ?? [];
  return (
    <div className="stack" id="main">
      <div>
        <h1>{name}</h1>
        <p className="muted">
          Signed in as <Badge tone="brand">{role.replace('_', ' ')}</Badge>
        </p>
      </div>
      <ErrorBanner error={error} onRetry={reload} />
      {role === 'checkin_staff' && (
        <div className="banner info">
          You can check guests in for the functions you are assigned to. Open an event, choose a function, then <b>Check-in mode</b>.
        </div>
      )}
      <div className="row between">
        <h2 style={{ margin: 0 }}>{role === 'checkin_staff' ? 'Your events' : 'Events'}</h2>
        {roleCan.createEvent(role) && (
          <Link className="btn primary" href={`/w/${workspaceId}/events?new=1`}>
            New event
          </Link>
        )}
      </div>
      {loading && <div className="skel" style={{ height: 96 }} />}
      {!loading && events.length === 0 && (
        <Card>
          <Empty title="No events yet">
            {roleCan.createEvent(role) ? (
              <p>Create your first event to start adding functions and guests.</p>
            ) : (
              <p>You have not been assigned to an event yet. Ask an owner to assign you.</p>
            )}
          </Empty>
        </Card>
      )}
      <div className="grid cols-2">
        {events.map((e) => (
          <Link key={e.id} href={`/w/${workspaceId}/events/${e.id}`} className="card card-link">
            <div className="row between">
              <h3 style={{ margin: 0 }}>{e.name}</h3>
              <StatusPill status={e.status} />
            </div>
            <p className="muted" style={{ margin: '.3rem 0 0' }}>
              {e.startDate ? fmtDate(e.startDate) : 'Dates not set'}
              {e.endDate && e.endDate !== e.startDate ? ` – ${fmtDate(e.endDate)}` : ''}
            </p>
            <p className="muted" style={{ margin: 0 }}>
              {e.functionCount} {e.functionCount === 1 ? 'function' : 'functions'} · {e.timezone}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
