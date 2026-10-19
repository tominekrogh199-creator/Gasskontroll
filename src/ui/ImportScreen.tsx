import { useRef, useState } from 'preact/hooks';
import { getState, update, useAppState } from '../store';
import { Field, Icon, NavBar, Section, Seg, useNav } from './components';
import type { Facility, Quarter } from '../domain/types';
import { EXAMPLE_REPORT, CSV_TARGETS, blankFacility, facilityFromReport, facilityFromRow, guessMapping, importFacility, parseCSV } from '../domain/importer';
import { extractReport } from '../adapters/extractReport';
import { newControl, recipient, todayOf } from '../domain/controls';
import { addQuarters, fmtDate, fmtQuarter, parseNorDate, quarterOf } from '../domain/dates';
import { tankRequalYear } from '../domain/selectors';
import { geocode } from '../adapters/geocode';
import { mergeIntoOneVisit, sameAddressOf, sameAddressPairs } from '../domain/merge';

interface Job { name: string; status: 'venter' | 'leser' | 'ferdig' | 'feil'; msg: string; facilityId?: string; review?: boolean }

export function ImportScreen() {
  const [mode, setMode] = useState<'pdf' | 'csv' | 'manuell'>('pdf');
  return (
    <div class="screen">
      <NavBar title="Last opp" />
      <Seg value={mode} options={[['pdf', 'PDF-rapporter'], ['csv', 'CSV'], ['manuell', 'Manuelt']]} onChange={setMode} />
      {mode === 'pdf' && <PdfImport />}
      {mode === 'csv' && <CsvImport />}
      {mode === 'manuell' && <ManualForm />}
    </div>
  );
}

function PdfImport() {
  const state = useAppState();
  const nav = useNav();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [trial, setTrial] = useState<Facility | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const today = todayOf(state.settings);

  const tryImport = async () => {
    const out = await extractReport(EXAMPLE_REPORT, getState().settings);
    const f = facilityFromReport(out.parsed, 'eksempelrapport (Prøv import)', today);
    const r = update((s) => importFacility(s, f));
    setTrial(getState().facilities.find((x) => x.id === r.facility.id) ?? f);
    const twin = sameAddressOf(getState(), getState().facilities.find((x) => x.id === r.facility.id) ?? f);
    nav.toast((out.aiError ? `AI feilet (${out.aiError}) – brukte regelbasert uttrekk` : r.message) + (twin ? ` Samme adresse som ${twin.customer}.` : ''));
  };

  const run = async (files: File[]) => {
    setBusy(true);
    const list: Job[] = files.map((f) => ({ name: f.name, status: 'venter', msg: '' }));
    setJobs([...list]);
    const { pdfToText } = await import('../adapters/pdfText');
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        list[i] = { ...list[i], status: 'leser' };
        setJobs([...list]);
        try {
          const text = await pdfToText(files[i]);
          if (!text.trim()) throw new Error('Fant ingen tekst (skannet PDF?)');
          const out = await extractReport(text, getState().settings);
          const f = facilityFromReport(out.parsed, files[i].name, today);
          const r = update((s) => importFacility(s, f));
          const twin = sameAddressOf(getState(), getState().facilities.find((x) => x.id === r.facility.id) ?? r.facility);
          list[i] = { ...list[i], status: 'ferdig', msg: r.message + (twin ? ` · samme adresse som ${twin.customer}` : '') + (out.aiError ? ` · AI feilet: ${out.aiError}` : out.usedAI ? ' · AI' : ''), facilityId: r.facility.id, review: f.reviewPending };
        } catch (e: any) {
          list[i] = { ...list[i], status: 'feil', msg: e?.message ?? String(e) };
        }
        setJobs([...list]);
      }
    };
    await Promise.all([worker(), worker(), worker()]); // 3 filer parallelt, fortsetter ved feil
    setBusy(false);
  };

  const done = jobs.filter((j) => j.status === 'ferdig' || j.status === 'feil').length;
  const reviews = jobs.filter((j) => j.review).length;

  return (
    <>
      <div class="card pad mt12">
        <div style={{ fontWeight: 600 }}>Prøv import</div>
        <div class="muted small">Kjører eksempelrapporten gjennom samme kode som ekte PDF-er, så du kan teste uten ekte data.</div>
        <button class="btn primary mt12" onClick={tryImport}>Prøv import</button>
        {trial && <TrialResult f={trial} />}
      </div>

      <Section title="PDF-rapporter">
        <div class="card pad">
          <div class="muted small">Velg 150–200 rapporter på en gang. Teksten hentes lokalt med pdf.js (side 1–2 og merknadene). {state.settings.apiKey ? 'Utdraget sendes til AI for uttrekk.' : 'Ingen AI-nøkkel er lagt inn: regelbasert uttrekk og gjennomgang brukes.'}</div>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple style={{ display: 'none' }} onChange={(e) => { const fs = [...(e.currentTarget.files ?? [])]; if (fs.length) run(fs); e.currentTarget.value = ''; }} />
          <button class="btn mt12" disabled={busy} onClick={() => input.current?.click()}><Icon.upload />Velg PDF-er</button>
          {jobs.length > 0 && (
            <div class="mt12">
              <div class="small" style={{ fontWeight: 600 }}>{done} av {jobs.length}{busy ? ' …' : ' ferdig'}{reviews ? ` · ${reviews} til gjennomgang` : ''}</div>
              <div class="progress mt8"><div style={{ width: `${(done / jobs.length) * 100}%` }} /></div>
              <div class="mt8" style={{ maxHeight: 280, overflowY: 'auto' }}>
                {jobs.map((j) => (
                  <div class="small" style={{ padding: '6px 0', borderTop: '1px solid var(--line)', display: 'flex', gap: 8 }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.name}</span>
                    <span class={j.status === 'feil' ? '' : 'muted'} style={j.status === 'feil' ? { color: 'var(--red)' } : {}}>{j.status === 'ferdig' ? (j.review ? 'Gjennomgang' : 'OK') : j.status === 'feil' ? `Feil: ${j.msg}` : j.status}</span>
                  </div>
                ))}
              </div>
              {!busy && reviews > 0 && <button class="btn primary mt12" onClick={() => nav.push({ kind: 'review' })}>Gå til gjennomgang</button>}
            </div>
          )}
        </div>
      </Section>
    </>
  );
}

