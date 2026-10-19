// Kvartalsplanlegging: kandidater, kjøredager, rekkefølge (nærmeste nabo + 2-opt), tidslinjer og datofordeling.
// Alt her er vanlig, deterministisk kode – ingen AI.
import type { AppState, Control, Facility, PlanDay, Quarter, Settings } from './types';
import { getDriveTime, type LatLng } from '../adapters/driveTime';
import {
  addDays, addWorkdays, clockToMinutes, compareQuarter, isOverdue, isWorkday, minutesToClock, nextWorkdayOnOrAfter,
  quarterEnd, quarterOf, quarterStart, sameQuarter, workdaysInRange, addQuarters, fmtDate, fmtQuarter,
} from './dates';
import { areaFor } from './geo';
import { detachFromDay, facilityOf, findControl, logBoth, postponedEligible, setStatus, todayOf, uid } from './controls';

export function basePoint(s: Settings): LatLng {
  return { lat: s.baseLat, lng: s.baseLng };
}

export function driveFromBase(s: Settings, f: Facility): number | null {
  return f.coords ? getDriveTime(basePoint(s), f.coords) : null;
}

export function durationOf(f: Facility, s: Settings): number {
  return f.durationMin ?? s.controlMin;
}

// ---------- Tidslinje ----------

export type TimelineEvent =
  | { type: 'avreise'; at: number; from: string }
  | { type: 'kjoring'; start: number; end: number; min: number }
  | { type: 'kontroll'; start: number; end: number; controlId: string; index: number }
  | { type: 'lunsj'; start: number; end: number }
  | { type: 'hjemkomst'; at: number }
  | { type: 'overnatting'; at: number };

export interface Timeline {
  events: TimelineEvent[];
  driveMin: number;
  endMin: number;
  overtime: boolean;
  overtimeMin: number;
  slots: Record<string, { start: number; end: number }>;
}

export interface Stop { controlId: string; point: LatLng; duration: number }

export interface TimelineOpts { start?: LatLng | null; end?: LatLng | null; startLabel?: string; startMin?: number }

/** Lager tidslinje for en dag. start/slutt = basen, eller overnattingssted (end: null = overnatting, ingen hjemtur). */
export function buildTimeline(stops: Stop[], s: Settings, opts: TimelineOpts = {}): Timeline {
  const base = basePoint(s);
  const startPt = opts.start === undefined ? base : opts.start ?? base;
  const endPt = opts.end === undefined ? base : opts.end;
  const dayStart = opts.startMin ?? clockToMinutes(s.dayStart);
  const dayEnd = clockToMinutes(s.dayEnd);
  const lunchEarliest = 11 * 60;
  const lunchLatest = 11 * 60 + 30;
  const events: TimelineEvent[] = [{ type: 'avreise', at: dayStart, from: opts.startLabel ?? s.baseName }];
  const slots: Timeline['slots'] = {};
  let t = dayStart;
  let drive = 0;
  let lunch = false;
  let pos = startPt;
  const eatLunch = () => {
    events.push({ type: 'lunsj', start: t, end: t + s.lunchMin });
    t += s.lunchMin;
    lunch = true;
  };
  stops.forEach((st, i) => {
    const d = getDriveTime(pos, st.point);
    if (d > 0) {
      events.push({ type: 'kjoring', start: t, end: t + d, min: d });
      t += d;
      drive += d;
    }
    if (!lunch && t >= lunchLatest) eatLunch();
    events.push({ type: 'kontroll', start: t, end: t + st.duration, controlId: st.controlId, index: i + 1 });
    slots[st.controlId] = { start: t, end: t + st.duration };
    t += st.duration;
    pos = st.point;
    if (!lunch && t >= lunchEarliest && i < stops.length - 1) eatLunch();
  });
  if (!lunch && stops.length) eatLunch();
  if (endPt) {
    const d = getDriveTime(pos, endPt);
    if (d > 0) {
      events.push({ type: 'kjoring', start: t, end: t + d, min: d });
      t += d;
      drive += d;
    }
    events.push({ type: 'hjemkomst', at: t });
  } else {
    events.push({ type: 'overnatting', at: t });
  }
  return { events, driveMin: drive, endMin: t, overtime: t > dayEnd, overtimeMin: Math.max(0, t - dayEnd), slots };
}

// ---------- Rekkefølge ----------

function tourCost(order: Stop[], start: LatLng, end: LatLng | null): number {
  let cost = 0;
  let pos = start;
  for (const st of order) {
    cost += getDriveTime(pos, st.point);
    pos = st.point;
  }
  if (end) cost += getDriveTime(pos, end);
  return cost;
}

