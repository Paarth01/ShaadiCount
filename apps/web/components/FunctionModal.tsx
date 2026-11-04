'use client';
import { useState } from 'react';
import { api, evPath } from '@/lib/api';
import { Button, ErrorBanner, Field, Modal, TextField, useAction } from './ui';

export function FunctionModal({
  ws,
  eventId,
  fn,
  onClose,
  onDone,
}: {
  ws: string;
  eventId: string;
  fn?: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState({
    name: fn?.name ?? '',
    startsAt: fn?.startsAtLocal ?? '',
    venue: fn?.venue ?? '',
    capacity: fn?.capacity?.toString() ?? '',
    rsvpDeadline: fn?.rsvpDeadlineLocal ?? '',
    allowChildren: fn?.allowChildren ?? true,
    allowResponseEdits: fn?.allowResponseEdits ?? true,
    status: fn?.status ?? 'active',
  });
  const { busy, error, run } = useAction();
  const submit = async () => {
    const body = {
      name: f.name,
      startsAt: f.startsAt,
      venue: f.venue || null,
      capacity: f.capacity === '' ? null : Number(f.capacity),
      rsvpDeadline: f.rsvpDeadline || null,
      allowChildren: f.allowChildren,
      allowResponseEdits: f.allowResponseEdits,
      status: f.status,
    };
    const r = await run(
      () => (fn ? api.patch(evPath(ws, eventId, `/functions/${fn.id}`), body) : api.post(evPath(ws, eventId, '/functions'), body)),
      fn ? 'Function updated' : 'Function added',
    );
    if (r) onDone();
  };
  return (
    <Modal
      title={fn ? 'Edit function' : 'Add function'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={submit} disabled={!f.name.trim() || !f.startsAt}>
            Save
          </Button>
        </>
      }
    >
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <TextField
        label="Function name"
        placeholder="Sangeet"
        value={f.name}
        onChange={(v) => setF({ ...f, name: v })}
        error={error?.fieldError('name')}
        autoFocus
      />
      <TextField
        label="Starts (event time zone)"
        type="datetime-local"
        value={f.startsAt}
        onChange={(v) => setF({ ...f, startsAt: v })}
        error={error?.fieldError('startsAt')}
      />
      <TextField
        label="RSVP deadline (optional)"
        type="datetime-local"
        value={f.rsvpDeadline}
        onChange={(v) => setF({ ...f, rsvpDeadline: v })}
        error={error?.fieldError('rsvpDeadline')}
        hint="Guests cannot answer after this time. Organizers can still correct answers."
      />
      <TextField label="Venue" value={f.venue} onChange={(v) => setF({ ...f, venue: v })} />
      <TextField
        label="Capacity (optional)"
        type="number"
        min={0}
        value={f.capacity}
        onChange={(v) => setF({ ...f, capacity: v })}
        hint="Used only to warn you when confirmed guests exceed it."
      />
      <label className="check">
        <input type="checkbox" checked={f.allowChildren} onChange={(e) => setF({ ...f, allowChildren: e.target.checked })} /> Children are
        included in the headcount
      </label>
      <label className="check">
        <input type="checkbox" checked={f.allowResponseEdits} onChange={(e) => setF({ ...f, allowResponseEdits: e.target.checked })} />{' '}
        Guests may change their answer
      </label>
      {fn && (
        <Field label="Status">
          {(id) => (
            <select id={id} className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {['draft', 'active', 'completed', 'cancelled'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
        </Field>
      )}
    </Modal>
  );
}
