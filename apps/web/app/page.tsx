'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const { status, workspaces, logout } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'anon') router.replace('/login');
    if (status === 'authed' && workspaces.length === 1) router.replace(`/w/${workspaces[0].id}`);
  }, [status, workspaces, router]);
  if (status !== 'authed')
    return (
      <div className="auth-wrap">
        <div className="skel" style={{ width: 200, height: 24 }} />
      </div>
    );
  return (
    <div className="auth-wrap">
      <div className="card auth-card" id="main">
        <h1>Your workspaces</h1>
        {workspaces.length === 0 && (
          <p className="muted">You are not part of a workspace yet. Ask an owner to add you, or create your own.</p>
        )}
        <ul className="list">
          {workspaces.map((w) => (
            <li key={w.id}>
              <Link className="btn block" href={`/w/${w.id}`}>
                {w.name} <span className="muted">· {w.role.replace('_', ' ')}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="row" style={{ marginTop: '1rem' }}>
          <Link className="btn primary" href="/new">
            New workspace
          </Link>
          <button
            className="btn ghost"
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
