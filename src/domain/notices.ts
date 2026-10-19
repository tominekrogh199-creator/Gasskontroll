// Varsler: maler med flettefelt, sendedatoer i virkedager, automatiske utkast, purring og «Ring disse».
import type { AppState, Control, Notice, NoticeKind, Settings, Templates } from './types';
import { addDays, addWorkdays, fmtDate, fmtDateWeekday, fmtQuarter, isWorkday, nextWorkdayOnOrAfter, prevWorkdayOnOrBefore } from './dates';
import { facilityOf, logBoth, primaryContact, recipient, setStatus, todayOf, uid } from './controls';

export const DEFAULT_TEMPLATES: Templates = {
  forvarsel:
    'Hei {kunde}.\n\nDen akkrediterte kontrollen av gassanlegget på {anleggsadresse} forfaller i {kvartal}. Vi foreslår {dato} kl. {tidsrom}. Kontrollen tar ca. 1,5 time.\n\nHa gjerne klart servicerapporter, siste kontrollrapport for tanken og drifts- og sikkerhetsinstrukser.\n\nPasser tidspunktet? Svar på denne e-posten eller ring {telefon}.\n\nVennlig hilsen\n{kontrollør}',
  forvarselKvartal:
    'Hei {kunde}.\n\nDen akkrediterte kontrollen av gassanlegget på {anleggsadresse} forfaller i {kvartal}. Vi tar kontakt med forslag til dag og tidspunkt. Kontrollen tar ca. 1,5 time.\n\nHa gjerne klart servicerapporter, siste kontrollrapport for tanken og drifts- og sikkerhetsinstrukser.\n\nEr det perioder som ikke passer? Svar på denne e-posten eller ring {telefon}.\n\nVennlig hilsen\n{kontrollør}',
  paminnelse:
    'Hei {kunde}.\n\nPåminnelse om akkreditert kontroll av gassanlegget på {anleggsadresse} {dato} kl. {tidsrom}.\n\nHa gjerne klart servicerapporter, siste kontrollrapport for tanken og drifts- og sikkerhetsinstrukser. Gi beskjed på {telefon} hvis tidspunktet ikke lenger passer.\n\nVennlig hilsen\n{kontrollør}',
  purring:
    'Hei {kunde}.\n\nVi har ikke fått svar på forslaget om kontroll av gassanlegget på {anleggsadresse} {dato} kl. {tidsrom}. Kontrollen forfaller i {kvartal}.\n\nKan du bekrefte tidspunktet eller foreslå et annet? Svar på denne e-posten eller ring {telefon}.\n\nVennlig hilsen\n{kontrollør}',
};

export const MERGE_FIELDS = ['{kunde}', '{anleggsadresse}', '{dato}', '{tidsrom}', '{kvartal}', '{kontrollør}', '{telefon}'];

export function merge(template: string, fields: Record<string, string>): string {
  return template.replace(/\{([a-zæøå]+)\}/g, (m, k) => (k in fields ? fields[k] : m));
}

export function mergeFields(state: AppState, c: Control): Record<string, string> {
  const f = facilityOf(state, c);
  const s = state.settings;
  const contact = primaryContact(f);
  return {
    kunde: contact?.name || f.customer,
    anleggsadresse: `${f.address.street}, ${f.address.postcode} ${f.address.place}`,
    dato: c.plannedDate ? fmtDateWeekday(c.plannedDate) : '(dato ikke satt)',
    tidsrom: c.timeFrom && c.timeTo ? `${c.timeFrom.replace(':', '.')}–${c.timeTo.replace(':', '.')}` : '(tid ikke satt)',
    kvartal: fmtQuarter(c.due),
    kontrollør: s.inspectorName,
    telefon: s.inspectorPhone,
  };
}

const SUBJECTS: Record<NoticeKind, string> = {
  forvarsel: 'Akkreditert kontroll av gassanlegg – forslag til tidspunkt',
  paminnelse: 'Påminnelse: kontroll av gassanlegg',
  purring: 'Purring: kontroll av gassanlegg',
};

// ---------- Sendedatoer ----------

