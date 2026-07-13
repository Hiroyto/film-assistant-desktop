// components/Freeform/corkboard/cards.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect, useRef } from 'react';
import { getEntityColor, hexToRgba } from '../../../components/Freeform/entityColors';
import InternIcon from '../../../components/Freeform/InternIcon';
import { PEER_BLUE } from '../../../components/Freeform/tokens';
import { type EntityType } from '../../../components/Freeform/types';
import { type ArcKind, type NarrativeStatus, type PersistedQuestion, type ProjectEntity } from '../../../lib/freeformApi';
import { ARC_BALL_H, ARC_BALL_W, ARC_DOT, BALL_TRANSITION_MS, COLLAPSED_H, COLLAPSED_W, EXPANDED_W, REL_BALL_COLOR, REL_COLLAPSED_H, REL_COLLAPSED_W, type Pos } from './constants';
import { arcKindLabel, narrativeStatusBg, narrativeStatusFg, narrativeStatusLabel, tieLabel, transitionLabel, truncate } from './labels';
import { FloatingPeerCard, WorkingSectionsBlock } from './peer';
import { type CardSignal } from './signals';
import { liftColor, useThemeMode } from './theme';

// =====================================================================
// AskPeerButton — the peer's call-to-action, shared by the expanded card
// footer and the sheet's Open Questions tile. The peer's identity is the
// glasses (InternIcon) + PEER_BLUE with a soft glow — the blue analog of
// the braindump dock's orange treatment.
// =====================================================================

export function AskPeerButton({
  onClick,
  disabled,
  label = 'Ask peer',
  title,
}: {
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  label?: string;
  title?: string;
}) {
  const dark = useThemeMode() === 'dark';
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 12.5,
        fontWeight: 600,
        padding: '7px 15px',
        borderRadius: 999,
        border: disabled
          ? `1px solid ${dark ? '#2a2a30' : '#e2e2e2'}`
          : `1px solid ${hexToRgba(PEER_BLUE, 0.55)}`,
        background: disabled
          ? dark ? '#202025' : '#eee'
          : `linear-gradient(135deg, ${hexToRgba(PEER_BLUE, dark ? 0.22 : 0.16)}, ${hexToRgba(PEER_BLUE, dark ? 0.1 : 0.07)})`,
        color: disabled ? (dark ? '#5c5c66' : '#999') : dark ? liftColor(PEER_BLUE, 0.25) : '#1e7d99',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: disabled
          ? 'none'
          : hovered
          ? `0 0 12px ${hexToRgba(PEER_BLUE, 0.45)}, 0 0 30px ${hexToRgba(PEER_BLUE, 0.22)}, 0 0 60px ${hexToRgba(PEER_BLUE, 0.1)}`
          : `0 0 10px ${hexToRgba(PEER_BLUE, 0.22)}, 0 0 24px ${hexToRgba(PEER_BLUE, 0.1)}`,
        transition: 'box-shadow 180ms ease-out, background 180ms ease-out',
      }}
    >
      <InternIcon size={15} />
      {label}
    </button>
  );
}

// =====================================================================
// CardBox — collapsed (240×110) or expanded (320×auto) inline render.
// Per-type components come in Day 3.
// =====================================================================

