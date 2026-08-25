// components/Freeform/corkboard/toolbar.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect, useRef } from 'react';
import { hexToRgba } from '../../../components/Freeform/entityColors';
import { BALL_H, BALL_W, type Pos } from './constants';
import { useThemeMode } from './theme';
import { HoverTip } from './tooltip';

export function BallChip({
  label,
  noun,
  color,
  count,
  pos,
  pinned,
  expanded,
  isDragging,
  isFocusMode,
  onMouseDown,
}: {
  label: string;
  noun: string;
  color: string;
  count: number;
  pos: Pos;
  pinned: boolean;
  expanded: boolean;
  isDragging: boolean;
  isFocusMode: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const dark = useThemeMode() === 'dark';
  return (
    <div
      onMouseDown={onMouseDown}
      title={
        expanded
          ? 'Click to bunch back into a ball · drag to slide'
          : `Click to deal out ${count} ${noun}${count === 1 ? '' : 's'} · drag to slide`
      }
      style={{
        // Pinned balls ride the viewport (fixed); free balls sit on the canvas
        // (absolute) and scroll/drag normally until scrolled past → pinned.
        position: pinned ? 'fixed' : 'absolute',
        left: pos.x,
        top: pos.y,
        width: BALL_W,
        height: BALL_H,
        background: expanded ? hexToRgba(color, dark ? 0.22 : 0.15) : dark ? '#1a1a1e' : '#fff',
        border: `2px solid ${color}`,
        borderRadius: BALL_H / 2,
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxSizing: 'border-box',
        boxShadow: isDragging
          ? '0 6px 18px rgba(0,0,0,0.16)'
          : expanded
          ? `0 4px 12px rgba(0,0,0,0.10), 0 0 0 3px ${hexToRgba(color, 0.16)}`
          : '0 1px 3px rgba(0,0,0,0.08)',
        cursor: isDragging ? 'grabbing' : 'grab',
        // Above the canvas/cards, below the level-3 sheets (z 200) and toasts.
        zIndex: isDragging ? 125 : 120,
        opacity: isFocusMode ? 0.22 : 1,
        filter: isFocusMode ? 'blur(2px) saturate(0.6)' : 'none',
        pointerEvents: isFocusMode ? 'none' : 'auto',
        userSelect: 'none',
        // Suppress position easing while dragging so the ball doesn't trail the
        // cursor; ease only for the deal-out / re-bunch state changes.
        transition: isDragging
          ? 'box-shadow 180ms ease-out'
          : `background 180ms ease-out, box-shadow 180ms ease-out`,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: dark ? '#d6d6dc' : '#333', flex: 1 }}>
        {`${label} · ${count}`}
      </span>
      <span
        style={{
          fontSize: 11,
          color: expanded ? color : '#999',
          fontWeight: 600,
        }}
      >
        {expanded ? '▾' : '▸'}
      </span>
    </div>
  );
}

// =====================================================================
// Toolbar primitives — the corkboard's control strip. ToolbarButton is the
// one button style every toolbar control uses (hover via mouse events; inline
// styles per house posture). `accent` tints the button (badges/active states).
// =====================================================================

/** Remap a #rrggbb channel-wise. Shared by the create-button's gradient stops
 *  and its hover shade — kept local, the only caller is ToolbarButton. */
function mapHex(hex: string, f: (v: number) => number): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const ch = (i: number) => Math.max(0, Math.min(255, Math.round(f(parseInt(h.slice(i, i + 2), 16)))));
  return `#${[ch(0), ch(2), ch(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
/** Toward black by pct. */
const darken = (hex: string, pct: number) => mapHex(hex, (v) => v - (v * pct) / 100);
/** Toward WHITE by pct — not "scale the channels up", which clamps the already-
 *  hot channel and drags the hue (orange goes yellow). Mixing toward white keeps
 *  the hue and just lifts the value, so one formula reads right for the warm
 *  accent and the cool one alike. */
const tint = (hex: string, pct: number) => mapHex(hex, (v) => v + ((255 - v) * pct) / 100);

/** The create group's fill: one 135° two-stop gradient generated FROM the
 *  accent, so New (blue) and Braindump (orange) are visibly the same kind of
 *  button in two colors rather than two differently-styled buttons. Matches the
 *  braindump field's own gradient and the empty state's primary CTA. */
function createGradient(accent: string, pressed: boolean): string {
  const base = pressed ? darken(accent, 8) : accent;
  return `linear-gradient(135deg, ${base} 0%, ${tint(base, 16)} 100%)`;
}

export function ToolbarButton({
  label,
  icon,
  trailing,
  onClick,
  disabled,
  accent,
  active,
  title,
  tourId,
  prominent,
  collapsed,
  large,
}: {
  label: string;
  icon?: React.ReactNode;
  /** Optional element rendered AFTER the label (e.g. a dropdown caret). */
  trailing?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Tint color — used for badge/active states (e.g. pending suggestions). */
  accent?: string;
  /** Pressed/open look (e.g. while its slide-out is open). */
  active?: boolean;
  title?: string;
  /** Anchor for the wow coachmark (FIL-506). */
  tourId?: string;
  /** FIL-587 — the two CREATE actions (New, Braindump) read as filled,
   *  solid-colored buttons instead of the outlined default, so the eye lands
   *  on them first. Every other control keeps the quiet outlined posture;
   *  prominence only works if almost nothing else claims it. Requires accent. */
  prominent?: boolean;
  /** Icon-only at rest; the label slides out on hover (Ben 2026-08-23, for
   *  the quiet right-cluster controls: undo/redo, trash). Requires icon. */
  collapsed?: boolean;
  /** Prominent SIZING without the fill (Ben 2026-08-23): Import rides the
   *  create group at New/Braindump's height but keeps the quiet outline. */
  large?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const folded = !!collapsed && !!icon && !hover;
  const dark = useThemeMode() === 'dark';
  const solid = !!prominent && !!accent && !disabled;
  const tinted = !!accent && !solid;
  const bg = disabled
    ? 'transparent'
    : solid
    ? createGradient(accent!, active || hover)
    : tinted
    ? hexToRgba(accent!, active || hover ? (dark ? 0.22 : 0.16) : dark ? 0.14 : 0.1)
    : active
    ? dark ? '#26262c' : '#eef1f6'
    : hover
    ? dark ? '#222227' : '#f4f5f7'
    : dark ? '#1a1a1e' : '#fff';
  const border = disabled
    ? dark ? '#26262a' : '#ececec'
    : solid
    ? accent!
    : tinted
    ? hexToRgba(accent!, 0.55)
    : active || hover
    ? dark ? '#3c3c44' : '#c9cdd6'
    : dark ? '#2a2a30' : '#e3e5ea';
  const color = disabled
    ? dark ? '#55555c' : '#c0c0c0'
    : solid
    ? '#fff'
    : tinted
    ? accent!
    : dark ? '#c8c8d0' : '#3d4250';
  const btn = (
    <button
      data-tour={tourId}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: solid || large ? 34 : 30,
        padding: solid || large ? '0 16px' : folded ? '0 8px' : '0 12px',
        fontSize: solid || large ? 12.5 : 12,
        fontWeight: solid || large ? 700 : 600,
        letterSpacing: 0.1,
        border: `1px solid ${border}`,
        borderRadius: 7,
        background: bg,
        color,
        boxShadow: solid ? `0 1px 8px ${hexToRgba(accent!, 0.38)}` : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'system-ui, sans-serif',
        transition: 'background 120ms ease-out, border-color 120ms ease-out, padding 160ms ease-out',
        whiteSpace: 'nowrap',
      }}
    >
      {icon && <span style={{ fontSize: 13, lineHeight: 1 }}>{icon}</span>}
      {collapsed && icon ? (
        <span
          aria-label={label}
          style={{
            display: 'inline-block', overflow: 'hidden', verticalAlign: 'middle',
            maxWidth: folded ? 0 : 160, opacity: folded ? 0 : 1,
            marginLeft: folded ? -6 : 0,
            transition: 'max-width 160ms ease-out, opacity 120ms ease-out, margin-left 160ms ease-out',
          }}
        >
          {label}
        </span>
      ) : label}
      {trailing && <span style={{ display: 'inline-flex', lineHeight: 1, marginLeft: 1 }}>{trailing}</span>}
    </button>
  );
  // Styled hover tooltip (lifted from the canvas) in place of the native one.
  return title ? (
    <HoverTip text={title} placement="bottom" accent={accent}>
      {btn}
    </HoverTip>
  ) : (
    btn
  );
}

// =====================================================================
// BraindumpDock — the braindump input as a toolbar slide-out instead of a
// permanently-open header box. Opens from the toolbar's Braindump button;
// extraction keeps running with the dock closed (the toolbar button carries a
// pulsing dot while inflight). Fires extract-braindump async via SQS; new
// entities land on the canvas when the braindump_complete WS event arrives.
// =====================================================================

export type DockIntentValue =
  | { mode: 'auto' }
  | { mode: 'aside' }
  | { mode: 'picking' }
  | { mode: 'spot'; targetId: string; targetTitle: string; containment?: 'none'; position?: 'before'; action?: 'merge' };

export function BraindumpDock({
  open,
  text,
  setText,
  phase,
  message,
  onSubmit,
  onClose,
  intent,
  onIntentChange,
  showIntent,
  floating,
  onFocusChange,
}: {
  open: boolean;
  text: string;
  setText: (s: string) => void;
  phase: 'idle' | 'submitting' | 'extracting' | 'done' | 'error';
  message: string | null;
  onSubmit: () => void;
  onClose: () => void;
  /** Placement Control v1c — the dock intent ("this goes…"). */
  intent?: DockIntentValue;
  onIntentChange?: (i: DockIntentValue) => void;
  /** Only append dumps get the row (a first dump has nowhere to point). */
  showIntent?: boolean;
  /** When the toolbar is riding the viewport (stuck), the dock pops out fixed
   *  right below it instead of opening back at the top of the page. */
  floating?: { top: number; left: number; width: number } | null;
  /** Reports the field's focus so the toolbar's underside highlight can
   *  brighten in sync with the field's frame. */
  onFocusChange?: (focused: boolean) => void;
}) {
  const busy = phase === 'submitting' || phase === 'extracting';
  // Scroll-jump fix: when the dock switches to floating (position: fixed), it
  // leaves the flow and the board lurches up by the dock's height. Keep a
  // same-height spacer in the flow while floating so scrolling is continuous.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [flowH, setFlowH] = useState(0);
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!floating) setFlowH(el.offsetHeight);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [floating]);
  // No minimum length. The 20-char floor was a leftover from the generative
  // side's brainstorm gate; on the corkboard a two-word dump ("Frank betrays
  // Roy") is a legitimate card and the writer shouldn't be argued with about
  // it. Any non-empty text extracts. (FIL-590)
  const canSubmit = !busy && text.trim().length > 0;
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const dark = useThemeMode() === 'dark';
  const [focused, setFocused] = useState(false);
  const restingShadow = dark
    ? '0 0 15px rgba(255,107,53,0.12), 0 0 35px rgba(255,107,53,0.06), 0 8px 28px rgba(0,0,0,0.5)'
    : '0 0 15px rgba(255,107,53,0.12), 0 0 35px rgba(255,107,53,0.06), 0 8px 24px rgba(120,90,40,0.08)';
  const focusShadow =
    '0 0 10px rgba(255,140,0,0.4), 0 0 25px rgba(255,140,0,0.2), 0 0 50px rgba(255,140,0,0.1)';

  useEffect(() => {
    if (open) {
      // Focus after the slide-down transition starts so the caret is ready.
      const t = window.setTimeout(() => taRef.current?.focus(), 120);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (canSubmit) onSubmit();
    }
    if (e.key === 'Escape') onClose();
  };

  return (
    <>
    {floating && open && <div style={{ height: flowH, marginBottom: 12 }} aria-hidden />}
    <div
      ref={rootRef}
      data-tour="braindump-dock"
      style={{
        ...(floating
          ? {
              position: 'fixed' as const,
              top: floating.top,
              left: floating.left,
              width: floating.width,
              boxSizing: 'border-box' as const,
              zIndex: 139,
            }
          : null),
        // overflow stays hidden only while animating closed — once open it
        // goes visible so the field's orange glow isn't clipped at the edges.
        overflow: open ? 'visible' : 'hidden',
        maxHeight: open ? 480 : 0,
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0)' : 'translateY(-6px)',
        transition: 'max-height 240ms ease, opacity 200ms ease, transform 240ms ease',
        marginBottom: !floating && open ? 12 : 0,
      }}
    >
      {/* No panel chrome — the glowing field IS the dock, extending straight
          out of the toolbar (the bar squares its bottom corners while open).
          Mirrors Home's Story Brainstorming: orange frame + glow on the field,
          action button + status floating INSIDE it. The toolbar's Braindump
          button is the collapse toggle; Esc closes too. */}
      <div style={{ position: 'relative', fontFamily: 'system-ui, sans-serif' }}>
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={busy}
          placeholder="This is a space to write freely about your story. Characters, scenes, conflicts, vibes, anything goes…"
          rows={1}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            minHeight: 180,
            padding: '16px 18px',
            // Clear the floating action button + status line.
            paddingBottom: 64,
            fontSize: 15,
            lineHeight: 1.7,
            fontFamily: 'inherit',
            // The FULL frame lives on this one element — including the line
            // under the toolbar — so thickness/color/glow can never mismatch.
            border: `2px solid ${focused ? '#FF8C00' : 'rgba(255,140,0,0.45)'}`,
            borderRadius: '0 0 14px 14px',
            outline: 'none',
            background: dark ? '#16171c' : '#fff',
            color: dark ? '#e6e6ea' : '#1d2230',
            boxShadow: focused ? focusShadow : restingShadow,
            transition: 'border-color 200ms ease, box-shadow 200ms ease, background 200ms ease',
            opacity: busy ? 0.6 : 1,
            display: 'block',
          }}
          onFocus={() => { setFocused(true); onFocusChange?.(true); }}
          onBlur={() => { setFocused(false); onFocusChange?.(false); }}
        />
        {/* Status + word count, floating bottom-left inside the field. */}
        <div
          style={{
            position: 'absolute', bottom: 18, left: 18, zIndex: 2,
            display: 'flex', alignItems: 'baseline', gap: 10,
            pointerEvents: 'none', maxWidth: '55%',
          }}
        >
          {text.trim() && (
            <span style={{ fontSize: 11.5, fontWeight: 600, color: '#ff8c42', whiteSpace: 'nowrap' }}>
              {text.trim().split(/\s+/).length} words
            </span>
          )}
          <span style={{ fontSize: 11, color: phase === 'error' ? '#ef4444' : dark ? '#7a7a84' : '#9a9aa4', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {message ?? ''}
          </span>
        </div>
        {/* Floating controls inside the field, bottom-right: the dock intent
            chips (Placement Control v1c) + the action button. */}
        <div style={{ position: 'absolute', bottom: 16, right: 16, zIndex: 2, display: 'flex', alignItems: 'center', gap: 10 }}>
        {showIntent && intent && onIntentChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: dark ? '#8a8a94' : '#9a9aa4', fontFamily: 'system-ui, sans-serif' }}>
            <IntentChoice
              label="auto"
              tip="The system places this dump's new cards where they fit. Anything it can't place with confidence waits for you in the panel."
              active={intent.mode === 'auto'}
              dark={dark}
              onClick={() => onIntentChange({ mode: 'auto' })}
            />
            {intent.mode === 'spot' ? (
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '2px 8px', borderRadius: 999,
                  border: '1px solid #ff8c42', color: '#ff8c42', fontWeight: 600,
                  maxWidth: 240,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {intent.targetTitle}
                </span>
                <button
                  onClick={() => onIntentChange({ mode: 'auto' })}
                  title="Clear the spot"
                  style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontSize: 12, lineHeight: 1 }}
                >
                  ×
                </button>
              </span>
            ) : (
              <IntentChoice
                label={intent.mode === 'picking' ? 'tap a spot on the board…' : 'somewhere specific'}
                tip="Point at the story first: the board morphs into reading order and you tap a gap, a card to merge into, or a sequence. This dump's new cards land there."
                active={intent.mode === 'picking'}
                dark={dark}
                onClick={() => onIntentChange(intent.mode === 'picking' ? { mode: 'auto' } : { mode: 'picking' })}
              />
            )}
            <IntentChoice
              label="keep aside"
              tip="Nothing touches the board: everything from this dump waits in the panel until you place it yourself. There's no deadline."
              active={intent.mode === 'aside'}
              dark={dark}
              onClick={() => onIntentChange(intent.mode === 'aside' ? { mode: 'auto' } : { mode: 'aside' })}
            />
          </div>
        )}
        {text.trim().length > 0 && (
          <button
            onClick={onSubmit}
            disabled={!canSubmit}
            title="⌘+Enter"
            style={{
              height: 34, padding: '0 18px', fontSize: 12.5, fontWeight: 600,
              border: 'none', borderRadius: 12,
              background: canSubmit
                ? 'linear-gradient(135deg, #ff6b35 0%, #ff8c42 100%)'
                : dark ? '#222227' : '#e8eaef',
              color: canSubmit ? '#fff' : dark ? '#6a6a74' : '#9aa0ad',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              boxShadow: canSubmit ? '0 4px 12px rgba(255,107,53,0.3)' : 'none',
              transition: 'background 120ms ease-out, box-shadow 120ms ease-out',
            }}
            onMouseEnter={(e) => {
              if (canSubmit) e.currentTarget.style.boxShadow = '0 6px 16px rgba(255,107,53,0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.boxShadow = canSubmit ? '0 4px 12px rgba(255,107,53,0.3)' : 'none';
            }}
          >
            {phase === 'submitting' ? 'Queueing…' : phase === 'extracting' ? 'Extracting…' : 'Process into Cards'}
          </button>
        )}
        </div>
      </div>
    </div>
    </>
  );
}

function IntentChoice({ label, tip, active, dark, onClick }: {
  label: string; tip?: string; active: boolean; dark: boolean; onClick: () => void;
}) {
  const btn = (
    <button
      onClick={onClick}
      style={{
        padding: '2px 8px', borderRadius: 999, fontSize: 11.5, fontFamily: 'inherit',
        border: `1px solid ${active ? '#ff8c42' : dark ? '#33333a' : '#ddd'}`,
        background: active ? 'rgba(255,140,66,0.12)' : 'transparent',
        color: active ? '#ff8c42' : dark ? '#8a8a94' : '#9a9aa4',
        fontWeight: active ? 600 : 400, cursor: 'pointer',
        transition: 'color 120ms, border-color 120ms, background 120ms',
      }}
    >
      {label}
    </button>
  );
  // Tooltip above the chip (the chips sit at the field's bottom edge, so a
  // below-tooltip would collide with the Process button / page chrome).
  return tip ? <HoverTip text={tip} placement="top" accent="#ff8c42" width={240}>{btn}</HoverTip> : btn;
}
