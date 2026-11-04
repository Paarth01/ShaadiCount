'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, safeNextPath } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, ErrorBanner, TextField } from '@/components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // Read after mount (not in the initial state) so server-rendered and client-rendered HTML match.
  const [expired, setExpired] = useState(false);
  useEffect(() => setExpired(new URLSearchParams(window.location.search).get('expired') === '1'), []);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace(safeNextPath(typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('next') : null));
    } catch (err) {
      setError(err instanceof ApiError ? err : new Error('Login failed'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit} id="main">
        <div className="brand" style={{ padding: 0, marginBottom: '.8rem' }}>
          <span className="brand-mark">श</span>ShaadiCount
        </div>
        <h1>Log in</h1>
        {expired && !error && (
          <p className="muted" role="status">
            Your session expired. Please log in again.
          </p>
        )}
        <ErrorBanner error={error} />
        <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={setEmail} />
        <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={setPassword} />
        <Button type="submit" variant="primary" block busy={busy}>
          Log in
        </Button>
        <p className="muted" style={{ marginTop: '1rem' }}>
          New here? <Link href="/register">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
