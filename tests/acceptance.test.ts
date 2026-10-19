// De åtte akseptansetestene, kjørt mot domenelogikken (samme kode som appen bruker).
import { describe, it, expect } from 'vitest';
import { buildDemo, defaultSettings } from '../src/data/demo';
import { makePlan, dayTimeline, fillSuggestions, dayArea, dayRouteUrl, googleStopUrl, stopOf } from '../src/domain/planner';
import { addDays, addQuarters, firstWorkdayOfQuarter, isOverdue, quarterOf, fmtDateWeekday } from '../src/domain/dates';
import { homeStats, sortedDays } from '../src/domain/selectors';
import { complete, facilityOf, pinColor, postpone, recipient, todayOf } from '../src/domain/controls';
import { callList, markSent, reminderSendDate, runAutomations, draftsToApprove } from '../src/domain/notices';
import { parseReport } from '../src/domain/reportParser';
import { EXAMPLE_REPORT, facilityFromReport, importFacility } from '../src/domain/importer';
import { tankRequalYear } from '../src/domain/selectors';
import type { AppState } from '../src/domain/types';

function demoAt(date: string): AppState {
  const s = defaultSettings();
  s.testDate = date;
  return buildDemo(date, s);
}

describe('1. Kvartalsstart', () => {
  const start = firstWorkdayOfQuarter({ q: 1, year: 2027 });
  it('første virkedag i K1 2027 er mandag 04.01.2027', () => {
    expect(start).toBe('2027-01-04');
  });
  it('Hjem viser antall som forfaller, forfalte øverst', () => {
    const st = demoAt(start);
    const h = homeStats(st);
    expect(h.dueInQuarter.length).toBeGreaterThan(15);
    expect(h.overdue.length).toBeGreaterThan(0);
    const firstNonOverdue = h.dueInQuarter.findIndex((c) => !isOverdue(c.due, start));
    const lastOverdue = h.dueInQuarter.map((c) => isOverdue(c.due, start)).lastIndexOf(true);
    expect(lastOverdue).toBeLessThan(firstNonOverdue);
  });
  it('«Lag plan» gir kjøredager for hele kvartalet uten dager over arbeidstiden', () => {
    const st = demoAt(start);
    const r = makePlan(st, { q: 1, year: 2027 });
    expect(r.created).toBeGreaterThan(5);
    expect(r.unplaced).toHaveLength(0);
    for (const d of st.days) expect(dayTimeline(st, d).overtime).toBe(false);
    const dates = sortedDays(st).map((d) => d.date);
    expect(dates[dates.length - 1] > '2027-02-15').toBe(true); // fordelt over kvartalet
  });
});

describe('2. Morgen i felt', () => {
  it('neste kjøredag har rute til første stopp med notater og avvik tilgjengelig', () => {
    const st = demoAt('2026-10-19');
    const h = homeStats(st);
    expect(h.nextDay).not.toBeNull();
    const first = h.nextDay!.stops[0];
    const url = googleStopUrl(stopOf(st, first)!.point);
    expect(url).toContain('google.com/maps/dir');
    expect(dayRouteUrl(st, h.nextDay!)).toContain('waypoints');
    const f = facilityOf(st, st.controls.find((c) => c.id === first)!);
    expect(typeof f.notes).toBe('string');
    expect(Array.isArray(f.deviations)).toBe(true);
  });
});

describe('3. Utsettelse', () => {
  it('«Venter på service» → Utsatt (oransje), ute av ruten, hull-forslag, oppfølging, servicepartner, advarsel', () => {
    const today = '2026-10-19';
    const st = demoAt(today);
    makePlan(st, quarterOf(today));
    const day = sortedDays(st).find((d) => d.stops.length >= 2 && st.controls.find((c) => c.id === d.stops[0])!.status === 'planlagt')!;
    const cid = day.stops[0];
    const nextQ = addQuarters(quarterOf(today), 1);
    const { holeDayId } = postpone(st, cid, { reason: 'Venter på service', text: 'Service i januar', newPeriod: nextQ, requestedBy: 'Kunde' });
    const c = st.controls.find((x) => x.id === cid)!;
    const f = facilityOf(st, c);
    expect(c.status).toBe('utsatt');
    expect(pinColor(c, f, today)).toBe('orange');
    expect(st.days.some((d) => d.stops.includes(cid))).toBe(false);
    expect(holeDayId).toBe(day.id);
    expect(fillSuggestions(st, holeDayId!).length).toBeGreaterThan(0);
    expect(c.postponement!.followUp).toBe(addDays(today, 30));
    expect(f.servicePartner).toBeTruthy();
    expect(c.log.at(-1)!.text).toContain(`Servicepartner: ${f.servicePartner}`);
    // Kontrollen hadde frist i inneværende kvartal → neste kvartal er etter fristen.
    if (c.due.q === quarterOf(today).q) expect(c.postponement!.afterDeadline).toBe(true);
  });
});

