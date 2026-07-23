// components/Freeform/corkboard/tooltip.tsx
// HoverTip: a reusable styled hover tooltip for corkboard affordances. The
// styling is lifted from the canvas floating-button tooltips (CanvasToolbar.tsx):
// glassy dark panel, 8px radius, 11px copy, soft shadow. Theme-aware so light
// mode is not black-on-white. The tooltip is rendered through a portal to
// document.body with fixed positioning, so it escapes any overflow:hidden
// ancestor (e.g. an expanded bento tile) instead of being clipped.
import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { hexToRgba } from '../../../components/Freeform/entityColors';
import { useThemeMode } from './theme';

type Placement = 'top' | 'bottom' | 'bottom-left' | 'bottom-right';

export function HoverTip({
  text,
  placement = 'bottom',
  accent,
  width = 220,
  children,
  wrapStyle,
}: {
  text: string;
  placement?: Placement;
  accent?: string;
  width?: number;
  children: React.ReactNode;
  wrapStyle?: React.CSSProperties;
}) {
  const dark = useThemeMode() === 'dark';
  const ref = useRef<HTMLSpanElement>(null);
  const [show, setShow] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; transform: string; width: number }>({
    top: 0, left: 0, transform: 'none', width,
  });

  const place = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 8;
    const margin = 8;
    const vw = window.innerWidth;
    // Effective width: never wider than the prop, a hard cap, or 70% of the viewport.
    const effW = Math.min(width, 240, Math.floor(vw * 0.7));
    let left: number;
    let top: number;
    let transform = 'none';
    switch (placement) {
      case 'top':
        left = r.left + r.width / 2 - effW / 2;
        top = r.top - gap;
        transform = 'translateY(-100%)';
        break;
      case 'bottom-left':
        left = r.right - effW;
        top = r.bottom + gap;
        break;
      case 'bottom-right':
        left = r.left;
        top = r.bottom + gap;
        break;
      default: // bottom, centered on the trigger
        left = r.left + r.width / 2 - effW / 2;
        top = r.bottom + gap;
    }
    // Clamp horizontally so the tooltip never leaves the viewport.
    left = Math.max(margin, Math.min(left, vw - effW - margin));
    setCoords({ top, left, transform, width: effW });
  };

  return (
    <span
      ref={ref}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...wrapStyle }}
      onMouseEnter={() => { place(); setShow(true); }}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && createPortal(
        <span
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            transform: coords.transform,
            padding: '0.55rem 0.7rem',
            background: dark ? 'rgba(20, 20, 26, 0.98)' : 'rgba(255, 255, 255, 0.99)',
            border: `1px solid ${accent ? hexToRgba(accent, 0.4) : dark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'}`,
            borderRadius: 8,
            fontSize: 11,
            fontWeight: 400,
            letterSpacing: 0,
            textTransform: 'none',
            color: dark ? 'rgba(255, 255, 255, 0.72)' : '#555',
            width: coords.width,
            lineHeight: 1.45,
            textAlign: 'left',
            whiteSpace: 'normal',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
            pointerEvents: 'none',
            zIndex: 9999,
          }}
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}
