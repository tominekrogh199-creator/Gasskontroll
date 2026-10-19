// Ren datoregning i UTC, så tidssoner aldri flytter en dag.
import type { Quarter } from './types';

const DAY = 86400000;

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  return toISO(new Date(parseISO(iso).getTime() + n * DAY));
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / DAY);
}

export function weekday(iso: string): number {
  return parseISO(iso).getUTCDay(); // 0 = søndag
}

export function deviceToday(): string {
  const n = new Date();
  return toISO(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
}

// Påskedag etter den anonyme gregorianske algoritmen.
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toISO(new Date(Date.UTC(year, month - 1, day)));
}

const holidayCache = new Map<number, Map<string, string>>();

export function norwegianHolidays(year: number): Map<string, string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const e = easterSunday(year);
  const list: [string, string][] = [
    [`${year}-01-01`, '1. nyttårsdag'],
    [addDays(e, -3), 'Skjærtorsdag'],
    [addDays(e, -2), 'Langfredag'],
    [e, '1. påskedag'],
    [addDays(e, 1), '2. påskedag'],
    [`${year}-05-01`, 'Arbeidernes dag'],
    [`${year}-05-17`, 'Grunnlovsdag'],
    [addDays(e, 39), 'Kristi himmelfartsdag'],
    [addDays(e, 49), '1. pinsedag'],
    [addDays(e, 50), '2. pinsedag'],
    [`${year}-12-25`, '1. juledag'],
    [`${year}-12-26`, '2. juledag'],
  ];
  const map = new Map(list);
  holidayCache.set(year, map);
  return map;
}

export function holidayName(iso: string): string | null {
  return norwegianHolidays(Number(iso.slice(0, 4))).get(iso) ?? null;
}

export function isWorkday(iso: string, blocked: string[] = []): boolean {
  const wd = weekday(iso);
  if (wd === 0 || wd === 6) return false;
  if (holidayName(iso)) return false;
  return !blocked.includes(iso);
}

/** Flytter n virkedager (negativ n = bakover). Helger og helligdager telles ikke. */
export function addWorkdays(iso: string, n: number, blocked: string[] = []): string {
  let d = iso;
  let left = Math.abs(n);
  const step = n < 0 ? -1 : 1;
  while (left > 0) {
    d = addDays(d, step);
    if (isWorkday(d, blocked)) left--;
  }
  return d;
}

/** Nærmeste virkedag på eller etter datoen. */
export function nextWorkdayOnOrAfter(iso: string, blocked: string[] = []): string {
  let d = iso;
  while (!isWorkday(d, blocked)) d = addDays(d, 1);
  return d;
}

/** Nærmeste virkedag på eller før datoen. */
export function prevWorkdayOnOrBefore(iso: string, blocked: string[] = []): string {
  let d = iso;
  while (!isWorkday(d, blocked)) d = addDays(d, -1);
  return d;
}

// ---------- Kvartal ----------

export function quarterOf(iso: string): Quarter {
  const m = Number(iso.slice(5, 7));
  return { q: (Math.floor((m - 1) / 3) + 1) as Quarter['q'], year: Number(iso.slice(0, 4)) };
}

export function quarterIndex(q: Quarter): number {
  return q.year * 4 + (q.q - 1);
}

export function quarterFromIndex(i: number): Quarter {
  return { year: Math.floor(i / 4), q: ((i % 4) + 1) as Quarter['q'] };
}

export function addQuarters(q: Quarter, n: number): Quarter {
  return quarterFromIndex(quarterIndex(q) + n);
}

export function compareQuarter(a: Quarter, b: Quarter): number {
  return quarterIndex(a) - quarterIndex(b);
}

export function quarterStart(q: Quarter): string {
  return `${q.year}-${String((q.q - 1) * 3 + 1).padStart(2, '0')}-01`;
}

export function quarterEnd(q: Quarter): string {
  return addDays(quarterStart(addQuarters(q, 1)), -1);
}

export function sameQuarter(a: Quarter | null, b: Quarter | null): boolean {
  return !!a && !!b && a.q === b.q && a.year === b.year;
}

/** Forfalt = fristkvartalet er passert. */
export function isOverdue(due: Quarter, today: string): boolean {
  return today > quarterEnd(due);
}

/** Vanlig neste frist: samme kvartal om fire år. */
export function suggestedNextDue(date: string): Quarter {
  return addQuarters(quarterOf(date), 16);
}

/** Mandag i uken datoen ligger i. */
export function weekMonday(iso: string): string {
  const w = weekday(iso);
  return addDays(iso, w === 0 ? -6 : 1 - w);
}

export function workdaysInRange(from: string, to: string, blocked: string[] = []): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWorkday(d, blocked)) out.push(d);
  return out;
}

export function firstWorkdayOfQuarter(q: Quarter): string {
  return nextWorkdayOnOrAfter(quarterStart(q));
}

// ---------- Visning (norsk bokmål) ----------

const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const WEEKDAYS_SHORT = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const MONTHS = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function fmtDateWeekday(iso: string): string {
  return `${WEEKDAYS[weekday(iso)]} ${fmtDate(iso)}`;
}

export function fmtShortWeekday(iso: string): string {
  return `${WEEKDAYS_SHORT[weekday(iso)]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
}

export function fmtDayMonth(iso: string): string {
  return `${Number(iso.slice(8, 10))}. ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;
}

export function weekdayName(iso: string): string {
  return WEEKDAYS[weekday(iso)];
}

export function fmtQuarter(q: Quarter | null): string {
  return q ? `${q.q}. kvartal ${q.year}` : 'ukjent';
}

export function fmtQ(q: Quarter | null): string {
  return q ? `K${q.q} ${q.year}` : '–';
}

/** Tolker «dd.mm.åååå» (også d.m.åååå). Ugyldige datoer gir null. */
export function parseNorDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (toISO(parseISO(iso)) !== iso) return null;
  return iso;
}

export function minutesToClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function clockToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export function fmtDuration(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} t ${r} min` : `${h} t`;
}

export function fmtHours(min: number): string {
  return `${(min / 60).toFixed(1).replace('.', ',')} t`;
}

export function nowStamp(today: string): string {
  // Loggtidspunkt: datoen følger «i dag» (testdato), klokkeslett fra enheten.
  const n = new Date();
  return `${today}T${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`;
}

export function fmtStamp(stamp: string): string {
  const [d, t] = stamp.split('T');
  return t ? `${fmtDate(d)} kl. ${t}` : fmtDate(d);
}
