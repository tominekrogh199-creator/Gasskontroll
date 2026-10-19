import { useEffect, useRef, useState } from 'preact/hooks';
import { update, useAppState } from '../store';
import { Icon, Seg, useNav } from './components';
import type { AppState, Control, Facility, Quarter } from '../domain/types';
import { currentControl, facilityOf, findControl, pinColor, todayOf, type PinColor } from '../domain/controls';
import { addQuarters, fmtQ, fmtShortWeekday, isOverdue, nowStamp, quarterOf, sameQuarter } from '../domain/dates';
import { PLACES, bearing } from '../domain/geo';
import { basePoint, driveFromBase, stopOf } from '../domain/planner';
import { sortedDays } from '../domain/selectors';

// ---------- Forenklet vektorkart over Sør-Norge (ingen kartfliser) ----------

const LAT_TOP = 61.3;
const LNG_LEFT = 7.5;
const KX = 100 * Math.cos((59.8 * Math.PI) / 180);
const KY = 100;
export const proj = (lat: number, lng: number) => ({ x: (lng - LNG_LEFT) * KX, y: (LAT_TOP - lat) * KY });
const unproj = (x: number, y: number) => ({ lat: LAT_TOP - y / KY, lng: LNG_LEFT + x / KX });

const COAST: [number, number][] = [
  [58.3, 6.0], [58.5, 7.6], [58.62, 8.4], [58.75, 9.05], [58.87, 9.4], [58.98, 9.62], [59.02, 9.72], [59.0, 9.88], [59.04, 10.03], [59.1, 10.2], [59.07, 10.3],
  [59.15, 10.41], [59.25, 10.44], [59.33, 10.47], [59.42, 10.5], [59.5, 10.33], [59.58, 10.24], [59.68, 10.3], [59.74, 10.23], [59.71, 10.36], [59.62, 10.42],
  [59.55, 10.5], [59.6, 10.57], [59.66, 10.6], [59.75, 10.51], [59.84, 10.46], [59.89, 10.55], [59.905, 10.73], [59.86, 10.8], [59.78, 10.74], [59.7, 10.67],
  [59.62, 10.66], [59.52, 10.68], [59.44, 10.65], [59.37, 10.69], [59.3, 10.8], [59.21, 10.9], [59.12, 10.95], [59.03, 11.03], [59.07, 11.17], [59.12, 11.35],
  [59.08, 11.24], [58.98, 11.16], [58.8, 11.2], [58.5, 11.26], [58.3, 11.3], [55, 11.3], [55, 6.0],
];
const LAKES: [number, number][][] = [
  [[59.92, 10.18], [59.98, 10.1], [60.06, 10.12], [60.1, 10.2], [60.05, 10.3], [59.97, 10.27]],
  [[60.35, 11.22], [60.55, 11.05], [60.75, 10.8], [60.9, 10.65], [61.1, 10.45], [61.12, 10.5], [60.92, 10.75], [60.8, 10.95], [60.6, 11.15], [60.4, 11.28]],
  [[60.32, 10.38], [60.5, 10.3], [60.7, 10.12], [60.72, 10.16], [60.52, 10.35], [60.35, 10.42]],
  [[59.72, 11.12], [59.82, 11.18], [59.9, 11.25], [59.88, 11.3], [59.78, 11.24], [59.7, 11.17]],
  [[59.28, 9.12], [59.33, 9.25], [59.38, 9.3], [59.36, 9.34], [59.3, 9.28], [59.26, 9.16]],
  [[59.4, 10.85], [59.44, 10.95], [59.42, 11.0], [59.38, 10.9]],
];
const BORDER: [number, number][] = [[59.1, 11.43], [59.35, 11.78], [59.6, 11.7], [59.9, 11.9], [60.15, 12.5], [60.6, 12.3], [61.3, 12.25]];
const ROADS: string[][] = [
  ['Hokksund', 'Mjøndalen', 'Drammen', 'Lier', 'Asker', 'Sandvika', 'Oslo', 'Ski', 'Spydeberg', 'Askim', 'Mysen'],
  ['Drammen', 'Holmestrand', 'Tønsberg', 'Sandefjord', 'Larvik', 'Porsgrunn', 'Skien'],
  ['Hokksund', 'Kongsberg', 'Notodden', 'Bø'],
  ['Oslo', 'Ås', 'Moss', 'Sarpsborg', 'Halden'],
  ['Sarpsborg', 'Fredrikstad'],
  ['Sandvika', 'Hønefoss', 'Nesbyen', 'Gol', 'Geilo'],
  ['Oslo', 'Lillestrøm', 'Jessheim', 'Eidsvoll', 'Hamar'],
  ['Hokksund', 'Åmot', 'Vikersund', 'Hønefoss'],
  ['Porsgrunn', 'Kragerø'],
];

