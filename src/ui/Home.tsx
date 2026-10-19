import { useEffect, useState } from 'preact/hooks';
import { update, useAppState } from '../store';
import { Icon, MerButton, tap, useNav } from './components';
import { facilityOf, findControl, primaryPhone, todayOf } from '../domain/controls';
import { addDays, fmtDateWeekday, isWorkday, minutesToClock, nextWorkdayOnOrAfter, quarterOf } from '../domain/dates';
import { buildQuickRoute, dayArea, dayTimeline, driveFromBase } from '../domain/planner';
import { draftsToApprove, kindLabel, readyToSend } from '../domain/notices';
import { areaName, homeStats, quarterWork } from '../domain/selectors';
import type { PlanDay } from '../domain/types';

function routeDateOf(state: ReturnType<typeof useAppState>, today: string): string {
  let date = isWorkday(today, state.settings.blockedDays) ? today : nextWorkdayOnOrAfter(today, state.settings.blockedDays);
  for (let i = 0; i < 12; i++) {
    const day = state.days.find((d) => d.date === date);
    if (!day?.locked && (day?.stops.length ?? 0) < state.settings.maxPerDay) return date;
    date = nextWorkdayOnOrAfter(addDays(date, 1), state.settings.blockedDays);
  }
  return date;
}

function shortDate(iso: string): string {
  const text = fmtDateWeekday(iso);
  return text.replace(/\.\d{4}$/, '');
}

function smsHref(phone: string, body: string): string {
  return `sms:${phone.replace(/\s/g, '')}?&body=${encodeURIComponent(body)}`;
}

