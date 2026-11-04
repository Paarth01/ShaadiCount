'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import { ApiError } from '@/lib/api';

export function Button({
  variant,
  size,
  block,
  busy,
  children,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost'; size?: 'sm'; block?: boolean; busy?: boolean }) {
  return (
    <button
      {...p}
      disabled={p.disabled || busy}
      className={['btn', variant, size, block && 'block', p.className].filter(Boolean).join(' ')}
    >
      {busy ? 'Please wait…' : children}
    </button>
  );
}
export const Card = ({
  children,
  className = '',
  ...p
}: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...p} className={`card ${className}`}>
    {children}
  </div>
);
export const Badge = ({ tone, children }: { tone?: 'ok' | 'warn' | 'bad' | 'info' | 'brand'; children: ReactNode }) => (
  <span className={`badge ${tone ?? ''}`}>{children}</span>
);
export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="stat">
    <b>{value}</b>
    <span>{label}</span>
    {hint && <small style={{ display: 'block' }}>{hint}</small>}
  </div>
);
export const Spinner = () => (
  <div role="status" aria-live="polite" className="skel" style={{ height: 80 }}>
    <span className="sr-only">Loading</span>
  </div>
);
export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="empty">
    <b>{title}</b>
    {children}
  </div>
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string, errId: string | undefined) => ReactNode;
}) {
  const id = useId();
  const errId = error ? `${id}-e` : undefined;
  // Only the label text is inside <label>, so the control's accessible name is just the label; hint and error are outside it.
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id, errId)}
      {hint && <small className="muted">{hint}</small>}
      {error && (
        <div className="err" id={errId} role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
export function TextField({
  label,
  value,
  onChange,
  error,
  hint,
  type = 'text',
  ...p
}: { label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; type?: string } & Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'onChange' | 'value' | 'type'
>) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(id, errId) => (
        <input
          id={id}
          className="input"
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={errId}
          {...p}
        />
      )}
    </Field>
  );
}

export function ErrorBanner({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  return (
    <div className="banner bad" role="alert">
      <b>{e?.message ?? 'Something went wrong.'}</b>
      {e?.requestId && (
        <div>
          <small>Reference: {e.requestId}</small>
        </div>
      )}
      {onRetry && (
        <div style={{ marginTop: 6 }}>
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <div className="row between" style={{ marginBottom: '.6rem' }}>
          <h2 id={titleId} style={{ margin: 0 }}>
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>
        {children}
        {footer && (
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: '.8rem' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (t: T) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ---- toasts ----
const ToastCtx = createContext<(msg: string, tone?: 'ok' | 'bad') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string; tone: string }[]>([]);
  const push = useCallback((msg: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, msg, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'bad' ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`toast ${i.tone === 'bad' ? 'bad' : ''}`}>
            {i.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Loads data with loading/error/reload state; ignores stale responses. */
export function useLoad<T>(
  fn: () => Promise<T>,
  deps: unknown[],
): { data: T | null; error: unknown; loading: boolean; reload: () => void; setData: (d: T | null) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (live) setError(e);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn();
        if (ok) toast(ok);
        return r;
      } catch (e) {
        setError(e instanceof ApiError ? e : new ApiError(0, 'ERROR', (e as Error).message));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { busy, error, run, clear: () => setError(null) };
}

export function CopyButton({ text, label = 'Copy link' }: { text: () => Promise<string> | string; label?: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(await text());
          toast('Copied');
        } catch {
          toast('Could not copy. Long-press the link instead.', 'bad');
        }
      }}
    >
      {label}
    </Button>
  );
}

export function Confirm({
  title,
  body,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown> | void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { busy, error, run } = useAction();
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            busy={busy}
            onClick={async () => {
              const ok = await run(async () => {
                await onConfirm();
                return true;
              });
              if (ok) onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
      {children}
      <ErrorBanner error={error} />
    </Modal>
  );
}
