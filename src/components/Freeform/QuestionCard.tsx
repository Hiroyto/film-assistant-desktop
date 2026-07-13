// components/Freeform/QuestionCard.tsx
//
// The question card unit displayed inside the peer card (proposal-state view).
// Per Task #9: appears simultaneously with working_section on the writing card.
// Two actions only: edit (label) + dismiss. No "Add to card" — auto-adoption.
//
// Status reflects two-way sync from the writing card: open / stashed / answered.

import React, { useState } from 'react';
import { PEER_BLUE } from './tokens';
import type { WorkingSectionStatus } from './types';

interface QuestionCardProps {
  workingSectionLabel: string;
  questionText: string;
  rationale: string;
  status: WorkingSectionStatus;
  /** Index in the question list — used for pop-in stagger via inline animationDelay. */
  orderIndex: number;
  /** Fires when writer edits the label (renames the working_section). */
  onLabelEdit?: (newLabel: string) => void;
  /** Fires when writer dismisses. */
  onDismiss?: () => void;
  /** Disable animations (e.g., on replay / restore from persisted state). */
  noAnimate?: boolean;
}

const QuestionCard: React.FC<QuestionCardProps> = ({
  workingSectionLabel,
  questionText,
  rationale,
  status,
  orderIndex,
  onLabelEdit,
  onDismiss,
  noAnimate = false,
}) => {
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [draftLabel, setDraftLabel] = useState(workingSectionLabel);
  const [rationaleExpanded, setRationaleExpanded] = useState(false);

  const commitLabel = () => {
    setIsEditingLabel(false);
    if (draftLabel.trim() && draftLabel !== workingSectionLabel) {
      onLabelEdit?.(draftLabel.trim());
    } else {
      setDraftLabel(workingSectionLabel);
    }
  };

  return (
    <div
      className={`
        relative rounded-md p-3 mb-3
        ${noAnimate ? '' : 'opacity-0 animate-card-pop-in'}
      `}
      style={{
        animationDelay: noAnimate ? undefined : `${orderIndex * 400}ms`,
        background: 'rgba(84, 191, 219, 0.04)',
        border: `1px solid rgba(84, 191, 219, 0.5)`,
        borderLeft: `3px solid ${PEER_BLUE}`,
      }}
    >
      {/* Header row: label + actions */}
      <div className="flex items-start justify-between gap-2 mb-2">
        {isEditingLabel ? (
          <input
            autoFocus
            className="flex-1 bg-transparent border-b border-peerBlueBorder text-peerBlueLight text-[12px] uppercase tracking-wider font-mono outline-none"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel();
              if (e.key === 'Escape') {
                setDraftLabel(workingSectionLabel);
                setIsEditingLabel(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingLabel(true)}
            className="flex-1 text-left text-peerBlueLight text-[12px] uppercase tracking-wider font-mono hover:text-peerBlue"
            title="Click to rename"
          >
            {workingSectionLabel}
          </button>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {status !== 'open' && (
            <span className="text-[10px] text-fontWhite opacity-70 lowercase">
              · {status}
            </span>
          )}
          <button
            type="button"
            onClick={() => setIsEditingLabel(true)}
            className="text-fontWhite hover:text-peerBlueLight text-xs px-1"
            aria-label="Edit label"
            title="Edit label"
          >
            edit
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="text-fontWhite hover:text-errorMuted text-sm px-1"
            aria-label="Dismiss question"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Question text — immutable */}
      <p className="text-[15px] leading-relaxed text-fontWhite07 mb-2">{questionText}</p>

      {/* Rationale — collapsed by default */}
      <button
        type="button"
        onClick={() => setRationaleExpanded((v) => !v)}
        className="flex items-start gap-1 text-[13px] italic text-fontWhite opacity-60 hover:opacity-90 text-left"
        aria-expanded={rationaleExpanded}
      >
        <span aria-hidden>↳</span>
        {rationaleExpanded ? (
          <span>{rationale}</span>
        ) : (
          <span className="truncate">
            Why this question matters
            <span className="ml-1">▾</span>
          </span>
        )}
      </button>
    </div>
  );
};

export default QuestionCard;
