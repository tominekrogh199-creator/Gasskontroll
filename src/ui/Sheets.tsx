import { useState } from 'preact/hooks';
import { getState, update, useAppState } from '../store';
import { FlagPills, Icon, Sheet, StatusPill, useNav, Field, type SheetSpec } from './components';
import { ActionGrid } from './FacilityDetail';
import type { PostponeReason, Quarter } from '../domain/types';
import { complete, currentControl, facilityOf, findControl, postpone, postponeAfterDeadline, primaryContact, todayOf } from '../domain/controls';
import { addDays, addQuarters, fmtDate, fmtDateWeekday, fmtDuration, fmtQ, fmtQuarter, isOverdue, isWorkday, minutesToClock, nextWorkdayOnOrAfter, quarterOf, suggestedNextDue } from '../domain/dates';
import { addStopToDay, dayArea, dayHasRoom, daySuggestions, dayTimeline, ensureDay, fillSuggestions, moveStop, refreshDay, removeStop } from '../domain/planner';
import { addAdhoc, registerNewTime } from '../domain/actions';
import { sortedDays } from '../domain/selectors';
import type { Nav } from './components';

function offerFill(dayId: string | null, reason: string, nav: Nav, close: () => void) {
  const fresh = getState();
  const day = dayId ? fresh.days.find((d) => d.id === dayId) : undefined;
  if (day && day.stops.length < fresh.settings.maxPerDay && dayHasRoom(fresh, day)) nav.sheet({ kind: 'fill', dayId: day.id, reason });
  else close();
}

export function Sheets({ spec }: { spec: SheetSpec }) {
  const nav = useNav();
  const close = () => nav.sheet(null);
  switch (spec.kind) {
    case 'pin': return <PinSheet id={spec.facilityId} close={close} />;
    case 'postpone': return <PostponeSheet id={spec.controlId} close={close} />;
    case 'complete': return <CompleteSheet id={spec.controlId} close={close} />;
    case 'newtime': return <NewTimeSheet id={spec.controlId} close={close} />;
    case 'move': return <MoveSheet id={spec.controlId} close={close} schedule={false} />;
    case 'schedule': return <MoveSheet id={spec.controlId} close={close} schedule />;
    case 'fill': return <FillSheet dayId={spec.dayId} reason={spec.reason} close={close} />;
    case 'adhoc': return <AdhocSheet close={close} date={spec.date} />;
    case 'offday': return <OffDaySheet id={spec.controlId} dayId={spec.dayId} close={close} />;
    case 'today': return <TodaySheet date={spec.date} close={close} />;
    case 'utsett': return <PostponePick close={close} />;
  }
}

function dayDistance(a: string, b: string): number {
  return Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime());
}

/** Hjemme-tiden dagen får hvis stoppet legges dit. */
function homeIfPlaced(state: ReturnType<typeof getState>, controlId: string, date: string): number | null {
  const trial = structuredClone(state);
  const day = ensureDay(trial, date);
  moveStop(trial, controlId, day.id);
  const placed = trial.days.find((d) => d.id === day.id);
  return placed ? dayTimeline(trial, placed).endMin : null;
}

