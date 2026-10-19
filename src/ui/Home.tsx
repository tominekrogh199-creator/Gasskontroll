import { useEffect, useState } from 'preact/hooks';
import { update, useAppState } from '../store';
import { Icon, Row, Section, Dot, useNav, Empty, Seg } from './components';
import { homeStats, quarterWork, areaName } from '../domain/selectors';
import { facilityOf, missingInfo, nextStep, todayOf, currentControl } from '../domain/controls';
import { addDays, fmtDate, fmtDateWeekday, fmtQ, fmtQuarter, minutesToClock, isOverdue, isWorkday, nextWorkdayOnOrAfter, quarterOf } from '../domain/dates';
import { buildQuickRoute, dayArea, dayTimeline, driveFromBase } from '../domain/planner';
import { approve, callList, draftsToApprove, kindLabel, lateDrafts, markSent, readyToSend } from '../domain/notices';
import { mailtoUrl } from '../adapters/sendEmail';
import type { Quarter } from '../domain/types';

function routeDateOf(state: ReturnType<typeof useAppState>, today: string): string {
  let date = isWorkday(today, state.settings.blockedDays) ? today : nextWorkdayOnOrAfter(today, state.settings.blockedDays);
  for (let i = 0; i < 12; i++) {
    const day = state.days.find((d) => d.date === date);
    if (!day?.locked && (day?.stops.length ?? 0) < state.settings.maxPerDay) return date;
    date = nextWorkdayOnOrAfter(addDays(date, 1), state.settings.blockedDays);
  }
  return date;
}

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
  const empty = state.facilities.length === 0;
  const target = routeDateOf(state, today);
  const [q, setQ] = useState<Quarter>(quarterOf(today));
  const work = quarterWork(state, q);
  const drammen = work.filter((c) => areaName(state, facilityOf(state, c).id) === 'Drammen og omegn');
  const radius = work.filter((c) => {
    const drive = driveFromBase(state.settings, facilityOf(state, c));
    return drive !== null && drive <= state.settings.maxDriveMin;
  });
  const hours = state.settings.maxDriveMin / 60;
  const radiusLabel = hours === 2 ? 'Innen 2 timer' : `Innen ${String(hours).replace('.', ',')} timer`;
  const years = [...new Set(state.controls.map((c) => c.due.year))].sort((a, b) => a - b);
  const mail = [...draftsToApprove(state), ...readyToSend(state)]
    .filter((d) => d.notice.sendDate <= addDays(today, 21))
    .slice(0, 2);

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
    const res = update((s) => buildQuickRoute(s, target));
    if (!res) nav.toast('Ingen ledige anlegg innen kjøreavstanden');
    else nav.toast(`${res.added.length} kunder lagt på ${fmtDateWeekday(target)}`);
  };

  return (
    <div class="screen home">
      <div class="topbar">
        <h1>Kontrollplan</h1>
        <button class="iconbtn labeled" onClick={() => nav.push({ kind: 'import' })} aria-label="Last opp kunder"><Icon.upload />Last opp</button>
        <button class="iconbtn labeled" onClick={() => nav.push({ kind: 'settings' })} aria-label="Innstillinger"><Icon.gear />Innstillinger</button>
      </div>
      <div class="subtitle">
        {fmtDateWeekday(today)} · {fmtQuarter(h.quarter)}
        {state.settings.testDate && <span class="pill orange" style={{ marginLeft: 8 }}>Testdato</span>}
      </div>

      {late.length > 0 && (
        <button class="banner red" onClick={() => nav.tab('innboks')}>
          <Icon.mail />
          <span style={{ flex: 1 }}>{late.length === 1 ? '1 e-post skulle vært godkjent i dag' : `${late.length} e-poster skulle vært godkjent i dag`}</span>
          <Icon.chevR />
        </button>
      )}

      {empty ? (
        <div class="card hero mt12">
          <div class="eyebrow">Kom i gang</div>
          <div class="date">Last opp kundene</div>
          <div class="meta">Rapportene blir kvartal, adresse og neste kontroll. Med API-nøkkel leser AI dokumentet, ellers brukes reglene.</div>
          <div class="actions">
            <button class="btn primary" style={{ flex: 1 }} onClick={() => nav.push({ kind: 'import' })}><Icon.upload />Last opp</button>
          </div>
        </div>
      ) : (
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
              <div class="meta">Ingen rute ennå. Ett trykk plukker 3–4 kunder etter frist og kjøreavstand.</div>
              <div class="actions">
                <button class="btn primary" style={{ flex: 1 }} onClick={makeRoute}><Icon.route />Lag rute for i dag</button>
                <button class="btn" onClick={() => nav.sheet({ kind: 'today', date: today })}>Velg selv</button>
              </div>
            </>
          )}
          {todayDay && target !== today && (
            <button class="btn block mt12" onClick={makeRoute}>Lag rute {fmtDate(target)}</button>
          )}
          {next && tl && next.date !== today && (
            <button class="banner soft" style={{ marginTop: 12 }} onClick={() => nav.push({ kind: 'route', dayId: next.id })}>
              <span style={{ flex: 1 }}>{rel}: {fmtDateWeekday(next.date)} · {next.stops.length} stopp · hjemme ca. {minutesToClock(tl.endMin)}</span>
              <Icon.chevR />
            </button>
          )}
        </div>
      )}

      {mail.map(({ notice, control }) => {
        const f = facilityOf(state, control);
        return (
          <div class="card pad mailcard mt12" key={notice.id}>
            <div class="eyebrow">Klar til sending · godkjenn først</div>
            <div style={{ fontWeight: 700, fontSize: 17, marginTop: 4 }}>{kindLabel(notice.kind)} til {f.customer}</div>
            <div class="muted small">{notice.subject}</div>
            <div class="small mt8">Sendes {fmtDate(notice.sendDate)} til {notice.to ?? 'uten e-post'}.</div>
            <p class="mailpreview">{notice.body.split('\n').filter(Boolean).slice(0, 2).join(' ')}</p>
            <MailActions noticeId={notice.id} />
          </div>
        );
      })}

      <div class="card pad glance mt12">
        <div class="eyebrow">Kvartal og kjøreavstand</div>
        <div class="mt8">
          <Seg value={String(q.q)} options={[['1', '1.'], ['2', '2.'], ['3', '3.'], ['4', '4.']]} onChange={(v) => setQ({ year: q.year, q: Number(v) as Quarter['q'] })} />
        </div>
        <label class="field mt8">
          <span>År</span>
          <select class="sel" aria-label="År" value={q.year} onChange={(e) => setQ({ year: Number(e.currentTarget.value), q: q.q })}>
            {years.map((y) => <option value={y}>{y}</option>)}
          </select>
        </label>
        <div class="stats">
          <button class="stat" onClick={() => nav.push({ kind: 'list', title: `Drammen og omegn · ${fmtQ(q)}`, subtitle: 'Kontroller i området dette kvartalet', ids: drammen.map((c) => c.id) })}>
            <span class="n">{drammen.length}</span>
            <span class="l">Drammen og omegn</span>
          </button>
          <button class="stat" onClick={() => nav.push({ kind: 'list', title: `${radiusLabel} · ${fmtQ(q)}`, subtitle: `Kjøretid fra ${state.settings.baseName} er innen ${state.settings.maxDriveMin} minutter`, ids: radius.map((c) => c.id) })}>
            <span class="n">{radius.length}</span>
            <span class="l">{radiusLabel}</span>
          </button>
        </div>
      </div>

      <button class="banner soft" onClick={() => nav.sheet({ kind: 'utsett' })}>
        <Icon.pause />
        <span style={{ flex: 1 }}>Utsettelse</span>
        <Icon.chevR />
      </button>

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

      <button class="banner soft" onClick={() => nav.push({ kind: 'list', title: 'Frist i fare', subtitle: 'Forfalt eller frist innen to uker, og ikke satt på en dag', ids: h.atRisk.map((c) => c.id) })}>
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

