import { useMemo, useState } from 'preact/hooks';
import { useAppState } from '../store';
import { Icon, NavCtx, Toast, type Nav, type Screen, type SheetSpec, type TabKey } from './components';
import { Home } from './Home';
import { MapView } from './MapView';
import { Plan } from './Plan';
import { Facilities, ControlList } from './Facilities';
import { FacilityDetail } from './FacilityDetail';
import { Inbox, DraftScreen } from './Inbox';
import { Review } from './Review';
import { ImportScreen } from './ImportScreen';
import { SettingsScreen } from './Settings';
import { RouteScreen } from './RouteScreen';
import { Sheets } from './Sheets';
import { draftsToApprove, lateDrafts, callList } from '../domain/notices';
import { todayOf } from '../domain/controls';
import { sortedDays } from '../domain/selectors';
import type { AppState } from '../domain/types';

function initialMapDay(state: AppState): string | null {
  const today = todayOf(state.settings);
  const days = sortedDays(state).filter((d) => d.stops.length > 0);
  return (days.find((d) => d.date === today) ?? days.find((d) => d.date >= today))?.id ?? null;
}

export function App() {
  const state = useAppState();
  const [tab, setTab] = useState<TabKey>('hjem');
  const [stack, setStack] = useState<Screen[]>([]);
  const [sheet, setSheet] = useState<SheetSpec | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mapDay, setMapDay] = useState<string | null>(() => initialMapDay(state));
  const [placing, setPlacing] = useState<string | null>(null);

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
      },
      sheet: (s) => setSheet(s),
      toast: (m) => setToast(m),
    }),
    [],
  );

  const inboxCount = draftsToApprove(state).length + callList(state).length;
  const late = lateDrafts(state).length > 0;
  const top = stack[stack.length - 1];

  const tabs: [TabKey, string, () => any][] = [
    ['hjem', 'Hjem', Icon.home],
    ['kart', 'Kart', Icon.map],
    ['plan', 'Plan', Icon.plan],
    ['anlegg', 'Anlegg', Icon.list],
    ['innboks', 'Innboks', Icon.inbox],
  ];

  return (
    <NavCtx.Provider value={nav}>
      <div class="shell">
        {tab === 'hjem' && <Home />}
        {tab === 'kart' && <MapView dayId={mapDay} onDay={setMapDay} placing={placing} onPlaced={() => setPlacing(null)} />}
        {tab === 'plan' && <Plan />}
        {tab === 'anlegg' && <Facilities />}
        {tab === 'innboks' && <Inbox />}
        {top && (
          <div class="overlay" key={stack.length}>
            {top.kind === 'list' && <ControlList title={top.title} ids={top.ids} subtitle={top.subtitle} />}
            {top.kind === 'facility' && <FacilityDetail id={top.id} />}
            {top.kind === 'route' && <RouteScreen dayId={top.dayId} />}
            {top.kind === 'settings' && <SettingsScreen />}
            {top.kind === 'import' && <ImportScreen />}
            {top.kind === 'review' && <Review startId={top.id} />}
            {top.kind === 'draft' && <DraftScreen noticeId={top.noticeId} />}
          </div>
        )}
        <nav class="tabbar" aria-label="Hovedmeny">
          {tabs.map(([k, label, I]) => (
            <button class={`tab${tab === k && !top ? ' active' : ''}`} onClick={() => nav.tab(k)} aria-current={tab === k}>
              <I />
              {label}
              {k === 'innboks' && inboxCount > 0 && <span class="dot" style={late ? {} : { background: 'var(--graphite)', color: 'var(--bg)' }}>{inboxCount}</span>}
            </button>
          ))}
        </nav>
        {sheet && <Sheets spec={sheet} />}
        {toast && <Toast msg={toast} onDone={() => setToast(null)} />}
      </div>
    </NavCtx.Provider>
  );
}
