import { useState } from 'preact/hooks';
import { update, useAppState } from '../store';
import { Sheet, tap, useNav } from './components';
import { applyRouteDraft, draftFromIds, replyRuleBased, type RouteDraft } from '../domain/assistant';
import { askPlanner } from '../adapters/askPlanner';
import { fmtDateWeekday, minutesToClock } from '../domain/dates';

interface Msg { role: 'user' | 'assistant'; text: string; draft: RouteDraft | null }

const memory: Msg[] = [];

export function ChatSheet({ onClose }: { onClose: () => void }) {
  const state = useAppState();
  const nav = useNav();
  const [msgs, setMsgs] = useState<Msg[]>(memory);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const limited = !state.settings.apiKey;

  const push = (m: Msg) => {
    memory.push(m);
    setMsgs([...memory]);
  };

  const send = async () => {
    const q = text.trim();
    if (!q || busy) return;
    setText('');
    push({ role: 'user', text: q, draft: null });
    setBusy(true);
    tap(8);
    const rule = replyRuleBased(state, q);
    let answer = rule.text;
    let draft = rule.draft;
    if (state.settings.apiKey) {
      try {
        const ai = await askPlanner(q, rule.facts, rule.allowedIds, state.settings);
        if (ai?.text) answer = ai.text;
        if (ai && ai.controlIds.length && rule.draft) {
          const checked = draftFromIds(state, rule.draft.date, ai.controlIds);
          if (checked) draft = checked;
        }
      } catch {
        answer = rule.text;
      }
    } else {
      answer = `AI-svar er begrenset uten nøkkel. ${rule.text}`;
    }
    push({ role: 'assistant', text: answer, draft });
    setBusy(false);
  };

  const useDraft = (draft: RouteDraft) => {
    update((s) => applyRouteDraft(s, draft));
    tap(18);
    nav.toast(`${draft.controlIds.length} stopp lagt på ${fmtDateWeekday(draft.date)}`);
    onClose();
  };

  return (
    <Sheet title="Spør" sub={limited ? 'Uten nøkkel brukes rute-reglene' : 'Claude foreslår, reglene regner'} onClose={onClose}>
      <div class="chatlog">
        {msgs.length === 0 && (
          <div class="bubble assist">
            Spør om dagen. For eksempel «hvor mange stopp rekker jeg i dag?», «anbefal 3–4 kunder innen 2 timer» eller «lag en rute for i dag med 3 stopp».
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} class={m.role === 'user' ? 'bubble me' : 'bubble assist'}>
            {m.text}
            {m.draft && (
              <div class="chatdraft">
                <div class="muted small">{fmtDateWeekday(m.draft.date)} · hjemme ca. {minutesToClock(m.draft.endMin)}</div>
                {m.draft.lines.map((line) => <div key={line}>{line}</div>)}
                <button class="btn primary block mt8" onClick={() => useDraft(m.draft!)}>Bruk denne ruta</button>
              </div>
            )}
          </div>
        ))}
        {busy && <div class="bubble assist">Regner…</div>}
      </div>
      <form class="chatbar" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input class="inp" value={text} placeholder="Skriv et spørsmål" onInput={(e) => setText(e.currentTarget.value)} />
        <button class="btn primary" type="submit" disabled={busy || !text.trim()}>Send</button>
      </form>
    </Sheet>
  );
}
