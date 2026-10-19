import { useState } from 'preact/hooks';
import { update, useAppState } from '../store';
import { Empty, Icon, NavBar, Row, Section, useNav } from './components';
import type { Notice } from '../domain/types';
import { facilityOf, primaryPhone, todayOf } from '../domain/controls';
import { addDays, fmtDate, fmtDateWeekday } from '../domain/dates';
import { approve, awaitingResponse, callList, draftsToApprove, kindLabel, markSent, readyToSend, regenerate, stopNotice } from '../domain/notices';
import { registerConfirmed, registerNoAnswer } from '../domain/actions';
import { copyText, mailtoUrl } from '../adapters/sendEmail';

function findNotice(state: ReturnType<typeof useAppState>, id: string) {
  for (const c of state.controls) {
    const n = c.notices.find((x) => x.id === id);
    if (n) return { n, c };
  }
  return null;
}

/** Felles sendeflyt: åpne e-postappen (sendEmail-adapteren), merk som sendt først når brukeren bekrefter. */
export function SendButtons({ n, small }: { n: Notice; small?: boolean }) {
  const nav = useNav();
  const [asked, setAsked] = useState(false);
  if (asked)
    return (
      <div class="btnrow">
        <span class="small" style={{ alignSelf: 'center' }}>Ble e-posten sendt?</span>
        <button class={`btn primary${small ? ' small' : ''}`} onClick={() => { update((s) => { const x = findNotice(s, n.id); if (x) markSent(s, x.n); }); nav.toast('Merket som sendt'); }}>Ja, sendt</button>
        <button class={`btn${small ? ' small' : ''}`} onClick={() => setAsked(false)}>Nei</button>
      </div>
    );
  return (
    <div class="btnrow">
      <a class={`btn primary${small ? ' small' : ''}`} href={mailtoUrl(n)} onClick={() => setTimeout(() => setAsked(true), 400)}><Icon.mail />Åpne i e-post</a>
      <button class={`btn${small ? ' small' : ''}`} onClick={async () => { const ok = await copyText(n); nav.toast(ok ? 'Teksten er kopiert' : 'Kunne ikke kopiere'); setAsked(true); }}><Icon.copy />Kopier tekst</button>
    </div>
  );
}

