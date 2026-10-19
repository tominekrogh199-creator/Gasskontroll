// Adapter: sending av e-post.
// Prototypen åpner e-postappen ferdig utfylt (mailto). Varselet merkes som sendt først når brukeren bekrefter.
// En ekte tjeneste (f.eks. Microsoft Graph eller SMTP via backend) kan kobles på her.
import type { Notice } from '../domain/types';

export function mailtoUrl(n: Pick<Notice, 'to' | 'subject' | 'body'>): string {
  return `mailto:${encodeURIComponent(n.to ?? '')}?subject=${encodeURIComponent(n.subject)}&body=${encodeURIComponent(n.body)}`;
}

export async function sendEmail(n: Notice): Promise<'opened'> {
  window.location.href = mailtoUrl(n);
  return 'opened';
}

export async function copyText(n: Pick<Notice, 'to' | 'subject' | 'body'>): Promise<boolean> {
  const text = `Til: ${n.to ?? ''}\nEmne: ${n.subject}\n\n${n.body}`;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