/** Forvarsel: ca. N dager før besøket, flyttet til virkedag. Aldri tidligere enn én virkedag etter i dag. */
export function preNoticeSendDate(visit: string, today: string, s: Pick<Settings, 'preNoticeDays' | 'blockedDays'>): string {
  const ideal = prevWorkdayOnOrBefore(addDays(visit, -s.preNoticeDays), s.blockedDays);
  const min = addWorkdays(today, 1, s.blockedDays);
  return ideal < min ? min : ideal;
}

/** Påminnelse: N virkedager før besøket. Helger og norske helligdager telles ikke. */
export function reminderSendDate(visit: string, s: Pick<Settings, 'reminderWorkdays' | 'blockedDays'>): string {
  return addWorkdays(visit, -s.reminderWorkdays, s.blockedDays);
}

// ---------- Utkast ----------

export function makeNotice(state: AppState, c: Control, kind: NoticeKind, sendDate: string, quarterOnly = false): Notice {
  const f = facilityOf(state, c);
  const r = recipient(f);
  const t = state.settings.templates;
  const tpl = kind === 'forvarsel' ? (quarterOnly ? t.forvarselKvartal : t.forvarsel) : kind === 'paminnelse' ? t.paminnelse : t.purring;
  return {
    id: uid('n'),
    controlId: c.id,
    kind,
    quarterOnly,
    to: r?.contact.email ?? null,
    toLabel: r ? `${r.contact.name} – ${r.reason}` : 'Ingen e-post registrert',
    subject: SUBJECTS[kind],
    body: merge(tpl, mergeFields(state, c)),
    sendDate,
    status: 'utkast',
    createdAt: todayOf(state.settings),
    sentAt: null,
    edited: false,
  };
}

export function regenerate(state: AppState, n: Notice): void {
  const c = state.controls.find((x) => x.id === n.controlId);
  if (!c) return;
  const fresh = makeNotice(state, c, n.kind, n.sendDate, n.quarterOnly);
  n.body = fresh.body;
  n.to = fresh.to;
  n.toLabel = fresh.toLabel;
  n.subject = fresh.subject;
}

function active(c: Control, kind: NoticeKind): Notice | undefined {
  return c.notices.find((n) => n.kind === kind && n.status !== 'stoppet');
}

/**
 * Kjøres ved oppstart og etter hver endring. Idempotent:
 * – lager forvarsel for planlagte kontroller (eller «Ring disse» når e-post mangler)
 * – lager påminnelse for varslede/bekreftede
 * – lager purring og «Ring disse» når kunden ikke har svart etter N dager
 * – oppdaterer usendte, uredigerte utkast når dato/tid endres
 */
export function runAutomations(state: AppState): void {
  const s = state.settings;
  const today = todayOf(s);
  for (const c of state.controls) {
    if (c.adhocLabel) continue;
    const f = facilityOf(state, c);
    const hasEmail = !!recipient(f);
    if (c.status === 'planlagt' && c.plannedDate) {
      const fv = active(c, 'forvarsel');
      if (!fv) {
        if (hasEmail) c.notices.push(makeNotice(state, c, 'forvarsel', preNoticeSendDate(c.plannedDate, today, s)));
        else if (!c.callReason) c.callReason = 'Mangler e-post – ring for å avtale tid';
      } else if (fv.status !== 'sendt') {
        const want = preNoticeSendDate(c.plannedDate, fv.createdAt > today ? fv.createdAt : today, s);
        if (fv.status === 'utkast' && fv.sendDate !== want && want > fv.sendDate) fv.sendDate = want;
        if (!fv.edited) regenerate(state, fv);
      }
    }
    if ((c.status === 'varslet' || c.status === 'bekreftet') && c.plannedDate && hasEmail) {
      const rem = active(c, 'paminnelse');
      const want = reminderSendDate(c.plannedDate, s);
      if (!rem && want >= today) c.notices.push(makeNotice(state, c, 'paminnelse', want));
      else if (rem && rem.status !== 'sendt') {
        if (rem.sendDate !== want) rem.sendDate = want;
        if (!rem.edited) regenerate(state, rem);
      }
    }
    if (c.status === 'varslet') {
      const fv = c.notices.find((n) => n.kind === 'forvarsel' && n.status === 'sendt');
      const answered = c.responses.some((r) => r.type !== 'ingen_svar' && fv?.sentAt && r.at.slice(0, 10) >= fv.sentAt.slice(0, 10));
      if (fv?.sentAt && !answered && today >= addDays(fv.sentAt.slice(0, 10), s.chaseDays)) {
        chase(state, c, `Ingen svar på forvarsel sendt ${fmtDate(fv.sentAt.slice(0, 10))}`);
      }
    }
  }
}

