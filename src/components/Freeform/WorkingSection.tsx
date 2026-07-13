// components/Freeform/WorkingSection.tsx
//
// The named section on the writing card where the writer types responses.
// Locked in Task #10: open/stashed/answered states, peer vs writer authorship,
// draft auto-save indicator, submit triggers CardResponse extraction.
//
// This is the SHELL — actual draft auto-save / submit wiring happens in A4 (FIL-479).
// The component accepts onSubmit, onStash, onDismiss, onLabelEdit as callbacks.

import React, { useState } from 'react';
import type { EntityType, WorkingSectionStatus, AuthoredBy } from './types';
import { getEntityColor, hexToRgba } from './entityColors';
import { PEER_BLUE } from './tokens';

interface WorkingSectionProps {
  workingSectionLabel: string;
  /** Only shown for peer-authored sections; writer-authored has just the label. */
  questionText?: string;
  /** Only shown for peer-authored. */
  rationale?: string;
  status: WorkingSectionStatus;
  authoredBy: AuthoredBy;
  /** The writing card's entity type — drives the accent color for writer-authored sections. */
  parentCardType: EntityType;
  /** Existing response prose (renders in answered state OR pre-fills textarea on edit). */
  responseProse?: string;
  /** Draft text from auto-save layer. */
  draftText?: string;
  /** Submit handler. Called with the textarea content. */
  onSubmit?: (text: string) => void;
  /** Fires on every textarea keystroke. Parent debounces + persists for draft auto-save. */
  onDraftChange?: (text: string) => void;
  /** Edit-after-answer handler. Returns section to open with response pre-filled. */
  onEdit?: () => void;
  /** Continue conversation handler — opens peer card with thread context (Task #11). */
  onContinueConversation?: () => void;
  /** Stash handler. */
  onStash?: () => void;
  /** Un-stash handler (from stashed → open). */
  onUnstash?: () => void;
  /** Dismiss handler. */
  onDismiss?: () => void;
  /** Edit working_section label. */
  onLabelEdit?: (newLabel: string) => void;
  /** Indicator: draft save state — 'saved' | 'saving' | 'failed' | null. */
  saveStatus?: 'saved' | 'saving' | 'failed' | null;
  /** Submit error message — replaces save indicator + shows retry. */
  submitError?: string | null;
  /** Retry handler when submit failed. */
  onRetrySubmit?: () => void;
}

