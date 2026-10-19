// Samme gateadresse med ulikt Objekt ID: tilbud om ett felles besøk.
import type { AppState, Facility } from './types';
import { currentControl, detachFromDay, logBoth, todayOf } from './controls';
import { nowStamp } from './dates';

export function addressKey(address: { street: string; postcode: string; place: string }): string {
  const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!n(address.street) || !n(address.postcode)) return '';
  return `${n(address.street)}|${n(address.postcode)}|${n(address.place)}`;
}

export function sameAddressOf(state: AppState, f: Facility): Facility | null {
  const key = addressKey(f.address);
  if (!key || f.mergedInto) return null;
  return state.facilities.find((o) => o.id !== f.id && !o.mergedInto && o.objectId !== f.objectId && addressKey(o.address) === key) ?? null;
}

export function sameAddressPairs(state: AppState): { a: Facility; b: Facility }[] {
  const out: { a: Facility; b: Facility }[] = [];
  const seen = new Set<string>();
  for (const f of state.facilities) {
    const other = sameAddressOf(state, f);
    if (!other) continue;
    const k = [f.id, other.id].sort().join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ a: f, b: other });
  }
  return out;
}

/** Beholder ett anlegg som besøket, og lar det andre følge med i stedet for å bli et eget stopp. */
export function mergeIntoOneVisit(state: AppState, idA: string, idB: string): { keepId: string } {
  const a = state.facilities.find((f) => f.id === idA);
  const b = state.facilities.find((f) => f.id === idB);
  if (!a || !b || a.id === b.id) throw new Error('Kan ikke slå sammen disse anleggene');
  const onRoute = (f: Facility) => {
    const c = currentControl(state, f.id);
    return !!c && state.days.some((d) => d.stops.includes(c.id));
  };
  const dueRank = (f: Facility) => {
    const c = currentControl(state, f.id);
    return c ? c.due.year * 10 + c.due.q : 99999;
  };
  let keep = a;
  let drop = b;
  if (onRoute(b) && !onRoute(a)) { keep = b; drop = a; }
  else if (onRoute(a) === onRoute(b) && dueRank(b) < dueRank(a)) { keep = b; drop = a; }

  drop.mergedInto = keep.id;
  const dropControl = currentControl(state, drop.id);
  if (dropControl && dropControl.status !== 'utfort') detachFromDay(state, dropControl);
  const line = `Samme besøk som ${drop.customer || 'anlegg'} (Objekt ID ${drop.objectId}).`;
  if (!keep.notes.includes(drop.objectId)) keep.notes = keep.notes ? `${keep.notes}\n${line}` : line;
  const at = nowStamp(todayOf(state.settings));
  const keepControl = currentControl(state, keep.id);
  if (keepControl) logBoth(state, keepControl, `Slått sammen med Objekt ID ${drop.objectId} til ett besøk.`);
  else keep.log.push({ at, text: `Slått sammen med Objekt ID ${drop.objectId} til ett besøk.` });
  drop.log.push({ at, text: `Dekkes av besøket til ${keep.customer} (Objekt ID ${keep.objectId}).` });
  return { keepId: keep.id };
}
