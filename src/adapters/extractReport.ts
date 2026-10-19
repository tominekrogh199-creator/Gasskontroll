// Adapter: rapporttekst → strukturerte felt.
// Alltid: regex for faste felt + regelbasert uttrekk (reportParser).
// Valgfritt: AI (Claude) for resten, når en API-nøkkel er lagt inn i innstillinger. Kun utdraget (side 1–2 og
// merknadene) sendes – aldri hele rapporten. AI returnerer bare JSON etter et fast skjema, med null for ukjent.
// Er regex og AI uenige, settes sikkerheten til lav.
import { FIELD_KEYS, REGEX_FIELDS, parseReport, validate, type FieldKey, type ParsedReport } from '../domain/reportParser';
import type { Confidence, Settings } from '../domain/types';

export interface ExtractOutcome { parsed: ParsedReport; usedAI: boolean; aiError: string | null }

const AI_FIELDS = FIELD_KEYS.filter((k) => k !== 'lastIndependentReport');

function schema() {
  const field = {
    type: 'object',
    properties: {
      value: { type: ['string', 'null'] },
      confidence: { type: 'string', enum: ['høy', 'middels', 'lav'] },
    },
    required: ['value', 'confidence'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    properties: Object.fromEntries(AI_FIELDS.map((k) => [k, field])),
    required: [...AI_FIELDS],
    additionalProperties: false,
  };
}

const SYSTEM = `Du leser utdrag av norske kontrollrapporter for gassanlegg. Tabeller kan være stokket: etiketter og verdier kan stå på ulike linjer.
Returner kun JSON etter skjemaet. Bruk null når verdien ikke står i teksten – aldri gjett. Datoer som dd.mm.åååå slik de står.
nextDueQ er tallet 1–4 og nextDueYear året fra «Neste akkrediterte kontroll av anlegget». customer er kundens navn.
servicePartner er firmaet som har utarbeidet servicerapportene. confidence er din sikkerhet for hvert felt.`;

async function callAI(excerpt: string, s: Settings): Promise<Record<string, { value: string | null; confidence: Confidence }>> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true });
  const req: any = {
    model: s.aiModel || 'claude-opus-5-5',
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: schema() } },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages: [{ role: 'user', content: excerpt }],
  };
  const res: any = await client.beta.messages.create(req);
  if (res.stop_reason === 'refusal') throw new Error('Modellen avslo forespørselen');
  const text = (res.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

const norm = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export async function extractReport(text: string, s: Settings): Promise<ExtractOutcome> {
  const parsed = parseReport(text);
  if (!s.apiKey) return { parsed, usedAI: false, aiError: null };
  try {
    const ai = await callAI(parsed.excerpt, s);
    for (const k of AI_FIELDS as FieldKey[]) {
      const a = ai[k];
      if (!a) continue;
      const cur = parsed.fields[k];
      if (REGEX_FIELDS.includes(k)) {
        // Regex vinner, men uenighet gir lav sikkerhet.
        if (cur.value && a.value && norm(cur.value) !== norm(a.value)) cur.confidence = 'lav';
        if (!cur.value && a.value) parsed.fields[k] = { value: a.value, confidence: 'lav', source: 'ai' };
      } else if (a.value) {
        const disagree = cur.value && norm(cur.value) !== norm(a.value);
        parsed.fields[k] = { value: a.value, confidence: disagree ? 'lav' : a.confidence, source: 'ai', line: cur.line };
      }
    }
    parsed.flags = validate(parsed);
    return { parsed, usedAI: true, aiError: null };
  } catch (e: any) {
    return { parsed, usedAI: false, aiError: e?.message ?? String(e) };
  }
}
