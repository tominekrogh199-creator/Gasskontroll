import { useState } from 'preact/hooks';
import { update, useAppState } from '../store';
import { Empty, Field, NavBar, useNav } from './components';
import type { Facility, Quarter } from '../domain/types';
import { FIELD_LABEL } from '../domain/reportParser';
import { fmtDate, nowStamp, parseNorDate } from '../domain/dates';
import { recipient, todayOf } from '../domain/controls';
import { ensureControl } from '../domain/importer';
import { geocode } from '../adapters/geocode';

interface Draft {
  objectId: string; customer: string; street: string; postcode: string; place: string; email: string; phone: string;
  dueQ: string; dueYear: string; lastControl: string; reportDate: string; servicePartner: string; tankYear: string;
}

function toDraft(f: Facility): Draft {
  const r = recipient(f);
  return {
    objectId: f.objectId, customer: f.customer, street: f.address.street, postcode: f.address.postcode, place: f.address.place,
    email: r?.contact.email ?? '', phone: f.contacts.find((c) => c.phone)?.phone ?? '',
    dueQ: f.nextDue ? String(f.nextDue.q) : '', dueYear: f.nextDue ? String(f.nextDue.year) : '',
    lastControl: f.lastControl ? fmtDate(f.lastControl) : '', reportDate: f.reportDate ? fmtDate(f.reportDate) : '',
    servicePartner: f.servicePartner ?? '', tankYear: f.tank?.inServiceYear ? String(f.tank.inServiceYear) : '',
  };
}

const KEYMAP: Record<keyof Draft, string[]> = {
  objectId: ['objectId'], customer: ['customer'], street: ['street', 'coords'], postcode: ['postcode', 'coords'], place: ['place'],
  email: ['email'], phone: ['phone'], dueQ: ['nextDueQ'], dueYear: ['nextDueYear'], lastControl: ['controlDate'], reportDate: ['reportDate'],
  servicePartner: ['servicePartner'], tankYear: ['tankInServiceYear'],
};
const LABELS: Record<keyof Draft, string> = {
  objectId: 'Objekt ID', customer: 'Kunde', street: 'Gateadresse', postcode: 'Postnr.', place: 'Sted', email: 'E-post (mottaker)', phone: 'Telefon',
  dueQ: 'Neste frist – kvartal', dueYear: 'Neste frist – år', lastControl: 'Siste kontroll (dd.mm.åååå)', reportDate: 'Rapportdato (dd.mm.åååå)',
  servicePartner: 'Servicepartner', tankYear: 'Tank tatt i bruk (år)',
};

