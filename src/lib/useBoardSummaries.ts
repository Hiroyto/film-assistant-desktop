// Card counts for the stories list. One request covers every story the writer
// owns; the last answer is kept in memory so moving between Home and Profile
// draws the breakdowns at once and refreshes underneath. A failed read (an
// older backend without the route, a network blip) leaves the list without
// breakdowns, never broken.

import { useEffect, useState } from 'react';
import { listBoardSummaries, type BoardSummary } from './freeformApi';
import { markStoryWorkflow } from './storyWorkflows';

let lastSummaries: Record<string, BoardSummary> | null = null;

export function useBoardSummaries(token: any, works: Record<string, any> | undefined | null) {
  const [summaries, setSummaries] = useState<Record<string, BoardSummary> | null>(lastSummaries);
  // Refetch when the set of stories changes (create, delete), not on every
  // works object identity change.
  const idsKey = Object.keys(works ?? {}).sort().join('|');
  const tokenStr = token ? token.toString() : '';

  useEffect(() => {
    if (!tokenStr || !idsKey) return;
    let cancelled = false;
    listBoardSummaries(tokenStr)
      .then((res) => {
        if (cancelled) return;
        lastSummaries = res?.summaries ?? {};
        // A story with a board is a corkboard. Records often carry no
        // workflow field, and the per-device fallback is empty on a browser
        // that never opened the story, which would send it to the outline
        // editor. Teach the fallback so every surface routes it right.
        for (const id of Object.keys(lastSummaries)) markStoryWorkflow(id, 'freeform');
        setSummaries(lastSummaries);
      })
      .catch(() => {
        if (!cancelled && !lastSummaries) setSummaries({});
      });
    return () => { cancelled = true; };
  }, [tokenStr, idsKey]);

  return summaries;
}
