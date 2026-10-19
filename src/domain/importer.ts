// Import: rapport → anlegg, duplikathåndtering, gjennomgang, CSV og manuell registrering.
// Etter importen er appen sannheten – PDF-ene leses én gang.
import type { AppState, Confidence, Contact, Facility, Quarter } from './types';
import type { FieldKey, ParsedReport } from './reportParser';
import { compareQuarter, parseNorDate, fmtDate, fmtQuarter, nowStamp, quarterOf } from './dates';
import { complete, currentControl, logBoth, newControl, todayOf, uid } from './controls';
import { geocode } from '../adapters/geocode';

export const EXAMPLE_REPORT = `KONTROLL AV GASSANLEGG
| Objekt ID:      |          31417  |
| Dato kontroll:  | 27.02.2025      |
| Dato rapport:   | 25.03.2025      |
Kari Eksempel
| Adresse  |     |
Eksempelveien 12, 1814 Askim
| Gnr.  Bnr.  | Fnr.  Snr.  |
| 12  3       |             |
Eksempelveien 12, 1814
| Eier:  | Kari Eksempel  | Postadresse:  |
Askim
| Oppdragsgiver:   | Kari Eksempel  | Org.nr.:  | 999999999  |
Postadresse:  Eksempelveien 12  Avtalen datert:  04.09.2020
| Postnr. / -sted:  | 1814 Askim  | Telefonnr.:  | 40000000  |
Oppdragsgivers
|     | Kari Eksempel  | E-post:  | kari@example.no  |
representant:
Type kontroll:   Akkreditert ferdigkontroll     Akkreditert systematisk tilstandskontroll  X
|               |                 |             | LPG              | X   |
| Type anlegg:  | Forbruksanlegg  | Type gass:  | CNG / Naturgass  |     |
Inspeksjonen er utført av:  Per Kontrollør
Side 1 av 5
Sammendrag og konklusjon
Av tekniske avvik i anlegget er det avdekket manglende merking.
Type objekt: Fabrikat: Modell: Anlegg installert: Serienummer:
Korntørke/boliggass Plassbygget Plassbygget 2009
Neste akkrediterte kontroll av anlegget: Tanknummer: Volum: Tank tatt i bruk:
1. Kvartal 2029 100234 9,2 m3 2009
Omfang av kontrollen: Hele: Deler, beskriv: Tank, fordamper, korntørke og gassfyrt kjele.
Anlegget forsynes av en nedgravd tank på 9,2m3. Væskefasen går til en fordamper med inntaksskap til korntørke og hovedhus.
Dokumentnavn Utarbeidet av Datert Mottatt
08.08.2024-
Servicerapporter Eksempel Rør AS 27.02.2025
24.09.2025
Kontrollrapport tank Eksempel Rør AS - rutinemessig 08.08.2024 27.02.2025
Siste uavhengige kontroll – rapportdato: 21.6.2021
Side 2 av 5
Merknader i sjekklisten:
10. Kontrollplan for tank: Det bør opprettes avtale slik at tanken blir re-kvalifisert iht. tankplan. Vanligvis ved 18 år.
29. Statisk elektrisitet: Bør montere punkt til tankbil.
50. Merking av utstyr, rørledninger, nedgravd gasstank, stengeventil: Avvik. Alle kurser skal være merket, også kurs til bolig.`;

const v = (p: ParsedReport, k: FieldKey) => p.fields[k].value;

export function dueOf(p: ParsedReport): Quarter | null {
  const q = Number(v(p, 'nextDueQ'));
  const y = Number(v(p, 'nextDueYear'));
  return q >= 1 && q <= 4 && y > 2000 ? { q: q as Quarter['q'], year: y } : null;
}

