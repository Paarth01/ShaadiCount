'use client';
import { useRef, useState } from 'react';
import { api, evPath, fnPath, newKey } from '@/lib/api';
import { REASONS } from '@/lib/format';
import { Badge, Button, ErrorBanner, Field, Modal, TextField, useAction, useLoad, useToast } from './ui';

export function GuestFormModal({
  ws,
  eventId,
  functions,
  guest,
  groups,
  onClose,
  onDone,
}: {
  ws: string;
  eventId: string;
  functions: any[];
  guest?: any;
  groups: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const detail = useLoad(
    () => (guest ? api.get(evPath(ws, eventId, `/guests/${guest.id}?reveal=true`)) : Promise.resolve(null)),
    [guest?.id],
  );
  const [f, setF] = useState<any>(null);
  const cur = f ?? {
    displayName: guest?.displayName ?? '',
    phone: detail.data?.phone ?? '',
    email: detail.data?.email ?? '',
    preferredLanguage: guest?.language ?? 'en',
    groupLabel: guest?.group?.label ?? '',
    invites: {} as Record<string, number>,
  };
  const set = (patch: any) => setF({ ...cur, ...patch });
  const { busy, error, run } = useAction();
  const [dupAllowed, setDupAllowed] = useState(false);
  const dup = error?.code === 'DUPLICATE_GUEST';
  const submit = async () => {
    const base = {
      displayName: cur.displayName,
      phone: cur.phone || null,
      email: cur.email || null,
      preferredLanguage: cur.preferredLanguage,
      groupLabel: cur.groupLabel || undefined,
    };
    const r = await run(
      () =>
        guest
          ? api.patch(evPath(ws, eventId, `/guests/${guest.id}`), base)
          : api.post(evPath(ws, eventId, '/guests'), {
              ...base,
              allowDuplicate: dupAllowed,
              invitations: Object.entries(cur.invites)
                .filter(([, n]) => (n as number) > 0)
                .map(([functionId, partySize]) => ({ functionId, partySize })),
            }),
      guest ? 'Guest updated' : 'Guest added',
    );
    if (r) onDone();
  };
  return (
    <Modal
      title={guest ? 'Edit guest' : 'Add guest'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!cur.displayName.trim() || (!!guest && detail.loading)} onClick={submit}>
            {dup ? 'Add anyway' : 'Save'}
          </Button>
        </>
      }
    >
      <ErrorBanner error={error && !error.details.length && !dup ? error : null} />
      {dup && (
        <div className="banner warn" role="alert">
          <b>This looks like someone already on the list.</b>
          <ul>
            {(error!.extra.duplicates ?? []).map((d: any) => (
              <li key={d.id}>{d.displayName}</li>
            ))}
          </ul>
          <label className="check">
            <input type="checkbox" checked={dupAllowed} onChange={(e) => setDupAllowed(e.target.checked)} /> They are a different person.
            Add anyway.
          </label>
        </div>
      )}
      <TextField
        label="Name"
        value={cur.displayName}
        onChange={(v) => set({ displayName: v })}
        error={error?.fieldError('displayName')}
        autoFocus
      />
      <TextField
        label="Mobile number"
        type="tel"
        inputMode="tel"
        placeholder="98765 43210"
        value={cur.phone}
        onChange={(v) => set({ phone: v })}
        error={error?.fieldError('phone')}
        hint="10-digit Indian numbers are saved as +91. Use +country code for others."
      />
      <TextField
        label="Email (optional)"
        type="email"
        value={cur.email}
        onChange={(v) => set({ email: v })}
        error={error?.fieldError('email')}
      />
      <div className="grid cols-2">
        <Field label="Message language">
          {(id) => (
            <select id={id} className="input" value={cur.preferredLanguage} onChange={(e) => set({ preferredLanguage: e.target.value })}>
              <option value="en">English</option>
              <option value="hi">हिन्दी (Hindi)</option>
            </select>
          )}
        </Field>
        <Field label="Family / group">
          {(id) => (
            <>
              <input
                id={id}
                list={`${id}-g`}
                className="input"
                value={cur.groupLabel}
                onChange={(e) => set({ groupLabel: e.target.value })}
              />
              <datalist id={`${id}-g`}>
                {groups.map((g) => (
                  <option key={g.id} value={g.label} />
                ))}
              </datalist>
            </>
          )}
        </Field>
      </div>
      {!guest && !!functions.length && (
        <fieldset style={{ border: '1px solid var(--line)', borderRadius: 10, marginBottom: '.8rem' }}>
          <legend style={{ fontWeight: 700 }}>Invite to</legend>
          {functions.map((fn) => (
            <div key={fn.id} className="row between">
              <label className="check">
                <input
                  type="checkbox"
                  checked={(cur.invites[fn.id] ?? 0) > 0}
                  onChange={(e) => set({ invites: { ...cur.invites, [fn.id]: e.target.checked ? 1 : 0 } })}
                />
                {fn.name}
              </label>
              {(cur.invites[fn.id] ?? 0) > 0 && (
                <label className="row" style={{ gap: '.3rem' }}>
                  <span className="muted">People</span>
                  <input
                    aria-label={`Party size for ${fn.name}`}
                    className="input"
                    style={{ width: 70 }}
                    type="number"
                    min={1}
                    max={50}
                    value={cur.invites[fn.id]}
                    onChange={(e) => set({ invites: { ...cur.invites, [fn.id]: Number(e.target.value) } })}
                  />
                </label>
              )}
            </div>
          ))}
        </fieldset>
      )}
    </Modal>
  );
}

