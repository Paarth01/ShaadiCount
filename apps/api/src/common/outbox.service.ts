import { Injectable } from '@nestjs/common';
import { Q } from './db.service';

/** Transactional outbox: events are written in the same transaction as the state change, relayed by the worker. */
@Injectable()
export class OutboxService {
  async enqueue(q: Q, e: { workspaceId: string | null; type: string; aggregateId: string; payload: Record<string, unknown> }) {
    await q.query(`INSERT INTO outbox_events (workspace_id, event_type, aggregate_id, payload) VALUES ($1,$2,$3,$4)`, [
      e.workspaceId,
      e.type,
      e.aggregateId,
      JSON.stringify(e.payload),
    ]);
  }
}