/** Bygger et anlegg fra en tolket rapport. Ukjente verdier blir tomme felt med lav sikkerhet. */
export function facilityFromReport(p: ParsedReport, sourceFile: string, today: string): Facility {
  const conf: Record<string, Confidence> = {};
  for (const [k, fv] of Object.entries(p.fields)) conf[k] = fv.confidence;
  const email = v(p, 'email');
  const phone = v(p, 'phone');
  const contacts: Contact[] = [];
  const add = (name: string | null, role: Contact['role']) => {
    if (!name) return;
    const isEmailRole = p.emailRole === role;
    contacts.push({ name, role, email: isEmailRole ? email : null, phone: null });
  };
  add(v(p, 'representativeName'), 'representant');
  add(v(p, 'clientName'), 'oppdragsgiver');
  add(v(p, 'ownerName'), 'eier');
  // Telefonnummeret står i oppdragsgivers blokk. Samme person i flere roller deler kontaktinfo.
  for (const c of contacts) {
    if (c.role === 'oppdragsgiver' || contacts.length === 1) c.phone = phone;
  }
  for (const c of contacts) {
    const same = contacts.filter((x) => x.name === c.name);
    c.email = c.email ?? same.find((x) => x.email)?.email ?? null;
    c.phone = c.phone ?? same.find((x) => x.phone)?.phone ?? null;
  }
  if (!contacts.length && (email || phone)) contacts.push({ name: v(p, 'customer') ?? 'Ukjent', role: 'eier', email, phone });
  if (email && !p.emailRole) conf.email = 'lav';

  const address = { street: v(p, 'street') ?? '', postcode: v(p, 'postcode') ?? '', place: v(p, 'place') ?? '' };
  const geo = geocode(address);
  conf.coords = geo.coords ? geo.confidence : 'lav';
  const tankYear = Number(v(p, 'tankInServiceYear')) || null;
  const f: Facility = {
    id: uid('a'),
    objectId: v(p, 'objectId') ?? `ukjent-${uid('x').slice(-5)}`,
    customer: v(p, 'customer') ?? '',
    address,
    coords: geo.coords,
    gnr: v(p, 'gnr'),
    bnr: v(p, 'bnr'),
    contacts,
    orgNr: v(p, 'orgNr'),
    controlType: v(p, 'controlType'),
    gasType: v(p, 'gasType'),
    facilityType: v(p, 'facilityType'),
    objectType: v(p, 'objectType'),
    scope: v(p, 'scope'),
    description: v(p, 'description'),
    tank: v(p, 'tankNumber') || tankYear ? { number: v(p, 'tankNumber'), volume: v(p, 'tankVolume'), inServiceYear: tankYear } : null,
    servicePartner: v(p, 'servicePartner'),
    lastControl: v(p, 'controlDate') ? parseNorDate(v(p, 'controlDate')!) : null,
    reportDate: v(p, 'reportDate') ? parseNorDate(v(p, 'reportDate')!) : null,
    nextDue: dueOf(p),
    deviations: p.remarks.map((r) => ({ text: r.text, severity: r.severity })),
    notes: '',
    blockedPeriods: [],
    durationMin: null,
    sourceFile,
    confidence: conf,
    flags: [...p.flags],
    reviewPending: false,
    excerpt: p.excerpt,
    history: [],
    log: [{ at: nowStamp(today), text: `Importert fra ${sourceFile}` }],
  };
  if (!f.objectId || f.objectId.startsWith('ukjent')) f.flags.push('Fant ikke Objekt ID');
  if (!f.coords) f.flags.push('Fant ikke koordinater – plasser pinnen manuelt');
  f.reviewPending = needsReview(f);
  return f;
}

export function needsReview(f: Facility): boolean {
  return f.flags.length > 0 || Object.values(f.confidence).includes('lav');
}

export interface ImportOutcome { facility: Facility; kind: 'ny' | 'oppdatert' | 'historikk'; message: string }

