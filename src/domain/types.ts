// Datamodell for Kontrollplan. Alle datoer lagres som ISO-strenger «ÅÅÅÅ-MM-DD».

export type Confidence = 'høy' | 'middels' | 'lav';
export type CoordSource = 'import' | 'ca' | 'manuell';
export type ContactRole = 'representant' | 'oppdragsgiver' | 'eier';

export interface Quarter { q: 1 | 2 | 3 | 4; year: number }

export interface Coords { lat: number; lng: number; source: CoordSource }

export interface Contact {
  name: string;
  email: string | null;
  phone: string | null;
  role: ContactRole;
}

export interface Tank {
  number: string | null;
  volume: string | null;
  inServiceYear: number | null;
}

export interface Deviation {
  text: string;
  severity: 'avvik' | 'anbefaling' | null;
}

export interface Period { from: string; to: string; reason?: string }

export interface LogEntry { at: string; text: string }

export interface ReportHistory {
  reportDate: string | null;
  lastControl: string | null;
  nextDue: Quarter | null;
  sourceFile: string | null;
  note?: string;
}

export interface Facility {
  id: string;
  objectId: string;
  customer: string;
  address: { street: string; postcode: string; place: string };
  coords: Coords | null;
  gnr: string | null;
  bnr: string | null;
  contacts: Contact[];
  orgNr: string | null;
  controlType: string | null;
  gasType: string | null;
  facilityType: string | null;
  objectType: string | null;
  scope: string | null;
  description: string | null;
  tank: Tank | null;
  servicePartner: string | null;
  lastControl: string | null;
  reportDate: string | null;
  nextDue: Quarter | null;
  deviations: Deviation[];
  notes: string;
  blockedPeriods: Period[];
  durationMin: number | null; // overstyrer standard kontrolltid
  sourceFile: string | null;
  confidence: Record<string, Confidence>;
  flags: string[]; // f.eks. ulogiske datoer fra importen
  reviewPending: boolean;
  excerpt: string | null; // utdrag fra rapporten, til gjennomgang
  history: ReportHistory[];
  log: LogEntry[];
  adhoc?: boolean;
}

export type ControlStatus = 'ikke_planlagt' | 'planlagt' | 'varslet' | 'bekreftet' | 'utfort' | 'utsatt';

export const STATUS_LABEL: Record<ControlStatus, string> = {
  ikke_planlagt: 'Ikke planlagt',
  planlagt: 'Planlagt',
  varslet: 'Varslet',
  bekreftet: 'Bekreftet',
  utfort: 'Utført',
  utsatt: 'Utsatt',
};

export type NoticeKind = 'forvarsel' | 'paminnelse' | 'purring';
export type NoticeStatus = 'utkast' | 'godkjent' | 'sendt' | 'stoppet';

export interface Notice {
  id: string;
  controlId: string;
  kind: NoticeKind;
  quarterOnly: boolean;
  to: string | null;
  toLabel: string;
  subject: string;
  body: string;
  sendDate: string;
  status: NoticeStatus;
  createdAt: string;
  sentAt: string | null;
  edited: boolean;
}

export type ResponseType = 'bekreftet' | 'ny_tid' | 'utsettelse' | 'ingen_svar';

export interface CustomerResponse { type: ResponseType; at: string; note?: string }

export type PostponeReason = 'Oppgradering' | 'Venter på service' | 'Kunde ikke tilgjengelig' | 'Ute av drift' | 'Annet';

export interface Postponement {
  reason: PostponeReason;
  text: string;
  newPeriod: Quarter;
  followUp: string;
  requestedBy: string;
  requestedAt: string;
  afterDeadline: boolean;
}

export interface Control {
  id: string;
  facilityId: string;
  due: Quarter;
  status: ControlStatus;
  plannedDate: string | null;
  timeFrom: string | null;
  timeTo: string | null;
  notices: Notice[];
  responses: CustomerResponse[];
  postponement: Postponement | null;
  postponements: Postponement[];
  completedAt: string | null;
  callReason: string | null; // satt når kontrollen står i «Ring disse»
  log: LogEntry[];
  adhocLabel?: string;
}

export interface PlanDay {
  id: string;
  date: string;
  stops: string[]; // kontroll-id-er i kjørerekkefølge
  locked: boolean;
  overnight: 'ut' | 'hjem' | null; // del av en tur med overnatting
}

export interface Templates { forvarsel: string; forvarselKvartal: string; paminnelse: string; purring: string }

export interface Settings {
  baseName: string;
  baseLat: number;
  baseLng: number;
  dayStart: string;
  dayEnd: string;
  lunchMin: number;
  controlMin: number;
  maxPerDay: number;
  maxDriveMin: number;
  preNoticeDays: number;
  reminderWorkdays: number;
  chaseDays: number;
  followUpDays: number;
  earlyMaxMin: number;
  inspectorName: string;
  inspectorPhone: string;
  inspectorEmail: string;
  templates: Templates;
  blockedDays: string[];
  testDate: string | null;
  apiKey: string;
  aiModel: string;
}

export interface ImportJob {
  id: string;
  fileName: string;
  status: 'venter' | 'leser' | 'ferdig' | 'feil';
  message: string;
  facilityId: string | null;
}

export interface AppState {
  version: number;
  facilities: Facility[];
  controls: Control[];
  days: PlanDay[];
  settings: Settings;
  imports: ImportJob[];
}
