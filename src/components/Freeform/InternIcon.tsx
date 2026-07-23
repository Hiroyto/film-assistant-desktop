// components/Freeform/InternIcon.tsx
//
// The glasses SVG used as the Peer persona icon throughout the freeform-peer
// feature. Lifted from the existing intern feature (canonical inline copy
// in TextArea.tsx:242-251). Consolidating here so downstream tickets don't
// duplicate it further.
//
// Uses currentColor — sets ink from the parent's text color. In peer-card
// header, parent color should be set to PEER_BLUE (#54bfdb).

import React from 'react';

interface InternIconProps {
  /** Pixel size (icon is square). Default 16. */
  size?: number;
  /** Optional className for extra styling. */
  className?: string;
  /** Aria-label override. Default is decorative (aria-hidden). */
  ariaLabel?: string;
}

const InternIcon: React.FC<InternIconProps> = ({ size = 16, className, ariaLabel }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 15 15"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden={ariaLabel ? undefined : true}
    aria-label={ariaLabel}
    role={ariaLabel ? 'img' : undefined}
  >
    <circle cx="4" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
    <circle cx="11" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
    <path d="M6.5 7.5H8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M1.5 7.5H1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M13.5 7.5H13.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M1.5 7.5L0.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <path d="M13.5 7.5L14.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

export default InternIcon;
