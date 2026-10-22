// models/aiPause.ts
//
// The free-tier AI pause (FIL-663 / FIL-664) as the browser learns it: the
// backend refuses a gated request with ai_paused_user or ai_paused_global, or
// saves a card answer and reports extractionPaused. Background scene sync is
// refused silently (apiHelpers.ts), so without this the writer would keep
// writing while the board quietly stopped updating. One shared value, shown
// by AiPauseBanner.

export type AiPauseCode = 'ai_paused_user' | 'ai_paused_global';

export interface AiPause {
  code: AiPauseCode;
  message: string;
}

// Used only when a response carries the code without the server's message.
const DEFAULT_MESSAGE: Record<AiPauseCode, string> = {
  ai_paused_user: "You've reached this month's free limit for board building and the Peer. Your pages and boards are all here, and writing still saves.",
  ai_paused_global: 'Board building and the Peer are paused for a little while. Your writing still saves.',
};

let current: AiPause | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function isAiPauseCode(code: unknown): code is AiPauseCode {
  return code === 'ai_paused_user' || code === 'ai_paused_global';
}

export function markAiPaused(code: unknown, message?: string) {
  if (!isAiPauseCode(code)) return;
  const next: AiPause = { code, message: message || DEFAULT_MESSAGE[code] };
  if (current?.code === next.code && current.message === next.message) return;
  current = next;
  notify();
}

/** A gated call went through, so whatever paused it has lifted. */
export function clearAiPause() {
  if (!current) return;
  current = null;
  notify();
}

export const getAiPause = () => current;

export function subscribeAiPause(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
