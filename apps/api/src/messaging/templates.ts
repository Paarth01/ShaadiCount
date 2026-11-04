import { DateTime } from 'luxon';

export type Lang = 'en' | 'hi';
export interface Template {
  key: string;
  version: number;
  kind: 'invitation' | 'reminder';
  variables: string[];
  body: Record<Lang, string>;
  /** Live providers (e.g. WhatsApp) require pre-approved templates. Nothing is approved in this repository. */
  approvedForLive: boolean;
}

export const TEMPLATES: Template[] = [
  {
    key: 'invitation_v1',
    version: 1,
    kind: 'invitation',
    approvedForLive: false,
    variables: ['guest_name', 'event_name', 'function_name', 'function_datetime', 'venue', 'rsvp_link'],
    body: {
      en: 'Namaste {{guest_name}}! You are invited to {{function_name}} ({{event_name}}) on {{function_datetime}} at {{venue}}. Please RSVP here: {{rsvp_link}} . Reply STOP to opt out of messages.',
      hi: 'नमस्ते {{guest_name}}! आपको {{event_name}} के {{function_name}} में {{function_datetime}} को {{venue}} पर आमंत्रित किया जाता है। कृपया यहाँ RSVP करें: {{rsvp_link}} । संदेश बंद करने के लिए STOP लिखें।',
    },
  },
  {
    key: 'reminder_v1',
    version: 1,
    kind: 'reminder',
    approvedForLive: false,
    variables: ['guest_name', 'event_name', 'function_name', 'rsvp_deadline', 'rsvp_link'],
    body: {
      en: 'Hello {{guest_name}}, a gentle reminder to RSVP for {{function_name}} ({{event_name}}) by {{rsvp_deadline}}: {{rsvp_link}} . Reply STOP to opt out of messages.',
      hi: 'नमस्ते {{guest_name}}, {{event_name}} के {{function_name}} के लिए {{rsvp_deadline}} तक RSVP करने का विनम्र अनुरोध: {{rsvp_link}} । संदेश बंद करने के लिए STOP लिखें।',
    },
  },
];

export const getTemplate = (key: string, version?: number) =>
  TEMPLATES.find((t) => t.key === key && (version === undefined || t.version === version));
export const defaultTemplateFor = (kind: 'invitation' | 'reminder') => TEMPLATES.find((t) => t.kind === kind)!;

const clean = (v: string) =>
  v
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 160);

/** Fills {{placeholders}}. Throws if a variable is missing; strips control characters from values. */
export function renderTemplate(t: Template, lang: Lang, vars: Record<string, string>): string {
  return t.body[lang].replace(/\{\{(\w+)\}\}/g, (_m, name) => {
    if (!t.variables.includes(name)) throw new Error(`Template ${t.key} uses unknown variable ${name}`);
    const v = vars[name];
    if (v === undefined || v === '') throw new Error(`Missing template variable ${name}`);
    return name === 'rsvp_link' ? v : clean(v);
  });
}

export function formatWhen(d: Date | null, tz: string, lang: Lang): string {
  if (!d) return '';
  return DateTime.fromJSDate(d, { zone: tz })
    .setLocale(lang === 'hi' ? 'hi' : 'en-IN')
    .toFormat('d LLL yyyy, h:mm a');
}
