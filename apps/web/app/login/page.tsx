'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, ErrorBanner, TextField } from '@/components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/');
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
