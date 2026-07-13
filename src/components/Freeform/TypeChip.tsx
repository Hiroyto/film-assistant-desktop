// components/Freeform/TypeChip.tsx
//
// Small entity-type label rendered in card headers ("CHARACTER", "EVENT", etc.).
// Uses the locked palette via the entityColors helpers.

import React from 'react';
import type { EntityType } from './types';
import { getEntityColor, getTypeLabel, hexToRgba } from './entityColors';

interface TypeChipProps {
  /** The entity type this chip labels. */
  type: EntityType;
  /** Override the displayed label (defaults to type.toUpperCase()). */
  label?: string;
  /** Show a leading diamond glyph ◆. Default true. */
  withGlyph?: boolean;
  /** Compact mode for tight headers (smaller padding + font). */
  compact?: boolean;
}

const TypeChip: React.FC<TypeChipProps> = ({ type, label, withGlyph = true, compact = false }) => {
  const color = getEntityColor(type);
  const displayLabel = label ?? getTypeLabel(type);

  return (
    <span
      className={`
        inline-flex items-center gap-1 font-mono tracking-wider uppercase rounded-sm
        ${compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'}
      `}
      style={{
        color,
        backgroundColor: hexToRgba(color, 0.08),
        border: `1px solid ${hexToRgba(color, 0.25)}`,
      }}
    >
      {withGlyph && <span aria-hidden>◆</span>}
      {displayLabel}
    </span>
  );
};

export default TypeChip;
