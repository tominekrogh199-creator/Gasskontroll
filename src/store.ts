// Tilstand og varig lagring (localStorage). Eksport/import av JSON finnes i innstillinger.
import { useEffect, useState } from 'preact/hooks';
import type { AppState } from './domain/types';
import { buildDemo, defaultSettings, migrateDriveRadius } from './data/demo';
import { deviceToday } from './domain/dates';
import { runAutomations } from './domain/notices';

const KEY = 'kontrollplan.v1';

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      s.settings = migrateDriveRadius({ ...defaultSettings(), ...s.settings, templates: { ...defaultSettings().templates, ...s.settings.templates } });
      s.imports = s.imports ?? [];
      return s;
    }
  } catch {
    /* ødelagt lagring – start på nytt med demodata */
  }
  return buildDemo(deviceToday());
}

let state: AppState = load();
runAutomations(state);
const listeners = new Set<() => void>();
let persistOk = true;

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    persistOk = true;
  } catch {
    persistOk = false;
  }
}
save();

export function getState(): AppState {
  return state;
}

export function isPersisted(): boolean {
  return persistOk;
}

/** Endrer et utkast av tilstanden, kjører automatikk (utkast, purring) og lagrer. */
export function update<T>(fn: (draft: AppState) => T): T {
  const draft = structuredClone(state);
  const result = fn(draft);
  runAutomations(draft);
  state = draft;
  save();
  listeners.forEach((l) => l());
  return result;
}

export function replaceState(next: AppState): void {
  next.settings = migrateDriveRadius({ ...defaultSettings(), ...next.settings, templates: { ...defaultSettings().templates, ...next.settings.templates } });
  state = next;
  runAutomations(state);
  save();
  listeners.forEach((l) => l());
}

export function resetDemo(today: string): void {
  const s = { ...state.settings };
  replaceState(buildDemo(today, s));
}

export function useAppState(): AppState {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return state;
}
