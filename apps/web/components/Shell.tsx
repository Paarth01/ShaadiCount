'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api, wsPath } from '@/lib/api';
import { roleCan, useAuth, type Role } from '@/lib/auth';
import { ErrorBanner, useLoad } from './ui';
import { ICal, IGear, IHome, IUsers } from './icons';

interface WsCtx {
  id: string;
  name: string;
  role: Role;
  details: any;
}
const WorkspaceContext = createContext<WsCtx | null>(null);
export const useWorkspace = () => {
  const c = useContext(WorkspaceContext);
  if (!c) throw new Error('useWorkspace outside shell');
  return c;
};

export function WorkspaceShell({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const { status, user, workspaces, logout } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const ref = workspaces.find((w) => w.id === workspaceId);
  const { data: details, error } = useLoad(() => (ref ? api.get(wsPath(workspaceId)) : Promise.resolve(null)), [workspaceId, ref?.id]);

  useEffect(() => {
    if (status === 'anon') router.replace('/login');
  }, [status, router]);
  if (status === 'loading')
    return (
      <div className="auth-wrap">
        <div className="skel" style={{ width: 200, height: 24 }} />
      </div>
    );
  if (status === 'anon') return null;
  if (!ref)
    return (
      <div className="auth-wrap">
        <div className="card auth-card">
          <h1>Workspace not found</h1>
          <p className="muted">It may not exist, or you may not have access.</p>
          <Link className="btn primary" href="/">
            Go to my workspaces
          </Link>
        </div>
      </div>
    );

  const r = ref.role;
  const base = `/w/${workspaceId}`;
  const items = [
    { href: base, label: 'Overview', icon: <IHome />, show: true, exact: true },
    { href: `${base}/events`, label: 'Events', icon: <ICal />, show: true },
    { href: `${base}/team`, label: 'Team', icon: <IUsers />, show: roleCan.manage(r) },
    { href: `${base}/settings`, label: 'Settings', icon: <IGear />, show: roleCan.manage(r) },
  ].filter((i) => i.show);
  const active = (i: { href: string; exact?: boolean }) => (i.exact ? path === i.href : path.startsWith(i.href));
  const testMode = details?.messaging?.mode === 'fake';

  return (
    <WorkspaceContext.Provider value={{ id: workspaceId, name: ref.name, role: r, details }}>
      <div className="shell">
        <aside className="side" aria-label="Main">
          <Link href="/" className="brand">
            <span className="brand-mark">श</span>ShaadiCount
          </Link>
          <div className="muted" style={{ padding: '0 .75rem .6rem', fontSize: '.85rem' }}>
            <b style={{ color: 'var(--ink)' }}>{ref.name}</b>
            <br />
            {r.replace('_', ' ')}
          </div>
          {items.map((i) => (
            <Link key={i.href} href={i.href} className="navlink" aria-current={active(i) ? 'page' : undefined}>
              {i.icon}
              {i.label}
            </Link>
          ))}
          <div style={{ flex: 1 }} />
          {workspaces.length > 1 && (
            <Link href="/" className="navlink">
              Switch workspace
            </Link>
          )}
          <div className="muted" style={{ padding: '.5rem .75rem', fontSize: '.82rem' }}>
            {user?.displayName}
          </div>
          <button
            className="navlink"
            style={{ background: 'none', border: 0, font: 'inherit', cursor: 'pointer' }}
            onClick={async () => {
              await logout();
              router.replace('/login');
            }}
          >
            Log out
          </button>
        </aside>
        <main className="main" id="main">
          <div className="topbar" style={{ display: 'flex' }}>
            <Link href="/" className="brand" style={{ padding: 0 }} aria-label="ShaadiCount home">
              <span className="brand-mark">श</span>
              <span className="side-hide">ShaadiCount</span>
            </Link>
            <button
              className="btn sm ghost"
              style={{ display: 'inline-flex' }}
              onClick={async () => {
                await logout();
                router.replace('/login');
              }}
            >
              Log out
            </button>
          </div>
          {testMode && (
            <div className="test-banner" role="note">
              <b>Test mode.</b> Messages are simulated by a sandbox provider; nobody is contacted on WhatsApp, SMS or email.
            </div>
          )}
          <ErrorBanner error={error} />
          {children}
        </main>
        <nav className="bottomnav" aria-label="Main">
          {items.map((i) => (
            <Link key={i.href} href={i.href} aria-current={active(i) ? 'page' : undefined}>
              {i.icon}
              <span>{i.label}</span>
            </Link>
          ))}
        </nav>
      </div>
    </WorkspaceContext.Provider>
  );
}
