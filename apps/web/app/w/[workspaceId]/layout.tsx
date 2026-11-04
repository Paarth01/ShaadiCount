'use client';
import { use, type ReactNode } from 'react';
import { WorkspaceShell } from '@/components/Shell';

export default function WorkspaceLayout({ children, params }: { children: ReactNode; params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = use(params);
  return <WorkspaceShell workspaceId={workspaceId}>{children}</WorkspaceShell>;
}
