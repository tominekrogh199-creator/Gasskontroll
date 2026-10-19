import { useEffect, useState } from 'preact/hooks';
import { getState, isPersisted, replaceState, resetDemo, update, useAppState } from '../store';
import { Field, NavBar, Section, useNav } from './components';
import type { AppState, Settings, Templates } from '../domain/types';
import { PLACES } from '../domain/geo';
import { MERGE_FIELDS, DEFAULT_TEMPLATES } from '../domain/notices';
import { deviceToday, firstWorkdayOfQuarter, fmtDate, fmtQuarter, holidayName, addQuarters, quarterOf } from '../domain/dates';
import { currentControl, recipient, todayOf } from '../domain/controls';
import { areaName, driveMinOf } from '../domain/selectors';
import { readTheme, writeTheme } from './theme';
import { STATUS_LABEL } from '../domain/types';

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function toCSV(s: AppState): string {
  const head = ['Objekt ID', 'Kunde', 'Adresse', 'Postnr.', 'Sted', 'Område', 'Kjøretid ca. min', 'Kontakt', 'E-post', 'Telefon', 'Neste frist', 'Status', 'Planlagt', 'Siste kontroll', 'Servicepartner', 'Tank tatt i bruk', 'Flagg'];
  const esc = (v: unknown) => { const t = v == null ? '' : String(v); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const rows = s.facilities.map((f) => {
    const c = currentControl(s, f.id);
    const r = recipient(f);
    return [f.objectId, f.customer, f.address.street, f.address.postcode, f.address.place, areaName(s, f.id), driveMinOf(s, f.id) ?? '', r?.contact.name ?? f.contacts[0]?.name ?? '', r?.contact.email ?? '', f.contacts.find((x) => x.phone)?.phone ?? '', f.nextDue ? fmtQuarter(f.nextDue) : '', c ? STATUS_LABEL[c.status] : '', c?.plannedDate ? fmtDate(c.plannedDate) : '', fmtDate(f.lastControl), f.servicePartner ?? '', f.tank?.inServiceYear ?? '', f.flags.join(' | ')].map(esc).join(';');
  });
  return '﻿' + [head.join(';'), ...rows].join('\n');
}

export function SettingsScreen() {
  const state = useAppState();
  const nav = useNav();
  const s = state.settings;
  const today = todayOf(s);
  const [blocked, setBlocked] = useState('');
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => { writeTheme(theme === 'light' || theme === 'dark' ? theme : 'auto'); }, [theme]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => update((st) => { st.settings[k] = v; });
  const num = (k: keyof Settings) => (e: any) => set(k, Number(e.currentTarget.value) as any);
  const str = (k: keyof Settings) => (e: any) => set(k, e.currentTarget.value as any);
  const tpl = (k: keyof Templates) => (e: any) => update((st) => { st.settings.templates[k] = e.currentTarget.value; });
  const nextQStart = firstWorkdayOfQuarter(addQuarters(quarterOf(today), 1));

  return (
    <div class="screen">
      <NavBar title="Innstillinger" />

      <Section title="Base og arbeidsdag">
        <div class="card pad">
          <Field label="Base">
            <select class="sel" value={s.baseName} onChange={(e) => { const p = PLACES.find((x) => x.name === e.currentTarget.value)!; update((st) => { st.settings.baseName = p.name; st.settings.baseLat = p.lat; st.settings.baseLng = p.lng; }); }}>
              {PLACES.map((p) => <option>{p.name}</option>)}
            </select>
          </Field>
          <div class="grid2">
            <Field label="Arbeidsdag fra"><input class="inp" type="time" value={s.dayStart} onChange={str('dayStart')} /></Field>
            <Field label="Arbeidsdag til"><input class="inp" type="time" value={s.dayEnd} onChange={str('dayEnd')} /></Field>
            <Field label="Lunsj (min)"><input class="inp" type="number" value={s.lunchMin} onChange={num('lunchMin')} /></Field>
            <Field label="Kontrolltid (min)"><input class="inp" type="number" value={s.controlMin} onChange={num('controlMin')} /></Field>
            <Field label="Maks kontroller per dag"><input class="inp" type="number" min={1} max={8} value={s.maxPerDay} onChange={num('maxPerDay')} /></Field>
            <Field label="Kjøreradius (minutter)"><input class="inp" type="number" min={30} value={s.maxDriveMin} onChange={(e) => update((st) => { st.settings.maxDriveMin = Number(e.currentTarget.value); st.settings.driveRadiusCustom = true; })} /></Field>
          </div>
          <div class="muted small">Standard radius er 120 minutter, to timers kjøring. Kjøretid er et anslag: luftlinje × 1,4 ÷ 70 km/t + 5 min.</div>
        </div>
      </Section>

      <Section title="Varsler">
        <div class="card pad">
          <div class="grid2">
            <Field label="Forvarsel (dager før)"><input class="inp" type="number" value={s.preNoticeDays} onChange={num('preNoticeDays')} /></Field>
            <Field label="Påminnelse (virkedager før)"><input class="inp" type="number" value={s.reminderWorkdays} onChange={num('reminderWorkdays')} /></Field>
            <Field label="Purring etter (dager)"><input class="inp" type="number" value={s.chaseDays} onChange={num('chaseDays')} /></Field>
            <Field label="Oppfølging utsettelse (dager)"><input class="inp" type="number" value={s.followUpDays} onChange={num('followUpDays')} /></Field>
          </div>
          <div class="grid2">
            <Field label="Kontrollør"><input class="inp" value={s.inspectorName} onChange={str('inspectorName')} /></Field>
            <Field label="Telefon"><input class="inp" value={s.inspectorPhone} onChange={str('inspectorPhone')} /></Field>
          </div>
        </div>
      </Section>

      <Section title="Maler">
        <div class="card pad">
          <div class="muted small" style={{ marginBottom: 8 }}>Flettefelt: {MERGE_FIELDS.join(' ')}</div>
          {([['forvarsel', 'Forvarsel'], ['forvarselKvartal', 'Forvarsel – kun kvartal'], ['paminnelse', 'Påminnelse'], ['purring', 'Purring']] as [keyof Templates, string][]).map(([k, l]) => (
            <Field label={l}><textarea class="inp" value={s.templates[k]} onChange={tpl(k)} /></Field>
          ))}
          <button class="btn small" onClick={() => update((st) => { st.settings.templates = { ...DEFAULT_TEMPLATES }; })}>Tilbakestill maler</button>
        </div>
      </Section>

      <Section title="Blokkerte dager">
        <div class="card pad">
          {s.blockedDays.length === 0 && <div class="muted small">Ingen. Helger og norske helligdager hoppes alltid over.</div>}
          {[...s.blockedDays].sort().map((d) => (
            <div class="toggle"><span>{fmtDate(d)}</span><button class="btn small ghost" onClick={() => set('blockedDays', s.blockedDays.filter((x) => x !== d))}>Fjern</button></div>
          ))}
          <div class="btnrow mt8">
            <input class="inp" style={{ flex: 1 }} type="date" value={blocked} onInput={(e) => setBlocked(e.currentTarget.value)} />
            <button class="btn" disabled={!blocked || s.blockedDays.includes(blocked)} onClick={() => { set('blockedDays', [...s.blockedDays, blocked]); setBlocked(''); }}>Legg til</button>
          </div>
          {blocked && holidayName(blocked) && <div class="muted small mt8">{holidayName(blocked)} er allerede fridag.</div>}
        </div>
      </Section>

      <Section title="Testdato for demo">
        <div class="card pad">
          <div class="muted small">«I dag» er {s.testDate ? `testdatoen ${fmtDate(s.testDate)}` : `enhetens dato ${fmtDate(deviceToday())}`}.</div>
          <div class="btnrow mt8">
            <input class="inp" style={{ flex: 1 }} type="date" value={s.testDate ?? ''} onChange={(e) => set('testDate', e.currentTarget.value || null)} />
            {s.testDate && <button class="btn" onClick={() => set('testDate', null)}>Bruk enhetens dato</button>}
          </div>
          <button class="btn small mt8" onClick={() => set('testDate', nextQStart)}>Sett til første virkedag neste kvartal ({fmtDate(nextQStart)})</button>
          <div class="muted small mt8">Demodata regnes ut fra «i dag». Etter å ha endret testdato kan du nullstille demodata under for å få et nytt utgangspunkt.</div>
        </div>
      </Section>

      <Section title="AI for rapportuttrekk">
        <div class="card pad">
          <div class="muted small">Valgfritt. Med en Anthropic API-nøkkel leser Claude utdraget fra rapporten. Nøkkelen lagres bare på denne enheten. Uten nøkkel brukes regelbasert uttrekk.</div>
          <Field label="API-nøkkel"><input class="inp" type="password" autoComplete="off" value={s.apiKey} onChange={str('apiKey')} placeholder="sk-ant-…" /></Field>
          <Field label="Modell"><input class="inp" value={s.aiModel} onChange={str('aiModel')} /></Field>
        </div>
      </Section>

      <Section title="Utseende">
        <div class="card pad">
          <select class="sel" value={theme} onChange={(e) => setTheme(e.currentTarget.value as 'auto' | 'light' | 'dark')}>
            <option value="auto">Følg systemet</option>
            <option value="light">Lys</option>
            <option value="dark">Mørk</option>
          </select>
        </div>
      </Section>

      <Section title="Data">
        <div class="card pad">
          <div class="muted small">{isPersisted() ? 'Data lagres varig i nettleseren på denne enheten.' : 'Lagring er ikke tilgjengelig – data finnes bare i minnet. Eksporter JSON for å ta vare på dem.'} {state.facilities.length} anlegg, {state.controls.length} kontroller.</div>
          <div class="btnrow mt12">
            <button class="btn" onClick={() => download(`kontrollplan_${today}.csv`, toCSV(getState()), 'text/csv;charset=utf-8')}>Eksporter CSV</button>
            <button class="btn" onClick={() => download(`kontrollplan_${today}.json`, JSON.stringify(getState(), null, 1), 'application/json')}>Eksporter JSON</button>
            <label class="btn">Importer JSON<input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (e) => {
              const file = e.currentTarget.files?.[0];
              if (!file) return;
              try {
                const data = JSON.parse(await file.text()) as AppState;
                if (!Array.isArray(data.facilities) || !Array.isArray(data.controls)) throw new Error('Feil format');
                replaceState(data);
                nav.toast('Data importert');
              } catch (err: any) { nav.toast(`Kunne ikke lese filen: ${err.message}`); }
            }} /></label>
          </div>
          <button class="btn danger block mt12" onClick={() => { if (confirm(`Nullstille alt og lage nye demodata ut fra ${fmtDate(today)}?`)) { resetDemo(today); nav.toast('Demodata er nullstilt'); } }}>Nullstill demodata</button>
        </div>
      </Section>
      <div class="muted tiny mt16">Kontrollplan · prototype. Kart uten kartfliser, kjøretider er anslag, e-post sendes via e-postappen.</div>
    </div>
  );
}
