import { useState } from 'preact/hooks';
import { update, useAppState } from '../store';
import { mergeIntoOneVisit, sameAddressOf } from '../domain/merge';
import { FlagPills, Icon, NavBar, Section, StatusPill, useNav } from './components';
import type { Control, Facility } from '../domain/types';
import { STATUS_LABEL } from '../domain/types';
import { currentControl, facilityOf, logBoth, nextStep, primaryPhone, recipient, todayOf } from '../domain/controls';
import { fmtDate, fmtDateWeekday, fmtQuarter, fmtStamp, nowStamp } from '../domain/dates';
import { appleStopUrl, googleStopUrl } from '../domain/planner';
import { areaName, driveMinOf, tankRequalYear } from '../domain/selectors';
import { registerConfirmed, registerNoAnswer } from '../domain/actions';
import { FIELD_LABEL } from '../domain/reportParser';

export function ActionGrid({ f, c }: { f: Facility; c: Control | undefined }) {
  const nav = useNav();
  const phone = primaryPhone(f);
  const r = recipient(f);
  return (
    <div class="btnrow grid4">
      <a class="btn" href={phone ? `tel:${phone.replace(/\s/g, '')}` : undefined} aria-disabled={!phone} style={phone ? {} : { opacity: 0.4, pointerEvents: 'none' }}><Icon.phone />Ring</a>
      <a class="btn" href={r ? `mailto:${r.contact.email}` : undefined} style={r ? {} : { opacity: 0.4, pointerEvents: 'none' }}><Icon.mail />E-post</a>
      <a class="btn" href={f.coords ? googleStopUrl(f.coords) : undefined} target="_blank" rel="noopener" style={f.coords ? {} : { opacity: 0.4, pointerEvents: 'none' }}><Icon.nav />Naviger</a>
      <button class="btn" disabled={!c || c.status === 'utfort'} onClick={() => c && nav.sheet({ kind: 'schedule', controlId: c.id })}><Icon.cal />Planlegg</button>
    </div>
  );
}

