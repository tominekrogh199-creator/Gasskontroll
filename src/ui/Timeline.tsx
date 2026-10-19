import type { AppState, PlanDay } from '../domain/types';
import { dayTimeline } from '../domain/planner';
import { clockToMinutes, fmtDuration, minutesToClock } from '../domain/dates';
import { facilityOf, findControl } from '../domain/controls';

export function DayTimeline({ state, day, onStop }: { state: AppState; day: PlanDay; onStop?: (controlId: string) => void }) {
  const tl = dayTimeline(state, day);
  const end = clockToMinutes(state.settings.dayEnd);
  const ev = tl.events;
  return (
    <div class="timeline">
      {ev.map((e, i) => {
        const cls = `tl${i === 0 ? ' first' : ''}${i === ev.length - 1 ? ' last' : ''}`;
        if (e.type === 'avreise')
          return (
            <div class={cls}><div class="time">{minutesToClock(e.at)}</div><div class="rail"><div class="node" /></div>
              <div class="body"><div class="t">Avreise</div><div class="s">{e.from}</div></div></div>
          );
        if (e.type === 'kjoring')
          return (
            <div class={cls}><div class="time" /><div class="rail"><div class="node drive" /></div>
              <div class="body drive">Kjøring ca. {fmtDuration(e.min)}</div></div>
          );
        if (e.type === 'lunsj')
          return (
            <div class={cls}><div class="time">{minutesToClock(e.start)}</div><div class="rail"><div class="node" /></div>
              <div class="body"><div class="t">Lunsj</div><div class="s">{fmtDuration(e.end - e.start)}</div></div></div>
          );
        if (e.type === 'kontroll') {
          const c = findControl(state, e.controlId)!;
          const f = facilityOf(state, c);
          const over = e.end > end;
          return (
            <div class={`${cls}${over ? ' over' : ''}`}>
              <div class="time">{minutesToClock(e.start)}</div>
              <div class="rail"><div class="node stop">{e.index}</div></div>
              <button class="body" style={{ border: 0, background: 'none', textAlign: 'left', padding: '6px 0 10px', cursor: 'pointer' }} onClick={() => onStop?.(e.controlId)}>
                <div class="t">{f.customer}{c.adhocLabel ? ` · ${c.adhocLabel}` : ''}</div>
                <div class="s">{f.address.street}, {f.address.place} · til {minutesToClock(e.end)}</div>
              </button>
            </div>
          );
        }
        if (e.type === 'hjemkomst')
          return (
            <div class={`${cls}${e.at > end ? ' over' : ''}`}><div class="time">{minutesToClock(e.at)}</div><div class="rail"><div class="node" /></div>
              <div class="body"><div class="t">Hjemme</div><div class="s">{e.at > end ? `${fmtDuration(e.at - end)} over arbeidstiden` : state.settings.baseName}</div></div></div>
          );
        return (
          <div class={`${cls}${e.at > end ? ' over' : ''}`}><div class="time">{minutesToClock(e.at)}</div><div class="rail"><div class="node" /></div>
            <div class="body"><div class="t">Overnatting</div><div class="s">i området</div></div></div>
        );
      })}
    </div>
  );
}
