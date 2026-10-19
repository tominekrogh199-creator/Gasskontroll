// Regelbasert uttrekk fra rapporttekst. Tåler at tabeller kommer ut stokket, med etiketter og verdier på ulike linjer.
// Faste felt hentes med regulære uttrykk (sikkerhet høy). Resten med enkle regler (sikkerhet middels).
// Ukjent verdi gir null og sikkerhet lav – aldri en gjetning.
import type { Confidence } from './types';
import { parseNorDate, fmtDate, quarterEnd } from './dates';

export const FIELD_KEYS = [
  'objectId', 'controlDate', 'reportDate', 'nextDueQ', 'nextDueYear', 'orgNr', 'email', 'phone',
  'customer', 'street', 'postcode', 'place', 'gnr', 'bnr', 'ownerName', 'clientName', 'representativeName',
  'controlType', 'gasType', 'facilityType', 'objectType', 'installedYear', 'tankNumber', 'tankVolume', 'tankInServiceYear',
  'scope', 'description', 'servicePartner', 'inspector', 'summary', 'lastIndependentReport',
] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];

export const REGEX_FIELDS: FieldKey[] = ['objectId', 'controlDate', 'reportDate', 'nextDueQ', 'nextDueYear', 'orgNr', 'email', 'phone', 'postcode'];

export const FIELD_LABEL: Record<FieldKey, string> = {
  objectId: 'Objekt ID', controlDate: 'Dato kontroll', reportDate: 'Dato rapport', nextDueQ: 'Neste frist – kvartal', nextDueYear: 'Neste frist – år',
  orgNr: 'Org.nr.', email: 'E-post', phone: 'Telefon', customer: 'Kunde', street: 'Gateadresse', postcode: 'Postnr.', place: 'Sted',
  gnr: 'Gnr.', bnr: 'Bnr.', ownerName: 'Eier', clientName: 'Oppdragsgiver', representativeName: 'Representant', controlType: 'Type kontroll',
  gasType: 'Type gass', facilityType: 'Type anlegg', objectType: 'Type objekt', installedYear: 'Anlegg installert', tankNumber: 'Tanknummer',
  tankVolume: 'Volum', tankInServiceYear: 'Tank tatt i bruk', scope: 'Omfang', description: 'Beskrivelse', servicePartner: 'Servicepartner',
  inspector: 'Inspektør', summary: 'Sammendrag', lastIndependentReport: 'Siste uavhengige kontroll',
};

export interface FieldValue { value: string | null; confidence: Confidence; source: 'regex' | 'regel' | 'ai' | 'manuell'; line?: string }

export interface DocRow { name: string; author: string | null; dated: string[]; received: string | null; raw: string }

export interface ParsedReport {
  fields: Record<FieldKey, FieldValue>;
  emailRole: 'representant' | 'oppdragsgiver' | 'eier' | null;
  remarks: { text: string; severity: 'avvik' | 'anbefaling' | null }[];
  documents: DocRow[];
  flags: string[];
  excerpt: string;
}

const DATE = /(\d{1,2}\.\d{1,2}\.\d{4})/;
const DATE_G = /(\d{1,2}\.\d{1,2}\.\d{4})/g;

function cells(line: string): string[] {
  return line.split('|').map((c) => c.trim());
}

function flatten(text: string): string {
  return text.replace(/\|/g, ' ').replace(/[ \t]+/g, ' ');
}

/** Velger ut de delene av rapporten som er relevante for planlegging: side 1–2 og merknadene i sjekklisten. */
export function relevantExcerpt(fullText: string): string {
  const lines = fullText.split(/\r?\n/);
  const side2 = lines.findIndex((l) => /Side\s*2\s*av\s*\d/i.test(l));
  const head = side2 >= 0 ? lines.slice(0, side2 + 1) : lines.slice(0, 120);
  const mi = lines.findIndex((l) => /Merknader i sjekklisten/i.test(l));
  let tail: string[] = [];
  if (mi >= 0 && mi > side2) {
    tail = lines.slice(mi, mi + 40);
    const stop = tail.findIndex((l, i) => i > 0 && /^(Side\s*\d+\s*av|Signatur|Underskrift)/i.test(l.trim()));
    if (stop > 0) tail = tail.slice(0, stop);
  }
  return [...head, ...tail].join('\n');
}

