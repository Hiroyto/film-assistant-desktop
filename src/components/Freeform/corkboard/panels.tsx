// components/Freeform/corkboard/panels.tsx — split out of freeform-corkboard.tsx (FIL-496).
import React, { useState, useEffect } from 'react';
import { getEntityColor, hexToRgba } from '../../../components/Freeform/entityColors';
import { NOTE_FONT_SERIF } from '../../../components/Freeform/tokens';
import { type EntityType } from '../../../components/Freeform/types';
import { deleteInformation, listBraindumps, updateInformation, type ArcKind, type ArcSuggestion, type BraindumpLogEntry, type ProjectEntity, type ProjectInformation } from '../../../lib/freeformApi';
import { InlineText } from './editors';
import { arcKindLabel, formatRelativeTime } from './labels';
import { type CardSignal } from './signals';
import { useThemeMode } from './theme';
import { BallChip } from './toolbar';

// =====================================================================
// BallChip — sticky-on-scroll category cluster (Characters / Arcs / Locations /
// Backstory). A pill labelled with the category + count of members that have
// scrolled above the view. Viewport-pinned (not draggable); clicking toggles
// the cluster's expand state, dealing its members back into view.
// =====================================================================

// =====================================================================
// RightPanel — on-demand right-side panel toggled from the toolbar. Three
// collapsible sections: Arc suggestions (top, default open — accept/dismiss
// inline), Information (default collapsed — every story fact, inline-editable,
// click-through to its establishing scenes) and Arcs (default collapsed — a
// tile per arc with "open full sheet"). Generalizes the old suggestions-only
// drawer into a permanent surface.
// =====================================================================

export const INFO_ACCENT = '#0891b2'; // cyan — the Information layer's accent
// The braindump's orange (dock chips, placement glow): the strip is the tail
// end of a braindump, so its section header + added-material marks carry it.
export const BD_ORANGE = '#ff8c42';
const APPLIED_BLUE = '#54bfdb';

// =====================================================================
// The staging strip (Placement Control v1b) — cards whose relationship to
// the board is a question, not a write. A staged card IS its question; the
// row grammar is the script docket's (one-line rows, tier tick, serif gist,
// one row expanded at a time, single imperative primary action). Resting
// unanswered is the DEFAULT state, not a failure — "keep it on the side for
// now" is the absence of a click.
// =====================================================================

/** One strip row, joined FE-side: question + staged entity + target entity. */
export interface StagedStripRow {
  cardId: string;
  kind: 'scene' | 'section' | 'character' | 'story';
  questionType: 'merge_suggestion' | 'compare' | 'unplaced' | 'altitude' | 'retelling'
    | 'character_description' | 'character_rename' | 'story_fact';
  /** Character rows: the character card the question is about (a rename
   *  row's own cardId is not an entity id). */
  characterId?: string;
  /** character_rename rows: the name the braindump used. */
  proposedName?: string;
  title: string;
  summary: string;
  reason: string;
  createdAt: string;
  sourceBraindumpId: string;
  /** True when the candidate came from pasted SCRIPT PAGES rather than a typed
   *  braindump. Changes what the question calls the source: pages written into
   *  a scene that is already on the board are not a braindump. */
  fromScript: boolean;
  /** The dump sentence(s) that minted this card (extraction's evidence_quote):
   *  the writer's OWN words, the strip's orientation pin. */
  evidenceQuote: string;
  /** Whether the card is HELD off the board (staged). Altitude questions on a
   *  sequence that has member scenes stay live on the board. */
  held: boolean;
  /** Retelling rows (FIL-583): the braindump's proposed new telling. The
   *  card on the board keeps its current one until the writer answers. */
  proposedSummary?: string;
  /** Order ask on a LIVE member scene (Ben 2026-09-02): the card already
   *  renders at a default slot in its section, so the row offers confirming
   *  that slot outright alongside placing it elsewhere. */
  confirmable?: boolean;
  target: { id: string; title: string; summary: string } | null;
}

// The pin to the braindump itself: locate this card's material inside the
// dump's prose and cut a window around it, so the writer re-reads their own
// words before agreeing or disagreeing with the model's claim.
//
// The MODEL CLAIMS, the TEXT ILLUSTRATES (Ben: a change can be too subtle for
// strict citation - a reframe, an implication - so the text is never the
// authority on WHAT changed). The window is FOUND via the stamped
// evidence_quote (often absent: empty-string props are dropped at write
// time), else the dump sentence best token-matching `anchorText`. The
// HIGHLIGHT then marks the sentences that express the model's claimed change
// (`changeText`); when the change has no textual anchor, nothing hits and
// the caller falls back to the model's own wording of it.
function braindumpExcerpt(
  prose: string | undefined,
  quote: string | undefined,
  anchorText: string | undefined,
  changeText: string | undefined,
): Array<{ text: string; hit: boolean }> | null {
  const p = String(prose ?? '');
  const q = (quote ?? '').trim();
  const tok = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 3);

  const sents: Array<{ start: number; end: number; text: string }> = [];
  const re = /[^.!?]+[.!?]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) {
    const lead = m[0].length - m[0].trimStart().length;
    const text = m[0].trim();
    if (text) sents.push({ start: m.index + lead, end: m.index + lead + text.length, text });
  }

  // 1. Anchor: quote span when it is stamped AND findable, else the sentence
  //    best matching anchorText.
  let anchor: { start: number; end: number } | null = null;
  if (q) {
    const i = p.toLowerCase().indexOf(q.toLowerCase());
    if (i >= 0) anchor = { start: i, end: i + q.length };
  }
  if (!anchor) {
    const want = new Set(tok(String(anchorText ?? '')));
    if (want.size > 0) {
      let bestScore = 0;
      for (const s of sents) {
        const t = tok(s.text);
        if (t.length === 0) continue;
        const hits = t.filter((w) => want.has(w)).length;
        const score = hits / t.length;
        if (hits >= 2 && score >= 0.25 && score > bestScore) {
          bestScore = score;
          anchor = { start: s.start, end: s.end };
        }
      }
    }
  }
  if (!anchor) {
    // Quote stamped but re-worded out of the prose: show it bare rather than
    // guess (it is still near-verbatim writer material).
    return q ? [{ text: q, hit: true }] : null;
  }

  // 2. Window + per-sentence highlight: a sentence hits when it expresses
  //    the model's claimed change (token match against changeText). Subtle
  //    changes match nothing, and that is correct - the caller shows the
  //    model's wording instead of a false citation.
  const wStart = Math.max(0, anchor.start - 130);
  const wEnd = Math.min(p.length, anchor.end + 130);
  const cTokens = new Set(tok(String(changeText ?? '')));
  const expressesChange = (text: string) => {
    if (cTokens.size === 0) return false;
    const t = tok(text);
    if (t.length === 0) return false;
    const hits = t.filter((w) => cTokens.has(w)).length;
    return hits >= 2 && hits / t.length >= 0.3;
  };
  // Whole sentences only: a window edge never cuts a sentence mid-word.
  const out: Array<{ text: string; hit: boolean }> = [];
  const inWindow = sents.filter((s) => !(s.end <= wStart || s.start >= wEnd));
  inWindow.forEach((s, i) => {
    let text = s.text;
    if (i === 0 && sents.indexOf(s) > 0) text = `… ${text}`;
    if (i === inWindow.length - 1 && sents.indexOf(s) < sents.length - 1) text = `${text} …`;
    out.push({ text, hit: expressesChange(s.text) });
  });
  return out.length ? out : null;
}

// Sentence-level delta for the compare view: which parts of the new telling
// the existing card does NOT already cover. Cheap token-coverage test, no
// model call — the point is to make the question answerable in seconds, not
// to be a diff engine.
function deltaSentences(candidate: string, existing: string): Array<{ text: string; novel: boolean }> {
  const sentences = String(candidate ?? '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const existingTokens = new Set(
    String(existing ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 3),
  );
  return sentences.map((text) => {
    const tokens = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length > 3);
    if (tokens.length === 0) return { text, novel: false };
    const hit = tokens.filter((t) => existingTokens.has(t)).length;
    return { text, novel: hit / tokens.length < 0.55 };
  });
}

