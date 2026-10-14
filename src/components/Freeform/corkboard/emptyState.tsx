// components/Freeform/corkboard/emptyState.tsx — the board's first screen.
//
// FIL-587 / deep-usage sessions: a new project used to open on a dark, empty
// dot grid with every way in living in the toolbar chrome. Writers read that
// as "figure it out" and hunted. This is the one thing on an empty board, in
// the middle of the screen, naming the ways to start: dump what you have,
// place a card by hand, or bring a screenplay you already wrote (cowork on a
// .fdx, or import one once). It exists ONLY while the board is empty — the
// moment a card lands it is gone for good, so it costs a returning writer
// nothing.
import React, { useState } from 'react';
import { getEntityColor, hexToRgba } from '../entityColors';
import { useThemeMode } from './theme';
import type { CreateModalKind } from './modals';

// Final Draft's own colors, read off its logo (navy field, gold quill). Worn by
// ONE thing here: the cowork door on hover — that door hands the board to that
// app, and the colors say so before the click. Nothing else should use them.
const FD_NAVY = '#050b3a';
const FD_NAVY_SOFT = '#15295a';
const FD_GOLD = '#fed208';

/** The braindump mark. Lives here and is imported by the toolbar's Braindump
 *  button so the empty state's CTA and the toolbar action wear the same glyph
 *  rather than two copies of the same path data drifting apart. */
export function BraindumpIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
      <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
      <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
      <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
      <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
      <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
      <path d="M6 18a4 4 0 0 1-1.967-.516" />
      <path d="M19.967 17.484A4 4 0 0 1 18 18" />
    </svg>
  );
}

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
  onCowork,
  importTitle = 'Read a PDF, Final Draft (.fdx) or Fade In (.fadein) screenplay into cards, once',
  coworkTitle = 'Watch a Final Draft (.fdx) file: every save becomes a per-scene save + extraction on this board',
}: {
  onBraindump: () => void;
  onCreate: (kind: CreateModalKind) => void;
  /** One-shot import: the file is read into cards once (PDF, .fdx, .fadein). */
  onImport: () => void;
  /** Desktop only: open a .fdx and keep it in sync (the cowork). Absent on the
   *  web, where there is no file watcher — the section then offers import alone. */
  onCowork?: () => void;
  importTitle?: string;
  coworkTitle?: string;
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
          Build the board
        </h2>

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
              // Light runs the DEEPER pair: white text on the brand orange is
              // 2.3–2.8:1 on the cream board; #d9480f→#ea580c holds 3.6–4.3:1.
              : 'linear-gradient(135deg, #d9480f 0%, #ea580c 100%)',
            boxShadow: dark ? '0 2px 14px rgba(255,107,53,0.34)' : '0 2px 14px rgba(217,72,15,0.28)',
            transition: 'background 130ms ease-out',
            // The same mark the toolbar's Braindump button wears, so the two
            // ways in are recognisably one action.
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 9,
            marginTop: 20,
          }}
        >
          <BraindumpIcon size={17} />
          Braindump your story
        </button>
        <div
          style={{
            margin: '9px 0 20px',
            fontSize: 11.5,
            color: dark ? '#6e6e78' : '#736b5e',
          }}
        >
          Paste an outline, a treatment, a few notes, or just write freely.
          It comes back as cards you can move around.
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
            color: dark ? '#5c5c66' : '#736b5e',
          }}
        >
          <span style={{ flex: 1, height: 1, background: dark ? '#26262b' : '#ece5d7' }} />
          or add a card yourself
          <span style={{ flex: 1, height: 1, background: dark ? '#26262b' : '#ece5d7' }} />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {STARTERS.map((s) => (
            <StarterButton
              key={s.kind}
              label={s.label}
              hint={s.hint}
              color={getEntityColor(s.kind as any, dark ? 'dark' : 'light')}
              dark={dark}
              onClick={() => onCreate(s.kind)}
            />
          ))}
        </div>

        {/* The third way in, and the one a writer arriving with a finished
            script needs most. It used to be a grey underlined link under the
            fold (fine print, Ben 2026-09-09), then one button whose label
            changed per platform. Now its own section: a header naming the
            situation and the two doors side by side — cowork on a .fdx
            (desktop: the file stays open in Final Draft and every save lands
            here) or a one-shot import (the script is read into cards once).
            Still quiet next to the orange CTA, because a writer WITH a
            screenplay knows to look for it and one without should not be
            pulled toward it. */}
        <h3
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '22px 0 12px',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: 0.7,
            fontWeight: 600,
            color: dark ? '#5c5c66' : '#736b5e',
          }}
        >
          <span style={{ flex: 1, height: 1, background: dark ? '#26262b' : '#ece5d7' }} />
          Already have a screenplay?
          <span style={{ flex: 1, height: 1, background: dark ? '#26262b' : '#ece5d7' }} />
        </h3>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {onCowork && (
            <ScreenplayDoor
              label="Cowork with a .fdx"
              hint="Keep writing in Final Draft; every save lands on the board"
              title={coworkTitle}
              icon={<CoworkIcon />}
              dark={dark}
              finalDraft
              onClick={onCowork}
            />
          )}
          <ScreenplayDoor
            label="Import a .fdx once"
            hint="Read the script into cards one time (PDF and Fade In work too)"
            title={importTitle}
            icon={<ImportIcon />}
            dark={dark}
            onClick={onImport}
          />
        </div>
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
        border: `1px solid ${hover ? color : dark ? '#2a2a30' : '#e6dfd2'}`,
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
          color: dark ? '#75757f' : '#736b5e',
        }}
      >
        {hint}
      </span>
    </button>
  );
}