export function parseReport(fullText: string): ParsedReport {
  const text = relevantExcerpt(fullText);
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const flat = flatten(text);
  const f = {} as Record<FieldKey, FieldValue>;
  for (const k of FIELD_KEYS) f[k] = { value: null, confidence: 'lav', source: 'regel' };
  const setRx = (k: FieldKey, v: string | null | undefined, line?: string) => {
    if (v) f[k] = { value: v.trim(), confidence: 'høy', source: 'regex', line };
    else f[k] = { value: null, confidence: 'lav', source: 'regex' };
  };
  const setRule = (k: FieldKey, v: string | null | undefined, conf: Confidence = 'middels', line?: string) => {
    if (v && v.trim()) f[k] = { value: v.trim(), confidence: conf, source: 'regel', line };
  };
  const lineWith = (re: RegExp) => lines.find((l) => re.test(l));

  // ---- Faste felt (regex) ----
  setRx('objectId', flat.match(/Objekt\s*ID:?\s*(\d{3,})/i)?.[1], lineWith(/Objekt\s*ID/i));
  const cd = flat.match(/Dato\s+kontroll:?\s*(\d{1,2}\.\d{1,2}\.\d{4})/i)?.[1];
  const rd = flat.match(/Dato\s+rapport:?\s*(\d{1,2}\.\d{1,2}\.\d{4})/i)?.[1];
  setRx('controlDate', cd, lineWith(/Dato\s+kontroll/i));
  setRx('reportDate', rd, lineWith(/Dato\s+rapport/i));
  const ni = flat.search(/Neste\s+akkrediterte\s+kontroll/i);
  const due = ni >= 0 ? flat.slice(ni, ni + 400).match(/([1-4])\.\s*kvartal\s*(\d{4})/i) : null;
  setRx('nextDueQ', due?.[1], lineWith(/kvartal\s*\d{4}/i));
  setRx('nextDueYear', due?.[2], lineWith(/kvartal\s*\d{4}/i));
  setRx('orgNr', flat.match(/Org\.?\s*nr\.?:?\s*(\d{3}\s?\d{3}\s?\d{3})\b/i)?.[1]?.replace(/\s/g, ''), lineWith(/Org\.?\s*nr/i));
  const email = flat.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0];
  setRx('email', email, lineWith(/@/));
  const phone = flat.match(/Telefon(?:nr)?\.?:?\s*((?:\+47\s*)?\d{2}\s?\d{2}\s?\d{2}\s?\d{2})\b/i)?.[1]?.replace(/\s/g, '');
  setRx('phone', phone, lineWith(/Telefon/i));

  // ---- Anleggsadresse: første «gate nr, postnr sted» etter etiketten «Adresse» ----
  const ai = lines.findIndex((l) => /^\|?\s*Adresse\b/i.test(l));
  const addrRe = /^([^|,]*?[A-Za-zæøåÆØÅ][^|,]*?\s\d+\s*[A-Za-z]?),\s*(\d{4})\s+([A-ZÆØÅ][\wæøåÆØÅ\- ]*?)\s*$/;
  let addrLine: string | undefined;
  for (let i = Math.max(0, ai); i < Math.min(lines.length, (ai >= 0 ? ai : 0) + 6); i++) {
    if (addrRe.test(lines[i])) { addrLine = lines[i]; break; }
  }
  if (!addrLine) addrLine = lines.find((l) => addrRe.test(l));
  const am = addrLine?.match(addrRe);
  setRule('street', am?.[1], 'middels', addrLine);
  setRx('postcode', am?.[2], addrLine);
  setRule('place', am?.[3], 'middels', addrLine);

  // ---- Kunde: navnelinjen rett før «Adresse» ----
  if (ai > 0) {
    const cand = lines[ai - 1];
    if (cand && !cand.includes('|') && !/\d/.test(cand) && !/:/.test(cand)) setRule('customer', cand, 'middels', cand);
  }

  // ---- Gnr./Bnr. ----
  const gi = lines.findIndex((l) => /Gnr\.?/i.test(l));
  if (gi >= 0) {
    const same = lines[gi].match(/Gnr\.?\s*:?\s*(\d+)\s*[/ ]\s*Bnr\.?\s*:?\s*(\d+)/i);
    if (same) { setRule('gnr', same[1], 'middels', lines[gi]); setRule('bnr', same[2], 'middels', lines[gi]); }
    else {
      const next = lines.slice(gi + 1, gi + 3).find((l) => /^\|?\s*\d+\s*[/ ]\s*\d+/.test(l));
      const m = next?.match(/^\|?\s*(\d+)\s*[/ ]\s*(\d+)/);
      if (m) { setRule('gnr', m[1], 'middels', next); setRule('bnr', m[2], 'middels', next); }
    }
  }

  // ---- Roller ----
  const cellAfter = (re: RegExp): { v: string; line: string } | null => {
    for (const l of lines) {
      const cs = cells(l);
      const i = cs.findIndex((c) => re.test(c));
      if (i >= 0) {
        const inline = cs[i].replace(re, '').trim();
        if (inline) return { v: inline, line: l };
        const v = cs.slice(i + 1).find((c) => c && !/:$/.test(c));
        if (v) return { v, line: l };
      }
    }
    return null;
  };
  const owner = cellAfter(/^Eier(:|$)/i);
  const client = cellAfter(/^Oppdragsgiver(:|$)/i);
  if (owner && !/:/.test(owner.v)) setRule('ownerName', owner.v, 'middels', owner.line);
  if (client && !/:/.test(client.v)) setRule('clientName', client.v, 'middels', client.line);
  const ri = lines.findIndex((l) => /Oppdragsgivers/i.test(l));
  let emailRole: ParsedReport['emailRole'] = null;
  if (ri >= 0) {
    for (const l of lines.slice(ri, ri + 3)) {
      const name = cells(l).find((c) => c && !c.includes(':') && !c.includes('@') && !/^Oppdragsgivers|^representant/i.test(c) && /^[A-ZÆØÅ][\wæøå.\- ]+$/.test(c));
      if (name) {
        setRule('representativeName', name, 'middels', l);
        if (email && l.includes(email)) emailRole = 'representant';
        break;
      }
    }
  }
  if (email && !emailRole) emailRole = client ? 'oppdragsgiver' : 'eier';
  // Samme navn i flere kilder øker sikkerheten.
  const names = [f.customer.value, f.ownerName.value, f.clientName.value].filter(Boolean);
  if (f.customer.value && names.filter((n) => n === f.customer.value).length >= 2) f.customer.confidence = 'høy';
  if (!f.customer.value) setRule('customer', f.clientName.value ?? f.ownerName.value, 'lav');

  // ---- Avkrysninger ----
  const tk = lines.find((l) => /Type kontroll/i.test(l));
  if (tk) {
    const toks = tk.replace(/\|/g, '  ').split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
    const xi = toks.findIndex((x) => x === 'X' || x === 'x');
    if (xi > 0 && !/Type kontroll/i.test(toks[xi - 1])) setRule('controlType', toks[xi - 1], 'middels', tk);
  }
  for (const l of lines) {
    const cs = cells(l);
    for (let i = 0; i < cs.length - 1; i++) {
      if (/^(LPG|CNG\s*\/\s*Naturgass|Naturgass|Biogass)$/i.test(cs[i]) && /^x$/i.test(cs[i + 1])) setRule('gasType', cs[i], 'middels', l);
    }
  }
  const fa = cellAfter(/^Type anlegg:?/i);
  if (fa) setRule('facilityType', fa.v, 'middels', fa.line);
  setRule('inspector', text.match(/Inspeksjonen er utført av:\s*(.+)$/im)?.[1]);
  const si = lines.findIndex((l) => /^Sammendrag og konklusjon/i.test(l));
  if (si >= 0) setRule('summary', lines[si + 1], 'middels', lines[si + 1]);

  // ---- Objekt ----
  const oi = lines.findIndex((l) => /^Type objekt:/i.test(l));
  if (oi >= 0 && lines[oi + 1]) {
    const toks = lines[oi + 1].split(/\s+/);
    const yr = toks[toks.length - 1].match(/^(19|20)\d{2}$/)?.[0];
    setRule('objectType', toks[0], 'middels', lines[oi + 1]);
    if (yr) setRule('installedYear', yr, 'middels', lines[oi + 1]);
  }

  // ---- Tank ----
  const tankLine = lines.find((l) => /[1-4]\.\s*kvartal\s*\d{4}/i.test(l));
  const tm = tankLine?.match(/[1-4]\.\s*kvartal\s*\d{4}\s+(\S+)\s+([\d.,]+\s*m3)\s+((?:19|20)\d{2})/i);
  if (tm) {
    setRule('tankNumber', tm[1], 'middels', tankLine);
    setRule('tankVolume', tm[2].replace(/\s+/g, ' '), 'middels', tankLine);
    setRule('tankInServiceYear', tm[3], 'middels', tankLine);
  }

  // ---- Omfang og beskrivelse ----
  const omi = lines.findIndex((l) => /^Omfang av kontrollen/i.test(l));
  if (omi >= 0) {
    const sc = lines[omi].match(/beskriv:\s*(.+)$/i)?.[1];
    setRule('scope', sc ?? (/Hele:\s*X/i.test(lines[omi]) ? 'Hele anlegget' : null), 'middels', lines[omi]);
    const desc = lines[omi + 1];
    if (desc && !/^Dokumentnavn/i.test(desc)) setRule('description', desc.match(/^[^.]+\./)?.[0] ?? desc, 'middels', desc);
  }

  // ---- Dokumenter (stokket tabell) ----
  const documents = parseDocuments(lines);
  const svc = documents.find((d) => /service/i.test(d.name) && d.author) ?? documents.find((d) => d.author);
  if (svc?.author) setRule('servicePartner', svc.author, 'middels', svc.raw);
  const li = text.match(/Siste uavhengige kontroll\s*[–-]\s*rapportdato:\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
  setRule('lastIndependentReport', li?.[1], 'middels');

  // ---- Merknader ----
  const remarks = parseRemarks(lines);

  const parsed: ParsedReport = { fields: f, emailRole, remarks, documents, flags: [], excerpt: text };
  parsed.flags = validate(parsed);
  return parsed;
}

