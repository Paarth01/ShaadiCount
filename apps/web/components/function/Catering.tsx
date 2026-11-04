'use client';
import { useEffect, useState } from 'react';
import { api, evPath, fnPath } from '@/lib/api';
import { fmtDateTime, fmtRupees } from '@/lib/format';
import { roleCan, type Role } from '@/lib/auth';
import { Badge, Button, Card, ErrorBanner, Stat, TextField, useAction, useLoad, useToast } from '../ui';

export function CateringTab({ ws, ev, fn, tz, role }: { ws: string; ev: string; fn: any; tz: string; role: Role }) {
  const c = useLoad(() => api.get(fnPath(ws, ev, fn.id, '/catering')), [fn.id]);
  const snaps = useLoad(() => api.get(fnPath(ws, ev, fn.id, '/catering/snapshots')), [fn.id]);
  const x = c.data;
  const canWrite = roleCan.edit(role);
  const toast = useToast();
  const [s, setS] = useState<any>(null);
  // Reset the form from the server's saved assumptions whenever a fresh estimate is loaded (initially and after saving).
  useEffect(() => {
    if (!x) return;
    setS({
      maybe: String(x.settings.maybeWeightPercent),
      pending: String(x.settings.pendingWeightPercent),
      buffer: String(x.settings.bufferPercent),
      rounding: String(x.settings.mealRounding),
      adult: x.settings.adultPricePaise === null ? '' : String(x.settings.adultPricePaise / 100),
      child: x.settings.childPricePaise === null ? '' : String(x.settings.childPricePaise / 100),
    });
  }, [x]);
  const save = useAction();
  const snap = useAction();
  const exp = useAction();
  const saveSettings = async () => {
    const r = await save.run(
      () =>
        api.put(fnPath(ws, ev, fn.id, '/catering/settings'), {
          maybeWeightPercent: Number(s.maybe),
          pendingWeightPercent: Number(s.pending),
          bufferPercent: Number(s.buffer),
          mealRounding: Math.max(1, Math.round(Number(s.rounding) || 1)),
          adultPricePaise: s.adult === '' ? null : Math.round(Number(s.adult) * 100),
          childPricePaise: s.child === '' ? null : Math.round(Number(s.child) * 100),
        }),
      'Assumptions saved',
    );
    if (r) c.reload();
  };
  const e = x?.estimate;
  return (
    <div className="stack">
      <ErrorBanner error={c.error} onRetry={c.reload} />
      {c.loading && !x && <div className="skel" style={{ height: 120 }} />}
      {x && e && (
        <>
          <div className="banner info">{x.disclaimer}</div>
          <div className="grid cols-3">
            <Stat label="Meals to plan for" value={e.estimatedMeals} hint={`${e.adultMeals} adult · ${e.childMeals} child`} />
            <Stat
              label="Estimated cost"
              value={fmtRupees(e.estimatedCostPaise)}
              hint={e.estimatedCostPaise === null ? 'Add prices below' : undefined}
            />
            <Stat
              label="Confirmed"
              value={x.inputs.confirmedAdults + x.inputs.confirmedChildren}
              hint={`${x.inputs.confirmedAdults} adults · ${x.inputs.confirmedChildren} children`}
            />
          </div>
          <Card>
            <h3>How this is calculated</h3>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              <li>
                Confirmed (Yes): <b>{e.breakdown.confirmed}</b>
              </li>
              <li>
                Maybe: {x.inputs.maybeAdults + x.inputs.maybeChildren} people × {x.settings.maybeWeightPercent}% ={' '}
                <b>{e.breakdown.tentativeWeighted}</b>
              </li>
              <li>
                Not answered yet: up to {x.inputs.pendingPeople} people × {x.settings.pendingWeightPercent}% ={' '}
                <b>{e.breakdown.pendingWeighted}</b>
              </li>
              <li>
                Buffer {x.settings.bufferPercent}%: <b>+{e.breakdown.bufferAdded}</b>
                {e.breakdown.roundingAdded > 0 && (
                  <>
                    {' '}
                    · rounding up to multiples of {x.settings.mealRounding}: <b>+{e.breakdown.roundingAdded}</b>
                  </>
                )}
              </li>
            </ul>
            {x.warnings.map((w: string, i: number) => (
              <p key={i} className="err" style={{ color: 'var(--warn)' }}>
                ⚠ {w}
              </p>
            ))}
            <small className="muted">Updated live from RSVPs · {fmtDateTime(x.calculatedAt, tz)}</small>
          </Card>
          {canWrite && s && (
            <Card>
              <h3>Assumptions</h3>
              <ErrorBanner error={save.error} />
              <div className="grid cols-2">
                <TextField
                  label="Count “maybe” at (%)"
                  type="number"
                  min={0}
                  max={100}
                  value={s.maybe}
                  onChange={(v) => setS({ ...s, maybe: v })}
                />
                <TextField
                  label="Count not-yet-answered at (%)"
                  type="number"
                  min={0}
                  max={100}
                  value={s.pending}
                  onChange={(v) => setS({ ...s, pending: v })}
                  hint="Pending guests are assumed to be adults."
                />
                <TextField
                  label="Safety buffer (%)"
                  type="number"
                  min={0}
                  max={100}
                  value={s.buffer}
                  onChange={(v) => setS({ ...s, buffer: v })}
                />
                <TextField
                  label="Round total up to a multiple of"
                  type="number"
                  min={1}
                  value={s.rounding}
                  onChange={(v) => setS({ ...s, rounding: v })}
                  hint="e.g. 10 if your caterer quotes in tens."
                />
                <TextField
                  label="Price per adult meal (₹)"
                  type="number"
                  min={0}
                  value={s.adult}
                  onChange={(v) => setS({ ...s, adult: v })}
                />
                <TextField
                  label="Price per child meal (₹)"
                  type="number"
                  min={0}
                  value={s.child}
                  onChange={(v) => setS({ ...s, child: v })}
                />
              </div>
              <Button variant="primary" busy={save.busy} onClick={saveSettings}>
                Save assumptions
              </Button>
            </Card>
          )}
          <div className="row">
            {canWrite && (
              <Button
                busy={snap.busy}
                onClick={async () => {
                  const r = await snap.run(
                    () =>
                      api.post(fnPath(ws, ev, fn.id, '/catering/snapshots'), {
                        label: `Snapshot ${new Date().toLocaleDateString('en-IN')}`,
                      }),
                    'Estimate saved',
                  );
                  if (r) snaps.reload();
                }}
              >
                Save this estimate
              </Button>
            )}
            <Button
              busy={exp.busy}
              onClick={async () => {
                const r = await exp.run(() => api.post(evPath(ws, ev, '/exports'), { kind: 'catering', functionId: fn.id }));
                if (r) {
                  window.location.href = r.downloadPath;
                  toast('Downloading CSV');
                }
              }}
            >
              Download CSV
            </Button>
          </div>
          <ErrorBanner error={exp.error} />
          {!!snaps.data?.data?.length && (
            <Card>
              <h3>Saved estimates</h3>
              <ul className="list">
                {snaps.data.data.map((n: any) => (
                  <li key={n.id} className="row between">
                    <span>
                      <b>{n.label ?? 'Estimate'}</b> <small className="muted">{fmtDateTime(n.createdAt, tz)}</small>
                    </span>
                    <span>
                      <Badge>{n.estimatedMeals} meals</Badge>{' '}
                      {n.estimatedCostPaise !== null && <Badge>{fmtRupees(n.estimatedCostPaise)}</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