/** One screenplay door: label + a one-line hint, in the same quiet bordered
 *  style the single import button wore, laid out like the starters so the
 *  two read as a pair of equals rather than a primary and a footnote. */
function ScreenplayDoor({
  label,
  hint,
  title,
  icon,
  dark,
  finalDraft = false,
  onClick,
}: {
  label: string;
  hint: string;
  title?: string;
  icon: React.ReactNode;
  dark: boolean;
  /** Hover wears Final Draft's colors (navy field, gold quill): this door
   *  hands the board to that app, and the colors say so before the click. */
  finalDraft?: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const fd = finalDraft && hover;
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        flex: '1 1 200px',
        minWidth: 180,
        padding: '10px 12px',
        borderRadius: 10,
        border: `1px solid ${fd
          ? (dark ? hexToRgba(FD_GOLD, 0.55) : hexToRgba(FD_NAVY_SOFT, 0.5))
          : hover ? (dark ? '#3f4550' : '#c9c3b4') : (dark ? '#2c2c33' : '#e3ddcd')}`,
        background: fd
          ? (dark
            ? `linear-gradient(135deg, ${hexToRgba(FD_NAVY_SOFT, 0.6)}, ${hexToRgba(FD_NAVY, 0.4)})`
            : `linear-gradient(135deg, ${hexToRgba(FD_NAVY_SOFT, 0.07)}, ${hexToRgba(FD_GOLD, 0.1)})`)
          : hover
            ? (dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)')
            : (dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)'),
        boxShadow: fd
          ? (dark ? `0 6px 18px ${hexToRgba(FD_GOLD, 0.12)}` : `0 4px 14px ${hexToRgba(FD_NAVY_SOFT, 0.12)}`)
          : 'none',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        transition: 'background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out, box-shadow 160ms ease-out',
      }}
    >
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 12.5,
          fontWeight: 600,
          color: fd
            ? (dark ? '#f6f6f8' : FD_NAVY)
            : hover ? (dark ? '#d6d6de' : '#3d4150') : (dark ? '#9a9aa4' : '#5c5448'),
        }}
      >
        {/* The icon draws with currentColor: on the Final Draft hover it goes
            gold on the dark stage (the quill) and navy on the cream board,
            where a 2px gold stroke would wash out. */}
        <span style={{ display: 'inline-flex', color: fd ? (dark ? FD_GOLD : FD_NAVY_SOFT) : 'inherit', transition: 'color 120ms ease-out' }}>
          {icon}
        </span>
        {label}
      </span>
      <span
        style={{
          display: 'block',
          marginTop: 3,
          fontSize: 11,
          lineHeight: 1.4,
          color: fd ? (dark ? '#b9bdd0' : '#3f4a6b') : (dark ? '#75757f' : '#736b5e'),
        }}
      >
        {hint}
      </span>
      {/* The quill stroke: a gold line that draws itself along the bottom
          edge on hover. Absolutely placed inside the padding, so the door
          keeps the same height as its neighbour; decorative, so the pure
          brand gold is fine on both stages. */}
      {finalDraft && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 12,
            bottom: 5,
            display: 'block',
            height: 2,
            width: fd ? 34 : 0,
            borderRadius: 2,
            background: `linear-gradient(90deg, ${FD_GOLD}, ${hexToRgba(FD_GOLD, 0)})`,
            transition: 'width 180ms ease-out',
          }}
        />
      )}
    </button>
  );
}

/** File with an up arrow — the one-shot import (same mark the old link wore). */
function ImportIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-6" />
      <path d="m9 15 3-3 3 3" />
    </svg>
  );
}

/** Two chasing arrows — the cowork keeps the .fdx and the board in step. */
function CoworkIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      style={{ display: 'block', flexShrink: 0 }}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}
