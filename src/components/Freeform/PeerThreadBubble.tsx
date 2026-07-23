// components/Freeform/PeerThreadBubble.tsx
//
// The peer's diagnostic prose container inside the peer card.
// Locked in Task #8: peer card IS the bubble (no nested chat bubble);
// four content states (loading → streaming → composing → complete);
// glasses-pulse loading; auto-scroll with pause-on-manual-scroll-up.
//
// Streaming token-by-token is A2 backend work. This shell renders the static
// prose for now and exposes a `streaming` prop so A2 can flip it on.

import React, { useEffect, useRef, useState } from 'react';
import PulseLoader from './PulseLoader';
import type { PeerCardState } from './types';

interface PeerThreadBubbleProps {
  state: PeerCardState;
  prose?: string;
  /** When true, renders a blinking cursor at the end of prose (streaming state). */
  showCursor?: boolean;
  /** When true, scroll the bubble to bottom on each prose change (streaming auto-scroll). */
  autoScroll?: boolean;
}

const PeerThreadBubble: React.FC<PeerThreadBubbleProps> = ({
  state,
  prose,
  showCursor = false,
  autoScroll = true,
}) => {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Auto-scroll to bottom when prose grows, unless writer scrolled up.
  useEffect(() => {
    if (!autoScroll || userScrolledUp) return;
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [prose, autoScroll, userScrolledUp]);

  // Detect manual scroll-up; resume auto-scroll when back at bottom.
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    setUserScrolledUp(!atBottom);
  };

  // Show the cycling loader while the call is in flight AND no prose has
  // arrived yet. This covers both 'loading' (pre-prose_start) AND 'streaming'
  // with empty prose (prose_start fired, tokens haven't begun). Prevents the
  // mid-wait blank gap Ben hit during smoke testing.
  const showInitialLoader = state === 'loading' || (state === 'streaming' && !prose);

  if (showInitialLoader) {
    return (
      <PulseLoader
        text={[
          'Reading your card...',
          'Walking through the slice...',
          'Thinking about what’s load-bearing...',
          'Composing...',
        ]}
        cycleMs={4000}
      />
    );
  }

  return (
    <div ref={bodyRef} onScroll={handleScroll} className="overflow-y-auto">
      {prose && (
        <div className="text-[15px] leading-relaxed text-fontWhite07 whitespace-pre-wrap [&>p+p]:mt-3.5">
          {prose.split('\n\n').map((para, i) => (
            <p key={i}>{para}</p>
          ))}
          {showCursor && (
            <span
              aria-hidden
              className="inline-block w-px h-[1em] align-middle ml-0.5 animate-cursor-blink bg-peerBlue"
            />
          )}
        </div>
      )}

      {state === 'composing' && (
        <div className="mt-4 pt-4 border-t border-glassBg">
          <PulseLoader text="Composing questions..." centered={false} />
        </div>
      )}
    </div>
  );
};

export default PeerThreadBubble;
