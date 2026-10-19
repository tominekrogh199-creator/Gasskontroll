// Statusflyt, flagg og livssyklus for kontroller. Rene funksjoner som endrer et utkast av tilstanden.
import type { AppState, Contact, Control, ControlStatus, Facility, Postponement, PostponeReason, Quarter, Settings } from './types';
import { addDays, compareQuarter, deviceToday, fmtDate, fmtQuarter, isOverdue, nowStamp, quarterEnd, quarterOf, sameQuarter } from './dates';

export function todayOf(s: Settings): string {
  return s.testDate || deviceToday();
}

let idCounter = 0;
export function uid(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter}`;
}

export function facilityOf(state: AppState, c: Control): Facility {
  const f = state.facilities.find((x) => x.id === c.facilityId);
  if (!f) throw new Error(`Mangler anlegg for kontroll ${c.id}`);
  return f;
}

export function findFacility(state: AppState, id: string): Facility | undefined {
  return state.facilities.find((x) => x.id === id);
}

export function findControl(state: AppState, id: string): Control | undefined {
  return state.controls.find((x) => x.id === id);
}

/** Den åpne kontrollen for et anlegg (ikke utført), ellers den siste. */
export function currentControl(state: AppState, facilityId: string): Control | undefined {
  const list = state.controls.filter((c) => c.facilityId === facilityId);
  return list.find((c) => c.status !== 'utfort') ?? list[list.length - 1];
}

// ---------- Mottaker ----------

const ROLE_ORDER: Contact['role'][] = ['representant', 'oppdragsgiver', 'eier'];

/** Mottaker av varsler: representant, ellers oppdragsgiver, ellers eier – første rolle med e-post. */
export function recipient(f: Facility): { contact: Contact; reason: string } | null {
  for (const role of ROLE_ORDER) {
    const c = f.contacts.find((x) => x.role === role && x.email);
    if (c) {
      const skipped = ROLE_ORDER.slice(0, ROLE_ORDER.indexOf(role));
      const reason = skipped.length ? `${role} (${skipped.join(' og ')} mangler e-post)` : role;
      return { contact: c, reason };
    }
  }
  return null;
}

export function primaryPhone(f: Facility): string | null {
  for (const role of ROLE_ORDER) {
    const c = f.contacts.find((x) => x.role === role && x.phone);
    if (c) return c.phone;
  }
  return null;
}

export function primaryContact(f: Facility): Contact | null {
  return recipient(f)?.contact ?? f.contacts.find((c) => c.role === 'representant') ?? f.contacts[0] ?? null;
}

// ---------- Flagg ----------

export interface Flags { overdue: boolean; missingInfo: string[]; uncertain: boolean }

export function missingInfo(f: Facility): string[] {
  const out: string[] = [];
  if (!f.contacts.some((c) => c.email)) out.push('e-post');
  if (!f.contacts.some((c) => c.phone)) out.push('telefon');
  if (!f.coords) out.push('koordinater');
  return out;
}

export function isUncertain(f: Facility): boolean {
  return f.flags.length > 0 || Object.values(f.confidence).includes('lav');
}

export function flagsOf(c: Control, f: Facility, today: string): Flags {
  return {
    overdue: c.status !== 'utfort' && isOverdue(c.due, today),
    missingInfo: missingInfo(f),
    uncertain: isUncertain(f),
  };
}

export type PinColor = 'red' | 'orange' | 'blue' | 'green' | 'grey';

export function pinColor(c: Control, f: Facility, today: string): PinColor {
  if (c.status === 'utfort' || c.status === 'bekreftet') return 'green';
  if (c.status === 'utsatt') return 'orange';
  if (c.status === 'planlagt' || c.status === 'varslet') return 'blue';
  if (missingInfo(f).length) return 'grey';
  return 'red';
}

export function nextStep(state: AppState, c: Control, today: string): string {
  switch (c.status) {
    case 'ikke_planlagt':
      return isOverdue(c.due, today) ? 'Forfalt – planlegg snarest' : `Planlegg innen ${fmtQuarter(c.due)}`;
    case 'planlagt': {
      const draft = c.notices.find((n) => n.kind === 'forvarsel' && n.status !== 'stoppet');
      if (c.callReason) return 'Ring kunden for å avtale tid';
      if (draft?.status === 'utkast') return `Godkjenn forvarsel (sendes ${fmtDate(draft.sendDate)})`;
      if (draft?.status === 'godkjent') return `Send forvarsel ${fmtDate(draft.sendDate)}`;
      return 'Forvarsel lages automatisk';
    }
    case 'varslet':
      return c.callReason ? 'Ingen svar – ring kunden' : 'Registrer kundens svar';
    case 'bekreftet':
      return c.plannedDate ? `Utfør kontrollen ${fmtDate(c.plannedDate)}` : 'Utfør kontrollen';
    case 'utsatt':
      return c.postponement ? `Følg opp ${fmtDate(c.postponement.followUp)}` : 'Følg opp';
    case 'utfort':
      return 'Lukket';
  }
}

// ---------- Logg ----------

export function logBoth(state: AppState, c: Control, text: string): void {
  const at = nowStamp(todayOf(state.settings));
  c.log.push({ at, text });
  const f = findFacility(state, c.facilityId);
  if (f) f.log.push({ at, text });
}

export function setStatus(state: AppState, c: Control, status: ControlStatus, why?: string): void {
  if (c.status === status) return;
  const from = c.status;
  c.status = status;
  if (from === 'utsatt' && status !== 'utsatt') c.postponement = null; // historikken ligger i c.postponements
  logBoth(state, c, `Status: ${label(from)} → ${label(status)}${why ? ` (${why})` : ''}`);
}

function label(s: ControlStatus): string {
  return { ikke_planlagt: 'Ikke planlagt', planlagt: 'Planlagt', varslet: 'Varslet', bekreftet: 'Bekreftet', utfort: 'Utført', utsatt: 'Utsatt' }[s];
}

export function newControl(facilityId: string, due: Quarter): Control {
  return {
    id: uid('k'),
    facilityId,
    due,
    status: 'ikke_planlagt',
    plannedDate: null,
    timeFrom: null,
    timeTo: null,
    notices: [],
    responses: [],
    postponement: null,
    postponements: [],
    completedAt: null,
    callReason: null,
    log: [],
  };
}

/** Fjerner en kontroll fra plandagen sin og stopper usendte varsler. Returnerer dag-id-en som fikk et hull. */
export function detachFromDay(state: AppState, c: Control): string | null {
  let holeDay: string | null = null;
  for (const d of state.days) {
    const i = d.stops.indexOf(c.id);
    if (i >= 0) {
      d.stops.splice(i, 1);
      holeDay = d.id;
    }
  }
  state.days = state.days.filter((d) => d.stops.length > 0 || d.locked);
  c.plannedDate = null;
  c.timeFrom = null;
  c.timeTo = null;
  for (const n of c.notices) if (n.status === 'utkast' || n.status === 'godkjent') n.status = 'stoppet';
  return holeDay && state.days.some((d) => d.id === holeDay) ? holeDay : null;
}

// ---------- Utsettelse ----------

export interface PostponeInput {
  reason: PostponeReason;
  text: string;
  newPeriod: Quarter;
  followUp?: string;
  requestedBy: string;
}

export function postponeAfterDeadline(c: Control, newPeriod: Quarter): boolean {
  return compareQuarter(newPeriod, c.due) > 0;
}

export function postpone(state: AppState, controlId: string, input: PostponeInput): { holeDayId: string | null } {
  const c = findControl(state, controlId);
  if (!c) throw new Error('Ukjent kontroll');
  if (c.status === 'utfort') throw new Error('En utført kontroll kan ikke utsettes');
  const today = todayOf(state.settings);
  const p: Postponement = {
    reason: input.reason,
    text: input.text,
    newPeriod: input.newPeriod,
    followUp: input.followUp || addDays(today, state.settings.followUpDays),
    requestedBy: input.requestedBy,
    requestedAt: nowStamp(today),
    afterDeadline: postponeAfterDeadline(c, input.newPeriod),
  };
  const holeDayId = detachFromDay(state, c);
  c.postponement = p;
  c.postponements.push(p);
  c.callReason = null;
  setStatus(state, c, 'utsatt', input.reason);
  const f = facilityOf(state, c);
  logBoth(
    state,
    c,
    `Utsatt til ${fmtQuarter(p.newPeriod)}: ${p.reason}${p.text ? ` – ${p.text}` : ''}. Bedt om av ${p.requestedBy || 'ukjent'}. Oppfølging ${fmtDate(p.followUp)}.` +
      (p.reason === 'Venter på service' && f.servicePartner ? ` Servicepartner: ${f.servicePartner}.` : '') +
      (p.afterDeadline ? ' ADVARSEL: ny periode er etter fristen.' : ''),
  );
  return { holeDayId };
}

/** Utsatt kontroll er kandidat igjen i kvartalet når ny periode er nådd og oppfølgingsdatoen er passert innen kvartalets slutt. */
export function postponedEligible(c: Control, q: Quarter, today: string): boolean {
  const p = c.postponement;
  if (!p) return true;
  return compareQuarter(p.newPeriod, q) <= 0 && p.followUp <= (today > quarterEnd(q) ? today : quarterEnd(q));
}

// ---------- Utført ----------

export function complete(state: AppState, controlId: string, newDue: Quarter | null, opts: { date?: string; viaReport?: boolean } = {}): Control {
  const c = findControl(state, controlId);
  if (!c) throw new Error('Ukjent kontroll');
  if (!newDue) throw new Error('Ny frist (kvartal og år) eller ny rapport kreves før kontrollen lukkes.');
  const today = todayOf(state.settings);
  const date = opts.date || today;
  if (compareQuarter(newDue, quarterOf(date)) <= 0) throw new Error('Ny frist må være etter kontrolldatoen.');
  const f = facilityOf(state, c);
  for (const n of c.notices) if (n.status === 'utkast' || n.status === 'godkjent') n.status = 'stoppet';
  c.completedAt = date;
  c.callReason = null;
  setStatus(state, c, 'utfort', opts.viaReport ? 'ny rapport' : undefined);
  f.history.push({ reportDate: f.reportDate, lastControl: f.lastControl, nextDue: f.nextDue, sourceFile: f.sourceFile, note: 'Før kontroll ' + fmtDate(date) });
  f.lastControl = date;
  f.nextDue = newDue;
  const next = newControl(f.id, newDue);
  next.log.push({ at: nowStamp(today), text: `Opprettet etter utført kontroll ${fmtDate(date)}, frist ${fmtQuarter(newDue)}` });
  state.controls.push(next);
  logBoth(state, c, `Utført ${fmtDate(date)}. Ny frist ${fmtQuarter(newDue)}.`);
  return next;
}

export function isInQuarter(c: Control, q: Quarter): boolean {
  return sameQuarter(c.due, q);
}
