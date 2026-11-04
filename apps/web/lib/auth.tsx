'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setCsrf } from './api';

export type Role = 'owner' | 'organizer' | 'planner' | 'checkin_staff' | 'readonly' | 'caterer';
export interface WorkspaceRef {
  id: string;
  name: string;
  role: Role;
}
export interface User {
  id: string;
  email: string;
  displayName: string;
}
interface AuthState {
  status: 'loading' | 'anon' | 'authed';
  user: User | null;
  workspaces: WorkspaceRef[];
  login: (email: string, password: string) => Promise<void>;
  register: (i: { email: string; password: string; displayName: string; workspaceName: string }) => Promise<string | null>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}
const Ctx = createContext<AuthState | null>(null);
export const useAuth = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<User | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRef[]>([]);

  const refresh = useCallback(async () => {
    try {
      const me = await api.get('/v1/auth/me');
      setCsrf(me.csrfToken);
      setUser(me.user);
      setWorkspaces(me.workspaces);
      setStatus('authed');
    } catch {
      setCsrf('');
      setUser(null);
      setWorkspaces([]);
      setStatus('anon');
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      workspaces,
      refresh,
      login: async (email, password) => {
        const r = await api.post('/v1/auth/login', { email, password });
        setCsrf(r.csrfToken);
        await refresh();
      },
      register: async (i) => {
        const r = await api.post('/v1/auth/register', i);
        setCsrf(r.csrfToken);
        await refresh();
        return r.workspaceId as string | null;
      },
      logout: async () => {
        try {
          await api.post('/v1/auth/logout');
        } finally {
          setCsrf('');
          setUser(null);
          setWorkspaces([]);
          setStatus('anon');
        }
      },
    }),
    [status, user, workspaces, refresh],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Client-side mirror of the server role matrix, used ONLY to hide UI. The API enforces every rule. */
export const roleCan = {
  manage: (r: Role) => r === 'owner' || r === 'organizer',
  owner: (r: Role) => r === 'owner',
  guests: (r: Role) => ['owner', 'organizer', 'planner'].includes(r),
  edit: (r: Role) => ['owner', 'organizer', 'planner'].includes(r),
  dashboard: (r: Role) => ['owner', 'organizer', 'planner', 'readonly'].includes(r),
  catering: (r: Role) => ['owner', 'organizer', 'planner', 'readonly', 'caterer'].includes(r),
  checkin: (r: Role) => ['owner', 'organizer', 'planner', 'checkin_staff'].includes(r),
  createEvent: (r: Role) => r === 'owner' || r === 'organizer',
  messaging: (r: Role) => ['owner', 'organizer', 'planner'].includes(r),
};
