import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CONFIG, Config } from '../config/config';
import { DbService } from '../common/db.service';
import { maskEmail, maskPhone } from '../common/phone';

export interface SendRequest {
  workspaceId: string;
  idempotencyKey: string;
  attempt: number;
  channel: 'whatsapp' | 'sms' | 'email';
  to: string; // E.164 phone or email address
  templateKey: string;
  templateVersion: number;
  language: 'en' | 'hi';
  body: string;
}
export type SendResult =
  | { outcome: 'accepted'; providerMessageId: string }
  | { outcome: 'transient_error'; code: string }
  | { outcome: 'permanent_error'; code: string }
  | { outcome: 'timeout' };

export interface MessagingProvider {
  readonly name: 'fake' | 'live';
  send(req: SendRequest): Promise<SendResult>;
}

/**
 * Deterministic sandbox provider. It never touches the network.
 *   recipient ends 0000 -> permanent failure        recipient ends 0001 -> transient failure on the 1st attempt
 *   recipient ends 0002 -> provider ACCEPTS then the call times out on the 1st attempt (retry dedupes by idempotency key)
 *   email starting "bounce@" -> permanent failure; everything else is accepted.
 */
@Injectable()
export class FakeProvider implements MessagingProvider {
  readonly name = 'fake' as const;
  constructor(
    private readonly db: DbService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async send(r: SendRequest): Promise<SendResult> {
    const tail = r.to.slice(-4);
    if (tail === '0000' || r.to.startsWith('bounce@')) return { outcome: 'permanent_error', code: 'FAKE_INVALID_RECIPIENT' };
    if (tail === '0001' && r.attempt === 1) return { outcome: 'transient_error', code: 'FAKE_TEMPORARY_FAILURE' };

    const created = await this.db.one<{ provider_message_id: string }>(
      `INSERT INTO fake_provider_messages (idempotency_key, provider_message_id, workspace_id, channel, to_masked, template_key, language, body)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING provider_message_id`,
      [
        r.idempotencyKey,
        `fake_${randomUUID()}`,
        r.workspaceId,
        r.channel,
        r.channel === 'email' ? maskEmail(r.to) : maskPhone(r.to),
        r.templateKey,
        r.language,
        this.cfg.FAKE_PROVIDER_STORE_BODIES ? r.body : null,
      ],
    );
    const row =
      created ??
      (await this.db.one<{ provider_message_id: string }>(
        `SELECT provider_message_id FROM fake_provider_messages WHERE idempotency_key=$1`,
        [r.idempotencyKey],
      ))!;
    if (tail === '0002' && r.attempt === 1) return { outcome: 'timeout' }; // accepted upstream, but we never saw the response
    return { outcome: 'accepted', providerMessageId: row.provider_message_id };
  }
}

/**
 * Placeholder for a real WhatsApp/SMS/email adapter. It is intentionally NOT implemented: no provider SDK, credentials
 * or verified template approvals exist in this repository, so it refuses every send (fail closed).
 */
@Injectable()
export class LiveProviderStub implements MessagingProvider {
  readonly name = 'live' as const;
  async send(): Promise<SendResult> {
    return { outcome: 'permanent_error', code: 'LIVE_PROVIDER_NOT_IMPLEMENTED' };
  }
}

@Injectable()
export class ProviderFactory {
  constructor(
    @Inject(CONFIG) private readonly cfg: Config,
    private readonly fake: FakeProvider,
    private readonly live: LiveProviderStub,
  ) {}
  /** Live is selected only if loadConfig() already verified every safeguard; otherwise the fake provider is used. */
  get(): MessagingProvider {
    return this.cfg.MESSAGING_MODE === 'live' && this.cfg.LIVE_MESSAGING_ENABLED ? this.live : this.fake;
  }
}
