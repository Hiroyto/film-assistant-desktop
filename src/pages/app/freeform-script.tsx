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
  createCard,
  deleteCard,
  tagEventPrecedes,
  untagEventPrecedes,
  tagSequenceContains,
  type ProjectEntity,
} from '../../lib/freeformApi';
import { topoSortEventsByPrecedes } from '../../components/Freeform/corkboard/connectors';
import '../../components/Scripts/scripts.css';
import '../../components/Scripts/filmassistant-screenplay.css';

// ---- Imported plain script text → screenplay-typed TipTap HTML --------------
const SLUG_LINE = /^(INT|EXT|INT\.\/EXT|I\/E)[.\s]/i;
const TRANSITION = /^(CUT TO:|FADE IN|FADE OUT|FADE TO|DISSOLVE TO:|SMASH CUT)/i;
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function importedTextToHtml(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;
    let type = 'description';
    if (SLUG_LINE.test(t)) type = 'scene';
    else if (TRANSITION.test(t) && t.length <= 24) type = 'transition';
    else if (/^\(.*\)$/.test(t)) type = 'parenthetical';
    else if (
      t === t.toUpperCase() &&
      /^[A-Z0-9 .()'\-]{2,32}$/.test(t) &&
      (lines[i + 1] ?? '').trim() !== ''
    ) type = 'character';
    out.push(`<p data-line-type="${type}">${escapeHtml(t)}</p>`);
  }
  return out.join('');
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
type SceneStatus = 'written' | 'imported' | 'unwritten';

const NAV_OPEN_KEY = 'ff-script-nav-open';

// Build stamp, logged at mount. Bump when editing this file. A long-lived
// tab with a dead HMR socket silently runs stale code (2026-07-08: a stale
// tab re-ran every already-fixed bug in one session — retire loop, missing
// verdict, double-run); this makes "which code is this tab running" a
// one-glance check in the console.
const FF_SCRIPT_BUILD = '2026-07-09d';

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
  const [navOpen, setNavOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(NAV_OPEN_KEY) !== '0'; } catch { return true; }
  });
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

        const proseByBraindump = new Map(bds.braindumps.map((b) => [b.braindumpId, b.prose]));
        const savedByEvent = new Map(
          stexts.sceneTexts.filter((s) => s.eventId !== '__scratch__').map((s) => [s.eventId, s.html]),
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
                  saveSceneText({ projectId: storyId, eventId: evId, html }, token).catch(() => {});
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
              ? 'written'
              : ev.src_start !== undefined && ev.src_start !== ''
              ? 'imported'
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

        // Settled snapshot for the OPEN TAIL (§2b): the LAST rendered scene's
        // blocks as loaded. Anything typed beyond them this session routes to
        // scratch (the walker), and the carve decides extend-vs-mint.
        let lastSceneId: string | null = null;
        let lastHtml = '';
        for (let i = spine.length - 1; i >= 0 && !lastSceneId; i--) {
          const p = parts.find((x) => x.includes(`data-scene-id="${spine[i].id}"`));
          if (p) { lastSceneId = spine[i].id; lastHtml = p; }
        }
        const settledIds = new Set<string>();
        for (const m of lastHtml.matchAll(/data-block-id="([^"]+)"/g)) settledIds.add(m[1]);
        settledRef.current = {
          lastSceneId,
          ids: settledIds,
          count: (lastHtml.match(/<p\b/g) ?? []).length,
        };

        // Persisted scratch restores at the document BOTTOM, below every
        // region, carrying the '__scratch__' tag so the walker keeps it
        // unbound (it is the open tail awaiting its carve). With no regions
        // it is simply the whole document, as before.
        if (scratchHtml) parts.push(tagFirstParagraph(scratchHtml, SCRATCH));
        scratchBaselineRef.current = scratchHtml;

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
    const s = settledRef.current;
    if (s.lastSceneId) {
      const own = out.map((b, i) => ({ b, i })).filter((x) => x.b.regionId === s.lastSceneId);
      if (own.length) {
        let lastSettled = -1;
        if (s.ids.size) {
          for (let j = 0; j < own.length; j++) if (s.ids.has(own[j].b.blockId)) lastSettled = j;
        } else {
          // Pre-ledger content (no block ids at load): positional fallback.
          lastSettled = Math.min(s.count, own.length) - 1;
        }
        for (let j = lastSettled + 1; j < own.length; j++) {
          if (s.ids.size && s.ids.has(own[j].b.blockId)) continue; // settled block moved late — stays bound
          out[own[j].i] = { ...own[j].b, regionId: SCRATCH };
        }
      }
    }
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
  // Settled blocks of the LAST loaded scene (open tail, §2b): captured per
  // mount from the loaded region html; blocks beyond these route to scratch.
  const settledRef = useRef<{ lastSceneId: string | null; ids: Set<string>; count: number }>({
    lastSceneId: null, ids: new Set(), count: 0,
  });
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
    const { collected } = reliableCollect();
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
      if (html !== base) dirty.push({ eventId, html });
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
        for (const { eventId } of dirty) next.set(eventId, 'written');
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
        const sceneText =
          (collectRegionTexts().get(enq.tailSceneId) ?? '') + '\n' + scratchBlocks.slice(0, k).map((x) => x.t).join('\n');
        trackSceneExtraction();
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
            await saveSceneText({ projectId: storyId, eventId: evId, html }, a.token);
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

  const fireScratch = useCallback(() => {
    const a = authRef.current;
    if (!a || !storyId) return;
    // One scratch generation at a time: while an extraction is in flight or
    // awaiting its carve, no new one may start (prevents sibling mints).
    if (scratchEnqueuedRef.current) { void attemptScratchRebuild(); return; }
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
    if (degraded) return;
    const { scratchBlocks } = collected;
    // Prose IS the blocks joined by blank lines — the backend's block-index
    // path verifies this equality before trusting the arithmetic (§2c-ii).
    const prose = scratchBlocks.map((x) => x.t).join('\n\n');
    if (prose.trim().length < 200) return; // unbound content floor (design doc)
    const hash = strHash(normText(prose));
    // Diff recognition: this exact text was already extracted (possibly in a
    // prior session — seeded from the stored braindump prose at load).
    if (extractedScratchHashesRef.current.has(hash)) return;
    // Settling: defer while the text is still moving; re-check shortly.
    const now = Date.now();
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
    const braindumpId = `scratch_${Date.now()}`;
    // Tail context (§2c): the scene this tail follows, for the continuation
    // verdict. Blocks give the prepass its numbered lines (§2c-ii); both are
    // omitted for very large pastes (the windowed import owns those).
    const tailSceneId = settledRef.current.lastSceneId;
    const tailTitle = tailSceneId ? titleByIdRef.current.get(tailSceneId) ?? '' : '';
    const tailText = tailSceneId ? (collectRegionTexts().get(tailSceneId) ?? '').slice(-300) : '';
    const sendBlocks = prose.length <= 40000;
    scratchEnqueuedRef.current = { hash, braindumpId, blocks: scratchBlocks, tailSceneId };
    persistInflight({ braindumpId, hash, tailSceneId, blocks: scratchBlocks.map(({ b, h, l }) => ({ b, h, l })) });
    extractedScratchHashesRef.current.add(hash);
    enqueueExtractionJob(
      {
        jobType: 'extract-braindump', projectId: storyId, userId: a.userId, braindumpId,
        prose, sourceFormat: 'screenplay',
        ...(sendBlocks ? { blocks: scratchBlocks.map((x) => ({ b: x.b, t: x.t })) } : {}),
        ...(sendBlocks && tailTitle ? { tailContext: { sceneTitle: tailTitle, tailText } } : {}),
        // Spine anchor (§2c): the backend chains tailScene → minted scenes
        // in span order, so a tail mint can never float disconnected.
        ...(sendBlocks && tailSceneId ? { tailSceneId } : {}),
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

  const fireExtract = useCallback((eventId: string, opts?: { manual?: boolean; attentionHint?: string }) => {
    if (eventId === SCRATCH) { fireScratch(); return; }
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
    enqueueSceneExtraction(
      {
        projectId: storyId, eventId, userId: a.userId, sceneText: text, ledger,
        ...(opts?.attentionHint ? { attentionHint: opts.attentionHint } : {}),
      },
      a.token,
    ).then(() => {
      window.setTimeout(() => { void refreshTitles(); }, 20000);
      window.setTimeout(() => { void refreshTitles(); }, 45000);
    }).catch((e) => {
      console.warn('[freeform-script] scene extraction enqueue failed', e);
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

  // Fire every pending/dirty check immediately (no grace): tab-hide and
  // leaving the script view. (Sync has its own loop in syncNow.)
  const flushExtractions = useCallback(() => {
    if (manualOnlyRef.current) return; // manual-only: no auto trigger fires
    for (const [eventId, timer] of graceTimersRef.current) {
      window.clearTimeout(timer);
      graceTimersRef.current.delete(eventId);
      fireExtract(eventId);
    }
    if (prevActiveRef.current) fireExtract(prevActiveRef.current);
    fireExtract(SCRATCH);
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
    void runSave();
    // Check EVERY region against the extraction baseline, not just pending ones.
    const texts = collectRegionTexts();
    for (const [eventId] of texts) {
      if (baselineRef.current.has(eventId)) fireExtract(eventId);
    }
    fireExtract(SCRATCH);
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
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 18px', background: theme === 'dark' ? 'rgba(10,10,11,0.94)' : 'rgba(255,255,255,0.94)', borderBottom: `1px solid ${theme === 'dark' ? '#232328' : '#e8e0d2'}`, fontFamily: 'system-ui, sans-serif' }}>
        <Link to={`/freeform/${storyId}`} style={{ color: '#ff8c42', textDecoration: 'none', fontSize: 13, fontWeight: 700 }}>
          ← Board
        </Link>
        <button
          onClick={toggleNav}
          title={navOpen ? 'Hide the outline panel' : 'Show the outline panel'}
          style={{ border: `1px solid ${theme === 'dark' ? '#2a2a30' : '#e0d8c8'}`, background: 'transparent', color: theme === 'dark' ? '#aeaeb6' : '#555', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}
        >
          {navOpen ? '⟨ Outline' : '⟩ Outline'}
        </button>
        <span style={{ color: theme === 'dark' ? '#e6e6ea' : '#1a1a1a', fontSize: 14, fontWeight: 700 }}>Script</span>
        <span style={{ color: '#6b6b74', fontSize: 12 }}>
          {sceneCount} scene{sceneCount === 1 ? '' : 's'} from your outline
        </span>
        <div style={{ flex: 1 }} />
        {statusLabel && (
          <span style={{ fontSize: 12, color: saveState === 'error' ? '#f87171' : saveState === 'saved' ? '#4ade80' : '#aeaeb6' }}>
            {statusLabel}
          </span>
        )}
        <button
          onClick={toggleManualOnly}
          title={manualOnly
            ? 'Auto-sync is off: the outline updates only via Sync, Extract scene, and peer asks. Click to turn auto-sync back on.'
            : 'Auto-sync is on: scenes update the outline as you finish them. Click to switch to manual-only.'}
          style={{
            padding: '4px 10px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
            border: `1px solid ${theme === 'dark' ? '#2a2a30' : '#e0d8c8'}`,
            background: 'transparent',
            color: manualOnly ? '#eab308' : (theme === 'dark' ? '#6b6b74' : '#999'),
          }}
        >
          {manualOnly ? 'Auto-sync off' : 'Auto-sync on'}
        </button>
        <button
          onClick={syncNow}
          title={bgBusy ? 'Working your pages into the outline…' : 'Save and update your outline from these pages now'}
          style={{ padding: '4px 12px', borderRadius: 7, border: '1px solid rgba(255,107,53,0.5)', background: 'rgba(255,107,53,0.12)', color: '#ff8c42', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}
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

      {/* Body: left navigator (the outline, in shell form) + the editor. */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {/* Navigator rail — sequences as sections, scenes as rows. Shell, not
            pages: this is where scene-level graph state lives (status now;
            stale/drift later). */}
        {navOpen && (
          <div style={{ width: 248, flexShrink: 0, overflowY: 'auto', borderRight: `1px solid ${theme === 'dark' ? '#1f1f24' : '#e8e0d2'}`, background: theme === 'dark' ? '#0e0e10' : '#fbf8f1', padding: '10px 0 40px', fontFamily: 'system-ui, sans-serif' }}>
            {navSections.map((sec, si) => (
              <div key={sec.seqId ?? `loose-${si}`} style={{ marginBottom: 6 }}>
                {sec.seqId && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px 3px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: sec.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: theme === 'dark' ? '#9a9aa4' : '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {sec.title}
                    </span>
                  </div>
                )}
                {sec.scenes.map((sc) => {
                  const st = statusById.get(sc.eventId) ?? 'unwritten';
                  const active = activeSceneId === sc.eventId;
                  return (
                    <div
                      key={sc.eventId}
                      onClick={() => scrollToScene(sc.eventId)}
                      title={sc.title}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
                        padding: '4px 14px 4px 18px',
                        background: active ? (theme === 'dark' ? 'rgba(255,107,53,0.10)' : 'rgba(234,88,12,0.08)') : 'transparent',
                        borderLeft: `2px solid ${active ? '#ff6b35' : 'transparent'}`,
                      }}
                    >
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 10, fontWeight: 700, color: active ? '#ff8c42' : '#6b6b74', flexShrink: 0, width: 18 }}>
                        {String(sc.scNo).padStart(2, '0')}
                      </span>
                      <span style={{ fontSize: 12, color: theme === 'dark' ? (active ? '#e6e6ea' : '#b9b9c1') : '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {sc.title}
                      </span>
                      <span
                        title={st}
                        style={{
                          width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                          background: st === 'written' ? '#4ade80' : st === 'imported' ? '#93c5fd' : 'transparent',
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
        )}

        {/* THE screenwriting editor, lifted whole. ff-script-host scopes
            freeform-only overrides: the outline's scene-id badge (::after on
            sluglines) renders our long Event vids as noise — regions must be
            invisible in the pages (design doc §0a). */}
        <style>{`
          .ff-script-host .ProseMirror p[data-line-type="scene"]::after { content: none !important; }
          @keyframes ffspin { to { transform: rotate(360deg); } }
        `}</style>
        <div className="ff-script-host" style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
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
    </div>
  );
}
