import { describe, expect, it } from 'vitest';
import { safeNextPath, shouldRedirectOnUnauthorized } from '@/lib/api';

describe('expired-session redirect (B4)', () => {
  it('redirects on 401 for signed-in app pages', () => {
    expect(shouldRedirectOnUnauthorized('/v1/workspaces/abc/events', '/w/abc/events')).toBe(true);
  });
  it('never redirects from login, register, the public RSVP page, or for auth/public endpoints', () => {
    expect(shouldRedirectOnUnauthorized('/v1/workspaces/abc', '/login')).toBe(false);
    expect(shouldRedirectOnUnauthorized('/v1/workspaces/abc', '/register')).toBe(false);
    expect(shouldRedirectOnUnauthorized('/v1/workspaces/abc', '/r')).toBe(false);
    expect(shouldRedirectOnUnauthorized('/v1/auth/me', '/w/abc')).toBe(false);
    expect(shouldRedirectOnUnauthorized('/v1/public/rsvp/x', '/w/abc')).toBe(false);
  });
});

describe('post-login redirect target', () => {
  it('allows same-origin absolute paths only (no open redirect)', () => {
    expect(safeNextPath('/w/abc/events')).toBe('/w/abc/events');
    for (const bad of [
      '//evil.example',
      'https://evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/login',
      '/register',
      '',
      null,
      undefined,
    ]) {
      expect(safeNextPath(bad as string | null | undefined)).toBe('/');
    }
  });
});
