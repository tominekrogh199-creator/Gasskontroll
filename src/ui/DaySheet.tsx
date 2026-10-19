import { useAppState } from '../store';
import { NavBar, useNav } from './components';
import { facilityOf, findControl, primaryPhone } from '../domain/controls';
import { dayTimeline } from '../domain/planner';
import { fmtDateWeekday, minutesToClock } from '../domain/dates';

/** Ett ark for dagen: tid, adresse, telefon og notater. Skrives ut eller deles. */
export function DaySheet({ dayId }: { dayId: string }) {
  const state = useAppState();
  const nav = useNav();
  const day = state.days.find((d) => d.id === dayId);
  if (!day) return <div class="screen"><NavBar title="Dagen" /><div class="empty">Dagen finnes ikke lenger.</div></div>;
  const tl = dayTimeline(state, day);
  const lines = day.stops.map((id, i) => {
    const c = findControl(state, id);
    if (!c) return '';
    const f = facilityOf(state, c);
    const slot = tl.slots[id];
    const when = c.timeFrom && c.timeTo ? `${c.timeFrom}–${c.timeTo}` : slot ? `${minutesToClock(slot.start)}–${minutesToClock(slot.end)}` : '';
    const phone = primaryPhone(f) ?? '';
    return `${i + 1}. ${when} ${f.customer}\n${f.address.street}, ${f.address.postcode} ${f.address.place}\n${phone}\n${f.notes || ''}`.trim();
  });
  const text = `${fmtDateWeekday(day.date)}\nHjemme ca. ${minutesToClock(tl.endMin)}\n\n${lines.join('\n\n')}`;
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: `Rute ${fmtDateWeekday(day.date)}`, text }); return; } catch { /* avbrutt */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      nav.toast('Dagen er kopiert');
    } catch {
      nav.toast('Deling er ikke tilgjengelig');
    }
  };
  return (
    <div class="screen daysheet">
      <NavBar title="Dagen" />
      <div class="no-print btnrow">
        <button class="btn primary" onClick={() => window.print()}>Skriv ut</button>
        <button class="btn" onClick={share}>Del</button>
      </div>
      <h2 class="print-title">{fmtDateWeekday(day.date)}</h2>
      <div class="muted">Hjemme ca. {minutesToClock(tl.endMin)} · {day.stops.length} stopp</div>
      {day.stops.map((id, i) => {
        const c = findControl(state, id)!;
        const f = facilityOf(state, c);
        const slot = tl.slots[id];
        const when = c.timeFrom && c.timeTo ? `${c.timeFrom}–${c.timeTo}` : slot ? `${minutesToClock(slot.start)}–${minutesToClock(slot.end)}` : '';
        const phone = primaryPhone(f);
        return (
          <div class="print-stop">
            <div class="when">{i + 1}. {when}</div>
            <div class="who">{f.customer}</div>
            <div>{f.address.street}, {f.address.postcode} {f.address.place}</div>
            {phone && <div>{phone}</div>}
            {f.notes && <div class="note">{f.notes}</div>}
          </div>
        );
      })}
    </div>
  );
}
