import { useState } from 'preact/hooks';
import { update, useAppState } from '../store';
import { Icon, Section, useNav } from './components';
import type { PlanDay, Quarter } from '../domain/types';
import { addDays, addQuarters, fmtDate, fmtDateWeekday, fmtDuration, fmtHours, fmtQ, fmtQuarter, minutesToClock, quarterEnd, quarterOf, quarterStart, weekMonday } from '../domain/dates';
import { applyOptimizedOrder, applyOvernight, candidatesFor, dayArea, dayHasRoom, dayRouteUrl, dayTimeline, makePlan, moveStopBy, optimizePreview, overnightOption, type PlanResult } from '../domain/planner';
import { findControl, facilityOf, primaryPhone, todayOf } from '../domain/controls';
import { areaCounts, sortedDays } from '../domain/selectors';
import { draftsToApprove, preNoticeSendDate } from '../domain/notices';

export function Plan() {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const [q, setQ] = useState<Quarter>(quarterOf(today));
  const [early, setEarly] = useState(false);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [week, setWeek] = useState(weekMonday(today));
  const [openDate, setOpenDate] = useState(today);

  const days = sortedDays(state).filter((d) => d.date >= quarterStart(q) && d.date <= quarterEnd(q));
  const weekDates = [0, 1, 2, 3, 4].map((i) => addDays(week, i));
  const cands = candidatesFor(state, q, { includePlanned: true });
  const overdue = cands.list.filter((c) => c.overdue).length;
  const plannedIds = new Set(state.days.flatMap((d) => d.stops));
  const unplanned = cands.list.filter((c) => !plannedIds.has(c.control.id));
  const areas = areaCounts(state, cands.list.map((c) => c.control));
  const totalDrive = days.reduce((a, d) => a + dayTimeline(state, d).driveMin, 0);

  const run = () => {
    const r = update((s) => makePlan(s, q, { early }));
    setResult(r);
    nav.toast(`${r.created} kjøredager laget, ${r.planned + r.early} kontroller planlagt`);
  };

  return (
    <div class="screen">
      <div class="topbar">
        <h1>Plan</h1>
        <button class="iconbtn labeled" onClick={() => nav.sheet({ kind: 'adhoc' })} aria-label="Ad hoc-oppdrag"><Icon.plus />Ad hoc</button>
      </div>
      <div class="card pad" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button class="iconbtn" onClick={() => { setQ(addQuarters(q, -1)); setResult(null); }} aria-label="Forrige kvartal"><Icon.chevL /></button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 19 }}>{fmtQuarter(q)}</div>
          <div class="muted small">{cands.list.length} kandidater · {overdue} forfalt · {unplanned.length} ikke planlagt</div>
        </div>
        <button class="iconbtn" onClick={() => { setQ(addQuarters(q, 1)); setResult(null); }} aria-label="Neste kvartal" style={{ transform: 'scaleX(-1)' }}><Icon.chevL /></button>
      </div>

      <div class="chips mt8">
        {areas.map((a) => <span class="chip">{a.area}: <b>{a.count}</b></span>)}
      </div>

      <label class="toggle card pad mt8" style={{ padding: '6px 16px' }}>
        <span class="small">Ta med tidlige: frist {fmtQ(addQuarters(q, 1))}, maks {state.settings.earlyMaxMin} min fra en dag med ledig plass</span>
        <input type="checkbox" checked={early} onChange={(e) => setEarly(e.currentTarget.checked)} />
      </label>
      <button class="btn primary block mt12" onClick={run}>{days.length ? 'Lag plan på nytt (ulåste dager)' : 'Lag plan'}</button>

      {result && (
        <div class="card pad mt12">
          <div style={{ fontWeight: 700, fontSize: 17 }}>Planen er klar</div>
          <div class="mt8"><b>{result.created}</b> kjøredager{result.shortNotice ? `, ${result.shortNotice} med kort varsel` : ''} · <b>{result.planned}</b> kontroller{result.early ? `, ${result.early} tidlige` : ''}.</div>
          {result.unplaced.length > 0
            ? <div class="note warn">{result.unplaced.length} fikk ikke plass før kvartalsslutt: {result.unplaced.map((c) => facilityOf(state, c).customer).join(', ')}</div>
            : <div class="note">Alle kandidatene innenfor radius fikk en dag.</div>}
          {result.outOfRange.length > 0 && <div class="note amber">Utenfor kjøreradius ({state.settings.maxDriveMin} min), ikke planlagt: {result.outOfRange.map((c) => `${c.facility.customer} (${c.facility.address.place}, ca. ${fmtDuration(c.drive)})`).join(', ')}</div>}
          {result.noCoords.length > 0 && <div class="note amber">Mangler koordinater: {result.noCoords.map((c) => facilityOf(state, c).customer).join(', ')}</div>}
          <div class="mt8"><b>{draftsToApprove(state).length}</b> utkast venter på godkjenning i Innboks.</div>
        </div>
      )}

      <Section title="Uka" action={<span class="muted small">{days.length} dager i kvartalet · ca. {fmtHours(totalDrive)}</span>}>
        <div class="card pad" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <button class="iconbtn" aria-label="Forrige uke" onClick={() => setWeek(addDays(week, -7))}><Icon.chevL /></button>
          <div style={{ flex: 1, textAlign: 'center', fontWeight: 650 }}>{fmtDate(weekDates[0]).slice(0, 5)} – {fmtDate(weekDates[4]).slice(0, 5)}</div>
          <button class="iconbtn" aria-label="Neste uke" onClick={() => setWeek(addDays(week, 7))} style={{ transform: 'scaleX(-1)' }}><Icon.chevL /></button>
        </div>
        <div class="weekstrip">
          {weekDates.map((date) => {
            const d = state.days.find((x) => x.date === date && x.stops.length);
            const tl = d ? dayTimeline(state, d) : null;
            return (
              <button class={`weekcell${openDate === date ? ' on' : ''}`} onClick={() => setOpenDate(date)}>
                <div class="d">{fmtDateWeekday(date).split(' ')[0].slice(0, 3)}</div>
                <div class="n">{date.slice(8, 10)}</div>
                <div class="s">{d ? `${d.stops.length} stopp` : 'ledig'}</div>
                {d && tl && <div class="s">{dayArea(state, d).split(' ')[0]}</div>}
                {tl && <div class="s">hjem {minutesToClock(tl.endMin)}</div>}
              </button>
            );
          })}
        </div>
        <WeekDay date={openDate} />
      </Section>
    </div>
  );
}