export function CardBox({
  entity,
  pos,
  expanded,
  isDragging,
  hasPeerOpen,
  isFocusMode,
  isFocal,
  signal,
  cardQuestions,
  auth,
  projectId,
  completedResponseIds,
  animatePosition,
  ballColor,
  ballCompact,
  onMouseDown,
  onLinkHandleMouseDown,
  isLinkSource,
  isLinkTarget,
  isSelected,
  isArcHighlighted,
  onAskPeer,
  onOpenSheet,
  onDelete,
  onRename,
  onUpdateDescription,
  onChangeNarrativeStatus,
  onQuestionsChanged,
  cardRef,
}: {
  entity: ProjectEntity;
  pos: Pos;
  expanded: boolean;
  isDragging: boolean;
  hasPeerOpen: boolean;
  isFocusMode: boolean;
  isFocal: boolean;
  signal?: CardSignal;
  cardQuestions?: PersistedQuestion[];
  auth: { userId: string; token: string } | null;
  projectId?: string;
  completedResponseIds: Set<string>;
  /** Ball cluster: smooth left/top transitions when the card is rendered at
   *  a stack-out slot or pushed by a displacement so the rolodex motion
   *  feels intentional. Suppressed during drag. */
  animatePosition?: boolean;
  /** When set (arc with a thread), render as a small ball in this color that
   *  rides the thread; expands to the full card on click. */
  ballColor?: string;
  /** Arc ball while scrolling: render as a small solid dot (no label). */
  ballCompact?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
  /** Event-only: drag-to-connect handle's mousedown. Initiates a link drag
   *  for a new PRECEDES edge. Stops propagation so card drag doesn't fire. */
  onLinkHandleMouseDown?: (e: React.MouseEvent) => void;
  /** True when this card is the source of the current link-drag (the
   *  handle is the active drag start). Suppresses card hover styling. */
  isLinkSource?: boolean;
  /** True when this card is the current drop target during link-drag.
   *  Renders a highlight ring to confirm the writer's drop zone. */
  isLinkTarget?: boolean;
  /** D'-8 — true when this Event card is in the multi-select set for
   *  "Create arc from N events". Renders a violet selection ring. */
  isSelected?: boolean;
  /** D'-8 — true when this Event card EVOKES the currently-highlighted
   *  Arc card on the canvas. Renders a violet ring distinct from
   *  selection. Also true for the highlighted arc card itself. */
  isArcHighlighted?: boolean;
  onAskPeer: () => void;
  onOpenSheet: () => void;
  onDelete: () => void;
  onRename: (newName: string) => Promise<void>;
  onUpdateDescription: (description: string) => Promise<void>;
  onChangeNarrativeStatus: (next: NarrativeStatus) => void;
  onQuestionsChanged: () => void;
  cardRef?: (el: HTMLDivElement | null) => void;
}) {
  const type = entity.type as EntityType;
  const color = getEntityColor(type);
  const name =
    entity.working_name ??
    entity.working_title ??
    (entity.character_a && entity.character_b
      ? `${entity.character_a} ↔ ${entity.character_b}`
      : entity.id);
  const isCharacter = type === 'character';
  // Ask peer supports character + event focal types (slice loader extended).
  // Location/Relationship still pending.
  const peerSupported = type === 'character' || type === 'event';
  const sig = signal ?? {};
  // Focus mode: dim + blur non-focal cards; focal stays sharp at higher
  // z-index. Pointer-events disabled on non-focal so they can't be
  // accidentally dragged/clicked through the vignette.
  const dimmed = isFocusMode && !isFocal;

  // Focus mode is board-native: the page passes the focal card a centered
  // canvas position (and displaces neighbors), so the card renders absolute
  // like everything else — no fixed-overlay path.
  // Reified relationships + threaded arcs render as a compact pill ("ball") when
  // collapsed; any expansion squares them back into a normal card. Arc balls
  // take the thread's color; relationship balls are red.
  const isRelBall = type === 'relationship' && !expanded;
  const isArcBall = type === 'arc' && !!ballColor && !expanded;
  const isBall = isRelBall || isArcBall;
  const isArcDot = isArcBall && !!ballCompact; // small dot while sliding
  const ballAccent = isArcBall ? (ballColor as string) : REL_BALL_COLOR;
  const ballW = isArcDot ? ARC_DOT : isArcBall ? ARC_BALL_W : REL_COLLAPSED_W;
  const ballMinH = isArcDot ? ARC_DOT : isArcBall ? ARC_BALL_H : REL_COLLAPSED_H;
  const dark = useThemeMode() === 'dark';
  // Dark accents are LIFTED toward white — the light palette reads muddy on
  // the near-black stage; lifted hues pop cleanly (the reference's look).
  const accent = dark ? liftColor(color, 0.3) : color;
  return (
    <div
      ref={cardRef}
      onMouseDown={onMouseDown}
      title={isBall ? name : undefined}
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: expanded ? EXPANDED_W : isBall ? ballW : COLLAPSED_W,
        minHeight: expanded ? 200 : isBall ? ballMinH : COLLAPSED_H,
        // Collapsed ball grows to fit its (wrapping) label and flex-centers it.
        height: expanded || isBall ? 'auto' : COLLAPSED_H,
        ...(isBall ? { display: 'flex', alignItems: 'center', justifyContent: 'center' } : {}),
        // Opaque fill so the thread passing behind the ball is hidden. The
        // sliding dot is a solid colored circle.
        background: isArcDot
          ? ballAccent
          : isRelBall
          ? dark ? '#251618' : '#fbe9e9'
          : dark ? '#1a1a1e' : '#fff',
        border: isBall
          ? `1px solid ${hexToRgba(ballAccent, isArcDot ? 0.9 : 0.6)}`
          : `${expanded ? 2 : 1}px solid ${
              expanded
                ? dark ? hexToRgba(accent, 0.65) : color
                : dark ? '#2a2a30' : hexToRgba(color, 0.4)
            }`,
        borderLeft: isBall ? `1px solid ${hexToRgba(ballAccent, isArcDot ? 0.9 : 0.6)}` : `4px solid ${accent}`,
        borderRadius: isArcDot ? 999 : isBall ? 13 : expanded ? 10 : 6,
        padding: expanded ? '16px 18px' : isArcDot ? 0 : isBall ? '4px 12px' : '10px 12px',
        boxSizing: 'border-box',
        boxShadow: isLinkTarget
          ? `0 4px 14px rgba(0,0,0,${dark ? 0.5 : 0.10}), 0 0 0 3px rgba(59,130,246,0.7)`
          : isSelected
          ? `0 4px 14px rgba(0,0,0,${dark ? 0.5 : 0.10}), 0 0 0 3px rgba(168,85,247,0.85)`
          : isArcHighlighted
          ? `0 4px 14px rgba(0,0,0,${dark ? 0.5 : 0.10}), 0 0 0 3px rgba(168,85,247,0.55)`
          : isDragging
          ? dark ? '0 8px 24px rgba(0,0,0,0.6)' : '0 6px 18px rgba(0,0,0,0.16)'
          : isFocal
          ? dark
            ? `0 24px 64px rgba(0,0,0,0.65), 0 0 0 1px ${hexToRgba(accent, 0.45)}, 0 0 20px ${hexToRgba(accent, 0.22)}, 0 0 52px ${hexToRgba(accent, 0.1)}`
            : `0 12px 32px rgba(0,0,0,0.18), 0 0 0 3px ${hexToRgba(accent, 0.18)}, 0 0 28px ${hexToRgba(accent, 0.18)}`
          : expanded
          ? `0 4px 14px rgba(0,0,0,${dark ? 0.55 : 0.10}), 0 0 0 3px ${hexToRgba(accent, 0.12)}`
          : dark ? '0 2px 8px rgba(0,0,0,0.45)' : '0 1px 2px rgba(0,0,0,0.06)',
        cursor: isDragging ? 'grabbing' : dimmed ? 'default' : 'grab',
        // Focal in peer-focus mode sits above the board-scoped focus scrim
        // (100) but BELOW the toolbar (140), so the pair scrolls under the
        // chrome like real board content.
        zIndex: isDragging ? 10 : isFocal ? 120 : expanded ? 20 : 1,
        // Focus mode is board-native — neighbors move aside and the scrim
        // (z144) dims everything once, so the per-card dim stays light: the
        // board should still read as the board, not vanish behind an overlay.
        opacity: dimmed ? 0.55 : 1,
        filter: dimmed ? 'blur(1px) saturate(0.7)' : 'none',
        pointerEvents: dimmed ? 'none' : 'auto',
        transform: 'none',
        transition: isDragging
          ? 'none'
          : `box-shadow 200ms ease-out, border-color 120ms, width 140ms, opacity 280ms ease-out, filter 280ms ease-out, transform 320ms cubic-bezier(0.22, 1, 0.36, 1)${
              animatePosition
                ? `, left ${BALL_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1), top ${BALL_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
                : ''
            }`,
        overflow: 'hidden',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header chips (hidden on the collapsed ball pill) */}
      {!isBall && (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 9,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            color: accent,
            fontWeight: 600,
          }}
        >
          {type}
        </span>
        {type === 'event' && expanded ? (
          <NarrativeStatusToggle
            value={(entity.narrative_status as NarrativeStatus) ?? 'on_screen'}
            onChange={onChangeNarrativeStatus}
          />
        ) : (
          entity.narrative_status && (
            <span
              style={{
                fontSize: 9,
                letterSpacing: 0.4,
                textTransform: 'uppercase',
                padding: '1px 5px',
                background: narrativeStatusBg(entity.narrative_status),
                color: narrativeStatusFg(entity.narrative_status),
                borderRadius: 2,
                fontWeight: 600,
              }}
            >
              {entity.narrative_status}
            </span>
          )
        )}
        {entity.int_ext && (
          <span
            style={{
              fontSize: 9,
              padding: '1px 5px',
              background: dark ? '#202025' : '#f5f5f5',
              color: dark ? '#9a9aa4' : '#666',
              borderRadius: 2,
              fontWeight: 500,
            }}
          >
            {entity.int_ext}
          </span>
        )}
        {entity.kind && type === 'relationship' && (
          <span style={{ fontSize: 9, color: dark ? '#82828c' : '#888', fontStyle: 'italic' }}>{entity.kind}</span>
        )}
      </div>
      )}

      {/* Name — editable inline when expanded (§10). Relationships skip the
          editable affordance because their working_name is derived from the
          two endpoint characters' names, not writer-authored. Collapsed
          relationship = a centered pill label ("A ↔ B" + kind). */}
      {expanded && type !== 'relationship' ? (
        <EditableName
          value={name}
          onSave={onRename}
          fontSize={15}
          marginBottom={8}
        />
      ) : isArcDot ? null : isBall ? (
        <span style={{ fontSize: 10, fontWeight: 600, color: ballAccent, letterSpacing: 0.2, lineHeight: 1.2, textAlign: 'center', wordBreak: 'break-word' }}>
          {isArcBall ? name : (entity.kind ? String(entity.kind).replace(/_/g, ' ') : '↔')}
        </span>
      ) : (
        <div
          style={{
            fontSize: expanded ? 15 : 13,
            fontWeight: 500,
            color: dark ? '#e8e8ec' : '#222',
            lineHeight: 1.25,
            marginBottom: expanded ? 8 : 4,
          }}
        >
          {name}
        </div>
      )}

      {/* Body — per-type, per-expansion-state */}
      {expanded ? (
        <ExpandedBody
          entity={entity}
          signal={sig}
          accentColor={accent}
          cardQuestions={cardQuestions}
          auth={auth}
          projectId={projectId}
          completedResponseIds={completedResponseIds}
          onQuestionsChanged={onQuestionsChanged}
          onUpdateDescription={onUpdateDescription}
        />
      ) : isBall ? null : (
        <CompactBody entity={entity} signal={sig} accentColor={accent} />
      )}

      {/* Footer — Ask peer + Open full sheet buttons (only when expanded) */}
      {expanded && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 10,
            borderTop: dark ? '1px solid #26262b' : '1px solid #f0f0f0',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onOpenSheet();
              }}
              style={{
                fontSize: 11,
                color: dark ? '#9a9aa4' : '#666',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
                textDecoration: 'underline',
                fontFamily: 'system-ui, sans-serif',
              }}
              title={`Open full ${type} sheet`}
            >
              open full sheet ↗
            </button>
            <DeleteCardLink onConfirm={onDelete} entityType={type} />
          </div>
          <AskPeerButton
            onClick={() => onAskPeer()}
            disabled={!peerSupported || hasPeerOpen}
            title={
              !peerSupported
                ? `Ask peer doesn't yet support ${type} focal`
                : hasPeerOpen
                ? 'Peer is already open for this card'
                : 'Ask peer'
            }
          />
        </div>
      )}

      {/* D'-7 follow-up: drag-to-connect handle on Event cards. Drag the
          handle onto another Event card → writes a PRECEDES edge.
          Pointer events on the handle don't trigger card drag because the
          mousedown stops propagation. */}
      {type === 'event' && onLinkHandleMouseDown && !isFocusMode && (
        <div
          onMouseDown={onLinkHandleMouseDown}
          title="Drag to connect this event to another event (PRECEDES)"
          style={{
            position: 'absolute',
            right: 6,
            bottom: 6,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: isLinkSource ? color : '#fff',
            border: `2px solid ${color}`,
            cursor: 'crosshair',
            zIndex: 3,
            transition: 'background 120ms ease-out, transform 120ms ease-out',
            transform: isLinkSource ? 'scale(1.2)' : 'scale(1)',
          }}
        />
      )}
    </div>
  );
}

