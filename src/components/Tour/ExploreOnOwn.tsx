import React, { useState } from 'react';

// The wow's universal opt-out. On hover it slides "(cancel tour)" out from
// behind the label so the writer knows what it does. Used on every coachmark
// (TourProvider tooltip) and the wow banners.
export function ExploreOnOwn({
  onClick,
  color = 'rgba(255,255,255,0.5)',
}: {
  onClick: () => void;
  color?: string;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: hover ? 'rgba(255,255,255,0.85)' : color,
        fontSize: 12,
        padding: 0,
        fontFamily: 'inherit',
        transition: 'color 160ms ease',
      }}
    >
      I'll explore on my own
      <span
        style={{
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          maxWidth: hover ? 92 : 0,
          opacity: hover ? 0.75 : 0,
          marginLeft: hover ? 6 : 0,
          fontStyle: 'italic',
          transition: 'max-width 220ms ease, opacity 220ms ease, margin-left 220ms ease',
        }}
      >
        (cancel tour)
      </span>
    </button>
  );
}
