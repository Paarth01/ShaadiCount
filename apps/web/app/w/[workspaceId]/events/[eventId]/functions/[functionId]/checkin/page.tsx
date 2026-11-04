'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, evPath, fnPath, newKey } from '@/lib/api';
import { roleCan } from '@/lib/auth';
import { useWorkspace } from '@/components/Shell';
import { Badge, Button, Card, Empty, ErrorBanner, Modal, TextField, useAction, useLoad } from '@/components/ui';
import { QrScanner } from '@/components/QrScanner';

type Result = { tone: 'ok' | 'warn' | 'bad'; title: string; detail?: string } | null;

export default function CheckInPage({ params }: { params: Promise<{ workspaceId: string; eventId: string; functionId: string }> }) {
  const { workspaceId: ws, eventId: ev, functionId: fid } = use(params);
  const { role } = useWorkspace();
  const fn = useLoad(() => api.get(evPath(ws, ev, `/functions/${fid}`)), [fid]);
  const rec = useLoad(() => api.get(fnPath(ws, ev, fid, '/checkin/reconciliation')), [fid]);
  const [mode, setMode] = useState<'search' | 'scan'>('search');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searchErr, setSearchErr] = useState<unknown>(null);
  const [result, setResult] = useState<Result>(null);
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState<any>(null);
  const [voiding, setVoiding] = useState<any>(null);
  const busyRef = useRef(false);
  const submit = useAction();

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        setResults((await api.get(fnPath(ws, ev, fid, `/checkin/search?q=${encodeURIComponent(q.trim())}`))).data);
        setSearchErr(null);
      } catch (e) {
        setSearchErr(e);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, ws, ev, fid]);

  const refresh = useCallback(async () => {
    rec.reload();
    if (q.trim().length >= 2) {
      try {
        setResults((await api.get(fnPath(ws, ev, fid, `/checkin/search?q=${encodeURIComponent(q.trim())}`))).data);
      } catch {
        /* ignore */
      }
    }
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  /** One idempotency key per attempt keeps a retried tap from double-checking-in on a flaky connection. */
  const checkIn = useCallback(
    async (body: Record<string, unknown>, label?: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        const r = await api.post(fnPath(ws, ev, fid, '/checkin'), body, { idempotencyKey: newKey() });
        setResult(
          r.duplicate
            ? {
                tone: 'warn',
                title: `Already checked in${label || r.guestName ? `: ${label ?? r.guestName}` : ''}`,
                detail: `${r.checkIn.adults + r.checkIn.children} people were checked in earlier.`,
              }
            : {
                tone: 'ok',
                title: `Checked in${label || r.guestName ? `: ${label ?? r.guestName}` : ''}`,
                detail: `${r.checkIn.adults} adults, ${r.checkIn.children} children`,
              },
        );
        void refresh();
      } catch (e) {
        const err = e as ApiError;
        const invitationId = (body.invitationId as string | undefined) ?? (err.extra.invitationId as string | undefined);
        if (err.code === 'RSVP_NOT_CONFIRMED' && invitationId) {
          // Works for QR scans too: the server returns who the code belongs to so staff can still confirm manually.
          setConfirm({ invitationId, label: label ?? err.extra.guestName, partySize: err.extra.partySize });
        } else
          setResult({
            tone: 'bad',
            title: err.code === 'NOT_FOUND' ? 'Code not recognised for this function' : err.message,
            detail: err.status === 0 ? 'Not recorded. Check your connection and try again.' : undefined,
          });
      } finally {
        busyRef.current = false;
      }
    },
    [ws, ev, fid, refresh],
  );

  const onScan = useCallback(
    (v: string) => {
      const c = v.trim().toUpperCase();
      if (/^[A-Z2-9]{12}$/.test(c)) void checkIn({ code: c });
      else setResult({ tone: 'bad', title: 'Not a ShaadiCount check-in code' });
    },
    [checkIn],
  );

  if (!roleCan.checkin(role))
    return (
      <div className="banner warn" id="main">
        Your role cannot check guests in.
      </div>
    );
  const x = rec.data;
  return (
    <div className="stack" id="main">
      <div className="row between">
        <div>
          <p className="muted" style={{ margin: 0 }}>
            <Link href={`/w/${ws}/events/${ev}`}>Back</Link>
          </p>
          <h1 style={{ margin: 0 }}>{fn.data?.name ?? 'Check-in'}</h1>
        </div>
        {x && (
          <div style={{ textAlign: 'right' }}>
            <b style={{ fontSize: '1.6rem' }}>{x.checkedInPeople}</b>
            <div className="muted">of {x.rsvpYesPeople} confirmed</div>
          </div>
        )}
      </div>
      <ErrorBanner error={fn.error ?? rec.error} />
      {result && (
        <div className={`banner ${result.tone}`} role="status" style={{ fontSize: '1.1rem' }}>
          <b>{result.title}</b>
          {result.detail && <div>{result.detail}</div>}
          <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
            Dismiss
          </Button>
        </div>
      )}
      <div className="seg" role="group" aria-label="Mode">
        <button aria-pressed={mode === 'search'} onClick={() => setMode('search')}>
          Find by name
        </button>
        <button aria-pressed={mode === 'scan'} onClick={() => setMode('scan')}>
          Scan QR
        </button>
      </div>
      {mode === 'scan' && (
        <Card>
          <QrScanner onCode={onScan} paused={!!confirm} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onScan(code);
              setCode('');
            }}
            style={{ marginTop: '.8rem' }}
          >
            <TextField
              label="Or type the 12-character code"
              value={code}
              onChange={(v) => setCode(v.toUpperCase())}
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="submit" variant="primary" block disabled={code.length !== 12}>
              Check in
            </Button>
          </form>
        </Card>
      )}
      {mode === 'search' && (
        <>
          <input
            className="input"
            type="search"
            autoFocus
            placeholder="Type a guest's name"
            aria-label="Guest name"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ fontSize: '1.1rem', minHeight: 52 }}
          />
          <ErrorBanner error={searchErr} />
          {q.trim().length >= 2 && !results.length && !searchErr && <Empty title="No match">Check the spelling or try the QR code.</Empty>}
          <ul className="list">
            {results.map((r) => (
              <li key={r.invitationId}>
                <Card>
                  <div className="row between top">
                    <div>
                      <b style={{ fontSize: '1.1rem' }}>{r.guestName}</b>
                      <div className="muted">
                        {r.group ?? 'No group'}
                        {r.phoneLast4 && ` · …${r.phoneLast4}`} · up to {r.partySize}
                      </div>
                      <div className="row" style={{ marginTop: '.3rem', gap: '.3rem' }}>
                        {r.rsvp ? (
                          <Badge tone={r.rsvp.status === 'yes' ? 'ok' : r.rsvp.status === 'no' ? 'bad' : 'warn'}>
                            RSVP {r.rsvp.status}
                            {r.rsvp.status !== 'no' && ` · ${r.rsvp.adults + r.rsvp.children}`}
                          </Badge>
                        ) : (
                          <Badge>No RSVP</Badge>
                        )}
                        {r.revoked && <Badge tone="bad">Revoked</Badge>}
                      </div>
                    </div>
                    <div>
                      {r.checkedIn ? (
                        <div style={{ textAlign: 'right' }}>
                          <Badge tone="ok">Checked in · {r.checkedIn.adults + r.checkedIn.children}</Badge>
                          <br />
                          <Button size="sm" variant="ghost" onClick={() => setVoiding(r)}>
                            Undo
                          </Button>
                        </div>
                      ) : r.revoked ? null : (
                        <Button variant="primary" onClick={() => checkIn({ invitationId: r.invitationId }, r.guestName)}>
                          Check in
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      {confirm && (
        <UnconfirmedModal
          ctx={confirm}
          max={confirm.partySize ?? results.find((r) => r.invitationId === confirm.invitationId)?.partySize ?? 1}
          onClose={() => setConfirm(null)}
          onGo={(adults, children) => {
            const c = confirm;
            setConfirm(null);
            void checkIn({ invitationId: c.invitationId, allowUnconfirmed: true, adults, children }, c.label);
          }}
        />
      )}
      {voiding && (
        <VoidModal
          ws={ws}
          ev={ev}
          fid={fid}
          r={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            void refresh();
          }}
          busy={submit.busy}
        />
      )}
    </div>
  );
}

function UnconfirmedModal({
  ctx,
  max,
  onClose,
  onGo,
}: {
  ctx: any;
  max: number;
  onClose: () => void;
  onGo: (a: number, c: number) => void;
}) {
  const [a, setA] = useState(1);
  const [c, setC] = useState(0);
  return (
    <Modal
      title={`${ctx.label ?? 'Guest'} has not said Yes`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={a + c < 1 || a + c > max} onClick={() => onGo(a, c)}>
            Check in anyway
          </Button>
        </>
      }
    >
      <p>They answered Maybe or did not answer. Enter how many people arrived (up to {max}).</p>
      <div className="grid cols-2">
        <TextField label="Adults" type="number" min={0} value={String(a)} onChange={(v) => setA(Math.max(0, Number(v) || 0))} />
        <TextField label="Children" type="number" min={0} value={String(c)} onChange={(v) => setC(Math.max(0, Number(v) || 0))} />
      </div>
    </Modal>
  );
}

function VoidModal({
  ws,
  ev,
  fid,
  r,
  onClose,
  onDone,
}: {
  ws: string;
  ev: string;
  fid: string;
  r: any;
  busy: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal
      title={`Undo check-in for ${r.guestName}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            busy={busy}
            disabled={reason.trim().length < 3}
            onClick={async () => {
              const x = await run(() => api.post(fnPath(ws, ev, fid, `/checkin/${r.checkedIn.id}/void`), { reason }), 'Check-in undone');
              if (x) onDone();
            }}
          >
            Undo check-in
          </Button>
        </>
      }
    >
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <TextField
        label="Reason (required)"
        value={reason}
        onChange={setReason}
        error={error?.fieldError('reason')}
        placeholder="Scanned the wrong person"
      />
    </Modal>
  );
}