/** Nærmeste nabo fra start, forbedret med 2-opt. */
export function orderStops(stops: Stop[], start: LatLng, end: LatLng | null): Stop[] {
  if (stops.length <= 1) return [...stops];
  const left = [...stops];
  const order: Stop[] = [];
  let pos = start;
  while (left.length) {
    let bi = 0;
    let bd = Infinity;
    left.forEach((st, i) => {
      const d = getDriveTime(pos, st.point);
      if (d < bd) { bd = d; bi = i; }
    });
    const [st] = left.splice(bi, 1);
    order.push(st);
    pos = st.point;
  }
  let best = order;
  let bestCost = tourCost(best, start, end);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        const c = tourCost(cand, start, end);
        if (c < bestCost) { best = cand; bestCost = c; improved = true; }
      }
    }
  }
  return best;
}

// ---------- Hjelpere for stopp ----------

export function stopOf(state: AppState, controlId: string): Stop | null {
  const c = findControl(state, controlId);
  if (!c) return null;
  const f = facilityOf(state, c);
  if (!f.coords) return null;
  return { controlId, point: f.coords, duration: durationOf(f, state.settings) };
}

function dayEnds(state: AppState, day: PlanDay): TimelineOpts {
  if (!day.overnight) return {};
  const partner = overnightPartner(state, day);
  if (day.overnight === 'ut') return { end: null };
  // Hjem-dagen starter fra siste stopp på ut-dagen.
  const lastId = partner?.stops[partner.stops.length - 1];
  const last = lastId ? stopOf(state, lastId) : null;
  return { start: last?.point ?? null, startLabel: 'overnattingssted' };
}

function lastDoneIndex(state: AppState, day: PlanDay): number {
  let idx = -1;
  day.stops.forEach((id, i) => {
    if (findControl(state, id)?.status === 'utfort') idx = i;
  });
  return idx;
}

/** Startpunkt for dagen: basen, der telefonen er, eller siste stopp. */
export function routeOpts(state: AppState, day: PlanDay): { opts: TimelineOpts; ids: string[] } {
  const overnight = dayEnds(state, day);
  if (day.overnight === 'hjem') return { opts: overnight, ids: day.stops };
  if (day.startMode === 'gps' && day.startLat != null && day.startLng != null) {
    return { opts: { ...overnight, start: { lat: day.startLat, lng: day.startLng }, startLabel: 'der du er' }, ids: day.stops };
  }
  if (day.startMode === 'siste') {
    const idx = lastDoneIndex(state, day);
    if (idx >= 0) {
      const st = stopOf(state, day.stops[idx]);
      const done = findControl(state, day.stops[idx]);
      const startMin = done?.timeTo ? clockToMinutes(done.timeTo) : undefined;
      return {
        opts: { ...overnight, start: st?.point ?? basePoint(state.settings), startLabel: 'siste stopp', startMin },
        ids: day.stops.slice(idx + 1),
      };
    }
    const prev = [...state.days].filter((d) => d.date < day.date && d.stops.length).sort((a, b) => b.date.localeCompare(a.date))[0];
    const last = prev ? stopOf(state, prev.stops[prev.stops.length - 1]) : null;
    if (last) return { opts: { ...overnight, start: last.point, startLabel: 'siste stopp' }, ids: day.stops };
  }
  return { opts: overnight, ids: day.stops };
}

export function overnightPartner(state: AppState, day: PlanDay): PlanDay | undefined {
  if (!day.overnight) return undefined;
  const sorted = [...state.days].sort((a, b) => a.date.localeCompare(b.date));
  const i = sorted.findIndex((d) => d.id === day.id);
  return day.overnight === 'ut' ? sorted.slice(i + 1).find((d) => d.overnight === 'hjem') : sorted.slice(0, i).reverse().find((d) => d.overnight === 'ut');
}

export function dayTimeline(state: AppState, day: PlanDay): Timeline {
  const { opts, ids } = routeOpts(state, day);
  const stops = ids.map((id) => stopOf(state, id)).filter((x): x is Stop => !!x);
  return buildTimeline(stops, state.settings, opts);
}

function fits(stops: Stop[], s: Settings, opts: TimelineOpts = {}): boolean {
  if (stops.length > s.maxPerDay) return false;
  return !buildTimeline(stops, s, opts).overtime;
}

