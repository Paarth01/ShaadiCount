/** Typed fetch wrapper for the ShaadiCount API (same-origin, cookie session + CSRF header). */
export interface FieldDetail {
  field?: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: FieldDetail[] = [],
    public extra: Record<string, any> = {},
    public requestId?: string,
  ) {
    super(message);
  }
  /** Message for `field` if the server rejected it, so forms can show inline errors. */
  fieldError(field: string) {
    return this.details.find((d) => d.field === field)?.message;
  }
}

let csrfToken = '';
export const setCsrf = (t: string) => {
  csrfToken = t;
};
export const newKey = () => `web-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

/** Login, register, session probes and the public guest RSVP page must never trigger the redirect. */
export function shouldRedirectOnUnauthorized(path: string, pathname: string | undefined = globalThis.location?.pathname): boolean {
  if (typeof pathname !== 'string') return false;
  if (path.startsWith('/v1/auth/') || path.startsWith('/v1/public/')) return false;
  return !(pathname.startsWith('/login') || pathname.startsWith('/register') || pathname === '/r' || pathname.startsWith('/r/'));
}

type Opts = { idempotencyKey?: string; signal?: AbortSignal };

async function request<T>(method: string, path: string, body?: unknown, o: Opts = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (o.idempotencyKey) headers['Idempotency-Key'] = o.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: o.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
  if (res.status === 401 && shouldRedirectOnUnauthorized(path)) {
    // The session expired or was revoked mid-use: send the person to sign in instead of leaving a page of error banners.
    globalThis.location?.assign(`/login?expired=1&next=${encodeURIComponent(globalThis.location.pathname)}`);
  }
  if (!res.ok) {
    const e = (data as any)?.error ?? {};
    const { code, message, details, requestId, ...extra } = e;
    throw new ApiError(res.status, code ?? 'ERROR', message ?? 'Something went wrong', details ?? [], extra, requestId);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string, o?: Opts) => request<T>('GET', p, undefined, o),
  post: <T = any>(p: string, b?: unknown, o?: Opts) => request<T>('POST', p, b ?? {}, o),
  put: <T = any>(p: string, b?: unknown, o?: Opts) => request<T>('PUT', p, b ?? {}, o),
  patch: <T = any>(p: string, b?: unknown, o?: Opts) => request<T>('PATCH', p, b ?? {}, o),
  del: <T = any>(p: string, o?: Opts) => request<T>('DELETE', p, undefined, o),
};

export const wsPath = (ws: string, rest = '') => `/v1/workspaces/${ws}${rest}`;
export const evPath = (ws: string, ev: string, rest = '') => `/v1/workspaces/${ws}/events/${ev}${rest}`;
export const fnPath = (ws: string, ev: string, fn: string, rest = '') => `/v1/workspaces/${ws}/events/${ev}/functions/${fn}${rest}`;

/** Post-login redirect target: same-origin absolute paths only (blocks open redirects such as //evil.example or https://...). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !/^\/(?!\/)[A-Za-z0-9\-._~/]*$/.test(next) || next.startsWith('/login') || next.startsWith('/register')) return '/';
  return next;
}
