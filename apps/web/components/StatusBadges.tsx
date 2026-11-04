import { Badge } from './ui';
export function RsvpBadge({ status }: { status: string | null | undefined }) {
  switch (status) {
    case 'yes':
      return <Badge tone="ok">Yes</Badge>;
    case 'no':
      return <Badge tone="bad">No</Badge>;
    case 'maybe':
      return <Badge tone="warn">Maybe</Badge>;
    case 'revoked':
      return <Badge>Revoked</Badge>;
    default:
      return <Badge>Awaiting</Badge>;
  }
}
export function MsgBadge({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  const tone = (
    {
      delivered: 'ok',
      read: 'ok',
      submitted: 'info',
      failed: 'bad',
      unknown: 'warn',
      skipped: 'warn',
      cancelled: 'bad',
      scheduled: 'info',
      queued: 'info',
    } as Record<string, any>
  )[status];
  return <Badge tone={tone}>{status}</Badge>;
}
export function StatusPill({ status }: { status: string }) {
  const tone = (
    {
      active: 'ok',
      completed: 'info',
      cancelled: 'bad',
      archived: undefined,
      draft: 'warn',
      running: 'ok',
      scheduled: 'info',
      paused: 'warn',
    } as Record<string, any>
  )[status];
  return <Badge tone={tone}>{status}</Badge>;
}
export function ResponseBar({ yes, maybe, no }: { yes: number; maybe: number; no: number }) {
  const t = yes + maybe + no || 1;
  return (
    <div className="bar" role="img" aria-label={`${yes} yes, ${maybe} maybe, ${no} no`}>
      <i className="y" style={{ width: `${(yes / t) * 100}%` }} />
      <i className="m" style={{ width: `${(maybe / t) * 100}%` }} />
      <i className="n" style={{ width: `${(no / t) * 100}%` }} />
    </div>
  );
}
