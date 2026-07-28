// freeform-script.tsx — the freeform workflow's SCRIPT surface.
//
// This is THE screenwriting editor — the same ScriptEditor composition the
// outline workflow uses (paginated pages, screenplay toolbar, line types,
// slugline/character/transition autofill, AI rail), lifted wholesale. Only
// the host shell differs: a slim freeform bar (back to board, save state)
// instead of the outline page's beat sidebar, and region-scoped persistence
// into the graph instead of one S3 blob.
//
// Scene binding rides the editor's OWN mechanism: paragraphs tagged with
// data-scene-id (the same attribute the outline's scene machinery keys off).
// Each outlined scene's FIRST paragraph carries its Event vid; everything
// after it (until the next tagged paragraph) belongs to that scene, across
// page splits. Unwritten scenes render as a slugline-typed paragraph with the
// outline title — the script skeleton, editable in place, writable in any
// order. Saves walk all page editors, group paragraphs by scene id, and save
// only regions whose HTML changed (3s idle debounce + Ctrl+S/toolbar + tab
// hide). Extraction wiring is a later increment (design doc build step 4).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { fetchAuthSession } from 'aws-amplify/auth';
import type { Editor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { DOMSerializer } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import ScriptEditor from '../../components/Scripts/ScriptEditor';
import {
  listProjectEntities,
  listBraindumps,
  listSceneTexts,
  saveSceneText,
  enqueueSceneExtraction,
  enqueueExtractionJob,
  requestScreenplayNotes,
  requestDraftNotes,
  groundDraftNotes,
  listProjectNotes,
  setNoteState,
  noteDiscuss,
  getNoteThread,
  type NoteThreadTurn,
  type ScreenplayNote,
  createCard,
  ackSceneCleared,
  deleteCard,
  tagEventPrecedes,
  untagEventPrecedes,
  tagSequenceContains,
  updateCardNarrativeStatus,
  updateCardDescription,
  updateCardName,
  type ProjectEntity,
  type ListProjectEntitiesResponse,
  type NarrativeStatus,
} from '../../lib/freeformApi';
import { topoSortEventsByPrecedes } from '../../components/Freeform/corkboard/connectors';
import { useTour, type TourStep } from '../../components/Tour/TourProvider';
import { ArcSheet, CharacterSheet, EventSheet, LocationSheet, RelationshipSheet, SequenceSheet } from '../../components/Freeform/corkboard/sheets';
import { ThemeCtx } from '../../components/Freeform/corkboard/theme';
import { loadStoredGraph, saveStoredGraph } from '../../lib/localGraphStore';
import { scriptTextToHtml } from '../../lib/screenplayParse';
import { acquireStorySession, queueEditGlobal, pulseExtractionGlobal } from '../../lib/storySession';
import InternIcon from '../../components/Freeform/InternIcon';
import '../../components/Scripts/scripts.css';
import '../../components/Scripts/filmassistant-screenplay.css';

// ---- Imported plain script text → screenplay-typed TipTap HTML --------------
// The per-line regex heuristic is RETIRED (it called caps intros in action
// character cues, shredded hard-wrapped paragraphs, and had no dialogue state
// at all). Classification lives in lib/screenplayParse.ts: an indent-aware
// Fountain-style state machine over the canonical (indent-encoded) text.
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function importedTextToHtml(text: string): string {
  return scriptTextToHtml(text);
}

// Freeform-only paragraph attribute: the outline title as a PLACEHOLDER hint
// on an unwritten scene's empty anchor paragraph. Rendered by CSS ::before,
// vanishes on typing — never document content, never saved, never exported.
const SceneSkeletonAttrs = Extension.create({
  name: 'sceneSkeletonAttrs',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          'data-scene-placeholder': {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-scene-placeholder'),
            renderHTML: (attrs: Record<string, any>) =>
              attrs['data-scene-placeholder']
                ? { 'data-scene-placeholder': attrs['data-scene-placeholder'] }
                : {},
          },
        },
      },
    ];
  },
});

