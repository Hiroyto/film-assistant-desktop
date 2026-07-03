/**
 * ScenesCanvasSidebar
 * 
 * PLACEHOLDER COMPONENT
 * 
 * This is a temporary placeholder that matches the dimensions of 
 * StoryNavigationSidebar. It will be replaced with the actual 
 * sidebar implementation that leverages the existing component.
 * 
 * Dimensions from StoryNavigationSidebar:
 * - Expanded width: 225px (expandedWidth default)
 * - Collapsed width: 56px (collapsedWidth default)
 */

import React from 'react';
import { ScenesCanvasSidebarProps, SEGMENT_COLORS } from './types';

// =============================================================================
// Constants (matching StoryNavigationSidebar)
// =============================================================================

const SIDEBAR_WIDTH = 225;  // expandedWidth from StoryNavigationSidebar

// =============================================================================
// Styles
// =============================================================================

const styles: { [key: string]: React.CSSProperties } = {
  sidebar: {
    width: SIDEBAR_WIDTH,
    minWidth: SIDEBAR_WIDTH,
    height: '100%',
    background: '#111114',
    borderRight: '1px solid #2a2a2e',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  
  header: {
    padding: '16px',
    borderBottom: '1px solid #2a2a2e',
  },
  
  headerTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '12px',
  },
  
  placeholderText: {
    fontSize: '13px',
    color: '#666',
    textAlign: 'center' as const,
    padding: '20px',
  },
  
  actGroup: {
    marginBottom: '16px',
  },
  
  actHeader: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#888',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    padding: '8px 12px',
    marginBottom: '4px',
  },
  
  segmentItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
    marginBottom: '2px',
  },
  
  segmentDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  
  segmentLabel: {
    fontSize: '13px',
    color: '#e0e0e0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  
  segmentCount: {
    marginLeft: 'auto',
    fontSize: '11px',
    color: '#666',
  },
};

// =============================================================================
// Act Groupings
// =============================================================================

const ACT_GROUPS = [
  { act: 1, label: 'Act I', segments: ['S1', 'S2', 'S3'] },
  { act: 2, label: 'Act II', segments: ['S4', 'S5', 'S6'] },
  { act: 3, label: 'Act III', segments: ['S7', 'S8', 'S9'] },
];

// =============================================================================
// Component
// =============================================================================

const ScenesCanvasSidebar: React.FC<ScenesCanvasSidebarProps> = ({
  segments,
  selectedSceneId,
  selectedSegmentId,
  viewMode,
  onViewModeChange,
  onSceneSelect,
  onSegmentSelect,
  onSceneReorder,
  onSceneMoveToSegment,
}) => {
  // ===========================================================================
  // Hover State
  // ===========================================================================
  
  const [hoveredSegmentId, setHoveredSegmentId] = React.useState<string | null>(null);
  
  // ===========================================================================
  // Get segment by ID
  // ===========================================================================
  
  const getSegment = (segmentId: string) => {
    return segments.find(s => s.id === segmentId);
  };
  
  // ===========================================================================
  // Render
  // ===========================================================================
  
  return (
    <div style={styles.sidebar}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>Navigation</div>
      </div>
      
      {/* Content */}
      <div style={styles.content}>
        {ACT_GROUPS.map(actGroup => (
          <div key={actGroup.act} style={styles.actGroup}>
            {/* Act Header */}
            <div style={styles.actHeader}>{actGroup.label}</div>
            
            {/* Segments in this Act */}
            {actGroup.segments.map(segmentId => {
              const segment = getSegment(segmentId);
              const isSelected = selectedSegmentId === segmentId;
              const isHovered = hoveredSegmentId === segmentId;
              const sceneCount = segment?.scenes?.length || 0;
              
              return (
                <div
                  key={segmentId}
                  style={{
                    ...styles.segmentItem,
                    background: isSelected 
                      ? 'rgba(255, 107, 53, 0.15)' 
                      : isHovered 
                        ? 'rgba(255, 255, 255, 0.05)' 
                        : 'transparent',
                  }}
                  onClick={() => onSegmentSelect(segmentId)}
                  onMouseEnter={() => setHoveredSegmentId(segmentId)}
                  onMouseLeave={() => setHoveredSegmentId(null)}
                >
                  <div 
                    style={{
                      ...styles.segmentDot,
                      background: SEGMENT_COLORS[segmentId] || '#888',
                    }}
                  />
                  <span style={styles.segmentLabel}>
                    {segment?.title || segmentId}
                  </span>
                  <span style={styles.segmentCount}>
                    {sceneCount}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
        
        {/* Placeholder notice */}
        <div style={styles.placeholderText}>
          <div style={{ marginBottom: '8px', fontSize: '11px', color: '#555' }}>
            — Placeholder —
          </div>
          <div style={{ fontSize: '11px', color: '#444' }}>
            Will integrate with StoryNavigationSidebar
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScenesCanvasSidebar;