// Avledede lister for skjermene. Forfalte og snart forfalte står alltid først.
import type { AppState, Control, PlanDay, Quarter } from './types';
import { addDays, compareQuarter, isOverdue, quarterEnd, quarterOf, sameQuarter } from './dates';
import { facilityOf, todayOf } from './controls';
import { draftsToApprove, lateDrafts } from './notices';
import { driveFromBase } from './planner';

export function urgencySort(state: AppState, list: Control[]): Control[] {
  const today = todayOf(state.settings);
  return [...list].sort((a, b) => {
    const ao = isOverdue(a.due, today) ? 0 : 1;
    const bo = isOverdue(b.due, today) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    const dq = compareQuarter(a.due, b.due);
    if (dq) return dq;
    const order = ['ikke_planlagt', 'utsatt', 'planlagt', 'varslet', 'bekreftet', 'utfort'];
    return order.indexOf(a.status) - order.indexOf(b.status);
  });
}

export function openControls(state: AppState): Control[] {
  return state.controls.filter((c) => c.status !== 'utfort');
}

export interface HomeStats {
  quarter: Quarter;
  dueInQuarter: Control[]; // frist i kvartalet + forfalte, forfalte øverst
  dueThisQuarter: Control[]; // samme liste som tallet «Forfaller i kvartalet»
  overdue: Control[];
  atRisk: Control[]; // frist innen to uker eller forfalt, og ikke satt på en dag
  pending: number;
  late: number;
  postponed: Control[];
  nextDay: PlanDay | null;
  todayDay: PlanDay | null;
}

/** Frist innen to uker, eller allerede forfalt, og ikke lagt på en kjøredag. */
export function atRiskControls(state: AppState): Control[] {
  const today = todayOf(state.settings);
  const horizon = addDays(today, 14);
  const onDay = new Set(state.days.flatMap((d) => d.stops));
  return urgencySort(state, state.controls.filter((c) => {
    if (c.status === 'utfort' || onDay.has(c.id)) return false;
    if (facilityOf(state, c).mergedInto) return false;
    return isOverdue(c.due, today) || quarterEnd(c.due) <= horizon;
  }));
}

export function homeStats(state: AppState): HomeStats {
  const today = todayOf(state.settings);
  const q = quarterOf(today);
  const open = openControls(state).filter((c) => !c.adhocLabel);
  const overdue = urgencySort(state, open.filter((c) => isOverdue(c.due, today)));
  const inQ = open.filter((c) => sameQuarter(c.due, q) && !isOverdue(c.due, today));
  const nextDay = [...state.days].filter((d) => d.date > today && d.stops.length).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const todayDay = state.days.find((d) => d.date === today && d.stops.length) ?? null;
  return {
    quarter: q,
    dueInQuarter: urgencySort(state, [...overdue, ...inQ]),
    dueThisQuarter: urgencySort(state, inQ),
    overdue,
    atRisk: atRiskControls(state),
    pending: draftsToApprove(state).length,
    late: lateDrafts(state).length,
    postponed: urgencySort(state, open.filter((c) => c.status === 'utsatt')),
    nextDay,
    todayDay,
  };
}

export function areaCounts(state: AppState, controls: Control[]): { area: string; count: number }[] {
  const m = new Map<string, number>();
  for (const c of controls) {
    const f = facilityOf(state, c);
    const a = areaName(state, f.id);
    m.set(a, (m.get(a) ?? 0) + 1);
  }
  return [...m.entries()].map(([area, count]) => ({ area, count })).sort((a, b) => b.count - a.count || a.area.localeCompare(b.area));
}

import { areaFor } from './geo';
export function areaName(state: AppState, facilityId: string): string {
  const f = state.facilities.find((x) => x.id === facilityId);
  return f ? areaFor(f.address.place, f.address.postcode) : 'Øvrige';
}

export function driveMinOf(state: AppState, facilityId: string): number | null {
  const f = state.facilities.find((x) => x.id === facilityId);
  return f ? driveFromBase(state.settings, f) : null;
}

export function tankRequalYear(inServiceYear: number | null | undefined): number | null {
  return inServiceYear ? inServiceYear + 18 : null;
}

export function sortedDays(state: AppState): PlanDay[] {
  return [...state.days].sort((a, b) => a.date.localeCompare(b.date));
}