/** Lager purreutkast og legger kunden i «Ring disse». */
export function chase(state: AppState, c: Control, reason: string): void {
  const s = state.settings;
  const today = todayOf(s);
  const f = facilityOf(state, c);
  if (!c.callReason) {
    c.callReason = reason;
    logBoth(state, c, `Lagt i «Ring disse»: ${reason}`);
  }
  if (recipient(f) && !active(c, 'purring')) {
    const send = isWorkday(today, s.blockedDays) ? addWorkdays(today, 1, s.blockedDays) : nextWorkdayOnOrAfter(today, s.blockedDays);
    c.notices.push(makeNotice(state, c, 'purring', send));
    logBoth(state, c, 'Purreutkast laget');
  }
}

// ---------- Handlinger ----------

export function approve(state: AppState, n: Notice): void {
  if (n.status !== 'utkast') return;
  n.status = 'godkjent';
  const c = state.controls.find((x) => x.id === n.controlId);
  if (c) logBoth(state, c, `${kindLabel(n.kind)} godkjent (sendes ${fmtDate(n.sendDate)})`);
}

export function stopNotice(state: AppState, n: Notice): void {
  if (n.status === 'sendt') return;
  n.status = 'stoppet';
  const c = state.controls.find((x) => x.id === n.controlId);
  if (c) logBoth(state, c, `${kindLabel(n.kind)} stoppet`);
}

/** Kalles først når brukeren bekrefter at e-posten faktisk er sendt. */
export function markSent(state: AppState, n: Notice): void {
  const s = state.settings;
  const today = todayOf(s);
  n.status = 'sendt';
  n.sentAt = `${today}T${new Date().toTimeString().slice(0, 5)}`;
  const c = state.controls.find((x) => x.id === n.controlId);
  if (!c) return;
  logBoth(state, c, `${kindLabel(n.kind)} sendt til ${n.to ?? 'ukjent'}`);
  if (n.kind === 'forvarsel' && c.status === 'planlagt') setStatus(state, c, 'varslet');
  if (n.kind === 'purring') c.callReason = c.callReason ?? 'Purring sendt – ring hvis ingen svar';
  runAutomations(state);
}

export function kindLabel(k: NoticeKind): string {
  return { forvarsel: 'Forvarsel', paminnelse: 'Påminnelse', purring: 'Purring' }[k];
}

export interface InboxItem { notice: Notice; control: Control }

export function allNotices(state: AppState): InboxItem[] {
  return state.controls.flatMap((c) => c.notices.map((notice) => ({ notice, control: c })));
}

export function draftsToApprove(state: AppState): InboxItem[] {
  return allNotices(state)
    .filter((x) => x.notice.status === 'utkast')
    .sort((a, b) => a.notice.sendDate.localeCompare(b.notice.sendDate));
}

export function readyToSend(state: AppState): InboxItem[] {
  const today = todayOf(state.settings);
  return allNotices(state)
    .filter((x) => x.notice.status === 'godkjent' && x.notice.sendDate <= today)
    .sort((a, b) => a.notice.sendDate.localeCompare(b.notice.sendDate));
}

/** Utkast som ikke er godkjent på sendedagen – vises rødt på Hjem. */
export function lateDrafts(state: AppState): InboxItem[] {
  const today = todayOf(state.settings);
  return draftsToApprove(state).filter((x) => x.notice.sendDate <= today);
}

export function awaitingResponse(state: AppState): Control[] {
  return state.controls.filter((c) => c.status === 'varslet');
}

export function callList(state: AppState): Control[] {
  return state.controls.filter((c) => c.callReason && c.status !== 'utfort' && c.status !== 'utsatt');
}
