// components/Freeform/corkboard/emptyState.tsx — the board's first screen.
//
// FIL-587 / deep-usage sessions: a new project used to open on a dark, empty
// dot grid with every way in living in the toolbar chrome. Writers read that
// as "figure it out" and hunted. This is the one thing on an empty board, in
// the middle of the screen, naming the two ways to start: dump what you have,
// or place a card by hand. It exists ONLY while the board is empty — the
// moment a card lands it is gone for good, so it costs a returning writer
// nothing.
import React, { useState } from 'react';
import { getEntityColor, hexToRgba } from '../entityColors';
import { useThemeMode } from './theme';
import type { CreateModalKind } from './modals';

/** The by-hand starters. Deliberately three, not the full New menu: the menu
 *  is the complete list, this is the "just pick one" shortlist. */
const STARTERS: Array<{ kind: CreateModalKind; label: string; hint: string }> = [
  { kind: 'character', label: 'Character', hint: 'Someone the story is about' },
  { kind: 'event', label: 'Scene', hint: 'Something that happens' },
  { kind: 'location', label: 'Location', hint: 'Somewhere it happens' },
];

export function BoardEmptyState({
  onBraindump,
  onCreate,
  onImport,
}: {
  onBraindump: () => void;
  onCreate: (kind: CreateModalKind) => void;
  onImport: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const [hoverDump, setHoverDump] = useState(false);

  return (
    <div
      // Centered in the board, non-blocking: the grid stays visible around it
      // and clicks outside the panel still reach the canvas.
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        zIndex: 5,
        fontFamily: 'system-ui, sans-serif',
        padding: 24,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          width: 'min(520px, 100%)',
          textAlign: 'center',
          background: dark ? 'rgba(20,20,23,0.82)' : 'rgba(255,255,255,0.88)',
          border: dark ? '1px solid #26262b' : '1px solid #ece5d7',
          borderRadius: 14,
          padding: '30px 28px 26px',
          backdropFilter: 'blur(6px)',
          boxShadow: dark
            ? '0 10px 40px rgba(0,0,0,0.45)'
            : '0 10px 30px rgba(120,90,40,0.10)',
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: -0.2,
            color: dark ? '#e8e8ee' : '#2c3140',
          }}
        >
          Nothing on the board yet
        </h2>
        <p
          style={{
            margin: '8px 0 22px',
            fontSize: 13.5,
            lineHeight: 1.6,
            color: dark ? '#8f8f9a' : '#6b6f7d',
          }}
        >
          Talk it out and let it become cards, or place the first one yourself.
          Nothing here is permanent, and nothing needs to be in order.
        </p>

        <button
          onClick={onBraindump}
          onMouseEnter={() => setHoverDump(true)}
          onMouseLeave={() => setHoverDump(false)}
          style={{
            width: '100%',
            height: 46,
            border: 'none',
            borderRadius: 12,
            fontSize: 14,
            fontWeight: 700,
            fontFamily: 'inherit',
            color: '#fff',
            cursor: 'pointer',
            background: hoverDump
              ? 'linear-gradient(135deg, #f2602c 0%, #f57f35 100%)'
              : 'linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%)',
            boxShadow: '0 2px 14px rgba(255,107,53,0.34)',
            transition: 'background 130ms ease-out',
          }}
        >
          Braindump your story
        </button>
        <div
          style={{
            margin: '9px 0 20px',
            fontSize: 11.5,
            color: dark ? '#6e6e78' : '#9a9aa4',
          }}
        >
          Write freely — characters, scenes, a vibe. It gets read into cards.
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '0 0 16px',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.7,
            fontWeight: 600,
            color: dark ? '#5c5c66' : '#adaab2',
          }}
        >
          <span style={{ flex: 1, height: 1, background: dark ? '#26262b' : '#ece5d7' }} />
          or start one by hand
          <span style={{ flex: 1, height: 1, background: dark ? '#26262b' : '#ece5d7' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {STARTERS.map((s) => (
            <StarterButton
              key={s.kind}
              label={s.label}
              hint={s.hint}
              color={getEntityColor(s.kind as any)}
              dark={dark}
              onClick={() => onCreate(s.kind)}
            />
          ))}
        </div>

        <button
          onClick={onImport}
          style={{
            marginTop: 18,
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontSize: 12,
            fontFamily: 'inherit',
            color: dark ? '#7a7a84' : '#8a8578',
            cursor: 'pointer',
            textDecoration: 'underline',
            textUnderlineOffset: 3,
          }}
        >
          Already have a screenplay? Import the PDF
        </button>
      </div>
    </div>
  );
}

/** One by-hand starter: the entity's color carries the meaning, the hint
 *  underneath answers "what even is a card" without a tour. */
function StarterButton({
  label,
  hint,
  color,
  dark,
  onClick,
}: {
  label: string;
  hint: string;
  color: string;
  dark: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title={hint}
      style={{
        flex: '1 1 140px',
        minWidth: 130,
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${hover ? color : dark ? '#2a2a30' : '#e3e5ea'}`,
        background: hover ? hexToRgba(color, dark ? 0.16 : 0.09) : 'transparent',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        transition: 'background 120ms ease-out, border-color 120ms ease-out',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 13,
          fontWeight: 600,
          color: dark ? '#d6d6de' : '#2c3140',
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
        {label}
      </span>
      <span
        style={{
          display: 'block',
          marginTop: 3,
          fontSize: 11,
          lineHeight: 1.4,
          color: dark ? '#75757f' : '#8f8f9a',
        }}
      >
        {hint}
      </span>
    </button>
  );
}
