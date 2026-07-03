import React, { useEffect, useState, useCallback } from 'react';
import { Pencil, ChevronUp, ChevronDown } from 'lucide-react';
import type { Scene, SegmentWithScenes } from '../../models/acts';
import { SceneCard } from '../Scenes/SceneCard';
import SceneDetailPanel from '../ScenesCanvas/SceneDetailPanel';
import { useSceneDetailPanel } from '../Scenes/useSceneDetailPanel';
import ConfirmModal from '../ui/ConfirmModal';

const SummaryIcon = () => (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8.69667 0.0403541C8.90859 0.131038 9.03106 0.354857 8.99316 0.582235L8.0902 6.00001H12.5C12.6893 6.00001 12.8625 6.10701 12.9472 6.27641C13.0319 6.4458 13.0136 6.6485 12.8999 6.80001L6.89997 14.8C6.76167 14.9844 6.51521 15.0503 6.30328 14.9597C6.09135 14.869 5.96888 14.6452 6.00678 14.4178L6.90974 9H2.49999C2.31061 9 2.13748 8.893 2.05278 8.72361C1.96809 8.55422 1.98636 8.35151 2.09999 8.2L8.09997 0.200038C8.23828 0.0156255 8.48474 -0.0503301 8.69667 0.0403541ZM3.49999 8.00001H7.49997C7.64695 8.00001 7.78648 8.06467 7.88148 8.17682C7.97648 8.28896 8.01733 8.43723 7.99317 8.5822L7.33027 12.5596L11.5 7.00001H7.49997C7.353 7.00001 7.21347 6.93534 7.11846 6.8232C7.02346 6.71105 6.98261 6.56279 7.00678 6.41781L7.66968 2.44042L3.49999 8.00001Z" fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
    </svg>
);

interface ReviewOverlayProps {
    revisions: Array<{
        id: string;
        sceneId: string;
        displayId: string;
        sceneTitle: string;
        originalText: string;
        revisedText: string;
        status: string;
    }>;
    onAccept: () => void;
    onTryAgain: () => void;
    onDismiss: () => void;
    onToggleRevision: (revisionId: string) => void;
}