// =====================================================================
// NarrativeStatusToggle — 3-state segmented control for Event cards
// (rendered / backstory / offstage). Writer-authored field per §8.
// Scripts only auto-generates scenes from `rendered` Events, so this is
// the gate between drafted-and-rendering vs. backstory/offstage.
// =====================================================================

export function NarrativeStatusToggle({
  value,
  onChange,
}: {
  value: NarrativeStatus;
  onChange: (next: NarrativeStatus) => void;
}) {
  const dark = useThemeMode() === 'dark';
  const options: { v: NarrativeStatus; short: string; label: string }[] = [
    { v: 'on_screen', short: 'on-screen', label: 'Audience experiences it directly; will generate scenes' },
    { v: 'backstory', short: 'backstory', label: 'Pre-story; informs but not shown' },
    { v: 'offstage', short: 'offstage', label: 'Happens during story but not shown' },
  ];
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        border: dark ? '1px solid #2a2a30' : '1px solid #e5e5e5',
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      {options.map(({ v, short, label }) => {
        const active = value === v;
        return (
          <button
            key={v}
            onClick={(e) => {
              e.stopPropagation();
              if (!active) onChange(v);
            }}
            title={label}
            style={{
              fontSize: 9,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              padding: '2px 7px',
              background: active ? narrativeStatusBg(v) : dark ? '#1d1d22' : '#fff',
              color: active ? narrativeStatusFg(v) : dark ? '#787882' : '#999',
              border: 'none',
              borderRight: v !== 'offstage' ? (dark ? '1px solid #2a2a30' : '1px solid #e5e5e5') : 'none',
              cursor: active ? 'default' : 'pointer',
              fontWeight: active ? 600 : 500,
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {short}
          </button>
        );
      })}
    </div>
  );
}

// =====================================================================
// EditableName — click-to-edit inline rename for the expanded card header
// (§10). Hover shows a faint pencil cue; click flips to an input. Enter
// saves, Esc cancels, blur cancels (deliberate — no accidental saves from
// clicking elsewhere). Optimistic save handled by the parent via onSave's
// throw-on-failure contract: parent applies the rename to its own state
// before calling, this component just signals intent.
// =====================================================================

export function EditableName({
  value,
  onSave,
  fontSize,
  marginBottom,
}: {
  value: string;
  onSave: (newName: string) => Promise<void>;
  fontSize: number;
  marginBottom: number;
}) {
  const dark = useThemeMode() === 'dark';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Keep the draft in sync if the value updates from above (e.g., remote
    // refresh) while we're not actively editing.
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  const commit = async () => {
    const next = draft.trim();
    if (!next || next === value) {
      cancel();
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      // Parent should toast / log; revert here.
      setDraft(value);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        disabled={busy}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={cancel}
        style={{
          fontSize,
          fontWeight: 500,
          color: dark ? '#e8e8ec' : '#222',
          lineHeight: 1.25,
          marginBottom,
          padding: '2px 4px',
          border: '1px solid #ccc',
          borderRadius: 3,
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: 'system-ui, sans-serif',
        }}
      />
    );
  }

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Click to rename"
      style={{
        fontSize,
        fontWeight: 500,
        color: dark ? '#e8e8ec' : '#222',
        lineHeight: 1.25,
        marginBottom,
        cursor: 'text',
        padding: '2px 4px',
        marginLeft: -4,
        marginRight: -4,
        borderRadius: 3,
        background: hovered ? 'rgba(0,0,0,0.04)' : 'transparent',
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 6,
        maxWidth: '100%',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</span>
      {hovered && (
        <span style={{ fontSize: 10, color: dark ? '#6e6e78' : '#aaa', fontWeight: 400 }}>✎</span>
      )}
    </div>
  );
}

// =====================================================================
// EditableDescription — click-to-edit inline textarea for card descriptions.
// D'-5b — same contract as EditableName: parent applies onSave via
// optimistic update + throws on backend failure for revert. Cmd/Ctrl+Enter
// saves; Esc cancels; click outside cancels. Multi-line input (textarea).
// Empty placeholder when value is empty so manually-created cards still
// invite a fill-in.
// =====================================================================

export function EditableDescription({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (newDescription: string) => Promise<void>;
  placeholder?: string;
}) {
  const dark = useThemeMode() === 'dark';
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [hovered, setHovered] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        // Place cursor at end of existing content.
        textareaRef.current?.setSelectionRange(draft.length, draft.length);
      });
    }
  }, [editing, draft.length]);

  const cancel = () => {
    setEditing(false);
    setDraft(value);
  };

  const commit = async () => {
    const next = draft; // preserve internal whitespace; trim is the writer's call
    if (next === value) {
      cancel();
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      setDraft(value);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        disabled={busy}
        placeholder={placeholder}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        // Save on blur so click-away doesn't silently discard a writer's
        // edit. Esc still cancels explicitly.
        onBlur={commit}
        rows={4}
        style={{
          fontSize: 12,
          color: dark ? '#e8e8ec' : '#222',
          background: dark ? '#101013' : '#fff',
          lineHeight: 1.45,
          marginBottom: 10,
          padding: '6px 8px',
          border: dark ? '1px solid #2f2f36' : '1px solid #ccc',
          borderRadius: 5,
          outline: 'none',
          width: '100%',
          boxSizing: 'border-box',
          fontFamily: 'system-ui, sans-serif',
          resize: 'vertical',
          minHeight: 60,
        }}
      />
    );
  }

  // Read-only display. Empty case shows the placeholder italicized so writers
  // know they can click in.
  const isEmpty = !value;
  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        setEditing(true);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Click to edit description (⌘/Ctrl+Enter to save, Esc to cancel)"
      style={{
        fontSize: 12,
        color: isEmpty ? (dark ? '#6e6e78' : '#aaa') : dark ? '#c6c6cf' : '#444',
        fontStyle: isEmpty ? 'italic' : 'normal',
        lineHeight: 1.5,
        marginBottom: 10,
        cursor: 'text',
        padding: '4px 6px',
        marginLeft: -6,
        marginRight: -6,
        borderRadius: 5,
        background: hovered ? (dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)') : 'transparent',
        whiteSpace: 'pre-wrap',
        position: 'relative',
      }}
    >
      {value || placeholder || 'Click to add a description…'}
      {hovered && !isEmpty && (
        <span style={{ marginLeft: 6, fontSize: 10, color: dark ? '#6e6e78' : '#aaa' }}>✎</span>
      )}
    </div>
  );
}

