/**
 * ScenesCanvasToolbar
 * 
 * Bottom toolbar for the scenes canvas.
 * Uses CSS classes for hover states to avoid React state issues.
 */

import React from 'react';
import { ScenesCanvasToolbarProps, CANVAS_CONSTANTS } from './types';

// =============================================================================
// Extended Props Interface
// =============================================================================

export interface ScenesCanvasToolbarPropsExtended extends ScenesCanvasToolbarProps {
  onRequestSuggestions: () => void;
  onRequestRevisions: () => void;
  isPanelOpen?: boolean;
  panelMode?: 'suggestions' | 'revisions' | 'global-notes' | null;
}

// =============================================================================
// Icons
// =============================================================================

const ZoomInIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
  </svg>
);

const ZoomOutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" />
    <path d="M21 21l-4.35-4.35M8 11h6" />
  </svg>
);

const ZoomResetIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
);

const LightningIcon = () => (
  <svg width="14" height="14" viewBox="0 0 15 15" fill="currentColor">
    <path d="M8.7 0L8 6H12.5L6.3 15L7 9H2.5L8.7 0Z" />
  </svg>
);
const SuggestIcon = () => (
  <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Bulb */}
      <path
          d="M7.5 3C5.567 3 4 4.567 4 6.5C4 7.753 4.5 8.5 5.25 9.25C5.75 9.75 6 10.25 6 11V11.5C6 11.7761 6.22386 12 6.5 12H8.5C8.77614 12 9 11.7761 9 11.5V11C9 10.25 9.25 9.75 9.75 9.25C10.5 8.5 11 7.753 11 6.5C11 4.567 9.433 3 7.5 3Z"
          stroke="currentColor"
          strokeWidth="1.2"
          fill="none"
      />
      {/* Base */}
      <path d="M6 13.5H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      {/* Rays - with gaps from bulb */}
      <path d="M7.5 0.5V1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M12 2.5L11.25 3.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M3 2.5L3.75 3.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M13.5 6.5H12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M2.5 6.5H1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const ReviseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="12" r="4" />
    <circle cx="18" cy="12" r="4" />
    <path d="M10 12h4" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

// =============================================================================
// CSS Styles (injected via style tag)
// =============================================================================

const toolbarCSS = `
  .scenes-toolbar {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: rgba(30, 30, 36, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 0.6rem 1rem;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
  }
  
  .scenes-toolbar-divider {
    width: 1px;
    height: 24px;
    background: rgba(255, 255, 255, 0.1);
  }
  
  .scenes-toolbar-zoom {
    min-width: 52px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 12px;
    font-weight: 600;
    color: #e0e0e0;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  
  /* Base button styles */
  .scenes-toolbar button {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    cursor: pointer;
    transition: all 0.2s;
    outline: none !important;
    font-family: inherit;
  }
  
  .scenes-toolbar button:focus,
  .scenes-toolbar button:focus-visible {
    outline: none !important;
  }
  
  /* Icon button (zoom, minimap) */
  .toolbar-icon-btn {
    width: 32px;
    height: 32px;
    padding: 0.5rem;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.7);
  }
  
  .toolbar-icon-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
  
  .toolbar-icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  
  .toolbar-icon-btn.active {
    background: rgba(255, 107, 53, 0.15);
    color: #ff6b35;
  }
  
  /* Add Note button */
  .toolbar-add-note-btn {
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  
  .toolbar-add-note-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }
  
  /* Request Suggestions button (Purple Gradient) - matches original exactly */
  .toolbar-suggestions-btn {
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%);
    border-radius: 8px;
    color: white;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  
  .toolbar-suggestions-btn.active {
    background: linear-gradient(135deg, #6b5ca0 0%, #5558b8 100%);
  }
  
  /* Revise button (Blue Gradient) */
  .toolbar-revise-btn {
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
    border-radius: 8px;
    color: white;
    font-size: 12px;
    font-weight: 500;
    white-space: nowrap;
  }
  
  .toolbar-revise-btn.active {
    background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
  }
  
  /* Tooltip */
  .toolbar-btn-wrapper {
    position: relative;
  }
  
  .toolbar-tooltip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-bottom: 12px;
    padding: 0.6rem 0.75rem;
    background: rgba(20, 20, 26, 0.98);
    border: 1px solid rgba(139, 92, 246, 0.3);
    border-radius: 8px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.7);
    width: 200px;
    line-height: 1.5;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s ease;
    z-index: 10;
  }
  
  .toolbar-tooltip-title {
    font-weight: 600;
    margin-bottom: 4px;
    display: block;
    color: #8b5cf6;
  }
  
  .toolbar-btn-wrapper:hover .toolbar-tooltip {
    opacity: 1;
  }
`;

// =============================================================================
// Component
// =============================================================================

