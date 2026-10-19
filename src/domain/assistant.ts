// Planassistent. Forslag regnes av den vanlige rute-koden. Ingenting lagres før brukeren bekrefter.
import type { AppState } from './types';
import { addDays, fmtDateWeekday, isWorkday, minutesToClock, nextWorkdayOnOrAfter } from './dates';
import { areaName } from './selectors';
import { addStopToDay, buildQuickRoute, dayTimeline, driveFromBase, ensureDay, isOpenForPlanning } from './planner';
import { facilityOf, todayOf } from './controls';

export interface RouteDraft {
  date: string;
  controlIds: string[];
  lines: string[];
  endMin: number;
}

export interface AssistantAnswer {
  text: string;
  draft: RouteDraft | null;
  /** Fakta teksten er bygget på. Sendes til modellen når en nøkkel finnes. */
  facts: string;
  allowedIds: string[];
}

function openDate(state: AppState, today: string): string {
  let date = isWorkday(today, state.settings.blockedDays) ? today : nextWorkdayOnOrAfter(today, state.settings.blockedDays);
  for (let i = 0; i < 12; i++) {
    const day = state.days.find((d) => d.date === date);
    if (!day?.locked && (day?.stops.length ?? 0) < state.settings.maxPerDay) return date;
    date = nextWorkdayOnOrAfter(addDays(date, 1), state.settings.blockedDays);
  }
  return date;
}

function toDraft(copy: AppState, date: string, ids: string[]): RouteDraft | null {
  const day = copy.days.find((d) => d.date === date);
  if (!day) return null;
  const tl = dayTimeline(copy, day);
  const lines = ids.map((id) => {
    const c = copy.controls.find((x) => x.id === id);
    if (!c) return id;
    const f = facilityOf(copy, c);
    const drive = driveFromBase(copy.settings, f);
    return `${f.customer}, ${f.address.place}${drive !== null ? ` · ca. ${drive} min` : ''}`;
  });
  return { date, controlIds: ids, lines, endMin: tl.endMin };
}

/** Regner et forslag på en kopi. Den ekte tilstanden røres ikke. */
export function previewRoute(state: AppState, date: string, opts: { maxDriveMin?: number; area?: string; limit?: number } = {}): RouteDraft | null {
  const copy = structuredClone(state);
  if (opts.maxDriveMin) copy.settings.maxDriveMin = opts.maxDriveMin;
  if (opts.limit) {
    const before = copy.days.find((d) => d.date === date)?.stops.length ?? 0;
    copy.settings.maxPerDay = Math.min(state.settings.maxPerDay, before + opts.limit);
  }
  if (opts.area) {
    for (const f of copy.facilities) {
      if (areaName(copy, f.id) !== opts.area) f.coords = null;
    }
  }
  const res = buildQuickRoute(copy, date);
  if (!res?.added.length) return null;
  return toDraft(copy, date, res.added);
}

/** Legger forslaget på dagen. Kalles bare fra bekreft-knappen. */
export function applyRouteDraft(state: AppState, draft: { date: string; controlIds: string[] }): string {
  const day = ensureDay(state, draft.date);
  for (const id of draft.controlIds) {
    if (day.stops.includes(id)) continue;
    addStopToDay(state, id, day.id);
  }
  return day.id;
}

/** Sjekker at et modellforslag fortsatt går opp i arbeidsdagen. */
export function draftFromIds(state: AppState, date: string, ids: string[]): RouteDraft | null {
  const unique = [...new Set(ids)].filter((id) => state.controls.some((c) => c.id === id));
  if (!unique.length || unique.length > state.settings.maxPerDay) return null;
  const copy = structuredClone(state);
  const day = ensureDay(copy, date);
  for (const id of unique) {
    if (!day.stops.includes(id)) addStopToDay(copy, id, day.id);
  }
  const tl = dayTimeline(copy, day);
  if (tl.overtime) return null;
  return toDraft(copy, date, unique);
}

export function replyRuleBased(state: AppState, question: string): AssistantAnswer {
  const today = todayOf(state.settings);
  const q = question.toLowerCase();
  const date = openDate(state, today);
  const drammen = /drammen/.test(q);
  const twoHours = /2\s*timer|to timer|120/.test(q);
  const howMany = /hvor mange|rekke|kapasitet/.test(q);
  const wantsThree = /(?:^|\D)3(?:\D|$)/.test(q) && !/3\s*[–-]\s*4/.test(q);
  const limit = wantsThree ? 3 : /3\s*[–-]\s*4|anbefal/.test(q) ? 4 : state.settings.maxPerDay;
  const maxDriveMin = twoHours ? 120 : undefined;
  const area = drammen ? 'Drammen og omegn' : undefined;
  const draft = previewRoute(state, date, { maxDriveMin, area, limit });
  const when = date === today ? 'i dag' : fmtDateWeekday(date);
  const facts = [
    `Dato: ${date}`,
    `Base: ${state.settings.baseName}`,
    `Maks stopp: ${limit}`,
    `Kjøretid tak: ${maxDriveMin ?? state.settings.maxDriveMin} min`,
    area ? `Område: ${area}` : 'Område: innen radius',
    draft ? `Forslag: ${draft.controlIds.map((id, i) => `${id} ${draft.lines[i]}`).join(' | ')}` : 'Forslag: ingen',
    draft ? `Hjemme ca. ${minutesToClock(draft.endMin)}` : '',
  ].filter(Boolean).join('\n');
  if (!draft) {
    return {
      text: drammen
        ? 'Ingen ledige anlegg i Drammen og omegn som får plass den dagen.'
        : 'Ingen ledige anlegg innen kjøreavstanden som får plass den dagen.',
      draft: null,
      facts,
      allowedIds: [],
    };
  }
  const names = draft.lines.join('; ');
  const home = minutesToClock(draft.endMin);
  const text = howMany
    ? `Du rekker ${draft.controlIds.length} stopp ${when}, hjemme ca. ${home}. Forslag: ${names}.`
    : drammen
      ? `I Drammen og omegn passer ${names}. Hjemme ca. ${home}.`
      : `Forslag ${when}: ${names}. Hjemme ca. ${home}.`;
  const cap = maxDriveMin ?? state.settings.maxDriveMin;
  const allowedIds = [...new Set([
    ...draft.controlIds,
    ...state.controls.filter((c) => {
      if (!isOpenForPlanning(c)) return false;
      const f = facilityOf(state, c);
      if (!f.coords || f.mergedInto) return false;
      if (area && areaName(state, f.id) !== area) return false;
      const drive = driveFromBase(state.settings, f);
      return drive !== null && drive <= cap;
    }).map((c) => c.id),
  ])].slice(0, 16);
  return { text, draft, facts, allowedIds };
}