/** Oppdaterer rekkefølge (om ønsket) og tidsrom for kontrollene på en dag. */
export function refreshDay(state: AppState, day: PlanDay, reorder = false): void {
  if (reorder && !day.locked) {
    const { opts } = routeOpts(state, day);
    const stops = day.stops.map((id) => stopOf(state, id)).filter((x): x is Stop => !!x);
    const start = opts.start === undefined ? basePoint(state.settings) : opts.start ?? basePoint(state.settings);
    const end = opts.end === undefined ? basePoint(state.settings) : opts.end;
    const noCoords = day.stops.filter((id) => !stopOf(state, id));
    day.stops = [...orderStops(stops, start, end).map((s) => s.controlId), ...noCoords];
  }
  const tl = dayTimeline(state, day);
  for (const id of day.stops) {
    const c = findControl(state, id);
    if (!c) continue;
    c.plannedDate = day.date;
    const slot = tl.slots[id];
    if (slot && !c.timePinned) {
      c.timeFrom = minutesToClock(slot.start);
      c.timeTo = minutesToClock(slot.end);
    }
  }
}

/** Flytter et stopp ett hakk opp eller ned og regner tidene på nytt. */
export function moveStopBy(state: AppState, controlId: string, dir: -1 | 1): boolean {
  const day = state.days.find((d) => d.stops.includes(controlId));
  if (!day || day.locked) return false;
  const i = day.stops.indexOf(controlId);
  const j = i + dir;
  if (j < 0 || j >= day.stops.length) return false;
  const stops = [...day.stops];
  const [sp] = stops.splice(i, 1);
  stops.splice(j, 0, sp);
  day.stops = stops;
  refreshDay(state, day, false);
  return true;
}

/** Setter rekkefølgen slik brukeren dro den, og regner tidene på nytt. */
export function setDayOrder(state: AppState, dayId: string, stops: string[]): void {
  const day = state.days.find((d) => d.id === dayId);
  if (!day || day.locked) return;
  const same = new Set(day.stops);
  if (stops.length !== day.stops.length || stops.some((id) => !same.has(id))) return;
  day.stops = [...stops];
  refreshDay(state, day, false);
}

/** Hjemmetid før og etter nærmeste-nabo-rekkefølge. Endrer ikke dagen. */
export function optimizePreview(state: AppState, dayId: string): { before: number; after: number; order: string[] } | null {
  const day = state.days.find((d) => d.id === dayId);
  if (!day || day.stops.length < 2) return null;
  const before = dayTimeline(state, day).endMin;
  const draft = structuredClone(state);
  const d = draft.days.find((x) => x.id === dayId)!;
  refreshDay(draft, d, true);
  return { before, after: dayTimeline(draft, d).endMin, order: [...d.stops] };
}

export function applyOptimizedOrder(state: AppState, dayId: string): void {
  const day = state.days.find((d) => d.id === dayId);
  if (!day || day.locked) return;
  refreshDay(state, day, true);
}

/** Forfalte og nærliggende anlegg som kan legges på en valgt dag, også i dag. */
export function daySuggestions(state: AppState, date: string, limit = 8): { control: Control; facility: Facility; drive: number; overdue: boolean }[] {
  const s = state.settings;
  const today = todayOf(s);
  const q = quarterOf(today);
  const planned = new Set(state.days.flatMap((d) => d.stops));
  const base = basePoint(s);
  const out: { control: Control; facility: Facility; drive: number; overdue: boolean }[] = [];
  for (const c of state.controls) {
    if (planned.has(c.id) || !isOpenForPlanning(c)) continue;
    if (c.status === 'utsatt' && !postponedEligible(c, quarterOf(date), today)) continue;
    const f = facilityOf(state, c);
    if (f.mergedInto || !f.coords) continue;
    if (f.blockedPeriods.some((p) => date >= p.from && date <= p.to)) continue;
    const overdue = isOverdue(c.due, today) || compareQuarter(c.due, q) < 0;
    const drive = getDriveTime(base, f.coords);
    if (!overdue && compareQuarter(c.due, q) > 0) continue;
    if (!overdue && drive > s.maxDriveMin) continue;
    out.push({ control: c, facility: f, drive, overdue });
  }
  return out.sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.drive - b.drive).slice(0, limit);
}

// ---------- Kandidater ----------

export interface Candidate { control: Control; facility: Facility; overdue: boolean; drive: number; early: boolean }

export function isOpenForPlanning(c: Control): boolean {
  return c.status === 'ikke_planlagt' || c.status === 'planlagt' || c.status === 'utsatt';
}