function parseDocuments(lines: string[]): DocRow[] {
  const start = lines.findIndex((l) => /^Dokumentnavn/i.test(l));
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^(Siste uavhengige|Side\s*\d)/i.test(l));
  if (end < 0) end = Math.min(lines.length, start + 15);
  const rows: DocRow[] = [];
  let pendingStart: string | null = null; // «08.08.2024-» venter på sluttdato på egen linje
  for (const l of lines.slice(start + 1, end)) {
    if (!l) continue;
    const onlyDateStart = l.match(/^(\d{1,2}\.\d{1,2}\.\d{4})\s*[-–]$/);
    if (onlyDateStart) { pendingStart = onlyDateStart[1]; continue; }
    const onlyDate = l.match(/^(\d{1,2}\.\d{1,2}\.\d{4})$/);
    if (onlyDate) {
      const last = rows[rows.length - 1];
      if (last) last.dated.push(onlyDate[1]);
      continue;
    }
    const nm = l.match(/^([A-ZÆØÅ][a-zæøå\-]+(?:\s+[a-zæøå\-]+)*)\s+(.*)$/);
    if (!nm) continue;
    const rest = nm[2];
    const dates = rest.match(DATE_G) ?? [];
    const author = rest.match(/^(.+?\s(?:AS|ASA|ANS|DA|SA))\b/)?.[1] ?? null;
    const row: DocRow = { name: nm[1], author, dated: [], received: null, raw: l };
    if (pendingStart) {
      row.dated.push(pendingStart);
      pendingStart = null;
      row.received = dates[dates.length - 1] ?? null;
      if (dates.length > 1) row.dated.push(...dates.slice(0, -1));
    } else if (dates.length >= 2) {
      row.dated.push(...dates.slice(0, -1));
      row.received = dates[dates.length - 1];
    } else if (dates.length === 1) {
      row.dated.push(dates[0]);
    }
    rows.push(row);
  }
  return rows;
}

