import { useState } from 'preact/hooks';
import { getState, update, useAppState } from '../store';
import { Empty, Icon, Section, useNav } from './components';
import { DayTimeline } from './Timeline';
import type { PlanDay, Quarter } from '../domain/types';
import { addQuarters, fmtDate, fmtDateWeekday, fmtDuration, fmtHours, fmtQ, fmtQuarter, quarterEnd, quarterOf, quarterStart } from '../domain/dates';
import { applyOvernight, candidatesFor, dayArea, dayHasRoom, dayRouteUrl, dayTimeline, makePlan, overnightOption, removeStop, type PlanResult } from '../domain/planner';
import { findControl, facilityOf, todayOf } from '../domain/controls';
import { areaCounts, sortedDays } from '../domain/selectors';
import { draftsToApprove, preNoticeSendDate } from '../domain/notices';

export function Plan() {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const [q, setQ] = useState<Quarter>(quarterOf(today));
  const [early, setEarly] = useState(false);
  const [result, setResult] = useState<PlanResult | null>(null);

  const days = sortedDays(state).filter((d) => d.date >= quarterStart(q) && d.date <= quarterEnd(q));
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

      <Section title={`Kjøredager · ${days.length}`} action={days.length ? <span class="muted small">ca. {fmtHours(totalDrive)} kjøring</span> : undefined}>
        {days.length === 0 && <div class="list"><Empty title="Ingen kjøredager i kvartalet">Trykk «Lag plan» for å fordele kontrollene på virkedager.</Empty></div>}
        {days.map((d) => <DayCard day={d} />)}
      </Section>
    </div>
  );
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
  return (
    <div class={`card daycard${tl.overtime ? ' over' : ''}`}>
      <div class="dayhead">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="d">{fmtDateWeekday(day.date)}</div>
          <div class="m">
            {day.stops.length} stopp · {dayArea(state, day)} · ca. {fmtDuration(tl.driveMin)} kjøring
            {day.overnight === 'ut' && ' · overnatting'}{day.overnight === 'hjem' && ' · fra overnatting'}
          </div>
          {short && <div class="pill orange mt8">Kort varsel · forvarsel sendes {fmtDate(preNoticeSendDate(day.date, today, state.settings))}</div>}
          {tl.overtime && <div class="pill solid-red mt8">{fmtDuration(tl.overtimeMin)} over arbeidstiden</div>}
        </div>
        <button class="iconbtn" aria-label={day.locked ? 'Lås opp dag' : 'Lås dag'} onClick={() => update((s) => { const d = s.days.find((x) => x.id === day.id)!; d.locked = !d.locked; })} style={day.locked ? { color: 'var(--text)' } : { color: 'var(--text-3)' }}>
          {day.locked ? <Icon.lock /> : <Icon.unlock />}
        </button>
      </div>
      <DayTimeline state={state} day={day} onStop={(id) => nav.push({ kind: 'facility', id: findControl(state, id)!.facilityId })} />
      <div class="stopactions">
        {day.stops.map((id, i) => {
          const c = findControl(state, id)!;
          const f = facilityOf(state, c);
          return (
            <div>
              <div class="who">{i + 1}. {f.customer}</div>
              <div class="btnrow">
                <button class="btn" onClick={() => nav.sheet({ kind: 'move', controlId: id })}><Icon.move />Flytt</button>
                <button class="btn" onClick={() => {
                  const hole = update((s) => removeStop(s, id));
                  nav.toast('Stoppet er fjernet');
                  const fresh = getState();
                  const left = hole ? fresh.days.find((d) => d.id === hole) : undefined;
                  if (left && left.stops.length < fresh.settings.maxPerDay && dayHasRoom(fresh, left)) {
                    nav.sheet({ kind: 'fill', dayId: hole!, reason: 'Stoppet ble fjernet.' });
                  }
                }}><Icon.trash />Fjern</button>
                <button class="btn" onClick={() => nav.sheet({ kind: 'postpone', controlId: id })}>Utsett</button>
              </div>
            </div>
          );
        })}
      </div>
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
        <a class="btn small" href={dayRouteUrl(state, day)} target="_blank" rel="noopener"><Icon.route />Hele ruten</a>
        <button class="btn small" onClick={() => nav.tab('kart', { dayId: day.id })}><Icon.map />Kart</button>
        {canFill && <button class="btn" onClick={() => nav.sheet({ kind: 'fill', dayId: day.id })}>Fyll ledig plass</button>}
        {ov && (ov.overnight.controls > ov.dayTrips.controls || ov.dayTrips.driveMin - ov.overnight.driveMin >= 90) && (
          <button class="btn primary" onClick={() => { update((s) => applyOvernight(s, ov)); nav.toast('Overnattingstur lagt inn'); }}>Bruk overnatting</button>
        )}
      </div>
    </div>
  );
}
