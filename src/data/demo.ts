// 60 fiktive anlegg. Datoer regnes ut fra «i dag» (enhetens dato eller testdato).
import type { AppState, Confidence, Control, Facility, Quarter, Settings } from '../domain/types';
import { addDays, addQuarters, addWorkdays, quarterOf, quarterStart, nextWorkdayOnOrAfter, nowStamp } from '../domain/dates';
import { geocode } from '../adapters/geocode';
import { DEFAULT_TEMPLATES, makeNotice, runAutomations } from '../domain/notices';
import { newControl } from '../domain/controls';
import { refreshDay } from '../domain/planner';
import { PLACES } from '../domain/geo';

/** Gammel innebygd standard. Bare denne verdien flyttes til 120, og bare når brukeren ikke har valgt den selv. */
export const LEGACY_DRIVE_RADIUS_MIN = 150;

export function migrateDriveRadius<T extends { maxDriveMin: number; driveRadiusCustom?: boolean }>(settings: T): T {
  if (settings.driveRadiusCustom || settings.maxDriveMin !== LEGACY_DRIVE_RADIUS_MIN) return settings;
  return { ...settings, maxDriveMin: 120 };
}

export function defaultSettings(): Settings {
  return {
    baseName: 'Hokksund',
    baseLat: 59.770,
    baseLng: 9.910,
    dayStart: '07:30',
    dayEnd: '15:30',
    lunchMin: 30,
    controlMin: 90,
    maxPerDay: 4,
    maxDriveMin: 120,
    preNoticeDays: 21,
    reminderWorkdays: 3,
    chaseDays: 7,
    followUpDays: 30,
    earlyMaxMin: 20,
    inspectorName: 'Per Kontrollør',
    inspectorPhone: '400 00 001',
    inspectorEmail: 'per@example.no',
    templates: { ...DEFAULT_TEMPLATES },
    blockedDays: [],
    testDate: null,
    apiKey: '',
    aiModel: 'claude-opus-5-5',
  };
}

// Deterministisk tilfeldighet, så demodata blir like hver gang.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

type Group = 'forfalt' | 'na' | 'neste' | 'senere';

const PLAN: [string, Group][] = [
  // Forfalt (6)
  ['Drammen', 'forfalt'], ['Kongsberg', 'forfalt'], ['Hønefoss', 'forfalt'], ['Sarpsborg', 'forfalt'], ['Tønsberg', 'forfalt'], ['Notodden', 'forfalt'],
  // Inneværende kvartal (21): 6 i Drammen-området, 5 i Askim-området
  ['Drammen', 'na'], ['Drammen', 'na'], ['Drammen', 'na'], ['Drammen', 'na'], ['Lier', 'na'], ['Mjøndalen', 'na'],
  ['Askim', 'na'], ['Askim', 'na'], ['Askim', 'na'], ['Spydeberg', 'na'], ['Mysen', 'na'],
  ['Oslo', 'na'], ['Asker', 'na'], ['Lillestrøm', 'na'], ['Ski', 'na'], ['Moss', 'na'], ['Fredrikstad', 'na'], ['Halden', 'na'], ['Skien', 'na'], ['Gol', 'na'], ['Hamar', 'na'],
  // Neste kvartal (15)
  ['Drammen', 'neste'], ['Lier', 'neste'], ['Kongsberg', 'neste'], ['Hønefoss', 'neste'], ['Asker', 'neste'], ['Oslo', 'neste'], ['Lillestrøm', 'neste'],
  ['Moss', 'neste'], ['Askim', 'neste'], ['Sarpsborg', 'neste'], ['Tønsberg', 'neste'], ['Sandefjord', 'neste'], ['Larvik', 'neste'], ['Notodden', 'neste'], ['Holmestrand', 'neste'],
  // Senere (18)
  ['Drammen', 'senere'], ['Mjøndalen', 'senere'], ['Kongsberg', 'senere'], ['Hønefoss', 'senere'], ['Jevnaker', 'senere'], ['Sandvika', 'senere'],
  ['Oslo', 'senere'], ['Jessheim', 'senere'], ['Ski', 'senere'], ['Drøbak', 'senere'], ['Mysen', 'senere'], ['Fredrikstad', 'senere'],
  ['Halden', 'senere'], ['Horten', 'senere'], ['Sandefjord', 'senere'], ['Porsgrunn', 'senere'], ['Bø', 'senere'], ['Geilo', 'senere'],
];