// ---- Block identity for the LEDGER (design doc §2a, build step 4b) ---------
// Every paragraph carries a data-block-id minted once and persisted in the
// saved HTML. Content hashes keyed by these ids form the per-scene ledger:
// the change-detection substrate for the open tail and the diff-listener.
// Freeform-only: rides extraExtensions, so the outline workflow's editors
// never register the attribute and its documents are untouched.
const mintBlockId = () =>
  `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const BlockIdAttrs = Extension.create({
  name: 'blockIdAttrs',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          'data-block-id': {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-block-id'),
            renderHTML: (attrs: Record<string, any>) =>
              attrs['data-block-id'] ? { 'data-block-id': attrs['data-block-id'] } : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('ffBlockIds'),
        // Mint ids for paragraphs missing one; re-mint duplicates (splitBlock
        // copies attrs to both halves — first occurrence keeps the id, so a
        // mid-paragraph Enter keeps identity on the text above the caret).
        appendTransaction: (trs, _oldState, state) => {
          if (!trs.some((tr) => tr.docChanged)) return null;
          const seen = new Set<string>();
          let tr: ReturnType<typeof state.tr.setNodeMarkup> | null = null;
          state.doc.descendants((node: any, pos: number) => {
            if (node.type?.name !== 'paragraph') return true;
            const id = node.attrs?.['data-block-id'];
            if (!id || seen.has(String(id))) {
              tr = (tr ?? state.tr).setNodeMarkup(pos, undefined, {
                ...node.attrs,
                'data-block-id': mintBlockId(),
              });
            } else {
              seen.add(String(id));
            }
            return false; // paragraphs are top-level; nothing to descend into
          });
          return tr;
        },
      }),
    ];
  },
});

// Stable extension array (module scope) so PaginatedEditor's page editors
// don't re-init on every host render.
const EXTRA_EXTENSIONS = [SceneSkeletonAttrs, BlockIdAttrs];

// Ledger block: { b: block id ('' until minted), h: content hash, l: length }.
// Array order is document order within the region.
type LedgerBlock = { b: string; h: string; l: number };

const normText = (s: string) => s.replace(/\s+/g, ' ').trim();
const strHash = (s: string): string => {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
  return String(h);
};
const ledgerBlockOf = (node: any): LedgerBlock => {
  const text = String(node.textContent ?? '');
  return {
    b: String(node.attrs?.['data-block-id'] ?? ''),
    h: strHash(normText(text)),
    l: text.length,
  };
};

// Carve slicing (§2a; live bug 2026-07-07): minted scenes must persist the
// writer's ACTUAL formatted blocks as their SceneText. Reloading through
// importedTextToHtml rederives line types by heuristic (manual character/
// dialogue assignments flatten to action) and silently drops span-less
// text. Blocks k..n-1 (after the continuation) map onto the generation's
// spans via the same arithmetic the backend used (prose = block texts
// joined '\n\n', so block j starts at sum(len)+2j); a block no span claims
// goes to the nearest preceding scene, never dropped.
function assignBlocksToScenes(
  texts: string[],
  htmls: string[],
  k: number,
  spans: Array<{ id: string; start: number; end: number }>,
): Map<string, string> {
  const out = new Map<string, string>();
  if (spans.length === 0) return out;
  const startOf = (j: number) => texts.slice(0, j).reduce((acc, t) => acc + t.length, 0) + 2 * j;
  const ordered = [...spans].sort((a, b) => a.start - b.start);
  let cur: string | null = null;
  for (let j = k; j < texts.length; j++) {
    const s0 = startOf(j);
    const hit = ordered.find((s) => s0 >= s.start && s0 < s.end);
    if (hit) cur = hit.id;
    else if (!cur) cur = ordered[0].id;
    out.set(cur, (out.get(cur) ?? '') + htmls[j]);
  }
  return out;
}

// Span parsing off an entity's src_* properties; invalid/absent spans drop.
function validSpansOf(events: Array<{ id: string; src_start?: any; src_end?: any }>) {
  return events
    .map((e) => ({
      id: e.id,
      start: parseInt(String(e.src_start ?? ''), 10),
      end: parseInt(String(e.src_end ?? ''), 10),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
}

/** Ensure a scene's FIRST paragraph carries its Event vid (the region tag). */
function tagFirstParagraph(html: string, eventId: string): string {
  if (!html.startsWith('<p')) return html;
  const firstTagEnd = html.indexOf('>');
  if (firstTagEnd === -1) return html;
  const firstTag = html.slice(0, firstTagEnd);
  if (firstTag.includes('data-scene-id')) {
    // Re-stamp: the region's identity is positional, first tag wins.
    return html.replace(/^(<p[^>]*?)\sdata-scene-id="[^"]*"/, `$1 data-scene-id="${escapeHtml(eventId)}"`);
  }
  return `<p data-scene-id="${escapeHtml(eventId)}"${html.slice(2)}`;
}

// ---- Left navigator model: the outline in shell form ------------------------
type NavScene = { eventId: string; scNo: number; title: string };
type NavSection = { seqId: string | null; title: string; color: string; scenes: NavScene[] };
// Navigator dot semantics (Ben, 2026-07-16): green = written and extraction
// current; grey = needs extraction (edited past the floor since the last
// extraction, extraction in flight, or imported/never-extracted); hollow =
// unwritten; red = cleared, keep-or-trash undecided. 'imported' merged into
// grey — there is no separate blue state.
type SceneStatus = 'written' | 'stale' | 'unwritten' | 'cleared';

const NAV_OPEN_KEY = 'ff-script-nav-open';
const NAV_WIDTH_KEY = 'ff-script-nav-width';
// First-run tour for the SCRIPT surface (navigator, pages, peer Read, Notes/
// Review). Per-browser, like the wow's ff-wow-seen; marked seen at LAUNCH so a
// broken anchor can never loop the tour on every visit.
const SCRIPT_TOUR_KEY = 'ff-script-tour-seen';
const NAV_W_MIN = 200;
const NAV_W_MAX = 520;

// Build stamp, logged at mount. Bump when editing this file. A long-lived
// tab with a dead HMR socket silently runs stale code (2026-07-08: a stale
// tab re-ran every already-fixed bug in one session — retire loop, missing
// verdict, double-run); this makes "which code is this tab running" a
// one-glance check in the console.
const FF_SCRIPT_BUILD = '2026-07-25b';

// Peer-note tier colors + the pin color rule (intent gap = orange). Module
// scope so both the in-canvas markers and the fixed hover card share them.
const NOTE_TIER_COLORS: Record<string, string> = {
  structure: '#60a5fa', // blue
  character: '#f472b6', // pink (was gold; gold read too close to the intent-gap orange)
  scene: '#34d399',     // green
  dialogue: '#a78bfa',  // purple
  concept: '#d4af37',   // gold (rarely rendered; folds into the Structure pass)
};
const PEER_BLUE = '#54bfdb'; // the peer persona color (matches the board's InternIcon glasses)
// Note chrome color = the TIER (a stable identity). Intent-gap is a STATE shown
// separately (a mark / an accent), never by recoloring the whole note — that was
// making every gap note orange and erasing tier identity.
const noteColor = (n: { tier: string }) => (NOTE_TIER_COLORS[n.tier] ?? '#8a8a93');
// Latest §5 progression entry (the peer read a rewrite: moved, still open).
// Only ever surface the LATEST line in compact surfaces; the full trajectory
// lives on the vertex for the future Discuss thread.
const latestProgressNote = (n: { progress_log?: string }): string | null => {
  try {
    const log = JSON.parse(n.progress_log || '[]');
    const last = log[log.length - 1];
    return last?.note ? String(last.note) : null;
  } catch { return null; }
};

// The writer-facing revision PASSES (Jack Epps Jr's Pass Method, simple 4,
// structure-first, dialogue last). The schema's 5 tiers fold in: concept rides
// the Structure pass (both are big-picture). Order IS the law (§4b).
const PASS_DEFS: Array<{ key: string; label: string; tiers: string[]; blurb: string }> = [
  { key: 'structure', label: 'Structure', tiers: ['concept', 'structure'], blurb: 'The scene\'s shape: does it turn, does it earn its place, is the premise sound.' },
  { key: 'character', label: 'Character', tiers: ['character'], blurb: 'Want, agency, voice, arc: is the person on the page doing what the story needs.' },
  { key: 'scene', label: 'Scene', tiers: ['scene'], blurb: 'Scene craft: staging, focus, economy, where the reading experience bumps.' },
  { key: 'dialogue', label: 'Dialogue', tiers: ['dialogue'], blurb: 'Line level: on-the-nose, subtext, differentiation. Last, so you polish what survives.' },
];
const TIER_TO_PASS: Record<string, number> = { concept: 0, structure: 0, character: 1, scene: 2, dialogue: 3 };

// Notes-surface design tokens (Hallmark redesign 2026-07-21). Three type roles:
// SANS for chrome/labels/buttons, SERIF for the peer's VOICE (the diagnosis —
// read like a colleague's written note), MONO for the script line it quotes.
const NOTE_FONT_SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const NOTE_FONT_SERIF = "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif";
const NOTE_FONT_MONO = "'SF Mono', ui-monospace, 'Menlo', Menlo, monospace";
// Per-theme surface colors so the three panels read as one calm system.
const noteSurface = (dark: boolean) => ({
  panel: dark ? '#0d0d0f' : '#fbf8f1',
  raise: dark ? '#151518' : '#ffffff',
  hair: dark ? '#1e1e23' : '#ece4d4',
  hairSoft: dark ? '#161619' : '#f0e8d8',
  voice: dark ? '#e7e7ec' : '#26262a',   // the diagnosis prose
  ink: dark ? '#ececef' : '#161618',     // headings
  quiet: dark ? '#9195a0' : '#736b5e',   // secondary (labels, quoted line)
  faint: dark ? '#63636d' : '#9a9082',   // tertiary / metadata
  quoteBg: dark ? '#121215' : '#f4eee2',
});

// SCENE-BOUNDARY GUARD (FIL-529 prevention). A scene's identity lives on its
// head paragraph's data-scene-id; ProseMirror's default Backspace-at-start
// merges that paragraph into the previous one and DESTROYS the tag — the
// "whole scene reads as deleted" / boundary-migration family. The guard:
//   - Backspace at the start of a tagged paragraph: if the paragraph above is
//     an empty line, delete THAT line (the writer's actual intent: pull the
//     scene up); if it has content, block the merge outright — two scenes
//     never fuse through a keystroke.
//   - Forward-Delete at the end of the paragraph above a tagged head: same
//     rule mirrored.
// Mid-scene editing is untouched (only head paragraphs carry tags).
const sceneBoundaryGuard = () => new Plugin({
  key: new PluginKey('ffSceneBoundaryGuard'),
  props: {
    handleKeyDown(view, event) {
      if (event.key !== 'Backspace' && event.key !== 'Delete') return false;
      const { state } = view;
      const sel = state.selection;
      if (!sel.empty) return false;
      const $pos = sel.$from;
      if ($pos.depth !== 1) return false; // screenplay paragraphs are top-level
      const doc = $pos.node(0);
      const idx = $pos.index(0);
      if (event.key === 'Backspace') {
        if ($pos.parentOffset !== 0) return false;
        if (!$pos.parent.attrs?.['data-scene-id']) return false;
        const before = idx > 0 ? doc.maybeChild(idx - 1) : null;
        if (before && before.isTextblock && before.textContent.trim() === '') {
          const beforeStart = $pos.before(1) - before.nodeSize;
          view.dispatch(state.tr.delete(beforeStart, beforeStart + before.nodeSize).scrollIntoView());
        }
        return true; // handled either way: the scene head survives
      }
      // Forward Delete: at the end of the paragraph directly above a tagged head.
      if ($pos.parentOffset !== $pos.parent.content.size) return false;
      const after = doc.maybeChild(idx + 1);
      if (!after?.attrs?.['data-scene-id']) return false;
      const cur = $pos.parent;
      if (cur.isTextblock && cur.textContent.trim() === '') {
        const curStart = $pos.before(1);
        view.dispatch(state.tr.delete(curStart, curStart + cur.nodeSize).scrollIntoView());
      }
      return true;
    },
  },
});
const boundaryGuardedEditors = new WeakSet<object>();

// Merge idempotency: a continuation may reach the merge point twice (a
// stale tab re-persisting old scratch, a reload racing a carve). If the
// text already lives in ANY bound scene, the merge is a no-op.
const textAlreadyBound = (contHtml: string, boundHtmls: Iterable<string>) => {
  const t = normText(contHtml.replace(/<[^>]+>/g, ' '));
  if (!t) return true;
  for (const h of boundHtmls) {
    if (h && normText(h.replace(/<[^>]+>/g, ' ')).includes(t)) return true;
  }
  return false;
};

// Region tags must never travel inside a region's BODY: appended scratch
// blocks carry the __scratch__ tag on their first paragraph, and a tag
// embedded mid-scene splits a phantom region on every load (observed live
// 2026-07-08). Strip before any merge; loads re-tag first paragraphs.
const stripSceneTags = (html: string) => html.replace(/\sdata-scene-id="[^"]*"/g, '');

// FIL-520 helpers — block identity from an html region string. `ids` and
// `hashes` feed the settled snapshot (settled = id OR content-hash match, so
// a remount that re-mints block ids cannot unsettle unchanged text);
// `keys` (id|hash pairs) feed the scratch-restore dedupe (only an EXACT
// captured twin — same id AND same content — is a double-capture artifact;
// hash-only matching would delete a writer's legitimately repeated lines,
// which screenplays are full of).
const blockKeysOf = (html: string): { ids: Set<string>; hashes: Set<string>; keys: Set<string> } => {
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const keys = new Set<string>();
  if (!html) return { ids, hashes, keys };
  try {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return { ids, hashes, keys };
    for (const el of Array.from(root.children)) {
      const id = el.getAttribute('data-block-id') ?? '';
      const t = normText(String(el.textContent ?? ''));
      if (id) ids.add(id);
      if (t) hashes.add(strHash(t));
      if (id && t) keys.add(`${id}|${strHash(t)}`);
    }
  } catch { /* malformed html: no identity, callers degrade gracefully */ }
  return { ids, hashes, keys };
};

// Ordered ledger from a region's html (carve saves: the blocks were just
// extracted, so the save stamps them as the extracted snapshot too and the
// scene reads current instead of never-extracted grey).
const ledgerFromHtml = (html: string): Array<{ b: string; h: string; l: number }> => {
  const out: Array<{ b: string; h: string; l: number }> = [];
  try {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return out;
    for (const el of Array.from(root.children)) {
      const t = String(el.textContent ?? '');
      out.push({ b: el.getAttribute('data-block-id') ?? '', h: strHash(normText(t)), l: t.length });
    }
  } catch { /* malformed html: no ledger, staleness errs fresh */ }
  return out;
};

// Rebuild an html region keeping only blocks the predicate accepts.
const filterHtmlBlocks = (html: string, keep: (id: string, text: string) => boolean): string => {
  try {
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild;
    if (!root) return html;
    let out = '';
    for (const el of Array.from(root.children)) {
      if (keep(el.getAttribute('data-block-id') ?? '', String(el.textContent ?? ''))) out += el.outerHTML;
    }
    return out;
  } catch {
    return html;
  }
};

export default function FreeformScript() {
  const { storyId } = useParams<{ storyId: string }>();
  const [auth, setAuth] = useState<{ userId: string; token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialContent, setInitialContent] = useState<string | null>(null);
  const [sceneCount, setSceneCount] = useState(0);
  const [characters, setCharacters] = useState<any[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [saveState, setSaveState] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  // Background-work indicator: TRUE while a scratch generation is in flight
  // (real signal, guard-tracked) or within the optimistic window after a
  // scene-extraction enqueue (that lane has no completion signal in this
  // view yet — WS wiring is step 9). Drives the Sync button's spinner.
  const [bgBusy, setBgBusy] = useState(false);
  const pendingScenesRef = useRef(0);
  const trackSceneExtraction = useCallback(() => {
    pendingScenesRef.current++;
    window.setTimeout(() => { pendingScenesRef.current = Math.max(0, pendingScenesRef.current - 1); }, 30000);
  }, []);
  // Bumped when the scratch carve completes: reloads data + remounts the
  // editor so unbound text rebuilds as bound scene regions.
  const [reloadTick, setReloadTick] = useState(0);

  // Left navigator: sequences as sections, scenes as rows.
  const [navSections, setNavSections] = useState<NavSection[]>([]);
  const [statusById, setStatusById] = useState<Map<string, SceneStatus>>(new Map());
  const [activeSceneId, setActiveSceneId] = useState<string | null>(null);
  const navOpenRef = useRef<boolean>(true);
  const [navOpen, setNavOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(NAV_OPEN_KEY) !== '0'; } catch { return true; }
  });
  // Navigator UX: resizable rail width (persisted), hover reveal (rows grow
  // to their full title), and the proxy-card / full-card click semantics.
  const [navWidth, setNavWidth] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem(NAV_WIDTH_KEY) ?? '', 10);
      return Number.isFinite(v) ? Math.min(NAV_W_MAX, Math.max(NAV_W_MIN, v)) : 248;
    } catch { return 248; }
  });
  const [hoverSceneId, setHoverSceneId] = useState<string | null>(null);
  const [hoverSeqIdx, setHoverSeqIdx] = useState<number | null>(null);
  // Second click on the active scene opens this (summary + cast + door to
  // the full card). { eventId, top } — top anchors the popover to the row.
  const [proxyCard, setProxyCard] = useState<{ eventId: string; top: number } | null>(null);
  // The corkboard's level-3 sheet, mounted here (same overlay, same data
  // shape — fed from graphData instead of the board's live state).
  const [fullCardId, setFullCardId] = useState<string | null>(null);
  // Step 8 (FIL-528) — the screenplay peer's notes. The DISPLAY is document-wide
  // (Pins): every open note across the draft pins to its line across the whole
  // scroll. Generation is still per-scene (Mode A): "Read this scene" runs the
  // peer on the active scene and merges the fresh notes into the project set.
  const [notesOpen, setNotesOpen] = useState<boolean>(true); // pins layer visible (hover-only)
  const [allNotes, setAllNotes] = useState<ScreenplayNote[]>([]); // document-wide, open notes
  const [notesBusy, setNotesBusy] = useState<boolean>(false);
  const [notesError, setNotesError] = useState<string>('');
  // The empty/error status toast is dismissible; a fresh read or arriving notes
  // re-arms it (reset alongside the actions that would show a new message).
  const [statusToastDismissed, setStatusToastDismissed] = useState(false);
  const [notesLoaded, setNotesLoaded] = useState<boolean>(false);
  const [readingScene, setReadingScene] = useState<string | null>(null); // scene id being (re)read
  // ---- First-run tour of the SCRIPT surface (rides the same Tour engine as
  // the corkboard wow; the wow's toolbar beat points here). Four beats:
  // navigator, the pages, the peer Read button, Notes/Review. The Read button
  // is hover-reveal, so its beat force-shows it on the target row.
  const { startTour: startScriptTour, active: anyTourActive } = useTour();
  const [tourReadSceneId, setTourReadSceneId] = useState<string | null>(null);
  const scriptTourFiredRef = useRef(false);
  useEffect(() => {
    if (loading || scriptTourFiredRef.current || anyTourActive) return;
    try { if (localStorage.getItem(SCRIPT_TOUR_KEY) === 'true') return; } catch { /* ignore */ }
    scriptTourFiredRef.current = true;
    // Let the pages mount before spotlighting them; the engine's own retry
    // (25 x 120ms) covers slower targets after that.
    const t = window.setTimeout(() => {
      try { localStorage.setItem(SCRIPT_TOUR_KEY, 'true'); } catch { /* ignore */ }
      const body = (headline: string, text: React.ReactNode) => (
        <div style={{ maxWidth: 280 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{headline}</div>
          <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{text}</div>
        </div>
      );
      // The Read beat targets the first WRITTEN scene (its button is live);
      // falls back to the first row, where the button shows disabled with the
      // "write it first" hint. No scenes at all = skip the beat.
      const rows = navSections.flatMap((s) => s.scenes);
      const readTarget =
        rows.find((sc) => { const st = statusById.get(sc.eventId); return st === 'written' || st === 'stale'; })
        ?? rows[0];
      const steps: TourStep[] = [
        {
          id: 'script-nav',
          selector: '[data-tour="script-nav"]',
          placement: 'side',
          onEnter: () => setNavOpen(true),
          content: body(
            'Your outline came with you.',
            'Every scene from your board is a row here, in story order, grouped by sequence. The dots track what is written, what changed since the engine last read it, and what is still empty. Click a row to jump to it.',
          ),
        },
        {
          id: 'script-page',
          selector: '.ff-script-host .paginated-page-card',
          placement: 'side',
          content: body(
            'Now just write.',
            'Type your scenes as screenplay pages. You never mark where a scene starts or ends: the engine follows your sluglines and keeps the board in sync as you go.',
          ),
        },
        ...(readTarget
          ? [{
              id: 'script-read',
              selector: `[data-tour="script-scene-${readTarget.eventId}"]`,
              placement: 'side' as const,
              onEnter: () => setTourReadSceneId(readTarget.eventId),
              onExit: () => setTourReadSceneId(null),
              content: body(
                'The peer reads pages.',
                <>
                  Once a scene is written, hit{' '}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: PEER_BLUE, fontWeight: 600, verticalAlign: 'middle' }}>
                    <InternIcon size={11} />Read
                  </span>{' '}
                  and the peer measures your pages against what the scene is meant to do. The same button on a sequence header reads that whole stretch at once.
                </>,
              ),
            }]
          : []),
        {
          id: 'script-notes',
          selector: '[data-tour="script-peer-seg"]',
          nextLabel: "You're set →",
          onEnter: () => setTourReadSceneId(null),
          content: body(
            'Notes pin to your lines.',
            'Each note sits in the margin beside the exact line it is about; hover a pin to read it. Review gathers everything into a docket you clear pass by pass, and a note clears itself when your rewrite answers it.',
          ),
        },
      ];
      startScriptTour(steps, { lockScroll: false, onSkip: () => setTourReadSceneId(null) });
    }, 700);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, anyTourActive, navSections, statusById]);
  // Pins live INSIDE the editor's scroll container (.paginated-canvas) as
  // absolute children in CONTENT coordinates, so the browser scrolls them in
  // lockstep with the pages (no JS-per-frame, no shake). Each note is a marker
  // in the page's right margin; the note pops on hover. Geometry recomputes only
  // on content reflow / resize, never on scroll.
  const [canvasEl, setCanvasEl] = useState<HTMLElement | null>(null);
  type PinHL = { left: number; top: number; width: number; height: number };
  type PinG = { markerTop: number; markerX: number; cardX: number; lineTop: number; cardTop: number; found: boolean; hl: PinHL | null };
  const [pinGeom, setPinGeom] = useState<Map<string, PinG>>(new Map());
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null); // brief highlight after jump
  const [hoverNoteId, setHoverNoteId] = useState<string | null>(null); // marker/card hover
  const hoverCloseRef = useRef<number | null>(null); // grace timer so moving marker->card doesn't close it
  const pinSigRef = useRef<string>(''); // last laid-out geometry signature (skip no-op re-renders)
  // PASSES review session. Reads allNotes; sorts by severity (altitude passes)
  // or by scene (spine order).
  const [reviewOpen, setReviewOpen] = useState<boolean>(false);
  // Review commandeers the layout: opening it closes the outline nav and the
  // editor recenters in the remaining space; closing restores the nav to
  // whatever the writer had. Ref (not state): it's a memo of their setting.
  const navBeforeReviewRef = useRef<boolean | null>(null);
  const [reviewSort, setReviewSort] = useState<'severity' | 'scene'>('severity');
  const [passIdx, setPassIdx] = useState<number>(0);
  // The DOCKET (Review v2): one row open at a time; rows the writer settles
  // this session STRIKE THROUGH and stay in place — the pass becomes its own
  // record (who cleared what). Session-scoped: a reload re-reads open notes
  // only, so the struck rows fall away; the durable state is on the vertex.
  const [openNoteId, setOpenNoteId] = useState<string | null>(null);
  const [settledLog, setSettledLog] = useState<Array<{ note: ScreenplayNote; state: 'resolved' | 'dismissed' }>>([]);
  // DISCUSS (§6): the review panel transforms into the note's chat. One
  // persistent thread per note; the peer opens with the note itself.
  const [discussNote, setDiscussNote] = useState<ScreenplayNote | null>(null);
  const [discussTurns, setDiscussTurns] = useState<NoteThreadTurn[]>([]);
  const [discussBusy, setDiscussBusy] = useState<boolean>(false);
  const [discussLoading, setDiscussLoading] = useState<boolean>(false);
  const [discussInput, setDiscussInput] = useState<string>('');
  const [discussError, setDiscussError] = useState<string>('');
  const discussScrollRef = useRef<HTMLDivElement | null>(null);
  // §5 VISIBILITY: scenes whose open notes are being re-judged server-side
  // (an extraction we fired is in flight + the judge runs at its tail). The
  // docket/pins show a "rereading" state until the note set changes or 100s.
  const [reviewingScenes, setReviewingScenes] = useState<Map<string, { at: number; sig: string }>>(new Map());
  const allNotesRef = useRef<ScreenplayNote[]>([]);
  // AUTO-RESOLVED records (§5 re-eval): notes the writer's REWRITE cleared,
  // server-side. Rendered struck in the docket with the peer's mark, distinct
  // from hand-addressed. Recent-window only; reopenable.
  const [autoLog, setAutoLog] = useState<ScreenplayNote[]>([]);
  // Full graph payload for the proxy/full cards. Seeded at load, refreshed
  // when a card opens (one read; freshness matters there, not for rows).
  const [graphData, setGraphData] = useState<ListProjectEntitiesResponse | null>(null);
  const emptyResponseIds = useMemo(() => new Set<string>(), []);
  const refreshGraph = useCallback(async () => {
    const a = authRef.current;
    if (!a || !storyId) return;
    try {
      const fresh = await listProjectEntities({ projectId: storyId }, a.token);
      setGraphData(fresh);
      void saveStoredGraph(storyId, { payload: fresh }); // FIL-518: keep the shelf warm
    } catch { /* best-effort */ }
  }, [storyId]);
  // Proxy card on HOVER (intent-delayed): the full card flashes beside the
  // rail while the pointer rests on a row; a grace timer bridges row -> card.
  // Click no longer opens it (click = jump), per 2026-07-24.
  const proxyOpenTimerRef = useRef<number | null>(null);
  const proxyCloseTimerRef = useRef<number | null>(null);
  const [proxyLeaving, setProxyLeaving] = useState(false);
  const proxyCardRef = useRef<typeof proxyCard>(null);
  useEffect(() => { proxyCardRef.current = proxyCard; }, [proxyCard]);
  const openProxyHover = useCallback((eventId: string, top: number) => {
    if (proxyCloseTimerRef.current) { window.clearTimeout(proxyCloseTimerRef.current); proxyCloseTimerRef.current = null; }
    if (proxyOpenTimerRef.current) window.clearTimeout(proxyOpenTimerRef.current);
    // Already showing a card: switching rows re-targets fast and the card
    // GLIDES to the new row (top transitions); fresh opens keep the longer
    // hover-intent delay.
    const delay = proxyCardRef.current ? 110 : 350;
    proxyOpenTimerRef.current = window.setTimeout(() => {
      proxyOpenTimerRef.current = null;
      setProxyLeaving(false);
      setProxyCard({ eventId, top });
      void refreshGraph();
    }, delay);
  }, [refreshGraph]);
  const scheduleProxyClose = useCallback(() => {
    if (proxyOpenTimerRef.current) { window.clearTimeout(proxyOpenTimerRef.current); proxyOpenTimerRef.current = null; }
    if (proxyCloseTimerRef.current) window.clearTimeout(proxyCloseTimerRef.current);
    // Two-phase close: grace (can still re-enter), then a short leave
    // animation before unmount.
    proxyCloseTimerRef.current = window.setTimeout(() => {
      setProxyLeaving(true);
      proxyCloseTimerRef.current = window.setTimeout(() => {
        setProxyCard(null);
        setProxyLeaving(false);
        proxyCloseTimerRef.current = null;
      }, 150);
    }, 200);
  }, []);
  const cancelProxyClose = useCallback(() => {
    if (proxyCloseTimerRef.current) { window.clearTimeout(proxyCloseTimerRef.current); proxyCloseTimerRef.current = null; }
    setProxyLeaving(false);
  }, []);

  // FIL-518 stage 3: hold the story session while the script view is
  // mounted — the session's WebSocket outlives board↔script switches, so a
  // graph_delta landing while the writer is HERE still reaches the local
  // copy and the shelf (FIL-524), and the writer-edit queue has auth.
  useEffect(() => {
    const a = auth;
    if (!storyId || !a) return;
    const session = acquireStorySession(storyId, { userId: a.userId, token: a.token });
    return () => session.release();
  }, [storyId, auth]);

  // Local-first card edit from the script surface: applies to graphData
  // instantly, queues the durable push (persisted, retried), never refetches
  // on the spot — the belt re-trues later.
  const queuedCardEdit = useCallback((cardId: string, field: 'working_name' | 'description', value: string) => {
    if (!storyId) return;
    queueEditGlobal(storyId, { cardId, field, value });
    setGraphData((cur) => {
      if (!cur) return cur;
      return {
        ...cur,
        entities: cur.entities.map((e: any) => {
          if (e.id !== cardId) return e;
          if (field === 'working_name') {
            return { ...e, working_name: value, working_title: e.working_title !== undefined ? value : e.working_title };
          }
          return { ...e, description: value, summary: e.summary !== undefined ? value : e.summary };
        }),
      };
    });
  }, [storyId]);

  const startNavResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = navWidth;
    const onMove = (ev: MouseEvent) => {
      setNavWidth(Math.min(NAV_W_MAX, Math.max(NAV_W_MIN, startW + (ev.clientX - startX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setNavWidth((w) => { try { localStorage.setItem(NAV_WIDTH_KEY, String(w)); } catch { /* ignore */ } return w; });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [navWidth]);
  useEffect(() => { navOpenRef.current = navOpen; }, [navOpen]);

  useEffect(() => {
    if (reviewOpen) {
      navBeforeReviewRef.current = navOpenRef.current;
      setNavOpen(false);
    } else if (navBeforeReviewRef.current != null) {
      setNavOpen(navBeforeReviewRef.current);
      navBeforeReviewRef.current = null;
    }
  }, [reviewOpen]);

  const toggleNav = useCallback(() => {
    setNavOpen((v) => {
      try { localStorage.setItem(NAV_OPEN_KEY, v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }, []);

  // Manual-only preference (design doc §3): all AUTO extraction triggers off,
  // per story. Sync + highlight-extract stay; the peer's stale-gate keeps
  // correctness just-in-time, which is what makes this mode safe. Saves are
  // unaffected — text always persists.
  const manualOnlyKey = `ff-manual-extract-${storyId ?? ''}`;
  const [manualOnly, setManualOnly] = useState<boolean>(() => {
    try { return localStorage.getItem(`ff-manual-extract-${storyId ?? ''}`) === '1'; } catch { return false; }
  });
  const manualOnlyRef = useRef(manualOnly);
  manualOnlyRef.current = manualOnly;
  const toggleManualOnly = useCallback(() => {
    setManualOnly((v) => {
      try { localStorage.setItem(manualOnlyKey, v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  }, [manualOnlyKey]);

  // eventId → last persisted region HTML (dirty-check baseline).
  const baselineRef = useRef<Map<string, string>>(new Map());
  // Spine order + titles — drives anchor INSERTION position for scenes that
  // aren't in the document yet (unwritten scenes render nowhere until chosen).
  const spineOrderRef = useRef<string[]>([]);
  const titleByIdRef = useRef<Map<string, string>>(new Map());
  // Graph edges kept for the "+ New scene" splice + sequence membership.
  const precedesRef = useRef<Array<{ from: string; to: string }>>([]);
  const seqOfEventRef = useRef<Map<string, string>>(new Map());
  // "+ New scene" inline input state.
  const [addSceneOpen, setAddSceneOpen] = useState(false);
  const [addSceneTitle, setAddSceneTitle] = useState('');
  const [addSceneBusy, setAddSceneBusy] = useState(false);
  const getAllHTMLRef = useRef<(() => string) | null>(null);
  const getAllEditorsRef = useRef<(() => Editor[]) | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  // Save freeze for the carve window: a queued debounced save walking the
  // PRE-reload document re-persists stale scratch right after the carve
  // clears it (observed live 2026-07-07: scratch left holding the carved
  // generation's text, re-carving on every load). Set when a carve starts
  // persisting; lifted by the load effect after the remount.
  const carvingRef = useRef(false);
  const authRef = useRef<typeof auth>(null);
  authRef.current = auth;

  // ---- Load: entities + braindump prose + saved scene texts → one document.
  useEffect(() => {
    if (!storyId) { setError('No storyId in URL'); setLoading(false); return; }
    console.info('[freeform-script] build', FF_SCRIPT_BUILD);
    carvingRef.current = false; // fresh document: saves resume
    // The editor must remount ONLY with fresh parts: the reloadTick key
    // change remounts it instantly, and without this gate the new instance
    // seeds from the PREVIOUS load's initialContent (PaginatedEditor ignores
    // later prop changes once page 1 has content) — the carve looked like it
    // erased the newest scene until a full board round-trip (live bug
    // 2026-07-09, the "dropped continuation").
    setInitialContent(null);
    setLoading(true);
    let cancelled = false;
    (async () => {
      try {
        // FIL-518 stage 2a — hydrate the graph copy from the local shelf so
        // proxy/full cards work instantly; the fetch below replaces it. The
        // DOCUMENT still builds from fresh reads (scene texts + braindumps
        // are not shelved), so this only pre-warms the graph surface.
        void loadStoredGraph(storyId).then((stored) => {
          if (stored && !cancelled) {
            setGraphData((cur) => cur ?? stored.payload);
          }
        });

        const session = await fetchAuthSession();
        const token = session.tokens?.idToken?.toString() ?? '';
        const userId = String(session.tokens?.idToken?.payload?.['cognito:username'] ?? '');
        if (!userId || !token) throw new Error('Not authenticated');
        if (cancelled) return;
        setAuth({ userId, token });

        const RETRY_DELAYS = [1800, 4000];
        let entities: Awaited<ReturnType<typeof listProjectEntities>> | null = null;
        for (let attempt = 0; ; attempt++) {
          try {
            entities = await listProjectEntities({ projectId: storyId }, token);
            break;
          } catch (e) {
            if (attempt >= RETRY_DELAYS.length) throw e;
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
          }
        }
        const [bds, stexts] = await Promise.all([
          listBraindumps({ projectId: storyId }, token).catch(() => ({ projectId: storyId, braindumps: [] })),
          listSceneTexts({ projectId: storyId }, token).catch(() => ({ projectId: storyId, sceneTexts: [] })),
        ]);
        if (cancelled || !entities) return;
        setGraphData(entities); // proxy/full cards read this; refreshed on open
        void saveStoredGraph(storyId, { payload: entities }); // FIL-518: keep the shelf warm

        const proseByBraindump = new Map(bds.braindumps.map((b) => [b.braindumpId, b.prose]));
        const savedByEvent = new Map(
          stexts.sceneTexts.filter((s) => s.eventId !== '__scratch__').map((s) => [s.eventId, s.html]),
        );
        // Per-scene staleness from the bulk read (ledger diff, server truth).
        // undefined (legacy rows without ledgers) errs fresh, matching the
        // backend verdict's fail direction.
        const staleByEvent = new Map(
          stexts.sceneTexts.filter((s) => s.eventId !== '__scratch__').map((s) => [s.eventId, s.stale === true]),
        );
        let scratchHtml = stexts.sceneTexts.find((s) => s.eventId === '__scratch__')?.html ?? '';

        // ---- Scratch reconciliation (refresh-proof) ----
        // Seed the extracted-hash set from the STORED scratch braindump prose:
        // the server is the diff-recognition truth, so unchanged text never
        // re-extracts across sessions. Then: if the current scratch matches a
        // generation whose scenes landed, the carve completes right here
        // (scratch clears, regions render bound). Generations that do NOT
        // match the current scratch retire at load (Trash) so stale mints
        // never haunt the board.
        const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
        const htmlToText = (h: string) => norm(h.replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ''));
        const scratchBds = bds.braindumps.filter((b) => b.braindumpId.startsWith('scratch_'));
        const seedHashes = new Set<string>();
        for (const b of scratchBds) {
          let hs = 0;
          const nb = norm(b.prose);
          for (let i = 0; i < nb.length; i++) { hs = ((hs << 5) - hs + nb.charCodeAt(i)) | 0; }
          seedHashes.add(String(hs));
        }
        extractedScratchHashesRef.current = seedHashes;
        const retiredIds = new Set<string>();
        if (scratchHtml) {
          const scratchNorm = htmlToText(scratchHtml);
          const ents = entities;
          const mintedBy = (bdId: string) =>
            ents.entities.filter(
              (e: ProjectEntity) => e.type === 'event' && !e.deleted_at && String(e.src_braindump ?? '') === bdId,
            );
          const carved = scratchBds.find(
            (b) => norm(b.prose) === scratchNorm && (mintedBy(b.braindumpId).length > 0 || (b.continuationBlocks ?? 0) > 0),
          );
          if (carved) {
            // Carve completes at load: scenes render bound; scratch clears.
            // A continuation stamp (§2c) appends the generation's opening
            // blocks to the scene it extends before the scratch clears.
            const k = carved.continuationBlocks ?? 0;
            const contScene = carved.continuationScene ?? '';
            if (k > 0 && contScene) {
              const holder = document.createElement('div');
              holder.innerHTML = scratchHtml;
              const contHtml = stripSceneTags(Array.from(holder.children)
                .filter((el) => (el.textContent ?? '').trim() !== '')
                .slice(0, k)
                .map((el) => el.outerHTML)
                .join(''));
              const target = ents.entities.find(
                (e: ProjectEntity) => e.type === 'event' && !e.deleted_at && (e.working_title ?? '') === contScene,
              );
              if (target && contHtml && !textAlreadyBound(contHtml, savedByEvent.values())) {
                const merged = (savedByEvent.get(target.id) ?? '') + contHtml;
                savedByEvent.set(target.id, merged);
                saveSceneText({ projectId: storyId, eventId: target.id, html: merged }, token).catch(() => {});
              }
            }
            // Minted scenes get their real formatted blocks too (same fix as
            // the in-session carve): slice the stored scratch html by the
            // generation's spans. Strict text match guards the arithmetic;
            // on mismatch the span render remains the fallback.
            const mintedHere = mintedBy(carved.braindumpId);
            if (mintedHere.length) {
              const holder2 = document.createElement('div');
              holder2.innerHTML = scratchHtml;
              const els = Array.from(holder2.children).filter((el) => (el.textContent ?? '').trim() !== '');
              const texts2 = els.map((el) => String(el.textContent ?? ''));
              if (texts2.join('\n\n') === carved.prose) {
                const htmlByScene = assignBlocksToScenes(
                  texts2,
                  els.map((el) => el.outerHTML),
                  k,
                  validSpansOf(mintedHere),
                );
                for (const [evId, html] of htmlByScene) {
                  if (savedByEvent.has(evId)) continue; // writer's saved pages win
                  savedByEvent.set(evId, html);
                  saveSceneText(
                    { projectId: storyId, eventId: evId, html, ledger: ledgerFromHtml(html), stampExtracted: true },
                    token,
                  ).catch(() => {});
                }
              }
            }
            scratchHtml = '';
            saveSceneText({ projectId: storyId, eventId: '__scratch__', html: '' }, token).catch(() => {});
            // The generation is SETTLED: a persisted in-flight marker for it
            // must not restore below (a restored ghost's prefix check read
            // "settled" as "edited" and retired freshly carved scenes —
            // live bug 2026-07-08, deleted_at exactly one poll tick after
            // mint).
            try {
              const raw = localStorage.getItem(`ff-scratch-inflight-${storyId}`);
              if (raw && JSON.parse(raw)?.braindumpId === carved.braindumpId) {
                localStorage.removeItem(`ff-scratch-inflight-${storyId}`);
              }
            } catch { /* ignore */ }
          }
          // KEEP-BIAS (Ben's law, 2026-07-08): the pipeline NEVER deletes
          // cards. Only the writer's hand (Trash) or the writer's text
          // (step 5 contribution replacement) retires anything. The old
          // stale-generation retire loop lived here and misfired four
          // separate ways in two days; a wrongly kept card is one click of
          // clutter, a wrongly deleted scene is the writer's work vanishing.
          // Suspected-stale mints are kept and logged, never touched.
          for (const b of scratchBds) {
            if (carved && b.braindumpId === carved.braindumpId) continue;
            if (norm(b.prose) === scratchNorm && carved) continue;
            const strays = mintedBy(b.braindumpId).filter(
              (ev: ProjectEntity) => !savedByEvent.has(ev.id) && String((ev as any).has_script_text ?? '') !== '1',
            );
            if (strays.length) {
              console.warn('[freeform-script] possible stale-generation mints (kept, keep-bias)', {
                braindumpId: b.braindumpId, cards: strays.map((e: ProjectEntity) => e.id),
              });
            }
          }
        }

        // The autofill roster comes from the GRAPH's cast.
        setCharacters(
          entities.entities
            .filter((e: ProjectEntity) => e.type === 'character' && !e.deleted_at)
            .map((e: ProjectEntity) => ({ id: e.id, name: e.working_name ?? '' }))
            .filter((c: any) => c.name),
        );

        const events = entities.entities.filter(
          (e: ProjectEntity) => e.type === 'event' && !e.deleted_at && e.narrative_status !== 'backstory' && !retiredIds.has(e.id),
        );
        const spine = topoSortEventsByPrecedes(events, entities.edges?.precedes ?? []);

        // ---- Left navigator: sequences group their member scenes (one section
        // per sequence at its first occurrence in the spine, same semantics as
        // the board's grid view); loose runs are headerless sections.
        const seqOfEvent = new Map<string, string>();
        for (const c of entities.edges?.contains ?? []) seqOfEvent.set(c.to, c.from);
        const seqById = new Map(
          entities.entities.filter((e: ProjectEntity) => e.type === 'sequence').map((e: ProjectEntity) => [e.id, e]),
        );
        const sections: NavSection[] = [];
        const sectionBySeq = new Map<string, NavSection>();
        const statuses = new Map<string, SceneStatus>();
        spine.forEach((ev, i) => {
          const row: NavScene = { eventId: ev.id, scNo: i + 1, title: ev.working_title ?? 'Untitled scene' };
          const sid = seqOfEvent.get(ev.id) ?? null;
          if (sid) {
            const existing = sectionBySeq.get(sid);
            if (existing) { existing.scenes.push(row); }
            else {
              const seqEnt = seqById.get(sid);
              const sec: NavSection = {
                seqId: sid,
                title: seqEnt?.working_title ?? seqEnt?.working_name ?? 'Sequence',
                color: ((seqEnt?.color ?? '') as string).trim() || '#22c55e',
                scenes: [row],
              };
              sectionBySeq.set(sid, sec);
              sections.push(sec);
            }
          } else {
            const last = sections[sections.length - 1];
            if (last && last.seqId === null) last.scenes.push(row);
            else sections.push({ seqId: null, title: '', color: '', scenes: [row] });
          }
          statuses.set(
            ev.id,
            savedByEvent.has(ev.id)
              ? (staleByEvent.get(ev.id) ? 'stale' : 'written')
              // Cleared = the writer emptied this scene's pages and has not
              // yet decided keep-vs-trash (red dot, FIL-520 round 4). A
              // "keep" acknowledgment settles it back to plain unwritten —
              // and beats the imported-span fallback (no content = no blue).
              : ev.script_text_cleared_at
              ? ((ev as any).cleared_acknowledged_at ? 'unwritten' : 'cleared')
              : ev.src_start !== undefined && ev.src_start !== ''
              ? 'stale' // imported spans, never saved/extracted as pages: grey
              : 'unwritten',
          );
        });
        setNavSections(sections);
        setStatusById(statuses);

        const baseline = new Map<string, string>();
        const parts: string[] = [];
        spine.forEach((ev) => {
          const title = ev.working_title ?? 'Untitled scene';
          let regionHtml = '';
          let persisted = '';
          const saved = savedByEvent.get(ev.id);
          if (saved) {
            regionHtml = tagFirstParagraph(saved, ev.id);
            persisted = regionHtml;
          } else if (ev.script_text_cleared_at) {
            // The writer deliberately deleted this scene's pages (FIL-520):
            // a clear must not read as "never written" — skipping the span
            // fallback is what keeps the deleted text from rehydrating out
            // of the stored braindump prose. Writing pages again lifts the
            // stamp server-side.
          } else if (ev.src_braindump && ev.src_start !== undefined && ev.src_start !== '') {
            const prose = proseByBraindump.get(String(ev.src_braindump)) ?? '';
            const start = parseInt(String(ev.src_start), 10);
            const end = parseInt(String(ev.src_end), 10);
            if (prose && Number.isFinite(start) && Number.isFinite(end) && end > start) {
              const converted = importedTextToHtml(prose.slice(start, Math.min(end, prose.length)));
              if (converted) {
                regionHtml = tagFirstParagraph(converted, ev.id);
                persisted = ''; // imported content is dirty against '' → first save persists it
              }
            }
          }
          // Unwritten scenes do NOT render in the document — a field of empty
          // anchor lines makes every stray click a false "chosen region" and
          // silently misbinds typed pages. The document holds only pages that
          // exist; starting an unwritten scene is an explicit act (panel click
          // → anchor inserted at spine position → caret placed).
          baseline.set(ev.id, persisted);
          if (regionHtml) parts.push(regionHtml);
        });

        // Settled snapshot for the OPEN TAIL (§2b, FIL-520 round 4): EVERY
        // rendered scene's blocks as loaded, keyed by scene. Content hashes
        // ride each entry so settled identity survives block-id churn. The
        // walker computes the tail dynamically from these, so a mid-session
        // whole-scene deletion retreats the tail instead of orphaning it.
        const byRegion = new Map<string, { ids: Set<string>; hashes: Set<string>; count: number }>();
        for (const ev of spine) {
          const p = parts.find((x) => x.includes(`data-scene-id="${ev.id}"`));
          if (!p) continue;
          const k = blockKeysOf(p);
          byRegion.set(ev.id, { ids: k.ids, hashes: k.hashes, count: (p.match(/<p\b/g) ?? []).length });
        }
        settledRef.current = { byRegion };
        walkTailRef.current = null;

        // Persisted scratch restores at the document BOTTOM, below every
        // region, carrying the '__scratch__' tag so the walker keeps it
        // unbound (it is the open tail awaiting its carve). With no regions
        // it is simply the whole document, as before.
        // FIL-520 dedupe: the double-capture class left scratch holding
        // COPIES of blocks that are bound in scenes (same block id, same
        // content). An exact twin is never writer content — drop it before
        // restore, and persist the cleaned scratch so a later writer
        // deletion in the scene cannot resurrect the copy. Hash-only
        // matches are kept (repeated lines are normal screenplay text).
        if (scratchHtml) {
          const boundKeys = new Set<string>();
          for (const p of parts) for (const k of blockKeysOf(p).keys) boundKeys.add(k);
          const cleaned = filterHtmlBlocks(scratchHtml, (id, text) => {
            const t = normText(text);
            if (!t) return false; // blank blocks carry nothing
            return !(id && boundKeys.has(`${id}|${strHash(t)}`));
          });
          if (cleaned !== scratchHtml) {
            console.warn('[freeform-script] scratch restore dropped double-capture twins (FIL-520)', {
              beforeChars: scratchHtml.length, afterChars: cleaned.length,
            });
            // Clean the stored buffer too ('' clears it server-side).
            void saveSceneText({ projectId: storyId, eventId: SCRATCH, html: cleaned }, token).catch(() => {});
          }
          if (cleaned) parts.push(tagFirstParagraph(cleaned, SCRATCH));
          scratchBaselineRef.current = cleaned;
        } else {
          scratchBaselineRef.current = scratchHtml;
        }

        baselineRef.current = baseline;
        spineOrderRef.current = spine.map((ev) => ev.id);
        titleByIdRef.current = new Map(spine.map((ev) => [ev.id, ev.working_title ?? 'Untitled scene']));
        precedesRef.current = [...(entities.edges?.precedes ?? [])];
        seqOfEventRef.current = seqOfEvent;
        // Reset per-document state (reloads remount the editor: the carve
        // rebuild and any future reloadTick bump).
        attachedRef.current = null;
        extractBaselineRef.current = new Map();
        for (const [, timer] of graceTimersRef.current) window.clearTimeout(timer);
        graceTimersRef.current.clear();
        // Restore a persisted in-flight generation (remount amnesia minted
        // sibling pairs): the guard survives the round trip and carve
        // polling resumes. Stale markers (>10 min) drop.
        try {
          const raw = localStorage.getItem(`ff-scratch-inflight-${storyId}`);
          if (raw && !scratchEnqueuedRef.current) {
            const m = JSON.parse(raw);
            // A marker whose generation already LANDED is settled business:
            // the reconciliation above had its chance; restoring a ghost
            // here is what produced the settled-read-as-edited retire.
            const landed = m?.braindumpId && bds.braindumps.some((x) => x.braindumpId === m.braindumpId);
            if (landed) {
              localStorage.removeItem(`ff-scratch-inflight-${storyId}`);
            } else if (m?.braindumpId && Date.now() - (m.at ?? 0) < 10 * 60 * 1000) {
              scratchEnqueuedRef.current = {
                hash: String(m.hash ?? ''),
                braindumpId: String(m.braindumpId),
                tailSceneId: m.tailSceneId ?? null,
                blocks: Array.isArray(m.blocks)
                  ? m.blocks.map((x: any) => ({ b: String(x.b ?? ''), h: String(x.h ?? ''), l: Number(x.l ?? 0), html: '', t: '' }))
                  : [],
              };
              window.setTimeout(() => { void pollCarveRef.current(); }, 4000);
            } else {
              localStorage.removeItem(`ff-scratch-inflight-${storyId}`);
            }
          }
        } catch { /* ignore */ }
        setSceneCount(spine.length);
        setInitialContent(parts.join('') || '<p data-line-type="scene"></p>');
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storyId, reloadTick]);

  // ---- The document walker: ONE pass shared by saves, extraction texts and
  // the scratch/tail routing, so every consumer agrees on what is bound and
  // what is scratch. Paragraphs group by last-seen data-scene-id; the
  // '__scratch__' tag marks persisted scratch (which now lives BELOW the
  // bound regions); and the OPEN TAIL (design doc §2b) routes: in the LAST
  // scene present at load, blocks after its last SETTLED block are unsettled
  // tail — they belong to scratch, and the carve (not the region save)
  // decides whether they extend the scene or become new scenes. Settled =
  // present at load or bound by a carve; every carve remounts, so the
  // settled snapshot is per mount. A scene STARTED from the panel after load
  // is not the settled last scene, so typing into it binds normally (the
  // §0a chosen-region act).
  type WalkBlock = { regionId: string | null; blockId: string; html: string; text: string };
  const walkDocument = useCallback((): WalkBlock[] => {
    const editors = getAllEditorsRef.current?.() ?? [];
    const out: WalkBlock[] = [];
    let currentId: string | null = null;
    for (const ed of editors) {
      const serializer = DOMSerializer.fromSchema(ed.schema);
      ed.state.doc.forEach((node: any) => {
        const tag = node.attrs?.['data-scene-id'];
        if (tag) currentId = String(tag);
        const el = document.createElement('div');
        el.appendChild(serializer.serializeNode(node));
        out.push({
          regionId: currentId,
          blockId: String(node.attrs?.['data-block-id'] ?? ''),
          html: el.innerHTML,
          text: String(node.textContent ?? ''),
        });
      });
    }
    const byRegion = settledRef.current.byRegion;
    const settledIn = (regionId: string, w: WalkBlock): boolean => {
      const s = byRegion.get(regionId);
      if (!s) return false;
      if (s.ids.has(w.blockId)) return true;
      if (s.hashes.size === 0) return false;
      const t = normText(w.text);
      return t !== '' && s.hashes.has(strHash(t));
    };
    // Reroute strips the residue scene tag from the html: a whole-scene
    // deletion leaves an EMPTY paragraph that keeps data-scene-id (FIL-520
    // fourth report), and that tag must not ride into scratch or a minted
    // scene's persisted blocks (phantom-region kindling).
    const toScratch = (w: WalkBlock, i: number) => {
      out[i] = { ...w, regionId: SCRATCH, html: w.html.replace(/\sdata-scene-id="[^"]*"/g, '') };
    };
    // Dynamic tail (FIL-520 round 4): the tail scene is the LAST region in
    // document order that still holds at least one settled CONTENT-bearing
    // block AND has persisted pages (non-empty baseline). Deleting the last
    // scene retreats the tail to the scene above; a cleared or unwritten
    // region past the tail owns nothing — everything typed there routes to
    // scratch and the carve decides bind-vs-mint (edge 35 amended: the
    // writer's click and the residue tag are evidence, never obligations).
    const regionOrder: string[] = [];
    const seen = new Set<string>();
    for (const b of out) {
      if (b.regionId && b.regionId !== SCRATCH && !seen.has(b.regionId)) {
        seen.add(b.regionId);
        regionOrder.push(b.regionId);
      }
    }
    let tailRegion: string | null = null;
    for (const rid of regionOrder) {
      const base = baselineRef.current.get(rid) ?? '';
      if (base === '') continue; // cleared/unwritten: cannot own the tail
      const hasSettledContent = out.some(
        (b) => b.regionId === rid && settledIn(rid, b) && normText(b.text) !== '',
      );
      if (hasSettledContent) tailRegion = rid;
    }
    walkTailRef.current = tailRegion;
    // Slot-candidate tracking: an unwritten/cleared region whose blocks get
    // rerouted below, and which holds actual typed text, is a slot the
    // writer navigated into and wrote — the prepass hint's candidate.
    const slotIds = new Set<string>();
    if (tailRegion) {
      const tailIdx = regionOrder.indexOf(tailRegion);
      // 1. The tail region itself: blocks past its last settled content
      //    block route to scratch (the open tail; empty settled blocks never
      //    seal it, FIL-520 third report).
      const own = out.map((b, i) => ({ b, i })).filter((x) => x.b.regionId === tailRegion);
      const s = byRegion.get(tailRegion);
      let lastSettled = -1;
      if (s && (s.ids.size || s.hashes.size)) {
        for (let j = 0; j < own.length; j++) {
          if (settledIn(tailRegion, own[j].b) && normText(own[j].b.text) !== '') lastSettled = j;
        }
      } else if (s) {
        // Pre-ledger content (no block ids at load): positional fallback.
        lastSettled = Math.min(s.count, own.length) - 1;
      }
      for (let j = lastSettled + 1; j < own.length; j++) {
        if (settledIn(tailRegion, own[j].b)) continue; // settled block moved late — stays bound
        toScratch(own[j].b, own[j].i);
      }
      // 2. Regions PAST the tail with no persisted pages (cleared residue,
      //    navigator anchors): all their blocks are unbound — typed content
      //    goes to the carve with the container as a binding candidate.
      for (let r = tailIdx + 1; r < regionOrder.length; r++) {
        const rid = regionOrder[r];
        if ((baselineRef.current.get(rid) ?? '') !== '') continue; // real pages: bound
        for (let i = 0; i < out.length; i++) {
          if (out[i].regionId === rid) {
            if (normText(out[i].text) !== '') slotIds.add(rid);
            toScratch(out[i], i);
          }
        }
      }
    } else if (regionOrder.length > 0) {
      // No region owns settled content (every scene cleared/unwritten this
      // session): nothing is bound — the whole document is the open tail.
      for (let i = 0; i < out.length; i++) {
        const rid = out[i].regionId;
        if (rid && rid !== SCRATCH && (baselineRef.current.get(rid) ?? '') === '') {
          if (normText(out[i].text) !== '') slotIds.add(rid);
          toScratch(out[i], i);
        }
      }
    }
    slotCandidatesRef.current = Array.from(slotIds);
    return out;
  }, []);

  const collectRegions = useCallback((): {
    regions: Map<string, string>;
    ledgers: Map<string, LedgerBlock[]>;
    unboundHtml: string;
    unboundText: string;
    scratchLedger: LedgerBlock[];
    scratchBlocks: Array<{ b: string; h: string; l: number; html: string; t: string }>;
  } => {
    const regions = new Map<string, string>();
    // The LEDGER rides the same walk: per region, the ordered block list
    // (id + content hash + length) — design doc §2a. Persisted alongside the
    // HTML so the backend holds current-vs-last-extracted versions.
    const ledgers = new Map<string, LedgerBlock[]>();
    const scratchBlocks: Array<{ b: string; h: string; l: number; html: string; t: string }> = [];
    let unboundHtml = '';
    let unboundText = '';
    for (const blk of walkDocument()) {
      const led: LedgerBlock = { b: blk.blockId, h: strHash(normText(blk.text)), l: blk.text.length };
      if (blk.regionId === null || blk.regionId === SCRATCH) {
        // Scratch keeps only content-bearing blocks: the block list is the
        // backend's numbered-line protocol AND the carve's reconstruction
        // source, and both need blocks == content (blank lines are not
        // content and would desync the arithmetic).
        if (blk.text.trim() === '') continue;
        unboundHtml += blk.html;
        unboundText += (unboundText ? '\n' : '') + blk.text;
        scratchBlocks.push({ ...led, html: blk.html, t: blk.text });
        continue;
      }
      regions.set(blk.regionId, (regions.get(blk.regionId) ?? '') + blk.html);
      const l = ledgers.get(blk.regionId);
      if (l) l.push(led);
      else ledgers.set(blk.regionId, [led]);
    }
    return {
      regions, ledgers, unboundHtml, unboundText,
      scratchLedger: scratchBlocks.map(({ b, h, l }) => ({ b, h, l })),
      scratchBlocks,
    };
  }, [walkDocument]);

  // Torn-down-walk guard (live bug 2026-07-07): navigating away unmounts the
  // page editors bottom-up, so an exit-time walk can see only the surviving
  // pages and CLOBBER good content with the truncation (observed: page 1 of
  // a two-page scene lost after returning from the board). A rolling
  // snapshot of the last good walk (refreshed shortly after every edit)
  // backs every exit-time consumer; a live walk that lost editors or half
  // its text is DEGRADED: saves fall back to the snapshot, enqueues and the
  // carve skip entirely (they retry on healthy walks / at next load).
  const lastGoodWalkRef = useRef<{ collected: ReturnType<typeof collectRegions>; editors: number; textLen: number } | null>(null);
  const snapTimerRef = useRef<number | null>(null);
  const totalTextOf = useCallback((c: ReturnType<typeof collectRegions>) => {
    let n = c.unboundText.length;
    for (const h of c.regions.values()) n += h.length;
    return n;
  }, []);
  const refreshWalkSnapshot = useCallback(() => {
    const editors = getAllEditorsRef.current?.()?.length ?? 0;
    if (!editors) return;
    const collected = collectRegions();
    lastGoodWalkRef.current = { collected, editors, textLen: totalTextOf(collected) };
  }, [collectRegions, totalTextOf]);
  const reliableCollect = useCallback((): { collected: ReturnType<typeof collectRegions>; degraded: boolean } => {
    let collected: ReturnType<typeof collectRegions>;
    try {
      collected = collectRegions();
    } catch (e) {
      // A destroyed editor threw mid-walk (teardown): the snapshot is all we
      // have; with no snapshot, an empty result marked degraded blocks every
      // consumer from writing.
      console.warn('[freeform-script] walk threw (teardown?); using last good snapshot', e);
      const snap = lastGoodWalkRef.current;
      return snap
        ? { collected: snap.collected, degraded: true }
        : {
            collected: { regions: new Map(), ledgers: new Map(), unboundHtml: '', unboundText: '', scratchLedger: [], scratchBlocks: [] },
            degraded: true,
          };
    }
    const editors = getAllEditorsRef.current?.()?.length ?? 0;
    const snap = lastGoodWalkRef.current;
    if (snap && (editors < snap.editors || totalTextOf(collected) < snap.textLen * 0.5)) {
      console.warn('[freeform-script] walk degraded (teardown?); using last good snapshot', {
        editors, snapEditors: snap.editors, textLen: totalTextOf(collected), snapTextLen: snap.textLen,
      });
      return { collected: snap.collected, degraded: true };
    }
    lastGoodWalkRef.current = { collected, editors, textLen: totalTextOf(collected) };
    return { collected, degraded: false };
  }, [collectRegions, totalTextOf]);

  // Unbound content is the SCRATCH buffer: persisted immediately (capture
  // never loses text) but bound to NO scene — the initial pages might be one
  // scene or four, and structure comes from the braindump-lane extraction
  // over the scratch, never from a premature single-scene mint. See
  // fireScratch / attemptScratchRebuild below for the carve.
  const SCRATCH = '__scratch__';
  const scratchBaselineRef = useRef<string>('');
  // In-flight generation: hash + the BLOCK SNAPSHOT it extracted (the
  // prefix-carve compares this against the live scratch — an unchanged
  // prefix carves, the rest stays as the next delta) + the scene the tail
  // followed (continuation target).
  const scratchEnqueuedRef = useRef<{
    hash: string;
    braindumpId: string;
    blocks: Array<{ b: string; h: string; l: number; html: string; t: string }>;
    tailSceneId: string | null;
  } | null>(null);
  // Settled blocks per scene (open tail, §2b + FIL-520 round 4): captured per
  // mount from EVERY loaded region's html. The TAIL is computed dynamically
  // at walk time (last region that still holds settled content with persisted
  // pages), so deleting the last scene mid-session retreats the tail instead
  // of leaving it aimed at a dead id. Blocks beyond the tail's settled
  // content, and ALL blocks in cleared/unwritten regions past the tail,
  // route to scratch for the carve.
  const settledRef = useRef<{ byRegion: Map<string, { ids: Set<string>; hashes: Set<string>; count: number }> }>({
    byRegion: new Map(),
  });
  // The tail scene id as of the LAST document walk (null = no tail scene).
  // Set by walkDocument; read by fireScratch (floor + tailContext).
  const walkTailRef = useRef<string | null>(null);
  // Slot candidates as of the LAST walk: unwritten/cleared outline slots
  // whose typed content was rerouted to scratch. The writer navigated there
  // and typed — that intent rides to the prepass as EVIDENCE (edge 35: never
  // a binding obligation; the carve still decides bind-vs-mint).
  const slotCandidatesRef = useRef<string[]>([]);
  // Diff recognition (server-anchored): normalized hashes of every scratch
  // snapshot that has EVER been extracted — seeded at load from the stored
  // scratch braindump prose, extended on each enqueue. Unchanged text can
  // never re-extract, across blurs, reloads, or retire cycles.
  const extractedScratchHashesRef = useRef<Set<string>>(new Set());
  // Settling: scratch extracts only after the text has been stable ~10s —
  // active writing defers, a real pause extracts once.
  const scratchSeenRef = useRef<{ hash: string; at: number } | null>(null);
  // In-flight generation marker, persisted per story: the one-generation-at-
  // a-time guard must survive remounts AND client-side enqueue errors whose
  // request actually landed (observed live 2026-07-07: a cleared guard
  // re-fired the same text 4.7s later and minted sibling scene pairs).
  const inflightKey = `ff-scratch-inflight-${storyId ?? ''}`;
  const persistInflight = useCallback((m: { braindumpId: string; hash: string; tailSceneId: string | null; blocks: Array<{ b: string; h: string; l: number }> }) => {
    try { localStorage.setItem(inflightKey, JSON.stringify({ ...m, at: Date.now() })); } catch { /* quota */ }
  }, [inflightKey]);
  const clearInflight = useCallback(() => {
    try { localStorage.removeItem(inflightKey); } catch { /* ignore */ }
  }, [inflightKey]);

  const runSave = useCallback(async () => {
    const a = authRef.current;
    if (!a || !storyId) return;
    if (carvingRef.current) return; // carve window: the document is mid-rebind
    // Degraded walks still save — from the snapshot, never the truncation.
    const { collected, degraded } = reliableCollect();
    const { regions, ledgers, unboundHtml, unboundText, scratchLedger } = collected;
    // Unbound content persists as the scratch buffer — captured, unbound,
    // structure decided later by extraction (never a premature scene mint).
    if (unboundText.trim() !== '' && unboundHtml !== scratchBaselineRef.current) {
      try {
        await saveSceneText({ projectId: storyId, eventId: SCRATCH, html: unboundHtml, ledger: scratchLedger }, a.token);
        scratchBaselineRef.current = unboundHtml;
      } catch (e) {
        console.warn('[freeform-script] scratch save failed', e);
      }
    }
    const dirty: Array<{ eventId: string; html: string }> = [];
    for (const [eventId, html] of regions) {
      if (!baselineRef.current.has(eventId)) continue; // not one of ours
      const base = baselineRef.current.get(eventId);
      // A region that is still just the untouched skeleton line never persists.
      const textOnly = html.replace(/<[^>]*>/g, '').trim();
      if (!base && textOnly === '') continue;
      // ZERO-CONTENT region with persisted pages = whole-scene deletion,
      // even though a residue paragraph survives (FIL-520 fourth report:
      // select-and-delete keeps one empty block CARRYING THE SCENE TAG, so
      // the region never reads as absent and the old detector missed it).
      // Handled with the absent-region clears below.
      if (base && textOnly === '') continue;
      if (html !== base) dirty.push({ eventId, html });
    }
    // WHOLE-SCENE DELETION (FIL-520 second + fourth reports): a baselined
    // region that a HEALTHY walk shows as gone OR emptied is the writer's
    // hand: persist the clear ('' deletes the stored pages; the backend
    // stamps the scene cleared, retires its scene-anchored facts via the
    // sweep, and the load skips span rehydration). Degraded walks never
    // qualify — a teardown truncation losing regions is the clobber class
    // the snapshot guard exists for.
    // MASS-CLEAR GUARD (2026-07-21, after a reload-race wiped every scene at
    // once): if NO baselined region still holds content in this walk, the editor
    // failed to load its pages (a remount race), not the writer deleting the
    // whole script by hand. Keep-bias law: the pipeline never deletes, and the
    // writer never empties every scene simultaneously. Require at least one
    // written region to still have content before any clear may persist. This
    // blocks only the pathological all-empty walk; a normal single-scene delete
    // (other scenes still present) is untouched.
    const anyRegionHasContent = Array.from(baselineRef.current.entries()).some(([eid, b]) => {
      if (eid === SCRATCH || !b) return false;
      const cur = regions.get(eid);
      return cur !== undefined && cur.replace(/<[^>]*>/g, '').trim() !== '';
    });
    if (!degraded && !anyRegionHasContent) {
      console.warn('[freeform-script] mass-clear BLOCKED: the whole document read empty (likely a reload race); no scene text cleared.');
    }
    if (!degraded && anyRegionHasContent) {
      for (const [eventId, base] of baselineRef.current) {
        if (eventId === SCRATCH || !base) continue;
        const cur = regions.get(eventId);
        const emptied = cur !== undefined && cur.replace(/<[^>]*>/g, '').trim() === '';
        if (cur !== undefined && !emptied) continue; // real pages present
        try {
          await saveSceneText({ projectId: storyId, eventId, html: '' }, a.token);
          baselineRef.current.set(eventId, '');
          extractBaselineRef.current.delete(eventId);
          setStatusById((cur2) => {
            const next = new Map(cur2);
            next.set(eventId, 'cleared');
            return next;
          });
          console.info('[freeform-script] whole-scene deletion persisted (pages cleared)', { eventId, emptied });
        } catch (e) {
          console.warn('[freeform-script] whole-scene clear failed (will retry next save)', e);
        }
      }
    }
    if (dirty.length === 0) { setSaveState((s) => (s === 'dirty' ? 'saved' : s)); return; }
    setSaveState('saving');
    try {
      for (const { eventId, html } of dirty) {
        await saveSceneText({ projectId: storyId, eventId, html, ledger: ledgers.get(eventId) }, a.token);
        baselineRef.current.set(eventId, html);
      }
      setStatusById((cur) => {
        const next = new Map(cur);
        for (const { eventId, html } of dirty) {
          // Freshness follows the extraction baseline: material drift since
          // the last extraction reads grey; sub-floor edits keep their color
          // (the backend verdict uses the same ~50-char mass).
          const textOnly = html.replace(/<[^>]*>/g, '').trim();
          const base = extractBaselineRef.current.get(eventId) ?? '';
          if (textOnly === base) next.set(eventId, 'written');
          else if (Math.abs(textOnly.length - base.length) >= 50 || base === '') next.set(eventId, 'stale');
          else if (!next.has(eventId) || next.get(eventId) === 'unwritten' || next.get(eventId) === 'cleared') next.set(eventId, 'written');
        }
        return next;
      });
      setSaveState('saved');
    } catch (e) {
      console.warn('[freeform-script] save failed', e);
      setSaveState('error');
    }
  }, [storyId, reliableCollect]);

  // ---- Scene-exit extraction trigger (design doc build step 4) --------------
  // A scene whose region text changed extracts when the writer's attention
  // moves on: caret leaves the region → 8s grace (re-entry cancels) → delta
  // floor (~50 chars vs last extraction) → enqueue. The backend re-checks with
  // a content hash and the cascade gate, so FE checks are optimizations, not
  // the contract. Tab-hide fires pending checks immediately.
  const extractBaselineRef = useRef<Map<string, string>>(new Map());
  const graceTimersRef = useRef<Map<string, number>>(new Map());
  const prevActiveRef = useRef<string | null>(null);

  const collectRegionTexts = useCallback((): Map<string, string> => {
    // Same walker as saves — the scene-exit lane must agree with the routing
    // (unsettled tail text is scratch's, never the scene's).
    const regions = new Map<string, string>();
    for (const blk of walkDocument()) {
      if (!blk.regionId || blk.regionId === SCRATCH) continue;
      regions.set(blk.regionId, (regions.get(blk.regionId) ?? '') + (regions.has(blk.regionId) ? '\n' : '') + blk.text);
    }
    return regions;
  }, [walkDocument]);

  // After an extraction lands (async, ~12-15s), the scene may have been NAMED
  // by it (placeholder titles) and its outline contributions changed. Refresh
  // panel titles in place shortly after each enqueue (v1 stand-in for WS
  // wiring in this view).
  const refreshTitles = useCallback(async () => {
    const a = authRef.current;
    if (!a || !storyId) return;
    try {
      const res = await listProjectEntities({ projectId: storyId }, a.token);
      const titles = new Map(
        res.entities
          .filter((e: ProjectEntity) => e.type === 'event' && !e.deleted_at)
          .map((e: ProjectEntity) => [e.id, e.working_title ?? '']),
      );
      let changed = false;
      for (const [id, t] of titles) {
        if (t && titleByIdRef.current.get(id) !== t) {
          titleByIdRef.current.set(id, t);
          changed = true;
        }
      }
      if (changed) {
        setNavSections((cur) =>
          cur.map((sec) => ({
            ...sec,
            scenes: sec.scenes.map((sc) => {
              const t = titles.get(sc.eventId);
              return t && t !== sc.title ? { ...sc, title: t } : sc;
            }),
          })),
        );
      }
    } catch { /* best-effort */ }
  }, [storyId]);

  // ---- Scratch extraction: unbound writing past the ~200-char content floor
  // goes through the BRAINDUMP lane (screenplay mode) — the one context where
  // extraction decides structure. It mints however many scenes the pages
  // contain (plus cast/facts/knowledge), stamps source spans, and the view
  // then rebuilds the document with the text bound to the minted scenes.
  const attemptScratchRebuild = useCallback(async () => {
    const a = authRef.current;
    const enq = scratchEnqueuedRef.current;
    if (!a || !storyId || !enq) return;
    // A degraded walk must never drive the carve: the prefix-compare would
    // read truncation as "writer edited the snapshot" and wrongly retire
    // minted cards. Retry later / at next load instead.
    const { collected, degraded } = reliableCollect();
    if (degraded) return;
    const { scratchBlocks } = collected;
    try {
      const [res, bds] = await Promise.all([
        listProjectEntities({ projectId: storyId }, a.token),
        listBraindumps({ projectId: storyId }, a.token).catch(() => ({ projectId: storyId, braindumps: [] })),
      ]);
      const bd = bds.braindumps.find((b) => b.braindumpId === enq.braindumpId);
      const minted = res.entities.filter(
        (e: ProjectEntity) => e.type === 'event' && !e.deleted_at && String(e.src_braindump ?? '') === enq.braindumpId,
      );
      // Landed = the generation's Braindump vertex exists (a PURE
      // continuation mints no events at all — §2c).
      if (!bd && minted.length === 0) return; // not landed yet; the later timer retries
      // FAIL-SAFE (capture is sacred): a generation that landed with nothing
      // bindable — no continuation, no minted scenes we can find by
      // src_braindump — must NEVER consume the scratch (observed live
      // 2026-07-07: span-less mints made the carve clear scratch it could
      // not account for, erasing the writer's paste from the document).
      // Release the guard and keep the text; any cards it minted sit on the
      // board unbound, recoverable.
      if (minted.length === 0 && (bd?.continuationBlocks ?? 0) === 0) {
        console.warn('[freeform-script] generation landed with nothing bindable; keeping scratch', { braindumpId: enq.braindumpId });
        scratchEnqueuedRef.current = null;
        clearInflight();
        return;
      }
      // PREFIX-CARVE (§2c, delta-scoped always): the generation consumed the
      // block snapshot it was enqueued with. If those blocks are an UNCHANGED
      // PREFIX of the live scratch, carve them and keep the remainder as the
      // next delta — out-typing no longer retires anything.
      const pref = enq.blocks;
      const prefixIntact =
        pref.length <= scratchBlocks.length &&
        pref.every((p, i) => scratchBlocks[i].b === p.b && scratchBlocks[i].h === p.h);
      if (!prefixIntact) {
        // KEEP-BIAS (Ben's law, 2026-07-08): the pipeline never deletes.
        // A broken prefix means EITHER the writer edited inside the snapshot
        // OR this generation was already settled elsewhere (a reconciliation
        // consumed the scratch; a restored marker's ghost saw it empty —
        // the exact misread that trashed fresh scenes twice). Both cases:
        // release the guard, keep every card and every block. Re-extraction
        // reuses titles (known-outline feed) so upserts, not siblings; the
        // rare drift twin is visible clutter the writer can trash.
        console.warn('[freeform-script] generation prefix mismatch; releasing guard, keeping everything', {
          braindumpId: enq.braindumpId, minted: minted.length, liveBlocks: scratchBlocks.length, snapshotBlocks: pref.length,
        });
        scratchEnqueuedRef.current = null;
        clearInflight();
        return;
      }
      // Carve persistence begins: freeze saves and kill any queued debounce —
      // a save walking the pre-reload document would resurrect stale scratch.
      carvingRef.current = true;
      if (saveTimerRef.current) { window.clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
      // Continuation append (§2c): the generation's opening blocks extend the
      // scene the tail followed. Persist the merged scene html and dirty it —
      // the scene-pages lane extracts the appended facts with FULL scene
      // context (granularity enforcement lives there).
      // NOTE: html/text come from the LIVE scratch blocks, not the snapshot —
      // a marker restored from localStorage carries only {b,h,l}, and the
      // intact prefix guarantees identical content at the same indices.
      const k = bd?.continuationBlocks ?? 0;
      if (k > 0 && enq.tailSceneId) {
        const contHtml = stripSceneTags(scratchBlocks.slice(0, k).map((x) => x.html).join(''));
        if (textAlreadyBound(contHtml, baselineRef.current.values())) {
          console.warn('[freeform-script] continuation already bound; skipping merge');
        } else {
        const merged = (baselineRef.current.get(enq.tailSceneId) ?? '') + contHtml;
        await saveSceneText({ projectId: storyId, eventId: enq.tailSceneId, html: merged }, a.token);
        baselineRef.current.set(enq.tailSceneId, merged);
        // FIL-520: the appended blocks are BOUND now (settled = bound by a
        // carve). Register them in the scene's settled snapshot immediately
        // so no walk between here and the remount re-routes them to scratch.
        {
          let reg = settledRef.current.byRegion.get(enq.tailSceneId);
          if (!reg) {
            reg = { ids: new Set(), hashes: new Set(), count: 0 };
            settledRef.current.byRegion.set(enq.tailSceneId, reg);
          }
          for (const x of scratchBlocks.slice(0, k)) {
            if (x.b) reg.ids.add(x.b);
            const t = normText(x.t);
            if (t) reg.hashes.add(strHash(t));
          }
        }
        const sceneText =
          (collectRegionTexts().get(enq.tailSceneId) ?? '') + '\n' + scratchBlocks.slice(0, k).map((x) => x.t).join('\n');
        trackSceneExtraction();
        if (storyId) pulseExtractionGlobal(storyId);
        enqueueSceneExtraction(
          { projectId: storyId, eventId: enq.tailSceneId, userId: a.userId, sceneText },
          a.token,
        ).catch((e) => console.warn('[freeform-script] continuation scene extraction enqueue failed', e));
        }
      }
      // Minted scenes persist their ACTUAL formatted blocks as SceneText
      // before the reload, so the rebuild renders the writer's real
      // paragraphs (line types, block ids) — never importedTextToHtml's
      // rederived guesses (live bug 2026-07-07: manual character/dialogue
      // assignments flattened to action after a carve).
      if (minted.length) {
        // Duplicate net: if an existing bound scene already carries this
        // exact text, the mint is a double-run artifact (enqueue retry,
        // remount amnesia) — trash it instead of binding a twin.
        const stripped = (h: string) => strHash(normText(h.replace(/<[^>]+>/g, ' ')));
        const existingNorm = new Set<string>();
        for (const html of baselineRef.current.values()) if (html) existingNorm.add(stripped(html));
        const carvedBlocks = scratchBlocks.slice(0, pref.length);
        const htmlByScene = assignBlocksToScenes(
          carvedBlocks.map((x) => x.t),
          carvedBlocks.map((x) => x.html),
          k,
          validSpansOf(minted),
        );
        for (const [evId, html] of htmlByScene) {
          if (existingNorm.has(stripped(html))) {
            // KEEP-BIAS: a twin mint stays on the board (unbound, visible,
            // one click to trash) — the pipeline never deletes.
            console.warn('[freeform-script] minted scene duplicates an existing bound scene; left unbound (keep-bias)', { evId });
            continue;
          }
          try {
            // Strip stale region tags (the blocks came from scratch and
            // carry __scratch__ on their first paragraph) — stored pages
            // must never embed another region's identity (FIL-520 forensics
            // found carve-persisted html tagged __scratch__; the load
            // re-tags, so it was cosmetic, but tags in stored html are how
            // phantom regions start).
            {
              const cleanHtml = stripSceneTags(html);
              await saveSceneText(
                { projectId: storyId, eventId: evId, html: cleanHtml, ledger: ledgerFromHtml(cleanHtml), stampExtracted: true },
                a.token,
              );
            }
          } catch (e) {
            console.warn('[freeform-script] carve slice save failed (reload falls back to spans)', e);
          }
        }
      }
      // Scratch keeps ONLY the remainder (typed after the snapshot): it is
      // the next delta. The reload rebinds carved text to its scenes.
      const remainderHtml = scratchBlocks.slice(pref.length).map((x) => x.html).join('');
      await saveSceneText({ projectId: storyId, eventId: SCRATCH, html: remainderHtml }, a.token);
      scratchBaselineRef.current = remainderHtml;
      scratchEnqueuedRef.current = null;
      clearInflight();
      setReloadTick((t) => t + 1);
    } catch {
      carvingRef.current = false; // carve aborted: saves resume, later timer retries
    }
  }, [storyId, reliableCollect, collectRegionTexts, clearInflight, trackSceneExtraction]);

  // Carve polling: keeps checking for the in-flight generation until it
  // lands (extractions can run past the old fixed 30/60s checks). After ~5
  // minutes without a landing the guard releases and the hash unblocks, so
  // the next settle may retry.
  const scratchPollRef = useRef<number | null>(null);
  const pollCarve = useCallback(async (attempt = 0) => {
    if (!scratchEnqueuedRef.current) { clearInflight(); return; }
    await attemptScratchRebuild();
    const still = scratchEnqueuedRef.current;
    if (!still) { clearInflight(); return; }
    if (attempt >= 12) {
      console.warn('[freeform-script] scratch generation never landed; releasing guard', { braindumpId: still.braindumpId });
      extractedScratchHashesRef.current.delete(still.hash);
      scratchEnqueuedRef.current = null;
      clearInflight();
      return;
    }
    if (scratchPollRef.current) window.clearTimeout(scratchPollRef.current);
    scratchPollRef.current = window.setTimeout(() => { void pollCarve(attempt + 1); }, attempt < 4 ? 15000 : 30000);
  }, [attemptScratchRebuild, clearInflight]);
  const pollCarveRef = useRef(pollCarve);
  pollCarveRef.current = pollCarve;

  const fireScratch = useCallback((opts?: { immediate?: boolean }) => {
    console.info('[freeform-script] fireScratch', { immediate: !!opts?.immediate });
    const a = authRef.current;
    if (!a || !storyId) { console.info('[freeform-script] scratch gated: no auth/story'); return; }
    // One scratch generation at a time: while an extraction is in flight or
    // awaiting its carve, no new one may start (prevents sibling mints).
    if (scratchEnqueuedRef.current) {
      console.info('[freeform-script] scratch gated: generation in flight', { braindumpId: scratchEnqueuedRef.current.braindumpId });
      void attemptScratchRebuild();
      return;
    }
    // Cross-tab guard: the in-memory guard is per tab, so a second tab on
    // the same story can double-run the same paste (observed live
    // 2026-07-08: two tabs enqueued 2.5s apart → sibling pairs, and the
    // duplicate net missed because each tab carved against its own
    // baseline). A fresh marker we did not write means another tab owns the
    // in-flight generation: yield this round; the settle chain rechecks
    // after it clears.
    try {
      const raw = localStorage.getItem(inflightKey);
      if (raw) {
        const m = JSON.parse(raw);
        if (Date.now() - (m?.at ?? 0) < 10 * 60 * 1000) {
          console.warn('[freeform-script] in-flight generation held elsewhere; yielding', { braindumpId: m?.braindumpId });
          window.setTimeout(() => fireScratch(), 15000);
          return;
        }
        localStorage.removeItem(inflightKey);
      }
    } catch { /* ignore */ }
    // Never enqueue from a degraded walk (teardown truncation would extract
    // and mint against partial text). The next healthy settle covers it.
    const { collected, degraded } = reliableCollect();
    if (degraded) { console.info('[freeform-script] scratch gated: degraded walk'); return; }
    const { scratchBlocks } = collected;
    // Prose IS the blocks joined by blank lines — the backend's block-index
    // path verifies this equality before trusting the arithmetic (§2c-ii).
    const prose = scratchBlocks.map((x) => x.t).join('\n\n');
    // Unbound content floor (design doc): ~200 chars for auto triggers, so
    // scribbles never mint junk cards. HARD EXITS with a tail scene to fold
    // into drop to ~60 (FIL-520): a writer who extends their last scene by
    // a line or two and hits Sync/leaves is a CONTINUATION candidate — the
    // prepass verdict folds it into the scene for ~1c — and under the old
    // floor that text sat in scratch forever (observed live: a 196-char
    // tail never extracted, reading as "editing does nothing").
    const floor = opts?.immediate && walkTailRef.current ? 60 : 200;
    if (prose.trim().length < floor) {
      console.info('[freeform-script] scratch gated: under content floor', { chars: prose.trim().length, floor, blocks: scratchBlocks.length });
      return;
    }
    const hash = strHash(normText(prose));
    // Diff recognition: this exact text was already extracted (possibly in a
    // prior session — seeded from the stored braindump prose at load).
    if (extractedScratchHashesRef.current.has(hash)) {
      console.info('[freeform-script] scratch gated: hash already extracted', { chars: prose.length });
      return;
    }
    // Settling: defer while the text is still moving; re-check shortly.
    // HARD EXITS bypass this (immediate): leaving to the board, tab-hide,
    // and Sync mean the writer is done — the text cannot still be moving,
    // and the deferred rechecks would fire against a torn-down document
    // (degraded guard drops them) so the tail would wait for the NEXT
    // trigger instead. Floors, hash dedup, and the one-generation guard
    // above still apply.
    const now = Date.now();
    if (!opts?.immediate) {
      const seen = scratchSeenRef.current;
      if (!seen || seen.hash !== hash) {
        scratchSeenRef.current = { hash, at: now };
        window.setTimeout(() => fireScratch(), 12000);
        return;
      }
      if (now - seen.at < 10000) {
        window.setTimeout(() => fireScratch(), 12000);
        return;
      }
    }
    const braindumpId = `scratch_${Date.now()}`;
    // Tail context (§2c): the scene this tail follows, for the continuation
    // verdict. Blocks give the prepass its numbered lines (§2c-ii); both are
    // omitted for very large pastes (the windowed import owns those).
    const tailSceneId = walkTailRef.current;
    const tailTitle = tailSceneId ? titleByIdRef.current.get(tailSceneId) ?? '' : '';
    const tailText = tailSceneId ? (collectRegionTexts().get(tailSceneId) ?? '').slice(-300) : '';
    // Splice anchor (Ben's call, 2026-07-16): a Branch-B mint APPENDS after
    // the whole existing spine — a cleared scene keeps its number as an
    // unwritten outline slot instead of being displaced. The continuation
    // candidate above stays the last CONTENT scene; these are different
    // roles (anchoring the chain vs judging extend-vs-mint).
    const spliceAnchorId = spineOrderRef.current.length > 0
      ? spineOrderRef.current[spineOrderRef.current.length - 1]
      : tailSceneId;
    // Typed-into-slot candidates (edge 35): the writer navigated into these
    // unwritten/cleared outline slots and typed there. Evidence for the
    // prepass bind decision, never an obligation.
    const slotCandidates = slotCandidatesRef.current
      .map((id) => ({ sceneId: id, title: titleByIdRef.current.get(id) ?? '' }))
      .filter((c) => c.title)
      .slice(0, 3);
    const sendBlocks = prose.length <= 40000;
    scratchEnqueuedRef.current = { hash, braindumpId, blocks: scratchBlocks, tailSceneId };
    persistInflight({ braindumpId, hash, tailSceneId, blocks: scratchBlocks.map(({ b, h, l }) => ({ b, h, l })) });
    extractedScratchHashesRef.current.add(hash);
    pulseExtractionGlobal(storyId);
    enqueueExtractionJob(
      {
        jobType: 'extract-braindump', projectId: storyId, userId: a.userId, braindumpId,
        prose, sourceFormat: 'screenplay',
        // Card-by-card reveal on an open board (entity_streamed): the tail
        // lane streams like typed braindumps do. Spans + the continuation
        // verdict are path-independent (stamped in common post-LLM code).
        streaming: true,
        ...(sendBlocks ? { blocks: scratchBlocks.map((x) => ({ b: x.b, t: x.t })) } : {}),
        ...(sendBlocks && tailTitle ? { tailContext: { sceneTitle: tailTitle, tailText } } : {}),
        ...(sendBlocks && slotCandidates.length ? { slotCandidates } : {}),
        // Spine anchor (§2c): the backend chains tailScene → minted scenes
        // in span order, so a tail mint can never float disconnected.
        ...(sendBlocks && tailSceneId ? { tailSceneId } : {}),
        // Append anchor: mints chain after the END of the spine (trailing
        // unwritten/cleared slots keep their numbers, Branch B).
        ...(sendBlocks && spliceAnchorId ? { spliceAnchorId } : {}),
      },
      a.token,
    ).then(() => {
      window.setTimeout(() => { void pollCarveRef.current(); }, 20000);
    }).catch((e) => {
      // The request may have LANDED despite the client-side error: the old
      // clear-and-retry here double-ran the same text 4.7s apart and minted
      // sibling scene pairs (observed live 2026-07-07). Keep the guard and
      // poll; pollCarve releases it after ~5 minutes if nothing ever lands.
      console.warn('[freeform-script] scratch enqueue errored; treating as possibly landed', e);
      window.setTimeout(() => { void pollCarveRef.current(); }, 20000);
    });
  }, [storyId, reliableCollect, collectRegionTexts, attemptScratchRebuild, persistInflight]);

  const fireExtract = useCallback((eventId: string, opts?: { manual?: boolean; attentionHint?: string; hard?: boolean }) => {
    if (eventId === SCRATCH) { fireScratch(opts?.hard ? { immediate: true } : undefined); return; }
    const a = authRef.current;
    if (!a || !storyId) return;
    if (!baselineRef.current.has(eventId)) return; // not one of our regions
    if (reliableCollect().degraded) return; // teardown walk: no enqueues
    const text = collectRegionTexts().get(eventId) ?? '';
    if (!text.trim()) return;
    const base = extractBaselineRef.current.get(eventId) ?? '';
    // Manual (highlight-extract) is writer intent: skip the session-baseline
    // and delta-floor checks — the backend hash (text + hint) still dedups a
    // true no-op for the cost of one read.
    if (!opts?.manual) {
      if (text === base) return;
      // Delta floor: typo-grade edits stay dirty for a later, bigger change (or
      // the backend's stale-gate catch-up when it matters).
      if (base !== '' && Math.abs(text.length - base.length) < 50) return;
    }
    extractBaselineRef.current.set(eventId, text);
    // Snapshot the region's ledger at enqueue: the worker stamps it as
    // ledger_extracted on success (the two-version anchor, design doc §2a).
    const ledger = collectRegions().ledgers.get(eventId);
    trackSceneExtraction();
    // §5 visibility: this scene's open notes are about to be re-judged at the
    // extraction tail; surface it. Sig snapshot marks what "settled" means.
    if (allNotesRef.current.some((n) => (n.event_id ?? '') === eventId)) {
      setReviewingScenes((cur) => new Map(cur).set(eventId, { at: Date.now(), sig: sceneNotesSig(eventId) }));
    }
    pulseExtractionGlobal(storyId);
    enqueueSceneExtraction(
      {
        projectId: storyId, eventId, userId: a.userId, sceneText: text, ledger,
        ...(opts?.attentionHint ? { attentionHint: opts.attentionHint } : {}),
      },
      a.token,
    ).then(() => {
      window.setTimeout(() => { void refreshTitles(); }, 20000);
      window.setTimeout(() => {
        void refreshTitles();
        // Freshness dot: the extraction has had its window; if the pages
        // haven't moved since the enqueue, the scene reads current again.
        // (Server truth re-asserts on every load via the bulk staleness.)
        if ((collectRegionTexts().get(eventId) ?? '') === extractBaselineRef.current.get(eventId)) {
          setStatusById((cur) => {
            const next = new Map(cur);
            if (next.get(eventId) === 'stale') next.set(eventId, 'written');
            return next;
          });
        }
      }, 45000);
    }).catch((e) => {
      console.warn('[freeform-script] scene extraction enqueue failed', e);
      setReviewingScenes((cur) => { const next = new Map(cur); next.delete(eventId); return next; });
      extractBaselineRef.current.set(eventId, base); // retry on next exit
      pendingScenesRef.current = Math.max(0, pendingScenesRef.current - 1);
    });
  }, [storyId, collectRegionTexts, collectRegions, reliableCollect, refreshTitles, fireScratch, trackSceneExtraction]);

  const scheduleExtractCheck = useCallback((eventId: string) => {
    // Manual-only preference: no auto trigger ever schedules. Sync, the
    // highlight-extract, and the peer's stale-gate are the update paths —
    // safe because staleness is backend truth (design doc §3).
    if (manualOnlyRef.current) return;
    const existing = graceTimersRef.current.get(eventId);
    if (existing) window.clearTimeout(existing);
    graceTimersRef.current.set(
      eventId,
      window.setTimeout(() => {
        graceTimersRef.current.delete(eventId);
        fireExtract(eventId);
      }, 8000),
    );
  }, [fireExtract]);

  // Exit detection: the active scene changed → the previous one was exited
  // (grace starts); re-entering a scene cancels its pending check.
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeSceneId;
    if (activeSceneId) {
      const pending = graceTimersRef.current.get(activeSceneId);
      if (pending) {
        window.clearTimeout(pending);
        graceTimersRef.current.delete(activeSceneId);
      }
    }
    if (prev && prev !== activeSceneId) {
      scheduleExtractCheck(prev);
      // Scene jumps arm the TAIL's settle-watcher too: navigator deep links
      // re-focus the editor (no blur ever fires), so without this a writer
      // who adds tail text and hops to another scene never extracts it.
      scheduleExtractCheck(SCRATCH);
    }
  }, [activeSceneId, scheduleExtractCheck]);

  // Step 8 — DOCUMENT-WIDE notes: load + quiet refresh. includeResolved so
  // AUTO-RESOLVED notes (the §5 re-eval pass, which runs server-side after a
  // scene-pages extraction) come back as records: a note the rewrite cleared
  // leaves the open set and appears struck in the docket with the peer's mark.
  // The recent window keeps ancient history out of the record.
  const refreshNotes = useCallback(async (initial?: boolean) => {
    const a = authRef.current;
    if (!a || !storyId) return;
    if (initial) { setNotesBusy(true); setNotesError(''); setStatusToastDismissed(false); }
    try {
      const res = await listProjectNotes({ projectId: storyId, includeResolved: true }, a.token);
      const all = res.notes ?? [];
      const AUTO_LOG_WINDOW_MS = 72 * 3600 * 1000;
      const cutoff = Date.now() - AUTO_LOG_WINDOW_MS;
      setAllNotes(all.filter((n) => n.state === 'open'));
      setAutoLog(all.filter((n) => n.state === 'resolved' && n.settled_by === 'auto' && Date.parse(n.state_changed_at || '') > cutoff));
      setNotesLoaded(true);
    } catch (e: any) {
      if (initial) setNotesError(String(e?.message ?? e));
    } finally {
      if (initial) setNotesBusy(false);
    }
  }, [storyId]);

  // Initial load once the story is ready (not gated on the layer being open)
  // so the toolbar badge shows the count before the writer toggles notes on.
  // Depends on `auth` so it re-runs when auth resolves after mount.
  useEffect(() => {
    if (notesLoaded || !auth || !storyId) return;
    void refreshNotes(true);
  }, [notesLoaded, storyId, auth, refreshNotes]);

  // Quiet poll while notes exist: auto-resolve happens server-side after
  // extractions, and this is how the docket learns a rewrite cleared a note
  // (no WS lane for notes yet). Visible tab only.
  useEffect(() => {
    if (!notesLoaded) return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshNotes(); }, 45000);
    const onVis = () => { if (document.visibilityState === 'visible') void refreshNotes(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [notesLoaded, refreshNotes]);

  // Reopen an AUTO-resolved note from its record row: back to open on the
  // vertex, back into the active set locally.
  const unsettleAutoNote = useCallback(async (noteId: string) => {
    const a = authRef.current;
    if (!a || !storyId) return;
    setAutoLog((log) => {
      const n = log.find((x) => x.id === noteId);
      if (n) setAllNotes((cur) => (cur.some((x) => x.id === noteId) ? cur : [...cur, { ...n, state: 'open' }]));
      return log.filter((x) => x.id !== noteId);
    });
    try {
      await setNoteState({ projectId: storyId, noteId, state: 'open' }, a.token);
    } catch (e) {
      console.warn('[freeform-script] reopen auto-resolved note failed', { noteId, error: e });
    }
  }, [storyId]);

  // Step 8 — GENERATE per scene (invoked from the navigator's peer button on a
  // scene row). Runs the screenplay peer on THAT scene, opens the Pins layer,
  // and merges the fresh notes into the document-wide set (the backend already
  // retired the scene's prior open notes, so we replace its slice wholesale).
  const readScene = useCallback(async (eventId: string) => {
    const a = authRef.current;
    if (!a || !storyId || !eventId || eventId === SCRATCH) return;
    const title = titleByIdRef.current.get(eventId) ?? '';
    if (!title) { setNotesError('This scene has no pages to note on yet.'); return; }
    setNotesOpen(true);
    setReadingScene(eventId);
    setNotesError(''); setStatusToastDismissed(false);
    try {
      const res = await requestScreenplayNotes(
        { projectId: storyId, cardId: eventId, focalId: title },
        a.token,
      );
      if (res.skipped) {
        setNotesError(res.reason ?? 'This scene has no pages to note on yet.');
      } else {
        const fresh = (res.notes ?? []).map((n) => ({ ...n, event_id: n.event_id || eventId }));
        setAllNotes((cur) => [...cur.filter((n) => (n.event_id ?? '') !== eventId), ...fresh]);
        setNotesLoaded(true);
      }
    } catch (e: any) {
      setNotesError(String(e?.message ?? e));
    } finally {
      setReadingScene((c) => (c === eventId ? null : c));
    }
  }, [storyId]);

  // Mode B — read a whole SEQUENCE with the peer: member pages in spine order
  // + sliceForSequence; notes anchor across members and land in the same
  // docket/pins surfaces (mode='sequence', SEQ chip).
  const [readingSeq, setReadingSeq] = useState<string | null>(null);
  const readSequence = useCallback(async (seqId: string, title: string) => {
    const a = authRef.current;
    if (!a || !storyId || !seqId || readingSeq) return;
    setReadingSeq(seqId);
    setNotesOpen(true);
    setNotesError(''); setStatusToastDismissed(false);
    try {
      const res = await requestScreenplayNotes({ projectId: storyId, cardId: seqId, focalId: title, focalType: 'sequence' }, a.token);
      if (res.skipped) {
        setNotesError(res.reason ?? 'This sequence has no pages to note on yet.');
      } else {
        const fresh = res.notes ?? [];
        setAllNotes((cur) => [...cur.filter((n) => !(n.mode === 'sequence' && n.seq_id === seqId)), ...fresh]);
        setNotesLoaded(true);
      }
    } catch (e: any) {
      setNotesError(String(e?.message ?? e));
    } finally {
      setReadingSeq((c) => (c === seqId ? null : c));
    }
  }, [storyId, readingSeq]);

  // Mode C — the DRAFT read (the professional read-through): 3 blind spine
  // reads over the story shape + 2-of-3 consensus commit. Two calls,
  // progressive: the committed notes render immediately (unanchored, pinned to
  // their primary scene), then the grounding pass lands verbatim anchors in
  // the background (pages-disproven notes retire and drop from the set).
  const [readingDraft, setReadingDraft] = useState(false);
  const [draftVerdict, setDraftVerdict] = useState<string>(''); // clean-bill toast copy
  const readDraft = useCallback(async () => {
    const a = authRef.current;
    if (!a || !storyId || readingDraft) return;
    setReadingDraft(true);
    setNotesOpen(true);
    setNotesError(''); setDraftVerdict(''); setStatusToastDismissed(false);
    try {
      const res = await requestDraftNotes({ projectId: storyId }, a.token);
      if (res.skipped) {
        setNotesError(res.reason ?? 'Not enough written scenes for a draft read yet.');
        return;
      }
      const fresh = res.notes ?? [];
      setAllNotes((cur) => [...cur.filter((n) => n.mode !== 'draft'), ...fresh]);
      setNotesLoaded(true);
      if (res.clean_bill) {
        setDraftVerdict(res.summary || 'The peer read the whole draft and has no big notes. It holds.');
        return;
      }
      // Ground in the background: anchors arrive as an update, never a wait.
      try {
        const g = await groundDraftNotes({ projectId: storyId, noteIds: fresh.map((n) => n.id) }, a.token);
        if (!g.skipped) {
          const updated = new Map((g.notes ?? []).map((n) => [n.id, n]));
          setAllNotes((cur) => cur
            .map((n) => (updated.has(n.id) ? { ...n, ...updated.get(n.id)! } : n))
            .filter((n) => n.state === 'open'));
        }
      } catch (e) {
        console.warn('[freeform-script] draft grounding failed; notes stay scene-level', e);
      }
    } catch (e: any) {
      setNotesError(String(e?.message ?? e));
    } finally {
      setReadingDraft(false);
    }
  }, [storyId, readingDraft]);

  // Step 8 — the writer settles a note by hand (resolved / dismissed). Keep-bias:
  // the note drops from the active view and the durable state stamps in the
  // background; RESOLVE != DELETE (recoverable). Optimistic: pull it locally now.
  const settleNote = useCallback(async (noteId: string, state: 'resolved' | 'dismissed') => {
    const a = authRef.current;
    if (!a || !storyId) return;
    setAllNotes((cur) => {
      const n = cur.find((x) => x.id === noteId);
      // Docket record: settled rows strike through and stay (idempotent append —
      // strict mode may run this updater twice).
      if (n) setSettledLog((log) => [...log.filter((e) => e.note.id !== noteId), { note: n, state }]);
      return cur.filter((x) => x.id !== noteId);
    });
    setFocusNoteId((c) => (c === noteId ? null : c));
    setOpenNoteId((c) => (c === noteId ? null : c));
    try {
      await setNoteState({ projectId: storyId, noteId, state }, a.token);
    } catch (e) {
      console.warn('[freeform-script] set-note-state failed; note will reappear on reload', { noteId, state, error: e });
    }
  }, [storyId]);

  // Un-strike: clicking a settled docket row reopens the note (keep-bias makes
  // this safe — the settle stamped state, never deleted).
  const unsettleNote = useCallback(async (noteId: string) => {
    const a = authRef.current;
    if (!a || !storyId) return;
    setSettledLog((log) => {
      const e = log.find((x) => x.note.id === noteId);
      if (e) setAllNotes((cur) => (cur.some((n) => n.id === noteId) ? cur : [...cur, e.note]));
      return log.filter((x) => x.note.id !== noteId);
    });
    try {
      await setNoteState({ projectId: storyId, noteId, state: 'open' }, a.token);
    } catch (e) {
      console.warn('[freeform-script] reopen note failed', { noteId, error: e });
    }
  }, [storyId]);

  // Hover bridge: a short grace timer keeps the card open while the pointer
  // crosses the small gap from the margin marker to its card in the rail.
  const openHover = useCallback((id: string) => {
    if (hoverCloseRef.current) { window.clearTimeout(hoverCloseRef.current); hoverCloseRef.current = null; }
    setHoverNoteId(id);
  }, []);
  const scheduleCloseHover = useCallback(() => {
    if (hoverCloseRef.current) window.clearTimeout(hoverCloseRef.current);
    hoverCloseRef.current = window.setTimeout(() => { setHoverNoteId(null); hoverCloseRef.current = null; }, 160);
  }, []);

  // Open note count per scene — badges the navigator rows and colors the peer
  // button so the writer sees which scenes carry notes.
  const noteCountByScene = useMemo(() => {
    const m = new Map<string, number>();
    for (const n of allNotes) { const k = n.event_id ?? ''; if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  }, [allNotes]);

  // Scene label (SC number + title + spine index) per event, for the drawer /
  // passes scene grouping and location lines.
  const sceneLabelById = useMemo(() => {
    const m = new Map<string, { scNo: number; title: string; order: number }>();
    let order = 0;
    for (const sec of navSections) for (const sc of sec.scenes) m.set(sc.eventId, { scNo: sc.scNo, title: sc.title, order: order++ });
    return m;
  }, [navSections]);

  // Per-scene note-set signature: id + state + progress length. A rereading
  // marker clears when this changes (verdict landed) or times out.
  const sceneNotesSig = useCallback((eventId: string) => allNotesRef.current
    .filter((n) => (n.event_id ?? '') === eventId)
    .map((n) => `${n.id}:${n.state}:${(n.progress_log ?? '').length}`)
    .sort().join('|'), []);
  useEffect(() => {
    allNotesRef.current = allNotes;
    setReviewingScenes((cur) => {
      if (cur.size === 0) return cur;
      const next = new Map<string, { at: number; sig: string }>();
      let changed = false;
      for (const [eid, m] of cur) {
        if (sceneNotesSig(eid) === m.sig && Date.now() - m.at < 100000) next.set(eid, m);
        else changed = true;
      }
      return changed ? next : cur;
    });
  }, [allNotes, autoLog, sceneNotesSig]);
  // Fast poll while the peer is rereading (the 45s ambient poll is too slow
  // to feel causal); reverts to ambient cadence when nothing is in flight.
  useEffect(() => {
    if (reviewingScenes.size === 0) return;
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void refreshNotes(); }, 8000);
    return () => window.clearInterval(t);
  }, [reviewingScenes.size, refreshNotes]);

  // §6 — open a note's thread (restore prior turns) / send a turn.
  const openDiscuss = useCallback((n: ScreenplayNote) => {
    setDiscussNote(n); setDiscussTurns([]); setDiscussError(''); setDiscussInput('');
    const a = authRef.current;
    if (!a || !storyId) return;
    setDiscussLoading(true);
    getNoteThread({ projectId: storyId, noteId: n.id }, a.token)
      .then((res) => setDiscussTurns(res.turns ?? []))
      .catch(() => { /* fresh thread */ })
      .finally(() => setDiscussLoading(false));
  }, [storyId]);
  const sendDiscuss = useCallback(async () => {
    const n = discussNote; const msg = discussInput.trim();
    const a = authRef.current;
    if (!n || !msg || !a || !storyId || discussBusy) return;
    setDiscussInput(''); setDiscussError('');
    setDiscussTurns((cur) => [...cur, { role: 'writer', content: msg }]);
    setDiscussBusy(true);
    try {
      const res = await noteDiscuss({ projectId: storyId, noteId: n.id, message: msg }, a.token);
      setDiscussTurns((cur) => [...cur, res.peerTurn]);
    } catch (e: any) {
      setDiscussError(String(e?.message ?? e));
    } finally {
      setDiscussBusy(false);
    }
  }, [discussNote, discussInput, discussBusy, storyId]);
  useEffect(() => {
    const el = discussScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [discussTurns, discussBusy, discussNote]);

  // ---- Pins layout engine. Positions are in the scroll container's CONTENT
  // coordinates (not viewport), and the markers render as absolute children of
  // .paginated-canvas, so the browser scrolls them with the pages: no per-frame
  // JS, no shake. For each note we match its verbatim anchor to a paragraph
  // (within its scene region), take that line's content-Y, and place a marker in
  // the page's right margin. Pages stay pristine (§0a): the mark lives in the
  // margin, never on the words; the note itself pops on hover.
  const normAnchor = useCallback((s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(), []);
  const relayoutPins = useCallback(() => {
    const editors = getAllEditorsRef.current?.() ?? [];
    if (editors.length === 0) { setPinGeom(new Map()); return; }
    // The scroll container (.paginated-canvas) is our positioning context.
    const canvas = (editors[0].view.dom.closest('.paginated-canvas') as HTMLElement | null) ?? null;
    if (canvas !== canvasEl) setCanvasEl(canvas);
    if (!canvas || allNotes.length === 0) { if (allNotes.length === 0) setPinGeom(new Map()); return; }
    const canvasRect = canvas.getBoundingClientRect();
    const scrollTop = canvas.scrollTop;
    const scrollLeft = canvas.scrollLeft;
    // toContentY/X: viewport rect -> content coordinate inside the canvas.
    const toContentY = (top: number) => top - canvasRect.top + scrollTop;
    const toContentX = (right: number) => right - canvasRect.left + scrollLeft;
    // 1. CHEAP text walk (no layout reads): candidate paragraphs. Page right
    //    edge (content X) from each editor's content box.
    type Cand = { ed: Editor; pos: number; region: string | null; textNorm: string; head: boolean; blockId: string };
    const cands: Cand[] = [];
    // Text-column right edge = the ProseMirror box right MINUS its right padding
    // (the screenplay page margins are the editor's padding: 1in top/right/btm,
    // 1.5in left). Using the box right (or the page card) lands markers ~1in too
    // far, out at the page edge; subtracting the padding puts them in the actual
    // right margin, beside the text, on any scene regardless of line length.
    let pageRightX = 0;
    // Region persists ACROSS page editors: a scene's continuation paragraphs
    // on later pages carry no data-scene-id of their own (FIL-529 sibling bug:
    // resetting per page stuck every cross-page note at its scene head).
    let region: string | null = null;
    for (const ed of editors) {
      try {
        const dom = ed.view.dom as HTMLElement;
        const padR = parseFloat(getComputedStyle(dom).paddingRight) || 0;
        pageRightX = Math.max(pageRightX, toContentX(dom.getBoundingClientRect().right - padR));
      } catch { /* ignore */ }
      ed.state.doc.descendants((node: any, pos: number) => {
        if (node.type?.name !== 'paragraph') return true;
        const tag = node.attrs?.['data-scene-id'];
        if (tag) region = String(tag);
        cands.push({ ed, pos, region, textNorm: normAnchor(String(node.textContent ?? '')), head: !!tag, blockId: String(node.attrs?.['data-block-id'] ?? '') });
        return false; // don't descend into inline content
      });
    }
    if (cands.length === 0) { setPinGeom(new Map()); return; }
    // Marker gutter sits just right of the page's text column; cards sit just
    // right of the markers, filling whatever right-margin space the centered
    // page leaves (the page is NOT shifted — Ben's call). cardW is derived from
    // that space in the render.
    const gutterX = pageRightX + 12;
    const cardX = pageRightX + 30;
    // Read a candidate paragraph's content-coord rect (viewport rect converted).
    const rectOf = (p: Cand): { top: number; left: number; width: number; height: number } | null => {
      try {
        const r = (p.ed.view.nodeDOM(p.pos) as HTMLElement | null)?.getBoundingClientRect?.();
        if (r && r.height > 0) return { top: toContentY(r.top), left: toContentX(r.left), width: r.width, height: r.height };
      } catch { /* ignore */ }
      return null;
    };
    // 2. Match each note to a paragraph (or the whole scene for scene-level
    //    notes with no line anchor), reading rects only for what we need.
    const raw: Array<{ id: string; top: number; found: boolean; hl: PinHL | null }> = [];
    for (const n of allNotes) {
      const inRegion = cands.filter((p) => p.region === (n.event_id ?? ''));
      const pool = inRegion.length ? inRegion : cands;
      const a = normAnchor(n.anchor);
      const sceneLevel = !a; // empty anchor = a whole-scene note (schema §7)
      let hl: PinHL | null = null;
      let top: number | null = null;
      let found = false;
      if (sceneLevel && inRegion.length) {
        // Whole-scene highlight: from the scene head to the last paragraph.
        const firstP = inRegion.find((p) => p.head) ?? inRegion[0];
        const lastP = inRegion[inRegion.length - 1];
        const fr = rectOf(firstP);
        const lr = lastP === firstP ? fr : rectOf(lastP);
        if (fr) {
          top = fr.top;
          hl = { left: fr.left, top: fr.top, width: fr.width, height: Math.max(fr.height, (lr ? lr.top + lr.height : fr.top + fr.height) - fr.top) };
          found = true; // intentional scene-level note, not drift
        }
      } else {
        let target: Cand | undefined;
        // Block-id first: deterministic identity. Block present + anchor text
        // still in it = intact; block present + text changed = EDITED (found
        // false) but the marker FOLLOWS the line instead of the scene head.
        const bid = n.anchor_block_id || '';
        if (bid) {
          const byBlock = pool.find((p) => p.blockId === bid) ?? cands.find((p) => p.blockId === bid);
          if (byBlock) { target = byBlock; found = !!a && byBlock.textNorm.includes(a); }
        }
        if (!target && a) {
          target = pool.find((p) => p.textNorm && p.textNorm.includes(a))
            ?? pool.find((p) => p.textNorm.length > 8 && a.includes(p.textNorm));
          found = !!target;
        }
        if (!target) target = inRegion.find((p) => p.head) ?? inRegion[0] ?? pool[0];
        if (target) {
          const r = rectOf(target);
          if (r) { top = r.top; hl = r; }
          // Range anchor: the highlight runs start line through end line.
          const endBid = n.anchor_end_block_id || '';
          const ae = normAnchor(n.anchor_end ?? '');
          if (r && (endBid || ae)) {
            const startIdx = pool.indexOf(target);
            const tail = startIdx >= 0 ? pool.slice(startIdx + 1) : pool;
            const endTarget = (endBid ? (tail.find((p) => p.blockId === endBid) ?? cands.find((p) => p.blockId === endBid)) : undefined)
              ?? (ae ? tail.find((p) => p.textNorm && p.textNorm.includes(ae)) : undefined);
            const er = endTarget ? rectOf(endTarget) : null;
            if (er && er.top >= r.top) {
              hl = { left: Math.min(r.left, er.left), top: r.top, width: Math.max(r.width, er.width), height: (er.top + er.height) - r.top };
            }
          }
        }
      }
      if (top != null) raw.push({ id: n.id, top, found, hl });
    }
    // 3. Two stacked columns (sorted by content-Y): the small MARKERS (tight
    //    de-overlap so bullets on adjacent lines don't touch) and the taller
    //    CARDS in the rail (collision by estimated height, for the show-all
    //    mode). `lineTop` keeps the true line Y (marker + hover-card anchor);
    //    `hl` keeps the true line rect for the highlight.
    raw.sort((x, y) => x.top - y.top);
    const byId = new Map(allNotes.map((n) => [n.id, n]));
    // Cards fill the right margin the centered page leaves; estimate height from
    // that width so the show-all stack doesn't overlap.
    const cardW = Math.min(300, Math.max(150, canvasRect.width - cardX - 12));
    const charsPerLine = Math.max(16, Math.floor(cardW / 7));
    const estCardHeight = (n?: ScreenplayNote) => (n ? 56 + Math.ceil(Math.max(1, n.diagnosis.length) / charsPerLine) * 19 : 92);
    const geom = new Map<string, PinG>();
    let mCursor = -Infinity;
    let cCursor = -Infinity;
    for (const r of raw) {
      const markerTop = Math.max(r.top, mCursor + 16);
      mCursor = markerTop;
      const cardTop = Math.max(r.top - 6, cCursor + 10);
      cCursor = cardTop + estCardHeight(byId.get(r.id));
      geom.set(r.id, { markerTop, markerX: gutterX, cardX, lineTop: r.top, cardTop, found: r.found, hl: r.hl });
    }
    // Skip the state update (and re-render) when nothing moved: content-Y is
    // scroll-invariant, so this only changes on reflow/resize, not on scroll.
    const sig = Array.from(geom.entries()).map(([id, g]) => `${id}:${g.markerTop | 0}:${g.cardTop | 0}:${g.markerX | 0}:${g.found ? 1 : 0}:${g.hl ? (g.hl.top | 0) + 'x' + (g.hl.width | 0) : ''}`).join('|');
    if (sig === pinSigRef.current) return;
    pinSigRef.current = sig;
    setPinGeom(geom);
  }, [allNotes, normAnchor, canvasEl]);

  // Recompute pin content-positions whenever notes exist (independent of the
  // all/hover toggle — markers show in both): on resize and a light interval
  // that catches content reflow (typing above a note shifts its line, and the
  // editor mounts/remounts async so the first layout may need a retry). NOT on
  // scroll — the pins are inside the scroll container and move natively.
  const notesVisible = notesLoaded && allNotes.length > 0;
  useEffect(() => {
    if (!notesVisible) return;
    let raf = 0;
    const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; relayoutPins(); }); };
    schedule();
    window.addEventListener('resize', schedule);
    const iv = window.setInterval(schedule, 400);
    return () => {
      window.removeEventListener('resize', schedule);
      window.clearInterval(iv);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [notesVisible, relayoutPins]);

  // ---- Jump to a note's line: scroll the paragraph its anchor lives on into
  // view and focus it, and flag the note for a brief highlight.
  const jumpToNote = useCallback((n: ScreenplayNote) => {
    const eventId = n.event_id ?? '';
    const editors = getAllEditorsRef.current?.() ?? [];
    const a = normAnchor(n.anchor);
    let hit: { ed: Editor; pos: number } | null = null;
    let headHit: { ed: Editor; pos: number } | null = null;
    let region: string | null = null;
    for (const ed of editors) {
      ed.state.doc.descendants((node: any, pos: number) => {
        if (hit) return false;
        if (node.type?.name !== 'paragraph') return true;
        const tag = node.attrs?.['data-scene-id'];
        if (tag) region = String(tag);
        if (n.anchor_block_id && String(node.attrs?.['data-block-id'] ?? '') === n.anchor_block_id) { hit = { ed, pos }; return false; }
        if (region !== eventId) return false;
        if (!headHit && tag) headHit = { ed, pos };
        if (a) {
          const t = normAnchor(String(node.textContent ?? ''));
          if (t && t.includes(a)) { hit = { ed, pos }; return false; }
        }
        return false;
      });
      if (hit) break;
    }
    // hit/headHit are mutated inside the descendants closure, which TS's flow
    // analysis can't see (it narrows them to null); assert the runtime type.
    const loc = (hit ?? headHit) as { ed: Editor; pos: number } | null;
    if (!loc) return;
    try {
      const dom = loc.ed.view.nodeDOM(loc.pos) as HTMLElement | null;
      dom?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      loc.ed.chain().focus().setTextSelection(Math.min(loc.pos + 1, loc.ed.state.doc.content.size)).run();
      if (eventId) setActiveSceneId(eventId);
    } catch { /* ignore */ }
    setFocusNoteId(n.id);
    window.setTimeout(() => setFocusNoteId((c) => (c === n.id ? null : c)), 1600);
  }, [normAnchor]);

  // ---- Live CLIPPING for the Review docket. The excerpt is a WINDOW into the
  // current document, never stored text: walk the ProseMirror docs (state only,
  // no layout reads), find the note's anchor line inside its scene region, and
  // return it with a little context. Anchor states: intact (verbatim match in
  // the current pages), moved (scene present but the line no longer matches —
  // the writer edited it; the stored quote renders as "from an earlier draft"),
  // gone (the scene region is absent from the document). Deterministic
  // edited-detection (block id + hash stamped on the Note) is a later backend
  // add; this snippet-match version is the FE-only approximation.
  type ClipLine = { text: string; lineType: string; hl: boolean };
  type Clip = { state: 'intact' | 'moved' | 'gone'; pageNo: number | null; lines: ClipLine[]; span?: number };
  const getClipForNote = useCallback((n: ScreenplayNote): Clip => {
    const editors = getAllEditorsRef.current?.() ?? [];
    type Line = { text: string; lineType: string; region: string | null; pageNo: number; blockId: string };
    const lines: Line[] = [];
    // Region persists ACROSS page editors: a scene's continuation paragraphs on
    // the next page carry no data-scene-id tag of their own.
    let region: string | null = null;
    editors.forEach((ed, pi) => {
      ed.state.doc.descendants((node: any) => {
        if (node.type?.name !== 'paragraph') return true;
        const tag = node.attrs?.['data-scene-id'];
        if (tag) region = String(tag);
        const text = String(node.textContent ?? '');
        if (text.trim()) lines.push({ text, lineType: String(node.attrs?.['data-line-type'] ?? ''), region, pageNo: pi + 1, blockId: String(node.attrs?.['data-block-id'] ?? '') });
        return false;
      });
    });
    const inRegion = lines.filter((l) => l.region === (n.event_id ?? ''));
    if (inRegion.length === 0) return { state: 'gone', pageNo: null, lines: [] };
    const a = normAnchor(n.anchor);
    if (!a) {
      // Whole-scene note: the window is the scene's opening (slugline lit).
      const head = inRegion.slice(0, 3);
      return { state: 'intact', pageNo: head[0]?.pageNo ?? null, lines: head.map((l, i) => ({ text: l.text, lineType: l.lineType, hl: i === 0 })) };
    }
    let idx = n.anchor_block_id ? inRegion.findIndex((l) => l.blockId === n.anchor_block_id) : -1;
    if (idx < 0) idx = inRegion.findIndex((l) => normAnchor(l.text).includes(a));
    if (idx < 0) idx = inRegion.findIndex((l) => { const t = normAnchor(l.text); return t.length > 8 && a.includes(t); });
    if (idx < 0) return { state: 'moved', pageNo: inRegion[0]?.pageNo ?? null, lines: [] };
    // Range anchor: the clip is the SPAN (first 3 + fold + last past 6 lines).
    let endIdx = idx;
    if (n.anchor_end || n.anchor_end_block_id) {
      if (n.anchor_end_block_id) endIdx = inRegion.findIndex((l, j) => j > idx && l.blockId === n.anchor_end_block_id);
      if (endIdx <= idx && n.anchor_end) {
        const ae = normAnchor(n.anchor_end);
        endIdx = inRegion.findIndex((l, j) => j > idx && normAnchor(l.text).includes(ae));
      }
      if (endIdx <= idx) endIdx = idx;
    }
    if (endIdx > idx) {
      const span = inRegion.slice(idx, endIdx + 1);
      const total = span.length;
      const mk = (l: Line): ClipLine => ({ text: l.text, lineType: l.lineType, hl: true });
      const spanLines: ClipLine[] = total <= 6
        ? span.map(mk)
        : [...span.slice(0, 3).map(mk), { text: `· · · ${total - 4} lines · · ·`, lineType: 'fold', hl: false }, mk(span[total - 1])];
      return { state: 'intact', pageNo: inRegion[idx].pageNo, lines: spanLines, span: total };
    }
    const from = Math.max(0, idx - 2);
    const to = Math.min(inRegion.length - 1, idx + 1);
    return {
      state: 'intact',
      pageNo: inRegion[idx].pageNo,
      lines: inRegion.slice(from, to + 1).map((l, i) => ({ text: l.text, lineType: l.lineType, hl: from + i === idx })),
    };
  }, [normAnchor]);

  // Fire every pending/dirty check immediately (no grace, no scratch
  // settle): tab-hide and leaving the script view. (Sync has its own loop
  // in syncNow.)
  const flushExtractions = useCallback(() => {
    if (manualOnlyRef.current) return; // manual-only: no auto trigger fires
    for (const [eventId, timer] of graceTimersRef.current) {
      window.clearTimeout(timer);
      graceTimersRef.current.delete(eventId);
      fireExtract(eventId);
    }
    if (prevActiveRef.current) fireExtract(prevActiveRef.current);
    fireExtract(SCRATCH, { hard: true });
  }, [fireExtract]);

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flushExtractions(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      // Leaving the script view: extract what changed, immediately.
      flushExtractions();
    };
  }, [flushExtractions]);

  // Manual sync: save + extract everything dirty, on demand. Works in every
  // trigger-blind case and is the primary control in manual-only mode later.
  const syncNow = useCallback(() => {
    console.info('[freeform-script] syncNow');
    void runSave();
    // Check EVERY region against the extraction baseline, not just pending ones.
    const texts = collectRegionTexts();
    for (const [eventId] of texts) {
      if (baselineRef.current.has(eventId)) fireExtract(eventId);
    }
    fireExtract(SCRATCH, { hard: true });
  }, [runSave, collectRegionTexts, fireExtract]);

  // Highlight-extract host-bar button DROPPED (Ben, 2026-07-09): the manual
  // path is Sync + the stale-gate. fireExtract keeps the {manual,
  // attentionHint} mode and the backend keeps attentionHint support, so a
  // future selection-driven affordance is a one-liner to re-add.

  // Locate a scene's anchor across the page editors. Returns the editor + pos.
  const findAnchor = useCallback((eventId: string): { ed: Editor; pos: number } | null => {
    const editors = getAllEditorsRef.current?.() ?? [];
    for (const ed of editors) {
      let found: number | null = null;
      ed.state.doc.descendants((node: any, pos: number) => {
        if (found !== null) return false;
        if (node.type?.name === 'paragraph' && String(node.attrs?.['data-scene-id'] ?? '') === eventId) {
          found = pos;
          return false;
        }
        return true;
      });
      if (found !== null) return { ed, pos: found };
    }
    return null;
  }, []);

  // Create an unwritten scene's anchor at its SPINE position: right after the
  // end of the nearest preceding scene that has a region (document start when
  // none). This is the EXPLICIT chosen-region act — unwritten scenes render
  // nowhere until the writer starts them from the panel.
  const insertSceneAnchor = useCallback((eventId: string): { ed: Editor; pos: number } | null => {
    const editors = getAllEditorsRef.current?.() ?? [];
    if (editors.length === 0) return null;
    const order = spineOrderRef.current;
    const idx = order.indexOf(eventId);
    // Nearest preceding scene WITH a region in the doc.
    let predecessor: { ed: Editor; pos: number } | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      predecessor = findAnchor(order[i]);
      if (predecessor) break;
    }
    let targetEd: Editor;
    let insertPos: number;
    if (!predecessor) {
      targetEd = editors[0];
      insertPos = 0;
    } else {
      // End of the predecessor's region: scan from its anchor to the next
      // tagged paragraph (any scene) or the end of that page editor's doc.
      targetEd = predecessor.ed;
      let end = targetEd.state.doc.content.size;
      let passedAnchor = false;
      targetEd.state.doc.descendants((node: any, pos: number) => {
        if (pos < predecessor!.pos) return true;
        if (pos === predecessor!.pos) { passedAnchor = true; return true; }
        if (!passedAnchor) return true;
        const tag = node.attrs?.['data-scene-id'];
        if (node.type?.name === 'paragraph' && tag && String(tag) !== eventId) {
          end = Math.min(end, pos);
          return false;
        }
        return true;
      });
      insertPos = end;
    }
    try {
      targetEd
        .chain()
        .insertContentAt(insertPos, {
          type: 'paragraph',
          // A truly EMPTY anchor: no placeholder text, no CSS hint. The
          // navigator highlight is the only indicator of which scene the
          // caret is in — nothing appears in the pages the writer didn't
          // write (Ben, 2026-07-07).
          attrs: {
            'data-line-type': 'scene',
            'data-scene-id': eventId,
          },
        })
        .run();
      return findAnchor(eventId);
    } catch (e) {
      console.warn('[freeform-script] anchor insert failed', e);
      return null;
    }
  }, [findAnchor]);

  // ---- Deep link: scroll the document to a scene's region and place the
  // caret there (the caret placement IS the "chosen region" signal). For an
  // unwritten scene, the panel click CREATES the region first.
  const scrollToScene = useCallback((eventId: string) => {
    let loc = findAnchor(eventId);
    if (!loc) loc = insertSceneAnchor(eventId);
    if (!loc) return;
    try {
      const dom = loc.ed.view.nodeDOM(loc.pos) as HTMLElement | null;
      dom?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      loc.ed.chain().focus().setTextSelection(Math.min(loc.pos + 1, loc.ed.state.doc.content.size)).run();
      setActiveSceneId(eventId);
    } catch { /* ignore */ }
  }, [findAnchor, insertSceneAnchor]);

  // ---- Cleared-scene decision (FIL-520 round 4, Ben's UX): a red-dot scene
  // (pages deleted, undecided) resolves by the writer's hand. KEEP = the
  // outline slot stays (acknowledge server-side so the red settles across
  // sessions); TRASH = the existing soft-delete, spine heals. Never a modal.
  const resolveCleared = useCallback(async (eventId: string, choice: 'keep' | 'trash') => {
    const a = authRef.current;
    if (!a || !storyId) return;
    try {
      if (choice === 'keep') {
        await ackSceneCleared({ projectId: storyId, eventId }, a.token);
        setStatusById((cur) => {
          const next = new Map(cur);
          next.set(eventId, 'unwritten');
          return next;
        });
      } else {
        await deleteCard({ cardId: eventId, projectId: storyId }, a.token);
        // Rebuild the document + navigator from server truth (cheap: the
        // trashed scene had no pages; the remount is behind the loading gate).
        setReloadTick((t) => t + 1);
      }
    } catch (e) {
      console.warn('[freeform-script] cleared-scene decision failed', { eventId, choice, error: e });
    }
  }, [storyId]);

  // ---- "+ New scene": the writer declares a scene from the navigator. It is
  // created as a card, spliced into the spine right after the ACTIVE scene
  // (appended when none), inherits the anchor's sequence, gets its anchor
  // inserted in the document, and receives the caret. Structure stays
  // writer-declared; extraction never invents scenes.
  const addScene = useCallback(async (title: string) => {
    const a = authRef.current;
    if (!a || !storyId) return;
    const t = title.trim();
    if (!t) return;
    setAddSceneBusy(true);
    try {
      const order = spineOrderRef.current;
      const anchor = prevActiveRef.current ?? order[order.length - 1] ?? null;
      const res = await createCard(
        {
          kind: 'event',
          projectId: storyId,
          userId: a.userId,
          workingName: t,
          ...(anchor ? { precededByEventId: anchor } : {}),
        },
        a.token,
      );
      if ('exists' in res && res.exists) {
        // Same-titled scene already exists — jump to it instead of duplicating.
        scrollToScene(res.cardId);
        return;
      }
      if (!('created' in res) || !res.created) return;
      const newId = res.entity.id;

      // Splice: the anchor's old successor now follows the NEW scene.
      if (anchor) {
        const succ = precedesRef.current.find((p) => p.from === anchor && p.to !== newId)?.to;
        if (succ) {
          try {
            await untagEventPrecedes({ fromEventId: anchor, toEventId: succ, projectId: storyId }, a.token);
            await tagEventPrecedes({ fromEventId: newId, toEventId: succ, projectId: storyId }, a.token);
            precedesRef.current = precedesRef.current.filter((p) => !(p.from === anchor && p.to === succ));
            precedesRef.current.push({ from: newId, to: succ });
          } catch (e) {
            console.warn('[freeform-script] spine splice failed (scene appended after anchor)', e);
          }
        }
        precedesRef.current.push({ from: anchor, to: newId });
        const sid = seqOfEventRef.current.get(anchor);
        if (sid) {
          tagSequenceContains({ sequenceId: sid, eventId: newId, projectId: storyId }, a.token)
            .then(() => { seqOfEventRef.current.set(newId, sid); })
            .catch(() => { /* membership is best-effort */ });
        }
      }

      // Local bookkeeping: spine order, titles, baselines, panel rows + SC renumber.
      const idx = anchor ? order.indexOf(anchor) : -1;
      if (idx >= 0) order.splice(idx + 1, 0, newId);
      else order.push(newId);
      titleByIdRef.current.set(newId, t);
      baselineRef.current.set(newId, '');
      setStatusById((cur) => new Map(cur).set(newId, 'unwritten'));
      setSceneCount((c) => c + 1);
      setNavSections((cur) => {
        const next = cur.map((s) => ({ ...s, scenes: [...s.scenes] }));
        const row: NavScene = { eventId: newId, scNo: 0, title: t };
        let placed = false;
        if (anchor) {
          for (const sec of next) {
            const i = sec.scenes.findIndex((sc) => sc.eventId === anchor);
            if (i >= 0) { sec.scenes.splice(i + 1, 0, row); placed = true; break; }
          }
        }
        if (!placed) {
          const last = next[next.length - 1];
          if (last && last.seqId === null) last.scenes.push(row);
          else next.push({ seqId: null, title: '', color: '', scenes: [row] });
        }
        let n = 1;
        for (const sec of next) for (const sc of sec.scenes) sc.scNo = n++;
        return next;
      });

      // Into the document, caret placed (the chosen-region act).
      scrollToScene(newId);
    } catch (e) {
      console.warn('[freeform-script] add scene failed', e);
    } finally {
      setAddSceneBusy(false);
    }
  }, [storyId, scrollToScene]);

  // ---- Active-region tracking: the scene whose region holds the caret.
  // Walk pages in order up to the focused editor's selection, keeping the
  // last data-scene-id seen (untagged paragraphs belong to the scene above).
  const updateActiveScene = useCallback((focused: Editor) => {
    const editors = getAllEditorsRef.current?.() ?? [];
    let current: string | null = null;
    for (const ed of editors) {
      const limit = ed === focused ? ed.state.selection.from : Infinity;
      let done = false;
      ed.state.doc.descendants((node: any, pos: number) => {
        if (done) return false;
        if (pos > limit) { done = true; return false; }
        const tag = node.attrs?.['data-scene-id'];
        if (tag) current = String(tag);
        return true;
      });
      if (ed === focused) break;
    }
    setActiveSceneId(current);
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveState('dirty');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => { void runSave(); }, 3000);
  }, [runSave]);

  // Editor-ready: hook the update stream for the debounced save (the same
  // posture Scripts.tsx takes).
  const attachedRef = useRef<Editor | null>(null);
  const selTimerRef = useRef<number | null>(null);
  const handleEditorReady = useCallback((editor: Editor) => {
    if (attachedRef.current === editor) return;
    attachedRef.current = editor;
    editor.on('update', () => {
      scheduleSave();
      // Rolling last-good-walk snapshot (the torn-down-walk guard's source
      // of truth): refreshed shortly after every edit, while editors are
      // certainly alive.
      if (snapTimerRef.current) window.clearTimeout(snapTimerRef.current);
      snapTimerRef.current = window.setTimeout(() => refreshWalkSnapshot(), 400);
    });
    editor.on('selectionUpdate', () => {
      if (selTimerRef.current) window.clearTimeout(selTimerRef.current);
      selTimerRef.current = window.setTimeout(() => updateActiveScene(editor), 200);
    });
    // Blur = scene exit (the single-scene case: with one scene there is no
    // "other scene" to move the caret to, so leaving the PAGES is the exit
    // signal). Same grace; refocus cancels.
    editor.on('blur', () => {
      const cur = prevActiveRef.current;
      if (cur) scheduleExtractCheck(cur);
      scheduleExtractCheck(SCRATCH); // unbound scratch checks on blur too
    });
    editor.on('focus', () => {
      // Coming back to the pages cancels pending exit checks: the active
      // scene's AND the scratch buffer's (in the unbound phase there is no
      // active scene, so the scratch timer is the one a quick blur-and-back
      // must not leave armed).
      for (const id of [prevActiveRef.current, SCRATCH]) {
        if (!id) continue;
        const pending = graceTimersRef.current.get(id);
        if (pending) {
          window.clearTimeout(pending);
          graceTimersRef.current.delete(id);
        }
      }
    });
    // Seed the extraction baseline from the loaded document (once), so
    // unchanged imported/saved content never triggers an extraction — only
    // what the writer actually changes this session does. The backend hash
    // remains the cross-session truth.
    window.setTimeout(() => {
      if (extractBaselineRef.current.size === 0) {
        extractBaselineRef.current = collectRegionTexts();
      }
      // Seed the last-good-walk snapshot too, so an exit BEFORE the first
      // edit still has a trusted walk to fall back to.
      refreshWalkSnapshot();
    }, 800);
  }, [scheduleSave, updateActiveScene, collectRegionTexts, refreshWalkSnapshot]);

  // Background-work watcher: cheap poll of the two in-flight signals (refs
  // don't re-render; identical setState values bail out, so this is quiet).
  useEffect(() => {
    const t = window.setInterval(() => {
      setBgBusy(Boolean(scratchEnqueuedRef.current) || pendingScenesRef.current > 0);
    }, 1500);
    return () => window.clearInterval(t);
  }, []);

  // Register the scene-boundary guard on every page editor (pages mount and
  // remount progressively; the WeakSet keeps registration idempotent).
  useEffect(() => {
    const t = window.setInterval(() => {
      for (const ed of getAllEditorsRef.current?.() ?? []) {
        if (boundaryGuardedEditors.has(ed)) continue;
        try {
          ed.registerPlugin(sceneBoundaryGuard());
          boundaryGuardedEditors.add(ed);
        } catch { /* editor mid-teardown: retry next tick */ }
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, []);

  // Tab-hide / unmount belts.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void runSave(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void runSave();
    };
  }, [runSave]);

  // Minimal storyData for the editor's AI hooks: freeform has no S1-S9
  // outline; the panels degrade gracefully or get their own lane later (the
  // screenplay peer is the eventual replacement).
  const storyData = useMemo(
    () => ({ storyId: storyId ?? '', title: 'Script', story_metadata: {}, segments: [] }),
    [storyId],
  );

  const statusLabel =
    saveState === 'dirty' ? 'Unsaved changes'
    : saveState === 'saving' ? 'Saving…'
    : saveState === 'saved' ? 'Saved'
    : saveState === 'error' ? 'Save failed — copy your text'
    : '';

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0b', color: '#aeaeb6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        Loading script…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#0a0a0b', color: '#f87171', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        {error}
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        height: '100vh', background: theme === 'dark' ? '#0a0a0b' : '#faf6ee',
        ...(isFullscreen ? { position: 'fixed', inset: 0, zIndex: 1000 } : {}),
      }}
    >
      {/* The freeform bar — this is the part that differs from the outline
          workflow's page (no beat sidebar, no outline chrome). */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 18px',
        background: theme === 'dark' ? 'rgba(10,10,11,0.94)' : 'rgba(255,255,255,0.94)',
        borderBottom: `1px solid ${theme === 'dark' ? '#232328' : '#e8e0d2'}`,
        fontFamily: 'system-ui, sans-serif',
        // Toolbar theme tokens: the .ff-tb-* classes (injected <style> below)
        // read these, so hover/active states stay in CSS and both themes work.
        ...(theme === 'dark'
          ? { '--tb-hair': '#26262c', '--tb-mut': '#8a8a93', '--tb-txt': '#c9c9d1', '--tb-hov': 'rgba(255,255,255,0.055)', '--tb-peer': '#54bfdb', '--tb-peer-bg': 'rgba(84,191,219,0.13)', '--tb-peer-bg-h': 'rgba(84,191,219,0.2)' }
          : { '--tb-hair': '#e3dbcb', '--tb-mut': '#8a8578', '--tb-txt': '#4a4a45', '--tb-hov': 'rgba(0,0,0,0.045)', '--tb-peer': '#0f7f9f', '--tb-peer-bg': 'rgba(15,127,159,0.10)', '--tb-peer-bg-h': 'rgba(15,127,159,0.16)' }),
      } as React.CSSProperties}>
        <Link
          to={`/freeform/${storyId}`}
          onClick={() => {
            // Fire the exit extractions NOW, while the document walk is
            // still healthy — the unmount cleanup's walk can be torn down
            // (degraded guard drops it) and the tail would wait for the
            // next trigger. With streaming, the board shows the cards
            // arriving right as it opens.
            void runSave();
            flushExtractions();
          }}
          style={{ color: '#ff8c42', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}
        >
          ← Board
        </Link>
        <span style={{ color: theme === 'dark' ? '#e6e6ea' : '#1a1a1a', fontSize: 14, fontWeight: 700 }}>Script</span>
        <span style={{ color: '#6b6b74', fontSize: 12 }}>
          {sceneCount} scene{sceneCount === 1 ? '' : 's'} from your outline
        </span>
        <div style={{ flex: 1 }} />
        {/* Right cluster: ambient state (status dot, auto-sync) | peer group
            (Notes | Review, joined) | the ONE primary action (Sync board).
            Only the primary carries a tinted fill at rest; state lives in the
            dot and the peer group's active half, not in five competing colors. */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {statusLabel && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 500, color: saveState === 'error' ? '#f87171' : 'var(--tb-mut)', paddingRight: 2, whiteSpace: 'nowrap' }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                background: saveState === 'error' ? '#f87171' : saveState === 'saved' ? '#4ade80' : saveState === 'saving' ? '#eab308' : (theme === 'dark' ? '#5a5a63' : '#b5ad9d'),
                animation: saveState === 'saving' ? 'ffblink 1.1s ease-in-out infinite' : 'none',
              }} />
              {statusLabel}
            </span>
          )}
          <button
            className="ff-tb-btn ff-tb-ghost"
            onClick={toggleManualOnly}
            title={manualOnly
              ? 'Auto-sync is off: the outline updates only via Sync, Extract scene, and peer asks. Click to turn auto-sync back on.'
              : 'Auto-sync is on: scenes update the outline as you finish them. Click to switch to manual-only.'}
            style={manualOnly ? { color: '#eab308' } : undefined}
          >
            {manualOnly ? 'Auto-sync off' : 'Auto-sync on'}
          </button>
          <span style={{ width: 1, height: 16, background: 'var(--tb-hair)', flexShrink: 0 }} />
          <div className="ff-tb-seg" data-tour="script-peer-seg">
            <button
              className={`ff-tb-btn ff-tb-seg-btn${notesOpen ? ' on' : ''}`}
              onClick={() => setNotesOpen((v) => !v)}
              title={notesOpen ? 'Hide the peer-note pins in the margin (they show on hover)' : 'Show the peer-note pins in the margin'}
            >
              Notes
              {allNotes.length > 0 && (
                <span className="ff-tb-count">{allNotes.length}</span>
              )}
            </button>
            {notesVisible && (
              <>
                <span className="ff-tb-seg-div" />
                <button
                  className={`ff-tb-btn ff-tb-seg-btn${reviewOpen ? ' on' : ''}`}
                  onClick={() => { if (reviewOpen) { setReviewOpen(false); setDiscussNote(null); } else { setPassIdx(0); setReviewOpen(true); } }}
                  title="Review with the peer: work the notes down, by severity or scene"
                >
                  Review
                </button>
              </>
            )}
          </div>
          <button
            className="ff-tb-btn ff-tb-sync"
            onClick={syncNow}
            title={bgBusy ? 'Working your pages into the outline…' : 'Save and update your outline from these pages now'}
          >
            {bgBusy && (
              <span
                style={{
                  width: 11, height: 11, borderRadius: '50%', flexShrink: 0,
                  border: '2px solid rgba(255,140,66,0.3)', borderTopColor: '#ff8c42',
                  display: 'inline-block', animation: 'ffspin 0.9s linear infinite',
                }}
              />
            )}
            {bgBusy ? 'Syncing…' : 'Sync board'}
          </button>
        </div>
      </div>

      {/* Body: left navigator (the outline, in shell form) + the editor. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        {/* Outline handle, collapsed state: a slim tab on the body's left edge. */}
        {!navOpen && (
          <button onClick={toggleNav} title="Show the outline panel" className="ff-nav-handle" style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 30, width: 17, height: 54, borderRadius: '0 9px 9px 0', border: `1px solid ${theme === 'dark' ? '#26262c' : '#e3dbcb'}`, borderLeft: 'none', background: theme === 'dark' ? '#131316' : '#fbf8f1', color: theme === 'dark' ? '#8a8a93' : '#8a8578', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '2px 0 10px rgba(0,0,0,0.18)' }}>›</button>
        )}
        {/* Navigator rail — sequences as sections, scenes as rows. Shell, not
            pages: this is where scene-level graph state lives (status now;
            stale/drift later). */}
        {navOpen && (
          <div data-tour="script-nav" style={{ width: navWidth, flexShrink: 0, position: 'relative', borderRight: `1px solid ${theme === 'dark' ? '#1f1f24' : '#e8e0d2'}`, background: theme === 'dark' ? '#0e0e10' : '#fbf8f1', fontFamily: 'system-ui, sans-serif' }}>
          {/* Outline handle, open state: rides the panel's right edge. */}
          <button onClick={toggleNav} title="Hide the outline panel" className="ff-nav-handle" style={{ position: 'absolute', right: -12, top: '50%', transform: 'translateY(-50%)', zIndex: 30, width: 17, height: 54, borderRadius: 9, border: `1px solid ${theme === 'dark' ? '#26262c' : '#e3dbcb'}`, background: theme === 'dark' ? '#131316' : '#fbf8f1', color: theme === 'dark' ? '#8a8a93' : '#8a8578', fontSize: 13, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 10px rgba(0,0,0,0.22)' }}>‹</button>
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '10px 0 40px' }}>
            {/* Mode C — the draft read: the whole story with the peer. The
                read-through register: the few big notes, or a clean bill. */}
            {(() => {
              const draftCnt = allNotes.filter((n) => n.mode === 'draft').length;
              return (
                <div style={{ padding: '0 10px 8px' }}>
                  <button
                    onClick={() => { void readDraft(); }}
                    disabled={readingDraft}
                    title={draftCnt > 0 ? `${draftCnt} draft note${draftCnt === 1 ? '' : 's'} — read the whole draft again` : 'Read the whole draft with the peer: the big notes, or a clean bill'}
                    style={{
                      width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      padding: '5px 9px', borderRadius: 6, fontSize: 11, fontWeight: 700, fontFamily: 'system-ui, sans-serif',
                      cursor: readingDraft ? 'default' : 'pointer',
                      border: `1px solid ${draftCnt > 0 ? 'rgba(84,191,219,0.5)' : (theme === 'dark' ? '#2a2a30' : '#e0d8c8')}`,
                      background: draftCnt > 0 ? 'rgba(84,191,219,0.12)' : 'transparent',
                      color: draftCnt > 0 ? '#54bfdb' : (theme === 'dark' ? '#8a8a93' : '#8a8578'),
                    }}
                  >
                    {readingDraft
                      ? <><span style={{ width: 9, height: 9, borderRadius: '50%', border: '2px solid rgba(84,191,219,0.3)', borderTopColor: '#54bfdb', display: 'inline-block', animation: 'ffspin 0.9s linear infinite' }} />Reading the draft…</>
                      : <><span style={{ display: 'inline-flex', opacity: 0.9 }}><InternIcon size={11} /></span>Read the draft{draftCnt > 0 ? ` · ${draftCnt}` : ''}</>}
                  </button>
                </div>
              );
            })()}
            {navSections.map((sec, si) => (
              <div
                key={sec.seqId ?? `loose-${si}`}
                style={{
                  margin: '0 4px 6px',
                  borderRadius: 7,
                  // Sequence hover: outline the whole section (header + member
                  // scenes) in the sequence's color — the container, in rail form.
                  border: `1px solid ${sec.seqId && hoverSeqIdx === si ? sec.color : 'transparent'}`,
                  transition: 'border-color 120ms',
                }}
              >
                {sec.seqId && (
                  <div
                    onMouseEnter={() => setHoverSeqIdx(si)}
                    onMouseLeave={() => setHoverSeqIdx((c) => (c === si ? null : c))}
                    style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '7px 10px 3px' }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: sec.color, flexShrink: 0, marginTop: 2 }} />
                    <span
                      style={{
                        fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase',
                        color: theme === 'dark' ? '#9a9aa4' : '#777', minWidth: 0, flex: 1,
                        ...(hoverSeqIdx === si
                          ? { whiteSpace: 'normal', wordBreak: 'break-word' }
                          : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
                      }}
                    >
                      {sec.title}
                    </span>
                    {(() => {
                      const seqNoteCount = allNotes.filter((n) => n.mode === 'sequence' && n.seq_id === sec.seqId).length;
                      const busy = readingSeq === sec.seqId;
                      return (
                        <button
                          onClick={(e) => { e.stopPropagation(); void readSequence(sec.seqId!, sec.title); }}
                          disabled={busy}
                          title={seqNoteCount > 0 ? `${seqNoteCount} sequence note${seqNoteCount === 1 ? '' : 's'} — re-read this sequence` : 'Read this whole sequence with the peer'}
                          style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 5, fontSize: 9.5, fontWeight: 800, cursor: busy ? 'default' : 'pointer', border: `1px solid ${seqNoteCount > 0 ? 'rgba(84,191,219,0.5)' : (theme === 'dark' ? '#2a2a30' : '#e0d8c8')}`, background: seqNoteCount > 0 ? 'rgba(84,191,219,0.12)' : 'transparent', color: seqNoteCount > 0 ? '#54bfdb' : (theme === 'dark' ? '#7a7a83' : '#999') }}
                        >
                          {busy
                            ? <span style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid rgba(84,191,219,0.3)', borderTopColor: '#54bfdb', display: 'inline-block', animation: 'ffspin 0.9s linear infinite' }} />
                            : <><span style={{ display: 'inline-flex', opacity: 0.9 }}><InternIcon size={11} /></span>{seqNoteCount > 0 ? ` ${seqNoteCount}` : ''}</>}
                        </button>
                      );
                    })()}
                  </div>
                )}
                {sec.scenes.map((sc) => {
                  const st = statusById.get(sc.eventId) ?? 'unwritten';
                  const active = activeSceneId === sc.eventId;
                  const reading = readingScene === sc.eventId;
                  // The tour's Read beat counts as a hover: the row grows to
                  // make room and the hover-reveal Read button shows. A scene
                  // being READ holds the expanded state too — the pulsing
                  // peer ring needs the room, not a spinner crushed into the
                  // collapsed cluster.
                  const hovered = hoverSceneId === sc.eventId || tourReadSceneId === sc.eventId || reading;
                  return (
                    <div
                      key={sc.eventId}
                      data-tour={`script-scene-${sc.eventId}`}
                      onClick={() => {
                        // Click = jump. The full card flashes on HOVER now
                        // (proxyHover machinery), not on a second click.
                        scrollToScene(sc.eventId);
                      }}
                      onMouseEnter={(e) => {
                        setHoverSceneId(sc.eventId);
                        openProxyHover(sc.eventId, (e.currentTarget as HTMLElement).getBoundingClientRect().top);
                      }}
                      onMouseLeave={() => {
                        setHoverSceneId((c) => (c === sc.eventId ? null : c));
                        scheduleProxyClose();
                      }}
                      style={{
                        display: 'flex', alignItems: hovered ? 'flex-start' : 'center', gap: 8, cursor: 'pointer',
                        position: 'relative',
                        padding: hovered ? '4px 10px 28px 14px' : '4px 10px 4px 14px',
                        transition: 'padding 180ms cubic-bezier(0.32,0.72,0,1), background 120ms',
                        background: reading
                          ? (theme === 'dark' ? 'rgba(84,191,219,0.05)' : 'rgba(84,191,219,0.06)')
                          : active
                          ? (theme === 'dark' ? 'rgba(255,107,53,0.10)' : 'rgba(234,88,12,0.08)')
                          : hovered
                          ? (theme === 'dark' ? 'rgba(255,140,66,0.06)' : 'rgba(234,88,12,0.05)')
                          : 'transparent',
                        borderLeft: `2px solid ${reading ? 'transparent' : active ? '#ff6b35' : hovered ? 'rgba(255,107,53,0.45)' : 'transparent'}`,
                        // The peer is reading this scene: the row itself wears
                        // the progress — a pulsing peer-blue ring, no spinner.
                        ...(reading ? { borderRadius: 7, animation: 'ffreadpulse 1.5s ease-in-out infinite' } : {}),
                      }}
                    >
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, fontWeight: 700, color: active || hovered ? '#ff8c42' : '#6b6b74', flexShrink: 0, width: 18, marginTop: hovered ? 2 : 0 }}>
                        {String(sc.scNo).padStart(2, '0')}
                      </span>
                      <span
                        style={{
                          fontSize: 12, color: theme === 'dark' ? (active || hovered ? '#e6e6ea' : '#b9b9c1') : '#333',
                          flex: 1, minWidth: 0,
                          // Hover reveal: the row grows to fit the full title —
                          // the wrap itself snaps, but the container height
                          // eases, so the expansion reads as motion.
                          display: 'block', overflow: 'hidden',
                          maxHeight: hovered ? 64 : 18,
                          transition: 'max-height 180ms cubic-bezier(0.32,0.72,0,1)',
                          ...(hovered
                            ? { whiteSpace: 'normal', wordBreak: 'break-word' }
                            : { textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
                        }}
                      >
                        {sc.title}
                      </span>
                      {/* Per-scene PEER button (§4b: generation lives where the
                          scenes do). Shows on hover or when the scene already
                          has notes; the count badges scenes that carry notes. */}
                      {(() => {
                        // Concept A (2026-07-24): the COUNT is a bare peer-blue
                        // numeral (glanceable, zero chrome); the READ action is
                        // a hover-reveal overlay. The container header keeps
                        // the rail's only pill.
                        const cnt = noteCountByScene.get(sc.eventId) ?? 0;
                        const writable = st === 'written' || st === 'stale';
                        return (
                          <>
                            {hovered && !reading && (
                              <button
                                onClick={(e) => { e.stopPropagation(); void readScene(sc.eventId); }}
                                disabled={!writable}
                                title={writable ? (cnt > 0 ? `${cnt} peer note${cnt === 1 ? '' : 's'} — re-read this scene` : 'Read this scene with the peer') : 'Write the scene first, then the peer can read it'}
                                style={{ position: 'absolute', right: 10, bottom: 5, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 7px', borderRadius: 5, fontSize: 9, fontWeight: 700, cursor: !writable ? 'default' : 'pointer', border: '1px solid rgba(84,191,219,0.4)', background: 'transparent', color: '#54bfdb', opacity: writable ? 1 : 0.5, animation: 'ffpop 160ms cubic-bezier(0.32,0.72,0,1)' }}
                              >
                                <span style={{ display: 'inline-flex', opacity: 0.9 }}><InternIcon size={10} /></span>Read
                              </button>
                            )}
                            {reading && (
                              // The ring carries the motion; this just names it.
                              <span style={{ position: 'absolute', right: 10, bottom: 6, fontSize: 9, fontWeight: 700, color: '#54bfdb', opacity: 0.9 }}>
                                Reading…
                              </span>
                            )}
                            {cnt > 0 && <span style={{ fontSize: 10, fontWeight: 700, color: '#54bfdb', fontVariantNumeric: 'tabular-nums', flexShrink: 0, opacity: 0.85 }}>{cnt}</span>}
                          </>
                        );
                      })()}
                      {st === 'cleared' && (
                        // Quiet decision affordance (§0b rule 2): the writer
                        // emptied this scene's pages. Keep = outline slot
                        // stays, red settles; Trash = the card retires and
                        // the spine heals. Never a modal.
                        <span style={{ display: 'flex', gap: 5, flexShrink: 0, alignItems: 'center' }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); void resolveCleared(sc.eventId, 'keep'); }}
                            title="Keep this scene as an outline slot"
                            style={{ border: 'none', background: 'transparent', color: '#9a9aa4', fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: '1px 3px' }}
                          >
                            keep
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); void resolveCleared(sc.eventId, 'trash'); }}
                            title="Move this scene's card to Trash"
                            style={{ border: 'none', background: 'transparent', color: '#ef4444', fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: '1px 3px' }}
                          >
                            trash
                          </button>
                        </span>
                      )}
                      <span
                        title={
                          st === 'cleared' ? 'Pages deleted — keep or trash?'
                          : st === 'stale' ? 'Edited since last extraction'
                          : st === 'written' ? 'Up to date'
                          : 'Unwritten'
                        }
                        style={{
                          width: 7, height: 7, borderRadius: 999, flexShrink: 0, marginTop: hovered ? 4 : 0,
                          background: st === 'written' ? '#4ade80' : st === 'stale' ? '#8b8b93' : st === 'cleared' ? '#ef4444' : 'transparent',
                          border: st === 'unwritten' ? `1px solid ${theme === 'dark' ? '#3a3a42' : '#ccc'}` : 'none',
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Declare a new scene: created after the ACTIVE scene, spliced
                into the spine, caret placed. The writer names it; extraction
                never invents structure. */}
            <div style={{ padding: '8px 14px' }}>
              {addSceneOpen ? (
                <input
                  autoFocus
                  value={addSceneTitle}
                  disabled={addSceneBusy}
                  onChange={(e) => setAddSceneTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && addSceneTitle.trim()) {
                      void addScene(addSceneTitle);
                      setAddSceneOpen(false);
                      setAddSceneTitle('');
                    }
                    if (e.key === 'Escape') { setAddSceneOpen(false); setAddSceneTitle(''); }
                  }}
                  onBlur={() => { if (!addSceneTitle.trim()) setAddSceneOpen(false); }}
                  placeholder="Scene title, then Enter"
                  style={{
                    width: '100%', boxSizing: 'border-box', padding: '5px 9px',
                    borderRadius: 6, fontSize: 12, fontFamily: 'system-ui, sans-serif',
                    border: '1px solid rgba(255,107,53,0.5)',
                    background: theme === 'dark' ? '#141417' : '#fff',
                    color: theme === 'dark' ? '#e6e6ea' : '#1a1a1a', outline: 'none',
                  }}
                />
              ) : (
                <button
                  onClick={() => setAddSceneOpen(true)}
                  title="Add a scene after the one you're writing"
                  style={{
                    width: '100%', padding: '5px 9px', borderRadius: 6, cursor: 'pointer',
                    fontSize: 12, fontWeight: 700, fontFamily: 'system-ui, sans-serif',
                    border: `1px dashed ${theme === 'dark' ? '#3a3a42' : '#d8cfc0'}`,
                    background: 'transparent',
                    color: theme === 'dark' ? '#9a9aa4' : '#777', textAlign: 'left',
                  }}
                >
                  + New scene
                </button>
              )}
            </div>
          </div>
          {/* Resize handle: drag the rail's right edge. */}
          <div
            onMouseDown={startNavResize}
            title="Drag to resize the outline panel"
            style={{ position: 'absolute', top: 0, right: -2, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 5 }}
          />
          </div>
        )}

        {/* THE screenwriting editor, lifted whole. ff-script-host scopes
            freeform-only overrides: the outline's scene-id badge (::after on
            sluglines) renders our long Event vids as noise — regions must be
            invisible in the pages (design doc §0a). */}
        <style>{`
          .ff-script-host .ProseMirror p[data-line-type="scene"]::after { content: none !important; }
          @keyframes ffspin { to { transform: rotate(360deg); } }
          @keyframes ffreadpulse {
            0%, 100% { box-shadow: inset 0 0 0 1px rgba(84,191,219,0.35), 0 0 6px rgba(84,191,219,0.10); }
            50%      { box-shadow: inset 0 0 0 1px rgba(84,191,219,0.85), 0 0 14px rgba(84,191,219,0.35); }
          }
          @keyframes ffpop { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes ffblink { 50% { opacity: 0.25; } }
          @keyframes ffslidein { from { opacity: 0; transform: translateX(22px); } to { opacity: 1; transform: translateX(0); } }
          @keyframes ffcardin { from { opacity: 0; transform: translateX(-8px) scale(0.98); } to { opacity: 1; transform: none; } }
          .ff-nav-handle { transition: color 160ms, border-color 160ms, background 160ms, transform 160ms; }
          .ff-nav-handle:hover { color: #ff8c42 !important; border-color: rgba(255,140,66,0.55) !important; background: rgba(255,140,66,0.08) !important; }
          @keyframes ffcardout { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(-6px) scale(0.985); } }
          /* Pins ride inside the scroll container: make it the positioning
             context so the markers scroll natively with the pages (no shake).
             The page stays centered; cards fit the existing right margin. */
          .ff-script-host .paginated-canvas { position: relative; }
          /* Screenplay margins: the page text is a fixed 6in column; the card
             pads 1in both sides, so the 6in column sits left-biased (1in left /
             1.5in right — backwards). Bump the left pad to 1.5in so the column
             carries proper 1.5in-left / 1in-right screenplay margins, and the
             content box equals the text width (markers land beside the text).
             Overrides the inline 96px padding-left; scoped to freeform only. */
          .ff-script-host .paginated-page-card { padding-left: 144px !important; }
          /* Standard screenplay element indents (1in = 96px here). The shared
             editor's theme rules use approximate margins; these land the exact
             StudioBinder spec, freeform-scoped. Scene/action/shot/etc. stay at
             the 1.5in left margin (base). The .screenplay-content-area in the
             chain out-specifies the shared .dark-theme/.light-theme rules. */
          .ff-script-host .screenplay-content-area .ProseMirror p[data-line-type="character"] { margin-left: 192px !important; }      /* 3.5in */
          .ff-script-host .screenplay-content-area .ProseMirror p[data-line-type="dialogue"] { margin-left: 96px !important; width: 288px !important; }  /* 2.5in - 5.5in */
          .ff-script-host .screenplay-content-area .ProseMirror p[data-line-type="parenthetical"] { margin-left: 144px !important; width: auto !important; }  /* 3.0in */
          .ff-script-host .screenplay-content-area .ProseMirror p[data-line-type="transition"] { margin-left: 0 !important; width: 576px !important; text-align: right !important; }  /* to 7.5in (right margin) */
          /* Toolbar action cluster (top bar, right side). Theme values ride
             the --tb-* vars set inline on the bar; hover/active/focus states
             live here because inline styles cannot express them. */
          .ff-tb-btn { height: 26px; border-radius: 7px; font-family: inherit; font-size: 11.5px; font-weight: 600; letter-spacing: 0.1px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; transition: background 160ms cubic-bezier(0.32,0.72,0,1), border-color 160ms cubic-bezier(0.32,0.72,0,1), color 160ms cubic-bezier(0.32,0.72,0,1), transform 120ms cubic-bezier(0.32,0.72,0,1); }
          .ff-tb-btn:active { transform: scale(0.97); }
          .ff-tb-btn:focus-visible { outline: 1.5px solid rgba(255,140,66,0.6); outline-offset: 1px; }
          .ff-tb-ghost { border: 1px solid transparent; background: transparent; color: var(--tb-mut); padding: 0 8px; }
          .ff-tb-ghost:hover { background: var(--tb-hov); color: var(--tb-txt); }
          .ff-tb-seg { display: inline-flex; align-items: stretch; height: 26px; border: 1px solid var(--tb-hair); border-radius: 7px; overflow: hidden; }
          .ff-tb-seg-div { width: 1px; background: var(--tb-hair); flex-shrink: 0; }
          .ff-tb-seg-btn { height: auto; border: none; border-radius: 0; background: transparent; color: var(--tb-mut); padding: 0 10px; }
          .ff-tb-seg-btn:hover { background: var(--tb-hov); color: var(--tb-txt); }
          .ff-tb-seg-btn:active { transform: none; }
          .ff-tb-seg-btn.on { background: var(--tb-peer-bg); color: var(--tb-peer); }
          .ff-tb-seg-btn.on:hover { background: var(--tb-peer-bg-h); color: var(--tb-peer); }
          .ff-tb-count { font-size: 10px; font-weight: 700; line-height: 1; padding: 3px 5px; border-radius: 5px; font-variant-numeric: tabular-nums; background: var(--tb-hov); color: var(--tb-mut); }
          .ff-tb-seg-btn.on .ff-tb-count { background: var(--tb-peer-bg-h); color: var(--tb-peer); }
          .ff-tb-sync { border: 1px solid rgba(255,140,66,0.5); background: rgba(255,107,53,0.12); color: #ff8c42; padding: 0 12px; }
          .ff-tb-sync:hover { border-color: rgba(255,140,66,0.8); background: rgba(255,107,53,0.2); }
          /* Review DOCKET (the .ff-rv-* family). Theme values ride the --rv-*
             vars set inline on the panel root; hover states live here. */
          .ff-rv-row { display: flex; align-items: center; gap: 10px; padding: 10px 8px; cursor: pointer; transition: background 140ms; }
          .ff-rv-row:hover { background: var(--rv-hov); }
          .ff-rv-clip { cursor: pointer; background: var(--rv-clip); transition: background 160ms; }
          .ff-rv-clip:hover { background: var(--rv-clip-h); }
          .ff-rv-goto { margin-left: auto; flex-shrink: 0; border: none; background: transparent; font-family: ${NOTE_FONT_MONO}; font-size: 9.5px; font-weight: 700; letter-spacing: 0.12em; color: var(--rv-mut); padding: 3px 6px; border-radius: 5px; cursor: pointer; transition: color 160ms, background 160ms; }
          .ff-rv-goto:hover { color: #54bfdb; background: rgba(84,191,219,0.08); }
          .ff-rv-x { border: none; background: transparent; font-family: inherit; color: var(--rv-faint); font-size: 11px; font-weight: 600; padding: 4px 8px; border-radius: 7px; cursor: pointer; transition: color 160ms, background 160ms; }
          .ff-rv-x:hover { color: var(--rv-mut); background: var(--rv-hov); }
          .ff-rv-mark { display: inline-flex; align-items: center; gap: 7px; border: 1px solid rgba(52,211,153,0.35); background: transparent; font-family: inherit; color: #34d399; font-size: 11px; font-weight: 600; padding: 4px 12px 4px 9px; border-radius: 7px; cursor: pointer; transition: background 160ms cubic-bezier(0.32,0.72,0,1), border-color 160ms; }
          .ff-rv-mark:hover { background: rgba(52,211,153,0.12); border-color: rgba(52,211,153,0.6); }
          .ff-rv-ring { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid rgba(52,211,153,0.55); display: inline-flex; align-items: center; justify-content: center; font-size: 8px; line-height: 1; flex-shrink: 0; }
          .ff-rv-ring::before { content: '✓'; color: transparent; transition: color 120ms; }
          .ff-rv-mark:hover .ff-rv-ring::before { color: #34d399; }
          .ff-rv-discuss { display: inline-flex; align-items: center; gap: 6px; border: 1px solid rgba(84,191,219,0.3); background: transparent; font-family: inherit; color: #54bfdb; font-size: 11px; font-weight: 600; padding: 4px 11px; border-radius: 7px; cursor: pointer; transition: background 160ms, border-color 160ms; }
          .ff-rv-discuss:hover { background: rgba(84,191,219,0.1); border-color: rgba(84,191,219,0.55); }
          .ff-pin-view { border: 1px solid rgba(84,191,219,0.35); background: rgba(19,19,22,0.95); color: #54bfdb; font-size: 10.5px; font-weight: 600; padding: 3px 10px; border-radius: 7px; cursor: pointer; white-space: nowrap; box-shadow: 0 3px 12px rgba(0,0,0,0.3); transition: background 160ms, border-color 160ms; animation: ffpop 120ms ease-out; }
          .ff-pin-view:hover { background: rgba(84,191,219,0.14); border-color: rgba(84,191,219,0.6); }
          .ff-rv-reopen { opacity: 0; transition: opacity 140ms; }
          .ff-rv-row:hover .ff-rv-reopen { opacity: 1; }
        `}</style>
        <div className="ff-script-host" style={{ flex: 1, minHeight: 0, minWidth: 0, marginRight: reviewOpen ? 484 : 0, transition: 'margin-right 240ms cubic-bezier(0.32,0.72,0,1)' }}>
          <ScriptEditor
            key={`${storyId ?? ''}:${reloadTick}`}
            onEditorReady={handleEditorReady}
            editorTheme={theme}
            onThemeToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            isGenerating={false}
            isFullscreen={isFullscreen}
            onFullscreen={() => setIsFullscreen(true)}
            onMinimize={() => setIsFullscreen(false)}
            onScenePositionsUpdate={() => {}}
            onSave={() => void runSave()}
            getAllHTMLRef={getAllHTMLRef}
            getAllEditorsRef={getAllEditorsRef}
            initialContent={initialContent ?? ''}
            characters={characters}
            onAddCharacter={() => {}}
            onUpdateCharacter={() => {}}
            onDeleteCharacter={() => {}}
            token={auth?.token}
            storyData={storyData}
            storyId={storyId ?? ''}
            setUser={() => {}}
            showAIRail={false}
            extraExtensions={EXTRA_EXTENSIONS}
          />
        </div>
      </div>

      {/* PROXY CARD — second click on the active scene row. A light read of
          the underlying card (summary + cast + location) with the door to
          the full sheet. Anchored beside the rail at the clicked row. */}
      {/* Step 8 — DOCUMENT-WIDE PINS (§4b, reshaped 2026-07-21d per Ben). Markers
          live in the page's right margin; a note-card rail opens to their right
          (the .ff-notes-on padding shifts the page left to clear room). Toggle
          The note pops on HOVER only (Ben's call — no more show-all view; the
          Review panel is the place to see everything). Everything renders INSIDE
          the scroll container (content coords) so it tracks the pages natively —
          no shake. Generation is the per-scene peer button (readScene). */}
      {(notesOpen || (reviewOpen && openNoteId != null)) && notesLoaded && allNotes.length > 0 && canvasEl && createPortal(
        (() => {
          const dark = theme === 'dark';
          const s = noteSurface(dark);
          // Card width = the right margin the centered page leaves (clamped).
          const cardW = Math.min(320, Math.max(158, canvasEl.clientWidth - (pinGeom.values().next().value?.cardX ?? 0) - 12));
          const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
          const noteById = new Map(allNotes.map((n) => [n.id, n]));
          const hg = hoverNoteId ? pinGeom.get(hoverNoteId) : null;
          const hn = hoverNoteId ? noteById.get(hoverNoteId) : null;
          const renderCard = (n: ScreenplayNote, g: PinG, top: number) => {
            const c = noteColor(n);
            const on = hoverNoteId === n.id;
            return (
              <div
                key={`card-${n.id}`}
                onMouseEnter={() => openHover(n.id)}
                onMouseLeave={scheduleCloseHover}
                onClick={() => jumpToNote(n)}
                style={{ position: 'absolute', top, left: g.cardX, width: cardW, zIndex: on ? 61 : 52, cursor: 'pointer', fontFamily: NOTE_FONT_SANS, background: s.raise, border: `1px solid ${on ? c : s.hair}`, borderLeft: `2px solid ${c}`, borderRadius: 11, padding: '12px 13px', boxShadow: on ? '0 14px 34px rgba(0,0,0,0.42)' : '0 3px 14px rgba(0,0,0,0.22)', transition: 'top 200ms cubic-bezier(0.22,1,0.36,1), border-color 140ms, box-shadow 140ms' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                  <span style={{ width: 6, height: 6, borderRadius: 999, background: c, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: s.quiet, letterSpacing: 0.2 }}>{cap(n.tier)}</span>
                  {n.intent_gap && <span style={{ fontSize: 10.5, fontWeight: 600, color: '#ff8c42' }}>· gap</span>}
                  {!g.found && n.anchor && <span title="The line this note was pinned to has changed; the note may be stale." style={{ fontSize: 10.5, color: s.faint, marginLeft: 'auto' }}>moved</span>}
                </div>
                <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 13.5, color: s.voice, lineHeight: 1.55, letterSpacing: 0.1, marginBottom: latestProgressNote(n) ? 7 : 12 }}>{n.diagnosis}</div>
                {latestProgressNote(n) && (
                  <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 11.5, color: s.quiet, lineHeight: 1.45, marginBottom: 12 }}><span style={{ color: PEER_BLUE, opacity: 0.85 }}>Since your rewrite:</span> {latestProgressNote(n)}</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <button className="ff-rv-discuss" onClick={(e) => { e.stopPropagation(); setPassIdx(TIER_TO_PASS[n.tier] ?? 0); setReviewOpen(true); openDiscuss(n); }} title="Discuss this note with the peer">◌ Discuss</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setPassIdx(TIER_TO_PASS[n.tier] ?? 0); setDiscussNote(null); setReviewOpen(true); setOpenNoteId(n.id); }}
                    title="Open this note in the Review panel"
                    style={{ fontSize: 11, fontWeight: 600, padding: '4px 11px', borderRadius: 7, cursor: 'pointer', border: `1px solid ${dark ? '#2a2a30' : '#e2dacb'}`, background: 'transparent', color: s.quiet }}
                  >Expand</button>
                  <button className="ff-rv-mark" onClick={(e) => { e.stopPropagation(); void settleNote(n.id, 'resolved'); }} title="I addressed this note"><span className="ff-rv-ring" />Mark addressed</button>
                  <button onClick={(e) => { e.stopPropagation(); void settleNote(n.id, 'dismissed'); }} title="Not taking this note" style={{ fontSize: 11.5, fontWeight: 500, padding: '5px 4px', borderRadius: 7, cursor: 'pointer', border: 'none', background: 'transparent', color: s.faint, marginLeft: 'auto' }}>Dismiss</button>
                </div>
              </div>
            );
          };
          // The Review's expanded card lights its anchor line with the SAME
          // highlight as pin hover — presence only, no scroll (the jump is
          // GO TO LINE's job). Hover wins when both point at one note.
          const rvN = reviewOpen && openNoteId && openNoteId !== hoverNoteId ? noteById.get(openNoteId) : null;
          const rvG = rvN ? pinGeom.get(rvN.id) : null;
          return (
            <>
              {/* Stylized highlight over the hovered note's anchor line. */}
              {hg && hg.hl && hn && (
                <div style={{ position: 'absolute', top: hg.hl.top - 2, left: hg.hl.left - 5, width: hg.hl.width + 10, height: hg.hl.height + 4, borderRadius: 5, background: `${noteColor(hn)}26`, boxShadow: `inset 0 0 0 1px ${noteColor(hn)}66, 0 0 14px ${noteColor(hn)}3a`, zIndex: 40, pointerEvents: 'none', animation: 'ffpop 120ms ease-out' }} />
              )}
              {/* ...and over the Review-expanded note's line. */}
              {rvG && rvG.hl && rvN && (
                <div style={{ position: 'absolute', top: rvG.hl.top - 2, left: rvG.hl.left - 5, width: rvG.hl.width + 10, height: rvG.hl.height + 4, borderRadius: 5, background: `${noteColor(rvN)}26`, boxShadow: `inset 0 0 0 1px ${noteColor(rvN)}66, 0 0 14px ${noteColor(rvN)}3a`, zIndex: 40, pointerEvents: 'none', animation: 'ffpop 120ms ease-out' }} />
              )}
              {/* Markers in the margin — the pins layer only. */}
              {notesOpen && Array.from(pinGeom.entries()).map(([id, g]) => {
                const n = noteById.get(id);
                if (!n) return null;
                const c = noteColor(n);
                const hovered = hoverNoteId === id;
                const focused = focusNoteId === id;
                return (
                  <div
                    key={id}
                    onMouseEnter={() => openHover(id)}
                    onMouseLeave={scheduleCloseHover}
                    style={{ position: 'absolute', top: g.markerTop, left: g.markerX, zIndex: hovered ? 60 : 50, padding: 4, margin: -4 }}
                  >
                    {/* No title attr: the native tooltip pops right over the
                        hover card and obscures it (Ben). The card IS the info. */}
                    <div
                      onClick={() => jumpToNote(n)}
                      style={{ width: 11, height: 11, borderRadius: 3, background: c, cursor: 'pointer', border: `1.5px solid ${dark ? '#0e0e10' : '#fbf8f1'}`, boxShadow: focused ? `0 0 0 3px ${c}66` : (hovered ? `0 0 0 3px ${c}55` : '0 1px 3px rgba(0,0,0,0.3)'), transform: hovered ? 'scale(1.15)' : 'none', transition: 'box-shadow 140ms, transform 140ms', animation: reviewingScenes.has(n.event_id ?? '') ? 'ffblink 1.1s ease-in-out infinite' : undefined }}
                    />
                  </div>
                );
              })}
              {/* Card: only the hovered one, aligned to its line. With the
                  Review panel open the margin is narrow and the full card is
                  redundant: show a compact "View card" pill instead (nothing
                  when the hovered note IS the panel's open card). */}
              {notesOpen && hn && hg ? (
                reviewOpen ? (
                  hn.id !== openNoteId ? (
                    <button
                      className="ff-pin-view"
                      onMouseEnter={() => openHover(hn.id)}
                      onMouseLeave={scheduleCloseHover}
                      onClick={() => { setPassIdx(TIER_TO_PASS[hn.tier] ?? 0); setDiscussNote(null); setOpenNoteId(hn.id); }}
                      style={{ position: 'absolute', top: hg.lineTop - 2, left: hg.cardX, zIndex: 61 }}
                    >View card</button>
                  ) : null
                ) : renderCard(hn, hg, hg.lineTop - 6)
              ) : null}
            </>
          );
        })(),
        canvasEl,
      )}

      {/* Small fixed status toast (outside the scroll container): reading a
          scene, an error, or the empty state. */}
      {notesOpen && (readingScene || readingDraft || notesBusy || notesError || draftVerdict || (notesLoaded && allNotes.length === 0)) && (() => {
        const dark = theme === 'dark';
        const spinning = !!readingScene || readingDraft || notesBusy;
        const cleanBill = !readingDraft && !readingScene && !notesBusy && !notesError && !!draftVerdict;
        // The static toasts (empty state + error) are dismissible; the spinner
        // states are transient (they self-clear) so they ignore the flag.
        const dismissible = !spinning;
        if (dismissible && statusToastDismissed) return null;
        const msg = readingDraft ? 'The peer is reading the whole draft…'
          : readingScene ? 'Reading the scene…'
          : notesBusy ? 'Loading notes…'
          : draftVerdict ? draftVerdict
          : (notesError || 'No notes yet. Use the peer button on a scene in the outline to read it.');
        return (
          <div style={{ position: 'fixed', bottom: 16, right: 16, zIndex: 870, maxWidth: 300, padding: '9px 12px', borderRadius: 9, fontFamily: 'system-ui, sans-serif', fontSize: 12, lineHeight: 1.45, display: 'flex', alignItems: 'center', gap: 8, background: dark ? 'rgba(20,20,23,0.96)' : 'rgba(255,255,255,0.98)', border: `1px solid ${notesError ? 'rgba(245,158,11,0.5)' : cleanBill ? 'rgba(84,191,219,0.5)' : (dark ? '#26262c' : '#e8e0d2')}`, boxShadow: '0 8px 26px rgba(0,0,0,0.28)', color: notesError ? '#f59e0b' : cleanBill ? PEER_BLUE : (dark ? '#c9c9d1' : '#555') }}>
            {spinning && <span style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid rgba(96,165,250,0.3)', borderTopColor: '#60a5fa', display: 'inline-block', animation: 'ffspin 0.9s linear infinite', flexShrink: 0 }} />}
            <span>{msg}</span>
            {dismissible && (
              <button
                onClick={() => { if (cleanBill) setDraftVerdict(''); else setStatusToastDismissed(true); }}
                title="Dismiss"
                style={{ border: 'none', background: 'transparent', color: cleanBill ? PEER_BLUE : (dark ? '#9a9aa4' : '#999'), fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: '0 2px', flexShrink: 0, marginLeft: 'auto' }}
              >×</button>
            )}
          </div>
        );
      })()}

      {/* Step 8 — PASSES (§4b): the "Review with the peer" session. Work the
          notes down one altitude at a time, big-picture first (Jack Epps Jr's
          Pass Method): Structure -> Character -> Scene -> Dialogue. */}
      {reviewOpen && (() => {
        const dark = theme === 'dark';
        const s = noteSurface(dark);
        // DOCKET entries: active notes + this session's settled rows (struck,
        // kept in place — the pass is its own record of who cleared what).
        type DkSettled = 'resolved' | 'dismissed' | 'auto' | null;
        type DkEntry = { note: ScreenplayNote; settled: DkSettled };
        const entries: DkEntry[] = [
          ...allNotes.map((n) => ({ note: n, settled: null as DkSettled })),
          ...settledLog.map((e) => ({ note: e.note, settled: e.state as DkSettled })),
          // Auto-resolved records: cleared by the writer's REWRITE, not their hand.
          ...autoLog.map((n) => ({ note: n, settled: 'auto' as DkSettled })),
        ];
        const passOf = (n: ScreenplayNote) => TIER_TO_PASS[n.tier] ?? 0;
        // Stable docket order: spine position, intent gaps first within a scene,
        // then id — so settled rows hold their place instead of jumping around.
        const byOrder = (a: DkEntry, b: DkEntry) =>
          ((sceneLabelById.get(a.note.event_id ?? '')?.order ?? 999) - (sceneLabelById.get(b.note.event_id ?? '')?.order ?? 999))
          || (Number(b.note.intent_gap) - Number(a.note.intent_gap))
          || a.note.id.localeCompare(b.note.id);
        const activeCounts = PASS_DEFS.map((_, i) => allNotes.filter((n) => passOf(n) === i).length);
        const allClear = allNotes.length === 0 && settledLog.length === 0;
        const pass = PASS_DEFS[passIdx];
        const passEntries = entries.filter((e) => passOf(e.note) === passIdx).sort(byOrder);
        const passSettled = passEntries.filter((e) => e.settled).length;
        const nextWithNotes = () => { for (let i = passIdx + 1; i < PASS_DEFS.length; i++) if (activeCounts[i] > 0) return i; return Math.min(passIdx + 1, PASS_DEFS.length - 1); };
        // Scene-order grouping (spine order), for the "Scene" sort.
        const bySceneMap = new Map<string, DkEntry[]>();
        for (const e of entries) { const k = e.note.event_id ?? ''; if (!bySceneMap.has(k)) bySceneMap.set(k, []); bySceneMap.get(k)!.push(e); }
        const sceneGroups = Array.from(bySceneMap.entries())
          .sort((a, b) => (sceneLabelById.get(a[0])?.order ?? 999) - (sceneLabelById.get(b[0])?.order ?? 999))
          .map(([eid, ns]) => ({ eid, lab: sceneLabelById.get(eid), entries: ns.slice().sort((x, y) => (passOf(x.note) - passOf(y.note)) || (Number(y.note.intent_gap) - Number(x.note.intent_gap)) || x.note.id.localeCompare(y.note.id)) }));
        // The open row's clipping — computed for the one open note only (a
        // ProseMirror state walk, no layout reads).
        const openNote = openNoteId ? allNotes.find((n) => n.id === openNoteId) ?? null : null;
        const openClip = openNote ? getClipForNote(openNote) : null;

        // DOCKET ROW (+ the expanded note card: slate with SC only, the tier
        // light-leak, the LIVE clipping, the voice, and the action rail with
        // Discuss (dead, §6 placeholder) / Dismiss / Mark addressed).
        const CLIP_CENTER = new Set(['character', 'dialogue', 'parenthetical']);
        const docketRow = (e: DkEntry) => {
          const n = e.note;
          const c = noteColor(n);
          const lab = sceneLabelById.get(n.event_id ?? '');
          const scTxt = lab ? `SC ${String(lab.scNo).padStart(2, '0')}` : 'SC';
          const open = !e.settled && openNoteId === n.id;
          const movedChip = !e.settled && !!n.anchor && pinGeom.get(n.id)?.found === false;
          if (e.settled) {
            // Struck row: the record. Click to reopen (keep-bias — the settle
            // stamped state, never deleted). The mark says WHO cleared it:
            // green check = your hand, peer-blue check = your rewrite (auto),
            // gray x = dismissed.
            const auto = e.settled === 'auto';
            return (
              <div key={n.id} className="ff-rv-row" onClick={() => void (auto ? unsettleAutoNote(n.id) : unsettleNote(n.id))} title={auto ? `Cleared by your rewrite${n.resolve_note ? `: ${n.resolve_note}` : ''}` : undefined} style={{ borderBottom: `1px solid ${s.hairSoft}` }}>
                <span style={{ width: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: auto ? PEER_BLUE : e.settled === 'resolved' ? '#34d399' : s.faint, fontSize: 12, lineHeight: 1 }}>{e.settled === 'dismissed' ? '×' : '✓'}</span>
                <span style={{ fontFamily: NOTE_FONT_MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: s.faint, flexShrink: 0 }}>{scTxt}</span>
                <span style={{ flex: 1, minWidth: 0, fontFamily: NOTE_FONT_SERIF, fontSize: 13, lineHeight: 1.4, color: s.faint, textDecoration: 'line-through', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.diagnosis}</span>
                {auto && <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: PEER_BLUE, opacity: 0.75, flexShrink: 0 }}>REWRITE</span>}
                <span className="ff-rv-reopen" style={{ fontSize: 10, fontWeight: 600, color: s.faint, flexShrink: 0 }}>reopen</span>
              </div>
            );
          }
          const clip = open ? openClip : null;
          const refTxt = !clip ? ''
            : clip.state === 'gone' ? 'scene not in the draft'
            : clip.state === 'moved' ? `p.${clip.pageNo ?? '?'} · line edited since this note`
            : clip.span ? `p.${clip.pageNo ?? '?'} · ${clip.span} lines`
            : `p.${clip.pageNo ?? '?'}${n.anchor ? '' : ' · whole scene'}`;
          return (
            <div key={n.id} style={{ borderBottom: `1px solid ${s.hairSoft}` }}>
              {/* Collapsed: the one-line row. Open: the row disappears — the
                  card's slate IS the header (Ben: no double header). */}
              {!open && (
                <div className="ff-rv-row" onClick={() => setOpenNoteId(n.id)}>
                  <span style={{ width: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {reviewingScenes.has(n.event_id ?? '')
                      ? <span title="The peer is rereading this scene's notes against your rewrite." style={{ width: 9, height: 9, borderRadius: '50%', border: `2px solid ${c}44`, borderTopColor: c, display: 'inline-block', animation: 'ffspin 0.9s linear infinite' }} />
                      : <span style={{ width: 3, height: 22, borderRadius: 2, background: c }} />}
                  </span>
                  <span style={{ fontFamily: NOTE_FONT_MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: s.faint, flexShrink: 0 }}>{scTxt}</span>
                  {n.mode === 'sequence' && <span title="From a sequence read" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: PEER_BLUE, border: '1px solid rgba(84,191,219,0.35)', borderRadius: 4, padding: '1.5px 4px', flexShrink: 0 }}>SEQ</span>}
                  {n.mode === 'draft' && <span title={`From the draft read${n.votes ? ` · ${n.votes} of 3 readers` : ''}`} style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: PEER_BLUE, border: '1px solid rgba(84,191,219,0.35)', borderRadius: 4, padding: '1.5px 4px', flexShrink: 0 }}>DRAFT</span>}
                  <span style={{ flex: 1, minWidth: 0, fontFamily: NOTE_FONT_SERIF, fontSize: 13, lineHeight: 1.4, color: s.voice, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.diagnosis}</span>
                  {latestProgressNote(n) && <span title="The peer read your rewrite: this moved, but it is still open." style={{ width: 6, height: 6, borderRadius: 999, border: `1.5px solid ${PEER_BLUE}`, flexShrink: 0 }} />}
                  {n.intent_gap && <span title="Intent gap: the pages diverge from what the outline intends here." style={{ width: 6, height: 6, borderRadius: 999, background: '#ff8c42', flexShrink: 0 }} />}
                  {movedChip && <span title="This note's line has been edited since the note was written." style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: '#eab308', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 4, padding: '1.5px 5px', flexShrink: 0 }}>EDITED</span>}
                  <span style={{ color: s.faint, fontSize: 10, flexShrink: 0 }}>›</span>
                </div>
              )}
              {open && (
                <div style={{ padding: '8px 8px 14px' }}>
                  <article style={{ background: dark ? '#09090b' : '#fff', border: `1px solid ${dark ? '#1c1c22' : s.hair}`, borderRadius: 10, overflow: 'hidden', boxShadow: dark ? '0 16px 40px -30px rgba(0,0,0,0.9)' : '0 4px 16px rgba(0,0,0,0.08)' }}>
                    {/* slate: the card's ONLY header — SC number (no scene
                        heading — Ben's call), page ref, jump. Click collapses. */}
                    <div onClick={() => setOpenNoteId(null)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 13px', cursor: 'pointer' }}>
                      <span style={{ fontFamily: NOTE_FONT_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', color: c, flexShrink: 0 }}>{scTxt}</span>
                      <span style={{ fontFamily: NOTE_FONT_MONO, fontSize: 9.5, letterSpacing: '0.08em', color: s.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{refTxt}</span>
                      {n.intent_gap && <span style={{ fontFamily: NOTE_FONT_MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#ff8c42', flexShrink: 0, animation: 'ffblink 1.6s ease-in-out infinite' }}>INTENT GAP</span>}
                      <button className="ff-rv-goto" onClick={(ev) => { ev.stopPropagation(); setNotesOpen(true); jumpToNote(n); }}>GO TO LINE →</button>
                      <span style={{ color: s.faint, fontSize: 10, flexShrink: 0, transform: 'rotate(90deg)' }}>›</span>
                    </div>
                    {/* the tier light-leak — kept, one appearance, full strength */}
                    <div style={{ height: 2, background: `linear-gradient(90deg, ${c}, ${c}44 55%, transparent 90%)`, boxShadow: `0 2px 16px 0 ${c}55` }} />
                    {/* the CLIPPING — a live window into the current pages */}
                    {clip && clip.state === 'intact' && clip.lines.length > 0 && (
                      <div className="ff-rv-clip" onClick={(ev) => { ev.stopPropagation(); setNotesOpen(true); jumpToNote(n); }} style={{ padding: '10px 14px', borderBottom: `1px solid ${s.hairSoft}` }}>
                        {clip.lines.map((l, i) => l.lineType === 'fold' ? (
                          <div key={i} style={{ fontFamily: NOTE_FONT_MONO, fontSize: 9.5, letterSpacing: '0.18em', color: dark ? '#55555e' : '#a59a86', textAlign: 'center', padding: '3px 0' }}>{l.text}</div>
                        ) : (
                          <div key={i} style={{ fontFamily: NOTE_FONT_MONO, fontSize: 11.5, lineHeight: 1.5, color: l.hl ? (dark ? '#efe9dc' : '#26262a') : (dark ? '#a19c90' : '#8a8578'), background: l.hl ? `${c}1a` : 'transparent', borderLeft: `2px solid ${l.hl ? c : 'transparent'}`, padding: '1px 6px', textAlign: CLIP_CENTER.has(l.lineType) ? 'center' : 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.text}</div>
                        ))}
                      </div>
                    )}
                    {clip && clip.state !== 'intact' && !!n.anchor && (
                      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${s.hairSoft}` }}>
                        <div style={{ fontFamily: NOTE_FONT_MONO, fontSize: 11.5, lineHeight: 1.5, color: s.faint }}>{n.anchor}</div>
                        <div style={{ fontSize: 10, color: s.faint, marginTop: 5 }}>From an earlier draft. {clip.state === 'gone' ? 'The scene is no longer in the document.' : 'The line has changed since this note.'}</div>
                      </div>
                    )}
                    {/* the voice + the rail */}
                    <div style={{ padding: '12px 14px 11px' }}>
                      <p style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 14.5, lineHeight: 1.55, letterSpacing: 0.1, color: s.voice, margin: latestProgressNote(n) ? '0 0 8px' : '0 0 12px' }}>{n.diagnosis}</p>
                      {latestProgressNote(n) && (
                        <p style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 12.5, lineHeight: 1.5, color: s.quiet, margin: '0 0 12px' }}><span style={{ color: PEER_BLUE, opacity: 0.85 }}>Since your rewrite:</span> {latestProgressNote(n)}</p>
                      )}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button className="ff-rv-discuss" onClick={(ev) => { ev.stopPropagation(); openDiscuss(n); }} title="Discuss this note with the peer">◌ Discuss</button>
                        <span style={{ flex: 1 }} />
                        <button className="ff-rv-x" onClick={(ev) => { ev.stopPropagation(); void settleNote(n.id, 'dismissed'); }} title="Not taking this note">Dismiss</button>
                        <button className="ff-rv-mark" onClick={(ev) => { ev.stopPropagation(); void settleNote(n.id, 'resolved'); }} title="I addressed this note"><span className="ff-rv-ring" />Mark addressed</button>
                      </div>
                    </div>
                  </article>
                </div>
              )}
            </div>
          );
        };

        return (
          <div style={{
            position: 'fixed', right: 0, top: 44, bottom: 0, width: 484, zIndex: 890, background: s.panel, borderLeft: `1px solid ${s.hair}`, boxShadow: '-18px 0 50px rgba(0,0,0,0.4)', fontFamily: NOTE_FONT_SANS, display: 'flex', flexDirection: 'column',
            // Docket hover/clip tokens for the .ff-rv-* classes (injected style
            // block) — inline styles can't express hover states.
            ...({ '--rv-hov': dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.035)', '--rv-clip': dark ? '#101013' : '#f6f0e2', '--rv-clip-h': dark ? '#15151a' : '#f1e9d7', '--rv-mut': s.quiet, '--rv-faint': s.faint }),
          } as React.CSSProperties}>
            {discussNote ? (() => {
              // §6 — the panel transformed into the note's chat. The peer
              // opens with the note itself (+ its progress trail); the writer
              // talks back; prescription is sanctioned in here.
              const dn = discussNote;
              const c = noteColor(dn);
              const dlab = sceneLabelById.get(dn.event_id ?? '');
              const dsc = dlab ? `SC ${String(dlab.scNo).padStart(2, '0')}` : 'SC';
              let progressTrail: string[] = [];
              try { progressTrail = (JSON.parse(dn.progress_log || '[]') as Array<{ note?: string }>).map((x) => x.note ?? '').filter(Boolean); } catch { /* ignore */ }
              const peerBubble: React.CSSProperties = { alignSelf: 'flex-start', maxWidth: '88%', background: dark ? '#131316' : '#fff', border: `1px solid ${dark ? '#1f1f24' : s.hair}`, borderLeft: `2px solid ${PEER_BLUE}`, borderRadius: 11, padding: '10px 13px', fontFamily: NOTE_FONT_SERIF, fontSize: 13.5, lineHeight: 1.55, color: s.voice, whiteSpace: 'pre-wrap' };
              return (
                <div key={`discuss-${dn.id}`} style={{ display: 'flex', flexDirection: 'column', height: '100%', animation: 'ffslidein 240ms cubic-bezier(0.32,0.72,0,1)' }}>
                  <div style={{ padding: '14px 20px 12px', borderBottom: `1px solid ${s.hair}`, flexShrink: 0 }}>
                    <button onClick={() => setDiscussNote(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: s.faint, fontSize: 11.5, fontWeight: 600, padding: 0, marginBottom: 10 }}>← Review</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: PEER_BLUE, display: 'inline-flex', flexShrink: 0, filter: `drop-shadow(0 0 8px ${PEER_BLUE}66)` }}>
                        <InternIcon size={22} />
                      </span>
                      <span style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 16, fontWeight: 600, color: s.ink }}>On this note</span>
                      <span style={{ flex: 1 }} />
                      <span style={{ fontFamily: NOTE_FONT_MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', color: c }}>{dsc}</span>
                      <span style={{ width: 6, height: 6, borderRadius: 999, background: c, flexShrink: 0 }} />
                    </div>
                  </div>
                  <div ref={discussScrollRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={peerBubble}>{dn.diagnosis}</div>
                    {progressTrail.map((pTxt, i) => (
                      <div key={`pg-${i}`} style={{ alignSelf: 'flex-start', maxWidth: '85%', border: `1px solid ${s.hairSoft}`, borderLeft: `2px solid ${PEER_BLUE}55`, borderRadius: 10, padding: '7px 11px', fontFamily: NOTE_FONT_SERIF, fontSize: 12, lineHeight: 1.5, color: s.quiet }}>
                        <span style={{ color: PEER_BLUE, opacity: 0.85 }}>Since your rewrite:</span> {pTxt}
                      </div>
                    ))}
                    {discussLoading && <div style={{ alignSelf: 'flex-start', color: s.faint, fontSize: 11.5 }}>Loading the conversation…</div>}
                    {discussTurns.map((t, i) => t.role === 'peer' ? (
                      <div key={t.turnId ?? `t-${i}`} style={peerBubble}>{t.content}</div>
                    ) : (
                      <div key={t.turnId ?? `t-${i}`} style={{ alignSelf: 'flex-end', maxWidth: '85%', background: dark ? '#1c1c22' : '#efe7d7', borderRadius: 11, padding: '9px 13px', fontFamily: NOTE_FONT_SANS, fontSize: 13, lineHeight: 1.5, color: s.ink, whiteSpace: 'pre-wrap' }}>{t.content}</div>
                    ))}
                    {discussBusy && (
                      <div style={{ alignSelf: 'flex-start', display: 'inline-flex', gap: 4, padding: '10px 13px' }}>
                        {[0, 1, 2].map((i) => <span key={i} style={{ width: 6, height: 6, borderRadius: 999, background: s.faint, animation: `ffblink 1.2s ease-in-out ${i * 0.18}s infinite` }} />)}
                      </div>
                    )}
                    {discussError && <div style={{ color: '#f87171', fontSize: 11.5 }}>The peer didn't answer: {discussError}</div>}
                  </div>
                  <div style={{ flexShrink: 0, padding: '12px 16px 16px', borderTop: `1px solid ${s.hair}`, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea
                      value={discussInput}
                      onChange={(e) => setDiscussInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendDiscuss(); } }}
                      placeholder="Talk to the peer about this note…"
                      rows={Math.min(5, Math.max(1, discussInput.split('\n').length))}
                      style={{ flex: 1, resize: 'none', background: dark ? '#131316' : '#fff', border: `1px solid ${dark ? '#26262c' : s.hair}`, borderRadius: 10, padding: '9px 12px', fontFamily: NOTE_FONT_SANS, fontSize: 13, lineHeight: 1.5, color: s.ink, outline: 'none' }}
                    />
                    <button onClick={() => void sendDiscuss()} disabled={discussBusy || !discussInput.trim()} style={{ flexShrink: 0, border: '1px solid rgba(84,191,219,0.4)', background: discussBusy || !discussInput.trim() ? 'transparent' : 'rgba(84,191,219,0.14)', color: discussBusy || !discussInput.trim() ? s.faint : PEER_BLUE, borderRadius: 9, padding: '8px 14px', fontSize: 12, fontWeight: 600, cursor: discussBusy || !discussInput.trim() ? 'default' : 'pointer' }}>Send</button>
                  </div>
                </div>
              );
            })() : (<>
            <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  {/* the peer's persona — the glasses from the board, once for the whole panel */}
                  <span style={{ color: PEER_BLUE, display: 'inline-flex', flexShrink: 0, filter: `drop-shadow(0 0 8px ${PEER_BLUE}66)` }}>
                    <InternIcon size={28} />
                  </span>
                  <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 21, fontWeight: 600, color: s.ink, letterSpacing: 0.2 }}>Peer Review</div>
                </div>
                <button onClick={() => { setReviewOpen(false); setDiscussNote(null); }} title="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: s.faint, fontSize: 17, lineHeight: 1, padding: 4, margin: -4 }}>✕</button>
              </div>
              {/* Sort: by severity (altitude passes) or by scene (spine order). */}
              <div style={{ display: 'inline-flex', padding: 3, borderRadius: 9, background: dark ? '#151518' : '#efe7d7', marginBottom: 14 }}>
                {(['severity', 'scene'] as const).map((sortKey) => (
                  <button key={sortKey} onClick={() => setReviewSort(sortKey)} style={{ padding: '5px 14px', borderRadius: 7, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', border: 'none', background: reviewSort === sortKey ? s.raise : 'transparent', color: reviewSort === sortKey ? s.ink : s.faint, boxShadow: reviewSort === sortKey ? '0 1px 3px rgba(0,0,0,0.18)' : 'none' }}>{sortKey === 'severity' ? 'By severity' : 'By scene'}</button>
                ))}
              </div>
              {/* Altitude ladder — only in severity mode. */}
              {reviewSort === 'severity' && (
                <div style={{ display: 'flex', gap: 22, borderBottom: `1px solid ${s.hair}` }}>
                  {PASS_DEFS.map((p, i) => {
                    const active = i === passIdx;
                    const clear = activeCounts[i] === 0;
                    // The active tab tints with ITS OWN pass's tier color (the
                    // old hardcoded blue read as Structure's color on every tab).
                    const pc = NOTE_TIER_COLORS[p.tiers[p.tiers.length - 1]] ?? '#60a5fa';
                    return (
                      <button key={p.key} onClick={() => setPassIdx(i)} style={{ padding: '0 0 12px', marginBottom: -1, cursor: 'pointer', border: 'none', background: 'none', borderBottom: `2px solid ${active ? pc : 'transparent'}`, display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? s.ink : s.quiet }}>{p.label}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, minWidth: 16, height: 16, padding: '0 5px', borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: clear ? 'transparent' : (active ? `${pc}29` : (dark ? '#1c1c21' : '#efe7d7')), color: clear ? '#34d399' : (active ? pc : s.faint), fontFeatureSettings: '"tnum"' }}>{clear ? '✓' : activeCounts[i]}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px 48px' }}>
              {allClear ? (
                <div style={{ textAlign: 'center', padding: '56px 20px', color: s.voice }}>
                  <div style={{ fontSize: 34, marginBottom: 14, color: '#34d399' }}>✓</div>
                  <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 19, fontWeight: 600, color: s.ink, marginBottom: 10 }}>Every note worked.</div>
                  <div style={{ fontSize: 13, color: s.quiet, lineHeight: 1.6, maxWidth: 300, margin: '0 auto' }}>Read a scene again anytime with the peer button in the outline for a fresh set.</div>
                </div>
              ) : reviewSort === 'scene' ? (
                // BY SCENE — the docket grouped by scene in spine order.
                sceneGroups.map((grp) => (
                  <div key={grp.eid} style={{ marginBottom: 26 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 2, paddingBottom: 8, borderBottom: `1px solid ${s.hairSoft}` }}>
                      <span style={{ fontFamily: NOTE_FONT_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', color: s.ink }}>SC {String(grp.lab?.scNo ?? 0).padStart(2, '0')}</span>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: s.quiet, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{grp.lab?.title ?? ''}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: s.faint, fontFeatureSettings: '"tnum"' }}>{grp.entries.filter((e) => !e.settled).length}</span>
                    </div>
                    {grp.entries.map((e) => docketRow(e))}
                  </div>
                ))
              ) : passEntries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 20px' }}>
                  <div style={{ fontSize: 30, marginBottom: 12, color: '#34d399' }}>✓</div>
                  <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 18, fontWeight: 600, color: s.ink, marginBottom: 8 }}>{pass.label} is clear.</div>
                  <div style={{ fontSize: 13, color: s.quiet, lineHeight: 1.6, marginBottom: 22 }}>Nothing left at this altitude.</div>
                  {passIdx < PASS_DEFS.length - 1 && (
                    <button onClick={() => setPassIdx(nextWithNotes())} style={{ padding: '9px 18px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${dark ? '#2a2a30' : '#e0d8c8'}`, background: s.raise, color: s.ink }}>Next: {PASS_DEFS[nextWithNotes()].label} →</button>
                  )}
                </div>
              ) : (
                <>
                  {/* Pass progress: the blurb, the cleared count, the segbar —
                      then the docket. Settled rows stay, struck: the record. */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                    <span style={{ flex: 1, fontSize: 13, color: s.quiet, lineHeight: 1.6 }}>{pass.blurb}</span>
                    <span style={{ fontSize: 11, color: s.faint, fontFeatureSettings: '"tnum"', flexShrink: 0 }}>{passSettled} of {passEntries.length} cleared</span>
                  </div>
                  <div style={{ display: 'flex', gap: 3, marginBottom: 14 }}>
                    {passEntries.map((_, i) => (
                      <span key={i} style={{ height: 3, flex: 1, borderRadius: 2, background: i < passSettled ? 'rgba(52,211,153,0.8)' : (dark ? '#232328' : '#e5ddcc') }} />
                    ))}
                  </div>
                  <div style={{ borderTop: `1px solid ${s.hairSoft}` }}>
                    {passEntries.map((e) => docketRow(e))}
                  </div>
                  {activeCounts[passIdx] === 0 && passIdx < PASS_DEFS.length - 1 && (
                    <div style={{ textAlign: 'center', marginTop: 20 }}>
                      <div style={{ fontFamily: NOTE_FONT_SERIF, fontSize: 15, color: s.ink, marginBottom: 10 }}>{pass.label} is clear.</div>
                      <button onClick={() => setPassIdx(nextWithNotes())} style={{ padding: '8px 16px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: `1px solid ${dark ? '#2a2a30' : '#e0d8c8'}`, background: s.raise, color: s.ink }}>Next: {PASS_DEFS[nextWithNotes()].label} →</button>
                    </div>
                  )}
                </>
              )}
            </div>
            </>)}
          </div>
        );
      })()}

      {proxyCard && (() => {
        const g = graphData;
        const ent = g?.entities.find((x) => x.id === proxyCard.eventId && !x.deleted_at);
        if (!ent) return null;
        let scNo: number | null = null;
        for (const sec of navSections) {
          for (const sc of sec.scenes) if (sc.eventId === proxyCard.eventId) scNo = sc.scNo;
        }
        const castIds = new Set((g?.edges.involves ?? []).filter((e) => e.from === proxyCard.eventId).map((e) => e.to));
        const cast = (g?.entities ?? []).filter((x) => x.type === 'character' && !x.deleted_at && castIds.has(x.id));
        const locIds = new Set((g?.edges.occurs_in ?? []).filter((e) => e.from === proxyCard.eventId).map((e) => e.to));
        const locs = (g?.entities ?? []).filter((x) => x.type === 'location' && !x.deleted_at && locIds.has(x.id));
        const summary = String(ent.summary ?? ent.description ?? '').trim();
        const top = Math.max(12, Math.min(proxyCard.top, window.innerHeight - 320));
        const dark = theme === 'dark';
        return (
          <>
            <div
              onMouseEnter={cancelProxyClose}
              onMouseLeave={scheduleProxyClose}
              style={{
                position: 'fixed', left: navWidth + 10, top, width: 300, zIndex: 901,
                animation: proxyLeaving ? 'ffcardout 150ms cubic-bezier(0.32,0.72,0,1) forwards' : 'ffcardin 200ms cubic-bezier(0.32,0.72,0,1)',
                transition: 'top 240ms cubic-bezier(0.32,0.72,0,1)',
                borderRadius: 10, padding: '12px 14px', fontFamily: 'system-ui, sans-serif',
                background: dark ? '#141417' : '#fff',
                border: '1px solid rgba(255,107,53,0.4)',
                boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                {scNo !== null && (
                  <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, fontWeight: 700, color: '#ff8c42' }}>
                    SC {String(scNo).padStart(2, '0')}
                  </span>
                )}
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: dark ? '#6b6b74' : '#999' }}>
                  {String(ent.narrative_status ?? 'on_screen').replace('_', ' ')}
                </span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: dark ? '#e6e6ea' : '#1a1a1a', marginBottom: 8, lineHeight: 1.35 }}>
                {ent.working_title ?? ent.working_name}
              </div>
              {summary !== '' && (
                <div style={{ fontSize: 12, color: dark ? '#aeaeb6' : '#555', lineHeight: 1.45, marginBottom: 10 }}>
                  {summary}
                </div>
              )}
              {cast.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5, color: dark ? '#6b6b74' : '#999', marginBottom: 4 }}>Cast</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {cast.map((c) => (
                      <span key={c.id} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: dark ? 'rgba(212,175,55,0.12)' : 'rgba(180,140,20,0.10)', color: dark ? '#d4af37' : '#8a6d1a', border: `1px solid ${dark ? 'rgba(212,175,55,0.35)' : 'rgba(180,140,20,0.3)'}` }}>
                        {c.working_name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {locs.length > 0 && (
                <div style={{ fontSize: 11, color: dark ? '#8a8a93' : '#777', marginBottom: 10 }}>
                  {locs.map((l) => l.working_name).join(' · ')}
                </div>
              )}
              <button
                onClick={() => { setFullCardId(proxyCard.eventId); setProxyCard(null); }}
                style={{
                  width: '100%', padding: '6px 10px', borderRadius: 7, cursor: 'pointer',
                  fontSize: 12, fontWeight: 700, fontFamily: 'system-ui, sans-serif',
                  border: '1px solid rgba(255,107,53,0.5)', background: 'rgba(255,107,53,0.12)', color: '#ff8c42',
                }}
              >
                Open full card
              </button>
            </div>
          </>
        );
      })()}

      {/* FULL CARD — the corkboard's level-3 sheet overlay, mounted here.
          Same components, fed from graphData; onOpenCard re-dispatches so
          in-sheet navigation (cast, member scenes) works. */}
      {fullCardId && auth && storyId && graphData && (() => {
        const e = graphData.entities.find((x) => x.id === fullCardId);
        if (!e) return null;
        const close = () => setFullCardId(null);
        const onChanged = () => { void refreshGraph(); void refreshTitles(); };
        let sheet: React.ReactNode = null;
        if (e.type === 'event') {
          sheet = (
            <EventSheet
              key={fullCardId}
              entity={e}
              signal={{}}
              allEntities={graphData.entities}
              edges={graphData.edges}
              information={graphData.information}
              auth={auth}
              projectId={storyId}
              completedResponseIds={emptyResponseIds}
              onClose={close}
              onEntitiesChanged={onChanged}
              onChangeNarrativeStatus={(next: NarrativeStatus) => {
                void (async () => {
                  try {
                    await updateCardNarrativeStatus({ cardId: e.id, projectId: storyId, narrativeStatus: next }, auth.token);
                    onChanged();
                  } catch (err) {
                    console.warn('[freeform-script] narrative status change failed', err);
                  }
                })();
              }}
              onOpenCard={(id) => setFullCardId(id)}
            />
          );
        } else if (e.type === 'character') {
          sheet = (
            <CharacterSheet
              key={fullCardId}
              entity={e}
              signal={{}}
              allEntities={graphData.entities}
              edges={graphData.edges}
              precedesEdges={graphData.edges.precedes}
              auth={auth}
              projectId={storyId}
              completedResponseIds={emptyResponseIds}
              onClose={close}
              onEntitiesChanged={onChanged}
              onOpenCard={(id) => setFullCardId(id)}
            />
          );
        } else if (e.type === 'sequence') {
          sheet = (
            <SequenceSheet
              key={fullCardId}
              entity={e}
              allEntities={graphData.entities}
              edges={graphData.edges}
              auth={auth}
              projectId={storyId}
              completedResponseIds={emptyResponseIds}
              onClose={close}
              onEntitiesChanged={onChanged}
              onOpenCard={(id) => setFullCardId(id)}
              onUpdateDescription={(d: string) => queuedCardEdit(e.id, 'description', d)}
            />
          );
        } else if (e.type === 'location') {
          sheet = (
            <LocationSheet
              key={fullCardId}
              entity={e}
              allEntities={graphData.entities}
              edges={graphData.edges}
              onClose={close}
            />
          );
        } else if (e.type === 'relationship') {
          sheet = (
            <RelationshipSheet
              key={fullCardId}
              entity={e}
              allEntities={graphData.entities}
              edges={graphData.edges}
              auth={auth}
              projectId={storyId}
              onClose={close}
              onEntitiesChanged={onChanged}
              onUpdateDescription={async (d: string) => queuedCardEdit(e.id, 'description', d)}
            />
          );
        } else if (e.type === 'arc') {
          sheet = (
            <ArcSheet
              key={fullCardId}
              entity={e}
              signal={{}}
              allEntities={graphData.entities}
              edges={graphData.edges}
              auth={auth}
              projectId={storyId}
              onClose={close}
              onEntitiesChanged={onChanged}
              onOpenCard={(id) => setFullCardId(id)}
              onRename={async (n: string) => queuedCardEdit(e.id, 'working_name', n)}
              onUpdateDescription={async (d: string) => queuedCardEdit(e.id, 'description', d)}
            />
          );
        }
        if (!sheet) return null;
        return <ThemeCtx.Provider value={theme}>{sheet}</ThemeCtx.Provider>;
      })()}
    </div>
  );
}