// =====================================================================
// DeleteCardLink — two-click confirm pattern. First click flips to a
// "click again to confirm" state for 3s; second click commits the delete.
// Soft-delete only (§9); the entity goes to the Trash overlay where it can
// be restored.
// =====================================================================

export function DeleteCardLink({
  onConfirm,
  entityType,
}: {
  onConfirm: () => void;
  entityType: string;
}) {
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!armed) {
      setArmed(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setArmed(false), 3000);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    setArmed(false);
    onConfirm();
  };

  return (
    <button
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      title={
        armed
          ? 'Click again to delete (will land in Trash — restore anytime)'
          : `Delete this ${entityType} (soft delete, recoverable from Trash)`
      }
      style={{
        fontSize: 11,
        color: armed ? '#c44' : '#999',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        textDecoration: 'underline',
        fontFamily: 'system-ui, sans-serif',
        fontWeight: armed ? 600 : 400,
      }}
    >
      {armed ? 'click again to delete' : 'delete'}
    </button>
  );
}

// =====================================================================
// Compact body — per-type signal lines fit in ~70px of card body.
// =====================================================================

export function CompactBody({
  entity,
  signal,
  accentColor,
}: {
  entity: ProjectEntity;
  signal: CardSignal;
  accentColor: string;
}) {
  const dark = useThemeMode() === 'dark';
  const type = entity.type as EntityType;
  if (type === 'character') return <CharacterCompact entity={entity} signal={signal} accentColor={accentColor} />;
  if (type === 'event') return <EventCompact entity={entity} signal={signal} />;
  if (type === 'location') return <LocationCompact entity={entity} signal={signal} />;
  if (type === 'relationship') return <RelationshipCompact entity={entity} signal={signal} accentColor={accentColor} />;
  if (type === 'arc') return <ArcCompact entity={entity} signal={signal} accentColor={accentColor} />;
  return null;
}