function PinSheet({ id, close }: { id: string; close: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const f = state.facilities.find((x) => x.id === id);
  if (!f) return null;
  const c = currentControl(state, f.id);
  const ct = primaryContact(f);
  return (
    <Sheet title={f.customer} sub={`${f.address.street}, ${f.address.postcode} ${f.address.place}`} onClose={close}>
      {c && (
        <div class="pills">
          <StatusPill c={c} today={today} />
          <FlagPills c={c} f={f} today={today} />
        </div>
      )}
      <dl class="kv mt12">
        <dt>Frist</dt><dd>{c ? fmtQuarter(c.due) : '–'}</dd>
        {c?.plannedDate && <><dt>Planlagt</dt><dd>{fmtDateWeekday(c.plannedDate)}{c.timeFrom ? ` kl. ${c.timeFrom}` : ''}</dd></>}
        <dt>Kontakt</dt><dd>{ct ? `${ct.name} · ${ct.phone ?? 'ingen tlf.'}` : '–'}</dd>
        {f.notes && <><dt>Notater</dt><dd>{f.notes}</dd></>}
      </dl>
      {f.deviations.filter((d) => d.severity === 'avvik').map((d) => <div class="note warn">Åpent avvik: {d.text}</div>)}
      <div class="mt12"><ActionGrid f={f} c={c} /></div>
      <button class="btn block mt8" onClick={() => nav.push({ kind: 'facility', id: f.id })}>Åpne anleggskort</button>
    </Sheet>
  );
}

const REASONS: PostponeReason[] = ['Oppgradering', 'Venter på service', 'Kunde ikke tilgjengelig', 'Ute av drift', 'Annet'];

function QuarterPicker({ value, onChange, from }: { value: Quarter; onChange: (q: Quarter) => void; from: Quarter }) {
  const opts = Array.from({ length: 12 }, (_, i) => addQuarters(from, i));
  return (
    <select class="sel" value={`${value.year}-${value.q}`} onChange={(e) => { const [y, q] = e.currentTarget.value.split('-').map(Number); onChange({ year: y, q: q as Quarter['q'] }); }}>
      {opts.map((q) => <option value={`${q.year}-${q.q}`}>{fmtQuarter(q)}</option>)}
    </select>
  );
}

function PostponeSheet({ id, close }: { id: string; close: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const c = findControl(state, id);
  const [reason, setReason] = useState<PostponeReason>('Venter på service');
  const [text, setText] = useState('');
  const [period, setPeriod] = useState<Quarter>(addQuarters(quarterOf(today), 1));
  const [followUp, setFollowUp] = useState(addDays(today, state.settings.followUpDays));
  const [by, setBy] = useState(c ? primaryContact(facilityOf(state, c))?.name ?? '' : '');
  if (!c) return null;
  const f = facilityOf(state, c);
  const after = postponeAfterDeadline(c, period);
  return (
    <Sheet title="Utsett kontroll" sub={`${f.customer} · frist ${fmtQuarter(c.due)}`} onClose={close}>
      <Field label="Årsak">
        <select class="sel" value={reason} onChange={(e) => setReason(e.currentTarget.value as PostponeReason)}>
          {REASONS.map((r) => <option>{r}</option>)}
        </select>
      </Field>
      {reason === 'Venter på service' && <div class="note">Servicepartner: <b>{f.servicePartner ?? 'ikke registrert'}</b></div>}
      <Field label="Kommentar"><input class="inp" value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder="Kort forklaring" /></Field>
      <div class="grid2">
        <Field label="Ny periode"><QuarterPicker value={period} onChange={setPeriod} from={quarterOf(today)} /></Field>
        <Field label="Oppfølging"><input class="inp" type="date" value={followUp} onInput={(e) => setFollowUp(e.currentTarget.value)} /></Field>
      </div>
      <Field label="Bedt om av"><input class="inp" value={by} onInput={(e) => setBy(e.currentTarget.value)} /></Field>
      {after && <div class="note warn"><b>Advarsel:</b> {fmtQuarter(period)} er etter fristen {fmtQuarter(c.due)}. Kontrollen blir forfalt.</div>}
      <button class="btn primary block mt12" onClick={() => {
        const { holeDayId } = update((s) => postpone(s, id, { reason, text, newPeriod: period, followUp, requestedBy: by }));
        nav.toast(`Utsatt til ${fmtQ(period)}. Oppfølging ${fmtDate(followUp)}.`);
        offerFill(holeDayId, `${f.customer} er tatt ut av ruten.`, nav, close);
      }}>Utsett</button>
    </Sheet>
  );
}

function CompleteSheet({ id, close }: { id: string; close: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const c = findControl(state, id);
  const initialDate = c?.plannedDate && c.plannedDate <= today ? c.plannedDate : today;
  const [date, setDate] = useState(initialDate);
  const [due, setDue] = useState<Quarter | null>(suggestedNextDue(initialDate));
  const [err, setErr] = useState<string | null>(null);
  if (!c) return null;
  const f = facilityOf(state, c);
  const suggested = suggestedNextDue(date);
  return (
    <Sheet title="Utført" sub={f.customer} onClose={close}>
      <Field label="Kontrolldato"><input class="inp" type="date" value={date} max={today} onInput={(e) => setDate(e.currentTarget.value)} /></Field>
      <Field label="Ny frist for neste akkrediterte kontroll (påkrevd)">
        <select class="sel" value={due ? `${due.year}-${due.q}` : ''} onChange={(e) => { const v = e.currentTarget.value; if (!v) return setDue(null); const [y, q] = v.split('-').map(Number); setDue({ year: y, q: q as Quarter['q'] }); }}>
          <option value="">Velg kvartal og år …</option>
          {Array.from({ length: 24 }, (_, i) => addQuarters(quarterOf(date), i + 1)).map((q) => <option value={`${q.year}-${q.q}`}>{fmtQuarter(q)}{q.q === suggested.q && q.year === suggested.year ? ' (vanlig: 4 år)' : ''}</option>)}
        </select>
      </Field>
      <div class="muted small">Fristen står i den nye rapporten. Du kan også importere den nye rapporten fra Anlegg → +; da settes fristen derfra.</div>
      {err && <div class="note warn">{err}</div>}
      <button class="btn primary block mt12" disabled={!due} onClick={() => {
        try {
          update((s) => complete(s, id, due, { date }));
          nav.toast(`Utført. Ny kontroll opprettet for ${fmtQuarter(due)}.`);
          close();
        } catch (e: any) { setErr(e.message); }
      }}>Lukk kontrollen</button>
    </Sheet>
  );
}

function NewTimeSheet({ id, close }: { id: string; close: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const c = findControl(state, id);
  const [date, setDate] = useState(nextWorkdayOnOrAfter(addDays(today, 7), state.settings.blockedDays));
  const [time, setTime] = useState('09:00');
  if (!c) return null;
  const f = facilityOf(state, c);
  const ok = isWorkday(date, state.settings.blockedDays);
  const existing = state.days.find((d) => d.date === date);
  return (
    <Sheet title="Ny tid" sub={f.customer} onClose={close}>
      <div class="grid2">
        <Field label="Dato"><input class="inp" type="date" value={date} min={today} onInput={(e) => setDate(e.currentTarget.value)} /></Field>
        <Field label="Fra kl."><input class="inp" type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} /></Field>
      </div>
      {!ok && <div class="note warn">{fmtDate(date)} er ikke en virkedag.</div>}
      <div class="muted small">{existing ? `Legges til kjøredagen ${fmtDateWeekday(date)} (${existing.stops.length} stopp i ${dayArea(state, existing)}).` : 'Det lages en ny kjøredag.'}</div>
      <button class="btn primary block mt12" disabled={!ok} onClick={() => { update((s) => registerNewTime(s, id, date, time)); nav.toast('Ny tid registrert og bekreftet'); close(); }}>Lagre ny tid</button>
    </Sheet>
  );
}

function MoveSheet({ id, close, schedule }: { id: string; close: () => void; schedule: boolean }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const c = findControl(state, id);
  const [date, setDate] = useState(nextWorkdayOnOrAfter(addDays(today, 1), state.settings.blockedDays));
  if (!c) return null;
  const f = facilityOf(state, c);
  const from = state.days.find((d) => d.stops.includes(id));
  const days = sortedDays(state).filter((d) => d.date >= today && !d.stops.includes(id));
  const ranked = days
    .map((d) => ({ d, home: homeIfPlaced(state, id, d.date) }))
    .sort((a, b) => dayDistance(a.d.date, today) - dayDistance(b.d.date, today) || a.d.date.localeCompare(b.d.date));
  return (
    <Sheet title={schedule ? 'Planlegg kontroll' : 'Flytt til annen dag'} sub={f.customer} onClose={close}>
      <div class="muted small" style={{ marginBottom: 8 }}>Nærmeste datoer først. Hjemme-tiden er slik dagen blir med stoppet lagt til.</div>
      <div class="list">
        {ranked.slice(0, 8).map(({ d, home }) => (
          <button class="row" onClick={() => { update((s) => moveStop(s, id, d.id)); nav.toast(`Lagt til ${fmtDateWeekday(d.date)}`); close(); }}>
            <div class="main">
              <div class="t" style={{ textTransform: 'capitalize' }}>{fmtDateWeekday(d.date)}</div>
              <div class="s">{d.stops.length} stopp · {dayArea(state, d)}{home != null ? ` · hjemme ${minutesToClock(home)}` : ''}</div>
            </div>
          </button>
        ))}
        {ranked.length === 0 && <div class="empty">Ingen kommende kjøredager. Velg en dato under.</div>}
      </div>
      <div class="section"><h2>Eller ny dag</h2></div>
      <div class="btnrow">
        <input class="inp" style={{ flex: 1 }} type="date" value={date} min={today} onInput={(e) => setDate(e.currentTarget.value)} />
        <button class="btn primary" disabled={!isWorkday(date, state.settings.blockedDays)} onClick={() => {
          update((s) => { const d = ensureDay(s, date); addStopToDay(s, id, d.id); refreshDay(s, d, true); });
          nav.toast(`Planlagt ${fmtDateWeekday(date)}`);
          close();
        }}>Legg inn</button>
      </div>
      {!isWorkday(date, state.settings.blockedDays) && <div class="note warn">{fmtDate(date)} er ikke en virkedag.</div>}
      {from && !schedule && (
        <>
          <button class="btn block mt12" onClick={() => {
            const hole = update((s) => removeStop(s, id));
            nav.sheet({ kind: 'offday', controlId: id, dayId: hole });
          }}>Ta av dagen</button>
          <button class="btn ghost block" onClick={() => nav.sheet({ kind: 'postpone', controlId: id })}>Utsett til senere</button>
        </>
      )}
    </Sheet>
  );
}

function OffDaySheet({ id, dayId, close }: { id: string; dayId: string | null; close: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const c = findControl(state, id);
  const day = dayId ? state.days.find((d) => d.id === dayId) : undefined;
  if (!c) return null;
  const f = facilityOf(state, c);
  const home = day && day.stops.length ? dayTimeline(state, day).endMin : null;
  const fills = day && day.stops.length < state.settings.maxPerDay && dayHasRoom(state, day) ? fillSuggestions(state, day.id, 4) : [];
  const dates = new Set<string>();
  let cursor = today;
  for (let n = 0; dates.size < 8 && n < 24; n++) {
    cursor = nextWorkdayOnOrAfter(addDays(cursor, 1), state.settings.blockedDays);
    if (cursor !== day?.date) dates.add(cursor);
  }
  for (const d of state.days) if (d.date >= today && d.date !== day?.date) dates.add(d.date);
  const nearest = [...dates].sort((a, b) => dayDistance(a, today) - dayDistance(b, today) || a.localeCompare(b)).slice(0, 6);
  return (
    <Sheet title="Tatt av dagen" sub={f.customer} onClose={close}>
      <div class="note">
        {day && home != null ? <>Hjemme ca. <b>{minutesToClock(home)}</b> på {fmtDateWeekday(day.date)}.</> : 'Stoppet er ute av ruten.'}
      </div>
      {fills.length > 0 && day && (
        <>
          <div class="section"><h2>Fyll ledig plass</h2></div>
          <div class="list">
            {fills.map((s) => (
              <button class="row" onClick={() => { update((st) => moveStop(st, s.control.id, day.id)); nav.toast(`${s.facility.customer} lagt til`); close(); }}>
                <div class="main">
                  <div class="t">{s.facility.customer}</div>
                  <div class="s">{s.facility.address.place} · ca. {s.nearMin} min unna</div>
                </div>
                {s.overdue ? <span class="pill solid-red">Forfalt</span> : <span class="pill grey">{fmtQ(s.control.due)}</span>}
              </button>
            ))}
          </div>
        </>
      )}
      <div class="section"><h2>Flytt til en annen dag</h2></div>
      <div class="list">
        {nearest.map((date) => {
          const end = homeIfPlaced(state, id, date);
          return (
            <button class="row" onClick={() => {
              update((s) => addStopToDay(s, id, ensureDay(s, date).id));
              nav.toast(`Lagt til ${fmtDateWeekday(date)}`);
              close();
            }}>
              <div class="main">
                <div class="t" style={{ textTransform: 'capitalize' }}>{fmtDateWeekday(date)}</div>
                <div class="s">{end != null ? `hjemme ${minutesToClock(end)}` : ''}</div>
              </div>
            </button>
          );
        })}
      </div>
      <button class="btn ghost block mt12" onClick={() => nav.sheet({ kind: 'postpone', controlId: id })}>Utsett til senere</button>
    </Sheet>
  );
}

function TodaySheet({ date, close }: { date: string; close: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const picks = daySuggestions(state, date, 10);
  return (
    <Sheet title={`Legg på ${fmtDate(date)}`} sub="Forfalte og anlegg i nærheten med frist i kvartalet" onClose={close}>
      <div class="list">
        {picks.map((p) => (
          <button class="row" onClick={() => {
            update((s) => addStopToDay(s, p.control.id, ensureDay(s, date).id));
            nav.toast(`${p.facility.customer} er lagt på dagen`);
            close();
          }}>
            <div class="main">
              <div class="t">{p.facility.customer}{p.overdue || isOverdue(p.control.due, today) ? ' · forfalt' : ''}</div>
              <div class="s">{p.facility.address.place} · {p.drive} min fra basen</div>
            </div>
          </button>
        ))}
        {picks.length === 0 && <div class="empty"><b>Ingen forslag</b>Søk i anleggslisten og legg stoppet på dagen derfra.</div>}
      </div>
    </Sheet>
  );
}

function PostponePick({ close }: { close: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const rows = state.controls
    .filter((c) => c.status !== 'utfort' && c.status !== 'utsatt')
    .map((c) => ({ c, f: facilityOf(state, c) }))
    .filter(({ f }) => !needle || `${f.customer} ${f.address.place} ${f.address.street}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(!!b.c.plannedDate) - Number(!!a.c.plannedDate) || a.f.customer.localeCompare(b.f.customer, 'nb'))
    .slice(0, 8);
  return (
    <Sheet title="Utsettelse" sub="Når kunden ber om å utsette" onClose={close}>
      <Field label="Hvem utsetter kontrollen?">
        <input class="inp" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Kundenavn eller sted" />
      </Field>
      <div class="list mt12">
        {rows.map(({ c, f }) => (
          <button class="row" onClick={() => nav.sheet({ kind: 'postpone', controlId: c.id })}>
            <div class="main">
              <div class="t">{f.customer}</div>
              <div class="s">{f.address.place}{c.plannedDate ? ` · ${fmtDateWeekday(c.plannedDate)}` : ''}</div>
            </div>
          </button>
        ))}
        {rows.length === 0 && <div class="empty"><b>Ingen treff</b>Prøv et annet navn.</div>}
      </div>
    </Sheet>
  );
}

function FillSheet({ dayId, reason, close }: { dayId: string; reason?: string; close: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const day = state.days.find((d) => d.id === dayId);
  if (!day) return null;
  const sug = fillSuggestions(state, dayId, 4);
  return (
    <Sheet title="Fyll hullet" sub={`${fmtDateWeekday(day.date)} · ${day.stops.length} stopp`} onClose={close}>
      {reason && <div class="muted small" style={{ marginBottom: 8 }}>{reason} Disse forfallende anleggene ligger i nærheten og får plass:</div>}
      <div class="list">
        {sug.map((s) => (
          <button class="row" onClick={() => { update((st) => moveStop(st, s.control.id, dayId)); nav.toast(`${s.facility.customer} lagt til`); close(); }}>
            <div class="main">
              <div class="t">{s.facility.customer}</div>
              <div class="s">{s.facility.address.place} · ca. {s.nearMin} min fra nærmeste stopp · +{fmtDuration(Math.max(0, s.extraMin))} kjøring</div>
            </div>
            {s.overdue ? <span class="pill solid-red">Forfalt</span> : <span class="pill grey">{fmtQ(s.control.due)}</span>}
          </button>
        ))}
        {sug.length === 0 && <div class="empty"><b>Ingen forslag</b>Ingen forfallende anlegg i nærheten får plass denne dagen.</div>}
      </div>
      <button class="btn block mt12" onClick={close}>La hullet stå</button>
    </Sheet>
  );
}

function AdhocSheet({ close, date: initial }: { close: () => void; date?: string }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const [v, setV] = useState({ date: initial ?? nextWorkdayOnOrAfter(addDays(today, 1), state.settings.blockedDays), customer: '', street: '', postcode: '', place: '', label: 'Ferdigkontroll', durationMin: 90, phone: '' });
  const set = (k: string) => (e: any) => setV({ ...v, [k]: k === 'durationMin' ? Number(e.currentTarget.value) : e.currentTarget.value });
  return (
    <Sheet title="Ad hoc-oppdrag" sub="F.eks. en ferdigkontroll. Appen foreslår forfallende anlegg i nærheten samme dag." onClose={close}>
      <div class="grid2">
        <Field label="Dato"><input class="inp" type="date" value={v.date} onInput={set('date')} /></Field>
        <Field label="Type"><input class="inp" value={v.label} onInput={set('label')} /></Field>
      </div>
      <Field label="Kunde"><input class="inp" value={v.customer} onInput={set('customer')} /></Field>
      <Field label="Gateadresse"><input class="inp" value={v.street} onInput={set('street')} /></Field>
      <div class="grid2">
        <Field label="Postnr."><input class="inp" inputMode="numeric" value={v.postcode} onInput={set('postcode')} /></Field>
        <Field label="Sted"><input class="inp" value={v.place} onInput={set('place')} /></Field>
      </div>
      <div class="grid2">
        <Field label="Varighet (min)"><input class="inp" type="number" value={v.durationMin} onInput={set('durationMin')} /></Field>
        <Field label="Telefon"><input class="inp" type="tel" value={v.phone} onInput={set('phone')} /></Field>
      </div>
      <button class="btn primary block mt12" disabled={!v.customer || !v.postcode || !isWorkday(v.date, state.settings.blockedDays)} onClick={() => {
        const { dayId } = update((s) => addAdhoc(s, v));
        nav.toast('Oppdraget er lagt inn');
        offerFill(dayId, 'Oppdraget er lagt inn.', nav, close);
      }}>Legg inn og vis forslag</button>
    </Sheet>
  );
}
