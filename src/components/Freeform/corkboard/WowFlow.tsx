// =====================================================================
// WowFlow — the corkboard half of the first-run activation (FIL-506).
//
// The dashboard onboarding hands off here after creating the sample story.
// Beats:
//   Review   → sample prefilled in the dock, EDITABLE; coachmark to send it.
//   Reveal   → on send, the live pipeline streams the graph in card-by-card.
//   Tour     → walk the cards the engine pulled, the spotlight (one TRUE
//              non-obvious finding), then the panel (arc suggestions + the
//              information / dramatic-irony layer).
//   Peer     → open the grounded peer on the spotlight card.
//   Answer   → push the writer to answer one of the peer's questions. Activation
//              fires when a response lands (the graph grows from their answer).
// =====================================================================

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTour, type TourStep } from '../../Tour/TourProvider';
import { ExploreOnOwn } from '../../Tour/ExploreOnOwn';
import { WOW_SAMPLE } from './wowShared';
import type { ListProjectEntitiesResponse, ProjectEntity } from '../../../lib/freeformApi';

export { WOW_SAMPLE };

const ORANGE = '#ff6b35';

function wowEvent(name: string, extra?: Record<string, any>) {
  try {
    // eslint-disable-next-line no-console
    console.info('[wow]', name, JSON.stringify(extra ?? {}));
  } catch {
    /* never let instrumentation break the flow */
  }
}

const displayName = (e?: ProjectEntity) =>
  (e?.working_name || e?.working_title || '').trim() || 'this card';


type Phase =
  | 'review'
  | 'revealing'
  | 'tour'
  | 'guide-expand'
  | 'guide-ask'
  | 'answer'
  | 'guide-fullcard'
  | 'bento-intro'
  | 'bento-tour'
  | 'toolbar-tour'
  | 'done';

export interface WowFlowProps {
  active: boolean;
  data: ListProjectEntitiesResponse | null;
  braindumpPhase: 'idle' | 'submitting' | 'extracting' | 'done' | 'error';
  onPrefillSample: (text: string) => void;
  /** Open / close the right panel (for the panel walkthrough beat). */
  onSetPanel: (open: boolean) => void;
  /** Open the right panel AND force-expand a section (e.g. 'information'). */
  onOpenPanelSection: (id: string) => void;
  /** Open (id) or close (null) the full bento sheet for a card. */
  onOpenSheet: (id: string | null) => void;
  /** Which card's full bento sheet is open (null = none). Lets the wow detect
   *  when the writer opens the full card themselves. */
  sheetOpenId: string | null;
  /** Live state: which card is expanded / has the peer open. The wow advances
   *  when the writer actually expands the card and clicks Ask peer — no forced
   *  jumps; the path to the peer is real. */
  expandedCardId: string | null;
  peerOpenCardId: string | null;
  /** Rises immediately when the writer SUBMITS a response (before the cascade
   *  extracts). The wow reacts to submission, not extraction completion. */
  submissionCount: number;
  /** Report card-action gating to the board: while a coachmark is up the board's
   *  cards are locked, except for the one action the current step is asking for
   *  (expand the card / open the full sheet / ask the peer). */
  onTourGate: (gate: { active: boolean; allow: 'expand' | 'fullcard' | 'ask' | null }) => void;
  /** Force one structural tie to full weight (line + label) while the
   *  relationship beat spotlights it — demoted ties are near-invisible at rest.
   *  null clears. */
  onHighlightTie?: (tie: { from: string; to: string } | null) => void;
  onComplete: () => void;
}

const stepBody = (headline: string, body: React.ReactNode) => (
  <div style={{ maxWidth: 280 }}>
    <div style={{ fontWeight: 700, fontSize: 14 }}>{headline}</div>
    <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{body}</div>
  </div>
);

// A reference to an ACTUAL card on the board (a character / scene / sequence the
// writer wrote) — bright + bold so it reads as "this is your card," reinforcing
// that the engine is pointing at what you gave it, not adding anything.
const cardRef = (text: string) => (
  <strong style={{ color: '#fff', fontWeight: 800 }}>{text}</strong>
);

