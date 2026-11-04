import { Inject, Injectable } from '@nestjs/common';
import { DbService, Q } from '../common/db.service';
import { CONFIG, Config } from '../config/config';
import { Channel, SuppressionService } from '../guests/suppression.service';

export type Audience = 'all_invited' | 'not_responded' | 'maybe' | 'not_yet_messaged';
export type ExclusionReason =
  | 'channel_disabled'
  | 'event_inactive'
  | 'function_inactive'
  | 'invitation_revoked'
  | 'already_responded'
  | 'not_in_audience'
  | 'already_messaged'
  | 'deadline_passed'
  | 'no_contact'
  | 'suppressed'
  | 'no_consent_evidence';

export interface Candidate {
  invitation_id: string;
  token_version: number;
  revoked_at: Date | null;
  invited_party_size: number;
  guest_id: string;
  display_name: string;
  phone_e164: string | null;
  email: string | null;
  preferred_language: 'en' | 'hi';
  guest_deleted_at: Date | null;
  rsvp_status: string | null;
  consent: string | null;
  ever_messaged: boolean;
  function_id: string;
  function_name: string;
  starts_at: Date;
  venue: string | null;
  rsvp_deadline: Date | null;
  fn_status: string;
  event_id: string;
  event_name: string;
  timezone: string;
  ev_status: string;
  group_label?: string | null;
}

export const contactFor = (c: Candidate, channel: Channel) => (channel === 'email' ? c.email : c.phone_e164);

@Injectable()
export class EligibilityService {
  constructor(
    private readonly db: DbService,
    private readonly suppression: SuppressionService,
    @Inject(CONFIG) private readonly cfg: Config,
  ) {}

  async candidates(q: Q, workspaceId: string, functionId: string, channel: Channel, invitationId?: string): Promise<Candidate[]> {
    return q.query<Candidate>(
      `SELECT i.id AS invitation_id, i.token_version, i.revoked_at, i.invited_party_size, g.id AS guest_id, g.display_name, g.phone_e164, g.email, g.preferred_language, g.deleted_at AS guest_deleted_at,
              r.status AS rsvp_status,
              (SELECT c.status FROM communication_consents c WHERE c.guest_id=g.id AND c.channel=$3 ORDER BY c.recorded_at DESC, c.id DESC LIMIT 1) AS consent,
              EXISTS (SELECT 1 FROM scheduled_messages m WHERE m.invitation_id=i.id AND m.status IN ('submitted','delivered','read')) AS ever_messaged,
              f.id AS function_id, f.name AS function_name, f.starts_at, f.venue, f.rsvp_deadline, f.status AS fn_status,
              e.id AS event_id, e.name AS event_name, e.timezone, e.status AS ev_status, gg.label AS group_label
         FROM event_invitations i JOIN guests g ON g.id=i.guest_id JOIN event_functions f ON f.id=i.event_function_id JOIN events e ON e.id=i.event_id
         LEFT JOIN guest_groups gg ON gg.id=g.guest_group_id LEFT JOIN rsvp_responses r ON r.invitation_id=i.id
        WHERE i.workspace_id=$1 AND i.event_function_id=$2 AND ($4::uuid IS NULL OR i.id=$4) ORDER BY g.display_name, i.id`,
      [workspaceId, functionId, channel, invitationId ?? null],
    );
  }

  /** Set of contact hashes currently suppressed for the channel (one query for the whole batch). */
  async suppressedContacts(q: Q, workspaceId: string, channel: Channel, rows: Candidate[]): Promise<Set<string>> {
    const hashes = new Map<string, string>();
    for (const r of rows) {
      const n = this.suppression.normalize(channel, contactFor(r, channel));
      if (n) hashes.set(this.suppression.hashContact(workspaceId, channel, n), n);
    }
    if (!hashes.size) return new Set();
    const found = await q.query<{ contact_hash: string }>(
      `SELECT contact_hash FROM communication_suppressions WHERE workspace_id=$1 AND channel=$2 AND lifted_at IS NULL AND contact_hash = ANY($3::text[])`,
      [workspaceId, channel, [...hashes.keys()]],
    );
    const bad = new Set<string>();
    for (const f of found) bad.add(hashes.get(f.contact_hash)!);
    return bad;
  }

  /**
   * Single source of truth for "may we message this invitation?" - used for preview, scheduling AND again at dispatch.
   * Never send merely because a number exists: consent evidence must be on file and no opt-out may be active.
   */
  reason(
    c: Candidate,
    o: { kind: 'invitation' | 'reminder'; channel: Channel; audience: Audience; now: Date; suppressedContacts: Set<string> },
  ): ExclusionReason | null {
    if (!this.cfg.ENABLED_CHANNELS.includes(o.channel)) return 'channel_disabled';
    if (['cancelled', 'archived', 'completed'].includes(c.ev_status)) return 'event_inactive';
    if (['cancelled', 'completed'].includes(c.fn_status)) return 'function_inactive';
    if (c.revoked_at || c.guest_deleted_at) return 'invitation_revoked';
    if (o.kind === 'reminder' && (c.rsvp_status === 'yes' || c.rsvp_status === 'no')) return 'already_responded';
    switch (o.audience) {
      case 'not_responded':
        if (c.rsvp_status) return 'already_responded';
        break;
      case 'maybe':
        if (c.rsvp_status !== 'maybe') return 'not_in_audience';
        break;
      case 'not_yet_messaged':
        if (c.ever_messaged) return 'already_messaged';
        break;
    }
    if (c.rsvp_deadline && c.rsvp_deadline <= o.now) return 'deadline_passed';
    const contact = this.suppression.normalize(o.channel, contactFor(c, o.channel));
    if (!contact) return 'no_contact';
    if (o.suppressedContacts.has(contact)) return 'suppressed';
    if (c.consent === 'revoked') return 'suppressed';
    if (c.consent !== 'granted') return 'no_consent_evidence';
    return null;
  }

  costPaise(channel: Channel): number {
    return channel === 'whatsapp'
      ? this.cfg.MESSAGE_COST_PAISE_WHATSAPP
      : channel === 'sms'
        ? this.cfg.MESSAGE_COST_PAISE_SMS
        : this.cfg.MESSAGE_COST_PAISE_EMAIL;
  }
}
