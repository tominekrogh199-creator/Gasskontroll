// Valgfri språkmodell. Kjøretid, dato og kapasitet er allerede regnet ut.
// Modellen kan bare velge blant kontroll-idene koden har funnet.
import type { Settings } from '../domain/types';

export async function askPlanner(question: string, facts: string, allowedIds: string[], settings: Settings): Promise<{ text: string; controlIds: string[] } | null> {
  if (!settings.apiKey) return null;
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true });
  const system = `Du hjelper én kontrollør med kjøredagen. Svar på norsk, kort, maks fire setninger.
Bruk bare faktaene. Ikke finn på kunder, klokkeslett eller kjøretider.
controlIds skal være en delmengde av de tillatte id-ene. Tom liste hvis du ikke foreslår en rute.
Returner bare JSON: {"text":"...","controlIds":["id"]}`;
  const res: any = await client.messages.create({
    model: settings.aiModel || 'claude-opus-5-5',
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: `Spørsmål: ${question}\n\nTillatte id-er: ${allowedIds.join(', ') || '(ingen)'}\n\nFakta:\n${facts}` }],
  });
  const raw = (res.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  const parsed = JSON.parse(json) as { text?: string; controlIds?: string[] };
  const controlIds = (parsed.controlIds ?? []).filter((id) => allowedIds.includes(id));
  return { text: (parsed.text ?? '').trim(), controlIds };
}
