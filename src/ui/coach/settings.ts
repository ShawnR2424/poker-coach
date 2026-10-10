// Settings for the optional Claude explanations: off by default. The API key is the player's
// own and stays in this browser's localStorage; it is sent only to the Claude API.

import { useSyncExternalStore } from 'react';

export interface CoachSettings {
  enabled: boolean;
  apiKey: string;
}

const KEY = 'coach-voice:v1';
const DEFAULTS: CoachSettings = { enabled: false, apiKey: '' };
let settings: CoachSettings = load();
const listeners = new Set<() => void>();

function load(): CoachSettings {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<CoachSettings> | null;
    if (d && typeof d === 'object') return { enabled: d.enabled === true, apiKey: typeof d.apiKey === 'string' ? d.apiKey : '' };
  } catch {
    /* unreadable or unavailable: use the defaults */
  }
  return DEFAULTS;
}

export function setCoachSettings(patch: Partial<CoachSettings>) {
  settings = { ...settings, ...patch };
  try {
    if (!settings.enabled && !settings.apiKey) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(settings));
  } catch { /* storage unavailable: keep it in memory */ }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useCoachSettings = (): CoachSettings => useSyncExternalStore(subscribe, () => settings);

/** True when explanations should be requested. */
export const coachVoiceOn = (s: CoachSettings) => s.enabled && s.apiKey.trim().length > 0;