function WeekDay({ date }: { date: string }) {
  const state = useAppState();
  const nav = useNav();
  const day = state.days.find((d) => d.date === date && (d.stops.length || d.locked));
  if (!day || !day.stops.length) {
    return (
      <div class="card pad mt12">
        <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{fmtDateWeekday(date)}</div>
        <div class="muted small">Ingen stopp denne dagen.</div>
        <button class="btn primary block mt12" onClick={() => nav.sheet({ kind: 'today', date })}>Legg inn stopp</button>
      </div>
    );
  }
  return <DayCard day={day} />;
}

function DayCard({ day }: { day: PlanDay }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const tl = dayTimeline(state, day);
  const ov = overnightOption(state, day.id);
  const free = state.settings.maxPerDay - day.stops.length;
  const canFill = free > 0 && dayHasRoom(state, day);
  const short = day.stops.some((id) => findControl(state, id)?.log.some((l) => l.text.includes('kort varsel')));
  const [opt, setOpt] = useState<{ before: number; after: number } | null>(null);
  const drag = (id: string, dir: -1 | 1) => update((s) => { moveStopBy(s, id, dir); });
  return (
    <div class={`card daycard mt12${tl.overtime ? ' over' : ''}`}>
      <div class="stickyhome">
        Hjemme ca. {minutesToClock(tl.endMin)}
        <span class="muted" style={{ fontWeight: 500 }}> · {day.stops.length} stopp · {dayArea(state, day)} · {fmtDuration(tl.driveMin)}</span>
      </div>
      <div class="dayhead">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="d">{fmtDateWeekday(day.date)}</div>
          <div class="m">
            {day.overnight === 'ut' && 'Overnatting · '}{day.overnight === 'hjem' && 'Fra overnatting · '}
            {short && <>Kort varsel · forvarsel {fmtDate(preNoticeSendDate(day.date, today, state.settings))}</>}
          </div>
          {tl.overtime && <div class="pill solid-red mt8">{fmtDuration(tl.overtimeMin)} over arbeidstiden</div>}
        </div>
        <button class="iconbtn" aria-label={day.locked ? 'Lås opp dag' : 'Lås dag'} onClick={() => update((s) => { const d = s.days.find((x) => x.id === day.id)!; d.locked = !d.locked; })} style={day.locked ? { color: 'var(--text)' } : { color: 'var(--text-3)' }}>
          {day.locked ? <Icon.lock /> : <Icon.unlock />}
        </button>
      </div>
      <div class="stopactions">
        {day.stops.map((id, i) => {
          const c = findControl(state, id)!;
          const f = facilityOf(state, c);
          const phone = primaryPhone(f);
          const slot = tl.slots[id];
          const when = c.timeFrom ?? (slot ? minutesToClock(slot.start) : '');
          return (
            <div class="stoprow" onPointerDown={(e) => startDrag(e, () => drag(id, -1), () => drag(id, 1))}>
              <button class="iconbtn" aria-label="Flytt opp" disabled={i === 0 || day.locked} onClick={() => drag(id, -1)}><span class="turn up"><Icon.chevL /></span></button>
              <button class="iconbtn" aria-label="Flytt ned" disabled={i === day.stops.length - 1 || day.locked} onClick={() => drag(id, 1)}><span class="turn down"><Icon.chevL /></span></button>
              <div class="when">{when}</div>
              <button class="nm" onClick={() => nav.push({ kind: 'facility', id: f.id })}>{f.customer}</button>
              <a class="btn" href={phone ? `tel:${phone.replace(/\s/g, '')}` : undefined} style={phone ? {} : { opacity: 0.4, pointerEvents: 'none' }}>Ring</a>
              <button class="btn" onClick={() => nav.sheet({ kind: 'move', controlId: id })}>Flytt</button>
            </div>
          );
        })}
      </div>
      {opt && (
        <div class="note" style={{ margin: '0 12px 8px' }}>
          Hjemme {minutesToClock(opt.before)} blir {minutesToClock(opt.after)}.
          <div class="btnrow mt8">
            <button class="btn primary" onClick={() => { update((s) => applyOptimizedOrder(s, day.id)); setOpt(null); nav.toast('Rekkefølgen er oppdatert'); }}>Bruk ny rekkefølge</button>
            <button class="btn" onClick={() => setOpt(null)}>Behold</button>
          </div>
        </div>
      )}
      {ov && (
        <>
          <div class="muted small" style={{ padding: '0 16px 6px' }}>Klyngen ligger 1,5 t eller mer unna:</div>
          <div class="compare">
            <div><b>To dagsturer</b>{ov.dayTrips.controls} kontroller · ca. {fmtHours(ov.dayTrips.driveMin)} kjøring</div>
            <div><b>To dager med overnatting</b>{ov.overnight.controls} kontroller · ca. {fmtHours(ov.overnight.driveMin)} kjøring</div>
          </div>
        </>
      )}
      <div class="tools">
        <button class="btn" onClick={() => nav.push({ kind: 'route', dayId: day.id })}><Icon.nav />Rute</button>
        <button class="btn" onClick={() => { const p = optimizePreview(state, day.id); if (p) setOpt(p); }} disabled={day.stops.length < 2 || day.locked}>Optimaliser rekkefølge</button>
        <a class="btn" href={dayRouteUrl(state, day)} target="_blank" rel="noopener"><Icon.route />Hele ruten</a>
        <button class="btn" onClick={() => nav.tab('kart', { dayId: day.id })}><Icon.map />Kart</button>
        <button class="btn" onClick={() => nav.push({ kind: 'daysheet', dayId: day.id })}>Del dagen</button>
        {canFill && <button class="btn" onClick={() => nav.sheet({ kind: 'fill', dayId: day.id })}>Fyll ledig plass</button>}
        {ov && (ov.overnight.controls > ov.dayTrips.controls || ov.dayTrips.driveMin - ov.overnight.driveMin >= 90) && (
          <button class="btn primary" onClick={() => { update((s) => applyOvernight(s, ov)); nav.toast('Overnattingstur lagt inn'); }}>Bruk overnatting</button>
        )}
      </div>
    </div>
  );
}

function startDrag(e: { clientY: number; target: EventTarget | null }, up: () => void, down: () => void) {
  const t = e.target as HTMLElement;
  if (t.closest('a, .iconbtn, .btn')) return;
  const y0 = e.clientY;
  let moved = false;
  const move = (ev: PointerEvent) => {
    if (moved) return;
    const dy = ev.clientY - y0;
    if (Math.abs(dy) < 28) return;
    moved = true;
    if (dy < 0) up(); else down();
  };
  const cleanup = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', cleanup);
  };
  const swallow = (ev: Event) => {
    if (!moved) return;
    ev.preventDefault();
    ev.stopPropagation();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', cleanup);
  window.addEventListener('click', swallow, true);
  window.setTimeout(() => window.removeEventListener('click', swallow, true), 400);
}
