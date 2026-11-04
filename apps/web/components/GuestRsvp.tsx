'use client';
import QRCode from 'qrcode';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, newKey } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import { t, type Lang } from '@/lib/i18n';

type Status = 'yes' | 'no' | 'maybe';
interface View {
  guestName: string;
  language: Lang;
  event: { name: string; timezone: string };
  function: { name: string; startsAt: string; venue: string | null };
  partySizeMax: number;
  allowChildren: boolean;
  deadline: string | null;
  state: 'open' | 'locked' | 'closed_deadline' | 'closed_cancelled' | 'closed_completed';
  response: { status: Status; adultCount: number; childCount: number; version: number } | null;
  checkinCode: string | null;
}

export function Stepper({
  label,
  value,
  min = 0,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="row between" style={{ marginBottom: '.7rem' }}>
      <span style={{ fontWeight: 700 }}>{label}</span>
      <div className="stepper">
        <button type="button" aria-label={`${label} −`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          −
        </button>
        <output aria-live="polite" aria-label={label}>
          {value}
        </output>
        <button type="button" aria-label={`${label} +`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export function GuestRsvp({ token }: { token: string }) {
  const [view, setView] = useState<View | null>(null);
  const [lang, setLang] = useState<Lang>('en');
  const [load, setLoad] = useState<'loading' | 'ok' | 'invalid' | 'unavailable' | 'ratelimited' | 'network'>('loading');
  const [choice, setChoice] = useState<Status | null>(null);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'warn' | 'ok'; text: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  // Same payload retried => same Idempotency-Key, so a dropped response can never create a second RSVP.
  const attempt = useRef<{ key: string; sig: string } | null>(null);

  const apply = useCallback((v: View, keepLang = false) => {
    setView(v);
    if (!keepLang) setLang(v.language);
    setChoice(v.response?.status ?? null);
    setAdults(v.response ? v.response.adultCount : Math.min(1, v.partySizeMax));
    setChildren(v.response?.childCount ?? 0);
  }, []);

  const fetchView = useCallback(async () => {
    setLoad('loading');
    try {
      const v = await api.get<View>(`/v1/public/rsvp/${token}`);
      apply(v);
      setLoad('ok');
    } catch (e) {
      const s = (e as ApiError).status;
      setLoad(s === 404 ? 'invalid' : s === 410 ? 'unavailable' : s === 429 ? 'ratelimited' : 'network');
    }
  }, [token, apply]);
  useEffect(() => {
    void fetchView();
  }, [fetchView]);

  useEffect(() => {
    if (!view?.checkinCode) {
      setQr(null);
      return;
    }
    QRCode.toDataURL(view.checkinCode, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(null));
  }, [view?.checkinCode]);

  if (load === 'loading')
    return (
      <Shell lang={lang} setLang={setLang}>
        <div className="guest-body">
          <div className="skel" style={{ height: 24, width: '60%' }} />
          <p className="muted" style={{ marginTop: 12 }}>
            {t(lang, 'loading')}
          </p>
        </div>
      </Shell>
    );
  if (load !== 'ok' || !view) {
    const body =
      load === 'unavailable'
        ? t(lang, 'unavailableBody')
        : load === 'ratelimited'
          ? 'Too many attempts. Please wait a minute and try again.'
          : load === 'network'
            ? t(lang, 'offline')
            : t(lang, 'invalidBody');
    return (
      <Shell lang={lang} setLang={setLang}>
        <div className="guest-body">
          <h1>{t(lang, 'invalidTitle')}</h1>
          <p>{body}</p>
          {(load === 'network' || load === 'ratelimited') && (
            <button className="btn primary" onClick={fetchView}>
              {t(lang, 'retry')}
            </button>
          )}
        </div>
      </Shell>
    );
  }

  const tz = view.event.timezone;
  const cap = view.partySizeMax;
  const total = choice === 'no' ? 0 : adults + children;
  const canEdit = view.state === 'open';
  const showForm = canEdit && (!view.response || editing);
  const answered = !!view.response && !editing;

  const validate = (): string | null => {
    if (!choice) return t(lang, 'chooseOne');
    if (choice === 'yes' && total < 1) return t(lang, 'atLeastOne');
    if (choice !== 'no' && total > cap) return t(lang, 'maxPeople', { n: cap });
    return null;
  };

  async function submit() {
    const problem = validate();
    if (problem) {
      setMsg({ tone: 'bad', text: problem });
      return;
    }
    const body = {
      status: choice!,
      adultCount: choice === 'no' ? 0 : adults,
      childCount: choice === 'no' || !view!.allowChildren ? 0 : children,
      version: view!.response?.version ?? 0,
    };
    const sig = JSON.stringify(body);
    if (!attempt.current || attempt.current.sig !== sig) attempt.current = { key: newKey(), sig };
    setSaving(true);
    setMsg(null);
    try {
      const v = await api.put<View>(`/v1/public/rsvp/${token}/response`, body, { idempotencyKey: attempt.current.key });
      attempt.current = null;
      apply(v, true);
      setEditing(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'VERSION_CONFLICT' && err.extra.current) {
        setView({ ...view!, response: err.extra.current });
        setChoice(err.extra.current.status);
        setAdults(err.extra.current.adultCount);
        setChildren(err.extra.current.childCount);
        attempt.current = null;
        setMsg({ tone: 'warn', text: t(lang, 'conflict') });
      } else if (['RSVP_DEADLINE_PASSED', 'RSVP_CLOSED', 'RESPONSE_EDITS_DISABLED'].includes(err.code)) {
        await fetchView();
      } else if (err.status === 0) setMsg({ tone: 'bad', text: t(lang, 'offline') });
      else setMsg({ tone: 'bad', text: err.fieldError('adultCount') ?? err.message });
    } finally {
      setSaving(false);
    }
  }

  const stateMsg =
    view.state === 'closed_deadline'
      ? t(lang, 'closedDeadline')
      : view.state === 'closed_cancelled' || view.state === 'closed_completed'
        ? t(lang, 'closedCancelled')
        : view.state === 'locked'
          ? t(lang, 'locked')
          : null;
  const thanks = view.response
    ? t(lang, view.response.status === 'yes' ? 'thanksYes' : view.response.status === 'no' ? 'thanksNo' : 'thanksMaybe')
    : '';

  return (
    <Shell lang={lang} setLang={setLang}>
      <div className="guest-hero">
        <small>
          {t(lang, 'hello')} {view.guestName}
        </small>
        <h1>{view.function.name}</h1>
        <div>{view.event.name}</div>
      </div>
      <div className="guest-body">
        <dl style={{ margin: '0 0 1rem' }}>
          <dt className="muted">{t(lang, 'on')}</dt>
          <dd style={{ margin: '0 0 .5rem', fontWeight: 700 }}>{fmtDateTime(view.function.startsAt, tz, lang)}</dd>
          {view.function.venue && (
            <>
              <dt className="muted">{t(lang, 'where')}</dt>
              <dd style={{ margin: 0, fontWeight: 700 }}>{view.function.venue}</dd>
            </>
          )}
        </dl>
        {view.deadline && view.state === 'open' && (
          <p className="muted">{t(lang, 'deadline', { d: fmtDateTime(view.deadline, tz, lang) })}</p>
        )}
        {stateMsg && (
          <div className="banner warn" role="status">
            {stateMsg}
          </div>
        )}
        {msg && (
          <div className={`banner ${msg.tone}`} role="alert">
            {msg.text}
          </div>
        )}

        {answered && view.response && (
          <>
            <div className="banner ok" role="status">
              <b>{thanks}</b>
            </div>
            <p>
              <b>{t(lang, 'yourAnswer')}:</b> {t(lang, view.response.status)}
              {view.response.status !== 'no' && ` · ${view.response.adultCount + view.response.childCount}`}
            </p>
            {view.checkinCode && (
              <div style={{ textAlign: 'center', margin: '1rem 0' }}>
                <p className="muted">{t(lang, 'showAtEntry')}</p>
                {/* data: URL generated in the browser; next/image does not apply */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {qr && <img className="qr" src={qr} width={220} height={220} alt={`${t(lang, 'code')} ${view.checkinCode}`} />}
                <p className="muted" style={{ margin: '.5rem 0 0' }}>
                  {t(lang, 'code')}
                </p>
                <div className="code">{view.checkinCode}</div>
              </div>
            )}
            {canEdit && (
              <button className="btn block" onClick={() => setEditing(true)}>
                {t(lang, 'changeAnswer')}
              </button>
            )}
          </>
        )}

        {showForm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            noValidate
          >
            <h2 id="q">{t(lang, 'willYouJoin')}</h2>
            <div role="group" aria-labelledby="q" style={{ display: 'grid', gap: '.5rem', marginBottom: '1rem' }}>
              {(['yes', 'maybe', 'no'] as Status[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn"
                  style={{
                    minHeight: 56,
                    justifyContent: 'flex-start',
                    borderWidth: 2,
                    borderColor: choice === s ? 'var(--brand)' : undefined,
                    background: choice === s ? 'var(--brand-soft)' : undefined,
                  }}
                  aria-pressed={choice === s}
                  onClick={() => {
                    setChoice(s);
                    setMsg(null);
                    if (s === 'yes' && adults + children < 1) setAdults(1);
                  }}
                >
                  {choice === s ? '✓ ' : ''}
                  {t(lang, s)}
                </button>
              ))}
            </div>
            {choice && choice !== 'no' && (
              <div className="card" style={{ boxShadow: 'none', marginBottom: '1rem' }}>
                <p className="muted">{t(lang, 'partyUpTo', { n: cap })}</p>
                <Stepper label={t(lang, 'adults')} value={adults} max={Math.max(0, cap - children)} onChange={setAdults} />
                {view.allowChildren ? (
                  <Stepper label={t(lang, 'children')} value={children} max={Math.max(0, cap - adults)} onChange={setChildren} />
                ) : (
                  <p className="muted">{t(lang, 'noChildren')}</p>
                )}
                <div className="row between">
                  <b>{t(lang, 'total')}</b>
                  <b>{total}</b>
                </div>
              </div>
            )}
            <button type="submit" className="btn primary block" style={{ minHeight: 54 }} disabled={saving || !choice}>
              {saving ? t(lang, 'saving') : view.response ? t(lang, 'update') : t(lang, 'submit')}
            </button>
            {editing && (
              <button
                type="button"
                className="btn block ghost"
                style={{ marginTop: '.5rem' }}
                onClick={() => {
                  apply(view, true);
                  setEditing(false);
                  setMsg(null);
                }}
              >
                ✕
              </button>
            )}
          </form>
        )}

        {!canEdit && view.response && !answered && null}
        {!canEdit && !view.response && null}
      </div>
    </Shell>
  );
}

function Shell({ lang, setLang, children }: { lang: Lang; setLang: (l: Lang) => void; children: React.ReactNode }) {
  return (
    <div className="guest-wrap">
      <div className="langsw" role="group" aria-label={t(lang, 'language')}>
        <button aria-pressed={lang === 'en'} onClick={() => setLang('en')}>
          English
        </button>
        <button aria-pressed={lang === 'hi'} lang="hi" onClick={() => setLang('hi')}>
          हिन्दी
        </button>
      </div>
      <main className="guest-card" id="main" lang={lang}>
        {children}
      </main>
      <p className="muted" style={{ marginTop: '1rem', fontSize: '.8rem' }}>
        ShaadiCount
      </p>
    </div>
  );
}
