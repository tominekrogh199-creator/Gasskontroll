import { useAppState } from '../store';
import { Icon, Row, Section, Dot, useNav, Empty } from './components';
import { homeStats } from '../domain/selectors';
import { currentControl, facilityOf, missingInfo, nextStep, todayOf } from '../domain/controls';
import { addDays, fmtDateWeekday, fmtQ, fmtQuarter, minutesToClock, isOverdue } from '../domain/dates';
import { dayArea, dayTimeline } from '../domain/planner';
import { callList, lateDrafts } from '../domain/notices';

export function Home() {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const h = homeStats(state);
  const late = lateDrafts(state);
  const calls = callList(state);
  const next = h.nextDay;
  const tl = next ? dayTimeline(state, next) : null;
  const rel = next ? (next.date === today ? 'I dag' : next.date === addDays(today, 1) ? 'I morgen' : 'Neste kjøredag') : '';
  const inQ = h.dueThisQuarter;
  const queue = h.dueInQuarter.filter((c) => c.status === 'ikke_planlagt').slice(0, 5);
  const todayDay = h.todayDay;
  const todayTl = todayDay ? dayTimeline(state, todayDay) : null;
  const missingIds = state.facilities.flatMap((f) => {
    if (f.mergedInto) return [];
    const c = currentControl(state, f.id);
    if (!c || c.status === 'utfort' || !missingInfo(f).length) return [];
    return [c.id];
  });

  return (
    <div class="screen">
      <div class="topbar">
        <h1>Kontrollplan</h1>
        <button class="iconbtn labeled" onClick={() => nav.push({ kind: 'settings' })} aria-label="Innstillinger"><Icon.gear />Innstillinger</button>
      </div>
      <div class="subtitle">
        {fmtDateWeekday(today)} · {fmtQuarter(h.quarter)}
        {state.settings.testDate && <span class="pill orange" style={{ marginLeft: 8 }}>Testdato</span>}
      </div>

      {late.length > 0 && (
        <button class="banner red" onClick={() => nav.tab('innboks')}>
          <Icon.mail />
          <span style={{ flex: 1 }}>{late.length === 1 ? '1 utkast skulle vært godkjent i dag' : `${late.length} utkast skulle vært godkjent i dag`}</span>
          <Icon.chevR />
        </button>
      )}

      <div class="card hero mt12">
        <div class="eyebrow">I dag</div>
        {todayDay && todayTl ? (
          <>
            <div class="date" style={{ textTransform: 'capitalize' }}>{fmtDateWeekday(today)}</div>
            <div class="meta">
              {todayDay.stops.length} stopp · {dayArea(state, todayDay)} · hjemme ca. {minutesToClock(todayTl.endMin)}
            </div>
            <div class="actions">
              <button class="btn primary" style={{ flex: 1 }} onClick={() => nav.push({ kind: 'route', dayId: todayDay.id })}>
                <Icon.nav /> Start ruten
              </button>
              <button class="btn" onClick={() => nav.tab('kart', { dayId: todayDay.id })}>Kart</button>
            </div>
          </>
        ) : (
          <>
            <div class="date" style={{ textTransform: 'capitalize' }}>{fmtDateWeekday(today)}</div>
            <div class="meta">Ingen stopp ennå. Legg inn det du skal kjøre i dag.</div>
            <div class="actions">
              <button class="btn primary" style={{ flex: 1 }} onClick={() => nav.sheet({ kind: 'today', date: today })}>Legg på i dag</button>
              <button class="btn" onClick={() => nav.tab('plan')}>Uka</button>
            </div>
          </>
        )}
        {next && tl && (
          <button class="banner soft" style={{ marginTop: 12 }} onClick={() => nav.push({ kind: 'route', dayId: next.id })}>
            <span style={{ flex: 1 }}>{rel}: {fmtDateWeekday(next.date)} · {next.stops.length} stopp · hjemme ca. {minutesToClock(tl.endMin)}</span>
            <Icon.chevR />
          </button>
        )}
      </div>

      <div class="stats">
        <button class="stat" onClick={() => nav.push({ kind: 'list', title: `Forfaller i ${fmtQ(h.quarter)}`, subtitle: 'Frist i dette kvartalet', ids: inQ.map((c) => c.id) })}>
          <span class="n">{inQ.length}</span>
          <span class="l">Forfaller i {fmtQ(h.quarter)}</span>
        </button>
        <button class={`stat${h.overdue.length ? ' alert' : ''}`} onClick={() => nav.push({ kind: 'list', title: 'Forfalt', ids: h.overdue.map((c) => c.id) })}>
          <span class="n">{h.overdue.length}</span>
          <span class="l">Forfalt</span>
        </button>
        <button class={`stat${late.length ? ' alert' : ''}`} onClick={() => nav.tab('innboks')}>
          <span class="n">{h.pending}</span>
          <span class="l">Venter på godkjenning</span>
        </button>
        <button class="stat" onClick={() => nav.push({ kind: 'list', title: 'Utsatt', ids: h.postponed.map((c) => c.id) })}>
          <span class="n">{h.postponed.length}</span>
          <span class="l">Utsatt</span>
        </button>
      </div>

      <button class={`banner soft${h.atRisk.length ? '' : ''}`} onClick={() => nav.push({ kind: 'list', title: 'Frist i fare', subtitle: 'Forfalt eller frist innen to uker, og ikke satt på en dag', ids: h.atRisk.map((c) => c.id) })}>
        <span style={{ flex: 1 }}>Frist i fare · {h.atRisk.length}</span>
        <Icon.chevR />
      </button>

      <button class="banner soft" onClick={() => nav.push({ kind: 'list', title: 'Mangler info', subtitle: 'E-post, telefon eller koordinater mangler', ids: missingIds })}>
        <span style={{ flex: 1 }}>Mangler info · {missingIds.length}</span>
        <Icon.chevR />
      </button>

      {calls.length > 0 && (
        <button class="banner soft" onClick={() => nav.tab('innboks')}>
          <Icon.phone />
          <span style={{ flex: 1 }}>Ring disse: {calls.length}</span>
          <Icon.chevR />
        </button>
      )}

      <Section title="Ikke planlagt ennå" action={queue.length ? <button class="link" onClick={() => nav.tab('plan')}>Lag plan</button> : undefined}>
        {queue.length ? (
          <div class="list">
            {queue.map((c) => {
              const f = facilityOf(state, c);
              return (
                <Row
                  left={<Dot c={c} f={f} today={today} />}
                  title={f.customer}
                  sub={`${f.address.place} · ${nextStep(state, c, today)}`}
                  right={isOverdue(c.due, today) ? <span class="pill solid-red">Forfalt</span> : fmtQ(c.due)}
                  onClick={() => nav.push({ kind: 'facility', id: f.id })}
                />
              );
            })}
          </div>
        ) : (
          <div class="list"><Empty title="Alt i kvartalet er planlagt">Nye frister dukker opp her.</Empty></div>
        )}
      </Section>
    </div>
  );
}
