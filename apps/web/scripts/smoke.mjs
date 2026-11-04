// HTTP smoke test against a RUNNING stack (web on WEB_URL proxying /v1 to the API). Needs no browser.
//   WEB_URL=http://localhost:3000 node scripts/smoke.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
let passed = 0;
const step = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
    throw e;
  }
};

let cookie = '';
let csrf = '';
const call = async (method, path, body, extra = {}) => {
  const headers = { Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (csrf && method !== 'GET' && !('X-CSRF-Token' in extra)) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(WEB + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    /* html */
  }
  return { res, text, json };
};

try {
  console.log(`Smoke testing ${WEB}`);
  await step('pages render with hardened headers', async () => {
    for (const p of ['/', '/login', '/register', '/r']) {
      const { res, text } = await call('GET', p);
      assert.equal(res.status, 200, `${p} status`);
      assert.match(text, /ShaadiCount|<html/i);
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(res.headers.get('x-frame-options'), 'DENY');
      assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
      assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
      assert.equal(res.headers.get('x-powered-by'), null);
    }
    const { res } = await call('GET', '/r');
    assert.match(res.headers.get('x-robots-tag') ?? '', /noindex/);
    assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  });
  await step('API is reachable through the same-origin proxy and never cached', async () => {
    const { res, json } = await call('GET', '/v1/health');
    assert.equal(res.status, 200);
    assert.equal(json.status, 'ok');
    assert.equal(res.headers.get('cache-control'), 'no-store');
  });
  await step('unauthenticated API access is rejected', async () => {
    const { res, json } = await call('GET', '/v1/workspaces');
    assert.equal(res.status, 401);
    assert.equal(json.error.code, 'UNAUTHENTICATED');
  });
  await step('guest endpoint gives identical 404s for junk tokens', async () => {
    const a = await call('GET', '/v1/public/rsvp/short');
    const b = await call('GET', `/v1/public/rsvp/${'A'.repeat(43)}`);
    assert.equal(a.res.status, 404);
    assert.equal(b.res.status, 404);
    assert.equal(a.json.error.message, b.json.error.message);
  });
  const email = `smoke-${randomUUID()}@example.test`;
  await step('register sets an HttpOnly SameSite cookie and returns a CSRF token', async () => {
    const { res, json } = await call('POST', '/v1/auth/register', {
      email,
      password: `Smoke-${randomUUID()}-Aa1`,
      displayName: 'Smoke Tester',
      workspaceName: 'Smoke Weddings',
    });
    assert.equal(res.status, 201, JSON.stringify(json));
    const sc = res.headers.getSetCookie().find((c) => c.startsWith('sc_session='));
    assert.ok(sc && /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), 'session cookie flags');
    cookie = sc.split(';')[0];
    csrf = json.csrfToken;
    globalThis.WS = json.workspaceId;
  });
  await step('mutations without a CSRF token are refused', async () => {
    const { res, json } = await call('POST', '/v1/workspaces', { name: 'x' }, { 'X-CSRF-Token': 'wrong' });
    assert.equal(res.status, 403);
    assert.equal(json.error.code, 'CSRF_TOKEN_INVALID');
  });
  const WS = globalThis.WS;
  let ev;
  let fn;
  let inv;
  await step('organizer creates an event, a function and a guest invitation over HTTP', async () => {
    ev = (await call('POST', `/v1/workspaces/${WS}/events`, { name: 'Smoke Wedding', timezone: 'Asia/Kolkata' })).json;
    assert.ok(ev.id);
    const f = await call('POST', `/v1/workspaces/${WS}/events/${ev.id}/functions`, {
      name: 'Reception',
      startsAt: '2030-02-10T19:00',
      rsvpDeadline: '2030-02-01T18:00',
      capacity: 50,
    });
    assert.equal(f.res.status, 201);
    fn = f.json;
    assert.equal(fn.startsAt, '2030-02-10T13:30:00.000Z');
    const g = await call('POST', `/v1/workspaces/${WS}/events/${ev.id}/guests`, {
      displayName: 'Smoke Guest',
      phone: '9812345675',
      invitations: [{ functionId: fn.id, partySize: 3 }],
    });
    assert.equal(g.res.status, 201);
    assert.ok(!JSON.stringify(g.json).includes('9812345675'), 'phone must be masked');
    const list = await call('GET', `/v1/workspaces/${WS}/events/${ev.id}/functions/${fn.id}/invitations`);
    inv = list.json.data[0];
  });
  let token;
  await step('guest opens the personal link and answers; answer shows on the organizer dashboard', async () => {
    const link = (await call('GET', `/v1/workspaces/${WS}/events/${ev.id}/functions/${fn.id}/invitations/${inv.id}/link`)).json.link;
    assert.match(link, /\/r#[A-Za-z0-9_-]{43}$/);
    token = link.split('#')[1];
    const guestCookie = cookie;
    cookie = ''; // act as an anonymous guest
    const view = await call('GET', `/v1/public/rsvp/${token}`);
    assert.equal(view.res.status, 200);
    assert.equal(view.json.guestName, 'Smoke Guest');
    assert.equal(view.json.state, 'open');
    const put = await call(
      'PUT',
      `/v1/public/rsvp/${token}/response`,
      { status: 'yes', adultCount: 2, childCount: 1, version: 0 },
      { 'Idempotency-Key': `smoke-${randomUUID()}` },
    );
    assert.equal(put.res.status, 201, JSON.stringify(put.json));
    assert.match(put.json.checkinCode, /^[A-Z2-9]{12}$/);
    cookie = guestCookie;
    const dash = (await call('GET', `/v1/workspaces/${WS}/events/${ev.id}/functions/${fn.id}/dashboard`)).json;
    assert.equal(dash.people.confirmedTotal, 3);
    assert.equal(dash.counts.yes, 1);
  });
  await step('API docs and OpenAPI JSON are served by the API', async () => {
    const r = await fetch((process.env.API_URL ?? 'http://localhost:4000') + '/v1/openapi.json');
    assert.equal(r.status, 200);
    assert.equal((await r.json()).info.title, 'ShaadiCount API');
  });
  await step('logout revokes the session', async () => {
    assert.equal((await call('POST', '/v1/auth/logout')).res.status, 204);
    assert.equal((await call('GET', '/v1/auth/me')).res.status, 401);
  });
  console.log(`\nSmoke test passed (${passed} checks).`);
} catch {
  console.error(`\nSmoke test FAILED after ${passed} passing checks.`);
  process.exit(1);
}