export function Inbox() {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const drafts = draftsToApprove(state);
  const soonLimit = addDays(today, 14);
  const soon = drafts.filter((d) => d.notice.sendDate <= soonLimit);
  const later = drafts.filter((d) => d.notice.sendDate > soonLimit);
  const [showLater, setShowLater] = useState(false);
  const ready = readyToSend(state);
  const awaiting = awaitingResponse(state).filter((c) => !c.callReason);
  const calls = callList(state);
  const review = state.facilities.filter((f) => f.reviewPending);

  const draftRow = ({ notice: n, control: c }: (typeof drafts)[number]) => {
    const f = facilityOf(state, c);
    const lateN = n.sendDate <= today;
    return (
      <Row
        title={f.customer}
        sub={`${kindLabel(n.kind)} · ${c.plannedDate ? `besøk ${fmtDate(c.plannedDate)}` : 'uten dato'}`}
        right={<span class={`pill ${lateN ? 'solid-red' : 'grey'}`}>{lateN ? 'Send i dag' : `Sendes ${n.sendDate.slice(8, 10)}.${n.sendDate.slice(5, 7)}.`}</span>}
        onClick={() => nav.push({ kind: 'draft', noticeId: n.id })}
      />
    );
  };

  return (
    <div class="screen">
      <div class="topbar"><h1>Innboks</h1></div>

      {ready.length > 0 && (
        <Section title={`Klar til sending · ${ready.length}`}>
          <div class="list">
            {ready.map(({ notice: n, control: c }) => (
              <div class="row static" style={{ flexWrap: 'wrap' }}>
                <div class="main">
                  <div class="t">{kindLabel(n.kind)} · {facilityOf(state, c).customer}</div>
                  <div class="s">{n.to} · godkjent, sendedag {fmtDate(n.sendDate)}</div>
                </div>
                <div style={{ width: '100%' }}><SendButtons n={n} small /></div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section
        title={`Til godkjenning · ${soon.length}`}
        action={soon.length > 1 ? <button class="link" onClick={() => { update((s) => draftsToApprove(s).filter((d) => d.notice.sendDate <= soonLimit).forEach((d) => approve(s, d.notice))); nav.toast(`${soon.length} utkast godkjent`); }}>Godkjenn alle</button> : undefined}
      >
        <div class="list">
          {soon.length ? soon.map(draftRow) : <Empty title="Ingen utkast å godkjenne">{later.length ? 'Ingen utkast skal sendes de neste 14 dagene.' : 'Utkast lages automatisk når kontroller planlegges.'}</Empty>}
        </div>
        {later.length > 0 && (
          <>
            <button class="btn ghost block mt8" onClick={() => setShowLater(!showLater)}>{showLater ? 'Skjul' : 'Vis'} senere utkast ({later.length})</button>
            {showLater && <div class="list mt8">{later.map(draftRow)}</div>}
          </>
        )}
      </Section>

      <Section title={`Svar som må registreres · ${awaiting.length}`}>
        <div class="list">
          {awaiting.length ? awaiting.map((c) => {
            const f = facilityOf(state, c);
            const sent = c.notices.find((n) => n.kind === 'forvarsel' && n.status === 'sendt');
            return (
              <div class="row static" style={{ flexWrap: 'wrap' }}>
                <div class="main" onClick={() => nav.push({ kind: 'facility', id: f.id })} style={{ cursor: 'pointer' }}>
                  <div class="t">{f.customer}</div>
                  <div class="s">Forvarsel sendt {sent?.sentAt ? fmtDate(sent.sentAt.slice(0, 10)) : '–'} · foreslått {c.plannedDate ? fmtDate(c.plannedDate) : '–'}</div>
                </div>
                <div class="btnrow" style={{ width: '100%' }}>
                  <button class="btn small" onClick={() => { update((s) => registerConfirmed(s, c.id)); nav.toast('Bekreftet'); }}>Bekreftet</button>
                  <button class="btn small" onClick={() => nav.sheet({ kind: 'newtime', controlId: c.id })}>Ny tid</button>
                  <button class="btn small" onClick={() => nav.sheet({ kind: 'postpone', controlId: c.id })}>Utsettelse</button>
                  <button class="btn small" onClick={() => { update((s) => registerNoAnswer(s, c.id)); nav.toast('Purring laget'); }}>Ingen svar</button>
                </div>
              </div>
            );
          }) : <Empty title="Ingen svar å registrere">Kontroller med sendt forvarsel havner her.</Empty>}
        </div>
      </Section>

      <Section title={`Ring disse · ${calls.length}`}>
        <div class="list">
          {calls.length ? calls.map((c) => {
            const f = facilityOf(state, c);
            const phone = primaryPhone(f);
            return (
              <div class="row static" style={{ flexWrap: 'wrap' }}>
                <div class="main" onClick={() => nav.push({ kind: 'facility', id: f.id })} style={{ cursor: 'pointer' }}>
                  <div class="t">{f.customer}</div>
                  <div class="s">{c.callReason}{c.plannedDate ? ` · ${fmtDate(c.plannedDate)}` : ''}</div>
                </div>
                <div class="btnrow" style={{ width: '100%' }}>
                  <a class="btn small primary" href={phone ? `tel:${phone.replace(/\s/g, '')}` : undefined} style={phone ? {} : { opacity: 0.4, pointerEvents: 'none' }}><Icon.phone />{phone ?? 'Ingen telefon'}</a>
                  <button class="btn small" onClick={() => { update((s) => registerConfirmed(s, c.id)); nav.toast('Bekreftet'); }}>Bekreftet</button>
                  <button class="btn small" onClick={() => nav.sheet({ kind: 'newtime', controlId: c.id })}>Ny tid</button>
                  <button class="btn small" onClick={() => nav.sheet({ kind: 'postpone', controlId: c.id })}>Utsettelse</button>
                </div>
              </div>
            );
          }) : <Empty title="Ingen å ringe">Kunder uten e-post og kunder som ikke svarer havner her.</Empty>}
        </div>
      </Section>

      <Section title={`Import-gjennomgang · ${review.length}`}>
        <div class="list">
          {review.length ? (
            <Row title={`${review.length} anlegg med lav sikkerhet eller flagg`} sub="Godkjenn, rett eller hopp over – ett anlegg om gangen" onClick={() => nav.push({ kind: 'review' })} />
          ) : <Empty title="Ingenting å gå gjennom">Usikre felt fra importen havner her.</Empty>}
        </div>
      </Section>
    </div>
  );
}

export function DraftScreen({ noticeId }: { noticeId: string }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const found = findNotice(state, noticeId);
  const [body, setBody] = useState(found?.n.body ?? '');
  if (!found) return <div class="screen"><NavBar title="Utkast" /><div class="empty">Utkastet finnes ikke lenger.</div></div>;
  const { n, c } = found;
  const f = facilityOf(state, c);
  const editable = n.status === 'utkast' || n.status === 'godkjent';
  const save = () => update((s) => { const x = findNotice(s, n.id)!; if (x.n.body !== body) { x.n.body = body; x.n.edited = true; } });
  return (
    <div class="screen">
      <NavBar title={kindLabel(n.kind)} />
      <div class="card pad">
        <dl class="kv">
          <dt>Til</dt><dd>{n.to ?? <span class="lowc">ingen e-post</span>}</dd>
          <dt>Mottaker</dt><dd>{n.toLabel}</dd>
          <dt>Sendes</dt><dd style={n.sendDate <= today && n.status === 'utkast' ? { color: 'var(--red)', fontWeight: 600 } : {}}>{fmtDateWeekday(n.sendDate)}</dd>
          <dt>Status</dt><dd>{{ utkast: 'Utkast', godkjent: 'Godkjent', sendt: `Sendt ${n.sentAt ? fmtDate(n.sentAt.slice(0, 10)) : ''}`, stoppet: 'Stoppet' }[n.status]}</dd>
          <dt>Emne</dt><dd>{n.subject}</dd>
          <dt>Anlegg</dt><dd><button class="btn small ghost" style={{ padding: 0, minHeight: 0 }} onClick={() => nav.push({ kind: 'facility', id: f.id })}>{f.customer}</button></dd>
        </dl>
      </div>
      {n.kind === 'forvarsel' && editable && (
        <label class="toggle card pad mt12" style={{ padding: '4px 16px' }}>
          <span>Kun kvartal (uten konkret tid)</span>
          <input type="checkbox" checked={n.quarterOnly} onChange={(e) => {
            const on = e.currentTarget.checked;
            update((s) => { const x = findNotice(s, n.id)!; x.n.quarterOnly = on; x.n.edited = false; regenerate(s, x.n); setBody(x.n.body); });
          }} />
        </label>
      )}
      <div class="section"><h2>Tekst</h2>{n.edited && <span class="muted small">Redigert</span>}</div>
      {editable ? (
        <textarea class="inp" style={{ minHeight: 300 }} value={body} onInput={(e) => setBody(e.currentTarget.value)} onBlur={save} />
      ) : (
        <div class="card pad draft-body">{n.body}</div>
      )}
      {editable && (
        <div class="btnrow mt12">
          {n.status === 'utkast' && <button class="btn primary" style={{ flex: 1 }} onClick={() => { save(); update((s) => approve(s, findNotice(s, n.id)!.n)); nav.toast('Godkjent'); nav.pop(); }}><Icon.check />Godkjenn</button>}
          <button class="btn" onClick={() => { update((s) => stopNotice(s, findNotice(s, n.id)!.n)); nav.toast('Stoppet'); nav.pop(); }}>Stopp</button>
        </div>
      )}
      {editable && (
        <>
          <div class="section"><h2>Send nå</h2></div>
          <div class="muted small" style={{ marginBottom: 8 }}>Åpner e-postappen ferdig utfylt. Varselet merkes som sendt først når du bekrefter.</div>
          <SendButtons n={{ ...n, body }} />
        </>
      )}
    </div>
  );
}
