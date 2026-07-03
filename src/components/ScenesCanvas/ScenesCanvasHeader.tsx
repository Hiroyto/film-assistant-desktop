/**
 * ScenesCanvasHeader
 * 
 * Top header bar for the scenes canvas overlay.
 * Contains: back button, story title, save indicator, token display.
 */

import React from 'react';
import { ScenesCanvasHeaderProps } from './types';

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  header: {
    height: '56px',
    minHeight: '56px',
    background: '#111114',
    borderBottom: '1px solid #2a2a2e',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    zIndex: 10,
  },
  
  leftSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  
  backButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    background: 'transparent',
    border: '1px solid #3a3a3e',
    borderRadius: '6px',
    color: '#e0e0e0',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  
  backButtonHover: {
    background: '#2a2a2e',
    borderColor: '#4a4a4e',
  },
  
  divider: {
    width: '1px',
    height: '24px',
    background: '#3a3a3e',
  },
  
  titleContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  
  canvasLabel: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  
  storyTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#e0e0e0',
    maxWidth: '400px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  
  centerSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  
  savingIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#888',
  },
  
  savingSpinner: {
    width: '12px',
    height: '12px',
    border: '2px solid #3a3a3e',
    borderTopColor: '#ff6b35',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  
  savedCheck: {
    color: '#10b981',
  },
  
  rightSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  
  tokenDisplay: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    background: '#1a1a1e',
    border: '1px solid #2a2a2e',
    borderRadius: '6px',
  },
  
  tokenIcon: {
    color: '#ff6b35',
  },
  
  tokenText: {
    fontSize: '12px',
    color: '#888',
  },
  
  tokenValue: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#e0e0e0',
  },
  
  helpButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    background: 'transparent',
    border: '1px solid #3a3a3e',
    borderRadius: '6px',
    color: '#888',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  
  helpButtonHover: {
    background: '#2a2a2e',
    borderColor: '#4a4a4e',
    color: '#e0e0e0',
  },
};

// =============================================================================
// Icons (inline SVGs)
// =============================================================================

const ArrowLeftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5" />
    <path d="M12 19l-7-7 7-7" />
  </svg>
);

const CoinsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="8" cy="8" r="6" />
    <path d="M18.09 10.37A6 6 0 1 1 10.34 18" />
    <path d="M7 6h1v4" />
    <path d="M16.71 13.88l.7.71-2.82 2.82" />
  </svg>
);

const HelpCircleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

// =============================================================================
// Component
// =============================================================================

const ScenesCanvasHeader: React.FC<ScenesCanvasHeaderProps> = ({
  storyTitle,
  onClose,
  userCap,
  isSaving = false,
}) => {
  // ===========================================================================
  // Hover States
  // ===========================================================================
  
  const [isBackHovered, setIsBackHovered] = React.useState(false);
  const [isHelpHovered, setIsHelpHovered] = React.useState(false);
  
  // ===========================================================================
  // Format token display
  // ===========================================================================
  
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(0)}K`;
    }
    return tokens.toString();
  };
  
  // ===========================================================================
  // Render
  // ===========================================================================
  
  return (
    <header style={styles.header}>
      {/* Left Section: Back + Title */}
      <div style={styles.leftSection}>
        <button
          style={{
            ...styles.backButton,
            ...(isBackHovered ? styles.backButtonHover : {}),
          }}
          onClick={onClose}
          onMouseEnter={() => setIsBackHovered(true)}
          onMouseLeave={() => setIsBackHovered(false)}
          aria-label="Close canvas and return to scenes"
        >
          <ArrowLeftIcon />
          <span>Back</span>
        </button>
        
        <div style={styles.divider} />
        
        <div style={styles.titleContainer}>
          <span style={styles.canvasLabel}>Scene Canvas</span>
          <span style={styles.storyTitle} title={storyTitle}>
            {storyTitle}
          </span>
        </div>
      </div>
      
      {/* Center Section: Save Status */}
      <div style={styles.centerSection}>
        {isSaving ? (
          <div style={styles.savingIndicator}>
            <div style={styles.savingSpinner} />
            <span>Saving...</span>
          </div>
        ) : (
          <div style={{ ...styles.savingIndicator, ...styles.savedCheck }}>
            <CheckIcon />
            <span>Saved</span>
          </div>
        )}
      </div>
      
      {/* Right Section: Tokens + Help */}
      <div style={styles.rightSection}>
        {userCap !== undefined && (
          <div style={styles.tokenDisplay}>
            <span style={styles.tokenIcon}>
              <CoinsIcon />
            </span>
            <span style={styles.tokenText}>Tokens:</span>
            <span style={styles.tokenValue}>{formatTokens(userCap)}</span>
          </div>
        )}
        
        <button
          style={{
            ...styles.helpButton,
            ...(isHelpHovered ? styles.helpButtonHover : {}),
          }}
          onMouseEnter={() => setIsHelpHovered(true)}
          onMouseLeave={() => setIsHelpHovered(false)}
          aria-label="Help"
          title="Canvas help & shortcuts"
        >
          <HelpCircleIcon />
        </button>
      </div>
    </header>
  );
};

export default ScenesCanvasHeader;