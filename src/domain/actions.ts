// Kundesvar og ad hoc-oppdrag.
import type { AppState, Facility } from './types';
import { fmtDate, nowStamp, quarterOf, addQuarters } from './dates';
import { findControl, logBoth, newControl, setStatus, todayOf, uid } from './controls';
import { chase, runAutomations } from './notices';
import { ensureDay, moveStop, refreshDay } from './planner';
import { geocode } from '../adapters/geocode';

export function registerConfirmed(state: AppState, controlId: string): void {
  const c = findControl(state, controlId);
  if (!c) return;
  c.responses.push({ type: 'bekreftet', at: nowStamp(todayOf(state.settings)) });
  c.callReason = null;
  setStatus(state, c, 'bekreftet', 'kunden bekreftet');
  // Purring som ikke er sendt trengs ikke lenger.
  for (const n of c.notices) if (n.kind === 'purring' && (n.status === 'utkast' || n.status === 'godkjent')) n.status = 'stoppet';
  runAutomations(state);
}

/** Kunden ønsker ny tid: flytt til valgt dato (lager kjøredag ved behov) og marker som bekreftet. */
export function registerNewTime(state: AppState, controlId: string, date: string, timeFrom?: string): void {
  const c = findControl(state, controlId);
  if (!c) return;
  c.responses.push({ type: 'ny_tid', at: nowStamp(todayOf(state.settings)), note: fmtDate(date) });
  const day = ensureDay(state, date);
  moveStop(state, controlId, day.id);
  if (timeFrom) {
    const [h, m] = timeFrom.split(':').map(Number);
    c.timeFrom = timeFrom;
    c.timeTo = `${String(h + 2).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  c.callReason = null;
  for (const n of c.notices) if ((n.kind === 'paminnelse' || n.kind === 'purring') && n.status !== 'sendt') n.status = 'stoppet';
  setStatus(state, c, 'bekreftet', `ny tid ${fmtDate(date)}`);
  refreshDay(state, day);
  runAutomations(state);
}

export function registerNoAnswer(state: AppState, controlId: string): void {
  const c = findControl(state, controlId);
  if (!c) return;
  c.responses.push({ type: 'ingen_svar', at: nowStamp(todayOf(state.settings)) });
  chase(state, c, 'Ingen svar registrert');
}

export interface AdhocInput { date: string; customer: string; street: string; postcode: string; place: string; label: string; durationMin: number; phone?: string }

/** Ad hoc-oppdrag, f.eks. en ferdigkontroll. Legges som fast stopp på dagen. */
export function addAdhoc(state: AppState, input: AdhocInput): { dayId: string; facility: Facility } {
  const today = todayOf(state.settings);
  const address = { street: input.street, postcode: input.postcode, place: input.place };
  const geo = geocode(address);
  const f: Facility = {
    id: uid('a'), objectId: `ad hoc ${uid('x').slice(-4)}`, customer: input.customer, address, coords: geo.coords,
    gnr: null, bnr: null, contacts: [{ name: input.customer, role: 'oppdragsgiver', email: null, phone: input.phone || null }],
    orgNr: null, controlType: input.label, gasType: null, facilityType: null, objectType: null, scope: null, description: null,
    tank: null, servicePartner: null, lastControl: null, reportDate: null, nextDue: null, deviations: [], notes: '',
    blockedPeriods: [], durationMin: input.durationMin, sourceFile: 'Ad hoc', confidence: { coords: geo.coords ? 'middels' : 'lav' },
    flags: [], reviewPending: false, excerpt: null, history: [], log: [{ at: nowStamp(today), text: `Ad hoc-oppdrag lagt inn: ${input.label}` }], adhoc: true,
  };
  state.facilities.push(f);
  const c = newControl(f.id, quarterOf(input.date));
  c.adhocLabel = input.label;
  state.controls.push(c);
  const day = ensureDay(state, input.date);
  day.stops.push(c.id);
  setStatus(state, c, 'bekreftet', 'ad hoc');
  logBoth(state, c, `Ad hoc ${fmtDate(input.date)}`);
  refreshDay(state, day, true);
  return { dayId: day.id, facility: f };
}

export function nextQuarterFrom(iso: string) {
  return addQuarters(quarterOf(iso), 1);
}