function TrialResult({ f }: { f: Facility }) {
  const state = useAppState();
  const nav = useNav();
  const live = state.facilities.find((x) => x.id === f.id) ?? f;
  const twin = sameAddressOf(state, live);
  const r = recipient(live);
  return (
    <div class="mt12">
      <dl class="kv small">
        <dt>Objekt ID</dt><dd>{live.objectId}</dd>
        <dt>Neste frist</dt><dd>{fmtQuarter(live.nextDue)}</dd>
        <dt>Adresse</dt><dd>{live.address.street}, {live.address.postcode} {live.address.place}</dd>
        <dt>Gnr./bnr.</dt><dd>{live.gnr} / {live.bnr}</dd>
        <dt>Mottaker</dt><dd>{r ? `${r.contact.email} (${r.reason})` : '–'}</dd>
        <dt>Siste kontroll</dt><dd>{fmtDate(live.lastControl)}</dd>
        <dt>Rekvalifisering</dt><dd>{tankRequalYear(live.tank?.inServiceYear) ?? '–'} <span class="muted">(anbefalt, vanligvis ved 18 år)</span></dd>
        <dt>Servicepartner</dt><dd>{live.servicePartner ?? '–'}</dd>
        <dt>Avvik</dt><dd>{live.deviations.filter((d) => d.severity === 'avvik').length} åpne, {live.deviations.filter((d) => d.severity === 'anbefaling').length} anbefalinger</dd>
      </dl>
      {live.flags.length > 0 && <div class="note warn">{live.flags.map((x) => <div>⚑ {x}</div>)}</div>}
      {twin && <button class="btn block mt8" onClick={() => { update((s) => mergeIntoOneVisit(s, live.id, twin.id)); nav.toast(`Slått sammen med ${twin.customer} til ett besøk`); }}>Slå sammen med {twin.customer}</button>}
      <div class="btnrow mt8">
        <button class="btn small" onClick={() => nav.push({ kind: 'review', id: live.id })}>Gjennomgang</button>
        <button class="btn small" onClick={() => nav.push({ kind: 'facility', id: live.id })}>Anleggskort</button>
      </div>
    </div>
  );
}

function CsvImport() {
  const state = useAppState();
  const nav = useNav();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [name, setName] = useState('');
  const [map, setMap] = useState<Record<string, number>>({});
  const [done, setDone] = useState<string | null>(null);
  const today = todayOf(state.settings);
  const header = rows?.[0] ?? [];
  return (
    <>
      <div class="card pad mt12">
        <div class="muted small">CSV med én rad per anlegg. Semikolon eller komma. Første rad er kolonnenavn.</div>
        <input class="mt12" type="file" accept=".csv,text/csv" onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          if (!file) return;
          const r = parseCSV(await file.text());
          setRows(r); setName(file.name); setMap(guessMapping(r[0] ?? [])); setDone(null);
        }} />
      </div>
      {rows && (
        <Section title={`Kolonnekobling · ${rows.length - 1} rader`}>
          <div class="card pad">
            {CSV_TARGETS.map((t) => (
              <Field label={t.label}>
                <select class="sel" value={map[t.key] !== undefined ? String(map[t.key]) : ''} onChange={(e) => { const v = e.currentTarget.value; const m = { ...map }; if (v === '') delete m[t.key]; else m[t.key] = Number(v); setMap(m); }}>
                  <option value="">– ikke i filen –</option>
                  {header.map((h, i) => <option value={String(i)}>{h || `Kolonne ${i + 1}`}{rows[1]?.[i] ? ` (f.eks. ${rows[1][i].slice(0, 24)})` : ''}</option>)}
                </select>
              </Field>
            ))}
            <button class="btn primary block" disabled={map.objectId === undefined || map.nextDue === undefined} onClick={() => {
              let n = 0, rev = 0;
              update((s) => {
                for (const row of rows.slice(1)) {
                  const f = facilityFromRow(row, map, today, name);
                  importFacility(s, f); n++; if (f.reviewPending) rev++;
                }
              });
              const pairs = sameAddressPairs(getState()).length;
              setDone(`${n} anlegg lastet opp, ${rev} til gjennomgang.${pairs ? ` ${pairs} par har samme adresse – slå dem sammen under Kunder.` : ''}`);
            }}>Last opp</button>
            {(map.objectId === undefined || map.nextDue === undefined) && <div class="muted small mt8">Objekt ID og neste frist må kobles.</div>}
            {done && <div class="note mt8">{done} <button class="btn small" onClick={() => nav.push({ kind: 'review' })}>Gjennomgang</button></div>}
          </div>
        </Section>
      )}
    </>
  );
}