export function CharacterCompact({
  entity,
  signal,
  accentColor,
}: {
  entity: ProjectEntity;
  signal: CardSignal;
  accentColor: string;
}) {
  const dark = useThemeMode() === 'dark';
  const traits = entity.established_traits ?? [];
  const dimCount = entity.open_dimensions?.length ?? 0;
  return (
    <div>
      <SignalRow
        items={[
          traits.length > 0 && `${traits.length} traits`,
          dimCount > 0 && `${dimCount} open`,
          (signal.eventCount ?? 0) > 0 && `${signal.eventCount} events`,
          (signal.structuralCount ?? 0) > 0 && tieLabel(signal),
        ]}
      />
      {traits.length > 0 && (
        <div style={{ marginTop: 4, display: 'flex', gap: 3, flexWrap: 'wrap', overflow: 'hidden', maxHeight: 18 }}>
          {traits.slice(0, 3).map((t, i) => (
            <span
              key={i}
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 8,
                background: hexToRgba(accentColor, 0.12),
                color: dark ? '#b2b2bc' : '#555',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 100,
              }}
            >
              {t}
            </span>
          ))}
          {traits.length > 3 && <span style={{ fontSize: 9, color: dark ? '#6e6e78' : '#aaa' }}>+{traits.length - 3}</span>}
        </div>
      )}
    </div>
  );
}

