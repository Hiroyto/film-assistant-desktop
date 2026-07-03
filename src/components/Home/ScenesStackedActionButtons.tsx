import React from 'react';
import "../../styles/Home/StackedActionButtons.css"

interface ScenesStackedActionButtonsProps {
    onToggleSuggestions: () => void;
    onToggleRevisions: () => void;
    isSuggestActive: boolean;
    isReviseActive: boolean;
}

const SuggestIcon = () => (
    <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
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
    <svg width="18" height="18" viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="4" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
        <circle cx="11" cy="7.5" r="2.5" stroke="currentColor" strokeWidth="1" fill="none" />
        <path d="M6.5 7.5H8.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path d="M1.5 7.5H1.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path d="M13.5 7.5H13.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path d="M1.5 7.5L0.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
        <path d="M13.5 7.5L14.5 7.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
);

const ScenesStackedActionButtons: React.FC<ScenesStackedActionButtonsProps> = ({
    onToggleSuggestions,
    onToggleRevisions,
    isSuggestActive,
    isReviseActive,
}) => {
    return (
        <div className="stacked-buttons-container">
            {/* Suggest Button */}
            <button
                className="stacked-action-button"
                onClick={onToggleSuggestions}
                data-active={isSuggestActive}
                aria-label="Toggle suggestions panel"
                style={{
                    ...(isSuggestActive ? {
                        borderColor: 'rgba(139, 92, 246, 0.6)',
                        backgroundColor: 'rgba(139, 92, 246, 0.15)',
                        color: '#c4b5fd',
                        boxShadow: '0 0 16px rgba(139, 92, 246, 0.3)',
                    } : {}),
                }}
            >
                <SuggestIcon />
            </button>

            {/* Revise Button */}
            <button
                className="stacked-action-button"
                onClick={onToggleRevisions}
                data-active={isReviseActive}
                aria-label="Toggle revisions panel"
                style={{
                    ...(isReviseActive ? {
                        borderColor: 'rgba(6, 182, 212, 0.6)',
                        backgroundColor: 'rgba(6, 182, 212, 0.15)',
                        color: '#67e8f9',
                        boxShadow: '0 0 16px rgba(6, 182, 212, 0.3)',
                    } : {}),
                }}
            >
                <InternIcon />
            </button>
        </div>
    );
};

ScenesStackedActionButtons.displayName = 'ScenesStackedActionButtons';

export default ScenesStackedActionButtons;