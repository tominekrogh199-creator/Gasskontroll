import type { ComponentChildren, JSX } from 'preact';
import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Control, Facility } from '../domain/types';
import { STATUS_LABEL } from '../domain/types';
import { flagsOf, pinColor, type PinColor } from '../domain/controls';

// ---------- Ikoner (SF Symbols-aktige streker) ----------

const P = (d: string) => <path d={d} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />;

export const Icon = {
  home: () => <svg viewBox="0 0 24 24">{P('M3.5 10.5 12 4l8.5 6.5V20a1 1 0 0 1-1 1h-5v-6h-5v6h-5a1 1 0 0 1-1-1z')}</svg>,
  map: () => <svg viewBox="0 0 24 24">{P('M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4zM9 4v14M15 6v14')}</svg>,
  plan: () => <svg viewBox="0 0 24 24">{P('M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8.5 3v4M15.5 3v4')}</svg>,
  list: () => <svg viewBox="0 0 24 24">{P('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01')}</svg>,
  inbox: () => <svg viewBox="0 0 24 24">{P('M4 13.5 6.5 5h11l2.5 8.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13.5h4.5l1 2h5l1-2H20')}</svg>,
  gear: () => <svg viewBox="0 0 24 24">{P('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z')}{P('M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z')}</svg>,
  phone: () => <svg viewBox="0 0 24 24">{P('M5 4h3l1.5 4-2 1.5a11 11 0 0 0 7 7l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z')}</svg>,
  mail: () => <svg viewBox="0 0 24 24">{P('M3.5 6.5h17v11h-17zM3.5 7l8.5 6 8.5-6')}</svg>,
  nav: () => <svg viewBox="0 0 24 24">{P('M20 4 3.5 11l7 2.5L13 20.5z')}</svg>,
  cal: () => <svg viewBox="0 0 24 24">{P('M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8.5 3v4M15.5 3v4M12 13v4M10 15h4')}</svg>,
  chevR: () => <svg viewBox="0 0 24 24" width="16" height="16">{P('M9 6l6 6-6 6')}</svg>,
  chevL: () => <svg viewBox="0 0 24 24" width="22" height="22">{P('M15 5l-7 7 7 7')}</svg>,
  close: () => <svg viewBox="0 0 24 24">{P('M6 6l12 12M18 6 6 18')}</svg>,
  search: () => <svg viewBox="0 0 24 24">{P('M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4')}</svg>,
  lock: () => <svg viewBox="0 0 24 24">{P('M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3')}</svg>,
  unlock: () => <svg viewBox="0 0 24 24">{P('M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2')}</svg>,
  plus: () => <svg viewBox="0 0 24 24">{P('M12 5v14M5 12h14')}</svg>,
  radar: () => <svg viewBox="0 0 24 24">{P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12l6-6')}</svg>,
  check: () => <svg viewBox="0 0 24 24">{P('M5 12.5l4.5 4.5L19 7.5')}</svg>,
  upload: () => <svg viewBox="0 0 24 24">{P('M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v4.5h15V15')}</svg>,
  route: () => <svg viewBox="0 0 24 24">{P('M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a3 3 0 0 1 3-3h3M18 9v6a3 3 0 0 1-3 3h-3')}</svg>,
  move: () => <svg viewBox="0 0 24 24">{P('M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20')}</svg>,
  trash: () => <svg viewBox="0 0 24 24">{P('M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13')}</svg>,
  pause: () => <svg viewBox="0 0 24 24">{P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 9v6M14 9v6')}</svg>,
  done: () => <svg viewBox="0 0 24 24">{P('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.7 2.7L16 9.8')}</svg>,
  copy: () => <svg viewBox="0 0 24 24">{P('M9 9h10v11H9zM5 15H4V4h11v1')}</svg>,
};

// ---------- Navigasjon ----------

export type Screen =
  | { kind: 'list'; title: string; ids: string[]; subtitle?: string }
  | { kind: 'facility'; id: string }
  | { kind: 'route'; dayId: string }
  | { kind: 'settings' }
  | { kind: 'import' }
  | { kind: 'review'; id?: string }
  | { kind: 'draft'; noticeId: string }
  | { kind: 'daysheet'; dayId: string };

export interface Nav {
  push: (s: Screen) => void;
  pop: () => void;
  tab: (t: TabKey, opts?: { dayId?: string; facilityId?: string }) => void;
  sheet: (s: SheetSpec | null) => void;
  toast: (msg: string) => void;
}
export type TabKey = 'hjem' | 'kart' | 'plan' | 'anlegg' | 'innboks';
export type SheetSpec =
  | { kind: 'pin'; facilityId: string }
  | { kind: 'postpone'; controlId: string }
  | { kind: 'complete'; controlId: string }
  | { kind: 'newtime'; controlId: string }
  | { kind: 'move'; controlId: string }
  | { kind: 'fill'; dayId: string; reason?: string }
  | { kind: 'adhoc'; date?: string }
  | { kind: 'schedule'; controlId: string }
  | { kind: 'offday'; controlId: string; dayId: string | null }
  | { kind: 'today'; date: string }
  | { kind: 'utsett' };

export const NavCtx = createContext<Nav>(null as unknown as Nav);
export const useNav = () => useContext(NavCtx);

// ---------- Byggeklosser ----------

export function NavBar({ title, right }: { title: string; right?: ComponentChildren }) {
  const nav = useNav();
  return (
    <div class="navbar">
      <button class="backbtn" onClick={() => nav.pop()} aria-label="Tilbake">
        <Icon.chevL />
        <span class="small">Tilbake</span>
      </button>
      <div class="title">{title}</div>
      <div class="spacer" style={{ display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ComponentChildren; children?: ComponentChildren }) {
  return (
    <>
      <div class="section">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </>
  );
}

export function Empty({ title, children }: { title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Row(props: { title: ComponentChildren; sub?: ComponentChildren; right?: ComponentChildren; left?: ComponentChildren; onClick?: () => void; chevron?: boolean }) {
  const Tag = props.onClick ? 'button' : 'div';
  return (
    <Tag class={`row${props.onClick ? '' : ' static'}`} onClick={props.onClick}>
      {props.left}
      <div class="main">
        <div class="t">{props.title}</div>
        {props.sub && <div class="s">{props.sub}</div>}
      </div>
      {props.right && <div class="r">{props.right}</div>}
      {props.onClick && props.chevron !== false && <span class="chev"><Icon.chevR /></span>}
    </Tag>
  );
}

const COLOR_OF_STATUS: Record<Control['status'], PinColor> = {
  ikke_planlagt: 'red', planlagt: 'blue', varslet: 'blue', bekreftet: 'green', utfort: 'green', utsatt: 'orange',
};

export function StatusPill({ c, today }: { c: Control; today: string; f?: Facility }) {
  const color = c.status === 'ikke_planlagt' ? 'grey' : COLOR_OF_STATUS[c.status];
  return <span class={`pill ${color}`}>{STATUS_LABEL[c.status]}</span>;
}

export function FlagPills({ c, f, today }: { c: Control; f: Facility; today: string }) {
  const fl = flagsOf(c, f, today);
  return (
    <>
      {fl.overdue && <span class="pill solid-red">Forfalt</span>}
      {fl.missingInfo.length > 0 && <span class="pill grey">Mangler {fl.missingInfo.join(', ')}</span>}
      {fl.uncertain && <span class="pill orange">Usikker import</span>}
    </>
  );
}

export function Dot({ c, f, today }: { c: Control; f: Facility; today: string }) {
  return <span class={`dotc ${pinColor(c, f, today)}`} />;
}

export function Sheet({ title, onClose, children, sub }: { title: ComponentChildren; sub?: ComponentChildren; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div class="backdrop" onClick={onClose} />
      <div class="sheet" role="dialog" aria-modal="true">
        <div class="grab" />
        <div class="sheet-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>{title}</h3>
            {sub && <div class="muted small">{sub}</div>}
          </div>
          <button class="iconbtn" onClick={onClose} aria-label="Lukk" style={{ marginTop: -8, marginRight: -10 }}>
            <Icon.close />
          </button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="seg">
      {options.map(([v, l]) => (
        <button class={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export function Field({ label, children, low }: { label: string; children: ComponentChildren; low?: boolean }) {
  return (
    <label class={`field${low ? ' low' : ''}`}>
      <span>{label}{low ? ' · lav sikkerhet' : ''}</span>
      {children}
    </label>
  );
}

export function Toast({ msg, onDone }: { msg: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return <div class="toast" role="status">{msg}</div>;
}

export function useInput(initial: string): [string, (e: JSX.TargetedEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void, (v: string) => void] {
  const [v, set] = useState(initial);
  return [v, (e) => set((e.currentTarget as HTMLInputElement).value), set];
}
