import { parse } from 'csv-parse/sync';
import { isValidEmail, normalizePhone } from '../common/phone';
import { csvUncell } from '../common/csv';

export interface ImportMapping {
  name?: string;
  phone?: string;
  email?: string;
  language?: string;
  group?: string;
  functions?: string;
  partySize?: string;
  tags?: string;
}
export interface RowError {
  field: string;
  message: string;
}
export interface ParsedRow {
  rowNumber: number;
  errors: RowError[];
  warnings: string[];
  data?: {
    name: string;
    phone: string | null;
    email: string | null;
    language: 'en' | 'hi';
    group: string | null;
    functionIds: string[];
    functionNames: string[];
    partySize: number;
    tags: string[];
  };
}
export const MAX_ROWS = 5000;
export const MAX_CSV_BYTES = 900_000;

const SYNONYMS: Record<keyof ImportMapping, string[]> = {
  name: ['name', 'guest name', 'full name', 'guest', 'display name'],
  phone: ['phone', 'mobile', 'whatsapp', 'phone number', 'mobile number', 'contact', 'contact number'],
  email: ['email', 'e-mail', 'email address'],
  language: ['language', 'lang', 'preferred language'],
  group: ['group', 'family', 'household', 'side'],
  functions: ['functions', 'events', 'invited to', 'function'],
  partySize: ['party size', 'party', 'size', 'count', 'guests', 'pax', 'seats'],
  tags: ['tags', 'tag'],
};

export class CsvError extends Error {}

export function detectMapping(headers: string[], override: ImportMapping = {}): ImportMapping {
  const out: ImportMapping = {};
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const key of Object.keys(SYNONYMS) as (keyof ImportMapping)[]) {
    const o = override[key];
    if (o) {
      if (!headers.includes(o)) throw new CsvError(`Mapped column "${o}" is not in the file`);
      out[key] = o;
      continue;
    }
    const i = lower.findIndex((h) => SYNONYMS[key].includes(h));
    if (i >= 0) out[key] = headers[i];
  }
  return out;
}

/** Parses and validates a guest CSV. Pure function: duplicates against the database are decided by the caller. */
export function parseGuestCsv(csv: string, override: ImportMapping | undefined, functionIdsByName: Map<string, string>) {
  if (Buffer.byteLength(csv) > MAX_CSV_BYTES) throw new CsvError('The CSV is larger than 900 KB. Split it into smaller files.');
  let records: Record<string, string>[];
  try {
    records = parse(csv, {
      columns: (h: string[]) => h.map((x) => x.trim()),
      skip_empty_lines: true,
      trim: true,
      bom: true,
      relax_column_count: false,
      max_record_size: 20_000,
    });
  } catch (e) {
    throw new CsvError(`Could not read the CSV: ${(e as Error).message.slice(0, 160)}`);
  }
  if (records.length === 0) throw new CsvError('The CSV has no data rows');
  if (records.length > MAX_ROWS) throw new CsvError(`The CSV has more than ${MAX_ROWS} rows. Split it into smaller files.`);
  const headers = Object.keys(records[0]);
  const mapping = detectMapping(headers, override);
  if (!mapping.name) throw new CsvError('Could not find a name column. Map one explicitly.');

  const rows: ParsedRow[] = records.map((rec, idx) => {
    const rowNumber = idx + 2; // header is row 1
    const errors: RowError[] = [];
    const warnings: string[] = [];
    const get = (k: keyof ImportMapping) => (mapping[k] ? csvUncell((rec[mapping[k]!] ?? '').trim()) : '');

    const name = get('name');
    if (!name) errors.push({ field: 'name', message: 'Name is required' });
    if (name.length > 160) errors.push({ field: 'name', message: 'Name is longer than 160 characters' });

    const rawPhone = get('phone');
    let phone: string | null = null;
    if (rawPhone) {
      phone = normalizePhone(rawPhone);
      if (!phone) errors.push({ field: 'phone', message: 'Phone must be a valid mobile number (10-digit Indian number or +country code)' });
    }
    const rawEmail = get('email').toLowerCase();
    let email: string | null = null;
    if (rawEmail) {
      if (isValidEmail(rawEmail)) email = rawEmail;
      else errors.push({ field: 'email', message: 'Email address is not valid' });
    }
    if (!rawPhone && !rawEmail) warnings.push('No contact details: you can still share the RSVP link manually');

    const lang = get('language').toLowerCase();
    let language: 'en' | 'hi' = 'en';
    if (lang) {
      if (['en', 'english'].includes(lang)) language = 'en';
      else if (['hi', 'hindi', 'हिंदी'].includes(lang)) language = 'hi';
      else errors.push({ field: 'language', message: 'Language must be English or Hindi' });
    }

    let partySize = 1;
    const ps = get('partySize');
    if (ps) {
      const n = Number(ps);
      if (!Number.isInteger(n) || n < 1 || n > 50)
        errors.push({ field: 'partySize', message: 'Party size must be a whole number from 1 to 50' });
      else partySize = n;
    }

    const functionNames: string[] = [];
    const functionIds: string[] = [];
    for (const raw of get('functions')
      .split(/[;|]/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      const id = functionIdsByName.get(raw.toLowerCase());
      if (!id) errors.push({ field: 'functions', message: `Unknown function "${raw.slice(0, 60)}"` });
      else if (!functionIds.includes(id)) {
        functionIds.push(id);
        functionNames.push(raw);
      }
    }
    const tags = get('tags')
      .split(/[;|,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10)
      .map((t) => t.slice(0, 40));
    const group = get('group').slice(0, 120) || null;

    return {
      rowNumber,
      errors,
      warnings,
      data: errors.length ? undefined : { name, phone, email, language, group, functionIds, functionNames, partySize, tags },
    };
  });
  return { headers, mapping, rows };
}
