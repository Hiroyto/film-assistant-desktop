// components/AiPauseBanner.tsx
//
// Standing notice while the free-tier AI pause is on (FIL-663 / FIL-664). The
// message is the server's (models/aiPause.ts). Dismissing hides this message
// until a different one arrives; the pause itself is the server's call.

import { useState, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { getAiPause, subscribeAiPause } from '../models/aiPause';

const CONTACT = 'ben@filmassistant.io';

export default function AiPauseBanner() {
  const pause = useSyncExternalStore(subscribeAiPause, getAiPause);
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (!pause) return null;
  const key = `${pause.code}|${pause.message}`;
  if (dismissed === key) return null;

  const [before, after] = pause.message.split(CONTACT);
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border border-[#ff8c42]/40 bg-neutral-900/95 px-4 py-3 text-sm leading-relaxed text-neutral-200 shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-start gap-3">
        <p className="flex-1">
          {before}
          {after !== undefined && (
            <>
              <a href={`mailto:${CONTACT}`} className="text-[#ff8c42] underline underline-offset-2">{CONTACT}</a>
              {after}
            </>
          )}
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => setDismissed(key)}
          className="mt-0.5 text-neutral-400 hover:text-neutral-200"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