/** Legger anlegget inn i tilstanden. Samme Objekt ID: nyeste rapportdato blir gjeldende, eldre blir historikk. */
export function importFacility(state: AppState, f: Facility): ImportOutcome {
  const today = todayOf(state.settings);
  const existing = state.facilities.find((x) => x.objectId === f.objectId && !f.objectId.startsWith('ukjent'));
  if (!existing) {
    state.facilities.push(f);
    if (f.nextDue) {
      const c = newControl(f.id, f.nextDue);
      c.log.push({ at: nowStamp(today), text: `Opprettet ved import, frist ${fmtQuarter(f.nextDue)}` });
      state.controls.push(c);
    }
    return { facility: f, kind: 'ny', message: `Nytt anlegg ${f.objectId}` };
  }
  const newer = (f.reportDate ?? '') > (existing.reportDate ?? '');
  if (!newer) {
    existing.history.push({ reportDate: f.reportDate, lastControl: f.lastControl, nextDue: f.nextDue, sourceFile: f.sourceFile, note: 'Eldre rapport (duplikat)' });
    existing.log.push({ at: nowStamp(today), text: `Eldre rapport ${f.sourceFile} (${fmtDate(f.reportDate)}) lagt i historikk` });
    return { facility: existing, kind: 'historikk', message: `Duplikat ${f.objectId}: eldre rapport lagt i historikk` };
  }
  const c = currentControl(state, existing.id);
  const newDue = f.nextDue;
  const dueChanged = !!(newDue && c && c.status !== 'utfort' && (c.due.q !== newDue.q || c.due.year !== newDue.year));
  const closeDate = f.lastControl && f.lastControl <= today ? f.lastControl : today;
  if (dueChanged && newDue && c && compareQuarter(newDue, quarterOf(closeDate)) > 0) {
    complete(state, c.id, newDue, { date: closeDate, viaReport: true });
  }
  existing.history.push({ reportDate: existing.reportDate, lastControl: existing.lastControl, nextDue: existing.nextDue, sourceFile: existing.sourceFile, note: 'Erstattet av nyere rapport' });
  const keep = { id: existing.id, notes: existing.notes, blockedPeriods: existing.blockedPeriods, history: existing.history, log: existing.log, durationMin: existing.durationMin, mergedInto: existing.mergedInto, nextDue: existing.nextDue, lastControl: existing.lastControl };
  Object.assign(existing, f, keep);
  if (!dueChanged) {
    existing.nextDue = f.nextDue;
    existing.lastControl = f.lastControl;
  }
  existing.log.push({ at: nowStamp(today), text: dueChanged && newDue ? `Ny rapport ${f.sourceFile}: forrige kontroll lukket som utført, ny frist ${fmtQuarter(newDue)}` : `Oppdatert fra nyere rapport ${f.sourceFile} (${fmtDate(f.reportDate)})` });
  const open = currentControl(state, existing.id);
  if (f.nextDue && !open) state.controls.push(newControl(existing.id, f.nextDue));
  return { facility: existing, kind: 'oppdatert', message: dueChanged && newDue ? `Ny rapport ${f.objectId}: utført, neste frist ${fmtQuarter(newDue)}` : `Duplikat ${f.objectId}: nyeste rapport er gjeldende` };
}

/** Etter gjennomgang: sørger for at anlegget har en åpen kontroll når fristen er kjent. */
export function ensureControl(state: AppState, f: Facility): void {
  if (!f.nextDue) return;
  const c = currentControl(state, f.id);
  if (!c) state.controls.push(newControl(f.id, f.nextDue));
  else if (c.status !== 'utfort' && (c.due.q !== f.nextDue.q || c.due.year !== f.nextDue.year)) {
    logBoth(state, c, `Frist rettet til ${fmtQuarter(f.nextDue)}`);
    c.due = f.nextDue;
  }
}

// ---------- CSV ----------

