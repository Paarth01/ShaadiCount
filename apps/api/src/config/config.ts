import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const secret = z.string().min(32, 'must be at least 32 characters');
const channelList = z
  .string()
  .transform((s) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(['whatsapp', 'sms', 'email'])));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  WEB_ORIGINS: z.string().default('http://localhost:3000'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  // Number of reverse proxies in front of the API (browser -> LB -> Next -> API is 2). REQUIRED in production:
  // a wrong value collapses every client into one rate-limit bucket (too low) or lets clients spoof their IP (too high).
  // An empty value (TRUST_PROXY=) counts as unset, not as 0.
  TRUST_PROXY: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(0).max(10).optional()),
  // Interactive API docs and /v1/openapi.json. Default: on outside production, off in production.
  DOCS_ENABLED: bool.optional(),

  // Secrets: no defaults on purpose. Generate locally with scripts/gen-env.sh; use a secret manager elsewhere.
  CSRF_SECRET: secret,
  RSVP_TOKEN_SECRET: secret,
  PSEUDONYM_SECRET: secret,
  // Key for opt-out suppression hashes. Falls back to PSEUDONYM_SECRET so existing hashes stay valid. Set it once and
  // NEVER rotate it without re-hashing communication_suppressions, or opted-out contacts become messageable again.
  SUPPRESSION_HASH_SECRET: secret.optional(),
  MESSAGING_WEBHOOK_SECRET: secret.optional(),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).default(168),
  SESSION_IDLE_HOURS: z.coerce.number().int().min(1).default(24),

  // Rate limits (per minute, per key). Tests lower these.
  RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_REGISTER_PER_MIN: z.coerce.number().int().min(1).default(5),
  RATE_LIMIT_LOGIN_EMAIL_PER_MIN: z.coerce.number().int().min(1).default(100),
  RATE_LIMIT_USER_PER_MIN: z.coerce.number().int().min(1).default(600),
  RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().int().min(1).default(120),
  RATE_LIMIT_PUBLIC_INVALID_PER_MIN: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_WEBHOOK_PER_MIN: z.coerce.number().int().min(1).default(600),

  // Messaging. Fake provider is the default; live is fail-closed.
  MESSAGING_MODE: z.enum(['fake', 'live']).default('fake'),
  LIVE_MESSAGING_ENABLED: bool.prefault('false'),
  LIVE_PROVIDER_NAME: z.string().optional(),
  LIVE_PROVIDER_CREDENTIALS_REF: z.string().optional(),
  LIVE_TEMPLATE_APPROVAL_REF: z.string().optional(),
  LIVE_CONSENT_POLICY_REF: z.string().optional(),
  LIVE_OPT_OUT_POLICY_REF: z.string().optional(),
  LIVE_SPEND_CAP_PAISE: z.coerce.number().int().min(1).optional(),
  ENABLED_CHANNELS: channelList.prefault('whatsapp,sms,email'),
  // Placeholder estimates for pre-send cost preview. NOT verified provider pricing.
  MESSAGE_COST_PAISE_WHATSAPP: z.coerce.number().int().min(0).default(80),
  MESSAGE_COST_PAISE_SMS: z.coerce.number().int().min(0).default(25),
  MESSAGE_COST_PAISE_EMAIL: z.coerce.number().int().min(0).default(5),
  MESSAGE_RATE_PER_MINUTE_PER_WORKSPACE: z.coerce.number().int().min(1).default(120),
  MESSAGE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  MESSAGE_BACKOFF_BASE_SECONDS: z.coerce.number().int().min(0).default(30),
  FAKE_PROVIDER_STORE_BODIES: bool.optional(),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(2000),

  DELETION_GRACE_DAYS: z.coerce.number().int().min(0).default(7),
  IMPORT_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  EXPORT_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
});

export type Config = Omit<z.infer<typeof schema>, 'FAKE_PROVIDER_STORE_BODIES' | 'TRUST_PROXY' | 'DOCS_ENABLED'> & {
  FAKE_PROVIDER_STORE_BODIES: boolean;
  TRUST_PROXY: number;
  DOCS_ENABLED: boolean;
  webOrigins: string[];
  isProd: boolean;
};

export class ConfigError extends Error {}

/** Validates the environment at startup. Throws (fails closed) on any problem. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ConfigError(`Invalid configuration: ${msg}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === 'production';
  if (isProd && c.TRUST_PROXY === undefined) {
    throw new ConfigError(
      'Invalid configuration: TRUST_PROXY must be set explicitly in production (number of reverse proxies in front of the API; ' +
        '0 only if clients connect to the API directly). See docs/devops/deployment.md.',
    );
  }
  if (isProd && c.PSEUDONYM_SECRET === c.CSRF_SECRET) {
    throw new ConfigError('Invalid configuration: PSEUDONYM_SECRET and CSRF_SECRET must be different values');
  }

  // Live messaging is disabled unless EVERY safeguard is configured. There is intentionally no silent fallback.
  if (c.LIVE_MESSAGING_ENABLED || c.MESSAGING_MODE === 'live') {
    const missing = (
      [
        ['MESSAGING_MODE=live', c.MESSAGING_MODE === 'live'],
        ['LIVE_PROVIDER_NAME', !!c.LIVE_PROVIDER_NAME],
        ['LIVE_PROVIDER_CREDENTIALS_REF', !!c.LIVE_PROVIDER_CREDENTIALS_REF],
        ['LIVE_TEMPLATE_APPROVAL_REF', !!c.LIVE_TEMPLATE_APPROVAL_REF],
        ['LIVE_CONSENT_POLICY_REF', !!c.LIVE_CONSENT_POLICY_REF],
        ['LIVE_OPT_OUT_POLICY_REF', !!c.LIVE_OPT_OUT_POLICY_REF],
        ['MESSAGING_WEBHOOK_SECRET', !!c.MESSAGING_WEBHOOK_SECRET],
        ['LIVE_SPEND_CAP_PAISE', !!c.LIVE_SPEND_CAP_PAISE],
      ] as const
    )
      .filter(([, ok]) => !ok)
      .map(([name]) => name);
    if (!c.LIVE_MESSAGING_ENABLED || missing.length) {
      throw new ConfigError(
        `Live messaging requested but safeguards are incomplete (${missing.join(', ') || 'LIVE_MESSAGING_ENABLED=true'}). ` +
          'Refusing to start; see docs/messaging/provider-integration.md release gate.',
      );
    }
  }

  const origins = c.WEB_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    ...c,
    TRUST_PROXY: c.TRUST_PROXY ?? 0,
    DOCS_ENABLED: c.DOCS_ENABLED ?? !isProd,
    FAKE_PROVIDER_STORE_BODIES: c.FAKE_PROVIDER_STORE_BODIES ?? !isProd,
    webOrigins: origins,
    isProd,
  };
}

export const CONFIG = Symbol('CONFIG');