/** Gjennomgang: ett anlegg om gangen, felt med lav sikkerhet eller flagg, utdraget fra rapporten ved siden av. */
export function Review({ startId }: { startId?: string }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const queue = state.facilities.filter((f) => f.reviewPending || f.id === startId);
  const [skipped, setSkipped] = useState<string[]>([]);
  const ordered = [...queue.filter((f) => f.id === startId), ...queue.filter((f) => f.id !== startId)].filter((f) => !skipped.includes(f.id));
  const f = ordered[0];
  const [draftFor, setDraftFor] = useState<string | null>(null);
  const [d, setD] = useState<Draft | null>(null);
  if (f && draftFor !== f.id) { setDraftFor(f.id); setD(toDraft(f)); }

  if (!f || !d) return (
    <div class="screen"><NavBar title="Gjennomgang" /><div class="list"><Empty title="Ingenting å gå gjennom">Alle importerte felt er godkjent{skipped.length ? `, ${skipped.length} hoppet over` : ''}.</Empty></div>
      {skipped.length > 0 && <button class="btn block mt12" onClick={() => setSkipped([])}>Gå gjennom de du hoppet over</button>}
    </div>
  );

  const lowKeys = new Set(Object.entries(f.confidence).filter(([, v]) => v === 'lav').map(([k]) => k));
  const isLow = (k: keyof Draft) => KEYMAP[k].some((x) => lowKeys.has(x));
  const fields = (Object.keys(LABELS) as (keyof Draft)[]);
  const lowLabels = [...lowKeys].map((k) => (FIELD_LABEL as any)[k] ?? (k === 'coords' ? 'Koordinater' : k === 'documents' ? 'Dokumentdatoer' : k));
  const excerpt = f.excerpt ?? '';
  const marks = [d.objectId, d.street, d.postcode, d.email, ...f.flags.flatMap((x) => x.match(/\d{2}\.\d{2}\.\d{4}/g) ?? [])].filter((x) => x && x.length > 2);
  const highlighted = marks.length ? excerpt.split(new RegExp(`(${marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')) : [excerpt];

  const approveAs = (edited: boolean) => {
    const dueQ = Number(d.dueQ);
    const dueY = Number(d.dueYear);
    const due: Quarter | null = dueQ >= 1 && dueQ <= 4 && dueY > 2000 ? { q: dueQ as Quarter['q'], year: dueY } : null;
    update((s) => {
      const x = s.facilities.find((y) => y.id === f.id)!;
      if (edited) {
        const addrChanged = x.address.street !== d.street || x.address.postcode !== d.postcode || x.address.place !== d.place;
        x.objectId = d.objectId; x.customer = d.customer;
        x.address = { street: d.street, postcode: d.postcode, place: d.place };
        if (addrChanged && x.coords?.source !== 'manuell') x.coords = geocode(x.address).coords;
        const r = x.contacts.find((c) => c.email) ?? x.contacts[0];
        if (r) { r.email = d.email || null; if (d.phone) r.phone = d.phone; }
        else x.contacts.push({ name: d.customer, role: 'representant', email: d.email || null, phone: d.phone || null });
        x.nextDue = due;
        x.lastControl = parseNorDate(d.lastControl) ?? x.lastControl;
        x.reportDate = parseNorDate(d.reportDate) ?? x.reportDate;
        x.servicePartner = d.servicePartner || null;
        if (d.tankYear) x.tank = { ...(x.tank ?? { number: null, volume: null, inServiceYear: null }), inServiceYear: Number(d.tankYear) };
        x.log.push({ at: nowStamp(today), text: 'Rettet i gjennomgang' });
      } else {
        x.log.push({ at: nowStamp(today), text: `Godkjent i gjennomgang${x.flags.length ? ` (flagg beholdt i logg: ${x.flags.join('; ')})` : ''}` });
      }
      for (const k of Object.keys(x.confidence)) if (x.confidence[k] === 'lav' && (k !== 'coords' || x.coords)) x.confidence[k] = 'høy';
      if (x.flags.length) x.log.push({ at: nowStamp(today), text: `Flagg vurdert: ${x.flags.join('; ')}` });
      x.flags = [...(x.coords ? [] : ['Fant ikke koordinater – plasser pinnen manuelt']), ...(x.nextDue ? [] : ['Mangler frist – fyll inn kvartal og år og trykk «Rett»'])];
      x.reviewPending = x.flags.length > 0;
      ensureControl(s, x);
    });
    nav.toast(edited ? 'Rettet og godkjent' : 'Godkjent');
  };

  return (
    <div class="screen">
      <NavBar title={`Gjennomgang · ${ordered.length} igjen`} />
      <div style={{ fontWeight: 700, fontSize: 20 }}>{f.customer || '(uten navn)'} <span class="muted small">· {f.objectId}</span></div>
      <div class="muted small">{f.sourceFile}</div>
      {(f.flags.length > 0 || lowLabels.length > 0) && (
        <div class="note warn mt8">
          {f.flags.map((x) => <div>⚑ {x}</div>)}
          {lowLabels.length > 0 && <div>Lav sikkerhet: {lowLabels.join(', ')}</div>}
        </div>
      )}
      <div class="review-grid mt12">
        <div class="card pad">
          {fields.map((k) => (
            <Field label={LABELS[k]} low={isLow(k)}>
              <input class="inp" value={d[k]} onInput={(e) => setD({ ...d, [k]: e.currentTarget.value })} />
            </Field>
          ))}
          {!f.coords && <button class="btn small" onClick={() => nav.tab('kart', { facilityId: f.id })}>Plasser pinnen på kartet</button>}
        </div>
        <div class="excerpt-col">
          <div class="muted small" style={{ marginBottom: 4 }}>Utdrag fra rapporten</div>
          <div class="excerpt">{excerpt ? highlighted.map((p) => (marks.includes(p) ? <mark>{p}</mark> : p)) : 'Ingen rapporttekst lagret for dette anlegget.'}</div>
        </div>
      </div>
      <div class="btnrow mt16">
        <button class="btn primary" style={{ flex: 1 }} onClick={() => approveAs(false)}>Godkjenn</button>
        <button class="btn" style={{ flex: 1 }} onClick={() => approveAs(true)}>Rett</button>
        <button class="btn ghost" onClick={() => setSkipped([...skipped, f.id])}>Hopp over</button>
      </div>
      <div class="muted tiny mt8">«Rett» lagrer feltene slik de står over. «Godkjenn» beholder verdiene fra importen.</div>
    </div>
  );
}
