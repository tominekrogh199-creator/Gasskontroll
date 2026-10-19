import { update, useAppState } from '../store';
import { Icon, NavBar, Seg, useNav } from './components';
import { facilityOf, findControl, primaryPhone, todayOf } from '../domain/controls';
import { appleStopUrl, dayRouteUrl, dayTimeline, googleStopUrl, refreshDay, removeStop } from '../domain/planner';
import { fmtDateWeekday, fmtDuration, minutesToClock } from '../domain/dates';
import { STATUS_LABEL, type PlanDay } from '../domain/types';

function routeWindow(slot: { start: number; end: number } | undefined, from: string | null, to: string | null): string {
  const agreed = from && to ? `${from}–${to}` : '';
  const approx = slot ? `${minutesToClock(slot.start)}–${minutesToClock(slot.end)}` : '';
  if (agreed && agreed === approx) return `kl. ${agreed}`;
  if (agreed && approx) return `ca. ${approx} · avtalt ${agreed}`;
  if (approx) return `ca. ${approx}`;
  if (agreed) return `avtalt ${agreed}`;
  return '';
}

function smsHref(phone: string, body: string): string {
  return `sms:${phone.replace(/\s/g, '')}?&body=${encodeURIComponent(body)}`;
}

/** «Start ruten»: stoppene i rekkefølge med notater og åpne avvik synlig før besøket. */
export function RouteScreen({ dayId }: { dayId: string }) {
  const state = useAppState();
  const nav = useNav();
  const day = state.days.find((d) => d.id === dayId);
  if (!day) return <div class="screen"><NavBar title="Rute" /><div class="empty">Dagen finnes ikke lenger.</div></div>;
  const tl = dayTimeline(state, day);
  const today = todayOf(state.settings);
  const firstOpen = day.stops.find((id) => findControl(state, id)?.status !== 'utfort');
  const mode = day.startMode ?? 'base';
  const setStart = (m: 'base' | 'gps' | 'siste') => {
    if (m === 'gps') {
      if (!navigator.geolocation) {
        nav.toast('Fant ikke posisjon. Bruker basen.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          update((s) => {
            const d = s.days.find((x) => x.id === day.id);
            if (!d) return;
            d.startMode = 'gps';
            d.startLat = pos.coords.latitude;
            d.startLng = pos.coords.longitude;
            refreshDay(s, d);
          });
          nav.toast('Ruten starter der du er');
        },
        () => nav.toast('Fant ikke posisjon. Bruker basen.'),
        { enableHighAccuracy: true, timeout: 8000 },
      );
      return;
    }
    update((s) => {
      const d = s.days.find((x) => x.id === day.id);
      if (!d) return;
      d.startMode = m;
      if (m === 'base') { d.startLat = null; d.startLng = null; }
      refreshDay(s, d);
    });
  };
  return (
    <div class="screen">
      <NavBar title={fmtDateWeekday(day.date)} right={<button class="btn small" onClick={() => nav.push({ kind: 'daysheet', dayId: day.id })}>Del</button>} />
      <div class="stickyhome">Hjemme ca. {minutesToClock(tl.endMin)}{tl.overtime ? ' · over arbeidstiden' : ''}</div>
      <div class="mt8">
        <Seg<'base' | 'gps' | 'siste'> value={mode} options={[['base', state.settings.baseName], ['gps', 'Her'], ['siste', 'Siste stopp']]} onChange={setStart} />
      </div>
      <div class="btnrow mt8">
        <a class="btn primary" style={{ flex: 1 }} href={dayRouteUrl(state, day)} target="_blank" rel="noopener"><Icon.route />Hele ruten i Google Maps</a>
      </div>
      <div class="muted small mt8">
        {day.stops.length} stopp · ca. {fmtDuration(tl.driveMin)} kjøring. Kjøretider er anslag.
      </div>
      {day.stops.map((id, i) => (
        <StopCard day={day} id={id} index={i} first={id === firstOpen} />
      ))}
      <div class="muted tiny mt12">I dag er {fmtDateWeekday(today)}.</div>
    </div>
  );
}

function StopCard({ day, id, index, first }: { day: PlanDay; id: string; index: number; first: boolean }) {
  const state = useAppState();
  const nav = useNav();
  const c = findControl(state, id)!;
  const f = facilityOf(state, c);
  const tl = dayTimeline(state, day);
  const slot = tl.slots[id];
  const phone = primaryPhone(f);
  const done = c.status === 'utfort';
  const eta = c.timeFrom ?? (slot ? minutesToClock(slot.start) : '');
  const sms = `Hei, jeg er på vei til ${f.customer}, er der ca. ${eta}.`;
  const phoneStyle = phone ? { flex: 1 } : { flex: 1, opacity: 0.4, pointerEvents: 'none' as const };
  return (
    <div class="card pad mt12" style={first ? { boxShadow: 'inset 0 0 0 1.5px var(--graphite), var(--shadow)' } : {}}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div class="tl" style={{ display: 'block' }}><div class="node stop" style={{ marginTop: 2, width: 28, height: 28, borderRadius: 14, fontSize: 14 }}>{index + 1}</div></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>{f.customer}</div>
          <div class="muted">{f.address.street}, {f.address.postcode} {f.address.place}</div>
          <div class="small mt8">
            {routeWindow(slot, c.timeFrom, c.timeTo)}
            {(slot || c.timeFrom) ? ' · ' : ''}
            <span class={done ? '' : 'muted'}>{STATUS_LABEL[c.status]}</span>
            {c.adhocLabel ? ` · ${c.adhocLabel}` : ''}
          </div>
        </div>
      </div>
      {f.notes ? <div class="note" style={{ fontWeight: 600, color: 'var(--text)' }}>Notat: {f.notes}</div> : <div class="note">Ingen notater.</div>}
      {f.deviations.map((d) => <div class={`note ${d.severity === 'avvik' ? 'warn' : ''}`}>{d.severity === 'avvik' ? 'Åpent avvik: ' : 'Merknad: '}{d.text}</div>)}
      <div class="btnrow mt12">
        <a class="btn primary" style={{ flex: 1 }} href={f.coords ? googleStopUrl(f.coords) : undefined} target="_blank" rel="noopener"><Icon.nav />Naviger</a>
        {f.coords && <a class="btn" href={appleStopUrl(f.coords, f.customer)} target="_blank" rel="noopener">Apple Kart</a>}
      </div>
      <div class="btnrow mt8">
        <a class="btn" style={phoneStyle} href={phone ? `tel:${phone.replace(/\s/g, '')}` : undefined}><Icon.phone />Ring</a>
        <a class="btn" style={phoneStyle} href={phone ? smsHref(phone, sms) : undefined}><Icon.mail />SMS</a>
      </div>
      {!done && (
        <>
          <button class="btn primary block mt12" onClick={() => nav.sheet({ kind: 'complete', controlId: c.id })}><Icon.done />Utført</button>
          <button class="btn block mt8" onClick={() => {
            const hole = update((s) => removeStop(s, id));
            nav.sheet({ kind: 'offday', controlId: id, dayId: hole });
          }}>Av i dag</button>
          <button class="btn ghost block" onClick={() => nav.sheet({ kind: 'postpone', controlId: c.id })}>Utsett til senere</button>
        </>
      )}
      <button class="btn small ghost mt8" onClick={() => nav.push({ kind: 'facility', id: f.id })}>Anleggskort</button>
    </div>
  );
}