export function candidatesFor(state: AppState, q: Quarter, opts: { includePlanned?: boolean } = {}): { list: Candidate[]; outOfRange: Candidate[]; noCoords: Control[] } {
  const s = state.settings;
  const today = todayOf(s);
  const planningRef = today > quarterStart(q) ? today : quarterStart(q);
  const list: Candidate[] = [];
  const outOfRange: Candidate[] = [];
  const noCoords: Control[] = [];
  const plannedIds = new Set(state.days.flatMap((d) => d.stops));
  for (const c of state.controls) {
    if (!isOpenForPlanning(c)) continue;
    if (!opts.includePlanned && plannedIds.has(c.id)) continue;
    if (compareQuarter(c.due, q) > 0) continue;
    if (c.status === 'utsatt' && !postponedEligible(c, q, today)) continue;
    const f = facilityOf(state, c);
    if (f.mergedInto) continue;
    if (!f.coords) { noCoords.push(c); continue; }
    const drive = getDriveTime(basePoint(s), f.coords);
    const cand: Candidate = { control: c, facility: f, overdue: isOverdue(c.due, planningRef) || compareQuarter(c.due, q) < 0, drive, early: false };
    if (drive > s.maxDriveMin) outOfRange.push(cand);
    else list.push(cand);
  }
  return { list, outOfRange, noCoords };
}

// ---------- Bygge dager ----------

function toStop(c: Candidate, s: Settings): Stop {
  return { controlId: c.control.id, point: c.facility.coords!, duration: durationOf(c.facility, s) };
}

/** Frø = uplanlagt anlegg lengst unna (forfalte først). Legg til nærmeste naboer så lenge dagen går opp. */
export function buildDayGroups(cands: Candidate[], s: Settings): Candidate[][] {
  const base = basePoint(s);
  const left = [...cands];
  const groups: Candidate[][] = [];
  while (left.length) {
    left.sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.drive - a.drive);
    const seed = left.shift()!;
    const group = [seed];
    if (!fits([toStop(seed, s)], s)) {
      groups.push(group); // går ikke opp alene – vises som overtid
      continue;
    }
    const rejected = new Set<string>();
    for (;;) {
      if (group.length >= s.maxPerDay) break;
      let best: Candidate | null = null;
      let bestD = Infinity;
      for (const c of left) {
        if (rejected.has(c.control.id)) continue;
        const d = Math.min(...group.map((g) => getDriveTime(g.facility.coords!, c.facility.coords!)));
        if (d < bestD) { bestD = d; best = c; }
      }
      if (!best || bestD > 40) break;
      const trial = orderStops([...group, best].map((g) => toStop(g, s)), base, base);
      if (fits(trial, s)) {
        group.push(best);
        left.splice(left.indexOf(best), 1);
      } else {
        rejected.add(best.control.id);
      }
    }
    groups.push(group);
  }
  return groups;
}

// ---------- Fordele på datoer ----------

function blockedFor(f: Facility, date: string): boolean {
  return f.blockedPeriods.some((p) => date >= p.from && date <= p.to);
}

export function earliestPlanDate(state: AppState): string {
  const today = todayOf(state.settings);
  return nextWorkdayOnOrAfter(addDays(today, state.settings.preNoticeDays + 1), state.settings.blockedDays);
}

/** Første virkedag et allerede forfalt anlegg kan tas, med kortere varsel enn de vanlige tre ukene. */
export function earliestOverdueDate(state: AppState): string {
  const today = todayOf(state.settings);
  return addWorkdays(today, 1, state.settings.blockedDays);
}

/** Besøket ligger innenfor den vanlige forvarselfristen, så varselet må sendes tidligere enn normalt. */
export function isShortNotice(state: AppState, date: string): boolean {
  return date < earliestPlanDate(state);
}

/** Arbeidsdagen har minst én kontrolltid igjen før stengetid. Et fast antall ledige plasser er ikke nok. */
export function dayHasRoom(state: AppState, day: PlanDay): boolean {
  if (day.overnight || !day.stops.length) return false;
  const tl = dayTimeline(state, day);
  if (tl.overtime) return false;
  return clockToMinutes(state.settings.dayEnd) - tl.endMin >= state.settings.controlMin;
}

export function availableDates(state: AppState, q: Quarter, exclude: Set<string>): string[] {
  const s = state.settings;
  const from = [quarterStart(q), earliestPlanDate(state)].sort()[1];
  return workdaysInRange(from, quarterEnd(q), s.blockedDays).filter((d) => !exclude.has(d));
}

