import { ChevronRight, ChevronUp, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Scene } from '../../models/acts';

interface SceneCardProps {
    scene: Scene;
    index: number;
    segmentId: string;

    isExpanded: boolean;
    toggleExpansion: () => void;

    updateTitle: (value: string) => void;
    updateContent: (value: string) => void;

    // Panel mode - when panel is open, card is in selection mode
    isPanelOpen?: boolean;
    panelMode?: 'suggestions' | 'revisions' | null;
    isSelectedForPanel?: boolean;
    onTogglePanelSelection?: () => void;
    onExpandScene?: () => void;  // Called when selecting a collapsed scene

    onDragStart: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;

    onDelete: () => void;

    // AI Action handlers
    onRequestSuggestions?: () => void;
    onRequestRevisions?: () => void;
    onGenerate?: () => void;
    generatingSceneId?: string | null;
}

const SuggestIcon = () => (
    <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M7.5 3C5.567 3 4 4.567 4 6.5C4 7.753 4.5 8.5 5.25 9.25C5.75 9.75 6 10.25 6 11V11.5C6 11.7761 6.22386 12 6.5 12H8.5C8.77614 12 9 11.7761 9 11.5V11C9 10.25 9.25 9.75 9.75 9.25C10.5 8.5 11 7.753 11 6.5C11 4.567 9.433 3 7.5 3Z"
            stroke="currentColor"
            strokeWidth="1.2"
            fill="none"
        />
        <path d="M6 13.5H9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M7.5 0.5V1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M12 2.5L11.25 3.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M3 2.5L3.75 3.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M13.5 6.5H12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        <path d="M2.5 6.5H1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
);

const InternIcon = () => (
    <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="4" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
        <circle cx="11" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
        <path d="M6.5 7.5H8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path d="M1.5 7.5H1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path d="M13.5 7.5H13.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path d="M1.5 7.5L0.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path d="M13.5 7.5L14.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
);

export const GenerateIcon = () => (
    <svg width="16" height="16" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
            d="M8.69667 0.0403541C8.90859 0.131038 9.03106 0.354857 8.99316 0.582235L8.0902 6.00001H12.5C12.6893 6.00001 12.8625 6.10701 12.9472 6.27641C13.0319 6.4458 13.0136 6.6485 12.8999 6.80001L6.89997 14.8C6.76167 14.9844 6.51521 15.0503 6.30328 14.9597C6.09135 14.869 5.96888 14.6452 6.00678 14.4178L6.90974 9H2.49999C2.31061 9 2.13748 8.893 2.05278 8.72361C1.96809 8.55422 1.98636 8.35151 2.09999 8.2L8.09997 0.200038C8.23828 0.0156255 8.48474 -0.0503301 8.69667 0.0403541ZM3.49999 8.00001H7.49997C7.64695 8.00001 7.78648 8.06467 7.88148 8.17682C7.97648 8.28896 8.01733 8.43723 7.99317 8.5822L7.33027 12.5596L11.5 7.00001H7.49997C7.353 7.00001 7.21347 6.93534 7.11846 6.8232C7.02346 6.71105 6.98261 6.56279 7.00678 6.41781L7.66968 2.44042L3.49999 8.00001Z"
            fill="currentColor"
            fillRule="evenodd"
            clipRule="evenodd"
        />
    </svg>
);

const CheckIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6L9 17l-5-5" />
    </svg>
);


