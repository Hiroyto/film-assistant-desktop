// components/Freeform/RecentUpdatesTray.tsx
//
// The Recent updates tray pill + expanded panel. Lives in the bottom toolbar
// alongside the Extracting (N) indicator. Locked in Task #12:
//   - Pill hidden when 0 cascades (no "Recent updates (0)" cluttering)
//   - Click pill → panel expands upward listing recent cascades chronologically
//   - Session-only persistence (last 20), auto-clears on page refresh
//   - "Clear viewed" button removes already-clicked entries
//   - Each row: glasses icon + count + originating card name + relative time

import React, { useState } from 'react';
import InternIcon from './InternIcon';
import type { CascadeEvent } from './types';

export interface RecentUpdateEntry extends CascadeEvent {
  /** The originating card's display name (e.g., "the Detective") — resolved on the FE. */
  originatingCardLabel: string;
  /** Has the writer clicked into this entry? */
  viewed: boolean;
}

interface RecentUpdatesTrayProps {
  /** Cascade entries — most recent first, capped at 20 per Task #12 lock. */
  entries: RecentUpdateEntry[];
  /** Fires when writer clicks an entry row → open summary panel for that cascade. */
  onEntryClick: (entry: RecentUpdateEntry) => void;
  /** Fires when writer clicks "Clear viewed". */
  onClearViewed: () => void;
}

/** Render a relative time like "just now", "5 min ago", "2 hr ago". */
function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const RecentUpdatesTray: React.FC<RecentUpdatesTrayProps> = ({
  entries,
  onEntryClick,
  onClearViewed,
}) => {
  const [expanded, setExpanded] = useState(false);

  // Hide pill entirely when 0 entries.
  if (entries.length === 0) return null;

  const unviewedCount = entries.filter((e) => !e.viewed).length;
  const displayCount = unviewedCount > 0 ? unviewedCount : entries.length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bgdark2 hover:bg-glassBg text-fontWhite07 text-sm transition-colors"
        aria-expanded={expanded}
      >
        <InternIcon size={14} />
        <span>Recent updates ({displayCount})</span>
        <span aria-hidden className="text-xs">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <div
          className="absolute bottom-full right-0 mb-2 w-96 rounded-md p-3"
          style={{
            background: 'linear-gradient(135deg, rgba(40,50,60,0.98) 0%, rgba(35,45,55,0.98) 100%)',
            border: '1px solid rgba(84, 191, 219, 0.3)',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          }}
        >
          <div className="text-xs uppercase tracking-wider text-fontGray mb-2">Recent updates</div>
          <ul className="space-y-2 max-h-80 overflow-y-auto">
            {entries.map((entry) => {
              const previewEntities = entry.newEntities.slice(0, 3).map((e) => e.workingName);
              const overflow = entry.newEntities.length - previewEntities.length;
              return (
                <li
                  key={entry.cardResponseId}
                  className={`p-2 rounded hover:bg-glassBg cursor-pointer ${
                    entry.viewed ? 'opacity-60' : ''
                  }`}
                  onClick={() => onEntryClick(entry)}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 text-peerBlueLight text-xs">
                      <InternIcon size={12} />
                      <span>{entry.newEntities.length} new</span>
                      <span className="text-fontGray">·</span>
                      <span className="text-fontWhite07">{entry.originatingCardLabel}</span>
                    </div>
                    <span className="text-[11px] text-fontGray">{relativeTime(entry.emittedAt)}</span>
                  </div>
                  <div className="text-[12px] text-fontWhite truncate">
                    {previewEntities.join(', ')}
                    {overflow > 0 && <span className="text-fontGray">, +{overflow}</span>}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 pt-2 border-t border-glassBg flex justify-end">
            <button
              type="button"
              onClick={onClearViewed}
              className="text-xs text-fontGray hover:text-fontWhite"
            >
              Clear viewed
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RecentUpdatesTray;