function ReviewOverlay({ revisions, onAccept, onTryAgain, onDismiss, onToggleRevision }: ReviewOverlayProps) {
    const pendingRevisions = revisions.filter(r => r.status === 'pending');

    if (pendingRevisions.length === 0) return null;

    // Simple sentence-level diff: split into sentences, mark changed ones
    const getDiffSegments = (original: string, revised: string) => {
        // Split into sentences (by period, question mark, exclamation)
        const splitSentences = (text: string) => {
            const sentences: string[] = [];
            let current = '';
            for (let i = 0; i < text.length; i++) {
                current += text[i];
                if ((text[i] === '.' || text[i] === '?' || text[i] === '!') &&
                    (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n')) {
                    sentences.push(current.trim());
                    current = '';
                }
            }
            if (current.trim()) sentences.push(current.trim());
            return sentences;
        };

        const originalSentences = new Set(splitSentences(original).map(s => s.toLowerCase().trim()));
        const revisedSentences = splitSentences(revised);

        return revisedSentences.map(sentence => ({
            text: sentence,
            isChanged: !originalSentences.has(sentence.toLowerCase().trim()),
        }));
    };

    return (
        <div
            className="fixed inset-0 z-50 flex flex-col items-center"
            style={{
                background: 'rgba(0, 0, 0, 0.75)',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
            }}
            onWheel={(e) => e.stopPropagation()}
        >
            {/* Subtle top label */}
            <div className="w-full flex items-center justify-center py-4 mt-[80px] shrink-0">
                <div className="flex items-center gap-2 text-emerald-400">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                    </svg>
                    <span className="text-sm font-semibold">Review Changes</span>
                </div>
            </div>

            {/* Scene cards - scrollable container */}
            <div
                className="flex-1 overflow-y-auto py-4 flex flex-col items-center scrollbar-hide"
                style={{
                    width: '100%',
                    paddingLeft: '240px',
                    paddingRight: '420px',
                    overscrollBehavior: 'contain',
                }}
            >
                {/* Map over ALL revisions, not filtered */}
                {revisions.map((revision) => {
                    const segments = getDiffSegments(revision.originalText, revision.revisedText);

                    return (
                        <div
                            key={revision.id}
                            className="mb-6 rounded-xl w-full"
                            style={{
                                background: 'linear-gradient(135deg, #1a1a1a 0%, #141414 100%)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                boxShadow: '0 0 30px rgba(16, 185, 129, 0.1)',
                            }}
                        >
                            {/* Card header */}
                            <div
                                className="flex items-center gap-3 px-4 py-3"
                                style={{
                                    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                                }}
                            >
                                {/* Clickable checkbox */}
                                <button
                                    onClick={() => onToggleRevision(revision.id)}
                                    className="shrink-0"
                                    style={{
                                        width: 24,
                                        height: 24,
                                        borderRadius: 6,
                                        border: revision.status === 'pending'
                                            ? '2px solid #10b981'
                                            : '2px solid #444',
                                        background: revision.status === 'pending'
                                            ? '#10b981'
                                            : 'transparent',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s ease',
                                    }}
                                >
                                    {revision.status === 'pending' && (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M20 6L9 17l-5-5" />
                                        </svg>
                                    )}
                                </button>

                                <span
                                    className="text-[10px] font-bold px-2 py-0.5 rounded"
                                    style={{ background: '#ff6b35', color: 'white' }}
                                >
                                    {revision.displayId}
                                </span>
                                <span className="text-sm font-semibold text-gray-100">
                                    {revision.sceneTitle}
                                </span>
                            </div>

                            {/* Diff content */}
                            <div
                                className="p-5 font-['Courier',monospace] text-sm leading-relaxed"
                                style={{
                                    background: 'rgba(16, 185, 129, 0.02)',
                                    opacity: revision.status === 'pending' ? 1 : 0.35,
                                    transition: 'opacity 0.2s ease',
                                }}
                            >
                                {segments.map((segment, i) => (
                                    <span
                                        key={i}
                                        style={segment.isChanged ? {
                                            color: '#86efac',
                                            background: 'rgba(16, 185, 129, 0.1)',
                                            textDecoration: 'underline',
                                            textDecorationColor: 'rgba(16, 185, 129, 0.4)',
                                            textUnderlineOffset: '3px',
                                            borderRadius: '2px',
                                            padding: '1px 0',
                                        } : {
                                            color: '#999',
                                        }}
                                    >
                                        {segment.text}{' '}
                                    </span>
                                ))}
                            </div>
                        </div>
                    );
                })}

                {/* Bottom padding for scroll */}
                <div className="h-8 shrink-0" />
            </div>
        </div>
    );
}
export interface SegmentScenesViewProps {
    /* =============================
     * CORE
     * ============================= */
    selectedSegment: SegmentWithScenes;

    segments: SegmentWithScenes[];
    setSegments: React.Dispatch<React.SetStateAction<SegmentWithScenes[]>>;
    setSelectedSegment: (segment: SegmentWithScenes) => void;

    /* =============================
     * VIEW / MODES
     * ============================= */
    reorganizeMode: boolean;
    setReorganizeMode: (value: boolean) => void;

    /* =============================
     * SCENE CRUD
     * ============================= */
    addNewScene: (mode: 'before' | 'after' | 'end', index?: number) => void;
    addSceneAtPosition: (segmentId: string, position: number) => void;

    updateSceneTitle: (sceneId: string, title: string) => void;
    updateSceneContent: (sceneId: string, content: string) => void;
    deleteScene: (sceneId: string) => void;

    /* =============================
     * SCENE GENERATION
     * ============================= */
    generateScenes: () => void;
    generateSingleScene: (sceneId: string, segmentId: string) => Promise<void>;
    generatingScenes: boolean;
    generatingSceneId?: string | null;

    /* =============================
     * DRAG & DROP
     * ============================= */
    draggedScene: Scene | null;

    handleDragStart: (e: React.DragEvent, scene: Scene) => void;
    handleDragEnd: (e: React.DragEvent) => void;

    handleDragOver: (
        e: React.DragEvent,
        segmentId: string,
        position: number,
        isNextSegment?: boolean
    ) => void;

    handleSceneMove: (segmentId: string, position: number) => void;

    /* =============================
     * UI HELPERS
     * ============================= */
    getSceneDisplayId: (segmentId: string, index: number) => string;

    /* =============================
     * API / AUTH (for AI panel)
     * ============================= */
    userId: string;
    token: any;
    storyId?: string;
    storyMetadata?: {
        genre?: string;
        theme?: string;
        coreQuestion?: string;
        mood?: string;
        summary?: string;
        characters?: Record<string, any>;
    };

    /* =============================
     * SAVE CALLBACK
     * ============================= */
    saveScenesToBackend: (segments: SegmentWithScenes[]) => void;

    /* =============================
     * PANEL STATE CALLBACK
     * ============================= */
    onPanelStateChange?: (isOpen: boolean) => void;

    /* =============================
     * STACKED BUTTON CALLBACKS (exposed for parent to wire to ScenesStackedActionButtons)
     * ============================= */
    stackedButtonCallbacksRef?: React.MutableRefObject<{
        handleStackedSuggest: () => void;
        handleStackedRevise: () => void;
        isSuggestActive: boolean;
        isReviseActive: boolean;
    } | null>;
}

export function SegmentScenesView({
    selectedSegment,
    segments,
    setSegments,
    setSelectedSegment,

    reorganizeMode,
    setReorganizeMode,

    addNewScene,
    addSceneAtPosition,
    updateSceneTitle,
    updateSceneContent,
    deleteScene,
    generateSingleScene,
    generatingSceneId,
    generateScenes,
    generatingScenes,

    draggedScene,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleSceneMove,

    getSceneDisplayId,

    userId,
    token,
    storyId,
    storyMetadata,
    saveScenesToBackend,
    onPanelStateChange,
    stackedButtonCallbacksRef,
}: SegmentScenesViewProps) {

    // Local UI state
    const [hoveredSceneId, setHoveredSceneId] = useState<string | null>(null);
    const [isContentExpanded, setIsContentExpanded] = useState(true);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [editedContent, setEditedContent] = useState(selectedSegment.content || '');
    const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [openDeleteModal, setOpenDeleteModal] = useState(false);
    const [sceneToDelete, setSceneToDelete] = useState<string | null>(null);


    // Scene Detail Panel hook
    const panel = useSceneDetailPanel({
        segments,
        onScenesUpdate: (updatedSegments) => {
            setSegments(updatedSegments);
            const updatedSelected = updatedSegments.find(s => s.id === selectedSegment.id);
            if (updatedSelected) {
                setSelectedSegment(updatedSelected);
            }
            saveScenesToBackend(updatedSegments);
        },
        userId,
        token,
        storyId,
        storyMetadata,
        getSceneDisplayId,
    });

    // Reset content editing when segment changes
    useEffect(() => {
        setEditedContent(selectedSegment.content || '');
        setIsEditingContent(false);
    }, [selectedSegment.id]);

    // Notify parent when panel state changes

    const onPanelStateChangeRef = React.useRef(onPanelStateChange);
    onPanelStateChangeRef.current = onPanelStateChange;

    useEffect(() => {
        onPanelStateChangeRef.current?.(panel.isPanelOpen);
    }, [panel.isPanelOpen]);

    // Stacked button handlers - toggle behavior, no scene pre-selected
    const handleStackedSuggest = useCallback(() => {
        if (panel.isPanelOpen && panel.panelMode === 'suggestions') {
            panel.closePanel();
        } else {
            panel.openPanel('suggestions');
        }
    }, [panel]);

    const handleStackedRevise = useCallback(() => {
        if (panel.isPanelOpen && panel.panelMode === 'revisions') {
            panel.closePanel();
        } else {
            panel.openPanel('revisions');
        }
    }, [panel]);

    // Expose panel toggle handlers to parent via ref
    if (stackedButtonCallbacksRef) {
        stackedButtonCallbacksRef.current = {
            handleStackedSuggest,
            handleStackedRevise,
            isSuggestActive: panel.isPanelOpen && panel.panelMode === 'suggestions',
            isReviseActive: panel.isPanelOpen && panel.panelMode === 'revisions',
        };
    }

    // Drag handlers for scene reordering
    const handleSceneDragStart = (index: number) => (e: React.DragEvent) => {
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleSceneDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    };

    const handleSceneDrop = (targetIndex: number) => (e: React.DragEvent) => {
        e.preventDefault();

        if (draggedIndex === null || draggedIndex === targetIndex) return;

        const updatedScenes = [...selectedSegment.scenes];
        const [moved] = updatedScenes.splice(draggedIndex, 1);
        updatedScenes.splice(targetIndex, 0, moved);

        const updatedSegments = segments.map(seg =>
            seg.id === selectedSegment.id
                ? { ...seg, scenes: updatedScenes }
                : seg
        );

        setSegments(updatedSegments);
        setSelectedSegment({ ...selectedSegment, scenes: updatedScenes });
        setDraggedIndex(null);
    };

    const getContentPreview = (content: string, maxLength = 200) => {
        if (!content) return '';
        return content.length > maxLength
            ? content.slice(0, maxLength).trim() + '…'
            : content;
    };

    const toggleSceneExpansion = (sceneId: string) => {
        setExpandedScenes(prev => {
            const next = new Set(prev);
            next.has(sceneId) ? next.delete(sceneId) : next.add(sceneId);
            return next;
        });
    };

    // Handler for when a scene's suggest button is clicked
    const handleRequestSuggestions = useCallback((scene: Scene) => {
        // Always expand the scene when adding to selection
        setExpandedScenes(prev => {
            const next = new Set(prev);
            next.add(scene.sceneId);
            return next;
        });

        if (!panel.isPanelOpen) {
            // Panel not open - open it in suggestions mode and add scene
            panel.openPanel('suggestions');
            // Need to add after a tick since openPanel clears selection
            setTimeout(() => {
                panel.addSceneToSelection(scene, selectedSegment.id);
            }, 0);
        } else if (panel.panelMode === 'suggestions') {
            // Panel already open in suggestions mode - toggle selection
            if (panel.isSceneSelected(scene.sceneId)) {
                panel.removeSceneFromSelection(scene.sceneId);
            } else {
                panel.addSceneToSelection(scene, selectedSegment.id);
            }
        } else {
            // Panel open in different mode - switch to suggestions and add scene
            panel.openPanel('suggestions');
            setTimeout(() => {
                panel.addSceneToSelection(scene, selectedSegment.id);
            }, 0);
        }
    }, [panel, selectedSegment.id]);

    // Handler for when a scene's revisions button is clicked
    const handleRequestRevisions = useCallback((scene: Scene) => {
        // Always expand the scene when adding to selection
        setExpandedScenes(prev => {
            const next = new Set(prev);
            next.add(scene.sceneId);
            return next;
        });

        if (!panel.isPanelOpen) {
            // Panel not open - open it in revisions mode and add scene
            panel.openPanel('revisions');
            setTimeout(() => {
                panel.addSceneToSelection(scene, selectedSegment.id);
            }, 0);
        } else if (panel.panelMode === 'revisions') {
            // Panel already open in revisions mode - toggle selection
            if (panel.isSceneSelected(scene.sceneId)) {
                panel.removeSceneFromSelection(scene.sceneId);
            } else {
                panel.addSceneToSelection(scene, selectedSegment.id);
            }
        } else {
            // Panel open in different mode - switch to revisions and add scene
            panel.openPanel('revisions');
            setTimeout(() => {
                panel.addSceneToSelection(scene, selectedSegment.id);
            }, 0);
        }
    }, [panel, selectedSegment.id]);

    // Handler for toggling selection when clicking on a scene card
    const handleTogglePanelSelection = useCallback((scene: Scene) => {
        if (panel.isSceneSelected(scene.sceneId)) {
            panel.removeSceneFromSelection(scene.sceneId);
        } else {
            // Expand the scene when selecting
            setExpandedScenes(prev => {
                const next = new Set(prev);
                next.add(scene.sceneId);
                return next;
            });
            panel.addSceneToSelection(scene, selectedSegment.id);
        }
    }, [panel, selectedSegment.id]);

    if (stackedButtonCallbacksRef) {
        stackedButtonCallbacksRef.current = {
            handleStackedSuggest,
            handleStackedRevise,
            isSuggestActive: panel.isPanelOpen && panel.panelMode === 'suggestions',
            isReviseActive: panel.isPanelOpen && panel.panelMode === 'revisions',
        };
    }
    return (

        <div className="flex flex-1 w-full min-h-0">
            {/* Main Content Area - flexes to fill available space */}
            <div
                className="flex-1 flex flex-col min-w-0 transition-all duration-300"
                style={{
                    paddingRight: panel.isPanelOpen ? '380px' : '0',
                    paddingLeft: panel.isPanelOpen ? '16px' : '0',
                }}
            >
                {/* HEADER */}
                <div
                    className="workspace-header transition-all duration-300"
                    style={{
                        paddingLeft: panel.isPanelOpen ? '16px' : '0',
                    }}
                >
                    <div className="workspace-title-section">
                        <h1 className="workspace-title">{selectedSegment.title}</h1>

                        {isContentExpanded && isEditingContent && (
                            <textarea
                                value={editedContent}
                                onChange={(e) => setEditedContent(e.target.value)}
                                placeholder="Describe this segment..."
                                className="w-full min-h-[120px] bg-[#1a1a1a] border border-[#333] text-[#eaeaea] p-3 rounded-md resize-y text-sm leading-relaxed focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 transition"
                            />
                        )}

                        {/* FULL CONTENT */}
                        {isContentExpanded && !isEditingContent && selectedSegment.content && (
                            <p className="workspace-subtitle">
                                {selectedSegment.content}
                            </p>
                        )}

                        {/* PREVIEW WHEN COLLAPSED */}
                        {!isContentExpanded && selectedSegment.content && (
                            <p
                                className="workspace-subtitle preview"
                                onClick={() => setIsContentExpanded(true)}
                            >
                                {getContentPreview(selectedSegment.content)}
                            </p>
                        )}

                        {/* Panel mode indicator */}
                        {panel.isPanelOpen && (
                            <p className="text-sm text-purple-400 mt-2">
                                Click the {panel.panelMode === 'suggestions' ? 'suggest' : 'revise'} button on scenes to add them
                            </p>
                        )}
                    </div>

                    <div className="workspace-actions flex items-center gap-2">
                        {/* <button
                            disabled={!isContentExpanded}
                            onClick={() => {
                                if (isEditingContent) {
                                    const updatedSegments = segments.map(seg =>
                                        seg.id === selectedSegment.id ? { ...seg, content: editedContent } : seg
                                    );
                                    setSegments(updatedSegments);
                                    setSelectedSegment({ ...selectedSegment, content: editedContent });
                                    setIsEditingContent(false);
                                } else {
                                    setIsEditingContent(true);
                                }
                            }}
                            className="p-1.5 rounded-md text-gray-400 hover:text-[#888888] hover:bg-white/5 transition disabled:opacity-40 disabled:cursor-not-allowed"
                            title={isEditingContent ? 'Save content' : 'Edit content'}
                        >
                            <Pencil size={18} />
                        </button> */}

                        <button
                            onClick={() => setIsContentExpanded(prev => !prev)}
                            className="p-1.5 rounded-md text-gray-400 hover:text-[#888888] hover:bg-white/5 transition"
                            title={isContentExpanded ? 'Collapse content' : 'Expand content'}
                        >
                            {isContentExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </button>
                    </div>
                </div>

                {/* BODY */}
                <div
                    className="flex flex-col flex-1 min-h-0 transition-all duration-300"
                    style={{
                        paddingLeft: panel.isPanelOpen ? '16px' : '0',
                        paddingTop: '24px',
                        marginTop: '-16px',
                    }}
                >
                    {selectedSegment.scenes.length === 0 ? (
                        <div className="flex flex-1 items-center justify-center">
                            <div className="empty-state border border-[rgba(255,107,53,0.25)] rounded-xl p-6 text-center bg-gradient-to-br from-[#1a1a1a]/60 to-[#141414]/80 backdrop-blur-md max-w-lg w-full">
                                <h3>Ready to develop scenes</h3>
                                <p>
                                    This segment is where your story develops. Start by adding a scene manually
                                    or generate scenes automatically based on your story structure.
                                </p>
                            </div>
                        </div>
                    ) : (
                        selectedSegment.scenes.map((scene, index) => (
                            <SceneCard
                                key={scene.sceneId}
                                scene={scene}
                                index={index}
                                segmentId={selectedSegment.id}
                                isExpanded={expandedScenes.has(scene.sceneId)}
                                toggleExpansion={() => toggleSceneExpansion(scene.sceneId)}
                                updateTitle={(value) => updateSceneTitle(scene.sceneId, value)}
                                updateContent={(value) => updateSceneContent(scene.sceneId, value)}
                                generatingSceneId={generatingSceneId}
                                onGenerate={() => generateSingleScene(scene.sceneId, selectedSegment.id)}


                                // Panel state
                                isPanelOpen={panel.isPanelOpen}
                                panelMode={panel.isPanelOpen ? panel.panelMode as 'suggestions' | 'revisions' : null}
                                isSelectedForPanel={panel.isSceneSelected(scene.sceneId)}
                                onTogglePanelSelection={() => handleTogglePanelSelection(scene)}
                                onExpandScene={() => {
                                    setExpandedScenes(prev => {
                                        const next = new Set(prev);
                                        next.add(scene.sceneId);
                                        return next;
                                    });
                                }}

                                // Drag and drop
                                onDragStart={handleSceneDragStart(index)}
                                onDragOver={handleSceneDragOver}
                                onDrop={handleSceneDrop(index)}

                                // Actions
                                onDelete={() => {
                                    setSceneToDelete(scene.sceneId);
                                    setOpenDeleteModal(true);
                                }}
                                onRequestSuggestions={() => handleRequestSuggestions(scene)}
                                onRequestRevisions={() => handleRequestRevisions(scene)}
                            />
                        ))
                    )}
                </div>

                {/* FOOTER - Generate button */}
                <div className="sticky bottom-0 mt-6 pt-4">
                    <div className="flex justify-end pr-8">
                        <button
                            id='generateScenes'
                            type="button"
                            onClick={generateScenes}
                            disabled={generatingScenes || reorganizeMode || panel.isPanelOpen}
                            className="
                                flex items-center gap-2
                                bg-[#ff6b35] text-white
                                px-4 py-3
                                rounded-2xl
                                font-medium
                                shadow-[0_4px_12px_rgba(255,140,0,0.2)]
                                transition-all duration-200 ease-out
                                hover:-translate-y-0.5
                                hover:shadow-[0_6px_16px_rgba(255,140,0,0.25)]
                                disabled:opacity-60
                                disabled:cursor-not-allowed
                                focus:outline-none
                                focus:ring-2
                                focus:ring-orange-400/40
                            "
                        >
                            <SummaryIcon />
                            {generatingScenes ? 'Generating...' : 'Generate Scenes'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Scene Detail Panel - fixed position to stay in viewport */}
            {panel.isPanelOpen && (
                <div
                    className="fixed top-[80px] right-0 bottom-0 border-l border-[rgba(255,255,255,0.08)] shadow-2xl animate-slideInFromRight overflow-y-auto scrollbar-hide"
                    style={{
                        width: '380px',
                        background: 'linear-gradient(180deg, #141416 0%, #0f0f11 100%)',
                        boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.5), -2px 0 8px rgba(0, 0, 0, 0.3)',
                        zIndex: panel.panelState === 'reviewing' ? 60 : 40,
                    }}
                >
                    <SceneDetailPanel
                        mode={panel.panelMode as 'suggestions' | 'revisions'}
                        panelState={panel.panelState}
                        selectedScenes={panel.selectedScenes}
                        suggestions={panel.suggestions}
                        revisions={panel.revisions}
                        guidance={panel.guidance}
                        onGuidanceChange={panel.setGuidance}
                        onRemoveScene={panel.removeSceneFromSelection}
                        onGenerate={panel.handleGenerate}
                        onClose={panel.closePanel}

                        // Focus mode - not used in acts view
                        isFocusMode={false}
                        onToggleFocusMode={undefined}
                        hasActiveTextSelection={false}

                        // Transition context - not used in acts view
                        transitionContext={null}
                        onApplyTransitionSuggestion={undefined}

                        // Suggestions
                        onToggleSuggestion={panel.toggleSuggestion}
                        onApplySuggestions={panel.applySuggestions}
                        onRegenerateSuggestions={panel.regenerateSuggestions}
                        onDismissAllSuggestions={panel.dismissAllSuggestions}

                        // Review
                        reviewingScenesCount={panel.reviewingScenesCount}
                        acceptCheckedCount={panel.acceptCheckedCount}
                        onAcceptChanges={panel.acceptChanges}
                        onTryAgain={panel.tryAgain}
                        onDismissChanges={panel.dismissChanges}

                        // Revisions
                        onAcceptRevision={panel.acceptRevision}
                        onDismissRevision={panel.dismissRevision}
                        onRetryRevision={panel.retryRevision}

                        // Global notes - not used in acts view
                        globalNotes={[]}
                        onAddGlobalNote={undefined}
                        onEditGlobalNote={undefined}
                        onDeleteGlobalNote={undefined}
                    />
                </div>
            )}
            {/* Review Overlay - focus mode for reviewing revisions */}
            {panel.panelState === 'reviewing' && panel.revisions.length > 0 && (
                <ReviewOverlay
                    revisions={panel.revisions}
                    onAccept={panel.acceptChanges}
                    onTryAgain={panel.tryAgain}
                    onDismiss={panel.dismissChanges}
                    onToggleRevision={panel.toggleRevisionStatus}
                />
            )}

            {/* Animation and utility styles */}
            <style>{`
                @keyframes slideInFromRight {
                    from {
                        opacity: 0;
                        transform: translateX(20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
                .animate-slideInFromRight {
                    animation: slideInFromRight 0.3s ease-out;
                }
                .scrollbar-hide {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
                .scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
            `}</style>
            <ConfirmModal
                open={openDeleteModal}
                title="Delete Scene"
                description="This scene will be permanently deleted."
                confirmLabel="Delete"
                onCancel={() => {
                    setOpenDeleteModal(false);
                    setSceneToDelete(null);
                }}
                onConfirm={() => {
                    if (sceneToDelete) {
                        deleteScene(sceneToDelete);
                    }
                    setOpenDeleteModal(false);
                    setSceneToDelete(null);
                }}
            />
        </div>
    );
}