const FIRST = ['Kari', 'Ola', 'Ingrid', 'Lars', 'Silje', 'Erik', 'Marte', 'Jon', 'Hanne', 'Per', 'Tone', 'Knut', 'Line', 'Geir', 'Anne', 'Tor', 'Randi', 'Svein', 'Mari', 'Arne'];
const LAST = ['Eksempel', 'Prøvesen', 'Testrud', 'Fiktivsen', 'Demoli', 'Utkastvik', 'Malmo', 'Skissebakken', 'Plassholder', 'Navnesen', 'Lånebrygga', 'Oppdiktet'];
const BIZ = ['Gård', 'Korntørke', 'Bakeri AS', 'Gartneri AS', 'Snekkeri AS', 'Hotell AS', 'Vaskeri AS', 'Mølle AS', 'Drivhus AS', 'Verksted AS', 'Kantine AS', 'Sameie'];
const STREETS = ['Eksempelveien', 'Prøvegata', 'Testvegen', 'Fiktivgata', 'Demoveien', 'Lånkevegen', 'Gårdsvegen', 'Kornveien', 'Tankgata', 'Bruveien', 'Lieveien', 'Åsvegen'];
const OBJECTS = ['Korntørke/boliggass', 'Fordamper med tank', 'Gasskjele', 'Tankanlegg med kjele', 'Storkjøkken', 'Veksthus med varmluft'];
const PARTNERS = ['Eksempel Rør AS', 'Fjordgass Service AS', 'Østlandet VVS AS', 'Nordgass Teknikk AS'];
const REMARKS: { text: string; severity: 'avvik' | 'anbefaling' }[] = [
  { text: '50. Merking av utstyr: Avvik. Alle kurser skal være merket.', severity: 'avvik' },
  { text: '29. Statisk elektrisitet: Bør montere punkt til tankbil.', severity: 'anbefaling' },
  { text: '18. Ventilasjon i fyrrom: Avvik. Tilluft er delvis tildekket.', severity: 'avvik' },
  { text: '33. Sikkerhetsavstand: Bør fjerne brennbart lager nær tank.', severity: 'anbefaling' },
  { text: '41. Lekkasjesøk: Avvik. Lekkasje ved flens på fordamper.', severity: 'avvik' },
];
const NOTES = ['Portkode 4512.', 'Hund på tunet – ring før ankomst.', 'Tanken ligger bak låven, kjør inn på østsiden.', 'Nøkkel hos nabo i nr. 14.', 'Parker ved silo, ikke på tunet.', ''];