function ManualForm() {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const q0 = quarterOf(today);
  const [v, setV] = useState({ objectId: '', customer: '', street: '', postcode: '', place: '', contact: '', email: '', phone: '', due: `${addQuarters(q0, 1).year}-${addQuarters(q0, 1).q}`, last: '', service: '', tank: '', notes: '' });
  const set = (k: keyof typeof v) => (e: any) => setV({ ...v, [k]: e.currentTarget.value });
  const exists = state.facilities.some((f) => f.objectId === v.objectId.trim());
  const save = () => {
    const [y, q] = v.due.split('-').map(Number);
    const due: Quarter = { year: y, q: q as Quarter['q'] };
    const f = blankFacility(today);
    f.objectId = v.objectId.trim();
    f.customer = v.customer.trim();
    f.address = { street: v.street.trim(), postcode: v.postcode.trim(), place: v.place.trim() };
    const geo = geocode(f.address);
    f.coords = geo.coords;
    f.confidence = { coords: geo.coords ? geo.confidence : 'lav' };
    if (!f.coords) { f.flags.push('Fant ikke koordinater – plasser pinnen manuelt'); f.reviewPending = true; }
    f.contacts = [{ name: v.contact || v.customer, role: 'representant', email: v.email || null, phone: v.phone || null }];
    f.nextDue = due;
    f.lastControl = parseNorDate(v.last);
    f.servicePartner = v.service || null;
    f.tank = v.tank ? { number: null, volume: null, inServiceYear: Number(v.tank) } : null;
    f.notes = v.notes;
    update((s) => { s.facilities.push(f); s.controls.push(newControl(f.id, due)); });
    nav.toast('Anlegget er registrert');
    nav.pop();
    nav.push({ kind: 'facility', id: f.id });
  };
  const quarters = Array.from({ length: 24 }, (_, i) => addQuarters(q0, i - 4));
  return (
    <div class="card pad mt12">
      <Field label="Objekt ID" low={exists}><input class="inp" value={v.objectId} onInput={set('objectId')} inputMode="numeric" /></Field>
      {exists && <div class="note warn">Objekt ID finnes allerede.</div>}
      <Field label="Kunde"><input class="inp" value={v.customer} onInput={set('customer')} /></Field>
      <Field label="Gateadresse"><input class="inp" value={v.street} onInput={set('street')} /></Field>
      <div class="grid2">
        <Field label="Postnr."><input class="inp" value={v.postcode} onInput={set('postcode')} inputMode="numeric" /></Field>
        <Field label="Sted"><input class="inp" value={v.place} onInput={set('place')} /></Field>
      </div>
      <Field label="Kontaktperson (representant)"><input class="inp" value={v.contact} onInput={set('contact')} /></Field>
      <div class="grid2">
        <Field label="E-post"><input class="inp" type="email" value={v.email} onInput={set('email')} /></Field>
        <Field label="Telefon"><input class="inp" type="tel" value={v.phone} onInput={set('phone')} /></Field>
      </div>
      <div class="grid2">
        <Field label="Neste frist">
          <select class="sel" value={v.due} onChange={set('due')}>{quarters.map((q) => <option value={`${q.year}-${q.q}`}>{fmtQuarter(q)}</option>)}</select>
        </Field>
        <Field label="Siste kontroll (dd.mm.åååå)"><input class="inp" value={v.last} onInput={set('last')} placeholder="27.02.2025" /></Field>
      </div>
      <div class="grid2">
        <Field label="Servicepartner"><input class="inp" value={v.service} onInput={set('service')} /></Field>
        <Field label="Tank tatt i bruk (år)"><input class="inp" value={v.tank} onInput={set('tank')} inputMode="numeric" /></Field>
      </div>
      <Field label="Notater"><input class="inp" value={v.notes} onInput={set('notes')} placeholder="Portkode, hund …" /></Field>
      <button class="btn primary block" disabled={!v.objectId.trim() || !v.customer.trim() || exists || (!!v.last && !parseNorDate(v.last))} onClick={save}>Registrer anlegg</button>
    </div>
  );
}
