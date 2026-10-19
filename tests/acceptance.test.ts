// Akseptansetester mot domenelogikken (samme kode som appen bruker).
import { describe, it, expect } from 'vitest';
import { buildDemo, defaultSettings } from '../src/data/demo';
import { makePlan, dayTimeline, fillSuggestions, dayArea, dayRouteUrl, googleStopUrl, stopOf, refreshDay, dayHasRoom, earliestPlanDate, earliestOverdueDate, durationOf, moveStopBy, setDayOrder, optimizePreview, applyOptimizedOrder, removeStop } from '../src/domain/planner';
import { addDays, addQuarters, firstWorkdayOfQuarter, isOverdue, quarterOf, fmtDateWeekday, minutesToClock, clockToMinutes, compareQuarter, suggestedNextDue, quarterEnd } from '../src/domain/dates';
import { atRiskControls, homeStats, sortedDays } from '../src/domain/selectors';
import { complete, currentControl, facilityOf, pinColor, postpone, recipient, todayOf } from '../src/domain/controls';
import { callList, markSent, reminderSendDate, runAutomations, draftsToApprove } from '../src/domain/notices';
import { parseReport } from '../src/domain/reportParser';
import { EXAMPLE_REPORT, facilityFromReport, importFacility } from '../src/domain/importer';
import { mergeIntoOneVisit, sameAddressOf, sameAddressPairs } from '../src/domain/merge';
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

describe('Delt klokke', () => {
  it('tidsrommet er besøkets lengde etter kjøretiden, ikke et fast totimersvindu', () => {
    const st = demoAt('2026-10-19');
    const day = st.days[0];
    for (const id of day.stops) {
      const c = st.controls.find((x) => x.id === id)!;
      c.timeFrom = null;
      c.timeTo = null;
    }
    refreshDay(st, day);
    const tl = dayTimeline(st, day);
    for (const id of day.stops) {
      const c = st.controls.find((x) => x.id === id)!;
      const slot = tl.slots[id];
      const visit = durationOf(facilityOf(st, c), st.settings);
      expect(c.timeFrom).toBe(minutesToClock(slot.start));
      expect(c.timeTo).toBe(minutesToClock(slot.end));
      expect(clockToMinutes(c.timeTo!) - clockToMinutes(c.timeFrom!)).toBe(visit);
      expect(visit).not.toBe(120);
    }
  });
});

describe('Forfalte tidlig', () => {
  it('legger allerede forfalte på første ledige dager, med kort varsel', () => {
    const today = '2026-10-19';
    const st = demoAt(today);
    const before = new Set(st.days.map((d) => d.id));
    const q = quarterOf(today);
    makePlan(st, q);
    const notice = earliestPlanDate(st);
    const first = earliestOverdueDate(st);
    const fresh = st.days.filter((d) => !before.has(d.id));
    const overdueStop = (id: string) => {
      const c = st.controls.find((x) => x.id === id)!;
      return isOverdue(c.due, today) || compareQuarter(c.due, q) < 0;
    };
    const earlyDays = fresh.filter((d) => d.date < notice);
    expect(earlyDays.length).toBeGreaterThan(0);
    for (const d of earlyDays) {
      expect(d.date > today).toBe(true);
      expect(d.date >= first).toBe(true);
      expect(d.stops.some(overdueStop)).toBe(true);
      expect(d.stops.some((id) => st.controls.find((x) => x.id === id)!.log.some((l) => l.text.includes('kort varsel')))).toBe(true);
    }
    for (const d of fresh) {
      if (!d.stops.some(overdueStop)) expect(d.date >= notice).toBe(true);
    }
  });
});

describe('Ledig plass', () => {
  it('krever tid igjen i arbeidsdagen, ikke bare en ledig plass i listen', () => {
    const st = demoAt('2026-10-19');
    const day = st.days[0];
    const end = dayTimeline(st, day).endMin;
    expect(dayHasRoom(st, day)).toBe(true);
    st.settings.dayEnd = minutesToClock(end + 30);
    expect(dayHasRoom(st, day)).toBe(false);
    st.settings.dayEnd = minutesToClock(end + st.settings.controlMin + 30);
    expect(dayHasRoom(st, day)).toBe(true);
  });
});

describe('Samme adresse', () => {
  it('ulikt Objekt ID på samme adresse blir ett besøk', () => {
    const st = demoAt('2026-10-19');
    const keep = st.facilities[1];
    const drop = st.facilities[0];
    drop.address = { ...keep.address };
    expect(sameAddressOf(st, drop)?.id).toBe(keep.id);
    expect(sameAddressPairs(st).some((p) => p.a.id === drop.id || p.b.id === drop.id)).toBe(true);
    const merged = mergeIntoOneVisit(st, drop.id, keep.id);
    expect(merged.keepId).toBe(keep.id);
    expect(drop.mergedInto).toBe(keep.id);
    makePlan(st, quarterOf('2026-10-19'));
    const stops = st.days.flatMap((d) => d.stops);
    expect(stops).toContain(currentControl(st, keep.id)!.id);
    expect(stops).not.toContain(currentControl(st, drop.id)!.id);
  });
});

