// lib/useCascadeEvents.ts
//
// Subscribes to the existing WebSocket endpoint (wss://chxjyd0lkl...) and
// filters for `cascade_complete` events scoped to the current project. Returns:
//   - active toasts (transient — auto-dismiss after dwell)
//   - tray entries (session-only, last 20)
//   - currently-open summary panel target
//
// Locked semantics from C-design Task #12:
//   - Toast fires only when crossCardLandings.length > 0
//   - Project filter applied client-side (Lambda sends to all of user's open connections)
//   - Tray persistence: session-only, max 20 entries, clears on refresh
//   - WS disconnect: cascade events missed silently; graph state recovers via fresh reads
//
// This is a lightweight subscription. The existing useWebSocket hook is for
// the character-analysis flow; this opens its own connection for cascade.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CascadeEvent, RecentUpdateEntry } from '../components/Freeform';

const MAX_TRAY_ENTRIES = 20;

interface UseCascadeEventsArgs {
  userId: string;
  projectId: string;
  /** Storyid maps to projectId for this app's WS identification convention. */
  storyId?: string;
  /** Resolve a card's display label from cardId. Defaults to cardId itself. */
  resolveCardLabel?: (cardId: string) => string;
  /** Disable subscription entirely (e.g. when REACT_APP_FREEFORM_API_PATH unset for mock-only demos). */
  disabled?: boolean;
}

export interface UseCascadeEventsState {
  isConnected: boolean;
  /** Toasts currently visible (each has its own 5s dwell, managed by CascadeToast). */
  activeToasts: CascadeEvent[];
  /** Tray entries — chronological newest-first. */
  trayEntries: RecentUpdateEntry[];
  /** The cascade event currently open in the summary panel, or null. */
  summaryPanelTarget: CascadeEvent | null;
  /** Dismiss a single toast (e.g. from its ✕). Moves it to the tray. */
  dismissToast: (cardResponseId: string) => void;
  /** Open the summary panel for an event (from a toast OR a tray click). */
  openSummaryPanel: (event: CascadeEvent) => void;
  /** Close the summary panel. */
  closeSummaryPanel: () => void;
  /** Mark tray entries as viewed (clears the unread count). */
  markTrayEntryViewed: (cardResponseId: string) => void;
  /** Clear all viewed entries from the tray. */
  clearViewedFromTray: () => void;
}

export function useCascadeEvents({
  userId,
  projectId,
  storyId,
  resolveCardLabel,
  disabled,
}: UseCascadeEventsArgs): UseCascadeEventsState {
  const [isConnected, setIsConnected] = useState(false);
  const [activeToasts, setActiveToasts] = useState<CascadeEvent[]>([]);
  const [trayEntries, setTrayEntries] = useState<RecentUpdateEntry[]>([]);
  const [summaryPanelTarget, setSummaryPanelTarget] = useState<CascadeEvent | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const collapseToTray = useCallback(
    (event: CascadeEvent) => {
      setActiveToasts((toasts) => toasts.filter((t) => t.cardResponseId !== event.cardResponseId));
      setTrayEntries((entries) => {
        // Prepend, dedupe by cardResponseId, cap at MAX_TRAY_ENTRIES.
        const next: RecentUpdateEntry[] = [
          {
            ...event,
            originatingCardLabel: resolveCardLabel
              ? resolveCardLabel(event.originatingCardId)
              : event.originatingCardId,
            viewed: false,
          },
          ...entries.filter((e) => e.cardResponseId !== event.cardResponseId),
        ];
        return next.slice(0, MAX_TRAY_ENTRIES);
      });
    },
    [resolveCardLabel],
  );

  const dismissToast = useCallback(
    (cardResponseId: string) => {
      setActiveToasts((toasts) => {
        const event = toasts.find((t) => t.cardResponseId === cardResponseId);
        if (event) collapseToTray(event);
        return toasts.filter((t) => t.cardResponseId !== cardResponseId);
      });
    },
    [collapseToTray],
  );

  const openSummaryPanel = useCallback(
    (event: CascadeEvent) => {
      setSummaryPanelTarget(event);
      // Mark corresponding tray entry as viewed.
      setTrayEntries((entries) =>
        entries.map((e) =>
          e.cardResponseId === event.cardResponseId ? { ...e, viewed: true } : e,
        ),
      );
      // Also collapse the active toast (if any) when opening details.
      setActiveToasts((toasts) =>
        toasts.filter((t) => t.cardResponseId !== event.cardResponseId),
      );
    },
    [],
  );

  const closeSummaryPanel = useCallback(() => setSummaryPanelTarget(null), []);

  const markTrayEntryViewed = useCallback((cardResponseId: string) => {
    setTrayEntries((entries) =>
      entries.map((e) => (e.cardResponseId === cardResponseId ? { ...e, viewed: true } : e)),
    );
  }, []);

  const clearViewedFromTray = useCallback(() => {
    setTrayEntries((entries) => entries.filter((e) => !e.viewed));
  }, []);

  useEffect(() => {
    if (disabled) return;
    const wsEndpoint = process.env.REACT_APP_WEBSOCKET_ENDPOINT;
    if (!wsEndpoint) {
      // eslint-disable-next-line no-console
      console.warn('[useCascadeEvents] REACT_APP_WEBSOCKET_ENDPOINT not set; cascade events disabled');
      return;
    }

    let cancelled = false;
    const ws = new WebSocket(wsEndpoint);
    wsRef.current = ws;

    ws.onopen = () => {
      if (cancelled) return;
      setIsConnected(true);
      // Identify ourselves to the WS server using the existing identification convention.
      try {
        ws.send(
          JSON.stringify({
            action: 'identify',
            userId,
            storyId: storyId ?? projectId,
            timestamp: Date.now(),
          }),
        );
      } catch {
        /* ignore — connection may have just dropped */
      }
    };

    ws.onmessage = (raw) => {
      if (cancelled) return;
      try {
        const msg = JSON.parse(raw.data) as Partial<CascadeEvent> & { type?: string };
        if (msg.type !== 'cascade_complete') return;
        // Filter by current project (Lambda sends to all of user's connections regardless).
        if (msg.projectId && msg.projectId !== projectId) return;
        // Only render toast for cross-card landings (per Task #12 lock).
        const event = msg as CascadeEvent;
        if ((event.crossCardLandings?.length ?? 0) === 0) {
          // Focal-only cascade — silent. Still add to tray? Per lock the tray
          // tracks toasts, which only fire on cross-card. Skip tray too.
          return;
        }
        setActiveToasts((toasts) => {
          // Dedupe by cardResponseId in case server retries.
          if (toasts.some((t) => t.cardResponseId === event.cardResponseId)) return toasts;
          return [...toasts, event];
        });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[useCascadeEvents] parse error', e);
      }
    };

    ws.onclose = () => {
      if (cancelled) return;
      setIsConnected(false);
    };

    ws.onerror = () => {
      // eslint-disable-next-line no-console
      console.warn('[useCascadeEvents] WS error');
    };

    return () => {
      cancelled = true;
      try {
        ws.close(1000, 'unmount');
      } catch {
        /* ignore */
      }
      wsRef.current = null;
    };
  }, [userId, projectId, storyId, disabled]);

  return {
    isConnected,
    activeToasts,
    trayEntries,
    summaryPanelTarget,
    dismissToast,
    openSummaryPanel,
    closeSummaryPanel,
    markTrayEntryViewed,
    clearViewedFromTray,
  };
}