export function parseCSV(text: string): string[][] {
  const first = text.split(/\r?\n/)[0] ?? '';
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export const CSV_TARGETS: { key: string; label: string; hints: RegExp }[] = [
  { key: 'objectId', label: 'Objekt ID', hints: /objekt|object|id/i },
  { key: 'customer', label: 'Kunde', hints: /kunde|navn|customer/i },
  { key: 'street', label: 'Gateadresse', hints: /adresse|gate|street/i },
  { key: 'postcode', label: 'Postnr.', hints: /postn|zip/i },
  { key: 'place', label: 'Sted', hints: /sted|by|poststed|place/i },
  { key: 'contactName', label: 'Kontaktperson', hints: /kontakt|representant/i },
  { key: 'email', label: 'E-post', hints: /e-?post|mail/i },
  { key: 'phone', label: 'Telefon', hints: /telefon|tlf|mobil|phone/i },
  { key: 'nextDue', label: 'Neste frist (f.eks. «1. kvartal 2029» eller «K1 2029»)', hints: /frist|neste|due/i },
  { key: 'lastControl', label: 'Siste kontroll (dd.mm.åååå)', hints: /siste|kontrolldato|forrige/i },
  { key: 'servicePartner', label: 'Servicepartner', hints: /service/i },
  { key: 'tankYear', label: 'Tank tatt i bruk (år)', hints: /tank|tatt i bruk/i },
];

export function guessMapping(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const used = new Set<number>();
  for (const t of CSV_TARGETS) {
    const i = header.findIndex((h, idx) => !used.has(idx) && t.hints.test(h));
    if (i >= 0) { map[t.key] = i; used.add(i); }
  }
  return map;
}

export function parseQuarterText(s: string): Quarter | null {
  const m = s.match(/([1-4])\.?\s*kvartal\s*(\d{4})/i) ?? s.match(/K\s*([1-4])\s*[-/ ]?\s*(\d{4})/i) ?? s.match(/(\d{4})\s*[-/ ]?\s*K?([1-4])$/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 4 ? { q: b as Quarter['q'], year: a } : { q: a as Quarter['q'], year: b };
}

export function facilityFromRow(row: string[], map: Record<string, number>, today: string, fileName: string): Facility {
  const g = (k: string) => (map[k] !== undefined ? (row[map[k]] ?? '').trim() : '');
  const address = { street: g('street'), postcode: g('postcode'), place: g('place') };
  const geo = geocode(address);
  const due = parseQuarterText(g('nextDue'));
  const conf: Record<string, Confidence> = { coords: geo.coords ? geo.confidence : 'lav' };
  const flags: string[] = [];
  if (!due) { conf.nextDueQ = 'lav'; flags.push(`Ugyldig eller manglende frist «${g('nextDue')}»`); }
  const last = g('lastControl') ? parseNorDate(g('lastControl')) : null;
  if (g('lastControl') && !last) flags.push(`Ugyldig dato «${g('lastControl')}»`);
  const tankYear = Number(g('tankYear')) || null;
  const f: Facility = {
    id: uid('a'),
    objectId: g('objectId') || `csv-${uid('x').slice(-5)}`,
    customer: g('customer'),
    address,
    coords: geo.coords,
    gnr: null, bnr: null,
    contacts: [{ name: g('contactName') || g('customer'), role: 'representant', email: g('email') || null, phone: g('phone') || null }],
    orgNr: null, controlType: null, gasType: null, facilityType: null, objectType: null, scope: null, description: null,
    tank: tankYear ? { number: null, volume: null, inServiceYear: tankYear } : null,
    servicePartner: g('servicePartner') || null,
    lastControl: last,
    reportDate: null,
    nextDue: due,
    deviations: [], notes: '', blockedPeriods: [], durationMin: null,
    sourceFile: fileName,
    confidence: conf,
    flags,
    reviewPending: false,
    excerpt: row.join(' ; '),
    history: [],
    log: [{ at: nowStamp(today), text: `Importert fra CSV ${fileName}` }],
  };
  if (!f.coords) f.flags.push('Fant ikke koordinater – plasser pinnen manuelt');
  f.reviewPending = needsReview(f);
  return f;
}

export function blankFacility(today: string): Facility {
  return {
    id: uid('a'), objectId: '', customer: '', address: { street: '', postcode: '', place: '' }, coords: null,
    gnr: null, bnr: null, contacts: [{ name: '', role: 'representant', email: null, phone: null }], orgNr: null,
    controlType: 'Akkreditert systematisk tilstandskontroll', gasType: 'LPG', facilityType: 'Forbruksanlegg', objectType: null,
    scope: null, description: null, tank: null, servicePartner: null, lastControl: null, reportDate: null, nextDue: null,
    deviations: [], notes: '', blockedPeriods: [], durationMin: null, sourceFile: 'Manuell registrering',
    confidence: {}, flags: [], reviewPending: false, excerpt: null, history: [],
    log: [{ at: nowStamp(today), text: 'Registrert manuelt' }],
  };
}
