'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, use, useState } from 'react';
import { api, wsPath } from '@/lib/api';
import { roleCan } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { useWorkspace } from '@/components/Shell';
import { Button, Card, Empty, ErrorBanner, Field, Modal, TextField, useAction, useLoad } from '@/components/ui';
import { StatusPill } from '@/components/StatusBadges';

const ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
];

function EventsInner({ workspaceId }: { workspaceId: string }) {
  const { role } = useWorkspace();
  const sp = useSearchParams();
  const router = useRouter();
  const [creating, setCreating] = useState(sp.get('new') === '1');
  const [archived, setArchived] = useState(false);
  const { data, error, loading, reload } = useLoad(
    () => api.get(wsPath(workspaceId, `/events?includeArchived=${archived}`)),
    [workspaceId, archived],
  );
  const events: any[] = data?.data ?? [];
  return (
    <div className="stack" id="main">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Events</h1>
        {roleCan.createEvent(role) && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New event
          </Button>
        )}
      </div>
      <label className="check">
        <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
      </label>
      <ErrorBanner error={error} onRetry={reload} />
      {loading && <div className="skel" style={{ height: 90 }} />}
      {!loading && !events.length && (
        <Card>
          <Empty title="No events">Create an event to add functions like Mehendi, Sangeet and the wedding ceremony.</Empty>
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
              {e.startDate ? fmtDate(e.startDate) : 'Dates not set'} · {e.functionCount} functions
            </p>
          </Link>
        ))}
      </div>
      {creating && (
        <CreateEvent
          workspaceId={workspaceId}
          onClose={() => {
            setCreating(false);
            router.replace(`/w/${workspaceId}/events`);
          }}
          onDone={(id) => router.push(`/w/${workspaceId}/events/${id}`)}
        />
      )}
    </div>
  );
}

function CreateEvent({ workspaceId, onClose, onDone }: { workspaceId: string; onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ name: '', timezone: 'Asia/Kolkata', startDate: '', endDate: '', hostName: '' });
  const { busy, error, run } = useAction();
  const submit = async () => {
    const r = await run(() =>
      api.post(wsPath(workspaceId, '/events'), {
        name: f.name,
        timezone: f.timezone,
        startDate: f.startDate || null,
        endDate: f.endDate || null,
        hostName: f.hostName || null,
      }),
    );
    if (r) onDone(r.id);
  };
  return (
    <Modal
      title="New event"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={submit} disabled={!f.name.trim()}>
            Create event
          </Button>
        </>
      }
    >
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <TextField
        label="Event name"
        placeholder="Aarav & Diya's Wedding"
        value={f.name}
        onChange={(v) => setF({ ...f, name: v })}
        error={error?.fieldError('name')}
        autoFocus
      />
      <TextField label="Host / family name" value={f.hostName} onChange={(v) => setF({ ...f, hostName: v })} />
      <div className="grid cols-2">
        <TextField
          label="First day"
          type="date"
          value={f.startDate}
          onChange={(v) => setF({ ...f, startDate: v })}
          error={error?.fieldError('startDate')}
        />
        <TextField
          label="Last day"
          type="date"
          value={f.endDate}
          onChange={(v) => setF({ ...f, endDate: v })}
          error={error?.fieldError('endDate')}
        />
      </div>
      <Field
        label="Time zone"
        hint="All function times are entered in this zone. It cannot be changed once functions exist."
        error={error?.fieldError('timezone')}
      >
        {(id) => (
          <select id={id} className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
            {ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        )}
      </Field>
    </Modal>
  );
}

export default function EventsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  return (
    <Suspense fallback={<div className="skel" style={{ height: 80 }} />}>
      <EventsInner workspaceId={workspaceId} />
    </Suspense>
  );
}
