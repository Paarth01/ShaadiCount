'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, ErrorBanner, TextField, useAction } from '@/components/ui';

export default function NewWorkspace() {
  const { status, refresh } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const { busy, error, run } = useAction();
  useEffect(() => {
    if (status === 'anon') router.replace('/login');
  }, [status, router]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const w = await run(() => api.post('/v1/workspaces', { name }));
    if (w) {
      await refresh();
      router.replace(`/w/${w.id}`);
    }
  }
  return (
    <div className="auth-wrap">
      <form className="card auth-card" onSubmit={submit} id="main">
        <h1>New workspace</h1>
        <ErrorBanner error={error} />
        <TextField label="Workspace name" required value={name} onChange={setName} />
        <Button type="submit" variant="primary" block busy={busy}>
          Create
        </Button>
      </form>
    </div>
  );
}