function MailActions({ noticeId }: { noticeId: string }) {
  const state = useAppState();
  const nav = useNav();
  const found = state.controls.flatMap((c) => c.notices).find((n) => n.id === noticeId);
  const [opened, setOpened] = useState(found?.status === 'godkjent');
  const [perm, setPerm] = useState(typeof Notification === 'undefined' ? 'no' : Notification.permission);
  if (!found) return null;
  const askNotify = async () => {
    if (typeof Notification === 'undefined') return;
    setPerm(await Notification.requestPermission());
  };
  if (opened || found.status === 'godkjent') {
    return (
      <div class="btnrow mt12">
        <span class="small" style={{ alignSelf: 'center' }}>Ble e-posten sendt?</span>
        <button class="btn primary" onClick={() => { update((s) => { const n = s.controls.flatMap((c) => c.notices).find((x) => x.id === noticeId); if (n) markSent(s, n); }); nav.toast('Merket som sendt'); }}>Ja, sendt</button>
        <button class="btn" onClick={() => setOpened(false)}>Nei</button>
      </div>
    );
  }
  return (
    <>
      <div class="btnrow mt12">
        <a class="btn primary" style={{ flex: 1 }} href={mailtoUrl(found)} onClick={() => { update((s) => { const n = s.controls.flatMap((c) => c.notices).find((x) => x.id === noticeId); if (n) approve(s, n); }); setOpened(true); }}><Icon.mail />Godkjenn og send</a>
        <button class="btn" onClick={() => nav.push({ kind: 'draft', noticeId })}>Endre</button>
      </div>
      <div class="muted tiny mt8">E-posten åpnes ferdig utfylt. Den merkes sendt først når du bekrefter.</div>
      {perm === 'default' && <button class="btn ghost block mt8" onClick={askNotify}>Varsle meg på telefonen</button>}
    </>
  );
}