export default function WowFlow({
  active,
  data,
  braindumpPhase,
  onPrefillSample,
  onSetPanel,
  onOpenPanelSection,
  onOpenSheet,
  sheetOpenId,
  expandedCardId,
  peerOpenCardId,
  submissionCount,
  onTourGate,
  onHighlightTie,
  onComplete,
}: WowFlowProps) {
  const { startTour, endTour } = useTour();
  const [phase, setPhase] = useState<Phase>('review');
  const prefilledRef = useRef(false);
  const tourStartedRef = useRef(false);
  // When 'done' flips, the authoritative post-complete refetch is usually still
  // in flight — the data snapshot at that instant can be missing the structural
  // ties / knowledge the walkthrough beats need (the skipped-relationship bug).
  // Hold until the NEXT data update lands, with a 5s fallback.
  const revealSettleRef = useRef<{ snapshot: unknown; expired: boolean } | null>(null);
  // Set true when we stop waiting for the edge refetch (fallback timeout).
  const revealWaitedRef = useRef(false);
  const [revealTick, setRevealTick] = useState(0);
  // Live viewport position for the guide banners, anchored below the target card
  // so the prompt sits near the card it's talking about (not fixed bottom-center).
  const [cardBannerPos, setCardBannerPos] = useState<{ top: number; left: number } | null>(null);
  const submitBaselineRef = useRef<number | null>(null);
  // The spotlight card the writer is guided to expand + ask the peer on.
  const targetCardRef = useRef<string | null>(null);
  // The card whose full sheet the writer opened — the bento tour walks it.
  const bentoTargetRef = useRef<string | null>(null);
  const guideExpandStartedRef = useRef(false);
  const guideAskStartedRef = useRef(false);
  const bentoTourStartedRef = useRef(false);
  const toolbarTourStartedRef = useRef(false);

  const aliveCount = (data?.entities ?? []).filter((e) => !e.deleted_at).length;
  // Edges only land on the final refetch (braindump_complete) — streamed cards
  // arrive first, edges + metadata after. Used to stage the reveal status so the
  // pause between the two reads as progress, not a hang.
  const edgeCount =
    (data?.edges?.precedes?.length ?? 0) +
    (data?.edges?.involves?.length ?? 0) +
    (data?.edges?.occurs_in?.length ?? 0) +
    (data?.edges?.knowledge?.length ?? 0);

  // Card-action gate: while the wow is showing a coachmark, lock the board's
  // cards so a stray click can't derail the flow — EXCEPT the one action the
  // current step is coaching (expand the card / open the full sheet / ask peer).
  useEffect(() => {
    if (!active) { onTourGate({ active: false, allow: null }); return; }
    const allow =
      phase === 'guide-expand' ? 'expand' :
      phase === 'guide-fullcard' ? 'fullcard' :
      phase === 'guide-ask' ? 'ask' : null;
    // 'review' edits the dock (no cards yet) and 'done' is over — don't gate.
    onTourGate({ active: phase !== 'review' && phase !== 'done', allow });
    // Belt-and-suspenders: whatever ends or leaves the walkthrough (skip,
    // completion, error) also releases the force-lit structural tie.
    if (phase !== 'tour') onHighlightTie?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, phase, onTourGate]);

  // Review: prefill the editable sample + coachmark the dock. If the board
  // already has cards (returning / re-test), skip straight to the reveal path.
  useEffect(() => {
    if (!active || phase !== 'review' || prefilledRef.current) return;
    prefilledRef.current = true;
    if (aliveCount > 0) {
      setPhase('revealing');
      return;
    }
    wowEvent('review_shown');
    onPrefillSample(WOW_SAMPLE);
    startTour(
      [
        {
          id: 'wow-review',
          selector: '[data-tour="braindump-dock"]',
          hideNext: true,
          content: stepBody(
            'Your first idea is loaded.',
            'This sample shows you the engine. Tweak it or send it as-is, then hit Process and watch your story assemble itself.',
          ),
        },
      ],
      { lockScroll: false, onSkip: onComplete },
    );
  }, [active, phase, aliveCount, onPrefillSample, startTour, onComplete]);

  // Review → Reveal: the writer hit Process. Drop the dock coachmark.
  useEffect(() => {
    if (!active || phase !== 'review') return;
    if (braindumpPhase === 'submitting' || braindumpPhase === 'extracting') {
      endTour();
      wowEvent('braindump_processing');
      setPhase('revealing');
    }
  }, [active, phase, braindumpPhase, endTour]);

  // Reveal → Tour: extraction completed. Build the walkthrough — cards, the
  // spotlight, then the panel — and end it by opening the peer.
  useEffect(() => {
    if (!active || tourStartedRef.current) return;
    if (phase !== 'revealing') return;
    if (braindumpPhase === 'error') {
      tourStartedRef.current = true;
      wowEvent('completed', { error: true });
      setPhase('done');
      onComplete();
      return;
    }
    if (braindumpPhase !== 'done' || aliveCount === 0 || !data) return;

    // Settle gate: 'done' fires alongside (not after) the authoritative refetch,
    // so build only once a FRESH data snapshot has landed since the flip — or
    // after 5s if no refetch arrives (lossy WS; the belt's data is then final).
    if (!revealSettleRef.current) {
      revealSettleRef.current = { snapshot: data, expired: false };
      window.setTimeout(() => {
        if (revealSettleRef.current && !tourStartedRef.current) {
          revealSettleRef.current.expired = true;
          setRevealTick((n) => n + 1);
        }
      }, 5000);
      return;
    }
    if (revealSettleRef.current.snapshot === data && !revealSettleRef.current.expired) return;

    // Wait for the edge-bearing refetch so the detector sees the knowledge layer
    // (the irony spotlight) and the throughline is attached before we walk it.
    // Fallback after 7s in case a braindump legitimately produced no edges.
    if (edgeCount === 0 && !revealWaitedRef.current) {
      const t = window.setTimeout(() => { revealWaitedRef.current = true; setRevealTick((n) => n + 1); }, 7000);
      return () => window.clearTimeout(t);
    }

    tourStartedRef.current = true;
    // Advance out of 'revealing' immediately so the status tracker dismisses the
    // moment the walkthrough begins (don't leave it hanging while we build steps).
    setPhase('tour');
    wowEvent('braindump_processed', { entities: aliveCount });

    const alive = data.entities.filter((e) => !e.deleted_at);
    const byId = new Map(alive.map((e) => [e.id, e]));
    const character = alive.find((e) => e.type === 'character');
    const event = alive.find((e) => e.type === 'event');
    // Freshly extracted sequences are member-less, so they render as cards (the
    // card anchor) at reveal — not yet containers. Every beat is conditional: a
    // braindump that produces none of a type simply skips that beat.
    const sequence = alive.find((e) => e.type === 'sequence');
    // A relationship the engine inferred between two of your characters. Prefer
    // the REIFIED Relationship entity (it renders as the red pill on the tie —
    // the exact thing to spotlight); fall back to a structural edge, which is
    // just an SVG line (demoted at rest), so that beat force-lights it and
    // spotlights a tight strip along the segment instead of a card selector.
    let relA: (typeof alive)[number] | undefined;
    let relB: (typeof alive)[number] | undefined;
    let relPillId: string | null = null; // reified pill card to spotlight
    let structTie: { from: string; to: string } | null = null; // structural fallback
    const relEnt = alive.find((e) => e.type === 'relationship');
    if (relEnt) {
      const byName = new Map<string, (typeof alive)[number]>();
      for (const c of alive) {
        if (c.type !== 'character') continue;
        if (c.working_name) byName.set(c.working_name, c);
        for (const al of c.aliases ?? []) byName.set(al, c);
      }
      relA = byName.get(relEnt.character_a ?? '');
      relB = byName.get(relEnt.character_b ?? '');
      if (relA && relB && relA.id !== relB.id) relPillId = relEnt.id;
    }
    if (!relPillId) {
      const structRel = (data.edges?.structural ?? []).find(
        (s) => s?.from && s?.to && s.from !== s.to && byId.get(s.from)?.type === 'character' && byId.get(s.to)?.type === 'character',
      );
      if (structRel) {
        relA = byId.get(structRel.from);
        relB = byId.get(structRel.to);
        structTie = { from: structRel.from, to: structRel.to };
      }
    }
    const relPair = relA && relB && (relPillId || structTie) ? { a: relA, b: relB } : null;

    // Deep-dive prefers an EVENT (a scene reads as the richest peer surface);
    // graceful fallback to a character if the braindump produced no events.
    const peerTarget = event?.id || character?.id;
    targetCardRef.current = peerTarget ?? null;

    const steps: TourStep[] = [];

    // 1) Cast — the engine pulled the characters you wrote + the ties between them.
    if (character) {
      steps.push({
        id: `wow-card-${character.id}`,
        selector: `[data-tour="card-${character.id}"]`,
        content: stepBody(
          'It pulled your cast.',
          <>
            {cardRef(displayName(character))} and your other characters came
            straight out of your prose. The engine does not invent anyone; it
            tracks who you wrote and the relationships between them.
          </>,
        ),
      });
    }

    // 2) Relationship — spotlight the TIE itself, not the whole two-card
    // region: the reified red pill when there is one, else a tight strip along
    // the structural line (force-lit for the beat, since it's demoted at rest).
    if (relPair) {
      const { a: rA, b: rB } = relPair;
      steps.push({
        id: 'wow-relationship',
        selector: relPillId
          ? `[data-tour="card-${relPillId}"]`
          : `[data-tour="card-${rA.id}"]`,
        ...(relPillId
          ? {}
          : {
              getRect: () => {
                const a = document.querySelector(`[data-tour="card-${rA.id}"]`)?.getBoundingClientRect();
                const b = document.querySelector(`[data-tour="card-${rB.id}"]`)?.getBoundingClientRect();
                if (!a || !b) return null;
                // Union of the two FULL pill rects (characters are compact name
                // pills, so this is already a tight band around pill-tie-pill;
                // a center-to-center segment cropped half of each pill).
                const PAD = 12;
                const left = Math.min(a.left, b.left) - PAD;
                const right = Math.max(a.right, b.right) + PAD;
                const top = Math.min(a.top, b.top) - PAD;
                const bottom = Math.max(a.bottom, b.bottom) + PAD;
                // eslint-disable-next-line @typescript-eslint/no-empty-function
                return { top, left, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON() {} } as DOMRect;
              },
            }),
        onEnter: () => onHighlightTie?.(structTie),
        onExit: () => onHighlightTie?.(null),
        content: stepBody(
          'It caught how they connect.',
          <>
            From the way you wrote {cardRef(displayName(rA))} and{' '}
            {cardRef(displayName(rB))}, the engine read the tie between them
            without you stating it. It maps the relationships already in your
            story, it does not add new ones.
          </>,
        ),
      });
    }

    // 3) Scenes — define what an Event is (scene level). No specific name needed.
    if (event) {
      steps.push({
        id: `wow-card-${event.id}`,
        selector: `[data-tour="card-${event.id}"]`,
        content: stepBody(
          'And your scenes.',
          <>
            Each dramatized moment you wrote becomes a scene: one concrete beat
            of the story. The engine lifts the scenes out of your prose and sets
            them in order. It does not write new ones.
          </>,
        ),
      });
    }

    // 4) Sequences — define what a Sequence is. (Dropped the old "open it" line.)
    if (sequence) {
      steps.push({
        id: `wow-card-${sequence.id}`,
        selector: `[data-tour="card-${sequence.id}"]`,
        content: stepBody(
          'It grouped your plot into sequences.',
          <>
            A sequence is a section of your plot: a run of scenes with its own
            arc, the chapters of your outline. The engine grouped the broad
            strokes you wrote into these movements.
          </>,
        ),
      });
    }

    // The panel — suggestions + the facts / knowledge layer. Tooltip is placed to
    // the SIDE so it sits OUTSIDE the panel (the panel hugs the right edge, so
    // 'side' falls back to the left) instead of covering the section it explains.
    steps.push({
      id: 'wow-panel-suggestions',
      selector: '[data-tour="panel-suggestions"]',
      placement: 'side',
      onEnter: () => onSetPanel(true),
      content: stepBody(
        "It's already thinking ahead.",
        'Threads and arcs it noticed across your prose surface here as suggestions. Accept the ones that fit, dismiss the rest. Nothing lands without your say.',
      ),
    });
    steps.push({
      id: 'wow-panel-information',
      selector: '[data-tour="panel-information"]',
      placement: 'side',
      scrollBlock: 'start', // bring the Information section to the top of the panel
      // Expand the Information section (default-collapsed) and pull it to the top.
      onEnter: () => onOpenPanelSection('information'),
      nextLabel: peerTarget ? "Open one of your cards →" : 'Got it →',
      content: stepBody(
        'And it tracked the facts.',
        'Every fact your prose established lives here. The engine just records what your story put on the table.',
      ),
      onExit: () => {
        onSetPanel(false);
        if (peerTarget) {
          setPhase('guide-expand');
        } else {
          setPhase('done');
          onComplete();
        }
      },
    });

    startTour(steps, { lockScroll: false, onSkip: onComplete });
  }, [active, phase, braindumpPhase, aliveCount, data, edgeCount, revealTick, startTour, onSetPanel, onOpenPanelSection, onComplete]);

  // Guide-expand: coach the writer to OPEN the spotlight card (real click).
  // Advances only when they actually expand it. Next stop is the FULL SHEET (the
  // Ask-peer cycle is moved to AFTER the bento walk).
  useEffect(() => {
    if (phase !== 'guide-expand') return;
    const target = targetCardRef.current;
    if (!target) { setPhase('done'); onComplete(); return; }
    if (expandedCardId === target) {
      endTour();
      setPhase('guide-fullcard');
      return;
    }
    if (!guideExpandStartedRef.current) {
      guideExpandStartedRef.current = true;
      startTour(
        [
          {
            id: 'wow-expand',
            selector: `[data-tour="card-${target}"]`,
            hideNext: true,
            content: stepBody('Dig into one.', 'Click this card to open it up.'),
          },
        ],
        { lockScroll: false, onSkip: onComplete },
      );
    }
  }, [phase, expandedCardId, startTour, endTour, onComplete]);

  // Guide-ask: spotlight the Ask-peer button itself, in the tour's orange. This
  // runs AFTER the full-card / bento walk, so the card is stable (no peer-focus
  // glide) and anchoring to the footer button is reliable here. Advances when the
  // peer actually opens.
  useEffect(() => {
    if (phase !== 'guide-ask') return;
    const target = targetCardRef.current;
    if (!target) { setPhase('answer'); return; }
    if (peerOpenCardId === target) {
      wowEvent('peer_asked');
      endTour();
      setPhase('answer');
      return;
    }
    if (!guideAskStartedRef.current) {
      guideAskStartedRef.current = true;
      startTour(
        [
          {
            id: 'wow-ask',
            selector: `[data-tour="ask-peer-${target}"]`,
            placement: 'side',
            hideNext: true,
            content: stepBody('Now ask the peer.', 'Click Ask peer on your card. It reads the whole thing and pushes back like a real reader.'),
          },
        ],
        { lockScroll: false, onSkip: onComplete },
      );
    }
  }, [phase, peerOpenCardId, startTour, endTour, onComplete]);

  // Keep the guide-fullcard banner anchored just below the target card so the
  // prompt sits near what it's pointing at. Light poll + scroll/resize; falls
  // back to bottom-center if the card isn't on screen.
  useEffect(() => {
    if (phase !== 'guide-fullcard') {
      setCardBannerPos(null);
      return;
    }
    const target = targetCardRef.current;
    if (!target) return;
    const BANNER_W = 470;
    const update = () => {
      const el = document.querySelector(`[data-tour="card-${target}"]`) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = Math.max(16, Math.min(r.left, window.innerWidth - BANNER_W - 16));
      const top = Math.min(r.bottom + 18, window.innerHeight - 170);
      setCardBannerPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
    };
    update();
    const t = window.setInterval(update, 250);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [phase]);

  // Answer beat: react to SUBMISSION (immediate), not extraction completion.
  // The Ask-peer cycle is the last guided beat before the toolbar tour.
  useEffect(() => {
    if (phase !== 'answer') return;
    if (submitBaselineRef.current === null) {
      submitBaselineRef.current = submissionCount;
      return;
    }
    if (submissionCount > submitBaselineRef.current) {
      wowEvent('question_answered');
      setPhase('toolbar-tour');
    }
  }, [phase, submissionCount]);

  // Guide-fullcard: a banner coaches the writer to open the full card (the
  // "open full sheet" link on their card). Advances when a sheet actually opens.
  useEffect(() => {
    if (phase !== 'guide-fullcard') return;
    if (sheetOpenId) {
      bentoTargetRef.current = sheetOpenId;
      // Let the writer take in the whole card first; they click to start the
      // section-by-section walkthrough.
      setPhase('bento-intro');
    }
  }, [phase, sheetOpenId]);

  // Bento-tour: fly through the opened card's sections — what each covers, what
  // it tracks, and that it's a LIVING link the writer grows incrementally. Steps
  // adapt to the opened card's type (the sheet is already open).
  useEffect(() => {
    if (phase !== 'bento-tour' || bentoTourStartedRef.current) return;
    bentoTourStartedRef.current = true;
    const card = (data?.entities ?? []).find((e) => e.id === bentoTargetRef.current);
    wowEvent('bento_tour_shown', { type: card?.type });
    const bento = (id: string, headline: string, body: string): TourStep => ({
      id: `wow-bento-${id}`,
      selector: `[data-tour="bento-${id}"]`,
      placement: 'side', // beside the tile, not over it
      content: stepBody(headline, body),
    });
    const living = (id: string): TourStep => ({
      ...bento(
        id,
        'A living link to your work.',
        'The peer keeps its open questions here. Every answer you give updates this card and ripples through your outline, a living link to your development, not a static form. It grows as you do.',
      ),
      nextLabel: 'Now try the peer →',
      onExit: () => { onOpenSheet(null); setPhase('guide-ask'); },
    });
    const steps: TourStep[] =
      card?.type === 'event'
        ? [
            bento('summary', 'The full card.', 'This is a scene in full. The summary is what happens; everything around it is what the engine tracks about it.'),
            bento('throughline', 'Where it sits.', 'Its place in your story order: what leads in, what follows, kept in sync as you build.'),
            bento('knowledge', 'Who knows what, here.', 'The dramatic-irony layer, per scene: what the audience knows and what each character does not.'),
            bento('established', 'What it establishes.', 'The facts this scene puts on the table, pulled from your prose, editable anytime.'),
            bento('causality', 'What it sets in motion.', 'Causal links the engine inferred, layered on top of story order.'),
            living('working'),
          ]
        : card?.type === 'sequence'
        ? [
            bento('summary', 'The full sequence.', 'This is one section of your plot in full. The summary up top is the broad movement; everything around it is what the engine tracks about it.'),
            bento('scenes', 'The scenes inside.', 'As you develop it, the individual scenes nest here and the sequence becomes a container on the board.'),
            bento('throughline', 'Where it sits.', 'Its place in the story order, relative to the other sequences.'),
            bento('arcs', 'Threads running through.', 'The arcs that thread across this stretch of the story.'),
            living('questions'),
          ]
        : [
            bento('identity', 'The full card.', 'This is your character in full. The summary up top; everything around it is what the engine tracks about them.'),
            bento('knowledge', 'What they know.', 'Per scene: what they know, suspect, or are in the dark about. The dramatic-irony layer.'),
            bento('arcs', 'Their arcs.', 'The threads they move through across the story.'),
            bento('relationships', 'Their bonds.', 'Who they are to everyone else, tracked as the story develops.'),
            bento('appears-in', 'Where they show up.', 'Every scene they touch, in story order.'),
            living('working'),
          ];
    startTour(steps, { lockScroll: false, onSkip: onComplete });
  }, [phase, data, onOpenSheet, startTour, onComplete]);

  // Toolbar-tour: the remaining levers — build by hand, switch views, import.
  useEffect(() => {
    if (phase !== 'toolbar-tour' || toolbarTourStartedRef.current) return;
    toolbarTourStartedRef.current = true;
    wowEvent('toolbar_tour_shown');
    startTour(
      [
        {
          id: 'wow-tb-new',
          selector: '[data-tour="toolbar-new"]',
          content: stepBody('Build by hand, too.', 'Add a scene, character, or arc yourself anytime. The engine wires each new card into your outline.'),
        },
        {
          id: 'wow-tb-views',
          selector: '[data-tour="toolbar-views"]',
          content: stepBody('See it your way.', 'Switch views: the free-form board, the character web, or your outline in story order.'),
        },
        {
          id: 'wow-tb-import',
          selector: '[data-tour="toolbar-import"]',
          nextLabel: "You're set →",
          content: stepBody('Already have pages?', 'Import a screenplay PDF (or drop one on the board) and it extracts into cards, same engine.'),
          onExit: () => { wowEvent('completed', { full: true }); setPhase('done'); onComplete(); },
        },
      ],
      { lockScroll: false, onSkip: onComplete },
    );
  }, [phase, startTour, onComplete]);

  if (!active || phase === 'done') return null;

  return (
    <>
      <style>{`@keyframes cb-spin { to { transform: rotate(360deg); } }`}</style>
      {/* The staged braindump meter now lives in the corkboard (BraindumpMeter),
          shown for ALL braindumps and draggable — so the wow no longer renders
          its own reveal tracker here. */}

      {/* ---------- Guide-fullcard ---------- */}
      <AnimatePresence>
        {phase === 'guide-fullcard' && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} style={bannerAt(ORANGE, cardBannerPos)}>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: '#ff8c42' }}>
              Nice. Now open the <strong>full card</strong>. Hit <strong>"open full sheet ↗"</strong> on your card to see everything the engine tracks about it.
            </div>
            <div style={{ marginTop: 12 }}>
              <ExploreOnOwn onClick={() => { wowEvent('completed', { skippedFullcard: true }); setPhase('done'); onComplete(); }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Bento intro (see the whole card, then walk it) ---------- */}
      <AnimatePresence>
        {phase === 'bento-intro' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            // Centered over the (still full-screen) card — not bottom-anchored.
            style={{ ...bannerBottom(ORANGE), bottom: 'auto', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }}
          >
            <div style={{ fontSize: 14, lineHeight: 1.55, color: '#ff8c42' }}>
              This is the full card, everything the engine tracks about it. Take a look around, then I'll walk you through what each part does.
            </div>
            <button
              onClick={() => { wowEvent('bento_intro_continue'); setPhase('bento-tour'); }}
              style={{
                marginTop: 14, padding: '9px 22px', borderRadius: 11, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, color: '#1a1208',
                background: `linear-gradient(135deg, ${ORANGE} 0%, #ff8c42 100%)`, fontFamily: 'inherit',
              }}
            >
              Walk me through it →
            </button>
            <div style={{ marginTop: 10 }}>
              <ExploreOnOwn onClick={() => { wowEvent('completed', { skippedBento: true }); setPhase('done'); onComplete(); }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Answer (expectation-setting, not a required task) ---------- */}
      <AnimatePresence>
        {phase === 'answer' && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} style={bannerBottom(ORANGE)}>
            <div style={{ fontSize: 14, lineHeight: 1.55, color: '#ff8c42' }}>
              This is the peer. It read your card and everything around it, then pushed back with the sharpest questions in your story. Answer one whenever you like and your outline grows from your take.
            </div>
            <button
              onClick={() => { wowEvent('peer_seen'); setPhase('toolbar-tour'); }}
              style={{
                marginTop: 14, padding: '9px 22px', borderRadius: 11, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, color: '#1a1208',
                background: `linear-gradient(135deg, ${ORANGE} 0%, #ff8c42 100%)`, fontFamily: 'inherit',
              }}
            >
              Got it →
            </button>
            <div style={{ marginTop: 10 }}>
              <ExploreOnOwn onClick={() => { wowEvent('completed', { answered: false }); setPhase('done'); onComplete(); }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// Matches the Tour engine's tooltip look (translucent orange + blur + orange
// border/glow + orange text) so the wow's own coachmark banners read as the
// SAME card as the rest of the tour, not a separate dark card.
const bannerBottom = (accent: string): React.CSSProperties => ({
  position: 'fixed',
  bottom: 28,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 9995,
  maxWidth: 'min(470px, 92vw)',
  padding: '16px 20px',
  borderRadius: 14,
  background: 'rgba(255,108,53,0.15)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: `1px solid ${accent}`,
  boxShadow: `0 0 16px ${accent}66, 0 12px 40px rgba(0,0,0,0.5)`,
  color: '#ff8c42',
  fontFamily: 'system-ui, sans-serif',
  textAlign: 'center',
});

// Banner anchored just below the target card when a position is known; falls
// back to the centered bottom banner otherwise.
const bannerAt = (accent: string, pos: { top: number; left: number } | null): React.CSSProperties =>
  pos
    ? { ...bannerBottom(accent), bottom: 'auto', top: pos.top, left: pos.left, transform: 'none', textAlign: 'left' }
    : bannerBottom(accent);