function pathOf(pts: [number, number][], close = true): string {
  return pts.map(([la, ln], i) => { const p = proj(la, ln); return `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join('') + (close ? 'Z' : '');
}

const COLORS: Record<PinColor, string> = { red: 'var(--red)', orange: 'var(--orange)', blue: 'var(--blue)', green: 'var(--green)', grey: 'var(--grey)' };

type Filter = 'alle' | 'red' | 'orange' | 'blue' | 'green' | 'grey';

interface PinItem { f: Facility; c: Control; color: PinColor; overdue: boolean }

function pinsFor(state: AppState, q: Quarter | null, filter: Filter): PinItem[] {
  const today = todayOf(state.settings);
  const q0 = quarterOf(today);
  const out: PinItem[] = [];
  for (const f of state.facilities) {
    let c: Control | undefined;
    if (!q) c = currentControl(state, f.id);
    else {
      c = state.controls.find((x) => x.facilityId === f.id && sameQuarter(x.due, q));
      if (!c && sameQuarter(q, q0)) {
        const cur = currentControl(state, f.id);
        if (cur && cur.status !== 'utfort' && isOverdue(cur.due, today)) c = cur;
      }
      if (!c) {
        const cur = currentControl(state, f.id);
        if (cur && cur.plannedDate && sameQuarter(quarterOf(cur.plannedDate), q)) c = cur; // tidlig planlagt
      }
    }
    if (!c || !f.coords) continue;
    const color = pinColor(c, f, today);
    if (filter !== 'alle' && color !== filter) continue;
    out.push({ f, c, color, overdue: c.status !== 'utfort' && isOverdue(c.due, today) });
  }
  // Røde tegnes sist, så de ligger øverst.
  const rank: Record<PinColor, number> = { green: 0, blue: 1, grey: 2, orange: 3, red: 4 };
  return out.sort((a, b) => rank[a.color] - rank[b.color]);
}

export function MapView({ dayId, onDay, placing, onPlaced }: { dayId: string | null; onDay: (id: string | null) => void; placing: string | null; onPlaced: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const today = todayOf(state.settings);
  const q0 = quarterOf(today);
  const [mode, setMode] = useState<'kart' | 'radar'>('kart');
  const [controlsOpen, setControlsOpen] = useState(false);
  const [qKey, setQKey] = useState(`${q0.year}-${q0.q}`);
  const [filter, setFilter] = useState<Filter>('alle');
  const [legend, setLegend] = useState(false);
  const q: Quarter | null = qKey === 'alle' ? null : { year: Number(qKey.split('-')[0]), q: Number(qKey.split('-')[1]) as Quarter['q'] };
  const pins = pinsFor(state, q, filter);
  const days = sortedDays(state).filter((d) => d.date >= today && d.stops.length);
  const placingF = placing ? state.facilities.find((f) => f.id === placing) : null;

  const quarters = [-1, 0, 1, 2, 3, 4].map((n) => addQuarters(q0, n));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
      <div class="mapctl top">
        <button class="btn floating" onClick={() => setControlsOpen((v) => !v)} aria-expanded={controlsOpen}>{controlsOpen ? 'Skjul valg' : 'Valg'}</button>
        <div class="floating" style={{ flex: '1 1 160px', padding: 2 }}>
          <Seg value={mode} options={[['kart', 'Kart'], ['radar', 'Radar']]} onChange={setMode} />
        </div>
      </div>
      {controlsOpen && (
        <div class="mapctl filters">
          <div class="floating" style={{ flex: '1 1 150px' }}>
            <select class="sel" value={qKey} onChange={(e) => setQKey(e.currentTarget.value)} aria-label="Kvartal og år">
              {quarters.map((x) => <option value={`${x.year}-${x.q}`}>{fmtQ(x)}{sameQuarter(x, q0) ? ' · nå' : ''}</option>)}
              <option value="alle">Alle åpne</option>
            </select>
          </div>
          <div class="floating" style={{ flex: '1 1 150px' }}>
            <select class="sel" value={filter} onChange={(e) => setFilter(e.currentTarget.value as Filter)} aria-label="Statusfilter">
              {([['alle', 'Alle statuser'], ['red', 'Krever handling'], ['orange', 'Utsatt'], ['blue', 'Planlagt / varslet'], ['green', 'Bekreftet / utført'], ['grey', 'Mangler info']] as [Filter, string][]).map(([k, l]) => <option value={k}>{l}</option>)}
            </select>
          </div>
          <div class="floating" style={{ flex: '1 1 150px' }}>
            <select class="sel" value={dayId ?? ''} onChange={(e) => onDay(e.currentTarget.value || null)} aria-label="Vis rute for dag">
              <option value="">Ingen rute</option>
              {days.map((d) => <option value={d.id}>Rute {fmtShortWeekday(d.date)} · {d.stops.length} stopp</option>)}
            </select>
          </div>
        </div>
      )}
      {placingF && (
        <div class="floating" style={{ position: 'absolute', zIndex: 4, left: 12, right: 12, bottom: 'calc(150px + var(--safe-bottom))', padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span class="small" style={{ flex: 1 }}>Trykk på kartet der <b>{placingF.customer}</b> ligger.</span>
          <button class="btn small" onClick={onPlaced}>Avbryt</button>
        </div>
      )}
      {mode === 'kart' ? (
        <VectorMap
          pins={pins}
          dayId={dayId}
          chromeTop={controlsOpen ? 230 : 78}
          placing={!!placingF}
          onPin={(f) => nav.sheet({ kind: 'pin', facilityId: f.id })}
          onPlace={(lat, lng) => {
            if (!placingF) return;
            update((s) => {
              const x = s.facilities.find((y) => y.id === placingF.id)!;
              x.coords = { lat, lng, source: 'manuell' };
              x.confidence.coords = 'høy';
              x.flags = x.flags.filter((fl) => !/koordinater|adresse/i.test(fl));
              x.log.push({ at: nowStamp(today), text: `Pinnen plassert manuelt (${lat.toFixed(4)}, ${lng.toFixed(4)})` });
            });
            nav.toast('Pinnen er plassert');
            onPlaced();
          }}
        />
      ) : (
        <Radar pins={pins} onPin={(f) => nav.sheet({ kind: 'pin', facilityId: f.id })} />
      )}
      <button class="legend floating" style={{ border: 0, textAlign: 'left', cursor: 'pointer' }} onClick={() => setLegend(!legend)} aria-expanded={legend}>
        {legend ? (
          <>
            <span><i class="dotc red" />Ikke planlagt / forfalt</span>
            <span><i class="dotc orange" />Utsatt</span>
            <span><i class="dotc blue" />Planlagt / varslet</span>
            <span><i class="dotc green" />Bekreftet / utført</span>
            <span><i class="dotc grey" />Mangler info</span>
            <span class="muted">Rød ring = forfalt</span>
          </>
        ) : (
          <span><i class="dotc red" /><i class="dotc orange" /><i class="dotc blue" /><i class="dotc green" /><i class="dotc grey" /> {pins.length} anlegg{q ? ` · ${fmtQ(q)}` : ''}</span>
        )}
      </button>
    </div>
  );
}

function VectorMap({ pins, dayId, chromeTop, placing, onPin, onPlace }: { pins: PinItem[]; dayId: string | null; chromeTop: number; placing: boolean; onPin: (f: Facility) => void; onPlace: (lat: number, lng: number) => void }) {
  const state = useAppState();
  const ref = useRef<HTMLDivElement>(null);
  const base = proj(state.settings.baseLat, state.settings.baseLng);
  const [vb, setVb] = useState({ x: base.x - 90, y: base.y - 110, w: 180, h: 260 });
  const [cw, setCw] = useState(390);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const day = dayId ? state.days.find((d) => d.id === dayId) : null;

  // Tilpass utsnittet til punktene, med plass til kontrollene øverst og fanelinjen nederst.
  const fitTo = (pts: { lat: number; lng: number }[]) => {
    const el = ref.current;
    if (!el || !pts.length) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const ps = pts.map((p) => proj(p.lat, p.lng));
    const minX = Math.min(...ps.map((p) => p.x)), maxX = Math.max(...ps.map((p) => p.x));
    const minY = Math.min(...ps.map((p) => p.y)), maxY = Math.max(...ps.map((p) => p.y));
    const top = chromeTop, bottom = 100;
    const availH = Math.max(120, r.height - top - bottom);
    const scale = Math.max(((maxX - minX) * 1.2) / r.width, ((maxY - minY) * 1.2) / availH, 30 / r.width);
    setVb({ x: (minX + maxX) / 2 - (r.width * scale) / 2, y: (minY + maxY) / 2 - (top + availH / 2) * scale, w: r.width * scale, h: r.height * scale });
  };
  const defaultPts = () => {
    const s = state.settings;
    const pts = state.facilities.filter((f) => f.coords && (driveFromBase(s, f) ?? 999) <= s.maxDriveMin).map((f) => f.coords!);
    return [...pts, basePoint(s)];
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let first = true;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setCw(r.width);
      if (first) { first = false; if (!dayId) fitTo(defaultPts()); }
      else setVb((v) => ({ ...v, h: (v.w * r.height) / r.width }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sentrer på valgt rute.
  useEffect(() => {
    if (!day) return;
    const pts = day.stops.map((id) => stopOf(state, id)?.point).filter(Boolean) as { lat: number; lng: number }[];
    fitTo([...pts, basePoint(state.settings)]);
  }, [dayId, chromeTop]);

  const ratio = vb.w / cw;
  const zoom = (factor: number, cx?: number, cy?: number) =>
    setVb((v) => {
      const w = Math.min(600, Math.max(12, v.w * factor));
      const h = (w * v.h) / v.w;
      const px = cx ?? v.x + v.w / 2;
      const py = cy ?? v.y + v.h / 2;
      return { x: px - ((px - v.x) * w) / v.w, y: py - ((py - v.y) * h) / v.h, w, h };
    });

  const toWorld = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: vb.x + (clientX - r.left) * ratio, y: vb.y + (clientY - r.top) * ratio };
  };

  const onDown = (e: PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
  };
  const onMove = (e: PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId);
    if (!prev) return;
    if (ptrs.current.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      moved.current += Math.abs(dx) + Math.abs(dy);
      setVb((v) => ({ ...v, x: v.x - dx * (v.w / cw), y: v.y - dy * (v.w / cw) }));
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    } else if (ptrs.current.size === 2) {
      const others = [...ptrs.current.entries()].filter(([id]) => id !== e.pointerId);
      const o = others[0][1];
      const d0 = Math.hypot(prev.x - o.x, prev.y - o.y);
      const d1 = Math.hypot(e.clientX - o.x, e.clientY - o.y);
      moved.current += 10;
      if (d0 > 0 && d1 > 0) {
        const mid = toWorld((e.clientX + o.x) / 2, (e.clientY + o.y) / 2);
        zoom(d0 / d1, mid.x, mid.y);
      }
      ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  };
  const onUp = (e: PointerEvent) => {
    ptrs.current.delete(e.pointerId);
    if (placing && moved.current < 6 && ptrs.current.size === 0) {
      const w = toWorld(e.clientX, e.clientY);
      const ll = unproj(w.x, w.y);
      onPlace(ll.lat, ll.lng);
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, w.x, w.y);
  };

  const route = day
    ? (() => {
        const pts = day.stops.map((id) => stopOf(state, id)).filter(Boolean).map((s) => proj(s!.point.lat, s!.point.lng));
        const all = day.overnight === 'hjem' ? pts : [base, ...pts];
        if (day.overnight !== 'ut') all.push(base);
        return { d: all.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(''), pts };
      })()
    : null;

  const fs = 11 * ratio;
  return (
    <div class="mapwrap" ref={ref} onPointerDown={onDown as any} onPointerMove={onMove as any} onPointerUp={onUp as any} onPointerCancel={onUp as any} onWheel={onWheel as any} style={placing ? { cursor: 'crosshair' } : {}}>
      <svg class="map" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Kart over Sør-Norge med anlegg">
        <rect x={-400} y={-400} width={1200} height={1200} fill="var(--map-land)" />
        <path d={pathOf(COAST)} fill="var(--map-water)" />
        {LAKES.map((l) => <path d={pathOf(l)} fill="var(--map-water)" />)}
        <path d={pathOf(BORDER, false)} fill="none" stroke="var(--text-3)" stroke-width={1 * ratio} stroke-dasharray={`${4 * ratio} ${3 * ratio}`} opacity="0.6" />
        {ROADS.map((r) => {
          const pts = r.map((n) => PLACES.find((p) => p.name === n)!).filter(Boolean).map((p) => [p.lat, p.lng] as [number, number]);
          return <path d={pathOf(pts, false)} fill="none" stroke="var(--map-road)" stroke-width={2.5 * ratio} stroke-linecap="round" stroke-linejoin="round" />;
        })}
        {PLACES.filter((p) => p.label).map((p) => {
          const pt = proj(p.lat, p.lng);
          return (
            <g>
              <circle cx={pt.x} cy={pt.y} r={1.6 * ratio} fill="var(--text-3)" />
              <text class="maplabel" x={pt.x + 4 * ratio} y={pt.y - 3 * ratio} style={{ fontSize: `${fs}px`, strokeWidth: `${3 * ratio}px` }}>{p.name}</text>
            </g>
          );
        })}
        {route && <path d={route.d} fill="none" stroke="var(--graphite)" stroke-width={3 * ratio} stroke-linejoin="round" stroke-linecap="round" opacity="0.85" />}
        {pins.map(({ f, color, overdue }) => {
          const p = proj(f.coords!.lat, f.coords!.lng);
          return (
            <g class="pin" onClick={(e) => { e.stopPropagation(); if (!placing && moved.current < 6) onPin(f); }}>
              <circle cx={p.x} cy={p.y} r={24 * ratio} fill="transparent" />
              {overdue && color !== 'red' && <circle cx={p.x} cy={p.y} r={21 * ratio} fill="none" stroke="var(--red)" stroke-width={2.4 * ratio} />}
              <circle cx={p.x} cy={p.y} r={18 * ratio} fill={COLORS[color]} stroke="var(--surface)" stroke-width={2.2 * ratio} />
            </g>
          );
        })}
        {route && route.pts.map((p, i) => (
          <g>
            <circle cx={p.x} cy={p.y} r={16 * ratio} fill="var(--graphite)" stroke="var(--surface)" stroke-width={2 * ratio} />
            <text x={p.x} y={p.y + 5 * ratio} text-anchor="middle" style={{ fontSize: `${14 * ratio}px`, fontWeight: 700, fill: 'var(--bg)' }}>{i + 1}</text>
          </g>
        ))}
        <g>
          <rect x={base.x - 7 * ratio} y={base.y - 7 * ratio} width={14 * ratio} height={14 * ratio} rx={3 * ratio} fill="var(--graphite)" stroke="var(--surface)" stroke-width={2 * ratio} />
          <text class="maplabel" x={base.x + 10 * ratio} y={base.y + 4 * ratio} style={{ fontSize: `${12 * ratio}px`, fontWeight: 700, fill: 'var(--text)', strokeWidth: `${3 * ratio}px` }}>Base · {state.settings.baseName}</text>
        </g>
      </svg>
      <div class="mapctl right">
        <button class="iconbtn floating" onClick={() => zoom(1 / 1.4)} aria-label="Zoom inn"><Icon.plus /></button>
        <button class="iconbtn floating" onClick={() => zoom(1.4)} aria-label="Zoom ut"><svg viewBox="0 0 24 24"><path d="M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg></button>
        <button class="iconbtn floating" onClick={() => fitTo(defaultPts())} aria-label="Vis alle anlegg"><Icon.nav /></button>
      </div>
    </div>
  );
}

function Radar({ pins, onPin }: { pins: PinItem[]; onPin: (f: Facility) => void }) {
  const state = useAppState();
  const b = basePoint(state.settings);
  const rings = [30, 60, 90, 120];
  const R = 170;
  return (
    <div class="mapwrap" style={{ background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'auto' }}>
      <svg viewBox={`${-R} ${-R - 40} ${2 * R} ${2 * R + 30}`} style={{ width: '100%', height: '100%', maxHeight: '100%' }} role="img" aria-label="Kjøretidsradar">
        {rings.map((m) => (
          <g>
            <circle r={m} fill="none" stroke="var(--line-strong)" stroke-width="1" />
            <text x={4} y={-m - 3} style={{ fontSize: '9px', fill: 'var(--text-3)', fontWeight: 600 }}>{m} min</text>
          </g>
        ))}
        <circle r={state.settings.maxDriveMin} fill="none" stroke="var(--red)" stroke-width="0.8" stroke-dasharray="3 3" opacity="0.6" />
        <text x={4} y={-state.settings.maxDriveMin - 3} style={{ fontSize: '9px', fill: 'var(--red)' }}>radius {state.settings.maxDriveMin} min</text>
        {['N', 'Ø', 'S', 'V'].map((l, i) => {
          const a = (i * Math.PI) / 2;
          return <text x={Math.sin(a) * (R - 6)} y={-Math.cos(a) * (R - 6) + 3} text-anchor="middle" style={{ fontSize: '10px', fill: 'var(--text-3)', fontWeight: 700 }}>{l}</text>;
        })}
        {PLACES.filter((p) => p.label).map((p) => {
          const m = Math.min(165, driveFromBase(state.settings, { coords: { lat: p.lat, lng: p.lng, source: 'ca' } } as Facility) ?? 0);
          const a = (bearing(b, p) * Math.PI) / 180;
          if (p.name === state.settings.baseName) return null;
          return <text x={Math.sin(a) * m} y={-Math.cos(a) * m - 7} text-anchor="middle" style={{ fontSize: '8.5px', fill: 'var(--text-3)' }}>{p.name}</text>;
        })}
        {pins.map(({ f, color }) => {
          const m = Math.min(168, driveFromBase(state.settings, f) ?? 0);
          const a = (bearing(b, f.coords!) * Math.PI) / 180;
          return (
            <g class="pin" onClick={() => onPin(f)}>
              <circle cx={Math.sin(a) * m} cy={-Math.cos(a) * m} r={22} fill="transparent" />
              <circle cx={Math.sin(a) * m} cy={-Math.cos(a) * m} r={12} fill={COLORS[color]} stroke="var(--surface)" stroke-width="2" />
            </g>
          );
        })}
        <rect x={-6} y={-6} width={12} height={12} rx={3} fill="var(--graphite)" />
        <text y={20} text-anchor="middle" style={{ fontSize: '10px', fontWeight: 700, fill: 'var(--text)' }}>{state.settings.baseName}</text>
      </svg>
    </div>
  );
}

export { findControl, facilityOf };
