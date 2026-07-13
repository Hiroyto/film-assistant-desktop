// components/Freeform/ChatContinuation.tsx
//
// FIL-480 / A5 — Chat continuation thread inside the peer card.
//
// Locked in Task #11:
//   - Inline under the question card (host: PeerCard composes this)
//   - No nested chat bubbles — both turns full-width, author markers
//   - Glasses-pulse "Thinking..." during peer response generation
//   - Auto-scroll with pause-on-manual-scroll-up
//   - Soft cap banner at 20 turns (non-blocking)
//   - Cmd/Ctrl+Enter to send

import React, { useEffect, useRef, useState } from 'react';
import InternIcon from './InternIcon';
import PulseLoader from './PulseLoader';
import { PEER_BLUE, SOFT_CAP_TURNS } from './tokens';
import { getEntityColor } from './entityColors';
import type { EntityType } from './types';

export interface ChatTurn {
  turnId: string;
  role: 'writer' | 'peer';
  content: string;
  createdAt: string;
}

interface ChatContinuationProps {
  /** Working_section label this thread is rooted in. */
  workingSectionLabel: string;
  /** Original peer question for context display. */
  questionText?: string;
  /** Turn list, chronological top-to-bottom. */
  turns: ChatTurn[];
  /** Set while peer is generating a response — renders "Thinking..." in place of input. */
  isThinking: boolean;
  /** Hide the input area and show closed-state footer. */
  closed?: boolean;
  /** When closed, why. Renders in the footer. */
  closedReason?: 'card_collapse' | 'inactivity' | 'new_ask' | 'explicit';
  /** Closed-at timestamp for the footer. */
  closedAt?: string;
  /** The writing card's entity type — for the writer turn dot accent. */
  parentCardType: EntityType;
  /** Fires when writer sends a message. */
  onSendMessage: (message: string) => void;
  /** Fires when writer explicitly closes the thread (e.g. from soft-cap banner). */
  onCloseThread?: () => void;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const ChatContinuation: React.FC<ChatContinuationProps> = ({
  workingSectionLabel,
  questionText,
  turns,
  isThinking,
  closed,
  closedReason,
  closedAt,
  parentCardType,
  onSendMessage,
  onCloseThread,
}) => {
  const [draft, setDraft] = useState('');
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const turnsEndRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const writerAccent = getEntityColor(parentCardType);

  // Auto-scroll on new turns / thinking-state transitions, unless writer scrolled up.
  useEffect(() => {
    if (userScrolledUp) return;
    turnsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, isThinking, userScrolledUp]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 12;
    setUserScrolledUp(!atBottom);
  };

  const handleSend = () => {
    if (!draft.trim() || isThinking || closed) return;
    onSendMessage(draft.trim());
    setDraft('');
  };

  const overSoftCap = turns.length >= SOFT_CAP_TURNS;

  return (
    <div className="mt-3 pl-3" style={{ borderLeft: `2px solid ${PEER_BLUE}` }}>
      {/* Section header */}
      <div className="text-[10px] uppercase tracking-wider text-peerBlueLight mb-1">
        Continuation · "{workingSectionLabel}"
      </div>
      {questionText && (
        <p className="text-[12px] text-fontWhite mb-3 italic opacity-70">{questionText}</p>
      )}

      {/* Turns scroller */}
      <div ref={scrollerRef} onScroll={handleScroll} className="max-h-[40vh] overflow-y-auto pr-2">
        {turns.map((t) =>
          t.role === 'peer' ? (
            <div key={t.turnId} className="mb-3">
              <div className="flex items-start gap-2">
                <InternIcon size={14} className="mt-0.5 shrink-0" />
                <div className="flex-1 text-[14px] leading-relaxed text-fontWhite07 whitespace-pre-wrap">
                  {t.content}
                </div>
              </div>
              <div className="text-[10px] text-fontGray mt-1 ml-6">
                — peer, {relativeTime(t.createdAt)}
              </div>
            </div>
          ) : (
            <div key={t.turnId} className="mb-3 pl-3 ml-3" style={{ borderLeft: `2px solid ${writerAccent}` }}>
              <div className="text-[14px] leading-relaxed text-fontWhite07 whitespace-pre-wrap">
                {t.content}
              </div>
              <div className="text-[10px] text-fontGray mt-1">
                — you, {relativeTime(t.createdAt)}
              </div>
            </div>
          ),
        )}
        {isThinking && (
          <div className="mb-3">
            <PulseLoader text="Thinking..." centered={false} iconSize={14} />
          </div>
        )}
        <div ref={turnsEndRef} />
      </div>

      {/* Soft cap banner */}
      {overSoftCap && !closed && (
        <div
          className="mt-2 p-2 rounded text-[12px] flex items-center justify-between gap-2"
          style={{ background: 'rgba(84,191,219,0.04)', border: '1px solid rgba(84,191,219,0.2)' }}
        >
          <span className="text-fontWhite07">
            ℹ This thread is getting long ({turns.length} turns). Consider closing and asking peer fresh.
          </span>
          {onCloseThread && (
            <button
              type="button"
              onClick={onCloseThread}
              className="text-peerBlueLight hover:text-peerBlue text-[11px] underline shrink-0"
            >
              Close thread
            </button>
          )}
        </div>
      )}

      {/* Closed footer */}
      {closed && (
        <div className="mt-3 text-[11px] text-fontGray italic text-center py-2 border-t border-glassBg">
          ─── Thread closed{closedReason ? ` (${closedReason.replace(/_/g, ' ')})` : ''}
          {closedAt ? ` at ${new Date(closedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} ───
        </div>
      )}

      {/* Input area */}
      {!closed && (
        <div className="mt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={isThinking ? 'Peer is thinking…' : 'Continue the conversation...'}
            rows={draft ? 3 : 2}
            disabled={isThinking}
            className="w-full bg-bgdark2 border border-glassBg rounded p-2 text-[14px] text-fontWhite07 placeholder:text-fontGray resize-y outline-none focus:border-peerBlueBorder disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-end gap-2 text-xs">
            {draft.trim() && (
              <button
                type="button"
                onClick={handleSend}
                disabled={isThinking}
                className="px-3 py-1 rounded bg-peerBlue hover:bg-peerBlueDark text-bgdark1 font-medium disabled:opacity-50"
              >
                Send <span className="opacity-70 ml-1">⌘↵</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatContinuation;
