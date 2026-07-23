// components/Freeform/PulseLoader.tsx
//
// The glasses-pulse loading indicator used across peer surfaces.
// Locked in Task #8: glasses icon + text, both opacity-pulse 60% ↔ 100%
// on a 1.5s ease-in-out loop.
//
// Use in:
//   - Peer card initial loading: "Reading your card..."
//   - Composing questions intermediate (streaming only): "Composing questions..."
//   - Peer continuation: "Thinking..."

import React, { useEffect, useState } from 'react';
import InternIcon from './InternIcon';
import { PEER_BLUE } from './tokens';

interface PulseLoaderProps {
  /** Single text or array of texts to cycle through. Cycling kicks in after the first ~3s if multiple provided. */
  text: string | string[];
  /** Cycle interval in ms when text is an array. Default 3500ms. */
  cycleMs?: number;
  /** Larger icon variant for prominent loading states. Default 20px. */
  iconSize?: number;
  /** Center the loader vertically + horizontally in its container. Default true. */
  centered?: boolean;
}

const PulseLoader: React.FC<PulseLoaderProps> = ({
  text,
  cycleMs = 3500,
  iconSize = 20,
  centered = true,
}) => {
  const texts = Array.isArray(text) ? text : [text];
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (texts.length <= 1) return;
    const id = window.setInterval(() => {
      setIdx((i) => Math.min(i + 1, texts.length - 1));
    }, cycleMs);
    return () => window.clearInterval(id);
  }, [texts.length, cycleMs]);

  return (
    <div
      className={`
        flex items-center gap-2 animate-glasses-pulse
        ${centered ? 'justify-center py-6' : ''}
      `}
      style={{ color: PEER_BLUE }}
      role="status"
      aria-live="polite"
    >
      <InternIcon size={iconSize} />
      <span className="text-sm transition-opacity duration-300">{texts[idx]}</span>
    </div>
  );
};

export default PulseLoader;
