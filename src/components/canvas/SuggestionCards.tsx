/**
 * SuggestionCards
 * 
 * A set of static suggestion cards that appear docked to the right
 * of the segment content block. Features:
 * - Fade in animation when triggered
 * - Pulsing skeleton state while loading
 * - Checkboxes for multi-select
 * - Batch submit of selected suggestions
 * - Regenerate for fresh batch
 * - Fade out when submitted or dismissed
 * - Collapsible rationale sections (collapsed by default)
 * - Visual indicator for which suggestion is currently being previewed
 * - Responsive layout for compact/stacked mode
 * 
 * UPDATED: Structured suggestions with direction/rationale format
 * Rationale is collapsed by default with "View Rationale" toggle
 */

import React, { useState, useEffect, useCallback } from 'react';
import { CanvasCard, LinkedText } from './types';

// =============================================================================
// Types for structured suggestion content
// =============================================================================

interface StructuredSuggestion {
  direction: string;
  rationale: string;
}

// =============================================================================
// Props Interface
// =============================================================================

interface SuggestionCardsProps {
  isVisible: boolean;
  isLoading: boolean;
  suggestions: CanvasCard[];
  targetText?: LinkedText | null;
  onApplySelected: (ids: string[]) => void;
  onDismissAll: () => void;
  onRegenerate: () => void;
  onClose: () => void;
  selectedSuggestionIds?: string[];  // Which suggestions are currently being previewed
  isApplying?: boolean;  // True when Apply or Try Again is in progress
  isCompact?: boolean;  // Responsive compact mode
}

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    position: 'absolute',
    top: 0,
    left: '100%',
    marginLeft: 20,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    opacity: 0,
    transform: 'translateX(20px)',
    transition: 'opacity 0.3s ease, transform 0.3s ease',
    pointerEvents: 'none',
    maxHeight: '80vh',
    overflowY: 'auto',
    overflowX: 'visible',
    paddingTop: 48,
    marginTop: -48,
    paddingRight: 8,
  },
  
  // Compact mode container - stacked below content
  containerCompact: {
    position: 'relative',
    top: 'auto',
    left: 'auto',
    marginLeft: 0,
    marginTop: 12,
    width: '100%',
    maxHeight: '50vh',
    paddingTop: 40,
    marginBottom: 0,
    paddingRight: 0,
  },
  
  containerVisible: {
    opacity: 1,
    transform: 'translateX(0)',
    pointerEvents: 'auto',
  },
  
  containerApplying: {
    opacity: 0.7,
    pointerEvents: 'none',
  },
  
  // Target text indicator
  targetIndicator: {
    padding: '0.5rem 0.75rem',
    background: 'rgba(139, 92, 246, 0.1)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    borderRadius: 8,
    flexShrink: 0,
  },
  
  targetLabel: {
    fontSize: 9,
    fontWeight: 600,
    color: 'rgba(139, 92, 246, 0.7)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 4,
  },
  
  targetText: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 1.4,
    fontStyle: 'italic',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  
  // Card styles - compact by default
  card: {
    width: 320,
    background: 'linear-gradient(135deg, rgba(45, 40, 60, 0.95) 0%, rgba(35, 30, 50, 0.95) 100%)',
    border: '2px solid rgba(255, 255, 255, 0.08)',
    borderRadius: 12,
    overflow: 'hidden',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
    cursor: 'pointer',
    position: 'relative',
    flexShrink: 0,
  },
  
  // Compact mode card - full width
  cardCompact: {
    width: '100%',
  },
  
  cardHover: {
    border: '2px solid rgba(139, 92, 246, 0.5)',
    boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4), 0 0 24px rgba(139, 92, 246, 0.2)',
  },
  
  cardSelected: {
    border: '2px solid #10b981',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 20px rgba(16, 185, 129, 0.2)',
    background: 'linear-gradient(135deg, rgba(45, 50, 55, 0.95) 0%, rgba(35, 45, 45, 0.95) 100%)',
  },
  
  // Active state - this suggestion is currently being previewed
  cardActive: {
    border: '2px solid #10b981',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 24px rgba(16, 185, 129, 0.35)',
    background: 'linear-gradient(135deg, rgba(45, 55, 50, 0.98) 0%, rgba(30, 50, 45, 0.98) 100%)',
  },
  
  cardDismissed: {
    opacity: 0,
    transform: 'translateX(20px) scale(0.95)',
    pointerEvents: 'none',
  },
  
  // Selection indicator (checkbox)
  selectionIndicator: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 22,
    height: 22,
    borderRadius: 6,
    border: '2px solid rgba(255, 255, 255, 0.2)',
    background: 'rgba(255, 255, 255, 0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    zIndex: 2,
  },
  
  selectionIndicatorSelected: {
    borderColor: '#10b981',
    background: '#10b981',
  },
  
  // Active badge - shows when this suggestion is being previewed
  activeBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    padding: '0.15rem 0.4rem',
    borderRadius: 4,
    background: 'rgba(16, 185, 129, 0.9)',
    color: 'white',
    fontSize: 8,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    zIndex: 2,
  },
  
  header: {
    padding: '0.5rem 0.75rem',
    paddingRight: '2.25rem',
    background: 'rgba(139, 92, 246, 0.1)',
    borderBottom: '1px solid rgba(139, 92, 246, 0.15)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  
  headerSelected: {
    background: 'rgba(16, 185, 129, 0.1)',
    borderBottom: '1px solid rgba(16, 185, 129, 0.15)',
  },
  
  headerActive: {
    background: 'rgba(16, 185, 129, 0.15)',
    borderBottom: '1px solid rgba(16, 185, 129, 0.25)',
  },
  
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    flex: 1,
  },
  
  iconWrapper: {
    width: 20,
    height: 20,
    borderRadius: 5,
    background: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'white',
    transition: 'all 0.2s ease',
    flexShrink: 0,
  },
  
  iconWrapperSelected: {
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
  },
  
  headerTitle: {
    fontSize: 10,
    fontWeight: 600,
    color: '#a78bfa',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    transition: 'color 0.2s ease',
  },
  
  headerTitleSelected: {
    color: '#34d399',
  },
  
  // Rationale toggle in header
  headerRationaleToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.2rem 0.4rem',
    background: 'transparent',
    border: '1px solid rgba(139, 92, 246, 0.25)',
    borderRadius: 4,
    color: 'rgba(139, 92, 246, 0.7)',
    fontSize: 9,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    marginRight: '0.25rem',
  },
  
  headerRationaleToggleSelected: {
    borderColor: 'rgba(16, 185, 129, 0.25)',
    color: 'rgba(16, 185, 129, 0.7)',
  },
  
  headerRationaleToggleExpanded: {
    background: 'rgba(139, 92, 246, 0.15)',
    borderColor: 'rgba(139, 92, 246, 0.4)',
  },
  
  headerRationaleToggleExpandedSelected: {
    background: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  
  body: {
    padding: '0.75rem',
  },
  
  // Compact mode body - less padding
  bodyCompact: {
    padding: '0.5rem 0.75rem',
  },
  
  // Direction section (main suggestion) - always visible
  directionContent: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.9)',
    lineHeight: 1.55,
  },
  
  chevron: {
    transition: 'transform 0.2s ease',
    display: 'flex',
    alignItems: 'center',
  },
  
  chevronExpanded: {
    transform: 'rotate(180deg)',
  },
  
  // Rationale section (collapsible)
  rationaleSection: {
    maxHeight: 0,
    overflow: 'hidden',
    transition: 'max-height 0.25s ease, margin-top 0.25s ease',
    marginTop: 0,
  },
  
  rationaleSectionExpanded: {
    maxHeight: 200,
    marginTop: '0.6rem',
  },
  
  rationaleInner: {
    padding: '0.55rem 0.65rem',
    background: 'rgba(139, 92, 246, 0.08)',
    borderRadius: 8,
    border: '1px solid rgba(139, 92, 246, 0.12)',
  },
  
  rationaleInnerSelected: {
    background: 'rgba(16, 185, 129, 0.08)',
    border: '1px solid rgba(16, 185, 129, 0.12)',
  },
  
  rationaleLabel: {
    fontSize: 9,
    fontWeight: 600,
    color: 'rgba(139, 92, 246, 0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '0.3rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.3rem',
  },
  
  rationaleLabelSelected: {
    color: 'rgba(16, 185, 129, 0.6)',
  },
  
  rationaleContent: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    lineHeight: 1.5,
    fontStyle: 'italic',
  },
  
  // Legacy simple content (fallback)
  content: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.85)',
    lineHeight: 1.55,
  },
  
  // Top actions row (positioned at top of container)
  topActions: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 8,
    display: 'flex',
    gap: '0.5rem',
  },
  
  // Compact mode top actions
  topActionsCompact: {
    right: 0,
  },
  
  regenerateButton: {
    flex: 1,
    padding: '0.5rem 0.75rem',
    borderRadius: 8,
    border: '1px solid rgba(139, 92, 246, 0.3)',
    background: 'rgba(139, 92, 246, 0.1)',
    color: '#a78bfa',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.4rem',
    transition: 'all 0.2s ease',
  },
  
  dismissAllButton: {
    flex: 1,
    padding: '0.5rem 0.75rem',
    borderRadius: 8,
    border: '1px solid rgba(255, 255, 255, 0.15)',
    background: 'rgba(255, 255, 255, 0.05)',
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 11,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  
  // Apply button (replaces top actions when selections made)
  applyButton: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 8,
    padding: '0.5rem 1rem',
    borderRadius: 8,
    border: 'none',
    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
    color: 'white',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    transition: 'all 0.2s ease',
  },
  
  // Compact mode apply button
  applyButtonCompact: {
    right: 0,
  },
  
  selectionHint: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.4)',
    textAlign: 'center',
    padding: '0.4rem',
    flexShrink: 0,
  },
  
  // Skeleton / Loading styles
  skeletonCard: {
    width: 320,
    background: 'linear-gradient(135deg, rgba(45, 40, 60, 0.95) 0%, rgba(35, 30, 50, 0.95) 100%)',
    border: '2px solid rgba(139, 92, 246, 0.15)',
    borderRadius: 12,
    overflow: 'hidden',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    flexShrink: 0,
  },
  
  // Compact mode skeleton
  skeletonCardCompact: {
    width: '100%',
  },
  
  skeletonHeader: {
    padding: '0.5rem 0.75rem',
    background: 'rgba(139, 92, 246, 0.08)',
    borderBottom: '1px solid rgba(139, 92, 246, 0.1)',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  
  skeletonIcon: {
    width: 20,
    height: 20,
    borderRadius: 5,
    background: 'rgba(139, 92, 246, 0.2)',
    animation: 'shimmer 1.5s ease-in-out infinite',
  },
  
  skeletonTitle: {
    width: 70,
    height: 10,
    borderRadius: 4,
    background: 'rgba(139, 92, 246, 0.15)',
    animation: 'shimmer 1.5s ease-in-out infinite',
  },
  
  skeletonBody: {
    padding: '0.75rem',
  },
  
  skeletonLine: {
    height: 10,
    borderRadius: 4,
    background: 'rgba(255, 255, 255, 0.08)',
    marginBottom: '0.45rem',
    animation: 'shimmer 1.5s ease-in-out infinite',
  },
};

