// Calls the Claude API from the browser with the player's own key. Loaded only when the
// coach voice is switched on, so the SDK is not part of the main bundle.

import Anthropic from '@anthropic-ai/sdk';
import { buildPrompt, unsupportedNumbers, type CoachFacts } from '../../engine/coach/explain';

import { MODEL } from './model';

export type Explanation =
  | { ok: true; text: string }
  | { ok: false; reason: string };

export async function explain(facts: CoachFacts, apiKey: string, signal?: AbortSignal): Promise<Explanation> {
  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 1 });
  const { system, user } = buildPrompt(facts);
  try {
    const res = await client.beta.messages.create(
      {
        model: MODEL,
        max_tokens: 4000,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: user }],
      },
      { signal },
    );
    if (res.stop_reason === 'refusal') return { ok: false, reason: 'Claude declined to write this explanation.' };
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim();
    if (!text) return { ok: false, reason: 'Claude returned an empty explanation.' };
    const extra = unsupportedNumbers(text, facts);
    if (extra.length) return { ok: false, reason: `The explanation used ${extra.length === 1 ? 'a number' : 'numbers'} the trainer did not compute (${extra.join(', ')}), so it was not shown.` };
    return { ok: true, text };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, reason: 'The API key was not accepted. Check it in Settings.' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, reason: 'The API is rate limiting this key. Try again shortly.' };
    if (e instanceof Anthropic.APIUserAbortError) return { ok: false, reason: 'Cancelled.' };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, reason: 'Could not reach the Claude API from this page.' };
    if (e instanceof Anthropic.APIError) return { ok: false, reason: `The Claude API returned an error (${e.status ?? 'unknown'}).` };
    return { ok: false, reason: 'Something went wrong asking Claude.' };
  }
}
