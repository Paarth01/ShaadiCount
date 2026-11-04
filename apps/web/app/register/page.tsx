'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, ErrorBanner, TextField } from '@/components/ui';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [f, setF] = useState({ displayName: '', email: '', password: '', workspaceName: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ws = await register(f);
      router.replace(ws ? `/w/${ws}` : '/');
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', 'Could not register'));
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
        <h1>Create your account</h1>
        <ErrorBanner error={error && error.details.length === 0 ? error : null} />
        <TextField
          label="Your name"
          autoComplete="name"
          required
          value={f.displayName}
          onChange={set('displayName')}
          error={error?.fieldError('displayName')}
        />
        <TextField
          label="Workspace name"
          hint="Your planning business or family, e.g. “Sharma Weddings”"
          required
          value={f.workspaceName}
          onChange={set('workspaceName')}
          error={error?.fieldError('workspaceName')}
        />
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={f.email}
          onChange={set('email')}
          error={error?.fieldError('email')}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          hint="At least 10 characters. Avoid common passwords."
          value={f.password}
          onChange={set('password')}
          error={error?.fieldError('password')}
        />
        <Button type="submit" variant="primary" block busy={busy}>
          Create account
        </Button>
        <p className="muted" style={{ marginTop: '1rem' }}>
          Already registered? <Link href="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
