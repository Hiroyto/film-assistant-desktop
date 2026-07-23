// components/Freeform/CardChrome.tsx
//
// Shared dark-gradient card container used by entity cards (Character/Event/
// Relationship/Location) AND the floating peer card. Type-color border accent,
// drop shadow, backdrop blur — matches the existing DraggableCard chrome.
//
// Locked in Tasks #2/#3/#4/#5/#6/#7:
//   - Border: type-color, 70% opacity 1px when unfocused, 100% 2px when working
//   - Background: dark gradient with type-tint
//   - Drop shadow scaled with elevation (working = deeper)
//   - 12px border-radius, backdrop-blur

import React from 'react';
import type { EntityType } from './types';
import { getEntityColor, hexToRgba } from './entityColors';
import { PEER_BLUE, CARD_WIDTH_COLLAPSED, CARD_WIDTH_WORKING, CARD_MAX_HEIGHT_VH } from './tokens';

type CardChromeVariant = 'collapsed' | 'working' | 'peer';

interface CardChromeProps {
  /** Determines border weight, glow, dimensions, and elevation. */
  variant: CardChromeVariant;
  /** Entity type — drives the border accent. Ignored for variant='peer' (uses peer blue). */
  type?: EntityType;
  /** Children render inside the card body. */
  children: React.ReactNode;
  /** Optional className for extras. */
  className?: string;
  /** Click handler — fires on card body (not children that stopPropagation). */
  onClick?: (e: React.MouseEvent) => void;
  /** Accessibility: announce as a button for click-to-focus collapsed cards. */
  role?: string;
  /** Override width — defaults: collapsed=220, working=520, peer=520. */
  width?: number;
  /** Apply a soft type-color glow (used for "newly arrived" cards). */
  withSoftGlow?: boolean;
}

const CardChrome: React.FC<CardChromeProps> = ({
  variant,
  type,
  children,
  className,
  onClick,
  role,
  width,
  withSoftGlow = false,
}) => {
  const accentColor = variant === 'peer' ? PEER_BLUE : type ? getEntityColor(type) : '#9ca3af';

  const isFocused = variant === 'working' || variant === 'peer';

  const computedWidth =
    width ?? (variant === 'collapsed' ? CARD_WIDTH_COLLAPSED : CARD_WIDTH_WORKING);

  const borderOpacity = isFocused ? 1 : 0.7;
  const borderWidth = isFocused ? 2 : 1;
  const shadow = isFocused
    ? '0 12px 40px rgba(0, 0, 0, 0.5)'
    : '0 4px 16px rgba(0, 0, 0, 0.3)';

  const bgGradient =
    variant === 'peer'
      ? 'linear-gradient(135deg, rgba(40,50,60,0.95) 0%, rgba(35,45,55,0.95) 100%)'
      : 'linear-gradient(135deg, rgba(60,60,68,0.95) 0%, rgba(50,50,58,0.95) 100%)';

  const innerGlow = isFocused ? `inset 0 0 0 1px ${hexToRgba(accentColor, 0.18)}` : 'none';

  return (
    <div
      onClick={onClick}
      role={role}
      className={`relative rounded-xl backdrop-blur-md ${className ?? ''}`}
      style={{
        width: computedWidth,
        maxHeight: isFocused ? `${CARD_MAX_HEIGHT_VH}vh` : undefined,
        overflowY: isFocused ? 'auto' : undefined,
        background: bgGradient,
        border: `${borderWidth}px solid ${hexToRgba(accentColor, borderOpacity)}`,
        boxShadow: `${shadow}${innerGlow !== 'none' ? `, ${innerGlow}` : ''}`,
        color: accentColor,
      }}
    >
      {/* Soft glow overlay when withSoftGlow=true */}
      {withSoftGlow && (
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none rounded-xl animate-soft-glow"
          style={{ color: accentColor }}
        />
      )}
      <div className="relative z-10 p-4 text-fontWhite07">{children}</div>
    </div>
  );
};

export default CardChrome;
