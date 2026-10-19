// Kjøretidsringer. Samme anslag som getDriveTime: luftlinje × 1,4 ÷ 70 km/t + 5 min.
import type { AppState, Facility } from './types';
import { driveFromBase } from './planner';
import { areaName } from './selectors';

export const RING_MINUTES = [30, 60, 90, 120] as const;
export type RingMinute = (typeof RING_MINUTES)[number];

export type MapFocus =
  | { kind: 'min'; min: number }
  | { kind: 'area'; name: string };

export function inDriveBand(driveMin: number, maxMin: number): boolean {
  return driveMin <= maxMin;
}

export function facilitiesInFocus(state: AppState, focus: MapFocus): Facility[] {
  return state.facilities.filter((f) => {
    if (f.mergedInto || !f.coords) return false;
    if (focus.kind === 'area') return areaName(state, f.id) === focus.name;
    const drive = driveFromBase(state.settings, f);
    return drive !== null && inDriveBand(drive, focus.min);
  });
}