export function buildDemo(today: string, settings: Settings = defaultSettings()): AppState {
  const r = rng(31417);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const Q0 = quarterOf(today);
  const year = Number(today.slice(0, 4));
  const facilities: Facility[] = [];
  const controls: Control[] = [];

  PLAN.forEach(([place, group], i) => {
    const p = PLACES.find((x) => x.name === place)!;
    const due: Quarter =
      group === 'forfalt' ? addQuarters(Q0, -1 - (i % 2)) : group === 'na' ? Q0 : group === 'neste' ? addQuarters(Q0, 1) : addQuarters(Q0, 2 + Math.floor(r() * 10));
    const last = addDays(quarterStart(addQuarters(due, -16)), 10 + Math.floor(r() * 60));
    const report = addDays(last, 12 + Math.floor(r() * 25));
    const first = pick(FIRST);
    const lastName = pick(LAST);
    const isBiz = r() < 0.55;
    const customer = isBiz ? `${lastName} ${pick(BIZ)}` : `${first} ${lastName}`;
    const street = `${pick(STREETS)} ${1 + Math.floor(r() * 80)}`;
    const postcode = String(p.post[0][0] + Math.floor(r() * Math.min(5, p.post[0][1] - p.post[0][0] + 1))).padStart(4, '0');
    const address = { street, postcode, place };
    const geo = geocode(address);
    const slug = `${first}.${lastName}`.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a');
    const email = `${slug}${i}@example.no`;
    const phone = `4${String(1000000 + Math.floor(r() * 8999999)).slice(0, 7)}`;
    const conf: Record<string, Confidence> = { coords: 'middels' };
    const tankYear = 2010 + Math.floor(r() * 13);
    const f: Facility = {
      id: `a${i + 1}`,
      objectId: String(40000 + i * 37 + 11),
      customer,
      address,
      coords: geo.coords,
      gnr: String(1 + Math.floor(r() * 200)),
      bnr: String(1 + Math.floor(r() * 40)),
      contacts: [
        { name: `${first} ${lastName}`, role: 'representant', email, phone },
        ...(isBiz ? [{ name: customer, role: 'oppdragsgiver' as const, email: null, phone: null }] : []),
      ],
      orgNr: isBiz ? String(900000000 + Math.floor(r() * 99999999)) : null,
      controlType: 'Akkreditert systematisk tilstandskontroll',
      gasType: r() < 0.85 ? 'LPG' : 'CNG / Naturgass',
      facilityType: 'Forbruksanlegg',
      objectType: pick(OBJECTS),
      scope: 'Tank, fordamper og gassfyrt kjele.',
      description: `Anlegget forsynes av en ${r() < 0.5 ? 'nedgravd' : 'overjordisk'} tank på ${(2 + Math.floor(r() * 9)).toString()},${Math.floor(r() * 9)} m3.`,
      tank: { number: String(100000 + Math.floor(r() * 899999)), volume: `${2 + Math.floor(r() * 9)},${Math.floor(r() * 9)} m3`, inServiceYear: tankYear },
      servicePartner: pick(PARTNERS),
      lastControl: last,
      reportDate: report,
      nextDue: due,
      deviations: r() < 0.6 ? [pick(REMARKS), ...(r() < 0.3 ? [pick(REMARKS)] : [])].filter((x, k, a) => a.indexOf(x) === k) : [],
      notes: pick(NOTES),
      blockedPeriods: [],
      durationMin: null,
      sourceFile: `rapport_${40000 + i * 37 + 11}.pdf`,
      confidence: conf,
      flags: [],
      reviewPending: false,
      excerpt: null,
      history: [],
      log: [{ at: `${report}T08:00`, text: 'Importert fra demodata' }],
    };
    facilities.push(f);
    const c = newControl(f.id, due);
    c.id = `k${i + 1}`;
    controls.push(c);
  });

  const F = (i: number) => facilities[i];
  const C = (i: number) => controls[i];

  // 8 anlegg med tank-rekvalifisering innen 2 år (tatt i bruk for 16–17 år siden).
  [6, 13, 20, 27, 34, 41, 48, 55].forEach((i, k) => { F(i).tank!.inServiceYear = year - 17 + (k % 2); });

  // 5 uten e-post.
  [3, 24, 39, 52, 58].forEach((i) => { for (const c of F(i).contacts) c.email = null; });

  // 3 med usikker adresse.
  [22, 40, 51].forEach((i) => {
    const f = F(i);
    f.confidence.coords = 'lav';
    f.confidence.street = 'lav';
    f.flags.push('Usikker adresse: fant bare poststed – kontroller pinnen');
    f.reviewPending = true;
    f.excerpt = `| Adresse | |\n${f.address.street.split(' ')[0]} (gatenummer uleselig), ${f.address.postcode} ${f.address.place}`;
  });

  // 2 med ulogiske datoer.
  {
    const f = F(30);
    const wrong = addDays(f.lastControl!, -9);
    f.flags.push(`Rapportdato ${fmt(wrong)} er før kontrolldato ${fmt(f.lastControl!)}`);
    f.reportDate = wrong;
    f.confidence.reportDate = 'lav';
    f.reviewPending = true;
    f.excerpt = `| Dato kontroll: | ${fmt(f.lastControl!)} |\n| Dato rapport: | ${fmt(wrong)} |`;
  }
  {
    const f = F(44);
    const later = addDays(f.reportDate!, 160);
    f.flags.push(`Servicerapporter: datert ${fmt(later)} er etter mottatt ${fmt(f.lastControl!)} (ulogisk dato)`);
    f.confidence.documents = 'lav';
    f.reviewPending = true;
    f.excerpt = `Dokumentnavn Utarbeidet av Datert Mottatt\n${fmt(addDays(f.lastControl!, -200))}-\nServicerapporter ${f.servicePartner} ${fmt(f.lastControl!)}\n${fmt(later)}`;
  }

  // 1 duplikat: to rapporter med samme Objekt ID – nyeste er gjeldende, eldste er historikk.
  {
    const f = F(10);
    const oldLast = addDays(f.lastControl!, -4 * 365);
    f.history.push({ reportDate: addDays(oldLast, 20), lastControl: oldLast, nextDue: addQuarters(f.nextDue!, -16), sourceFile: `rapport_${f.objectId}_eldre.pdf`, note: 'Eldre rapport (duplikat)' });
    f.log.push({ at: `${f.reportDate}T08:01`, text: `Duplikat: rapport_${f.objectId}_eldre.pdf har samme Objekt ID – lagt i historikk` });
  }

  // Notater og blokkert periode.
  F(7).notes = 'Portkode 2290. Tanken står bak garasjen.';
  F(8).notes = 'Hund på tunet – ring før ankomst.';
  F(8).blockedPeriods.push({ from: addDays(today, 30), to: addDays(today, 44), reason: 'Kunden er bortreist' });

  const state: AppState = { version: 1, facilities, controls, days: [], settings, imports: [] };
  const stamp = nowStamp(today);

  // 5 utsatte med ulike årsaker.
  const post: [number, Control['postponement']][] = [
    [17, { reason: 'Oppgradering', text: 'Ny fordamper monteres', newPeriod: addQuarters(Q0, 1), followUp: addDays(today, 25), requestedBy: 'Kunde (e-post)', requestedAt: stamp, afterDeadline: true }],
    [18, { reason: 'Venter på service', text: 'Venter på årlig service', newPeriod: addQuarters(Q0, 1), followUp: addDays(today, 14), requestedBy: 'Kunde (telefon)', requestedAt: stamp, afterDeadline: true }],
    [20, { reason: 'Kunde ikke tilgjengelig', text: 'Bortreist til januar', newPeriod: addQuarters(Q0, 1), followUp: addDays(today, 40), requestedBy: 'Kunde (telefon)', requestedAt: stamp, afterDeadline: true }],
    [4, { reason: 'Ute av drift', text: 'Anlegget er stengt for vinteren', newPeriod: addQuarters(Q0, 2), followUp: addDays(today, 60), requestedBy: 'Oppdragsgiver', requestedAt: stamp, afterDeadline: true }],
    [36, { reason: 'Annet', text: 'Eierskifte pågår', newPeriod: addQuarters(Q0, 1), followUp: addDays(today, 30), requestedBy: 'Megler', requestedAt: stamp, afterDeadline: false }],
  ];
  for (const [i, p] of post) {
    const c = C(i);
    c.status = 'utsatt';
    c.postponement = p;
    c.postponements.push(p!);
    c.log.push({ at: stamp, text: `Utsatt: ${p!.reason} – ${p!.text}` });
  }

  // Neste kjøredag: to forfalte, bekreftet.
  const nextDay = nextWorkdayOnOrAfter(addDays(today, 1));
  const day = { id: 'd_demo1', date: nextDay, stops: [C(1).id, C(5).id], locked: false, overnight: null };
  state.days.push(day);
  for (const c of [C(1), C(5)]) {
    c.status = 'bekreftet';
    c.plannedDate = nextDay;
    c.responses.push({ type: 'bekreftet', at: stamp });
    c.log.push({ at: stamp, text: 'Bekreftet av kunden' });
  }
  refreshDay(state, day);

  // Ett varslet uten svar i 8 dager – gir purring og «Ring disse».
  const lillestrom = controls.find((c, k) => PLAN[k][0] === 'Lillestrøm' && PLAN[k][1] === 'na')!;
  const visit = addWorkdays(today, 12);
  const d2 = { id: 'd_demo2', date: visit, stops: [lillestrom.id], locked: false, overnight: null };
  state.days.push(d2);
  lillestrom.status = 'varslet';
  refreshDay(state, d2);
  const n = makeNotice(state, lillestrom, 'forvarsel', addDays(today, -8));
  n.status = 'sendt';
  n.sentAt = `${addDays(today, -8)}T08:15`;
  n.createdAt = addDays(today, -9);
  lillestrom.notices.push(n);
  lillestrom.log.push({ at: n.sentAt, text: `Forvarsel sendt til ${n.to}` });

  runAutomations(state);
  return state;
}

function fmt(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
