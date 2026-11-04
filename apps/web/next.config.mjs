import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// NOTE: rewrite destinations are evaluated at BUILD time in `next build`; set API_URL when building the image.
const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server for Docker (monorepo root is traced so workspace deps are included).
  output: 'standalone',
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), '../../'),
  poweredByHeader: false,
  // The browser only ever talks to this origin; /v1 is proxied to the API so the session cookie stays same-origin (SameSite=Lax, no CORS).
  async rewrites() {
    return [{ source: '/v1/:path*', destination: `${API_URL}/v1/:path*` }];
  },
  async headers() {
    const dev = process.env.NODE_ENV !== 'production';
    // Conservative CSP. Next injects inline bootstrap scripts, so script-src needs 'unsafe-inline' unless a per-request nonce is
    // wired through middleware; that stricter mode could not be verified in a real browser here (see docs/security/known-limitations.md).
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: csp },
    ];
    return [
      { source: '/:path*', headers: common },
      // Guest RSVP page: never indexed, never cached.
      {
        source: '/r',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};
export default nextConfig;
