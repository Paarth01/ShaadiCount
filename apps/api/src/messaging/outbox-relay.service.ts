import { Injectable } from '@nestjs/common';
import { DbService, Q } from '../common/db.service';

type Handler = (
  q: Q,
  ev: { id: string; workspace_id: string | null; event_type: string; aggregate_id: string; payload: any },
) => Promise<void>;

/** Relays transactional-outbox events to in-process handlers with retry/backoff and dead-lettering. */
@Injectable()
export class OutboxRelayService {
  private handlers = new Map<string, Handler>([
    // An answered RSVP cancels reminders that have not gone out yet.
    [
      'rsvp.changed',
      async (q, ev) => {
        if (['yes', 'no'].includes(ev.payload.status)) {
          await q.query(
            `UPDATE scheduled_messages m SET status='cancelled', skip_reason='already_responded', locked_until=NULL, updated_at=now()
             FROM message_campaigns c WHERE m.campaign_id=c.id AND c.kind='reminder' AND m.invitation_id=$1 AND m.status IN ('scheduled','queued')`,
            [ev.payload.invitationId],
          );
        }
      },
    ],
    ['campaign.scheduled', async () => undefined],
  ]);
  constructor(private readonly db: DbService) {}

  register(type: string, h: Handler) {
    this.handlers.set(type, h);
  }

  async runOnce(now = new Date(), maxAttempts = 10): Promise<{ published: number; failed: number; deadLettered: number }> {
    const out = { published: 0, failed: 0, deadLettered: 0 };
    await this.db.tx(async (q) => {
      const evs = await q.query<any>(
        `SELECT * FROM outbox_events WHERE published_at IS NULL AND dead_lettered_at IS NULL AND next_attempt_at <= $1 ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
        [now],
      );
      for (const ev of evs) {
        await q.query('SAVEPOINT ev');
        try {
          const h = this.handlers.get(ev.event_type);
          if (h) await h(q, ev);
          await q.query(`UPDATE outbox_events SET published_at=now() WHERE id=$1`, [ev.id]);
          await q.query('RELEASE SAVEPOINT ev');
          out.published++;
        } catch (e) {
          await q.query('ROLLBACK TO SAVEPOINT ev');
          const attempts = ev.attempts + 1;
          const dead = attempts >= maxAttempts;
          await q.query(
            `UPDATE outbox_events SET attempts=$2, last_error=$3, next_attempt_at=$4, dead_lettered_at=CASE WHEN $5 THEN now() ELSE NULL END WHERE id=$1`,
            [
              ev.id,
              attempts,
              String((e as Error).message).slice(0, 200),
              new Date(now.getTime() + Math.min(2 ** attempts * 10, 3600) * 1000),
              dead,
            ],
          );
          out.failed++;
          if (dead) out.deadLettered++;
        }
      }
    });
    return out;
  }
}