/** Velger datoer jevnt fordelt over kvartalet; forfalte grupper får de tidligste. Hopper over kundenes blokkerte perioder. */
export function assignDates(groups: Candidate[][], dates: string[]): { date: string; group: Candidate[] }[] {
  const out: { date: string; group: Candidate[] }[] = [];
  if (!groups.length || !dates.length) return out;
  const ordered = [...groups].sort((a, b) => Number(b.some((c) => c.overdue)) - Number(a.some((c) => c.overdue)));
  const step = Math.max(1, Math.floor(dates.length / ordered.length));
  const free = new Set(dates);
  ordered.forEach((g, i) => {
    const target = g.some((c) => c.overdue) ? 0 : Math.min(dates.length - 1, i * step);
    let pick: string | null = null;
    for (let k = target; k < dates.length && !pick; k++) if (free.has(dates[k]) && !g.some((c) => blockedFor(c.facility, dates[k]))) pick = dates[k];
    for (let k = target - 1; k >= 0 && !pick; k--) if (free.has(dates[k]) && !g.some((c) => blockedFor(c.facility, dates[k]))) pick = dates[k];
    if (pick) {
      free.delete(pick);
      out.push({ date: pick, group: g });
    }
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Legger hver gruppe på neste ledige dag, i rekkefølge. Brukes for forfalte, som ikke skal vente på forvarselsfristen. */
function assignPacked(groups: Candidate[][], dates: string[]): { date: string; group: Candidate[] }[] {
  const free = [...dates].sort();
  const out: { date: string; group: Candidate[] }[] = [];
  for (const g of groups) {
    const i = free.findIndex((d) => !g.some((c) => blockedFor(c.facility, d)));
    if (i < 0) continue;
    const [date] = free.splice(i, 1);
    out.push({ date, group: g });
  }
  return out;
}

// ---------- Lag plan ----------

export interface PlanResult {
  quarter: Quarter;
  created: number;
  planned: number;
  early: number;
  /** Kjøredager før den vanlige forvarselfristen, fordi anlegget allerede er forfalt. */
  shortNotice: number;
  unplaced: Control[];
  outOfRange: Candidate[];
  noCoords: Control[];
}

function dayIsFixed(state: AppState, d: PlanDay): boolean {
  if (d.locked) return true;
  return d.stops.some((id) => {
    const c = findControl(state, id);
    return !!c && (c.status === 'varslet' || c.status === 'bekreftet' || c.status === 'utfort' || !!c.adhocLabel);
  });
}

function inQuarter(date: string, q: Quarter): boolean {
  return date >= quarterStart(q) && date <= quarterEnd(q);
}

/** Lager (eller optimaliserer på nytt) planen for et kvartal. Låste dager og dager med varslede kunder beholdes. */
export function makePlan(state: AppState, q: Quarter, opts: { early?: boolean } = {}): PlanResult {
  const s = state.settings;
  const today = todayOf(s);
  // 1. Løs opp dager som ikke er faste.
  for (const d of [...state.days]) {
    if (!inQuarter(d.date, q) || dayIsFixed(state, d) || d.date < today) continue;
    for (const id of [...d.stops]) {
      const c = findControl(state, id);
      if (c && c.status === 'planlagt') {
        detachFromDay(state, c);
        c.status = 'ikke_planlagt';
      }
    }
    state.days = state.days.filter((x) => x.id !== d.id || x.stops.length > 0);
  }
  // 2. Kandidater og dager.
  const { list, outOfRange, noCoords } = candidatesFor(state, q);
  const groups = buildDayGroups(list, s);
  const used = new Set(state.days.map((d) => d.date));
  const noticeFrom = earliestPlanDate(state);
  const overdueFrom = [quarterStart(q), earliestOverdueDate(state)].sort()[1];
  const earlyDates = workdaysInRange(overdueFrom, quarterEnd(q), s.blockedDays).filter((d) => !used.has(d) && d < noticeFrom);
  const overdueGroups = groups.filter((g) => g.some((c) => c.overdue));
  const laterGroups = groups.filter((g) => !g.some((c) => c.overdue));
  const earlyAssigned = assignPacked(overdueGroups, earlyDates);
  for (const a of earlyAssigned) used.add(a.date);
  const missed = overdueGroups.filter((g) => !earlyAssigned.some((a) => a.group === g));
  const dates = availableDates(state, q, used);
  const assigned = [...earlyAssigned, ...assignDates([...missed, ...laterGroups], dates)];
  const placed = new Set(assigned.flatMap((a) => a.group.map((c) => c.control.id)));
  let planned = 0;
  const newDays: PlanDay[] = [];
  for (const a of assigned) {
    const day: PlanDay = { id: uid('d'), date: a.date, stops: a.group.map((c) => c.control.id), locked: false, overnight: null };
    state.days.push(day);
    newDays.push(day);
    for (const cand of a.group) {
      const c = cand.control;
      const short = a.date < noticeFrom;
      const why = short ? 'forfalt, kort varsel' : c.status === 'utsatt' ? 'utsettelse fulgt opp' : undefined;
      setStatus(state, c, 'planlagt', why);
      c.callReason = null;
      planned++;
    }
    refreshDay(state, day, true);
  }
  // 3. Tidlig: anlegg med frist neste kvartal maks N min fra en dag med ledig plass.
  let early = 0;
  if (opts.early) {
    const nextQ = addQuarters(q, 1);
    const plannedIds = new Set(state.days.flatMap((d) => d.stops));
    const pool = state.controls.filter((c) => c.status === 'ikke_planlagt' && !facilityOf(state, c).mergedInto && sameQuarter(c.due, nextQ) && !plannedIds.has(c.id) && facilityOf(state, c).coords);
    for (const day of newDays) {
      for (const c of [...pool]) {
        if (day.stops.length >= s.maxPerDay) break;
        const f = facilityOf(state, c);
        if (f.blockedPeriods.some((p) => day.date >= p.from && day.date <= p.to)) continue;
        const near = Math.min(...day.stops.map((id) => getDriveTime(stopOf(state, id)!.point, f.coords!)));
        if (near > s.earlyMaxMin) continue;
        const trial = orderStops([...day.stops.map((id) => stopOf(state, id)!), { controlId: c.id, point: f.coords!, duration: durationOf(f, s) }], basePoint(s), basePoint(s));
        if (!fits(trial, s)) continue;
        day.stops.push(c.id);
        setStatus(state, c, 'planlagt', `tidlig, frist ${fmtQuarter(c.due)}`);
        pool.splice(pool.indexOf(c), 1);
        refreshDay(state, day, true);
        early++;
      }
    }
  }
  const unplaced = list.filter((c) => !placed.has(c.control.id)).map((c) => c.control);
  const shortNotice = assigned.filter((a) => a.date < noticeFrom).length;
  return { quarter: q, created: assigned.length, planned, early, shortNotice, unplaced, outOfRange, noCoords };
}

// ---------- Manuelle endringer ----------

export function moveStop(state: AppState, controlId: string, toDayId: string): void {
  const c = findControl(state, controlId);
  const target = state.days.find((d) => d.id === toDayId);
  if (!c || !target) return;
  const from = state.days.find((d) => d.stops.includes(controlId));
  if (from) {
    from.stops = from.stops.filter((x) => x !== controlId);
    if (!from.stops.length && !from.locked) state.days = state.days.filter((d) => d.id !== from.id);
    else refreshDay(state, from);
  }
  target.stops.push(controlId);
  if (c.status === 'ikke_planlagt' || c.status === 'utsatt') setStatus(state, c, 'planlagt');
  const oldDate = c.plannedDate;
  refreshDay(state, target, true);
  if (c.status === 'varslet' || c.status === 'bekreftet') {
    c.timeFrom = null;
    refreshDay(state, target);
    logBoth(state, c, `Flyttet fra ${fmtDate(oldDate)} til ${fmtDate(target.date)} – kunden må få ny tid.`);
  } else {
    logBoth(state, c, `Flyttet til ${fmtDate(target.date)}`);
  }
}

export function removeStop(state: AppState, controlId: string): string | null {
  const c = findControl(state, controlId);
  if (!c) return null;
  const hole = detachFromDay(state, c);
  if (c.status !== 'utfort' && c.status !== 'utsatt') setStatus(state, c, 'ikke_planlagt', 'fjernet fra ruten');
  if (hole) {
    const d = state.days.find((x) => x.id === hole);
    if (d) refreshDay(state, d);
  }
  return hole;
}

export function addStopToDay(state: AppState, controlId: string, dayId: string): void {
  moveStop(state, controlId, dayId);
}

export function ensureDay(state: AppState, date: string): PlanDay {
  let d = state.days.find((x) => x.date === date);
  if (!d) {
    d = { id: uid('d'), date, stops: [], locked: false, overnight: null };
    state.days.push(d);
  }
  return d;
}

// ---------- Fylle hull ----------

export interface Suggestion { control: Control; facility: Facility; nearMin: number; extraMin: number; overdue: boolean }

/** Forfallende anlegg i nærheten som får plass på dagen. Forfalte og tidligste frist først. */
export function fillSuggestions(state: AppState, dayId: string, limit = 3): Suggestion[] {
  const day = state.days.find((d) => d.id === dayId);
  if (!day) return [];
  const s = state.settings;
  const today = todayOf(s);
  const plannedIds = new Set(state.days.flatMap((d) => d.stops));
  const stops = day.stops.map((id) => stopOf(state, id)).filter((x): x is Stop => !!x);
  if (stops.length >= s.maxPerDay) return [];
  const base = basePoint(s);
  const baseCost = tourCost(orderStops(stops, base, base), base, base);
  const horizon = addQuarters({ ...quarterOfDate(day.date) }, 1);
  const out: Suggestion[] = [];
  for (const c of state.controls) {
    if (plannedIds.has(c.id) || !isOpenForPlanning(c)) continue;
    if (c.status === 'utsatt' && !postponedEligible(c, quarterOfDate(day.date), today)) continue;
    if (compareQuarter(c.due, horizon) > 0) continue;
    const f = facilityOf(state, c);
    if (!f.coords || f.blockedPeriods.some((p) => day.date >= p.from && day.date <= p.to)) continue;
    const ref = stops.length ? stops.map((x) => x.point) : [base];
    const near = Math.min(...ref.map((p) => getDriveTime(p, f.coords!)));
    if (near > 45) continue;
    const trial = orderStops([...stops, { controlId: c.id, point: f.coords, duration: durationOf(f, s) }], base, base);
    if (!fits(trial, s, dayEnds(state, day))) continue;
    out.push({ control: c, facility: f, nearMin: near, extraMin: tourCost(trial, base, base) - baseCost, overdue: isOverdue(c.due, today) });
  }
  return out
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || compareQuarter(a.control.due, b.control.due) || a.extraMin - b.extraMin)
    .slice(0, limit);
}

function quarterOfDate(iso: string): Quarter {
  const m = Number(iso.slice(5, 7));
  return { q: (Math.floor((m - 1) / 3) + 1) as Quarter['q'], year: Number(iso.slice(0, 4)) };
}

// ---------- Overnatting ----------

export interface OvernightOption {
  dayTrips: { days: number; controls: number; driveMin: number };
  overnight: { controls: number; driveMin: number; day1: string[]; day2: string[] };
  dayIds: string[];
}

/** For klynger 1,5 t eller mer unna: sammenlign to dagsturer med to dager med overnatting. */
export function overnightOption(state: AppState, dayId: string): OvernightOption | null {
  const s = state.settings;
  const day = state.days.find((d) => d.id === dayId);
  if (!day || day.locked || day.overnight || dayIsFixed(state, day)) return null;
  const stops = day.stops.map((id) => stopOf(state, id)).filter((x): x is Stop => !!x);
  if (!stops.length) return null;
  const base = basePoint(s);
  const avg = stops.reduce((a, st) => a + getDriveTime(base, st.point), 0) / stops.length;
  if (avg < 90) return null;
  // Nabodager (ulåste, samme kvartal, nær klyngen) og uplanlagte kandidater i nærheten.
  const q = quarterOfDate(day.date);
  const near = (p: LatLng) => stops.some((st) => getDriveTime(st.point, p) <= 45);
  const otherDays = state.days.filter((d) => d.id !== day.id && !d.overnight && !dayIsFixed(state, d) && inQuarter(d.date, q) && d.stops.every((id) => { const st = stopOf(state, id); return !!st && near(st.point); }));
  const partner = otherDays[0];
  const poolIds = [...day.stops, ...(partner?.stops ?? [])];
  const { list } = candidatesFor(state, q);
  for (const c of list) if (near(c.facility.coords!) && !poolIds.includes(c.control.id)) poolIds.push(c.control.id);
  const pool = poolIds.map((id) => stopOf(state, id)).filter((x): x is Stop => !!x);
  // To dagsturer.
  const tripDays: Stop[][] = [];
  let left = [...pool];
  for (let k = 0; k < 2 && left.length; k++) {
    const g = greedyDay(left, s, base, base);
    tripDays.push(g);
    left = left.filter((x) => !g.includes(x));
  }
  const tripDrive = tripDays.reduce((a, g) => a + buildTimeline(g, s).driveMin, 0);
  // Overnatting: dag 1 uten hjemtur, dag 2 starter der dag 1 sluttet.
  const d1 = greedyDay(pool, s, base, null);
  const last = d1[d1.length - 1]?.point ?? base;
  const rest = pool.filter((x) => !d1.includes(x));
  const d2 = greedyDay(rest, s, last, base);
  const onDrive = buildTimeline(d1, s, { end: null }).driveMin + buildTimeline(d2, s, { start: last }).driveMin;
  return {
    dayTrips: { days: tripDays.length, controls: tripDays.reduce((a, g) => a + g.length, 0), driveMin: tripDrive },
    overnight: { controls: d1.length + d2.length, driveMin: onDrive, day1: d1.map((x) => x.controlId), day2: d2.map((x) => x.controlId) },
    dayIds: [day.id, ...(partner ? [partner.id] : [])],
  };
}

function greedyDay(pool: Stop[], s: Settings, start: LatLng, end: LatLng | null): Stop[] {
  const left = [...pool];
  let day: Stop[] = [];
  // Start med stoppet lengst unna start (for overnatting: lengst ut), legg til nærmeste så lenge det går opp.
  left.sort((a, b) => getDriveTime(start, b.point) - getDriveTime(start, a.point));
  if (end === null) left.sort((a, b) => getDriveTime(start, a.point) - getDriveTime(start, b.point));
  for (const st of left) {
    if (day.length >= s.maxPerDay) break;
    const trial = orderStops([...day, st], start, end);
    if (fits(trial, s, { start, end })) day = trial;
  }
  return day;
}

export function applyOvernight(state: AppState, opt: OvernightOption): void {
  const days = opt.dayIds.map((id) => state.days.find((d) => d.id === id)).filter((d): d is PlanDay => !!d);
  if (!days.length) return;
  const s = state.settings;
  const first = days.map((d) => d.date).sort()[0];
  const used = new Set(state.days.filter((d) => !opt.dayIds.includes(d.id)).map((d) => d.date));
  let date1 = first;
  let date2 = nextWorkdayOnOrAfter(addDays(date1, 1), s.blockedDays);
  // Finn to påfølgende ledige virkedager fra og med første dato.
  for (let i = 0; i < 40 && (used.has(date1) || used.has(date2)); i++) {
    date1 = nextWorkdayOnOrAfter(addDays(date1, 1), s.blockedDays);
    date2 = nextWorkdayOnOrAfter(addDays(date1, 1), s.blockedDays);
  }
  const keep = new Set([...opt.overnight.day1, ...opt.overnight.day2]);
  for (const d of days) {
    for (const id of d.stops) {
      if (keep.has(id)) continue;
      const c = findControl(state, id);
      if (c && c.status === 'planlagt') { c.plannedDate = null; c.timeFrom = null; c.timeTo = null; setStatus(state, c, 'ikke_planlagt', 'fikk ikke plass i overnattingsturen'); }
    }
  }
  state.days = state.days.filter((d) => !opt.dayIds.includes(d.id));
  const ut: PlanDay = { id: uid('d'), date: date1, stops: opt.overnight.day1, locked: false, overnight: 'ut' };
  const hjem: PlanDay = { id: uid('d'), date: date2, stops: opt.overnight.day2, locked: false, overnight: 'hjem' };
  state.days.push(ut, hjem);
  for (const id of keep) {
    const c = findControl(state, id);
    if (c && c.status === 'ikke_planlagt') setStatus(state, c, 'planlagt');
  }
  refreshDay(state, ut);
  refreshDay(state, hjem);
}

// ---------- Navigasjon ----------

export function googleRouteUrl(points: LatLng[], origin: LatLng, dest: LatLng): string {
  const p = (x: LatLng) => `${x.lat.toFixed(5)},${x.lng.toFixed(5)}`;
  const wp = points.map(p).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${p(origin)}&destination=${p(dest)}${wp ? `&waypoints=${encodeURIComponent(wp)}` : ''}&travelmode=driving`;
}

export function googleStopUrl(pt: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${pt.lat.toFixed(5)},${pt.lng.toFixed(5)}&travelmode=driving`;
}

export function appleStopUrl(pt: LatLng, label = ''): string {
  return `https://maps.apple.com/?daddr=${pt.lat.toFixed(5)},${pt.lng.toFixed(5)}&dirflg=d${label ? `&q=${encodeURIComponent(label)}` : ''}`;
}

export function dayRouteUrl(state: AppState, day: PlanDay): string {
  const s = state.settings;
  const base = basePoint(s);
  const { opts, ids } = routeOpts(state, day);
  const pts = ids.map((id) => stopOf(state, id)?.point).filter((x): x is LatLng => !!x);
  const origin = opts.start ?? base;
  if (opts.end === null) {
    const last = pts.pop() ?? origin;
    return googleRouteUrl(pts, origin, last);
  }
  return googleRouteUrl(pts, origin, opts.end ?? base);
}

export function dayArea(state: AppState, day: PlanDay): string {
  const counts = new Map<string, number>();
  for (const id of day.stops) {
    const c = findControl(state, id);
    if (!c) continue;
    const f = facilityOf(state, c);
    const a = areaOfFacility(f);
    counts.set(a, (counts.get(a) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0]).slice(0, 2).join(' / ') || '–';
}

export function areaOfFacility(f: Facility): string {
  return areaFor(f.address.place, f.address.postcode);
}

export function isPastOrToday(date: string, today: string): boolean {
  return date <= today;
}

export { isWorkday };
