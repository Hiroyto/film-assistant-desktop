// components/Freeform/PeerCard.tsx
//
// Floating peer card on the corkboard. Spawned by clicking "Ask peer" on a
// working card. Locked in Task #7:
//   - 520px wide, max-height 80vh, internal scroll
//   - Brand-blue accent (#54bfdb)
//   - Glasses icon + "PEER" type chip in header
//   - Button-origin spawn animation
//   - Single state (no collapsed/working); closes when thread closes
//
// Hosts the prose bubble (PeerThreadBubble), the question cards (QuestionCard),
// and — when continuation is active — chat continuation UI (deferred to A5 ticket).

import React from 'react';
import CardChrome from './CardChrome';
import InternIcon from './InternIcon';
import PeerThreadBubble from './PeerThreadBubble';
import QuestionCard from './QuestionCard';
import ChatContinuation, { type ChatTurn } from './ChatContinuation';
import { PEER_BLUE } from './tokens';
import type { PeerCardState, PeerQuestion, WorkingSectionStatus, EntityType } from './types';

export interface PeerContinuationView {
  workingSectionLabel: string;
  questionText?: string;
  turns: ChatTurn[];
  isThinking: boolean;
  closed?: boolean;
  closedReason?: 'card_collapse' | 'inactivity' | 'new_ask' | 'explicit';
  closedAt?: string;
  parentCardType: EntityType;
  onSendMessage: (message: string) => void;
  onCloseThread?: () => void;
}

interface PeerCardProps {
  state: PeerCardState;
  prose?: string;
  /** When true, prose is mid-stream and cursor renders. */
  isStreaming?: boolean;
  questions?: PeerQuestion[];
  /** Map of questionId → current status (reflects live writing-card state). */
  questionStatuses?: Record<string, WorkingSectionStatus>;
  /** Close (✕) — caller controls thread close. */
  onClose?: () => void;
  /** Edit a question's working_section label. */
  onQuestionLabelEdit?: (questionId: string, newLabel: string) => void;
  /** Dismiss a question (also removes from writing card per two-way sync). */
  onQuestionDismiss?: (questionId: string) => void;
  /** Don't run pop-in animations (e.g., on replay from persisted state). */
  noAnimate?: boolean;
  /** Optional error message for fail-closed display. */
  error?: string | null;
  /** Optional retry handler for failed peer call. */
  onRetry?: () => void;
  /** When set, render the chat continuation surface inside the peer card body. */
  continuation?: PeerContinuationView;
}

const PeerCard: React.FC<PeerCardProps> = ({
  state,
  prose,
  isStreaming = false,
  questions,
  questionStatuses,
  onClose,
  onQuestionLabelEdit,
  onQuestionDismiss,
  noAnimate = false,
  error,
  onRetry,
  continuation,
}) => {
  return (
    <div className={noAnimate ? '' : 'animate-peer-spawn'}>
      <CardChrome variant="peer">
        {/* Header: glasses + PEER chip + close */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2" style={{ color: PEER_BLUE }}>
            <InternIcon size={16} ariaLabel="Peer" />
            <span className="text-[11px] uppercase tracking-wider font-mono">PEER</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-fontWhite hover:text-fontWhite07 text-sm"
            aria-label="Close peer thread"
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Error state — replaces body when peer call failed */}
        {error ? (
          <div className="py-6 text-center">
            <p className="text-errorMuted text-sm mb-2">Peer unavailable. {error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="text-errorMuted hover:opacity-80 underline text-sm"
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Prose bubble */}
            <PeerThreadBubble
              state={state}
              prose={prose}
              showCursor={isStreaming && state === 'streaming'}
            />

            {/* Questions — only render when complete or composing+received */}
            {state === 'complete' && questions && questions.length > 0 && (
              <div className="mt-4 pt-4 border-t border-glassBg">
                {questions.map((q) => (
                  <QuestionCard
                    key={q.questionId}
                    workingSectionLabel={q.workingSectionLabel}
                    questionText={q.questionText}
                    rationale={q.rationale}
                    status={questionStatuses?.[q.questionId] ?? q.status}
                    orderIndex={q.orderIndex}
                    onLabelEdit={(newLabel) => onQuestionLabelEdit?.(q.questionId, newLabel)}
                    onDismiss={() => onQuestionDismiss?.(q.questionId)}
                    noAnimate={noAnimate}
                  />
                ))}
              </div>
            )}

            {/* Chat continuation — appears inline below questions (Task #11 lock) */}
            {continuation && (
              <ChatContinuation
                workingSectionLabel={continuation.workingSectionLabel}
                questionText={continuation.questionText}
                turns={continuation.turns}
                isThinking={continuation.isThinking}
                closed={continuation.closed}
                closedReason={continuation.closedReason}
                closedAt={continuation.closedAt}
                parentCardType={continuation.parentCardType}
                onSendMessage={continuation.onSendMessage}
                onCloseThread={continuation.onCloseThread}
              />
            )}
          </>
        )}
      </CardChrome>
    </div>
  );
};

export default PeerCard;
