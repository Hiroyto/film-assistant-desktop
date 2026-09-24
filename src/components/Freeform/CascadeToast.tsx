// components/Freeform/CascadeToast.tsx
//
// Custom cascade toast (NOT the shared error-toast primitive — per Ben's
// explicit correction in Task #12). Bottom-right corner, 5s dwell, then
// auto-collapses to the Recent updates tray.
//
// Visual: 360px wide, dark chrome + brand-blue left-border accent, glasses
// icon + count headline + bullet list (max 3 inline + "+ N more"), View
// details button + ✕ dismiss.

import React, { useEffect } from 'react';
import InternIcon from './InternIcon';
import { BraindumpIcon } from './corkboard/emptyState';
import { PEER_BLUE, TOAST_WIDTH, TOAST_DWELL_MS } from './tokens';
import type { CascadeEntity } from './types';

const ORANGE = '#ff8c42';

interface CascadeToastProps {
  newEntities: CascadeEntity[];
  /** Fires after TOAST_DWELL_MS or on ✕ click. */
  onCollapseToTray: () => void;
  /** Fires when writer clicks "View details" — opens summary panel. */
  onViewDetails?: () => void;
  /** Disable auto-dwell timer (e.g., during tests). */
  noAutoDismiss?: boolean;
  /** Which lane landed these cards. Braindumps and cascades both drop new
   *  cards on the board while the writer is looking elsewhere, so they get
   *  the same receipt; only the mark, the accent and one line differ. */
  source?: 'cascade' | 'braindump';
  /** Facts established by the same run, counted rather than listed. */
  factCount?: number;
}

const CascadeToast: React.FC<CascadeToastProps> = ({
  newEntities,
  onCollapseToTray,
  onViewDetails,
  noAutoDismiss = false,
  source = 'cascade',
  factCount = 0,
}) => {
  const dump = source === 'braindump';
  const accent = dump ? ORANGE : PEER_BLUE;
  useEffect(() => {
    if (noAutoDismiss) return;
    const t = setTimeout(onCollapseToTray, TOAST_DWELL_MS);
    return () => clearTimeout(t);
  }, [onCollapseToTray, noAutoDismiss]);

  const inlineEntities = newEntities.slice(0, 3);
  const overflowCount = Math.max(0, newEntities.length - 3);

  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md p-3 animate-toast-slide-in"
      style={{
        width: TOAST_WIDTH,
        background: 'linear-gradient(135deg, rgba(40,50,60,0.95) 0%, rgba(35,45,55,0.95) 100%)',
        border: `1px solid ${dump ? 'rgba(255,140,66,0.3)' : 'rgba(84, 191, 219, 0.3)'}`,
        borderLeft: `3px solid ${accent}`,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2" style={{ color: accent }}>
          {dump ? <BraindumpIcon size={16} /> : <InternIcon size={16} />}
          {/* "Cards", not "entities". The writer-facing word for the things on
              the board, and the one Paul reached for unprompted. */}
          <span className="text-sm font-medium">
            {newEntities.length === 0
              ? `${factCount} new fact${factCount === 1 ? '' : 's'}`
              : `${newEntities.length} new card${newEntities.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <button
          type="button"
          onClick={onCollapseToTray}
          className="text-fontWhite hover:text-fontWhite07 text-sm"
          aria-label="Dismiss toast"
        >
          ✕
        </button>
      </div>

      {/* Body */}
      <p className="text-[13px] text-fontWhite07 mb-1">
        {dump ? 'Your braindump added:' : 'Your response added:'}
      </p>
      <ul className="text-[13px] text-fontWhite07 mb-3 ml-1">
        {inlineEntities.map((e, i) => (
          <li key={`${e.kind}:${e.workingName}:${i}`} className="leading-snug">
            • {e.workingName}{' '}
            <span className="text-fontGray">({e.kind})</span>
            {e.placement && (
              <span className="block ml-3 text-fontGray">{e.placement}</span>
            )}
          </li>
        ))}
        {overflowCount > 0 && (
          <li className="text-fontGray italic leading-snug">+ {overflowCount} more</li>
        )}
        {factCount > 0 && (
          <li className="text-fontGray leading-snug">
            and {factCount} fact{factCount === 1 ? '' : 's'}
          </li>
        )}
      </ul>

      {/* Action */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onViewDetails}
          className="text-peerBlueLight hover:text-peerBlue text-xs"
        >
          View details
        </button>
      </div>
    </div>
  );
};

export default CascadeToast;