describe('4. Virkedager', () => {
  it('besøk tirsdag 30.03.2027 gir påminnelse mandag 22.03.2027 (påsken telles ikke)', () => {
    expect(fmtDateWeekday('2027-03-30')).toBe('tirsdag 30.03.2027');
    expect(reminderSendDate('2027-03-30', defaultSettings())).toBe('2027-03-22');
  });
  it('gjennom flyten: forvarsel sendt → påminnelsesutkast med sendedato 22.03.2027', () => {
    const st = demoAt('2027-02-15');
    const c = st.controls.find((x) => x.status === 'ikke_planlagt' && recipient(facilityOf(st, x)))!;
    st.days.push({ id: 'dx', date: '2027-03-30', stops: [c.id], locked: false, overnight: null });
    c.status = 'planlagt';
    c.plannedDate = '2027-03-30';
    c.timeFrom = '09:00';
    c.timeTo = '11:00';
    runAutomations(st);
    const fv = c.notices.find((n) => n.kind === 'forvarsel')!;
    markSent(st, fv);
    const rem = c.notices.find((n) => n.kind === 'paminnelse')!;
    expect(rem.sendDate).toBe('2027-03-22');
    expect(rem.status).toBe('utkast');
  });
});

describe('5. Kapasitet', () => {
  it('Askim-området får 2–3 per dag, tette stopp i Drammen-området får 4', () => {
    const today = '2026-10-19';
    const st = demoAt(today);
    makePlan(st, quarterOf(today));
    const days = sortedDays(st);
    const askim = days.filter((d) => dayArea(st, d).startsWith('Indre Østfold'));
    expect(askim.length).toBeGreaterThan(0);
    expect(Math.max(...askim.map((d) => d.stops.length))).toBeGreaterThanOrEqual(2);
    expect(Math.max(...askim.map((d) => d.stops.length))).toBeLessThanOrEqual(3);
    const drammen = days.filter((d) => dayArea(st, d).startsWith('Drammen og omegn'));
    expect(Math.max(...drammen.map((d) => d.stops.length))).toBe(4);
  });
});

describe('6. Prøv import', () => {
  const p = parseReport(EXAMPLE_REPORT);
  const f = facilityFromReport(p, 'eksempelrapport.pdf', '2026-10-19');
  it('henter riktige felt', () => {
    expect(f.objectId).toBe('31417');
    expect(f.nextDue).toEqual({ q: 1, year: 2029 });
    expect(f.address).toEqual({ street: 'Eksempelveien 12', postcode: '1814', place: 'Askim' });
    expect(f.gnr).toBe('12');
    expect(f.bnr).toBe('3');
    expect(recipient(f)?.contact.email).toBe('kari@example.no');
    expect(recipient(f)?.contact.role).toBe('representant');
    expect(f.lastControl).toBe('2025-02-27');
    expect(tankRequalYear(f.tank?.inServiceYear)).toBe(2027);
    expect(f.servicePartner).toBe('Eksempel Rør AS');
    expect(f.gasType).toBe('LPG');
    expect(f.controlType).toBe('Akkreditert systematisk tilstandskontroll');
    expect(f.orgNr).toBe('999999999');
    expect(f.deviations.filter((d) => d.severity === 'avvik')).toHaveLength(1);
  });
  it('flagger 24.09.2025 som ulogisk og sender til gjennomgang', () => {
    expect(f.flags.some((x) => x.includes('24.09.2025'))).toBe(true);
    expect(f.reviewPending).toBe(true);
  });
  it('duplikat: samme Objekt ID gir nyeste som gjeldende, eldre som historikk', () => {
    const st = demoAt('2026-10-19');
    importFacility(st, f);
    const older = facilityFromReport(parseReport(EXAMPLE_REPORT.replace('25.03.2025', '25.03.2021').replace('27.02.2025', '27.02.2021')), 'eldre.pdf', '2026-10-19');
    const r = importFacility(st, older);
    expect(r.kind).toBe('historikk');
    expect(st.facilities.filter((x) => x.objectId === '31417')).toHaveLength(1);
    expect(st.facilities.find((x) => x.objectId === '31417')!.reportDate).toBe('2025-03-25');
  });
});

describe('7. Sløyfen', () => {
  it('«Utført» krever ny frist; ny frist gir ny kontroll, den utførte er grønn', () => {
    const today = '2026-10-19';
    const st = demoAt(today);
    const c = st.controls.find((x) => x.status === 'bekreftet')!;
    expect(() => complete(st, c.id, null)).toThrow();
    expect(c.status).toBe('bekreftet');
    const nd = { q: 4 as const, year: 2030 };
    const next = complete(st, c.id, nd);
    expect(c.status).toBe('utfort');
    expect(pinColor(c, facilityOf(st, c), today)).toBe('green');
    expect(next.due).toEqual(nd);
    expect(next.status).toBe('ikke_planlagt');
    expect(facilityOf(st, c).nextDue).toEqual(nd);
  });
});

describe('8. Ingen svar', () => {
  it('forvarsel uten svar i 7 dager gir purreutkast og oppføring i «Ring disse»', () => {
    const st = demoAt('2026-10-19');
    const c = st.controls.find((x) => x.status === 'varslet')!;
    expect(c.notices.some((n) => n.kind === 'purring' && n.status === 'utkast')).toBe(true);
    expect(callList(st).map((x) => x.id)).toContain(c.id);
    expect(draftsToApprove(st).some((x) => x.notice.kind === 'purring')).toBe(true);
  });
  it('ikke før 7 dager', () => {
    const st = demoAt('2026-10-19');
    const c = st.controls.find((x) => x.status === 'varslet')!;
    c.notices = c.notices.filter((n) => n.kind === 'forvarsel');
    c.callReason = null;
    const fv = c.notices[0];
    fv.sentAt = `${addDays(todayOf(st.settings), -6)}T08:00`;
    runAutomations(st);
    expect(c.notices.some((n) => n.kind === 'purring')).toBe(false);
  });
});
