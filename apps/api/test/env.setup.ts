import { randomBytes } from 'crypto';

// Fresh random secrets per test process: nothing secret is committed. DB URL comes from the environment or the documented local default.
const r = () => randomBytes(32).toString('hex');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://shaadicount:shaadicount_local_dev@localhost:5432/shaadicount_test';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.CSRF_SECRET ??= r();
process.env.RSVP_TOKEN_SECRET ??= r();
process.env.PSEUDONYM_SECRET ??= r();
process.env.MESSAGING_WEBHOOK_SECRET ??= r();
process.env.RATE_LIMIT_LOGIN_PER_MIN ??= '1000';
process.env.RATE_LIMIT_REGISTER_PER_MIN ??= '1000';
process.env.RATE_LIMIT_PUBLIC_PER_MIN ??= '1000';
process.env.RATE_LIMIT_PUBLIC_INVALID_PER_MIN ??= '1000';
process.env.MESSAGE_BACKOFF_BASE_SECONDS ??= '0';
process.env.FAKE_PROVIDER_STORE_BODIES ??= 'true';
