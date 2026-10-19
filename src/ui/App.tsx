import { useMemo, useState } from 'preact/hooks';
import { useAppState } from '../store';
import { Icon, NavCtx, Toast, tap, type Nav, type Screen, type SheetSpec, type TabKey } from './components';
import { Home } from './Home';
import { MapView } from './MapView';
import { Plan } from './Plan';
import { Facilities, ControlList } from './Facilities';
import { FacilityDetail } from './FacilityDetail';
import { Approve, Inbox, DraftScreen } from './Inbox';
import { Review } from './Review';
import { ImportScreen } from './ImportScreen';
import { SettingsScreen } from './Settings';
import { RouteScreen } from './RouteScreen';
import { DaySheet } from './DaySheet';
import { Sheets } from './Sheets';
import { todayOf } from '../domain/controls';
import { sortedDays } from '../domain/selectors';
import type { AppState } from '../domain/types';
import type { MapFocus } from '../domain/radius';

function initialMapDay(state: AppState): string | null {
  const today = todayOf(state.settings);
  const days = sortedDays(state).filter((d) => d.stops.length > 0);
  return (days.find((d) => d.date === today) ?? days.find((d) => d.date >= today))?.id ?? null;
}

export function App() {
  const state = useAppState();
  const [tab, setTab] = useState<TabKey>('idag');
  const [stack, setStack] = useState<Screen[]>([]);
  const [sheet, setSheet] = useState<SheetSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mapDay, setMapDay] = useState<string | null>(() => initialMapDay(state));
  const [placing, setPlacing] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus>({ kind: 'min', min: 120 });

  const nav: Nav = useMemo(
    () => ({
      push: (s) => { setSheet(null); setStack((st) => [...st, s]); },
      pop: () => setStack((st) => st.slice(0, -1)),
      tab: (t, opts) => {
        setSheet(null);
        setStack([]);
        setTab(t);
        if (opts?.dayId !== undefined) setMapDay(opts.dayId);
        if (opts?.facilityId !== undefined) setPlacing(opts.facilityId);
        if (opts?.band === 'drammen') setFocus({ kind: 'area', name: 'Drammen og omegn' });
        else if (typeof opts?.band === 'number') setFocus({ kind: 'min', min: opts.band });
      },
      sheet: (s) => setSheet(s),
      toast: (m) => setToast(m),
    }),
    [],
  );

  const top = stack[stack.length - 1];

  const tabs: [TabKey, string, () => any][] = [
    ['idag', 'I dag', Icon.home],
    ['uke', 'Uke', Icon.plan],
    ['kart', 'Kart', Icon.map],
  ];

  return (
    <NavCtx.Provider value={nav}>
      <div class="shell">
        {tab === 'idag' && <Home />}
        {tab === 'uke' && <Plan />}
        {tab === 'kart' && <MapView dayId={mapDay} onDay={setMapDay} placing={placing} onPlaced={() => setPlacing(null)} focus={focus} onFocus={setFocus} />}
        {top && (
          <div class="overlay" key={stack.length}>
            {top.kind === 'list' && <ControlList title={top.title} ids={top.ids} subtitle={top.subtitle} />}
            {top.kind === 'facilities' && <Facilities />}
            {top.kind === 'inbox' && <Inbox />}
            {top.kind === 'approve' && <Approve />}
            {top.kind === 'facility' && <FacilityDetail id={top.id} />}
            {top.kind === 'route' && <RouteScreen dayId={top.dayId} />}
            {top.kind === 'daysheet' && <DaySheet dayId={top.dayId} />}
            {top.kind === 'settings' && <SettingsScreen />}
            {top.kind === 'import' && <ImportScreen />}
            {top.kind === 'review' && <Review startId={top.id} />}
            {top.kind === 'draft' && <DraftScreen noticeId={top.noticeId} />}
          </div>
        )}
        {!top && <button class="fab" onClick={() => { tap(8); nav.sheet({ kind: 'chat' }); }}>Spør</button>}
        <nav class="tabbar" aria-label="Hovedmeny">
          {tabs.map(([k, label, I]) => (
            <button class={`tab${tab === k && !top ? ' active' : ''}`} onClick={() => { tap(6); nav.tab(k); }} aria-current={tab === k}>
              <I />
              {label}
            </button>
          ))}
        </nav>
        {sheet && <Sheets spec={sheet} />}
        {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      </div>
    </NavCtx.Provider>
  );
}