export function SceneCard({
    scene,
    index,
    segmentId,
    toggleExpansion,
    updateTitle,
    updateContent,
    isPanelOpen = false,
    panelMode = null,
    isSelectedForPanel = false,
    onTogglePanelSelection,
    onExpandScene,
    isExpanded,
    onDragStart,
    onDragOver,
    onDrop,
    onDelete,
    onRequestSuggestions,
    onRequestRevisions,
    onGenerate,
    generatingSceneId,
}: SceneCardProps) {
    const dragRef = useRef<HTMLDivElement>(null);
    const [isHovered, setIsHovered] = useState(false);

    const getPreview = (text: string, max = 140) =>
        text.length > max ? text.slice(0, max).trim() + '…' : text;

    const isEmpty = !scene.content || scene.content.trim().length === 0;

    const handleDragStart = (e: React.DragEvent) => {
        const dragPreview = document.createElement('div');
        dragPreview.style.cssText = `
            position: absolute;
            top: -1000px;
            left: -1000px;
            padding: 12px 16px;
            background: linear-gradient(135deg, #1a1a1a 0%, #141414 100%);
            border: 2px solid rgba(255, 107, 53, 0.6);
            border-radius: 12px;
            color: #ffffff;
            font-size: 14px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: 0 8px 32px rgba(255, 107, 53, 0.3), 0 4px 16px rgba(0, 0, 0, 0.4);
            z-index: 9999;
            pointer-events: none;
        `;
        dragPreview.innerHTML = `
            <span style="color: rgba(255, 140, 66, 0.8); font-family: monospace; font-size: 12px;">${segmentId}.${index + 1}</span>
            <span>${scene.title || 'Untitled Scene'}</span>
        `;
        document.body.appendChild(dragPreview);
        e.dataTransfer.setDragImage(dragPreview, 0, 0);
        setTimeout(() => { document.body.removeChild(dragPreview); }, 0);
        onDragStart(e);
    };

    const isGenerating = generatingSceneId === scene.sceneId;
    const isAnyGenerating = !!generatingSceneId;
    const buttonsDisabled = isPanelOpen || isAnyGenerating;

    const getSelectionBorderColor = () => {
        if (isSelectedForPanel) {
            return panelMode === 'revisions'
                ? 'rgb(6, 182, 212)'
                : 'rgb(139, 92, 246)';
        }
        return isHovered
            ? 'rgba(255, 107, 53, 0.35)'
            : 'rgba(255, 107, 53, 0.2)';
    };

    const selectionRingClass = isSelectedForPanel
        ? (panelMode === 'revisions'
            ? 'ring-2 ring-cyan-500/30 shadow-[0_0_20px_rgba(6,182,212,0.4),0_0_40px_rgba(6,182,212,0.2)]'
            : 'ring-2 ring-purple-500/30 shadow-[0_0_20px_rgba(139,92,246,0.4),0_0_40px_rgba(139,92,246,0.2)]')
        : '';
    const selectionBgColor = panelMode === 'revisions' ? 'bg-cyan-500' : 'bg-purple-500';

    const handleCardClick = (e: React.MouseEvent) => {
        if (isPanelOpen && onTogglePanelSelection) {
            e.stopPropagation();
            if (!isSelectedForPanel && !isExpanded && onExpandScene) {
                onExpandScene();
            }
            onTogglePanelSelection();
        }
    };

    const borderColor = getSelectionBorderColor();

    // Card background — lifted surface, cooler gray
    const cardBg = 'linear-gradient(135deg, rgba(42, 42, 46, 0.7) 0%, rgba(36, 36, 40, 0.7) 100%)';

    // Card shadow — subtle lift on hover
    const cardShadow = isHovered
        ? '0 4px 20px rgba(255, 107, 53, 0.08), 0 0 0 1px rgba(255, 107, 53, 0.1)'
        : '0 2px 8px rgba(0, 0, 0, 0.15)';

    return (
        <div
            ref={dragRef}
            draggable={!isPanelOpen && !isAnyGenerating}
            onDragStart={handleDragStart}
            onDragOver={(e) => {
                e.preventDefault();
                onDragOver(e);
            }}
            onDragEnter={(e) => {
                e.preventDefault();
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(255, 107, 53, 0.5), 0 0 20px rgba(255, 107, 53, 0.2)';
            }}
            onDragLeave={(e) => {
                e.currentTarget.style.boxShadow = '';
            }}
            onDrop={(e) => {
                e.currentTarget.style.boxShadow = '';
                onDrop(e);
            }}
            onClick={handleCardClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={`relative backdrop-blur-md transition-all duration-300 mb-3 ${isPanelOpen ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'
            } ${isExpanded
                ? ''
                : `rounded-xl ${selectionRingClass}`
            }`}
            style={{
                outline: 'none',
                WebkitTapHighlightColor: 'transparent',
                borderWidth: isExpanded ? '0' : '1px',
                borderStyle: 'solid',
                borderColor: isExpanded ? 'transparent' : borderColor,
                borderRadius: isExpanded ? '0' : '14px',
                background: isExpanded ? 'transparent' : cardBg,
                boxShadow: isExpanded ? 'none' : cardShadow,
                transform: isHovered && !isExpanded ? 'translateY(-1px)' : 'translateY(0)',
                transition: 'all 0.3s ease',
            }}
        >

            {/* HEADER */}
            <div
                onClick={(e) => {
                    if (isPanelOpen && onTogglePanelSelection) {
                        e.stopPropagation();
                        onTogglePanelSelection();
                    } else {
                        toggleExpansion();
                    }
                }}
                className={`flex items-center justify-between px-6 py-3.5 cursor-pointer select-none transition-all duration-300 ${isExpanded
                    ? `rounded-t-xl ${selectionRingClass}`
                    : ''
                    }`}
                style={{
                    outline: 'none',
                    WebkitTapHighlightColor: 'transparent',
                    borderWidth: isExpanded ? '1px' : '0',
                    borderStyle: 'solid',
                    borderColor: isExpanded ? borderColor : 'transparent',
                    background: isExpanded
                        ? cardBg
                        : isHovered && !isSelectedForPanel
                            ? 'linear-gradient(135deg, rgba(255, 107, 53, 0.1) 0%, rgba(255, 140, 66, 0.04) 100%)'
                            : 'transparent',
                    boxShadow: isExpanded ? cardShadow : 'none',
                    borderRadius: !isExpanded ? '14px 14px 0 0' : undefined,
                    borderBottom: undefined,
                    transition: 'all 0.3s ease',
                }}
            >
                <div className="flex items-center gap-3 flex-1">
                    <span className="scene-card-drag text-orange-400/70">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="6" r="2" /><circle cx="15" cy="6" r="2" />
                            <circle cx="9" cy="12" r="2" /><circle cx="15" cy="12" r="2" />
                            <circle cx="9" cy="18" r="2" /><circle cx="15" cy="18" r="2" />
                        </svg>
                    </span>

                    <span style={{
                        fontFamily: 'monospace', fontSize: '12px', fontWeight: 600,
                        color: '#ff8c42', background: 'rgba(255,107,53,0.12)',
                        padding: '3px 8px', borderRadius: '6px',
                        border: '1px solid rgba(255,107,53,0.2)',
                    }}>{segmentId}.{index + 1}</span>

                    {isExpanded ? (
                        <input
                            value={scene.title}
                            onChange={(e) => {
                                if (!isPanelOpen && !isAnyGenerating) {
                                    updateTitle(e.target.value);
                                }
                            }}
                            placeholder="Scene title…"
                            readOnly={isPanelOpen || isAnyGenerating}
                            disabled={isPanelOpen || isAnyGenerating}
                            onClick={(e) => e.stopPropagation()}
                            className={`bg-transparent border-none text-sm text-gray-100 placeholder:text-gray-500 w-full ${isPanelOpen || isAnyGenerating ? 'cursor-pointer pointer-events-none' : ''}`}
                            style={{ outline: 'none' }}
                        />
                    ) : (
                        <span className="text-sm text-gray-100 font-semibold">
                            {scene.title || 'Untitled Scene'}
                        </span>
                    )}
                </div>

                <div className="flex items-center gap-2 ml-2">
                    <span
                        className={`text-[9px] uppercase tracking-wide px-2 py-0.5 rounded-full border border-orange-400/40 text-orange-300 bg-orange-500/10 transition-all duration-300 ${isEmpty && !isExpanded
                            ? 'opacity-100 scale-100'
                            : 'opacity-0 scale-75 pointer-events-none absolute'
                            }`}
                    >
                        empty
                    </span>

                    <div
                        className={`flex items-center gap-2 transition-all duration-300 ${isExpanded
                            ? 'opacity-100 scale-100'
                            : 'opacity-0 scale-75 pointer-events-none w-0 overflow-hidden'
                            }`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            onClick={onRequestSuggestions}
                            disabled={buttonsDisabled || !onRequestSuggestions}
                            aria-label="Request suggestions for this scene"
                            className="w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                backgroundColor: '#2a2a2a',
                                color: '#ffffff',
                                boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                                outline: 'none',
                            }}
                            onMouseEnter={(e) => {
                                if (!buttonsDisabled) {
                                    e.currentTarget.style.backgroundColor = 'rgba(139, 92, 246, 0.3)';
                                    e.currentTarget.style.border = '1px solid rgba(139, 92, 246, 0.6)';
                                    e.currentTarget.style.boxShadow = '0 0 12px rgba(139, 92, 246, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
                                    e.currentTarget.style.color = '#c4b5fd';
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = '#2a2a2a';
                                e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                                e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
                                e.currentTarget.style.color = '#ffffff';
                            }}
                        >
                            <SuggestIcon />
                        </button>

                        <button
                            onClick={onRequestRevisions}
                            disabled={buttonsDisabled || !onRequestRevisions}
                            aria-label="Request revisions for this scene"
                            className="w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                                border: '1px solid rgba(255, 255, 255, 0.1)',
                                backgroundColor: '#2a2a2a',
                                color: '#ffffff',
                                boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                                outline: 'none',
                            }}
                            onMouseEnter={(e) => {
                                if (!buttonsDisabled) {
                                    e.currentTarget.style.backgroundColor = '#3b82f6';
                                    e.currentTarget.style.border = '1px solid rgba(59, 130, 246, 0.5)';
                                    e.currentTarget.style.boxShadow = '0 0 12px rgba(59, 130, 246, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = '#2a2a2a';
                                e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                                e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
                            }}
                        >
                            <InternIcon />
                        </button>

                        <button
                            onClick={onGenerate}
                            disabled={buttonsDisabled || isGenerating}
                            aria-label="Generate content for this scene"
                            className="w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            style={{
                                border: isGenerating
                                    ? '1px solid rgba(59, 130, 246, 0.5)'
                                    : '1px solid rgba(255, 255, 255, 0.1)',
                                backgroundColor: isGenerating ? '#3b82f6' : '#2a2a2a',
                                color: '#ffffff',
                                boxShadow: isGenerating
                                    ? '0 0 12px rgba(59, 130, 246, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)'
                                    : 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                                cursor: isGenerating ? 'wait' : 'pointer',
                                outline: 'none',
                            }}
                            onMouseEnter={(e) => {
                                if (!buttonsDisabled && !isGenerating) {
                                    e.currentTarget.style.backgroundColor = '#FF8C00';
                                    e.currentTarget.style.border = '1px solid rgba(255, 140, 0, 0.5)';
                                    e.currentTarget.style.boxShadow = '0 0 12px rgba(255, 140, 0, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isGenerating) {
                                    e.currentTarget.style.backgroundColor = '#2a2a2a';
                                    e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                                    e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
                                }
                            }}
                        >
                            {isGenerating ? (
                                <svg width="16" height="16" viewBox="0 0 15 15" fill="none">
                                    <circle cx="7.5" cy="7.5" r="6" stroke="currentColor" strokeWidth="1" fill="none" strokeDasharray="3 3">
                                        <animateTransform
                                            attributeName="transform"
                                            type="rotate"
                                            values="0 7.5 7.5;360 7.5 7.5"
                                            dur="1s"
                                            repeatCount="indefinite"
                                        />
                                    </circle>
                                </svg>
                            ) : (
                                <GenerateIcon />
                            )}
                        </button>
                    </div>

                    <button
                        onClick={(e) => { e.stopPropagation(); if (!isAnyGenerating) onDelete(); }}
                        disabled={isPanelOpen || isAnyGenerating}
                        className="w-9 h-9 rounded-full flex items-center justify-center transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            backgroundColor: '#2a2a2a',
                            color: '#ffffff',
                            boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)',
                            outline: 'none',
                        }}
                        onMouseEnter={(e) => {
                            if (!isPanelOpen && !isAnyGenerating) {
                                e.currentTarget.style.backgroundColor = '#dc2626';
                                e.currentTarget.style.border = '1px solid rgba(220, 38, 38, 0.5)';
                                e.currentTarget.style.boxShadow = '0 0 12px rgba(220, 38, 38, 0.4), inset 0 1px 2px rgba(0, 0, 0, 0.2)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = '#2a2a2a';
                            e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.1)';
                            e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.3), inset 0 -1px 2px rgba(255, 255, 255, 0.1)';
                        }}
                    >
                        <Trash2 size={16} />
                    </button>

                    {!isPanelOpen && (
                        <span className="text-orange-400">
                            {isExpanded ? <ChevronUp size={18} /> : <ChevronRight size={18} />}
                        </span>
                    )}

                    {isPanelOpen && (
                        <div
                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 ${isSelectedForPanel
                                ? selectionBgColor
                                : 'border-2 border-dashed border-gray-500 hover:border-gray-400'
                                }`}
                        >
                            {isSelectedForPanel && <CheckIcon />}
                        </div>
                    )}
                </div>
            </div>

            {/* COLLAPSED PREVIEW */}
            {!isExpanded && scene.content && (
                <div
                    onClick={(e) => {
                        if (isPanelOpen && onTogglePanelSelection) {
                            e.stopPropagation();
                            onTogglePanelSelection();
                        } else {
                            toggleExpansion();
                        }
                    }}
                    style={{
                        padding: '8px 24px 16px 64px',
                    }}
                    className="text-sm text-gray-400 italic cursor-pointer line-clamp-2"
                >
                    {getPreview(scene.content)}
                </div>
            )}

                {/* EXPANDED BODY */}
                {isExpanded && (
                    <textarea
                        value={scene.content}
                        onChange={(e) => {
                            if (!isPanelOpen && !isAnyGenerating) {
                                updateContent(e.target.value);
                                e.currentTarget.style.height = 'auto';
                                const scrollH = e.currentTarget.scrollHeight;
                                const clamped = Math.min(scrollH, 400);
                                e.currentTarget.style.height = clamped + 'px';
                                e.currentTarget.style.overflowY = scrollH > 400 ? 'auto' : 'hidden';
                            }
                        }}
                        onClick={(e) => {
                            e.stopPropagation();
                        }}
                        onFocus={(e) => {
                            if (!isPanelOpen && !isAnyGenerating) {
                                e.currentTarget.style.borderColor = '#FF8C00';
                                e.currentTarget.style.borderWidth = '2px';
                                e.currentTarget.style.boxShadow = 'inset 0 0 20px rgba(255, 140, 0, 0.1)';
                            }
                        }}
                        onBlur={(e) => {
                            e.currentTarget.style.borderColor = borderColor;
                            e.currentTarget.style.borderWidth = '1px';
                            e.currentTarget.style.boxShadow = '';
                        }}
                        ref={(el) => {
                            if (el) {
                                el.style.height = 'auto';
                                const scrollH = el.scrollHeight;
                                const clamped = Math.min(scrollH, 400);
                                el.style.height = clamped + 'px';
                                el.style.overflowY = scrollH > 400 ? 'auto' : 'hidden';
                            }
                        }}
                        placeholder="Write your scene here…"
                        readOnly={isPanelOpen || isAnyGenerating}
                        disabled={isPanelOpen || isAnyGenerating}
                        className={`w-full rounded-b-xl p-4 text-sm text-gray-100 placeholder:text-gray-500 transition-all duration-300 font-['Courier',monospace] leading-relaxed ${selectionRingClass} ${isPanelOpen || isAnyGenerating ? 'cursor-default opacity-80' : ''}`}
                        style={{
                            outline: 'none',
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: borderColor,
                            backgroundColor: '#242428',
                            minHeight: '60px',
                            maxHeight: '400px',
                            overflowY: 'hidden',
                            resize: 'none',
                        }}
                    />
                )}
        </div>
    );
}