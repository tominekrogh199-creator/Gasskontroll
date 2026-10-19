import { useAppState } from '../store';
import { Icon, NavBar, useNav } from './components';
import { facilityOf, findControl, primaryPhone, todayOf } from '../domain/controls';
import { appleStopUrl, dayRouteUrl, dayTimeline, googleStopUrl } from '../domain/planner';
import { fmtDateWeekday, fmtDuration, minutesToClock } from '../domain/dates';
import { STATUS_LABEL } from '../domain/types';

function routeWindow(slot: { start: number; end: number } | undefined, from: string | null, to: string | null): string {
  const agreed = from && to ? `${from}–${to}` : '';
  const approx = slot ? `${minutesToClock(slot.start)}–${minutesToClock(slot.end)}` : '';
  if (agreed && agreed === approx) return `kl. ${agreed}`;
  if (agreed && approx) return `ca. ${approx} · avtalt ${agreed}`;
  if (approx) return `ca. ${approx}`;
  if (agreed) return `avtalt ${agreed}`;
  return '';
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
  return (
    <div class="screen">
      <NavBar title={fmtDateWeekday(day.date)} />
      <div class="btnrow">
        <a class="btn primary" style={{ flex: 1 }} href={dayRouteUrl(state, day)} target="_blank" rel="noopener"><Icon.route />Hele ruten i Google Maps</a>
      </div>
      <div class="muted small mt8">
        {day.stops.length} stopp · ca. {fmtDuration(tl.driveMin)} kjøring · hjemme ca. {minutesToClock(tl.endMin)}{tl.overtime ? ' (over arbeidstiden)' : ''}. Kjøretider er anslag.
      </div>
      {day.stops.map((id, i) => {
        const c = findControl(state, id)!;
        const f = facilityOf(state, c);
        const slot = tl.slots[id];
        const phone = primaryPhone(f);
        const done = c.status === 'utfort';
        const avvik = f.deviations;
        return (
          <div class="card pad mt12" style={id === firstOpen ? { boxShadow: 'inset 0 0 0 1.5px var(--graphite), var(--shadow)' } : {}}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div class="tl" style={{ display: 'block' }}><div class="node stop" style={{ marginTop: 2, width: 28, height: 28, borderRadius: 14, fontSize: 14 }}>{i + 1}</div></div>
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
            {avvik.length > 0 && avvik.map((d) => <div class={`note ${d.severity === 'avvik' ? 'warn' : ''}`}>{d.severity === 'avvik' ? 'Åpent avvik: ' : 'Merknad: '}{d.text}</div>)}
            <div class="btnrow mt12">
              <a class="btn primary" style={{ flex: 1 }} href={f.coords ? googleStopUrl(f.coords) : undefined} target="_blank" rel="noopener"><Icon.nav />Naviger</a>
              {f.coords && <a class="btn" href={appleStopUrl(f.coords, f.customer)} target="_blank" rel="noopener">Apple Kart</a>}
              {phone && <a class="btn" href={`tel:${phone.replace(/\s/g, '')}`} aria-label="Ring"><Icon.phone /></a>}
            </div>
            <div class="btnrow mt8">
              {!done && <button class="btn small" onClick={() => nav.sheet({ kind: 'complete', controlId: c.id })}><Icon.done />Utført</button>}
              {!done && <button class="btn small" onClick={() => nav.sheet({ kind: 'postpone', controlId: c.id })}>Utsett</button>}
              <button class="btn small ghost" onClick={() => nav.push({ kind: 'facility', id: f.id })}>Anleggskort</button>
            </div>
          </div>
        );
      })}
      <div class="muted tiny mt12">I dag er {fmtDateWeekday(today)}.</div>
    </div>
  );
}