// Exported for the cowork window (widgets/FdxCoworkControl): the .fdx
// cowork's own docket renders the SAME rows with the same grammar, so a
// question reads identically wherever the writer meets it.
export function StagedRow({
  row,
  expanded,
  onToggle,
  onAnswer,
  onOpenCard,
  onPlaceDragStart,
  onPlaceDragEnd,
  onConfirmSlot,
  sourceProse,
  dark,
}: {
  row: StagedStripRow;
  expanded: boolean;
  onToggle: () => void;
  onAnswer: (answer: 'merge' | 'keep' | 'convert' | 'replace') => void;
  onOpenCard: (cardId: string) => void;
  /** Spine drop: dragging an unplaced row opens the placement grid; its
   *  gutters are the drop slots. Fired deferred (see handler). */
  onPlaceDragStart?: () => void;
  onPlaceDragEnd?: () => void;
  /** Order ask: confirm the slot the live member currently renders in. */
  onConfirmSlot?: () => void;
  /** The source braindump's full prose, for the "In your words" pin. */
  sourceProse?: string;
  dark: boolean;
}) {
  // A STORY row (the story's own list: format, setting, period) shares the
  // character rows' grammar: a live thing, its current words, the proposed
  // words, replace or keep. So it rides the same branch.
  const isStory = row.kind === 'story';
  const isCharacter = row.kind === 'character' || isStory;
  const isRename = row.questionType === 'character_rename';
  const tick = isStory ? BD_ORANGE : getEntityColor(row.kind === 'character' ? 'character' : row.kind === 'section' ? 'sequence' : 'event');
  const kindTag = isStory ? 'STORY' : isCharacter ? 'CHAR' : row.kind === 'section' ? 'SEQ' : 'SC';
  const quiet = dark ? '#82828c' : '#999';
  const ink = dark ? '#dcdce2' : '#2a2a30';
  const hair = dark ? '#2a2a30' : '#ececf0';

  // The model's stated reason, collapsed behind a "Why" toggle (the peer
  // card's rationale grammar). Re-collapses when the row closes.
  const [showWhy, setShowWhy] = useState(false);
  useEffect(() => { if (!expanded) setShowWhy(false); }, [expanded]);

  // v1 scope: scenes drag onto the grid; a sequence's seams are different
  // furniture (chips/boundaries only), so section rows keep the button path.
  // Order asks (confirmable, the card is already in the story) carry no drag
  // furniture at all (Ben 2026-09-02).
  const canDragPlace = row.questionType === 'unplaced' && row.kind === 'scene' && !!onPlaceDragStart && !row.confirmable;
  const dragHandlers = canDragPlace
    ? {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.setData('text/plain', row.cardId);
          e.dataTransfer.effectAllowed = 'move';
          // Deferred: hiding the panel synchronously inside dragstart makes
          // Chrome cancel the drag (source element vanished).
          window.setTimeout(() => onPlaceDragStart!(), 0);
        },
        onDragEnd: () => onPlaceDragEnd?.(),
      }
    : {};

  // The header NAMES THE DECISION (Ben 2026-08-22): a short fixed label the
  // writer recognizes at a glance, open or closed. The card title is the
  // subheader; the other card involved is named inside the body.
  const ask = isStory
    ? 'Update the story?'
    : isRename
    ? 'Rename the character?'
    : isCharacter
      ? 'Update the character?'
      : row.questionType === 'altitude'
    ? 'Scene or sequence?'
    : row.questionType === 'retelling'
      ? 'Update the card?'
      : row.questionType === 'merge_suggestion' || row.questionType === 'compare'
        ? 'Merge or keep both?'
        : 'Where does it go?';

  if (!expanded) {
    return (
      <button
        onClick={onToggle}
        {...dragHandlers}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%',
          padding: '8px 2px', background: 'transparent', border: 'none',
          borderBottom: `1px solid ${hair}`, cursor: 'pointer', textAlign: 'left',
          fontFamily: 'inherit',
        }}
      >
        <span style={{ width: 3, alignSelf: 'stretch', minHeight: 30, background: tick, borderRadius: 1, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{
            fontSize: 12.5, fontWeight: 600, color: ink, lineHeight: 1.3,
            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}>
            {ask}
          </span>
          <span style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 12, color: quiet, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <span style={{ fontFamily: 'inherit', fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', marginRight: 6 }}>{kindTag}</span>
            {row.title}
          </span>
        </span>
        <span style={{ fontSize: 11, color: quiet, flexShrink: 0 }}>›</span>
      </button>
    );
  }

  const delta = row.target ? deltaSentences(row.summary, row.target.summary) : null;
  const novel = delta ? delta.filter((s) => s.novel).map((s) => s.text) : [];
  // Anchor on the changed material when there is any (that's what the writer
  // judges); fall back to the summary to find the card's neighborhood. Only
  // an excerpt that actually illustrates the model's claimed change replaces
  // the paraphrase (compare rows only; unplaced rows show their summary).
  const isAltitude = row.questionType === 'altitude';
  const isRetelling = row.questionType === 'retelling';
  const excerpt = isAltitude || isRetelling || isCharacter
    ? null // the altitude row shows the summary, not a prose pin
    : row.target
      ? braindumpExcerpt(
          sourceProse,
          row.evidenceQuote,
          novel.length ? novel.join(' ') : row.summary,
          novel.join(' '),
        )
      : null;
  const excerptHasHit = !!excerpt?.some((s) => s.hit);
  const btnBase: React.CSSProperties = {
    fontSize: 11.5, fontWeight: 600, borderRadius: 6, padding: '6px 12px',
    cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
  };

  // WHAT THIS QUESTION IS (Ben 2026-09-02): the strip's question types read
  // as synonyms without help - "Merge" and "Replace the telling" are
  // different questions (two cards vs one card's wording) that arrive
  // through a title-match filter no writer can see. The header 'i' explains
  // the situation; each button explains its exact consequence on hover.
  const headerInfo = (() => {
    switch (row.questionType) {
      case 'story_fact':
        return 'Your braindump describes this story differently from what is on its list. The list only changes if you say so.';
      case 'character_description':
        return 'Your braindump said something new about this character. Anything it added to their traits is already on the card; the description only changes if you say so.';
      case 'character_rename':
        return 'Your braindump called this character by a new name. Both names already find them, so nothing is duplicated; the name shown on the card only changes if you say so.';
      case 'merge_suggestion':
      case 'compare':
        return 'This new card looks like a beat already on the board, so it waits here instead of duplicating it. Merge the new information into the existing card, or keep both as separate beats.';
      case 'retelling':
        return 'This scene was told again under its exact title. No new card was made; only the card\u2019s summary is in question.';
      case 'altitude':
        return row.held
          ? 'This beat could be one scene or a section covering several. It waits here until you decide; either answer puts it on the board.'
          : 'This beat could be one scene or a section covering several. It is already on the board in story order; answering settles what kind of card it is.';
      case 'unplaced':
        return row.confirmable
          ? 'This scene landed in its sequence, but its order among the other scenes is not settled. Confirm the slot shown, or pick another.'
          : 'Nothing in the braindump said where this belongs, so it waits here instead of landing somewhere arbitrary.';
      default:
        return '';
    }
  })();

  return (
    <article
      {...dragHandlers}
      style={{
        border: `1px solid ${hexToRgba(BD_ORANGE, dark ? 0.45 : 0.35)}`, borderRadius: 8, margin: '6px 0 10px',
        // Light mode: cream, the board's own paper, not UI grey.
        background: dark ? '#202024' : '#fdfaf3', overflow: 'hidden',
      }}
    >
      <button
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%',
          padding: '9px 12px', background: dark ? '#26262b' : '#f6efe1',
          border: 'none', borderBottom: `1px solid ${hair}`, cursor: 'pointer',
          textAlign: 'left', fontFamily: 'inherit',
        }}
      >
        <span style={{ width: 3, height: 34, background: tick, borderRadius: 1, flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {/* Same shape open or closed: the QUESTION is the header, the card
              is the subheader (Ben 2026-08-22). */}
          <span style={{ fontSize: 13, fontWeight: 700, color: BD_ORANGE, lineHeight: 1.3, display: 'flex', alignItems: 'center', gap: 6 }}>
            {ask}
            {headerInfo && <InfoHint text={headerInfo} dark={dark} accent={BD_ORANGE} inline prominent />}
          </span>
          <span style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 12.5, color: ink, lineHeight: 1.35 }}>
            <span style={{ fontFamily: 'system-ui, sans-serif', fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase', color: quiet, marginRight: 6 }}>{kindTag}</span>
            {row.title}
          </span>
        </span>
        <span style={{ fontSize: 11, color: quiet, transform: 'rotate(90deg)', flexShrink: 0 }}>›</span>
      </button>

      <div style={{ padding: '10px 12px 12px' }}>
        {isCharacter ? (
          <>
            {/* A braindump changed what is known about a character who is
                already on the board. Same grammar as the re-telling question:
                the card is LIVE and untouched, both versions are shown whole,
                and the writer picks. */}
            <div style={{ fontSize: 12, color: dark ? '#c9c9d2' : '#444', lineHeight: 1.55 }}>
              {isStory
                ? 'Your braindump describes this differently from what the story has on its list. Update it, or keep what is there.'
                : isRename
                ? 'Your braindump gives this character a new name. Rename the card, or keep the name it has.'
                : 'Your braindump says something new about this character. Add it to the description, or keep the description as it is.'}
              {row.characterId && (
                <>
                  {' '}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenCard(row.characterId!)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenCard(row.characterId!); }}
                    style={{
                      cursor: 'pointer', fontWeight: 600, color: ink,
                      textDecoration: 'underline', textDecorationColor: hexToRgba(BD_ORANGE, 0.5), textUnderlineOffset: 2,
                    }}
                  >Open the card</span>.
                </>
              )}
            </div>
            <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#d6d6dc' : '#3a3a42', fontWeight: 700, margin: '12px 0 5px' }}>
              {isStory ? 'On the list now' : 'On the card now'}
            </div>
            <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: isRename ? 14 : 12.5, lineHeight: 1.55, color: quiet, borderLeft: `2px solid ${hair}`, paddingLeft: 10 }}>
              {isRename ? row.title : (row.summary || <span style={{ color: quiet }}>No description yet.</span>)}
            </div>
            <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#d6d6dc' : '#3a3a42', fontWeight: 700, margin: '12px 0 5px' }}>
              From your braindump
            </div>
            <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: isRename ? 14 : 12.5, lineHeight: 1.55, color: ink, borderLeft: `2px solid ${BD_ORANGE}`, paddingLeft: 10 }}>
              {isRename
                ? (row.proposedName || <span style={{ color: quiet }}>No new name.</span>)
                : (row.proposedSummary || <span style={{ color: quiet }}>No new version.</span>)}
            </div>
          </>
        ) : isRetelling ? (
          <>
            {/* FIL-583 — the re-telling question. The card is LIVE and kept
                its current telling; the braindump proposed another. Both are
                shown in full: this is a choice between two versions of prose
                the writer wrote, not a diff to decode. */}
            <div style={{ fontSize: 12, color: dark ? '#c9c9d2' : '#444', lineHeight: 1.55 }}>
              Your pages tell this beat differently from the card. Update the card to match, or keep it as it is.
            </div>
            <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#d6d6dc' : '#3a3a42', fontWeight: 700, margin: '12px 0 5px' }}>
              On the card now
            </div>
            <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 12.5, lineHeight: 1.55, color: quiet, borderLeft: `2px solid ${hair}`, paddingLeft: 10 }}>
              {row.summary || <span style={{ color: quiet }}>No summary.</span>}
            </div>
            <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#d6d6dc' : '#3a3a42', fontWeight: 700, margin: '12px 0 5px' }}>
              {row.fromScript ? 'From your pages' : 'From your braindump'}
            </div>
            <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 12.5, lineHeight: 1.55, color: ink, borderLeft: `2px solid ${BD_ORANGE}`, paddingLeft: 10 }}>
              {row.proposedSummary || <span style={{ color: quiet }}>No new version.</span>}
            </div>
          </>
        ) : isAltitude ? (
          <>
            {/* The altitude question. THE FLIP (2026-09-01): positioned
                sections land LIVE with the question riding, so the live copy
                is the norm and cannot claim member scenes; held rows are the
                unanchored remainder. The summary is the material; no prose
                pin here (Ben: the quote is noise for this question). */}
            <div style={{ fontSize: 12, color: dark ? '#c9c9d2' : '#444', lineHeight: 1.55 }}>
              Is this meant to be a <b style={{ color: ink }}>single scene</b>, one dramatized moment the audience watches play out, or a <b style={{ color: ink }}>sequence</b>, a section of the story that covers several scenes?
              {row.held
                ? <> It is held here as a <b style={{ color: ink }}>{row.kind === 'section' ? 'sequence' : 'scene'}</b> until you decide; either answer puts it on the board.</>
                : <> It is already on the board as a <b style={{ color: ink }}>{row.kind === 'section' ? 'sequence' : 'scene'}</b>, in story order; keep it, or convert it.</>}
            </div>
            <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 12.5, lineHeight: 1.55, color: ink, marginTop: 10 }}>
              {row.summary || <span style={{ color: quiet }}>No summary.</span>}
            </div>
          </>
        ) : row.target && row.questionType !== 'unplaced' ? (
          // (unplaced rows persisted before 2026-09-02 can carry a stale
          // target_vid; an order ask must never render merge furniture.)
          <>
            {/* The question, in one line, pointing at the board. */}
            <div style={{ fontSize: 12, color: dark ? '#c9c9d2' : '#444', lineHeight: 1.55 }}>
              {row.fromScript
                ? 'These pages tell the same beat as '
                : row.questionType === 'merge_suggestion' ? 'Looks like the same beat as ' : 'May be a re-telling of '}
              {/* A span, not a button: it has to wrap like running text so the
                  sentence stays one sentence. */}
              <span
                role="button"
                tabIndex={0}
                onClick={() => onOpenCard(row.target!.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpenCard(row.target!.id); }}
                style={{
                  cursor: 'pointer', fontWeight: 600, color: ink,
                  textDecoration: 'underline', textDecorationColor: hexToRgba(BD_ORANGE, 0.5), textUnderlineOffset: 2,
                }}
              >{row.target.title}</span>.
            </div>

            {/* What this telling CHANGES ("changes", not "adds": a re-telling
                can also negate or remove). ONE section, in the writer's OWN
                words: the dump excerpt with the changed sentences highlighted
                and the overlapping wording as quiet context. The model's
                paraphrase renders only when there is no prose to quote. */}
            <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: dark ? '#d6d6dc' : '#3a3a42', fontWeight: 700, margin: '14px 0 5px' }}>
              {excerptHasHit || novel.length
                ? (row.fromScript ? 'What your pages change' : 'What your braindump changes')
                : 'Nothing new in the wording'}
            </div>
            {excerptHasHit ? (
              <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 12.5, lineHeight: 1.6, color: quiet, borderLeft: `2px solid ${BD_ORANGE}`, paddingLeft: 10 }}>
                {excerpt!.map((seg, i) => (
                  <React.Fragment key={i}>
                    {i > 0 ? ' ' : ''}
                    {seg.hit ? (
                      <span style={{
                        color: ink,
                        background: hexToRgba(BD_ORANGE, dark ? 0.18 : 0.15),
                        borderRadius: 3, padding: '0 2px',
                      }}>
                        {seg.text}
                      </span>
                    ) : (
                      seg.text
                    )}
                  </React.Fragment>
                ))}
              </div>
            ) : novel.length > 0 ? (
              <div style={{ fontFamily: NOTE_FONT_SERIF, fontStyle: 'italic', fontSize: 12.5, lineHeight: 1.55, color: ink, borderLeft: `2px solid ${BD_ORANGE}`, paddingLeft: 10 }}>
                “{novel.join(' ')}”
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: quiet, lineHeight: 1.5 }}>
                The summary re-covers what the existing card already says.
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontSize: 9.5, letterSpacing: 0.5, textTransform: 'uppercase', color: quiet, marginBottom: 4 }}>
              New card, unplaced
            </div>
            <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 12.5, lineHeight: 1.55, color: ink }}>
              {row.summary || <span style={{ color: quiet }}>No summary.</span>}
            </div>
          </>
        )}

        {row.reason && (
          <>
            {/* Pill + chevron so it reads as a CONTROL, not another subheading. */}
            <button
              onClick={() => setShowWhy((s) => !s)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10,
                background: 'transparent',
                border: `1px solid ${dark ? '#3a3a42' : '#ddd'}`,
                borderRadius: 999, padding: '2.5px 10px',
                color: quiet, fontSize: 10.5, fontWeight: 600, cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 8, transform: showWhy ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', display: 'inline-block' }}>▸</span>
              {showWhy ? 'Hide why' : 'Why'}
            </button>
            {showWhy && (
              <div style={{ fontSize: 11, fontStyle: 'italic', color: quiet, lineHeight: 1.5, marginTop: 4 }}>
                {row.reason}
              </div>
            )}
          </>
        )}

        {/* Action rail: one imperative primary; collapsing the row IS "keep
            it aside", so no third button. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap', rowGap: 6 }}>
          {isCharacter ? (
            <>
              <HoverTip dark={dark} tip={isStory
                ? 'Replace this entry on the story\u2019s list with what your braindump says. The old wording is kept so it can be restored.'
                : isRename
                ? 'Rename the card. The old name is kept as an alias, so anything you wrote under it still finds this character.'
                : 'Replace the description with the version shown above. Nothing else about the card changes.'}>
                <button
                  onClick={() => onAnswer('replace')}
                  style={{ ...btnBase, background: BD_ORANGE, color: '#fff', border: 'none' }}
                >
                  {isStory ? 'Update' : isRename ? 'Rename' : 'Update description'}
                </button>
              </HoverTip>
              <HoverTip dark={dark} tip={isRename
                ? 'Keep the name on the card. The new name still finds this character.'
                : 'Keep the description as it is.'}>
                <button
                  onClick={() => onAnswer('keep')}
                  style={{
                    ...btnBase, background: 'transparent', color: quiet,
                    border: `1px solid ${dark ? '#3a3a42' : '#ddd'}`, fontWeight: 500,
                  }}
                >
                  {isRename ? 'Keep the name' : 'Keep mine'}
                </button>
              </HoverTip>
            </>
          ) : isRetelling ? (
            <>
              <HoverTip dark={dark} tip="Rewrite this card's summary to match what you wrote. Nothing else about the card changes.">
                <button
                  onClick={() => onAnswer('replace')}
                  style={{ ...btnBase, background: BD_ORANGE, color: '#fff', border: 'none' }}
                >
                  Update card
                </button>
              </HoverTip>
              <HoverTip dark={dark} tip="Keep the card's current summary as it is.">
                <button
                  onClick={() => onAnswer('keep')}
                  style={{
                    ...btnBase, background: 'transparent', color: quiet,
                    border: `1px solid ${dark ? '#3a3a42' : '#ddd'}`, fontWeight: 500,
                  }}
                >
                  Keep mine
                </button>
              </HoverTip>
            </>
          ) : isAltitude ? (
            <>
              <HoverTip dark={dark} tip={row.kind === 'section'
                ? 'Confirm this as a sequence, a section that can hold scenes.'
                : 'Confirm this as a single scene.'}>
                <button
                  onClick={() => onAnswer('keep')}
                  style={{ ...btnBase, background: BD_ORANGE, color: '#fff', border: 'none' }}
                >
                  {row.kind === 'section' ? 'Keep as sequence' : 'Keep as scene'}
                </button>
              </HoverTip>
              <HoverTip dark={dark} tip={row.kind === 'section'
                ? 'Change to a single scene. Connected scenes merge into it.'
                : 'Change to a sequence, ready to hold scenes.'}>
                <button
                  onClick={() => onAnswer('convert')}
                  style={{
                    ...btnBase, background: 'transparent', color: BD_ORANGE,
                    border: `1px solid ${hexToRgba(BD_ORANGE, 0.6)}`, fontWeight: 600,
                  }}
                >
                  {row.kind === 'section' ? 'Make it a scene' : 'Make it a sequence'}
                </button>
              </HoverTip>
            </>
          ) : row.target && row.questionType !== 'unplaced' ? (
            // (same stale-target guard as the body: an order ask never
            // offers a merge.)
            <>
              <HoverTip dark={dark} tip="Fold this card into the existing one. Connections move over, the title becomes an alias, and the duplicate is removed. The existing card's text stays.">
                <button
                  onClick={() => onAnswer('merge')}
                  style={{ ...btnBase, background: BD_ORANGE, color: '#fff', border: 'none' }}
                >
                  Merge into existing
                </button>
              </HoverTip>
              <HoverTip dark={dark} tip="Keep them as two separate beats. The pair is remembered as different and won't be suggested again.">
                <button
                  onClick={() => onAnswer('keep')}
                  style={{
                    ...btnBase, background: 'transparent', color: quiet,
                    border: `1px solid ${dark ? '#3a3a42' : '#ddd'}`, fontWeight: 500,
                  }}
                >
                  Keep both
                </button>
              </HoverTip>
            </>
          ) : row.confirmable && onConfirmSlot ? (
            <>
              {/* Order ask on a live member (Ben 2026-09-02): the card is
                  already showing at a default slot in its section, so the
                  PRIMARY answer confirms that slot - it writes the chain
                  edge the display implies. Re-order opens the same
                  tap-to-place wall for a different slot. No drag furniture
                  here (Ben: "drag it into the story doesn't really make
                  sense" for a card that is already in the story). */}
              <HoverTip dark={dark} tip="Accept the current scene order.">
                <button
                  onClick={() => onConfirmSlot!()}
                  style={{ ...btnBase, background: BD_ORANGE, color: '#fff', border: 'none' }}
                >
                  Confirm order
                </button>
              </HoverTip>
              {onPlaceDragStart && (
                <HoverTip dark={dark} tip="Open the board and tap the slot where this scene belongs instead.">
                  <button
                    onClick={() => onPlaceDragStart!()}
                    style={{
                      ...btnBase, background: 'transparent', color: quiet,
                      border: `1px solid ${dark ? '#3a3a42' : '#ddd'}`, fontWeight: 500,
                    }}
                  >
                    Re-order
                  </button>
                </HoverTip>
              )}
            </>
          ) : onPlaceDragStart ? (
            <>
              {/* "Add to board" used to answer keep — the card just landed
                  somewhere with no say in where (Ben 2026-08-31: "it just
                  drops it into the board"). The button now enters the same
                  tap-to-place wall the drag opens: the writer taps a gap, a
                  card, or a sequence. SECTIONS too (the v1 drag cut applied
                  to drag furniture only; taps work for both kinds — the wall
                  swaps to chain semantics for a section). Collapsing the row
                  stays "not now". */}
              <HoverTip dark={dark} tip="Open the board and tap a gap, card, or sequence to set where this lands.">
                <button
                  onClick={() => onPlaceDragStart!()}
                  style={{ ...btnBase, background: BD_ORANGE, color: '#fff', border: 'none' }}
                >
                  Place on the board
                </button>
              </HoverTip>
              {/* No blind-add (Ben 2026-08-31): an unplaced row's whole
                  question is WHERE, so the answers are a place or "later" —
                  a card the writer wants loose simply stays in the strip. */}
            </>
          ) : (
            <HoverTip dark={dark} tip="Put the card on the board as it is, with no connections. You can place or link it later.">
              <button
                onClick={() => onAnswer('keep')}
                style={{ ...btnBase, background: BD_ORANGE, color: '#fff', border: 'none' }}
              >
                Add to board
              </button>
            </HoverTip>
          )}
          <span style={{ fontSize: 10.5, color: quiet, marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            {canDragPlace ? 'drag it into the story, or leave it here' : 'or leave it for later'}
          </span>
        </div>
      </div>
    </article>
  );
}