const SAMPLE = 'name,mobile,language,family,functions,party size\nAnita Rao,98765 43210,hindi,Rao family,Mehendi;Wedding,3\n';

export function ImportWizard({
  ws,
  eventId,
  onClose,
  onDone,
  onRecordConsent,
}: {
  ws: string;
  eventId: string;
  onClose: () => void;
  onDone: () => void;
  onRecordConsent: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState<string>();
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const [include, setInclude] = useState<Set<number>>(new Set());
  const keyRef = useRef(newKey());
  const { busy, error, run } = useAction();
  const toast = useToast();

  const onFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 900_000) {
      toast('That file is too large (max about 900 KB). Split it into smaller files.', 'bad');
      return;
    }
    setFilename(file.name);
    setCsv(await file.text());
    setPreview(null);
  };
  const check = async () => {
    const p = await run(() => api.post(evPath(ws, eventId, '/imports/preview'), { csv, filename }));
    if (p) {
      setPreview(p);
      setInclude(new Set());
      keyRef.current = newKey();
    }
  };
  const commit = async () => {
    const r = await run(() =>
      api.post(
        evPath(ws, eventId, `/imports/${preview.importId}/commit`),
        { includeDuplicateRows: [...include] },
        { idempotencyKey: keyRef.current },
      ),
    );
    if (r) {
      setResult(r);
      onDone();
    }
  };
  const s = preview?.summary;
  const importable = s ? s.valid + include.size : 0;

  if (result)
    return (
      <Modal
        title="Import finished"
        onClose={onClose}
        footer={
          <>
            <Button onClick={onClose}>Done</Button>
            <Button
              variant="primary"
              onClick={() => {
                onClose();
                onRecordConsent();
              }}
            >
              Record permission to message
            </Button>
          </>
        }
      >
        <div className="banner ok">
          <b>{result.created} guests added</b> and {result.invitationsCreated} invitations created.{' '}
          {result.skippedDuplicates + result.skippedErrors > 0 &&
            `${result.skippedDuplicates} duplicates and ${result.skippedErrors} problem rows were skipped.`}
        </div>
        <div className="banner info">
          Importing contacts does <b>not</b> give permission to message them. Record how you have permission to contact guests before
          sending anything.
        </div>
      </Modal>
    );
  return (
    <Modal
      title="Import guests from CSV"
      onClose={onClose}
      footer={
        preview ? (
          <>
            <Button onClick={() => setPreview(null)}>Back</Button>
            <Button variant="primary" busy={busy} disabled={importable === 0} onClick={commit}>
              Import {importable} {importable === 1 ? 'guest' : 'guests'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" busy={busy} disabled={!csv.trim()} onClick={check}>
              Check file
            </Button>
          </>
        )
      }
    >
      <ErrorBanner error={error} />
      {!preview ? (
        <>
          <p className="muted">
            Columns we understand: <b>name</b>, mobile/phone, email, language (English/Hindi), family/group, functions (names separated by ;
            or |), party size. Nothing is saved until you confirm.
          </p>
          <label className="btn" style={{ marginBottom: '.7rem' }}>
            Choose a CSV file
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {filename && <span className="muted"> {filename}</span>}
          <Field label="…or paste CSV text">
            {(id) => (
              <textarea
                id={id}
                className="input"
                rows={7}
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setPreview(null);
                }}
                placeholder={SAMPLE}
                spellCheck={false}
              />
            )}
          </Field>
        </>
      ) : (
        <>
          <div className="row" style={{ marginBottom: '.6rem' }}>
            <Badge tone="ok">{s.valid} ready</Badge>
            <Badge tone="warn">{s.duplicates} possible duplicates</Badge>
            <Badge tone="bad">{s.errors} problems</Badge>
          </div>
          <div className="scroll-x" style={{ maxHeight: '45dvh', overflow: 'auto' }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Guest</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r: any) => (
                  <tr key={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    <td>
                      {r.guest ? (
                        <>
                          <b>{r.guest.name}</b>
                          <br />
                          <small className="muted">
                            {r.guest.phone ?? 'no phone'} · {r.guest.functions.join(', ') || 'no functions'} · {r.guest.partySize} people
                          </small>
                        </>
                      ) : (
                        <span className="muted">-</span>
                      )}
                    </td>
                    <td>
                      {r.status === 'valid' && <Badge tone="ok">Ready</Badge>}
                      {r.status === 'error' && (
                        <div>
                          {r.errors.map((e: any, i: number) => (
                            <div key={i} className="err">
                              {e.message}
                            </div>
                          ))}
                        </div>
                      )}
                      {r.status === 'duplicate' && (
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={include.has(r.rowNumber)}
                            onChange={(e) => {
                              const n = new Set(include);
                              if (e.target.checked) n.add(r.rowNumber);
                              else n.delete(r.rowNumber);
                              setInclude(n);
                            }}
                          />
                          <span>
                            <Badge tone="warn">Possible duplicate</Badge>
                            <br />
                            <small>{r.duplicateOf.reason.replaceAll('_', ' ')}. Tick to import anyway.</small>
                          </span>
                        </label>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.rowsTruncated && <p className="muted">Showing the first 500 rows. All rows are imported.</p>}
        </>
      )}
    </Modal>
  );
}

export function ConsentModal({
  ws,
  eventId,
  guestIds,
  onClose,
  onDone,
}: {
  ws: string;
  eventId: string;
  guestIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [channel, setChannel] = useState('whatsapp');
  const [basis, setBasis] = useState('organizer_attestation');
  const [note, setNote] = useState('');
  const { busy, error, run } = useAction();
  return (
    <Modal
      title={`Record permission for ${guestIds.length} ${guestIds.length === 1 ? 'guest' : 'guests'}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={note.trim().length < 3}
            onClick={async () => {
              const r = await run(
                () => api.post(evPath(ws, eventId, '/consents'), { guestIds, channel, basis, status: 'granted', evidenceNote: note }),
                'Permission recorded',
              );
              if (r) onDone();
            }}
          >
            Record permission
          </Button>
        </>
      }
    >
      <div className="banner info">
        Only record this if guests really gave you their number to receive wedding updates on this channel. This note is kept as evidence
        and appears in the audit log.
      </div>
      <ErrorBanner error={error && !error.details.length ? error : null} />
      <div className="grid cols-2">
        <Field label="Channel">
          {(id) => (
            <select id={id} className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </select>
          )}
        </Field>
        <Field label="How was permission given?">
          {(id) => (
            <select id={id} className="input" value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="organizer_attestation">Host/organizer confirms</option>
              <option value="guest_opt_in">Guest opted in</option>
            </select>
          )}
        </Field>
      </div>
      <Field
        label="Evidence note (required)"
        error={error?.fieldError('evidenceNote')}
        hint="Example: “Guests shared their numbers with the Sharma family for wedding updates.”"
      >
        {(id) => (
          <textarea
            id={id}
            className="input"
            style={{ fontFamily: 'inherit' }}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
    </Modal>
  );
}

export function InviteModal({
  ws,
  eventId,
  functions,
  guestIds,
  onClose,
  onDone,
}: {
  ws: string;
  eventId: string;
  functions: any[];
  guestIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [fid, setFid] = useState(functions[0]?.id ?? '');
  const [size, setSize] = useState(1);
  const { busy, error, run } = useAction();
  const toast = useToast();
  return (
    <Modal
      title={`Invite ${guestIds.length} to a function`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={!fid}
            onClick={async () => {
              const r = await run(() =>
                api.post(fnPath(ws, eventId, fid, '/invitations'), { invites: guestIds.map((guestId) => ({ guestId, partySize: size })) }),
              );
              if (r) {
                toast(
                  `${r.createdCount} invited${r.alreadyInvitedGuestIds.length ? `, ${r.alreadyInvitedGuestIds.length} already invited` : ''}`,
                );
                onDone();
              }
            }}
          >
            Invite
          </Button>
        </>
      }
    >
      <ErrorBanner error={error} />
      <Field label="Function">
        {(id) => (
          <select id={id} className="input" value={fid} onChange={(e) => setFid(e.target.value)}>
            {functions.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <TextField
        label="People per invitation"
        type="number"
        min={1}
        max={50}
        value={String(size)}
        onChange={(v) => setSize(Math.max(1, Number(v) || 1))}
        hint="The most people a guest can confirm. You can change it per guest later."
      />
    </Modal>
  );
}
export { REASONS };