const WorkingSection: React.FC<WorkingSectionProps> = ({
  workingSectionLabel,
  questionText,
  rationale,
  status,
  authoredBy,
  parentCardType,
  responseProse,
  draftText,
  onSubmit,
  onDraftChange,
  onEdit,
  onContinueConversation,
  onStash,
  onUnstash,
  onDismiss,
  onLabelEdit,
  saveStatus,
  submitError,
  onRetrySubmit,
}) => {
  const [draft, setDraft] = useState(draftText ?? '');
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [labelText, setLabelText] = useState(workingSectionLabel);
  const [rationaleExpanded, setRationaleExpanded] = useState(false);

  const accentColor = authoredBy === 'peer' ? PEER_BLUE : getEntityColor(parentCardType);
  const authorTag = authoredBy === 'peer' ? '(peer)' : '(yours)';

  // ---- Stashed: compact, demoted ----
  if (status === 'stashed') {
    return (
      <div
        className="flex items-center gap-2 py-2 px-3 opacity-50 rounded-md"
        style={{ borderLeft: `3px solid ${hexToRgba(accentColor, 0.5)}` }}
      >
        <button
          type="button"
          onClick={onUnstash}
          className="text-fontWhite hover:text-fontWhite07 text-sm"
          aria-label="Un-stash"
          title="Un-stash"
        >
          ⤢
        </button>
        <span className="text-[12px] uppercase tracking-wider font-mono text-fontWhite">
          {workingSectionLabel}
        </span>
        <span className="text-[10px] text-fontGray ml-auto">{authorTag} · stashed</span>
      </div>
    );
  }

  const commitLabel = () => {
    setIsEditingLabel(false);
    if (labelText.trim() && labelText !== workingSectionLabel) {
      onLabelEdit?.(labelText.trim());
    } else {
      setLabelText(workingSectionLabel);
    }
  };

  const handleSubmit = () => {
    if (!draft.trim()) return;
    onSubmit?.(draft);
  };

  // ---- Answered: response visible, edit + continue actions ----
  if (status === 'answered') {
    return (
      <div
        className="rounded-md p-3 mb-3"
        style={{
          borderLeft: `3px solid ${accentColor}`,
          background: hexToRgba(accentColor, 0.04),
        }}
      >
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-[12px] uppercase tracking-wider font-mono" style={{ color: accentColor }}>
            {workingSectionLabel}
          </span>
          <span className="text-[10px] text-fontGray">
            {authorTag} · answered <span aria-hidden>✓</span>
          </span>
        </div>
        {questionText && (
          <p className="text-[13px] text-fontWhite italic mb-2">{questionText}</p>
        )}
        <div className="text-[10px] text-fontGray uppercase tracking-wider mb-1">— your response</div>
        <p className="text-[15px] leading-relaxed text-fontWhite07 mb-3 whitespace-pre-wrap">
          {responseProse}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={onEdit}
            className="text-fontWhite07 hover:text-fontWhite"
          >
            Edit response
          </button>
          <span className="text-fontGray">·</span>
          <button
            type="button"
            onClick={onContinueConversation}
            className="text-peerBlueLight hover:text-peerBlue"
          >
            Continue conversation
          </button>
        </div>
      </div>
    );
  }

  // ---- Open (default) ----
  return (
    <div
      className="rounded-md p-3 mb-3"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        {isEditingLabel ? (
          <input
            autoFocus
            className="flex-1 bg-transparent border-b text-[12px] uppercase tracking-wider font-mono outline-none"
            style={{ color: accentColor, borderColor: accentColor }}
            value={labelText}
            onChange={(e) => setLabelText(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel();
              if (e.key === 'Escape') {
                setLabelText(workingSectionLabel);
                setIsEditingLabel(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditingLabel(true)}
            className="flex-1 text-left text-[12px] uppercase tracking-wider font-mono hover:opacity-80"
            style={{ color: accentColor }}
            title="Click to rename"
          >
            {workingSectionLabel}
            {authoredBy === 'writer' && !labelText.trim() && (
              <span className="text-fontGray italic">[Click to name this section]</span>
            )}
          </button>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] text-fontGray">{authorTag}</span>
          <button
            type="button"
            onClick={onStash}
            className="text-fontWhite hover:text-fontWhite07 text-sm"
            aria-label="Stash"
            title="Stash"
          >
            ⌄
          </button>
          {authoredBy === 'peer' && onContinueConversation && (
            <button
              type="button"
              onClick={onContinueConversation}
              className="text-fontWhite hover:text-peerBlueLight text-sm"
              aria-label="Continue conversation"
              title="Continue conversation"
            >
              ⊘
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="text-fontWhite hover:text-errorMuted text-sm"
            aria-label="Dismiss"
            title="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Question text + rationale — peer only */}
      {authoredBy === 'peer' && questionText && (
        <>
          <p className="text-[15px] leading-relaxed text-fontWhite07 mb-2">{questionText}</p>
          {rationale && (
            <button
              type="button"
              onClick={() => setRationaleExpanded((v) => !v)}
              className="flex items-start gap-1 text-[13px] italic text-fontWhite opacity-60 hover:opacity-90 text-left mb-2"
              aria-expanded={rationaleExpanded}
            >
              <span aria-hidden>↳</span>
              {rationaleExpanded ? (
                <span>{rationale}</span>
              ) : (
                <span>
                  Why this question matters
                  <span className="ml-1">▾</span>
                </span>
              )}
            </button>
          )}
        </>
      )}

      {/* Response textarea */}
      <textarea
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          onDraftChange?.(e.target.value);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSubmit();
          }
        }}
        placeholder="Respond to this..."
        rows={draft ? 4 : 1}
        className="w-full bg-bgdark2 border border-glassBg rounded p-2 text-[14px] text-fontWhite07 placeholder:text-fontGray resize-y outline-none focus:border-peerBlueBorder"
      />

      {/* Submit / save indicator / error */}
      <div className="mt-2 flex items-center justify-end gap-2 text-xs">
        {submitError ? (
          <>
            <span className="text-errorMuted">⚠ {submitError}</span>
            <button
              type="button"
              onClick={onRetrySubmit}
              className="text-errorMuted hover:opacity-80 underline"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            {saveStatus === 'saved' && <span className="text-fontGray">· saved</span>}
            {saveStatus === 'saving' && <span className="text-fontGray">· saving</span>}
            {saveStatus === 'failed' && (
              <span className="text-errorMuted">· save failed, retrying</span>
            )}
            {draft.trim() && (
              <button
                type="button"
                onClick={handleSubmit}
                className="px-3 py-1 rounded bg-peerBlue hover:bg-peerBlueDark text-bgdark1 font-medium"
              >
                Submit <span className="opacity-70 ml-1">⌘↵</span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default WorkingSection;
