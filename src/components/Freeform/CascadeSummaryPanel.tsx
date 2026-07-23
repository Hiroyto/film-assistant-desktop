// components/Freeform/CascadeSummaryPanel.tsx
//
// Slide-out panel from the canvas right edge. Opens when writer clicks "View
// details" on a CascadeToast OR a row in the RecentUpdatesTray. Lists every
// new entity from the cascade with click-to-focus action.
//
// Locked in Task #12:
//   - 400px wide, slide-out from canvas right edge
//   - Per-entity row: type chip + working_name + "Type · added to canvas" + [→] focus button
//   - Optional graph-details disclosure (vertices/edges/failures)
//   - Failures surface with retry button (cascade-retry endpoint is v2)

import React, { useState } from 'react';
import { PEER_BLUE } from './tokens';
import { getEntityColor, hexToRgba } from './entityColors';
import InternIcon from './InternIcon';
import type { CascadeEvent, EntityType } from './types';

interface CascadeSummaryPanelProps {
  event: CascadeEvent;
  /** Resolve the originating card's display label from cardId. */
  originatingCardLabel?: string;
  /** Resolve a Question's working_section label from the cascade's threadId — optional. */
  fromWorkingSection?: string;
  /** Fires when writer clicks the [→] button on an entity row. */
  onFocusEntity?: (workingName: string, kind: EntityType) => void;
  /** Fires when panel closes. */
  onClose: () => void;
  /** Fires on Retry click if there are failures. v1 has no retry endpoint — wire to a placeholder. */
  onRetryFailures?: () => void;
}

const CascadeSummaryPanel: React.FC<CascadeSummaryPanelProps> = ({
  event,
  originatingCardLabel,
  fromWorkingSection,
  onFocusEntity,
  onClose,
  onRetryFailures,
}) => {
  const [showGraphDetails, setShowGraphDetails] = useState(false);

  const cardLabel = originatingCardLabel ?? event.originatingCardId;
  const emittedDate = new Date(event.emittedAt);
  const emittedAbsolute = emittedDate.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <aside
      role="dialog"
      aria-label="Cascade summary"
      className="fixed top-0 right-0 h-full w-[400px] z-50 overflow-y-auto"
      style={{
        background: 'linear-gradient(135deg, rgba(40,50,60,0.98) 0%, rgba(35,45,55,0.98) 100%)',
        borderLeft: '1px solid rgba(84, 191, 219, 0.3)',
        boxShadow: '-12px 0 40px rgba(0, 0, 0, 0.5)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-glassBg">
        <div className="flex items-center gap-2" style={{ color: PEER_BLUE }}>
          <InternIcon size={16} />
          <span className="text-sm font-medium">From your response</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-fontWhite hover:text-fontWhite07 text-sm"
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      {/* Context */}
      <div className="px-4 py-3 text-xs text-fontGray border-b border-glassBg">
        {fromWorkingSection && (
          <>
            <span className="uppercase tracking-wider text-peerBlueLight">
              "{fromWorkingSection}"
            </span>
            <span> · </span>
          </>
        )}
        <span>{emittedAbsolute}</span>
        <div className="mt-1 text-fontWhite07">on {cardLabel}</div>
      </div>

      {/* Failures banner */}
      {event.summary.failures > 0 && (
        <div
          className="mx-4 mt-3 p-2 rounded text-xs flex items-center justify-between"
          style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)' }}
        >
          <span className="text-errorMuted">
            ⚠ {event.summary.failures} graph write{event.summary.failures === 1 ? '' : 's'} failed
          </span>
          {onRetryFailures && (
            <button
              type="button"
              onClick={onRetryFailures}
              className="text-errorMuted hover:opacity-80 underline"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* New entities list */}
      <div className="px-4 py-3">
        <div className="text-[10px] uppercase tracking-wider text-fontGray mb-2">
          New entities ({event.newEntities.length})
        </div>

        {event.newEntities.length === 0 && (
          <div className="text-xs text-fontGray italic">
            No new entities — the writer's response refined existing graph state.
          </div>
        )}

        {event.newEntities.map((e, i) => {
          const color = getEntityColor(e.kind);
          return (
            <div
              key={`${e.kind}:${e.workingName}:${i}`}
              className="flex items-start justify-between gap-2 py-2 px-2 rounded hover:bg-glassBg group"
            >
              <div className="flex items-start gap-2 min-w-0">
                <span aria-hidden style={{ color }} className="mt-0.5">
                  ◆
                </span>
                <div className="min-w-0">
                  <div className="text-[14px] text-fontWhite07 truncate">{e.workingName}</div>
                  <div className="text-[11px] uppercase tracking-wider" style={{ color: hexToRgba(color, 0.7) }}>
                    {e.kind} · added to canvas
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onFocusEntity?.(e.workingName, e.kind)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-fontWhite07 hover:text-fontWhite text-xs px-2 py-0.5 rounded"
                style={{ color: hexToRgba(color, 0.9) }}
                aria-label={`Focus ${e.workingName}`}
              >
                → focus
              </button>
            </div>
          );
        })}
      </div>

      {/* Graph details disclosure */}
      <div className="px-4 py-3 border-t border-glassBg">
        <button
          type="button"
          onClick={() => setShowGraphDetails((v) => !v)}
          className="text-xs text-fontGray hover:text-fontWhite07"
        >
          ⓘ Show graph details {showGraphDetails ? '▾' : '▸'}
        </button>
        {showGraphDetails && (
          <ul className="mt-2 space-y-1 text-xs text-fontWhite">
            <li>• {event.summary.vertices} vertices</li>
            <li>• {event.summary.edges} edges</li>
            {event.summary.failures > 0 && (
              <li className="text-errorMuted">• {event.summary.failures} failures</li>
            )}
          </ul>
        )}
      </div>
    </aside>
  );
};

export default CascadeSummaryPanel;