function parseRemarks(lines: string[]): ParsedReport['remarks'] {
  const mi = lines.findIndex((l) => /Merknader i sjekklisten/i.test(l));
  if (mi < 0) return [];
  const items: string[] = [];
  for (const l of lines.slice(mi + 1)) {
    if (!l) continue;
    if (/^Side\s*\d/i.test(l)) break;
    if (/^\d{1,3}\.\s/.test(l)) items.push(l);
    else if (items.length) items[items.length - 1] += ' ' + l;
  }
  return items.map((t) => {
    const severity = /\bAvvik\b/.test(t) ? 'avvik' : /\b[Bb]ør\b/.test(t) ? 'anbefaling' : null;
    const short = t.length > 160 ? t.slice(0, 157).trimEnd() + '…' : t;
    return { text: short, severity };
  });
}

/** Validerer datoer. Ulogiske datoer flagges – de rettes aldri automatisk. */
export function validate(p: ParsedReport): string[] {
  const flags: string[] = [];
  const f = p.fields;
  const iso = (k: FieldKey) => {
    const v = f[k].value;
    if (!v) return null;
    const d = parseNorDate(v);
    if (!d) flags.push(`${FIELD_LABEL[k]} «${v}» er ikke en gyldig dato`);
    return d;
  };
  const cd = iso('controlDate');
  const rd = iso('reportDate');
  if (cd && rd && rd < cd) flags.push(`Rapportdato ${fmtDate(rd)} er før kontrolldato ${fmtDate(cd)}`);
  const q = Number(f.nextDueQ.value);
  const y = Number(f.nextDueYear.value);
  if (cd && q && y) {
    const end = quarterEnd({ q: q as 1, year: y });
    if (end <= cd) flags.push(`Neste frist ${q}. kvartal ${y} er ikke etter kontrolldato ${fmtDate(cd)}`);
  }
  if (!f.nextDueQ.value) flags.push('Fant ikke neste frist – må fylles inn');
  for (const d of p.documents) {
    const rec = d.received ? parseNorDate(d.received) : null;
    for (const raw of d.dated) {
      const dd = parseNorDate(raw);
      if (!dd) { flags.push(`${d.name}: «${raw}» er ikke en gyldig dato`); continue; }
      if (rec && dd > rec) flags.push(`${d.name}: datert ${fmtDate(dd)} er etter mottatt ${fmtDate(rec)} (ulogisk dato)`);
      else if (rd && dd > rd) flags.push(`${d.name}: datert ${fmtDate(dd)} er etter rapportdato ${fmtDate(rd)} (ulogisk dato)`);
    }
    if (rec && rd && rec > rd) flags.push(`${d.name}: mottatt ${fmtDate(rec)} er etter rapportdato ${fmtDate(rd)}`);
  }
  const li = f.lastIndependentReport.value ? parseNorDate(f.lastIndependentReport.value) : null;
  if (li && cd && li > cd) flags.push(`Siste uavhengige kontroll ${fmtDate(li)} er etter denne kontrollen`);
  return flags;
}

export { DATE };
