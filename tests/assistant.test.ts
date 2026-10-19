import { describe, expect, it } from 'vitest';
import { buildDemo, defaultSettings } from '../src/data/demo';
import { applyRouteDraft, replyRuleBased } from '../src/domain/assistant';
import { facilitiesInFocus, inDriveBand } from '../src/domain/radius';
import { areaName } from '../src/domain/selectors';
import { minutesToRadiusMeters } from '../src/adapters/driveTime';
import { driveFromBase } from '../src/domain/planner';
import type { AppState } from '../src/domain/types';

function demo(): AppState {
  const s = defaultSettings();
  s.testDate = '2026-10-19';
  return buildDemo('2026-10-19', s);
}

describe('radius', () => {
  it('30-minutters ringen er en delmengde av 2 timer', () => {
    const st = demo();
    const near = facilitiesInFocus(st, { kind: 'min', min: 30 });
    const two = facilitiesInFocus(st, { kind: 'min', min: 120 });
    expect(near.length).toBeGreaterThan(0);
    expect(two.length).toBeGreaterThan(near.length);
    for (const f of near) expect(driveFromBase(st.settings, f)!).toBeLessThanOrEqual(30);
    for (const f of two) expect(inDriveBand(driveFromBase(st.settings, f)!, 120)).toBe(true);
  });

  it('Drammen-filteret er bare det området', () => {
    const st = demo();
    const list = facilitiesInFocus(st, { kind: 'area', name: 'Drammen og omegn' });
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((f) => areaName(st, f.id) === 'Drammen og omegn')).toBe(true);
    const outside = st.facilities.filter((f) => f.coords && !f.mergedInto && areaName(st, f.id) !== 'Drammen og omegn');
    expect(outside.length).toBeGreaterThan(0);
    expect(list.some((f) => outside.some((o) => o.id === f.id))).toBe(false);
    expect(minutesToRadiusMeters(120)).toBeGreaterThan(minutesToRadiusMeters(30));
  });
});

describe('planassistent', () => {
  it('foreslår en rute uten å endre dagen, og bekreftelse legger den inn', () => {
    const st = demo();
    const before = JSON.stringify(st.days);
    const reply = replyRuleBased(st, 'lag en rute for i dag med 3 stopp');
    expect(JSON.stringify(st.days)).toBe(before);
    expect(reply.draft).not.toBeNull();
    expect(reply.draft!.controlIds.length).toBeLessThanOrEqual(3);
    expect(reply.draft!.controlIds.length).toBeGreaterThan(0);
    expect(reply.draft!.date).toBe('2026-10-19');
    for (const id of reply.draft!.controlIds) {
      const f = st.facilities.find((x) => st.controls.find((c) => c.id === id)?.facilityId === x.id)!;
      expect(driveFromBase(st.settings, f)!).toBeLessThanOrEqual(120);
    }
    applyRouteDraft(st, reply.draft!);
    const day = st.days.find((d) => d.date === '2026-10-19');
    expect(day?.stops).toEqual(expect.arrayContaining(reply.draft!.controlIds));
  });

  it('anbefaler innen 2 timer og svarer hvor mange som får plass', () => {
    const st = demo();
    const advice = replyRuleBased(st, 'anbefal 3–4 kunder innen 2 timer');
    expect(advice.draft!.controlIds.length).toBeGreaterThanOrEqual(3);
    expect(advice.draft!.controlIds.length).toBeLessThanOrEqual(4);
    const many = replyRuleBased(st, 'hvor mange kjøreturer kan jeg rekke i dag?');
    expect(many.text).toMatch(/rekker \d stopp/);
    expect(many.draft!.controlIds.length).toBeGreaterThan(0);
  });
});
