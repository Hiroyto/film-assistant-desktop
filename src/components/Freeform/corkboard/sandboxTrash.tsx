// components/Freeform/corkboard/sandboxTrash.tsx
//
// THE SANDBOX'S DELETE (Ben, 2026-10-12: "instead of the underlined delete
// button can we use our trash can icon with appropriate hover animation?").
// The master card's trash (DeleteCardLink in cards.tsx): the same can, quiet
// grey, red on hover, two clicks (the first arms "sure?" for 3s). Added here:
// the lid tips open on hover and stays open while armed, so the can reads as
// about to take something. Reduced motion keeps the colour change only.

import React, { useEffect, useRef, useState } from 'react';

const CSS = `
.ff-trash .ff-trash-lid{transition:transform 180ms cubic-bezier(.2,.7,.2,1);transform-box:fill-box;transform-origin:100% 100%}
.ff-trash:hover .ff-trash-lid,.ff-trash:focus-visible .ff-trash-lid,.ff-trash[data-armed] .ff-trash-lid{transform:translate(-0.5px,-1.2px) rotate(-22deg)}
.ff-trash:hover .ff-trash-can,.ff-trash[data-armed] .ff-trash-can{transform:translateY(0.3px)}
.ff-trash .ff-trash-can{transition:transform 180ms ease}
@media (prefers-reduced-motion: reduce){.ff-trash .ff-trash-lid,.ff-trash .ff-trash-can{transition:none;transform:none!important}}
`;

export function TrashButton({ onConfirm, dark, label = 'card', size = 15, testId, noTitle = false }: { onConfirm: () => void; dark: boolean; label?: string; size?: number; testId?: string;
  /** Inside a row that draws its own hover label (the focus card's header). */
  noTitle?: boolean }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const quiet = dark ? '#6b6b74' : '#9a9aa4';
  const red = '#ef4444';
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    setArmed(false);
    onConfirm();
  };
  return (
    <>
      <style>{CSS}</style>
      <button
        type="button"
        className="ff-trash"
        data-armed={armed ? '1' : undefined}
        data-delete-card={testId ?? ''}
        {...(armed ? { 'data-delete-confirm': '' } : {})}
        aria-label={armed ? `Click again to delete this ${label}` : `Delete this ${label}`}
        title={noTitle ? undefined : armed ? 'Click again to delete (Undo brings it back)' : `Delete this ${label}`}
        onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}
        onClick={onClick}
        onMouseEnter={(e) => { if (!armed) e.currentTarget.style.color = red; }}
        onMouseLeave={(e) => { if (!armed) e.currentTarget.style.color = quiet; }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
          fontFamily: 'system-ui, sans-serif', fontSize: 11, fontWeight: 600,
          padding: armed ? '3px 9px' : '3px 5px', borderRadius: 999,
          border: `1px solid ${armed ? 'rgba(239,68,68,0.55)' : 'transparent'}`,
          background: armed ? 'rgba(239,68,68,0.1)' : 'transparent',
          color: armed ? red : quiet,
          transition: 'color 120ms, border-color 120ms, background 120ms, padding 120ms',
        }}
      >
        {/* A bin, not a battery (FIL-702, Philip 2026-10-30): handle, lid,
            a tapered can with two ribs, drawn in strokes. */}
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden style={{ display: 'block', overflow: 'visible' }}>
          <g className="ff-trash-lid">
            <path d="M6.3 2.4h3.4" />
            <path d="M2.8 4.4h10.4" />
          </g>
          <g className="ff-trash-can">
            <path d="M4.2 4.4l.75 8.7c.05.6.55 1.05 1.15 1.05h3.8c.6 0 1.1-.45 1.15-1.05l.75-8.7" />
            <path d="M6.8 7v4.4M9.2 7v4.4" />
          </g>
        </svg>
        {armed ? 'sure?' : null}
      </button>
    </>
  );
}