export function EventCompact({ entity, signal }: { entity: ProjectEntity; signal: CardSignal }) {
  const dark = useThemeMode() === 'dark';
  const involves = signal.involvesCharNames ?? [];
  const next = signal.precedesNextTitles?.[0];
  const subCount = signal.subEventCount ?? 0;
  return (
    <div>
      <SignalRow
        items={[
          subCount > 0 && `${subCount} sub-events`,
          involves.length > 0 && `${involves.length} char${involves.length === 1 ? '' : 's'}`,
          next && `→ ${truncate(next, 22)}`,
        ]}
      />
      {involves.length > 0 && (
        <div
          style={{
            marginTop: 4,
            fontSize: 10.5,
            color: dark ? '#9a9aa4' : '#666',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {involves.join(' · ')}
        </div>
      )}
    </div>
  );
}

export function LocationCompact({ entity, signal }: { entity: ProjectEntity; signal: CardSignal }) {
  const dark = useThemeMode() === 'dark';
  const appearsIn = signal.appearsInEventTitles ?? [];
  return (
    <div>
      <SignalRow
        items={[
          appearsIn.length > 0 && `Appears in ${appearsIn.length} event${appearsIn.length === 1 ? '' : 's'}`,
        ]}
      />
      {entity.description && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: dark ? '#8e8e98' : '#777',
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {entity.description}
        </div>
      )}
    </div>
  );
}

export function RelationshipCompact({
  entity,
  signal,
  accentColor,
}: {
  entity: ProjectEntity;
  signal: CardSignal;
  accentColor: string;
}) {
  const dark = useThemeMode() === 'dark';
  return (
    <div>
      {entity.description && (
        <div
          style={{
            fontSize: 11,
            color: dark ? '#9a9aa4' : '#666',
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {entity.description}
        </div>
      )}
    </div>
  );
}

// D'-5 — Arc collapsed view. Kind chip + evoking-event count + derived
// status_label. Conceptually distinct from Character/Event/etc. (a thread,
// not an entity) — uses violet accent color from tokens.ts.
export function ArcCompact({
  entity,
  signal,
  accentColor,
}: {
  entity: ProjectEntity;
  signal: CardSignal;
  accentColor: string;
}) {
  const dark = useThemeMode() === 'dark';
  const evokesCount = signal.evokesEntries?.length ?? 0;
  const kind = (entity.kind as ArcKind | undefined) ?? undefined;
  return (
    <div>
      <SignalRow
        items={[
          kind && arcKindLabel(kind),
          evokesCount > 0 && `${evokesCount} event${evokesCount === 1 ? '' : 's'}`,
          (signal.arcInvolvesCharNames?.length ?? 0) > 0 &&
            `${signal.arcInvolvesCharNames!.length} char${signal.arcInvolvesCharNames!.length === 1 ? '' : 's'}`,
        ]}
      />
      {signal.arcStatusLabel && (
        <div
          style={{
            marginTop: 4,
            fontSize: 10.5,
            color: hexToRgba(accentColor, 0.95),
            fontStyle: 'italic',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {signal.arcStatusLabel}
        </div>
      )}
      {entity.description && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: dark ? '#9a9aa4' : '#666',
            lineHeight: 1.35,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {entity.description}
        </div>
      )}
    </div>
  );
}

export function SignalRow({ items }: { items: Array<string | false | undefined | null> }) {
  const dark = useThemeMode() === 'dark';
  const filtered = items.filter((s): s is string => Boolean(s));
  if (filtered.length === 0) return null;
  return (
    <div
      style={{
        fontSize: 10.5,
        color: dark ? '#82828c' : '#888',
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginTop: 2,
      }}
    >
      {filtered.map((s, i) => (
        <span key={i}>{s}</span>
      ))}
    </div>
  );
}

// =====================================================================
// Expanded body — full per-type content (existing layout, augmented with
// signal-derived sections like "Connected via" + "Appears in").
// =====================================================================

export function ExpandedBody({
  entity,
  signal,
  accentColor,
  cardQuestions,
  auth,
  projectId,
  completedResponseIds,
  onQuestionsChanged,
  onUpdateDescription,
}: {
  entity: ProjectEntity;
  signal: CardSignal;
  accentColor: string;
  cardQuestions?: PersistedQuestion[];
  auth: { userId: string; token: string } | null;
  projectId?: string;
  completedResponseIds: Set<string>;
  onQuestionsChanged: () => void;
  onUpdateDescription: (description: string) => Promise<void>;
}) {
  const dark = useThemeMode() === 'dark';
  const type = entity.type as EntityType;
  // Per D'-5b: prefer `description` as the canonical writer-editable field;
  // Event keeps `summary` synced via the backend (writes both). Relationship
  // displays its derived "A ↔ B" label as the name, so its description
  // editor edits the relationship's prose blurb.
  const body = entity.description ?? entity.summary ?? '';
  const traits = entity.established_traits ?? [];
  const subEvents = entity.sub_events ?? [];
  // Editable description supported across Character/Event/Location/Arc/
  // Relationship. The backend handler gates by label.
  const descriptionEditable =
    type === 'character' || type === 'event' || type === 'location'
      || type === 'arc' || type === 'relationship';

  return (
    <div style={{ fontSize: 12, color: dark ? '#c2c2ca' : '#444', lineHeight: 1.45 }}>
      {descriptionEditable ? (
        <EditableDescription
          value={body}
          onSave={onUpdateDescription}
          placeholder={
            type === 'event' ? 'What happens in this event…'
              : type === 'arc' ? 'What this arc is about…'
              : type === 'location' ? 'Describe this place…'
              : type === 'relationship' ? 'Describe this relationship…'
              : 'Describe this character…'
          }
        />
      ) : (
        body && <div style={{ marginBottom: 10 }}>{body}</div>
      )}

      {/* Character: traits chips */}
      {type === 'character' && traits.length > 0 && (
        <div style={{ marginBottom: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {traits.map((t, i) => (
            <span
              key={i}
              style={{
                fontSize: 10,
                padding: '2px 7px',
                borderRadius: 10,
                background: hexToRgba(accentColor, 0.12),
                color: dark ? '#b2b2bc' : '#555',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* Character: Working sections — counts + "+ Add my own" + answerable
          composers per question. Replaces the peer-panel composers (peer is
          display-only). */}
      {type === 'character' && (
        <WorkingSectionsBlock
          cardId={entity.id}
          projectId={projectId}
          auth={auth}
          entity={entity}
          questions={cardQuestions}
          completedResponseIds={completedResponseIds}
          onChanged={onQuestionsChanged}
        />
      )}

      {/* Character: Knowledge arcs — technical, collapsed by default. */}
      {type === 'character' && (signal.knowsList?.length ?? 0) > 0 && (
        <CollapsibleSection label="Knowledge arcs" count={signal.knowsList!.length}>
          {signal.knowsList!.map((k, i) => {
            const verb =
              k.state === 'doesnt_know'
                ? "doesn't know"
                : k.state === 'suspects'
                ? 'suspects'
                : k.state === 'almost_spoiled'
                ? 'almost spoiled on'
                : 'knows';
            return (
              <div key={i} style={{ fontSize: 11.5, color: dark ? '#c2c2ca' : '#444', marginBottom: 4 }}>
                <span style={{ color: accentColor, fontWeight: 600 }}>{verb}</span>{' '}
                {k.info_summary}
                {k.state_qualifier && (
                  <span style={{ color: dark ? '#82828c' : '#888' }}> ({k.state_qualifier})</span>
                )}
              </div>
            );
          })}
        </CollapsibleSection>
      )}

      {/* Character: Appears in events — technical, collapsed by default. */}
      {type === 'character' && (signal.appearsInEvents?.length ?? 0) > 0 && (
        <CollapsibleSection label="Appears in" count={signal.appearsInEvents!.length}>
          {signal.appearsInEvents!.map((e, i) => (
            <div
              key={e.id}
              style={{
                fontSize: 11.5,
                color: dark ? '#c2c2ca' : '#444',
                marginBottom: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ color: dark ? '#6e6e78' : '#aaa', minWidth: 14 }}>{i + 1}.</span>
              <span style={{ flex: 1 }}>{e.title}</span>
              {e.narrative_status && (
                <span
                  style={{
                    fontSize: 9,
                    padding: '1px 5px',
                    background: narrativeStatusBg(e.narrative_status),
                    color: narrativeStatusFg(e.narrative_status),
                    borderRadius: 2,
                    textTransform: 'uppercase',
                    letterSpacing: 0.3,
                    fontWeight: 600,
                  }}
                >
                  {narrativeStatusLabel(e.narrative_status)}
                </span>
              )}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* Character: structural ties */}
      {type === 'character' && (signal.structuralPeers?.length ?? 0) > 0 && (
        <Section label="Connected via">
          {signal.structuralPeers!.map((peer, i) => (
            <div key={i} style={{ fontSize: 11, color: dark ? '#9a9aa4' : '#666' }}>
              <span style={{ fontFamily: 'monospace', color: dark ? '#82828c' : '#888' }}>
                {signal.structuralPreds![i] ?? ''}
              </span>{' '}
              {peer}
            </div>
          ))}
        </Section>
      )}

      {/* Event: involves chars + occurs in + precedes chain */}
      {type === 'event' && (signal.involvesCharNames?.length ?? 0) > 0 && (
        <Section label="Involves">{signal.involvesCharNames!.join(' · ')}</Section>
      )}
      {type === 'event' && (signal.occursInLocNames?.length ?? 0) > 0 && (
        <Section label="Occurs in">{signal.occursInLocNames!.join(' · ')}</Section>
      )}
      {type === 'event' &&
        ((signal.precededByTitles?.length ?? 0) > 0 || (signal.precedesNextTitles?.length ?? 0) > 0) && (
          <Section label="Throughline">
            <div style={{ fontSize: 11, color: dark ? '#9a9aa4' : '#666' }}>
              {(signal.precededByTitles ?? []).map((t, i) => (
                <div key={`p${i}`}>
                  <span style={{ color: dark ? '#6e6e78' : '#aaa' }}>← </span>
                  {t}
                </div>
              ))}
              {(signal.precedesNextTitles ?? []).map((t, i) => (
                <div key={`n${i}`}>
                  <span style={{ color: dark ? '#6e6e78' : '#aaa' }}>→ </span>
                  {t}
                </div>
              ))}
            </div>
          </Section>
        )}

      {/* Location: appears in events */}
      {type === 'location' && (signal.appearsInEventTitles?.length ?? 0) > 0 && (
        <Section label="Appears in">
          {signal.appearsInEventTitles!.map((t, i) => (
            <div key={i} style={{ fontSize: 11, color: dark ? '#9a9aa4' : '#666' }}>
              · {t}
            </div>
          ))}
        </Section>
      )}

      {/* Arc (FIL-504 / D'-5): kind + status + INVOLVES + evoking-events
          trajectory. The trajectory list is the load-bearing "music sheet"
          surface — events in PRECEDES order with their transition + state. */}
      {type === 'arc' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' }}>
          {entity.kind && (
            <span
              style={{
                fontSize: 10,
                padding: '2px 7px',
                borderRadius: 10,
                background: hexToRgba(accentColor, 0.18),
                color: hexToRgba(accentColor, 1),
                textTransform: 'uppercase',
                letterSpacing: 0.3,
                fontWeight: 600,
              }}
            >
              {arcKindLabel(entity.kind as ArcKind)}
            </span>
          )}
          {signal.arcStatusLabel && (
            <span style={{ fontSize: 10.5, color: dark ? '#9a9aa4' : '#666', fontStyle: 'italic' }}>
              {signal.arcStatusLabel}
            </span>
          )}
        </div>
      )}
      {type === 'arc' && (signal.arcInvolvesCharNames?.length ?? 0) > 0 && (
        <Section label="Involves">{signal.arcInvolvesCharNames!.join(' · ')}</Section>
      )}
      {type === 'arc' && (signal.evokesEntries?.length ?? 0) > 0 && (
        <Section label="Evokes">
          {signal.evokesEntries!.map((e, i) => (
            <div
              key={e.event_id}
              style={{
                marginBottom: 6,
                paddingLeft: 6,
                borderLeft: `2px solid ${hexToRgba(accentColor, 0.25)}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ color: dark ? '#6e6e78' : '#aaa', minWidth: 14, fontSize: 11 }}>{i + 1}.</span>
                <span style={{ fontSize: 11.5, color: dark ? '#c2c2ca' : '#444', flex: 1 }}>{e.event_title}</span>
                {e.narrative_status && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      background: narrativeStatusBg(e.narrative_status),
                      color: narrativeStatusFg(e.narrative_status),
                      borderRadius: 2,
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                      fontWeight: 600,
                    }}
                  >
                    {narrativeStatusLabel(e.narrative_status)}
                  </span>
                )}
                {e.transition && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 2,
                      background: hexToRgba(accentColor, 0.16),
                      color: hexToRgba(accentColor, 1),
                      textTransform: 'uppercase',
                      letterSpacing: 0.3,
                      fontWeight: 600,
                    }}
                  >
                    {transitionLabel(e.transition)}
                  </span>
                )}
              </div>
              {e.state_at_event && (
                <div
                  style={{
                    fontSize: 11,
                    color: dark ? '#9a9aa4' : '#666',
                    marginTop: 3,
                    marginLeft: 20,
                    lineHeight: 1.4,
                  }}
                >
                  {e.state_at_event}
                </div>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* Event: per-arc EVOKES entries from this event's perspective. Surfaces
          the state_at_event content written on each EVOKES edge so the event
          card carries arc-perspective narrative even when its own summary is
          thin — symmetric with the arc card's music-sheet view (D'-5). */}
      {type === 'event' && (signal.evokesArcEntries?.length ?? 0) > 0 && (
        <Section label="Evokes arcs">
          {signal.evokesArcEntries!.map((a) => {
            const arcColor = getEntityColor('arc');
            return (
              <div
                key={a.arc_id}
                style={{
                  marginBottom: 6,
                  paddingLeft: 6,
                  borderLeft: `2px solid ${hexToRgba(arcColor, 0.3)}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11.5, color: dark ? '#c2c2ca' : '#444', fontWeight: 500 }}>
                    {a.arc_name}
                  </span>
                  {a.arc_kind && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 10,
                        background: hexToRgba(arcColor, 0.14),
                        color: hexToRgba(arcColor, 1),
                        textTransform: 'uppercase',
                        letterSpacing: 0.3,
                        fontWeight: 600,
                      }}
                    >
                      {arcKindLabel(a.arc_kind as ArcKind)}
                    </span>
                  )}
                  {a.transition && (
                    <span
                      style={{
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 2,
                        background: hexToRgba(arcColor, 0.16),
                        color: hexToRgba(arcColor, 1),
                        textTransform: 'uppercase',
                        letterSpacing: 0.3,
                        fontWeight: 600,
                      }}
                    >
                      {transitionLabel(a.transition)}
                    </span>
                  )}
                </div>
                {a.state_at_event && (
                  <div
                    style={{
                      fontSize: 11,
                      color: dark ? '#9a9aa4' : '#666',
                      marginTop: 3,
                      lineHeight: 1.4,
                    }}
                  >
                    {a.state_at_event}
                  </div>
                )}
                {a.evidence_quote && (
                  <div
                    style={{
                      marginTop: 3,
                      paddingLeft: 6,
                      borderLeft: `1px solid ${hexToRgba(arcColor, 0.2)}`,
                      fontSize: 10.5,
                      color: dark ? '#82828c' : '#888',
                      fontStyle: 'italic',
                      lineHeight: 1.4,
                    }}
                  >
                    "{a.evidence_quote}"
                  </div>
                )}
              </div>
            );
          })}
        </Section>
      )}

      {/* Open dimensions intentionally omitted from the expanded card —
          they're the peer's working material, surfacing them here is
          duplicative. Available via Ask peer + the slice's open_dimensions
          field. Will surface again at level 3 (full character sheet). */}

      {/* Sub-events (Event only) */}
      {subEvents.length > 0 && (
        <Section label="Sub-events">
          {subEvents.map((s, i) => (
            <div key={i} style={{ marginBottom: 6, fontSize: 11 }}>
              {s.slugline && <div style={{ fontFamily: 'monospace', color: dark ? '#b2b2bc' : '#555' }}>{s.slugline}</div>}
              {s.description && <div style={{ color: dark ? '#9a9aa4' : '#666' }}>{s.description}</div>}
            </div>
          ))}
        </Section>
      )}

      {entity.evidence_quote && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 10px',
            borderLeft: `2px solid ${hexToRgba(accentColor, 0.45)}`,
            borderRadius: '0 6px 6px 0',
            background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)',
            fontSize: 10.5,
            color: dark ? '#8e8e99' : '#888',
            fontStyle: 'italic',
            lineHeight: 1.5,
          }}
        >
          "{entity.evidence_quote}"
        </div>
      )}
    </div>
  );
}

export function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const dark = useThemeMode() === 'dark';
  return (
    <div style={{ marginBottom: 10 }}>
      {label && (
        <div
          style={{
            fontSize: 9,
            letterSpacing: 0.5,
            color: dark ? '#82828c' : '#888',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          {label}
        </div>
      )}
      {children}
    </div>
  );
}

// Collapsible variant for sections the writer might consult but doesn't need
// surfaced by default (knowledge arcs, appears in — technical signal).
export function CollapsibleSection({
  label,
  count,
  children,
}: {
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  const dark = useThemeMode() === 'dark';
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        onClick={() => setOpen((o) => !o)}
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          fontSize: 9,
          letterSpacing: 0.5,
          color: dark ? '#82828c' : '#888',
          textTransform: 'uppercase',
          marginBottom: open ? 4 : 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 8 }}>{open ? '▾' : '▸'}</span>
        <span>{label}</span>
        {count !== undefined && count > 0 && (
          <span style={{ color: dark ? '#6e6e78' : '#aaa', textTransform: 'none', letterSpacing: 0 }}>· {count}</span>
        )}
      </div>
      {open && children}
    </div>
  );
}
