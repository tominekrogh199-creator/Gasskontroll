import { useState } from 'preact/hooks';
import { useAppState } from '../store';
import { Dot, Empty, FlagPills, Icon, NavBar, Row, useNav } from './components';
import type { Control, ControlStatus } from '../domain/types';
import { STATUS_LABEL } from '../domain/types';
import { currentControl, facilityOf, missingInfo, nextStep, todayOf } from '../domain/controls';
import { addQuarters, fmtQ, isOverdue, quarterOf } from '../domain/dates';
import { areaCounts, areaName, driveMinOf, urgencySort } from '../domain/selectors';

export function ControlRow({ c }: { c: Control }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const f = facilityOf(state, c);
  const drive = driveMinOf(state, f.id);
  return (
    <Row
      left={<Dot c={c} f={f} today={today} />}
      title={f.customer || '(uten navn)'}
      sub={
        <>
          {f.address.place} · {STATUS_LABEL[c.status]} · {nextStep(state, c, today)}
        </>
      }
      right={
        <div>
          <div>{isOverdue(c.due, today) && c.status !== 'utfort' ? <span class="pill solid-red">Forfalt</span> : fmtQ(c.due)}</div>
          {drive !== null && <div class="tiny">ca. {drive} min</div>}
        </div>
      }
      onClick={() => nav.push({ kind: 'facility', id: f.id })}
    />
  );
}

export function ControlList({ title, ids, subtitle }: { title: string; ids: string[]; subtitle?: string }) {
  const state = useAppState();
  const list = urgencySort(state, ids.map((id) => state.controls.find((c) => c.id === id)).filter((c): c is Control => !!c));
  return (
    <div class="screen">
      <NavBar title={title} />
      {subtitle && <div class="subtitle">{subtitle}</div>}
      <div class="list">
        {list.length ? list.map((c) => <ControlRow c={c} />) : <Empty title="Ingen anlegg her">Listen fylles når frister nærmer seg.</Empty>}
      </div>
    </div>
  );
}

type StatusFilter = 'alle' | ControlStatus | 'forfalt' | 'mangler';

export function Facilities() {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const q0 = quarterOf(today);
  const [query, setQuery] = useState('');
  const [quarter, setQuarter] = useState('alle');
  const [year, setYear] = useState('alle');
  const [area, setArea] = useState('alle');
  const [status, setStatus] = useState<StatusFilter>('alle');
  const [drive, setDrive] = useState('alle');

  const controls = state.facilities
    .map((f) => currentControl(state, f.id))
    .filter((c): c is Control => !!c);

  const filtered = controls.filter((c) => {
    const f = facilityOf(state, c);
    if (query) {
      const hay = `${f.customer} ${f.objectId} ${f.address.street} ${f.address.postcode} ${f.address.place} ${f.contacts.map((x) => x.name).join(' ')}`.toLowerCase();
      if (!hay.includes(query.toLowerCase())) return false;
    }
    if (quarter !== 'alle' && String(c.due.q) !== quarter) return false;
    if (year !== 'alle' && String(c.due.year) !== year) return false;
    if (area !== 'alle' && areaName(state, f.id) !== area) return false;
    if (status === 'forfalt' && !(isOverdue(c.due, today) && c.status !== 'utfort')) return false;
    if (status === 'mangler' && !missingInfo(f).length) return false;
    if (status !== 'alle' && status !== 'forfalt' && status !== 'mangler' && c.status !== status) return false;
    if (drive !== 'alle') {
      const d = driveMinOf(state, f.id);
      if (d === null) return false;
      if (drive === 'utenfor') { if (d <= state.settings.maxDriveMin) return false; }
      else if (d > Number(drive)) return false;
    }
    return true;
  });
  const sorted = urgencySort(state, filtered);
  const areas = areaCounts(state, filtered);
  const allAreas = [...new Set(state.facilities.map((f) => areaName(state, f.id)))].sort();
  const years = [...new Set(controls.map((c) => c.due.year))].sort();

  return (
    <div class="screen">
      <div class="topbar">
        <h1>Anlegg</h1>
        <button class="iconbtn" onClick={() => nav.push({ kind: 'import' })} aria-label="Importer eller registrer"><Icon.plus /></button>
      </div>
      <div class="search">
        <Icon.search />
        <input class="inp" type="search" placeholder="Søk kunde, adresse, Objekt ID" value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
      </div>
      <div class="chips mt8">
        {(['alle', 'forfalt', 'ikke_planlagt', 'planlagt', 'varslet', 'bekreftet', 'utsatt', 'utfort', 'mangler'] as StatusFilter[]).map((s) => (
          <button class={`chip${status === s ? ' on' : ''}`} onClick={() => setStatus(s)}>
            {s === 'alle' ? 'Alle' : s === 'forfalt' ? 'Forfalt' : s === 'mangler' ? 'Mangler info' : STATUS_LABEL[s as ControlStatus]}
          </button>
        ))}
      </div>
      <div class="grid2 mt8">
        <select class="sel" value={quarter} onChange={(e) => setQuarter(e.currentTarget.value)} aria-label="Kvartal">
          <option value="alle">Alle kvartal</option>
          {[1, 2, 3, 4].map((q) => <option value={String(q)}>{q}. kvartal</option>)}
        </select>
        <select class="sel" value={year} onChange={(e) => setYear(e.currentTarget.value)} aria-label="År">
          <option value="alle">Alle år</option>
          {years.map((y) => <option value={String(y)}>{y}</option>)}
        </select>
        <select class="sel" value={area} onChange={(e) => setArea(e.currentTarget.value)} aria-label="Område">
          <option value="alle">Alle områder</option>
          {allAreas.map((a) => <option value={a}>{a}</option>)}
        </select>
        <select class="sel" value={drive} onChange={(e) => setDrive(e.currentTarget.value)} aria-label="Kjøretid">
          <option value="alle">All kjøretid</option>
          {[30, 60, 90, 120].map((m) => <option value={String(m)}>Inntil ca. {m} min</option>)}
          <option value="utenfor">Utenfor radius ({state.settings.maxDriveMin} min)</option>
        </select>
      </div>
      <div class="chips mt8" aria-label="Antall per område">
        {areas.map((a) => (
          <button class={`chip${area === a.area ? ' on' : ''}`} onClick={() => setArea(area === a.area ? 'alle' : a.area)}>
            {a.area}: <b>{a.count}</b>
          </button>
        ))}
      </div>
      <div class="muted small" style={{ margin: '4px 2px 8px' }}>
        {sorted.length} av {controls.length} anlegg · {fmtQ(q0)} nå, {fmtQ(addQuarters(q0, 1))} neste
      </div>
      <div class="list">
        {sorted.length ? sorted.map((c) => <ControlRow c={c} />) : <Empty title="Ingen treff">Endre søket eller filtrene, eller legg til anlegg med +.</Empty>}
      </div>
    </div>
  );
}

export { FlagPills };
