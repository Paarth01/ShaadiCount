import { LoggerService } from '@nestjs/common';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 } as const;
type Level = keyof typeof LEVELS;

const SENSITIVE_KEY = /(token|secret|password|authorization|cookie|phone|email|body|payload|credential)/i;
const SAFE_KEYS = new Set(['requestId', 'pgCode', 'errorName', 'errorMessage']);
// Public RSVP tokens travel in URL paths; never let them reach a log line.
const URL_TOKEN = /(\/public\/rsvp\/)[^/?\s]+/g;
const PHONE = /(?<![\w-])\+?\d[\d\s-]{8,}\d(?![\w-])/g;

export function redactString(s: string): string {
  return s.replace(URL_TOKEN, '$1[redacted]').replace(PHONE, '[redacted-number]');
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        SENSITIVE_KEY.test(k) && !SAFE_KEYS.has(k) ? '[redacted]' : SAFE_KEYS.has(k) && typeof v === 'string' ? v : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/** Structured JSON logger with mandatory redaction. */
export class AppLogger implements LoggerService {
  private threshold: number;
  constructor(
    level: Level = 'info',
    private readonly sink: (line: string) => void = (l) => process.stdout.write(l + '\n'),
  ) {
    this.threshold = LEVELS[level];
  }
  private write(level: Exclude<Level, 'silent'>, msg: unknown, ctx?: Record<string, unknown>) {
    if (LEVELS[level] < this.threshold) return;
    const text = typeof msg === 'string' ? redactString(msg) : JSON.stringify(redact(msg));
    this.sink(JSON.stringify({ ts: new Date().toISOString(), level, msg: text, ...(ctx ? (redact(ctx) as object) : {}) }));
  }
  log(m: unknown, ...rest: unknown[]) {
    this.write('info', m, this.ctx(rest));
  }
  info(m: unknown, ctx?: Record<string, unknown>) {
    this.write('info', m, ctx);
  }
  warn(m: unknown, ...rest: unknown[]) {
    this.write('warn', m, this.ctx(rest));
  }
  error(m: unknown, ...rest: unknown[]) {
    this.write('error', m, this.ctx(rest));
  }
  debug(m: unknown, ...rest: unknown[]) {
    this.write('debug', m, this.ctx(rest));
  }
  verbose(m: unknown, ...rest: unknown[]) {
    this.write('debug', m, this.ctx(rest));
  }
  private ctx(rest: unknown[]) {
    return rest.find((r) => r && typeof r === 'object') as Record<string, unknown> | undefined;
  }
}