// HoverTip: wraps a strip action button; hovering reveals a popover that
// spells out exactly what pressing it will do (Ben 2026-09-02: the strip's
// verbs are load-bearing and read as synonyms without this). Same glassy
// panel as InfoHint's tooltip; opens UPWARD so the row's bottom edge never
// clips it.
function HoverTip({ tip, dark, children }: { tip: string; dark: boolean; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div
          style={{
            position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, width: 236,
            padding: '0.55rem 0.7rem', zIndex: 250, pointerEvents: 'none',
            background: dark ? 'rgba(20, 20, 26, 0.98)' : 'rgba(255, 255, 255, 0.99)',
            border: `1px solid ${hexToRgba(BD_ORANGE, 0.55)}`,
            borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
            font: '400 11px/1.5 system-ui', color: dark ? '#c9c9d2' : '#444',
            whiteSpace: 'normal',
          }}
        >
          {tip}
        </div>
      )}
    </div>
  );
}

// InfoHint: a small "i" affordance on a panel-section header that reveals an
// explanatory tooltip on hover. Tooltip styling is lifted from the canvas
// floating-button tooltips (CanvasToolbar.tsx): glassy dark panel, 8px radius,
// 11px copy, soft shadow. Theme-aware so light mode isn't black-on-white.
function InfoHint({ text, dark, accent, inline, prominent }: { text: string; dark: boolean; accent: string; inline?: boolean; prominent?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div
      style={{ position: 'relative', flexShrink: 0, display: 'flex', alignItems: 'center', marginRight: inline ? 0 : 16 }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        aria-label="About this section"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 15, height: 15, borderRadius: '50%', boxSizing: 'border-box',
          border: `1px solid ${show || prominent ? accent : dark ? '#4a4a52' : '#ccc'}`,
          color: show || prominent ? accent : dark ? '#82828c' : '#999',
          fontSize: 9.5, fontWeight: 700, fontStyle: 'italic',
          fontFamily: 'Georgia, "Times New Roman", serif', lineHeight: 1,
          cursor: 'help', transition: 'color 120ms, border-color 120ms',
        }}
      >
        i
      </span>
      {show && (
        <div
          style={{
            // Inline hints (strip row headers) sit near the LEFT edge, so
            // their tooltip opens rightward; the right-edge section-header
            // hints keep the leftward opening.
            position: 'absolute', top: '100%', ...(inline ? { left: 0 } : { right: 0 }), marginTop: 8,
            padding: '0.6rem 0.75rem',
            background: dark ? 'rgba(20, 20, 26, 0.98)' : 'rgba(255, 255, 255, 0.99)',
            border: `1px solid ${hexToRgba(accent, 0.55)}`,
            borderRadius: 8, fontSize: 11,
            color: dark ? 'rgba(255, 255, 255, 0.7)' : '#555',
            width: 230, lineHeight: 1.5,
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
            pointerEvents: 'none', zIndex: 20,
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

export function RightPanel({
  information,
  suggestions,
  staged,
  arcs,
  locations,
  occursIn,
  signals,
  entities,
  auth,
  projectId,
  onAcceptSuggestion,
  onDismissSuggestion,
  onAnswerStaged,
  onStagedSpotlight,
  onPlaceDragStart,
  onPlaceDragEnd,
  onConfirmSlot,
  hidden,
  onOpenCard,
  onEntitiesChanged,
  onClose,
  openSection,
}: {
  information: ProjectInformation[];
  suggestions: ArcSuggestion[];
  /** The staging strip's rows (Placement Control v1b). */
  staged: StagedStripRow[];
  onAnswerStaged: (cardId: string, answer: 'merge' | 'keep' | 'convert' | 'replace') => void;
  /** Expanding a strip row spotlights its target on the canvas; (null, null)
   *  lifts it. The existing card is shown by being the existing card. */
  onStagedSpotlight: (cardId: string | null, targetId: string | null) => void;
  /** Spine drop: an unplaced row's drag began/ended. The corkboard hides this
   *  panel and mounts the placement grid as the drop surface. */
  onPlaceDragStart?: (cardId: string) => void;
  onPlaceDragEnd?: () => void;
  /** Order ask: confirm the slot a live member scene currently renders in. */
  onConfirmSlot?: (cardId: string) => void;
  /** Kept MOUNTED but invisible while the drag is live: unmounting the drag
   *  source mid-drag swallows dragend in Chrome. */
  hidden?: boolean;
  arcs: ProjectEntity[];
  locations: ProjectEntity[];
  /** Event → Location edges, for per-location scene counts. */
  occursIn: Array<{ from: string; to: string }>;
  signals: Record<string, CardSignal>;
  entities: ProjectEntity[];
  auth: { userId: string; token: string } | null;
  projectId: string;
  onAcceptSuggestion: (suggestionId: string) => void;
  onDismissSuggestion: (suggestionId: string) => void;
  onOpenCard: (cardId: string) => void;
  onEntitiesChanged: () => void;
  onClose: () => void;
  /** When set, force-expand this section (e.g. the wow tour bringing the
   *  Information section open as it walks to it). */
  openSection?: string | null;
}) {
  const dark = useThemeMode() === 'dark';
  useEffect(() => {
    // While hidden (a spine drop is mid-drag) Esc belongs to the drag/grid.
    if (hidden) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hidden]);

  // OUTSIDE-CLICK CLOSE, MINUS THE TOOLBAR (2026-08-30). This used to be an
  // onClick on the scrim, which is inset:0 and therefore covers the TOOLBAR
  // as well as the board: every toolbar click landed on the backdrop and
  // closed the panel instead of doing what the button said. Since a braindump
  // that stages something opens this panel by itself, the writer's next
  // toolbar click was being eaten, which reads as "the panel slams shut when
  // I try to open it".
  //
  // Capture phase, and it swallows the event it acts on, so a click outside
  // still ONLY closes the panel (it does not also land on the card beneath).
  // The toolbar and the drawer are both exempt: the toolbar keeps its own
  // clicks, and the drawer handles its own.
  useEffect(() => {
    if (hidden) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('[data-panel-drawer]')) return;
      if (t.closest('[data-corkboard-toolbar]')) return;
      // The braindump dock hangs BELOW the toolbar as its own element, and it
      // is where the placement chips live. Eating a click there is how the
      // keep-aside intent got lost on a live seed run (2026-08-30): a staged
      // question auto-opens this panel, the panel's scrim covered the dock,
      // and the writer's tap on "keep aside" closed the panel instead of
      // lighting the chip, so the dump went out as auto.
      if (t.closest('[data-tour="braindump-dock"]')) return;
      // The first-run tour's coachmark floats over the board while this panel
      // is open (steps that explain the panel). A press on its Next button
      // closed the panel instead of advancing, and the step then hung on a
      // vanished target (Ben, 2026-09-13: "steps 6 and 7 show twice").
      if (t.closest('[data-tour-ui]')) return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose, hidden]);

  // Per-section collapse state. QUESTIONS FIRST (Ben 2026-08-22): while the
  // strip has rows it is open with the first question already expanded and
  // Arc suggestions stay collapsed; with nothing to confirm, suggestions open.
  const [open, setOpen] = useState<Record<string, boolean>>({ suggestions: staged.length === 0, staged: true });
  // One strip row expanded at a time (docket grammar).
  const [expandedStagedId, setExpandedStagedId] = useState<string | null>(staged[0]?.cardId ?? null);
  // AUTO-PICKS RE-EVALUATE UNTIL THE WRITER CHOOSES (2026-09-01). The panel
  // often mounts a beat before the server's question rows land, so its first
  // render holds only the union-synthesized row for a held card; the old
  // keep-current rule then locked the expansion onto it forever, and the
  // strip 'always opened on the second question' once the real first row
  // arrived. The writer's own toggle (or the docket advance) pins the pick;
  // list-composition changes before that re-point it at the first row.
  const userPickedRef = React.useRef(false);
  const hadRowsRef = React.useRef(staged.length > 0);
  useEffect(() => {
    const has = staged.length > 0;
    if (has && !hadRowsRef.current) {
      setOpen((o) => ({ ...o, staged: true, suggestions: false }));
    }
    if (has && !userPickedRef.current) {
      setExpandedStagedId((cur) => (cur === staged[0].cardId ? cur : staged[0].cardId));
    }
    hadRowsRef.current = has;
  }, [staged]);
  // Docket flow: answering a row advances to the next pending one.
  const answerAndAdvance = (cardId: string, answer: 'merge' | 'keep' | 'convert' | 'replace') => {
    userPickedRef.current = true; // the docket owns the expansion from here
    const i = staged.findIndex((r) => r.cardId === cardId);
    const next = staged.find((r, j) => j > i && r.cardId !== cardId) ?? staged.find((r) => r.cardId !== cardId) ?? null;
    setExpandedStagedId(next ? next.cardId : null);
    onAnswerStaged(cardId, answer);
  };
  // Altitude rows on LIVE cards focus THEMSELVES (Ben 2026-08-31): "scene or
  // sequence?" is a question about the card's own shape — whether this
  // section already holds scenes is exactly what the writer needs to SEE
  // before answering, and the wall morph centered on the card shows it (a
  // sequence focuses as its draped region with its member cells inside).
  // Held cards are not on the wall, so they keep the no-focus behavior.
  const expandedRowForSpot = expandedStagedId
    ? staged.find((r) => r.cardId === expandedStagedId)
    : undefined;
  const expandedTargetId = expandedRowForSpot
    ? (expandedRowForSpot.target?.id
        // Live-card asks focus THEMSELVES: altitude questions riding a
        // positioned section, and order asks on a member scene that landed
        // inside a section unordered (Ben 2026-09-02). Held cards are not on
        // the wall, so they keep the no-focus behavior.
        ?? ((expandedRowForSpot.questionType === 'altitude' || expandedRowForSpot.questionType === 'unplaced')
            && !expandedRowForSpot.held
          ? expandedRowForSpot.cardId
          : null))
    : null;
  useEffect(() => {
    onStagedSpotlight(expandedStagedId && expandedTargetId ? expandedStagedId : null, expandedTargetId);
  }, [expandedStagedId, expandedTargetId, onStagedSpotlight]);
  // Lift the spotlight when the panel unmounts (closes). Ref-held so the
  // cleanup runs once on unmount, not on every callback identity change.
  const spotlightRef = React.useRef(onStagedSpotlight);
  useEffect(() => { spotlightRef.current = onStagedSpotlight; }, [onStagedSpotlight]);
  useEffect(() => () => spotlightRef.current(null, null), []);
  const spotlightLive = !!(expandedStagedId && expandedTargetId);
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  // Force-expand a section on request (the wow tour expands Information as it
  // walks to it). One-shot per value change; the writer can collapse it after.
  useEffect(() => {
    if (openSection) setOpen((o) => ({ ...o, [openSection]: true }));
  }, [openSection]);

  // Braindumps log — fetched once when the panel opens. Read-only history of
  // every extraction source (braindumps + committed peer responses).
  const [braindumps, setBraindumps] = useState<BraindumpLogEntry[] | null>(null);
  useEffect(() => {
    if (!auth || !projectId) return;
    let cancelled = false;
    listBraindumps({ projectId }, auth.token)
      // Scratch generations (script editor tail extractions) are provenance,
      // not writer braindumps — keep this log to true braindumps.
      .then((res) => { if (!cancelled) setBraindumps(res.braindumps.filter((b) => !b.braindumpId.startsWith('scratch_'))); })
      .catch((err) => {
        console.warn('[panel] list-braindumps failed', err);
        if (!cancelled) setBraindumps([]);
      });
    return () => { cancelled = true; };
  }, [auth, projectId]);

  const arcColor = getEntityColor('arc');
  const nameOf = (id: string) => {
    const e = entities.find((x) => x.id === id);
    return e?.working_title ?? e?.working_name ?? 'a scene';
  };

  const section = (id: string, label: string, count: number, accent: string, body: React.ReactNode, hint?: string) => {
    const isOpen = !!open[id];
    return (
      <div data-tour={`panel-${id}`} style={{ borderBottom: dark ? '1px solid #26262b' : '1px solid #f0f0f0' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            onClick={() => toggle(id)}
            style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8,
              padding: '13px 18px', background: 'transparent', border: 'none',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
            }}
          >
            <span style={{ fontSize: 10, color: dark ? '#63636d' : '#bbb', width: 10 }}>{isOpen ? '▾' : '▸'}</span>
            <span style={{ fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: accent, fontWeight: 700 }}>{label}</span>
            <span style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa' }}>{count}</span>
          </button>
          {hint && <InfoHint text={hint} dark={dark} accent={accent} />}
        </div>
        {isOpen && <div style={{ padding: '0 18px 14px' }}>{body}</div>}
      </div>
    );
  };

  const empty = (text: string) => (
    <div style={{ fontSize: 12, color: dark ? '#6e6e78' : '#aaa', lineHeight: 1.5, padding: '4px 0 8px' }}>{text}</div>
  );

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 180,
        // Paints the scrim, takes no clicks — see the capture listener above.
        pointerEvents: 'none',
        // While a strip row is spotlighting its target, the board IS the
        // compare view: drop the drawer scrim so the ring + ghost read clearly.
        background: spotlightLive ? 'transparent' : 'rgba(20,20,20,0.28)',
        transition: 'background 200ms ease-out',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'flex-end',
        fontFamily: 'system-ui, sans-serif',
        // Spine drop mid-drag: invisible and untouchable, but still mounted
        // (the drag source must survive to deliver dragend).
        ...(hidden ? { visibility: 'hidden' as const, pointerEvents: 'none' as const } : {}),
      }}
    >
      <div data-panel-drawer style={{ width: 420, height: '100vh', background: dark ? '#1a1a1e' : '#fff', boxShadow: '-8px 0 28px rgba(0,0,0,0.14)', display: 'flex', flexDirection: 'column', pointerEvents: 'auto' }}>
        <div style={{ padding: '14px 18px', borderBottom: `3px solid ${INFO_ACCENT}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: dark ? '#dcdce2' : '#333' }}>Panel</span>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 18, color: dark ? '#82828c' : '#888', cursor: 'pointer', padding: 0 }} title="Close (Esc)">×</button>
        </div>

        <div className="cb-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {section('staged', 'Things to confirm from your last braindump', staged.length, BD_ORANGE,
            staged.length === 0
              ? empty('Nothing to confirm. When a braindump leaves something only you can settle (a possible re-telling, a scene that might be a sequence, a card with no obvious place), it lands here. There is no deadline.')
              : staged.map((row) => (
                  <StagedRow
                    key={row.cardId}
                    row={row}
                    expanded={expandedStagedId === row.cardId}
                    onToggle={() => { userPickedRef.current = true; setExpandedStagedId((cur) => (cur === row.cardId ? null : row.cardId)); }}
                    onAnswer={(answer) => answerAndAdvance(row.cardId, answer)}
                    onOpenCard={onOpenCard}
                    onPlaceDragStart={onPlaceDragStart ? () => onPlaceDragStart(row.cardId) : undefined}
                    onConfirmSlot={onConfirmSlot ? () => onConfirmSlot(row.cardId) : undefined}
                    onPlaceDragEnd={onPlaceDragEnd}
                    sourceProse={(
                      // Provenance chain: the row's own dump id, else the
                      // manual-creation provenance entry, whose id embeds the
                      // card's vid (seeded/manual cards point nowhere real).
                      braindumps?.find((b) => b.braindumpId === row.sourceBraindumpId)
                        ?? braindumps?.find((b) => b.braindumpId.includes(row.cardId))
                    )?.prose}
                    dark={dark}
                  />
                )),
            'Cards from your braindumps whose place in the story is a genuine question. They sit safely here — not on the board, not in the peer’s head — until you answer. There’s no deadline.',
          )}

          {section('suggestions', 'Arc suggestions', suggestions.length, arcColor,
            suggestions.length === 0
              ? empty('None right now. When a thematic thread recurs across braindumps it lands here — accept it as an Arc or dismiss.')
              : suggestions.map((sug) => (
                  <ArcSuggestionRow
                    key={sug.suggestionId}
                    suggestion={sug}
                    onAccept={() => onAcceptSuggestion(sug.suggestionId)}
                    onDismiss={() => onDismissSuggestion(sug.suggestionId)}
                  />
                )),
            'Recurring thematic threads the system spots across your braindumps. Accept one to turn it into an Arc card, or dismiss it so it won’t resurface.',
          )}

          {/* Everything below is REFERENCE (lookup), not things to act on. */}
          <div style={{ padding: '14px 18px 4px', fontSize: 9.5, letterSpacing: 0.8, textTransform: 'uppercase', color: dark ? '#55555e' : '#b5b5bd', fontWeight: 700 }}>
            Reference
          </div>
          {section('information', 'Information', information.length, INFO_ACCENT,
            information.length === 0
              ? empty("No facts yet. Information is extracted from braindumps + scenes — what's established and who knows it.")
              : information.map((info) => (
                  <InfoTile
                    key={info.id}
                    info={info}
                    scenes={info.established_in_event_ids.map((id) => ({ id, name: nameOf(id) }))}
                    onOpenScene={onOpenCard}
                    auth={auth}
                    projectId={projectId}
                    onChanged={onEntitiesChanged}
                  />
                )),
            'Facts established in the story and who knows them. Extracted from braindumps and scenes; edit or hard-delete a fact here.',
          )}

          {section('arcs', 'Arcs', arcs.length, arcColor,
            arcs.length === 0
              ? empty('No arcs yet. Create one from the canvas, or accept a suggestion above.')
              : arcs.map((arc) => (
                  <ArcTile
                    key={arc.id}
                    arc={arc}
                    statusLabel={signals[arc.id]?.arcStatusLabel}
                    accent={arcColor}
                    onOpenSheet={() => onOpenCard(arc.id)}
                  />
                )),
            'Every arc in the project, with its kind, derived status, and a jump to its full sheet. Arcs also appear on the canvas as threads woven through the scenes they evoke.',
          )}

          {section('locations', 'Locations', locations.length, getEntityColor('location'),
            locations.length === 0
              ? empty('No locations yet. They land from braindumps, or create one via + New.')
              : locations.map((loc) => (
                  <LocationTile
                    key={loc.id}
                    location={loc}
                    sceneCount={occursIn.filter((e) => e.to === loc.id).length}
                    onOpenSheet={() => onOpenCard(loc.id)}
                  />
                )),
            'Places scenes occur in, with how many scenes use each.',
          )}

          {section('braindumps', 'Braindumps', braindumps?.length ?? 0, '#8b8b96',
            braindumps === null
              ? empty('Loading…')
              : braindumps.length === 0
              ? empty('No braindumps yet — open the Braindump dock in the toolbar and process one.')
              : braindumps.map((bd) => <BraindumpRow key={bd.id} entry={bd} />),
            'A read-only log of every extraction source (braindumps and committed peer responses), newest first. Click an entry to expand its full text.',
          )}
        </div>
      </div>
    </div>
  );
}

export function LocationTile({
  location,
  sceneCount,
  onOpenSheet,
}: {
  location: ProjectEntity;
  sceneCount: number;
  onOpenSheet: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const accent = getEntityColor('location');
  const desc = (location.description ?? '').trim();
  return (
    <div style={{ border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: '10px 12px', marginBottom: 8, background: dark ? '#1a1a1e' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, color: dark ? '#e6e6ea' : '#222', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {location.working_name ?? location.id}
        </span>
        {location.int_ext && (
          <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 9, background: hexToRgba(accent, 0.12), color: accent, fontWeight: 700, letterSpacing: 0.4 }}>
            {String(location.int_ext).toUpperCase()}
          </span>
        )}
        <span style={{ fontSize: 10.5, color: dark ? '#787882' : '#999' }}>
          {sceneCount} scene{sceneCount === 1 ? '' : 's'}
        </span>
      </div>
      {desc && (
        <div style={{ fontSize: 11.5, color: dark ? '#8e8e98' : '#777', lineHeight: 1.45, marginTop: 5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {desc}
        </div>
      )}
      <button
        onClick={onOpenSheet}
        style={{ marginTop: 8, fontSize: 11, padding: '3px 9px', borderRadius: 4, border: `1px solid ${hexToRgba(accent, 0.4)}`, background: hexToRgba(accent, 0.06), color: accent, cursor: 'pointer', fontWeight: 600 }}
      >
        open full sheet ↗
      </button>
    </div>
  );
}

export function InfoTile({
  info,
  scenes,
  onOpenScene,
  auth,
  projectId,
  onChanged,
}: {
  info: ProjectInformation;
  scenes: { id: string; name: string }[];
  onOpenScene: (cardId: string) => void;
  auth: { userId: string; token: string } | null;
  projectId: string;
  onChanged: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const eventColor = getEntityColor('event');
  // Two-click delete: first click arms ("delete fact?"), second commits.
  // Hard delete — drops the fact AND its who-knows-it edges everywhere.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div style={{ border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderLeft: `3px solid ${INFO_ACCENT}`, borderRadius: 6, padding: '10px 12px', marginBottom: 8, background: dark ? '#1a1a1e' : '#fff', opacity: deleting ? 0.5 : 1 }}>
      <InlineText
        value={info.summary}
        onSave={async (d) => {
          if (!auth || !d.trim()) return;
          await updateInformation({ projectId, infoId: info.id, summary: d.trim() }, auth.token);
          onChanged();
        }}
        style={{ fontSize: 13, color: dark ? '#e6e6ea' : '#222', lineHeight: 1.45, fontWeight: 500 }}
      />
      {info.evidence_quote && (
        <blockquote style={{ margin: '6px 0 0', paddingLeft: 8, borderLeft: dark ? '2px solid #2a2a30' : '2px solid #eee', fontSize: 11, color: dark ? '#82828c' : '#888', fontStyle: 'italic', lineHeight: 1.45 }}>
          "{info.evidence_quote}"
        </blockquote>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 8 }}>
        {scenes.map((s) => (
          <button
            key={s.id}
            onClick={() => onOpenScene(s.id)}
            title="Open this scene"
            style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 10, border: `1px solid ${hexToRgba(eventColor, 0.4)}`, background: hexToRgba(eventColor, 0.08), color: eventColor, cursor: 'pointer', fontWeight: 600 }}
          >
            {s.name}
          </button>
        ))}
        {info.irony_hidden && (
          <span style={{ fontSize: 10, color: dark ? '#63636d' : '#bbb', fontStyle: 'italic' }}>flat · hidden from Knowledge</span>
        )}
        <button
          onClick={async () => {
            if (!confirmingDelete) { setConfirmingDelete(true); return; }
            if (!auth || deleting) return;
            setDeleting(true);
            try {
              await deleteInformation({ projectId, infoId: info.id }, auth.token);
              onChanged();
            } catch (e) {
              console.warn('[info-delete] failed', e);
              setDeleting(false);
              setConfirmingDelete(false);
            }
          }}
          onMouseLeave={() => { if (confirmingDelete && !deleting) setConfirmingDelete(false); }}
          title="Delete this fact everywhere — removes it from its scenes and clears who-knows-it"
          style={{
            marginLeft: 'auto', fontSize: 10.5, padding: '2px 8px', borderRadius: 4,
            border: confirmingDelete ? '1px solid #dc2626' : '1px solid transparent',
            background: confirmingDelete ? '#fbe9e9' : 'transparent',
            color: confirmingDelete ? '#dc2626' : '#bbb',
            cursor: deleting ? 'default' : 'pointer', fontWeight: 600,
          }}
        >
          {deleting ? 'deleting…' : confirmingDelete ? 'delete fact + knowledge?' : 'delete'}
        </button>
      </div>
    </div>
  );
}

export function ArcTile({
  arc,
  statusLabel,
  accent,
  onOpenSheet,
}: {
  arc: ProjectEntity;
  statusLabel?: string;
  accent: string;
  onOpenSheet: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const dot = (typeof arc.color === 'string' && arc.color.trim()) ? arc.color.trim() : accent;
  const kind = arc.kind as ArcKind | undefined;
  return (
    <div style={{ border: dark ? '1px solid #2a2a30' : '1px solid #eee', borderLeft: `3px solid ${accent}`, borderRadius: 6, padding: '10px 12px', marginBottom: 8, background: dark ? '#1a1a1e' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: dark ? '#e6e6ea' : '#222', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {arc.working_name ?? arc.id}
        </span>
        {kind && (
          <span style={{ fontSize: 9.5, padding: '2px 7px', borderRadius: 9, background: hexToRgba(accent, 0.12), color: accent, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
            {arcKindLabel(kind)}
          </span>
        )}
      </div>
      {statusLabel && (
        <div style={{ fontSize: 11, color: dark ? '#82828c' : '#888', fontStyle: 'italic', marginTop: 5 }}>{statusLabel}</div>
      )}
      <button
        onClick={onOpenSheet}
        style={{ marginTop: 8, fontSize: 11, padding: '3px 9px', borderRadius: 4, border: `1px solid ${hexToRgba(accent, 0.4)}`, background: hexToRgba(accent, 0.06), color: accent, cursor: 'pointer', fontWeight: 600 }}
      >
        open full sheet ↗
      </button>
    </div>
  );
}

// ArcSuggestionRow — one pending arc suggestion (used by RightPanel).

export function ArcSuggestionRow({
  suggestion,
  onAccept,
  onDismiss,
}: {
  suggestion: ArcSuggestion;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  const color = getEntityColor('arc');
  const kindLabel =
    typeof suggestion.suggestedKind === 'string'
      ? arcKindLabel(suggestion.suggestedKind as ArcKind)
      : '';
  const quotes = suggestion.evidenceQuotes ?? [];
  const sources = suggestion.sourceBraindumpIds ?? [];

  return (
    <div
      style={{
        marginBottom: 14,
        padding: '14px 14px 12px',
        background: dark ? '#1a1a1e' : '#fff',
        border: `1px solid ${hexToRgba(color, 0.35)}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 4,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
          flexWrap: 'wrap',
        }}
      >
        {kindLabel && (
          <span
            style={{
              fontSize: 9,
              padding: '2px 6px',
              background: hexToRgba(color, 0.14),
              color,
              borderRadius: 2,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: 0.3,
            }}
          >
            {kindLabel}
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            color: dark ? '#6e6e78' : '#aaa',
          }}
          title={`Mentioned in ${suggestion.mentionCount} extraction${suggestion.mentionCount === 1 ? '' : 's'}`}
        >
          {suggestion.mentionCount}× mentioned
          {sources.length > 0 && sources.length !== suggestion.mentionCount
            ? ` · ${sources.length} sources`
            : ''}
        </span>
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: dark ? '#e6e6ea' : '#222',
          lineHeight: 1.3,
          marginBottom: 6,
        }}
      >
        {suggestion.suggestedName}
      </div>
      {suggestion.description && (
        <div
          style={{
            fontSize: 12,
            color: dark ? '#b2b2bc' : '#555',
            lineHeight: 1.5,
            marginBottom: quotes.length > 0 ? 10 : 12,
          }}
        >
          {suggestion.description}
        </div>
      )}
      {quotes.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 9,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              color: dark ? '#82828c' : '#888',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Evidence ({quotes.length})
          </div>
          {quotes.map((q, i) => (
            <blockquote
              key={i}
              style={{
                margin: '0 0 6px',
                paddingLeft: 10,
                borderLeft: `2px solid ${hexToRgba(color, 0.3)}`,
                fontSize: 11,
                color: dark ? '#8e8e98' : '#777',
                fontStyle: 'italic',
                lineHeight: 1.5,
              }}
            >
              "{q}"
            </blockquote>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onDismiss}
          style={{
            fontSize: 11,
            padding: '5px 11px',
            border: dark ? '1px solid #2e2e35' : '1px solid #ddd',
            background: dark ? '#1a1a1e' : '#fff',
            borderRadius: 4,
            color: dark ? '#9a9aa4' : '#666',
            cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
          }}
          title="Don't suggest this again (sticky — future braindumps mentioning this concept won't re-surface it)"
        >
          Dismiss
        </button>
        <button
          type="button"
          onClick={onAccept}
          style={{
            fontSize: 11,
            fontWeight: 500,
            padding: '5px 11px',
            border: 'none',
            background: color,
            borderRadius: 4,
            color: '#fff',
            cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
          }}
          title="Create an Arc card from this suggestion"
        >
          + Create arc
        </button>
      </div>
    </div>
  );
}

// =====================================================================
// TrashOverlay — sidebar-style modal listing soft-deleted entities sorted by
// deletion time. One-click restore. The safety net behind the delete CTA;
// makes single-card deletes feel low-stakes (§9).
// =====================================================================

export function TrashOverlay({
  entities,
  onRestore,
  onClose,
}: {
  entities: ProjectEntity[];
  onRestore: (cardId: string) => void;
  onClose: () => void;
}) {
  const dark = useThemeMode() === 'dark';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 180,
        background: 'rgba(20, 20, 20, 0.28)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          width: 380,
          height: '100vh',
          background: dark ? '#1a1a1e' : '#fff',
          boxShadow: '-8px 0 28px rgba(0,0,0,0.14)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: dark ? '1px solid #2a2a30' : '1px solid #eee',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: dark ? '#e6e6ea' : '#222' }}>
            Trash {entities.length > 0 && <span style={{ color: dark ? '#787882' : '#999', fontWeight: 400 }}>({entities.length})</span>}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              fontSize: 18,
              color: dark ? '#82828c' : '#888',
              cursor: 'pointer',
              padding: 0,
            }}
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
        <div style={{ padding: '14px 18px', fontSize: 11, color: dark ? '#82828c' : '#888', lineHeight: 1.5, borderBottom: dark ? '1px solid #26262b' : '1px solid #f4f4f4' }}>
          Soft-deleted cards. Restore brings them back to the canvas with their
          edges + history intact. Re-mentioning a deleted card in prose also
          restores it automatically.
        </div>
        <div className="cb-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {entities.length === 0 ? (
            <div style={{ padding: '40px 18px', fontSize: 12, color: dark ? '#6e6e78' : '#aaa', textAlign: 'center' }}>
              Trash is empty.
            </div>
          ) : (
            entities.map((e) => {
              const name =
                e.working_name ??
                e.working_title ??
                (e.character_a && e.character_b
                  ? `${e.character_a} ↔ ${e.character_b}`
                  : e.id);
              const color = getEntityColor(e.type as EntityType);
              return (
                <div
                  key={e.id}
                  style={{
                    padding: '12px 18px',
                    borderBottom: dark ? '1px solid #26262b' : '1px solid #f4f4f4',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: dark ? '#e6e6ea' : '#222', marginBottom: 2 }}>
                      {name}
                    </div>
                    <div style={{ fontSize: 10, color: dark ? '#787882' : '#999', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      {e.type}
                      {e.deleted_at && (
                        <span style={{ marginLeft: 8, textTransform: 'none', letterSpacing: 0, color: dark ? '#63636d' : '#bbb' }}>
                          · deleted {formatRelativeTime(e.deleted_at)}
                        </span>
                      )}
                    </div>
                    {(e.description || e.summary) && (
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: dark ? '#8e8e98' : '#777',
                          lineHeight: 1.4,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                        }}
                      >
                        {e.description || e.summary}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => onRestore(e.id)}
                    style={{
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 500,
                      border: dark ? '1px solid #2e2e35' : '1px solid #ddd',
                      background: dark ? '#1a1a1e' : '#fff',
                      color: '#3b82f6',
                      borderRadius: 3,
                      cursor: 'pointer',
                      fontFamily: 'system-ui, sans-serif',
                      whiteSpace: 'nowrap',
                    }}
                    title="Clear deleted_at + bring back to the canvas"
                  >
                    Restore
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}


function BraindumpRow({ entry }: { entry: BraindumpLogEntry }) {
  const dark = useThemeMode() === 'dark';
  const [expanded, setExpanded] = useState(false);
  const when = entry.createdAt
    ? new Date(entry.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : '';
  return (
    <div
      onClick={() => setExpanded((v) => !v)}
      title={expanded ? 'Collapse' : 'Show full text'}
      style={{
        border: dark ? '1px solid #2a2a30' : '1px solid #eee',
        borderLeft: '3px solid #8b8b96',
        borderRadius: 6, padding: '9px 12px', marginBottom: 8,
        background: dark ? '#1a1a1e' : '#fff', cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 10.5, fontWeight: 600, color: dark ? '#9a9aa4' : '#666' }}>{when}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: dark ? '#63636d' : '#bbb' }}>{expanded ? '\u25be' : '\u25b8'}</span>
      </div>
      <div
        style={{
          fontSize: 12, lineHeight: 1.5, color: dark ? '#c2c2ca' : '#444',
          whiteSpace: 'pre-wrap',
          ...(expanded
            ? null
            : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden' }),
        }}
      >
        {entry.prose}
      </div>
    </div>
  );
}