// =============================================================================
// Icons
// =============================================================================

const LightningIcon: React.FC<{ size?: number }> = ({ size = 10 }) => (
  <svg width={size} height={size} viewBox="0 0 15 15" fill="currentColor">
    <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
  </svg>
);

const CheckIcon: React.FC<{ size?: number }> = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const RefreshIcon: React.FC<{ size?: number }> = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 4v6h6M23 20v-6h-6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LightbulbIcon: React.FC<{ size?: number }> = ({ size = 9 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ChevronIcon: React.FC<{ size?: number }> = ({ size = 10 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// =============================================================================
// Helper: Parse suggestion content
// =============================================================================

const parseSuggestionContent = (content: string): StructuredSuggestion | null => {
  if (typeof content === 'object' && content !== null) {
    const obj = content as any;
    if (obj.direction && obj.rationale) {
      return { direction: obj.direction, rationale: obj.rationale };
    }
  }
  
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content);
      if (parsed.direction && parsed.rationale) {
        return { direction: parsed.direction, rationale: parsed.rationale };
      }
    } catch {
      // Not JSON, return null to use as plain text
    }
  }
  
  return null;
};

// =============================================================================
// Skeleton Card Component
// =============================================================================

const SkeletonCard: React.FC<{ index: number; isCompact?: boolean }> = ({ index, isCompact = false }) => (
  <div style={{
    ...styles.skeletonCard,
    ...(isCompact ? styles.skeletonCardCompact : {}),
  }}>
    <div style={styles.skeletonHeader}>
      <div style={{ ...styles.skeletonIcon, animationDelay: `${index * 0.1}s` }} />
      <div style={{ ...styles.skeletonTitle, animationDelay: `${index * 0.1 + 0.05}s` }} />
      <div style={{ flex: 1 }} />
      <div style={{ 
        width: 45, 
        height: 16, 
        borderRadius: 4, 
        background: 'rgba(139, 92, 246, 0.1)',
        animation: 'shimmer 1.5s ease-in-out infinite',
        animationDelay: `${index * 0.1 + 0.08}s`,
      }} />
    </div>
    <div style={styles.skeletonBody}>
      <div style={{ ...styles.skeletonLine, width: '100%', animationDelay: `${index * 0.1 + 0.1}s` }} />
      <div style={{ ...styles.skeletonLine, width: '95%', animationDelay: `${index * 0.1 + 0.15}s` }} />
      <div style={{ ...styles.skeletonLine, width: '75%', marginBottom: 0, animationDelay: `${index * 0.1 + 0.2}s` }} />
    </div>
  </div>
);

// =============================================================================
// Suggestion Card Component
// =============================================================================

interface SuggestionCardProps {
  suggestion: CanvasCard;
  index: number;
  isSelected: boolean;
  isActive: boolean;  // This suggestion is currently being previewed
  onToggleSelect: () => void;
  disabled?: boolean;  // Disable clicking during pending revision
  isCompact?: boolean;  // Responsive compact mode
}

const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  index,
  isSelected,
  isActive,
  onToggleSelect,
  disabled = false,
  isCompact = false,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [isRationaleExpanded, setIsRationaleExpanded] = useState(false);
  
  // Parse the content to check if it's structured
  const structuredContent = parseSuggestionContent(suggestion.content);
  
  // Combined selected/active state for styling
  const isHighlighted = isSelected || isActive;
  
  const handleToggleRationale = (e: React.MouseEvent) => {
    e.stopPropagation(); // Don't trigger card selection
    setIsRationaleExpanded(!isRationaleExpanded);
  };
  
  return (
    <div
      style={{
        ...styles.card,
        ...(isCompact ? styles.cardCompact : {}),
        ...(isHovered && !isHighlighted && !disabled ? styles.cardHover : {}),
        ...(isActive ? styles.cardActive : {}),
        ...(isSelected && !isActive ? styles.cardSelected : {}),
        ...(disabled ? { opacity: 0.6, cursor: 'default' } : {}),
      }}
      onClick={disabled ? undefined : onToggleSelect}
      onMouseEnter={() => !disabled && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Selection indicator checkbox */}
      <div
        style={{
          ...styles.selectionIndicator,
          ...(isHighlighted ? styles.selectionIndicatorSelected : {}),
        }}
      >
        {isHighlighted && <CheckIcon size={12} />}
      </div>
      
      <div
        style={{
          ...styles.header,
          ...(isActive ? styles.headerActive : {}),
          ...(isSelected && !isActive ? styles.headerSelected : {}),
        }}
      >
        <div style={styles.headerLeft}>
          <div
            style={{
              ...styles.iconWrapper,
              ...(isHighlighted ? styles.iconWrapperSelected : {}),
            }}
          >
            <LightningIcon size={9} />
          </div>
          <span
            style={{
              ...styles.headerTitle,
              ...(isHighlighted ? styles.headerTitleSelected : {}),
            }}
          >
            Suggestion {index + 1}
          </span>
        </div>
        
        {/* Rationale toggle in header */}
        {structuredContent && (
          <button
            style={{
              ...styles.headerRationaleToggle,
              ...(isHighlighted ? styles.headerRationaleToggleSelected : {}),
              ...(isRationaleExpanded 
                ? (isHighlighted ? styles.headerRationaleToggleExpandedSelected : styles.headerRationaleToggleExpanded) 
                : {}),
            }}
            onClick={handleToggleRationale}
            onMouseEnter={(e) => {
              if (!isRationaleExpanded) {
                e.currentTarget.style.background = isHighlighted 
                  ? 'rgba(16, 185, 129, 0.1)' 
                  : 'rgba(139, 92, 246, 0.1)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isRationaleExpanded) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <LightbulbIcon size={8} />
            Why
            <span style={{
              ...styles.chevron,
              ...(isRationaleExpanded ? styles.chevronExpanded : {}),
            }}>
              <ChevronIcon size={8} />
            </span>
          </button>
        )}
      </div>
      
      <div style={{
        ...styles.body,
        ...(isCompact ? styles.bodyCompact : {}),
      }}>
        {structuredContent ? (
          <>
            {/* Direction - always visible */}
            <div style={styles.directionContent}>
              {structuredContent.direction}
            </div>
            
            {/* Collapsible rationale section */}
            <div style={{
              ...styles.rationaleSection,
              ...(isRationaleExpanded ? styles.rationaleSectionExpanded : {}),
            }}>
              <div style={{
                ...styles.rationaleInner,
                ...(isHighlighted ? styles.rationaleInnerSelected : {}),
              }}>
                <div style={{
                  ...styles.rationaleLabel,
                  ...(isHighlighted ? styles.rationaleLabelSelected : {}),
                }}>
                  Why this helps
                </div>
                <div style={styles.rationaleContent}>
                  {structuredContent.rationale}
                </div>
              </div>
            </div>
          </>
        ) : (
          // Fallback: plain text content
          <div style={styles.content}>
            {suggestion.content}
          </div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// Main Component
// =============================================================================

const SuggestionCards: React.FC<SuggestionCardsProps> = ({
  isVisible,
  isLoading,
  suggestions,
  targetText,
  onApplySelected,
  onDismissAll,
  onRegenerate,
  onClose,
  selectedSuggestionIds,
  isApplying = false,
  isCompact = false,
}) => {
  // Use stable reference for empty array to prevent effect re-runs
  const stableSelectedIds = selectedSuggestionIds ?? [];
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  // Track if user has deactivated any currently previewing suggestions
  const [deactivatedIds, setDeactivatedIds] = useState<Set<string>>(new Set());
  // Track previous isApplying to detect when it completes
  const prevIsApplyingRef = React.useRef(isApplying);
  // Track previous selectedSuggestionIds to detect actual changes
  const prevSelectedIdsRef = React.useRef<string[]>([]);
  
  // Reset selections when suggestions change
  useEffect(() => {
    setSelectedIds(new Set());
    setIsDismissed(false);
    setDeactivatedIds(new Set());
  }, [suggestions]);
  
  // Reset deactivatedIds when selectedSuggestionIds actually changes (new suggestion applied)
  // Compare by content, not reference, to avoid spurious resets
  useEffect(() => {
    const prevIds = prevSelectedIdsRef.current;
    const currentIds = stableSelectedIds;
    
    // Check if the arrays are actually different
    const hasChanged = prevIds.length !== currentIds.length || 
      prevIds.some((id, i) => id !== currentIds[i]);
    
    if (hasChanged && currentIds.length > 0) {
      // Only reset when we get NEW selected suggestions (not when clearing)
      setDeactivatedIds(new Set());
    }
    
    prevSelectedIdsRef.current = currentIds;
  }, [stableSelectedIds]);
  
  // When isApplying completes (Try Again or Apply finishes), reset selections
  // The active suggestions are now tracked by selectedSuggestionIds from pendingRevision
  useEffect(() => {
    if (prevIsApplyingRef.current && !isApplying) {
      // Apply just finished - clear selections since they're now tracked by selectedSuggestionIds
      setDeactivatedIds(new Set());
      setSelectedIds(new Set());
    }
    prevIsApplyingRef.current = isApplying;
  }, [isApplying]);
  
  const handleToggleSelect = useCallback((id: string) => {
    // If clicking a currently active (previewing) suggestion, toggle deactivation
    if (stableSelectedIds.includes(id)) {
      setDeactivatedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      return;
    }
    
    // Otherwise toggle normal selection
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, [stableSelectedIds]);
  
  const handleSubmit = useCallback(() => {
    if (selectedIds.size === 0) return;
    
    setIsSubmitting(true);
    
    onApplySelected(Array.from(selectedIds));
    
    // Don't dismiss anymore - cards stay visible during pending revision
    setIsSubmitting(false);
  }, [selectedIds, onApplySelected]);
  
  const handleDismissAll = useCallback(() => {
    setIsDismissed(true);
    setTimeout(() => {
      onDismissAll();
      onClose();
    }, 300);
  }, [onDismissAll, onClose]);
  
  const visibleSuggestions = suggestions.slice(0, 3);
  const hasSelections = selectedIds.size > 0;
  
  // Check if we have a pending revision (indicated by selectedSuggestionIds)
  const hasPendingRevision = stableSelectedIds.length > 0;
  
  // Helper to check if a suggestion is currently "active" (previewing and not deactivated)
  const isCardActive = (id: string) => stableSelectedIds.includes(id) && !deactivatedIds.has(id);
  
  return (
    <>
      <style>
        {`
          @keyframes shimmer {
            0% { opacity: 0.4; }
            50% { opacity: 0.8; }
            100% { opacity: 0.4; }
          }
        `}
      </style>
      
      <div
        style={{
          ...styles.container,
          ...(isCompact ? styles.containerCompact : {}),
          ...(isVisible && !isDismissed ? styles.containerVisible : {}),
          ...(isApplying ? styles.containerApplying : {}),
        }}
      >
        {/* Top actions - either Apply (when selected) or Regenerate/Dismiss */}
        {/* Hide top actions when there's a pending revision */}
        {!isLoading && visibleSuggestions.length > 0 && !hasPendingRevision && (
          hasSelections ? (
            <button
              style={{
                ...styles.applyButton,
                ...(isCompact ? styles.applyButtonCompact : {}),
              }}
              onClick={handleSubmit}
              disabled={isSubmitting}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 16px rgba(16, 185, 129, 0.4)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <CheckIcon size={12} />
              Apply {selectedIds.size} Suggestion{selectedIds.size > 1 ? 's' : ''}
            </button>
          ) : (
            <div style={{
              ...styles.topActions,
              ...(isCompact ? styles.topActionsCompact : {}),
            }}>
              <button
                style={styles.regenerateButton}
                onClick={onRegenerate}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.2)';
                  e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.5)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(139, 92, 246, 0.1)';
                  e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)';
                }}
              >
                <RefreshIcon size={11} />
                Regenerate
              </button>
              <button
                style={styles.dismissAllButton}
                onClick={handleDismissAll}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(248, 113, 113, 0.15)';
                  e.currentTarget.style.borderColor = 'rgba(248, 113, 113, 0.3)';
                  e.currentTarget.style.color = '#f87171';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)';
                  e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.15)';
                  e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                }}
              >
                Dismiss All
              </button>
            </div>
          )
        )}
        
        {/* Target text indicator */}
        {targetText && !isLoading && visibleSuggestions.length > 0 && (
          <div style={styles.targetIndicator}>
            <div style={styles.targetLabel}>Suggestions for</div>
            <div style={styles.targetText}>
              "{targetText.original.substring(0, 50)}{targetText.original.length > 50 ? '...' : ''}"
            </div>
          </div>
        )}
        
        {/* Loading skeletons */}
        {isLoading && (
          <>
            <SkeletonCard index={0} isCompact={isCompact} />
            <SkeletonCard index={1} isCompact={isCompact} />
            <SkeletonCard index={2} isCompact={isCompact} />
          </>
        )}
        
        {/* Suggestion cards */}
        {!isLoading && visibleSuggestions.map((suggestion, index) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            index={index}
            isSelected={selectedIds.has(suggestion.id)}
            isActive={isCardActive(suggestion.id)}
            onToggleSelect={() => handleToggleSelect(suggestion.id)}
            disabled={hasPendingRevision}
            isCompact={isCompact}
          />
        ))}
        
        {/* Selection hint when no selections and no pending revision */}
        {!isLoading && visibleSuggestions.length > 0 && !hasSelections && !hasPendingRevision && (
          <div style={styles.selectionHint}>
            Click cards to select suggestions
          </div>
        )}
      </div>
    </>
  );
};

export default SuggestionCards;