export function Home() {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const h = homeStats(state);
  const empty = state.facilities.length === 0;
  const todayDay = h.todayDay;
  const next = h.nextDay;
  const target = routeDateOf(state, today);
  const mail = [...draftsToApprove(state), ...readyToSend(state)].filter((d) => d.notice.sendDate <= addDays(today, 21));

  useEffect(() => {
    if (!mail.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const key = 'kontrollplan.notified';
    const seen = new Set<string>(JSON.parse(sessionStorage.getItem(key) || '[]'));
    let changed = false;
    for (const { notice, control } of mail) {
      if (seen.has(notice.id)) continue;
      seen.add(notice.id);
      changed = true;
      const f = facilityOf(state, control);
      new Notification(`${kindLabel(notice.kind)} til ${f.customer}`, {
        body: `${notice.subject}. Godkjenn før den sendes.`,
        tag: notice.id,
      });
    }
    if (changed) sessionStorage.setItem(key, JSON.stringify([...seen]));
  }, [mail.map((m) => m.notice.id).join('|')]);

  const makeRoute = () => {
    tap(16);
    const res = update((s) => buildQuickRoute(s, target));
    if (!res) nav.toast('Ingen ledige anlegg innen kjøreavstanden');
    else nav.toast(`${res.added.length} kunder lagt på ${fmtDateWeekday(target)}`);
  };
  const work = quarterWork(state, quarterOf(today));
  const within = work.filter((c) => {
    const drive = driveFromBase(state.settings, facilityOf(state, c));
    return drive !== null && drive <= state.settings.maxDriveMin;
  });
  const drammen = work.filter((c) => areaName(state, facilityOf(state, c).id) === 'Drammen og omegn');

  return (
    <div class="screen home">
      <div class="topbar">
        <h1 style={{ textTransform: 'capitalize', fontSize: 26 }}>{empty ? 'Kontrollplan' : shortDate(today)}</h1>
        {mail.length > 0 && (
          <button class="pill solid-red" onClick={() => nav.push({ kind: 'approve' })}>{mail.length} e-post</button>
        )}
        <MerButton />
      </div>

      {empty ? (
        <div class="card hero mt12">
          <div class="eyebrow">Kom i gang</div>
          <div class="date">Last opp kundene</div>
          <div class="meta">Rapportene blir kvartal, adresse og neste kontroll. Med API-nøkkel leser AI dokumentet, ellers brukes reglene.</div>
          <div class="actions">
            <button class="btn primary" style={{ flex: 1 }} onClick={() => nav.push({ kind: 'import' })}><Icon.upload />Last opp</button>
          </div>
        </div>
      ) : todayDay ? (
        <DayList day={todayDay} />
      ) : (
        <>
          <div class="subtitle">Ingen stopp i dag · hjemme fra {state.settings.baseName}</div>
          <button class="btn primary block" onClick={makeRoute}>
            <Icon.route />{target === today ? 'Lag rute for i dag' : `Lag rute ${shortDate(target)}`}
          </button>
          <button class="link block" onClick={() => nav.tab('kart', { band: state.settings.maxDriveMin })}>
            {within.length} innen {state.settings.maxDriveMin === 120 ? '2 timer' : `${state.settings.maxDriveMin} min`} · {drammen.length} i Drammen
          </button>
          {next && <DayList day={next} upcoming />}
        </>
      )}
    </div>
  );
}

function DayList({ day, upcoming }: { day: PlanDay; upcoming?: boolean }) {
  const state = useAppState();
  const nav = useNav();
  const tl = dayTimeline(state, day);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div class="card pad mt12">
      {upcoming && <div class="kicker">Neste kjøredag · {shortDate(day.date)}</div>}
      {!upcoming && (
        <div class="meta" style={{ marginBottom: 4 }}>
          {day.stops.length} stopp · {dayArea(state, day)} · hjemme ca. {minutesToClock(tl.endMin)}
        </div>
      )}
      {day.stops.map((id) => {
        const c = findControl(state, id);
        if (!c) return null;
        const f = facilityOf(state, c);
        const slot = tl.slots[id];
        const when = c.timeFrom ?? (slot ? minutesToClock(slot.start) : '–');
        const phone = primaryPhone(f);
        const eta = c.timeFrom ?? (slot ? minutesToClock(slot.start) : '');
        const expanded = open === id;
        const phoneStyle = phone ? {} : { opacity: 0.4, pointerEvents: 'none' as const };
        return (
          <div class="dstop" key={id}>
            <button class="dstop-main" onClick={() => setOpen(expanded ? null : id)} aria-expanded={expanded}>
              <span class="when">{when}</span>
              <span class="who">
                <b>{f.customer}</b>
                <small>{f.address.place}</small>
              </span>
            </button>
            {expanded && (
              <div class="dstop-actions">
                <div class="btnrow">
                  <a class="btn" style={phoneStyle} href={phone ? `tel:${phone.replace(/\s/g, '')}` : undefined}><Icon.phone />Ring</a>
                  <a class="btn" style={phoneStyle} href={phone ? smsHref(phone, `Hei, jeg er på vei til ${f.customer}, er der ca. ${eta}.`) : undefined}><Icon.mail />SMS</a>
                </div>
                {c.status !== 'utfort' && (
                  <div class="btnrow mt8">
                    <button class="btn" onClick={() => nav.sheet({ kind: 'complete', controlId: c.id })}><Icon.done />Utført</button>
                    <button class="btn" onClick={() => nav.sheet({ kind: 'postpone', controlId: c.id })}><Icon.pause />Utsett</button>
                  </div>
                )}
                <div class="btnrow mt8">
                  <button class="btn" onClick={() => nav.push({ kind: 'route', dayId: day.id })}><Icon.nav />Rute</button>
                  <button class="btn" onClick={() => nav.push({ kind: 'facility', id: f.id })}>Anleggskort</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      {upcoming && <div class="muted small mt8">Hjemme ca. {minutesToClock(tl.endMin)}{tl.overtime ? ' · over arbeidstiden' : ''}</div>}
      {!upcoming && (
        <button class="btn ghost block mt8" onClick={() => nav.sheet({ kind: 'today', date: day.date })}>Legg til stopp</button>
      )}
    </div>
  );
}