export function FacilityDetail({ id }: { id: string }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const f = state.facilities.find((x) => x.id === id);
  const [notes, setNotes] = useState(f?.notes ?? '');
  const [bp, setBp] = useState({ from: '', to: '', reason: '' });
  if (!f) return <div class="screen"><NavBar title="Anlegg" /><div class="empty">Anlegget finnes ikke lenger.</div></div>;
  const c = currentControl(state, f.id);
  const past = state.controls.filter((x) => x.facilityId === f.id && x.status === 'utfort');
  const r = recipient(f);
  const drive = driveMinOf(state, f.id);
  const requal = tankRequalYear(f.tank?.inServiceYear);
  const low = Object.entries(f.confidence).filter(([, v]) => v === 'lav').map(([k]) => (FIELD_LABEL as any)[k] ?? (k === 'coords' ? 'Koordinater' : k));
  const thisYear = Number(today.slice(0, 4));
  const twin = sameAddressOf(state, f);
  const host = f.mergedInto ? state.facilities.find((x) => x.id === f.mergedInto) : undefined;

  const saveNotes = () => update((s) => {
    const x = s.facilities.find((y) => y.id === f.id)!;
    if (x.notes !== notes) { x.notes = notes; x.log.push({ at: nowStamp(today), text: 'Notater endret' }); }
  });

  return (
    <div class="screen">
      <NavBar title={f.objectId} />
      <h2 style={{ fontSize: 26, margin: '4px 0 2px', letterSpacing: '-0.01em' }}>{f.customer || '(uten navn)'}</h2>
      <div class="muted">{f.address.street}, {f.address.postcode} {f.address.place}</div>
      {host && <div class="note">Dekkes av besøket til {host.customer} (Objekt ID {host.objectId}).</div>}
      {twin && (
        <button class="btn block mt8" onClick={() => {
          update((s) => mergeIntoOneVisit(s, f.id, twin.id));
          nav.toast(`Slått sammen med ${twin.customer} til ett besøk`);
        }}>Slå sammen med {twin.customer} · Objekt ID {twin.objectId}</button>
      )}
      {c && (
        <div class="pills mt8">
          <StatusPill c={c} today={today} />
          <FlagPills c={c} f={f} today={today} />
          {past.length > 0 && <span class="pill green">Utført {fmtDate(past[past.length - 1].completedAt)}</span>}
        </div>
      )}
      {c && (
        <div class="card pad mt12">
          <div class="muted small">Neste steg</div>
          <div style={{ fontWeight: 600, fontSize: 17 }}>{nextStep(state, c, today)}</div>
          <div class="small muted mt8">
            Frist {fmtQuarter(c.due)}
            {c.plannedDate && <> · {fmtDateWeekday(c.plannedDate)}{c.timeFrom ? ` kl. ${c.timeFrom}–${c.timeTo}` : ''}</>}
          </div>
          {c.status === 'utsatt' && c.postponement && (
            <div class={`note ${c.postponement.afterDeadline ? 'warn' : 'amber'}`}>
              Utsatt: {c.postponement.reason}{c.postponement.text ? ` – ${c.postponement.text}` : ''}. Ny periode {fmtQuarter(c.postponement.newPeriod)}, oppfølging {fmtDate(c.postponement.followUp)}.
              {c.postponement.reason === 'Venter på service' && f.servicePartner && <> Servicepartner: <b>{f.servicePartner}</b>.</>}
              {c.postponement.afterDeadline && <> <b>Ny periode er etter fristen.</b></>}
            </div>
          )}
          {c.callReason && <div class="note warn">Ring: {c.callReason}</div>}
        </div>
      )}
      <div class="mt12"><ActionGrid f={f} c={c} /></div>
      {c && c.status === 'varslet' && (
        <div class="card pad mt12">
          <div class="muted small" style={{ marginBottom: 8 }}>Registrer kundens svar</div>
          <div class="btnrow">
            <button class="btn small" onClick={() => { update((s) => registerConfirmed(s, c.id)); nav.toast('Bekreftet'); }}>Bekreftet</button>
            <button class="btn small" onClick={() => nav.sheet({ kind: 'newtime', controlId: c.id })}>Ny tid</button>
            <button class="btn small" onClick={() => nav.sheet({ kind: 'postpone', controlId: c.id })}>Utsett</button>
            <button class="btn small" onClick={() => { update((s) => registerNoAnswer(s, c.id)); nav.toast('Purring laget og lagt i «Ring disse»'); }}>Ingen svar</button>
          </div>
        </div>
      )}
      {c && c.status !== 'utfort' && (
        <div class="btnrow mt12">
          {c.status !== 'utsatt' && <button class="btn" style={{ flex: 1 }} onClick={() => nav.sheet({ kind: 'postpone', controlId: c.id })}><Icon.pause />Utsett</button>}
          <button class="btn" style={{ flex: 1 }} onClick={() => nav.sheet({ kind: 'complete', controlId: c.id })}><Icon.done />Utført</button>
        </div>
      )}

      {f.deviations.length > 0 && (
        <Section title="Åpne avvik og merknader">
          <div class="card pad">
            {f.deviations.map((d) => (
              <div class={`note ${d.severity === 'avvik' ? 'warn' : ''}`}>{d.severity === 'avvik' ? 'Avvik: ' : d.severity === 'anbefaling' ? 'Anbefaling: ' : ''}{d.text}</div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Notater">
        <div class="card pad">
          <textarea class="inp" style={{ minHeight: 80 }} placeholder="Portkode, hund, hvor tanken ligger …" value={notes} onInput={(e) => setNotes(e.currentTarget.value)} onBlur={saveNotes} />
          <div class="muted tiny mt8">Lagres når du går ut av feltet.</div>
        </div>
      </Section>

      <Section title="Kontakt">
        <div class="list">
          {f.contacts.map((ct) => (
            <div class="row static">
              <div class="main">
                <div class="t">{ct.name || '(uten navn)'} <span class="muted small">· {ct.role}</span></div>
                <div class="s">{ct.email ?? 'ingen e-post'} · {ct.phone ?? 'ingen telefon'}</div>
              </div>
              {r?.contact === ct && <span class="pill blue">Mottaker</span>}
            </div>
          ))}
        </div>
        <div class="muted small mt8">{r ? `Varsler går til ${r.contact.name} (${r.reason}).` : 'Ingen e-post – varsler havner i «Ring disse».'}</div>
      </Section>

      <Section title="Anlegget">
        <div class="card pad">
          <dl class="kv">
            <dt>Objekt ID</dt><dd>{f.objectId}</dd>
            <dt>Neste frist</dt><dd>{f.nextDue ? fmtQuarter(f.nextDue) : <span class="lowc">ukjent</span>}</dd>
            <dt>Siste kontroll</dt><dd>{fmtDate(f.lastControl)}</dd>
            <dt>Rapportdato</dt><dd>{fmtDate(f.reportDate)}</dd>
            <dt>Område</dt><dd>{areaName(state, f.id)}</dd>
            <dt>Kjøretid</dt><dd>{drive !== null ? `ca. ${drive} min fra ${state.settings.baseName}` : '–'}{drive !== null && drive > state.settings.maxDriveMin ? ' (utenfor radius)' : ''}</dd>
            <dt>Koordinater</dt><dd>{f.coords ? `${f.coords.lat.toFixed(4)}, ${f.coords.lng.toFixed(4)} (${f.coords.source === 'ca' ? 'ca.' : f.coords.source})` : <span class="lowc">mangler</span>}</dd>
            <dt>Gnr./bnr.</dt><dd>{f.gnr ?? '–'} / {f.bnr ?? '–'}</dd>
            <dt>Org.nr.</dt><dd>{f.orgNr ?? '–'}</dd>
            <dt>Type kontroll</dt><dd>{f.controlType ?? '–'}</dd>
            <dt>Gass</dt><dd>{f.gasType ?? '–'}</dd>
            <dt>Anlegg</dt><dd>{[f.facilityType, f.objectType].filter(Boolean).join(' · ') || '–'}</dd>
            <dt>Omfang</dt><dd>{f.scope ?? '–'}</dd>
            <dt>Beskrivelse</dt><dd>{f.description ?? '–'}</dd>
            <dt>Tank</dt><dd>{f.tank ? `${f.tank.number ?? '–'} · ${f.tank.volume ?? '–'} · tatt i bruk ${f.tank.inServiceYear ?? '–'}` : '–'}</dd>
            <dt>Rekvalifisering</dt>
            <dd>{requal ? <>{requal} <span class="muted">(anbefalt, vanligvis ved 18 år)</span>{requal - thisYear <= 2 && <span class="pill orange" style={{ marginLeft: 6 }}>{requal <= thisYear ? 'Passert' : `Om ${requal - thisYear} år`}</span>}</> : '–'}</dd>
            <dt>Servicepartner</dt><dd>{f.servicePartner ?? '–'}</dd>
            <dt>Kontrolltid</dt>
            <dd>
              <select class="sel" style={{ minHeight: 36, padding: '4px 30px 4px 10px', width: 'auto' }} value={String(f.durationMin ?? '')} onChange={(e) => update((s) => { const x = s.facilities.find((y) => y.id === f.id)!; x.durationMin = e.currentTarget.value ? Number(e.currentTarget.value) : null; })}>
                <option value="">Standard ({state.settings.controlMin} min)</option>
                {[60, 75, 90, 120, 150, 180].map((m) => <option value={String(m)}>{m} min</option>)}
              </select>
            </dd>
            <dt>Kildefil</dt><dd>{f.sourceFile ?? '–'}</dd>
          </dl>
          {(low.length > 0 || f.flags.length > 0) && (
            <div class="note amber mt12">
              {low.length > 0 && <div>Lav sikkerhet: {low.join(', ')}</div>}
              {f.flags.map((x) => <div>⚑ {x}</div>)}
              <div className="mt8"><button class="btn small" onClick={() => nav.push({ kind: 'review', id: f.id })}>Gå gjennom</button></div>
            </div>
          )}
          <div class="btnrow mt12">
            <button class="btn small" onClick={() => nav.tab('kart', { facilityId: f.id })}>Plasser pinnen på kartet</button>
            {f.coords && <a class="btn small" href={appleStopUrl(f.coords, f.customer)} target="_blank" rel="noopener">Apple Kart</a>}
          </div>
        </div>
      </Section>

      <Section title="Blokkerte perioder">
        <div class="card pad">
          {f.blockedPeriods.length === 0 && <div class="muted small">Ingen. Legg inn perioder kunden ikke kan ta imot besøk.</div>}
          {f.blockedPeriods.map((p, i) => (
            <div class="toggle">
              <span>{fmtDate(p.from)}–{fmtDate(p.to)} {p.reason && <span class="muted">· {p.reason}</span>}</span>
              <button class="btn small ghost" onClick={() => update((s) => { s.facilities.find((y) => y.id === f.id)!.blockedPeriods.splice(i, 1); })}>Fjern</button>
            </div>
          ))}
          <div class="grid2 mt8">
            <input class="inp" type="date" value={bp.from} onInput={(e) => setBp({ ...bp, from: e.currentTarget.value })} aria-label="Fra" />
            <input class="inp" type="date" value={bp.to} onInput={(e) => setBp({ ...bp, to: e.currentTarget.value })} aria-label="Til" />
          </div>
          <div class="btnrow mt8">
            <input class="inp" style={{ flex: 1 }} placeholder="Årsak (valgfritt)" value={bp.reason} onInput={(e) => setBp({ ...bp, reason: e.currentTarget.value })} />
            <button class="btn" disabled={!bp.from || !bp.to || bp.to < bp.from} onClick={() => { update((s) => { const x = s.facilities.find((y) => y.id === f.id)!; x.blockedPeriods.push({ ...bp }); x.log.push({ at: nowStamp(today), text: `Blokkert periode ${fmtDate(bp.from)}–${fmtDate(bp.to)}` }); }); setBp({ from: '', to: '', reason: '' }); }}>Legg til</button>
          </div>
        </div>
      </Section>

      <Section title="Historikk">
        <div class="card pad small">
          {past.map((p) => <div>Utført {fmtDate(p.completedAt)} (frist {fmtQuarter(p.due)})</div>)}
          {f.history.map((h) => (
            <div class="mt8">
              Rapport {fmtDate(h.reportDate)} · kontroll {fmtDate(h.lastControl)} · frist {h.nextDue ? fmtQuarter(h.nextDue) : '–'}
              <div class="muted tiny">{h.sourceFile ?? ''} {h.note ? `· ${h.note}` : ''}</div>
            </div>
          ))}
          {!past.length && !f.history.length && <div class="muted">Ingen tidligere rapporter i appen.</div>}
        </div>
      </Section>

      <Section title="Logg">
        <div class="card pad loglist">
          {[...f.log].reverse().map((l) => <div><span>{fmtStamp(l.at)}</span><span>{l.text}</span></div>)}
        </div>
      </Section>
      {c && <ControlLogNote c={c} />}
    </div>
  );
}

function ControlLogNote({ c }: { c: Control }) {
  return <div class="muted tiny mt12">Kontroll {c.id} · status {STATUS_LABEL[c.status]} · {c.notices.length} varsler</div>;
}

export { facilityOf, logBoth };