const ScenesCanvasToolbar: React.FC<ScenesCanvasToolbarPropsExtended> = ({
  transform,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onAddNote,
  showMinimap,
  onToggleMinimap,
  onRequestSuggestions,
  onRequestRevisions,
  isPanelOpen = false,
  panelMode = null,
}) => {
  const zoomPercentage = Math.round(transform.scale * 100);
  
  const isMinZoom = transform.scale <= CANVAS_CONSTANTS.MIN_ZOOM;
  const isMaxZoom = transform.scale >= CANVAS_CONSTANTS.MAX_ZOOM;
  const isDefaultZoom = transform.scale === 1 && transform.panX === 0 && transform.panY === 0;
  
  const isSuggestionsActive = isPanelOpen && panelMode === 'suggestions';
  const isRevisionsActive = isPanelOpen && panelMode === 'revisions';
  
  return (
    <>
      <style>{toolbarCSS}</style>
      
      <div className="scenes-toolbar">
        {/* Zoom Out */}
        <div className="toolbar-btn-wrapper">
          <button
            className="toolbar-icon-btn"
            onClick={onZoomOut}
            disabled={isMinZoom}
            onMouseEnter={(e) => {
              if (!isMinZoom) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = '#fff';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
            }}
          >
            <ZoomOutIcon />
          </button>
          <div className="toolbar-tooltip">
            <span className="toolbar-tooltip-title">Zoom Out</span>
            Decrease magnification to see more of your canvas at once.
          </div>
        </div>
        
        {/* Zoom Display */}
        <div className="scenes-toolbar-zoom">
          {zoomPercentage}%
        </div>
        
        {/* Zoom In */}
        <div className="toolbar-btn-wrapper">
          <button
            className="toolbar-icon-btn"
            onClick={onZoomIn}
            disabled={isMaxZoom}
            onMouseEnter={(e) => {
              if (!isMaxZoom) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = '#fff';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
            }}
          >
            <ZoomInIcon />
          </button>
          <div className="toolbar-tooltip">
            <span className="toolbar-tooltip-title">Zoom In</span>
            Increase magnification to focus on details.
          </div>
        </div>
        
        {/* Reset View */}
        <div className="toolbar-btn-wrapper">
          <button
            className="toolbar-icon-btn"
            onClick={onZoomReset}
            disabled={isDefaultZoom}
            onMouseEnter={(e) => {
              if (!isDefaultZoom) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = '#fff';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
            }}
          >
            <ZoomResetIcon />
          </button>
          <div className="toolbar-tooltip">
            <span className="toolbar-tooltip-title">Reset View</span>
            Return to default zoom and position.
          </div>
        </div>
        
        <div className="scenes-toolbar-divider" />
        
        {/* Add Note */}
        <div className="toolbar-btn-wrapper">
          <button
            className="toolbar-add-note-btn"
            onClick={onAddNote}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
              e.currentTarget.style.color = '#fff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
            }}
          >
            <PlusIcon />
            <span>Add Note</span>
          </button>
          <div className="toolbar-tooltip">
            <span className="toolbar-tooltip-title">Consider this...</span>
            Context, references, or constraints to consider. Tonal anchors, thematic notes, inspiration.
          </div>
        </div>
        
        {/* Request Suggestions */}
        <div className="toolbar-btn-wrapper">
          <button
            className={`toolbar-suggestions-btn ${isSuggestionsActive ? 'active' : ''}`}
            onClick={onRequestSuggestions}
            onMouseEnter={(e) => {
              if (!isSuggestionsActive) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(139, 92, 246, 0.3)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <SuggestIcon />
            <span>Request Suggestions</span>
          </button>
          <div className="toolbar-tooltip">
            <span className="toolbar-tooltip-title">Get Suggestions</span>
            Select scenes and receive targeted suggestions for character, tension, pacing, and more.
          </div>
        </div>
        
        {/* Revise */}
        <div className="toolbar-btn-wrapper">
          <button
            className={`toolbar-revise-btn ${isRevisionsActive ? 'active' : ''}`}
            onClick={onRequestRevisions}
            onMouseEnter={(e) => {
              if (!isRevisionsActive) {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(14, 165, 233, 0.3)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <ReviseIcon />
            <span>Revise</span>
          </button>
          <div className="toolbar-tooltip">
            <span className="toolbar-tooltip-title">Revise Scenes</span>
            Select scenes for targeted revisions based on your guidance.
          </div>
        </div>
        
        <div className="scenes-toolbar-divider" />
        
        {/* Global Notes Toggle */}
        <div className="toolbar-btn-wrapper">
          <button
            className={`toolbar-icon-btn ${showMinimap ? 'active' : ''}`}
            onClick={onToggleMinimap}
            onMouseEnter={(e) => {
              if (!showMinimap) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)';
                e.currentTarget.style.color = '#fff';
              }
            }}
            onMouseLeave={(e) => {
              if (!showMinimap) {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
              }
            }}
          >
            <GlobeIcon />
          </button>
          <div className="toolbar-tooltip">
            <span className="toolbar-tooltip-title">Global Notes</span>
            View and manage notes that apply across your entire story.
          </div>
        </div>
      </div>
    </>
  );
};

export default ScenesCanvasToolbar;