describe('Ny rapport lukker kontrollen', () => {
  it('ny frist setter gammel kontroll til utført og åpner neste', () => {
    const today = '2026-10-19';
    const st = demoAt(today);
    const open = st.controls.find((c) => c.status === 'ikke_planlagt' && (facilityOf(st, c).reportDate ?? '') < '2026-10-18')!;
    const f = facilityOf(st, open);
    const incoming = structuredClone(f);
    incoming.reportDate = '2026-10-18';
    incoming.lastControl = '2026-10-18';
    incoming.nextDue = { q: 4, year: 2030 };
    incoming.sourceFile = 'ny-rapport.pdf';
    const r = importFacility(st, incoming);
    expect(open.status).toBe('utfort');
    const cur = currentControl(st, f.id)!;
    expect(cur.id).not.toBe(open.id);
    expect(cur.status).toBe('ikke_planlagt');
    expect(cur.due).toEqual({ q: 4, year: 2030 });
    expect(r.message).toContain('utført');
  });
});

describe('Rekkefølge', () => {
  it('bytter stopp og regner hjemmetid og klokkeslett på nytt', () => {
    const st = demoAt('2026-10-19');
    const day = st.days.find((d) => d.stops.length >= 2)!;
    const before = [...day.stops];
    const moved = st.controls.find((c) => c.id === before[0])!;
    const oldFrom = moved.timeFrom;
    expect(moveStopBy(st, before[0], 1)).toBe(true);
    expect(day.stops[0]).toBe(before[1]);
    expect(day.stops[1]).toBe(before[0]);
    const tl = dayTimeline(st, day);
    expect(moved.timeFrom).not.toBe(oldFrom);
    expect(moved.timeFrom).toBe(minutesToClock(tl.slots[moved.id].start));
    expect(moved.timeTo).toBe(minutesToClock(tl.slots[moved.id].end));
    for (const id of day.stops) {
      const c = st.controls.find((x) => x.id === id)!;
      expect(c.timeFrom).toBe(minutesToClock(tl.slots[id].start));
    }
  });
});

describe('Av i dag', () => {
  it('tar stoppet ut av ruten og flytter hjemmetiden', () => {
    const st = demoAt('2026-10-19');
    const day = st.days.find((d) => d.id === 'd_demo1')!;
    const before = dayTimeline(st, day).endMin;
    const id = day.stops[0];
    expect(removeStop(st, id)).toBe(day.id);
    expect(day.stops.includes(id)).toBe(false);
    expect(st.controls.find((c) => c.id === id)!.status).toBe('ikke_planlagt');
    expect(dayTimeline(st, day).endMin).toBeLessThan(before);
  });
});

describe('Utført-forslag', () => {
  it('vanlig intervall er samme kvartal om fire år', () => {
    expect(suggestedNextDue('2026-10-19')).toEqual({ q: 4, year: 2030 });
  });
});

describe('Optimaliser', () => {
  it('viser hjemmetid før og etter, og bruker rekkefølgen når den bekreftes', () => {
    const st = demoAt('2026-10-19');
    const day = st.days.find((d) => d.stops.length >= 2)!;
    setDayOrder(st, day.id, [...day.stops].reverse());
    const preview = optimizePreview(st, day.id);
    expect(preview).not.toBeNull();
    expect(preview!.after).toBeLessThanOrEqual(preview!.before);
    applyOptimizedOrder(st, day.id);
    expect(day.stops).toEqual(preview!.order);
    expect(dayTimeline(st, day).endMin).toBe(preview!.after);
  });
});

describe('Frist i fare', () => {
  it('tallet er listen: frist innen to uker eller forfalt, og ikke på en dag', () => {
    const today = '2026-10-19';
    const st = demoAt(today);
    const list = atRiskControls(st);
    const h = homeStats(st);
    const horizon = addDays(today, 14);
    const onDay = new Set(st.days.flatMap((d) => d.stops));
    expect(h.atRisk.map((c) => c.id)).toEqual(list.map((c) => c.id));
    expect(h.dueThisQuarter.every((c) => !isOverdue(c.due, today))).toBe(true);
    expect(h.dueInQuarter.length).toBe(h.overdue.length + h.dueThisQuarter.length);
    for (const c of list) {
      expect(onDay.has(c.id)).toBe(false);
      expect(isOverdue(c.due, today) || quarterEnd(c.due) <= horizon).toBe(true);
    }
    const tuesday = st.days.find((d) => d.id === 'd_demo1')!;
    for (const id of tuesday.stops) expect(list.some((c) => c.id === id)).toBe(false);
    const far = st.controls.find((c) => !onDay.has(c.id) && c.status !== 'utfort' && !isOverdue(c.due, today) && quarterEnd(c.due) > horizon);
    expect(far).toBeTruthy();
    expect(list.some((c) => c.id === far!.id)).toBe(false);
    const late = st.controls.find((c) => !onDay.has(c.id) && c.status !== 'utfort' && isOverdue(c.due, today));
    expect(late).toBeTruthy();
    expect(list.some((c) => c.id === late!.id)).toBe(true);
  });
});
