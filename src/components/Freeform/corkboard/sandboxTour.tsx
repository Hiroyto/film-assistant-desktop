// components/Freeform/corkboard/sandboxTour.tsx
//
// THE SANDBOX'S FIRST-RUN GUIDE (Ben, 2026-11-08). Once per browser, on an
// empty board with the templates out, it walks a new writer through The
// Matrix: open the film, open its first scene, look at what hangs on it, see
// the cast, close it, the act tabs, a subplot, the Scenes view, home. It ends
// on clearing the film so they begin right there (Ben, 2026-11-08: no new
// story); never a braindump of the film (Ben: "don't invite someone to make
// the matrix their own").
//
// Its own small guide, not the app's tour engine (Ben, same day: "clunky,
// laggy and not responsive to the content underneath it"; and unreadable on
// the light board):
//  - in the board's own light or dark look;
//  - no blur and no per-frame work: it measures when a step starts, while the
//    board settles, and on scroll or resize;
//  - most steps ask for one click, with a reason from the film, and move on
//    when that happens; a step can put the board in the state it talks about
//    first (close the open card, show the subplots);
//  - its card sits clear of the target and of what opened around it.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const SANDBOX_TOUR_KEY = 'ff-sandbox-tour-seen';
/** The template the guide opens with. */
export const TOUR_TEMPLATE_ID = 'world';

export function sandboxTourSeen(): boolean {
  try { return localStorage.getItem(SANDBOX_TOUR_KEY) === '1'; } catch { return true; }
}
export function markSandboxTourSeen(): void {
  try { localStorage.setItem(SANDBOX_TOUR_KEY, '1'); } catch { /* this session only */ }
}

export type CoachStep = {
  id: string;
  title: string;
  body: string;
  /** What it points at; none for a centred card. */
  target?: () => Element | null;
  /** Put the board in the state this step talks about. */
  prepare?: () => void;
  /** The step is done when this holds (checked as the board changes). */
  doneWhen?: () => boolean;
  /** What the card must not cover, besides the target. */
  avoid?: () => Element[];
  /** Lit with the target, in a lighter ring (a subplot's scenes). */
  also?: () => Element[];
  /** A short cue under the words when the step waits on a click. */
  cue?: string;
  /** The last step's choices. */
  actions?: Array<{ label: string; primary?: boolean; run: () => void }>;
};

type Box = { left: number; top: number; width: number; height: number };
const boxOf = (el: Element): Box => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
const hits = (a: Box, b: Box, pad = 8) => a.left < b.left + b.width + pad && b.left < a.left + a.width + pad && a.top < b.top + b.height + pad && b.top < a.top + a.height + pad;

/** Whether all of `el` shows: inside the window and inside every box that
 *  scrolls around it (Ben, 2026-11-08: Act I's tab was ringed half under the
 *  board's top edge). */
function wholeInView(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return true;
  const pad = 10;
  let top = 0, left = 0, bottom = window.innerHeight, right = window.innerWidth;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const st = window.getComputedStyle(p);
    if (!/(auto|scroll|hidden)/.test(st.overflow + st.overflowX + st.overflowY)) continue;
    const c = p.getBoundingClientRect();
    top = Math.max(top, c.top); left = Math.max(left, c.left); bottom = Math.min(bottom, c.bottom); right = Math.min(right, c.right);
  }
  return r.top >= top + pad && r.bottom <= bottom - pad && r.left >= left + pad && r.right <= right - pad;
}

const CARD_W = 320;
const ACCENT = '#ff6b35';

/** Where the card goes: right beside what the step is about (Ben,
 *  2026-11-08: a card far from its scene read as a misplaced tag), on the side
 *  that covers least. What it points at and what opened around it (`avoid`)
 *  must stay clear; the toolbar and strip (`keep`) count most, then the
 *  board's cards. Only when no side is clear of `avoid` does it look further. */
export function placeCard(target: Box | null, card: { w: number; h: number }, avoid: Box[], view: { w: number; h: number }, keep: Box[] = [], cards: Box[] = []): { left: number; top: number } {
  const M = 16, G = 18;
  if (!target) return { left: Math.round((view.w - card.w) / 2), top: Math.round((view.h - card.h) / 2) };
  const midY = target.top + target.height / 2 - card.h / 2;
  const midX = target.left + target.width / 2 - card.w / 2;
  const right = target.left + target.width + G, left = target.left - card.w - G;
  const below = target.top + target.height + G, above = target.top - card.h - G;
  // Each side, centred and slid along it.
  const ys = [midY, target.top, target.top + target.height - card.h, midY - 90, midY + 90];
  const xs = [midX, target.left, target.left + target.width - card.w];
  const beside: Array<{ left: number; top: number }> = [
    ...ys.map((top) => ({ left: right, top })),
    ...xs.map((l) => ({ left: l, top: below })),
    ...ys.map((top) => ({ left, top })),
    ...xs.map((l) => ({ left: l, top: above })),
  ];
  const inView = (p: { left: number; top: number }) => p.left >= M && p.top >= M && p.left + card.w <= view.w - M && p.top + card.h <= view.h - M;
  const area = (a: Box, b: Box) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const cx = target.left + target.width / 2, cy = target.top + target.height / 2;
  const clear = (p: { left: number; top: number }) => { const b = { left: p.left, top: p.top, width: card.w, height: card.h }; return ![target, ...avoid].some((x) => hits(b, x)); };
  const score = (p: { left: number; top: number }) => {
    const b = { left: p.left, top: p.top, width: card.w, height: card.h };
    return keep.reduce((n, x) => n + area(b, x), 0) * 4 + cards.reduce((n, x) => n + area(b, x), 0) * 0.5 + Math.hypot(p.left + card.w / 2 - cx, p.top + card.h / 2 - cy) * 3;
  };
  const best = (list: Array<{ left: number; top: number }>) => list.reduce((a, p) => (score(p) < score(a) ? p : a));
  const near = beside.filter((p) => inView(p) && clear(p));
  if (near.length) return best(near);
  // Every side is taken by what must stay clear: the nearest clear spot anywhere.
  const grid: Array<{ left: number; top: number }> = [];
  for (let y = M; y <= view.h - card.h - M; y += 40) for (let x = M; x <= view.w - card.w - M; x += 60) grid.push({ left: x, top: y });
  const far = grid.filter(clear);
  return far.length ? best(far) : { left: view.w - card.w - M, top: view.h - card.h - M };
}

export function SandboxCoach({ steps, dark, onSkip, onStep }: { steps: CoachStep[]; dark: boolean; onSkip: () => void;
  /** Told each step as it starts (the page marks the guide seen once the film lands). */
  onStep?: (id: string) => void }) {
  const [i, setI] = useState(0);
  const step = steps[Math.min(i, steps.length - 1)];
  const [ring, setRing] = useState<Box | null>(null);
  const [lit, setLit] = useState<Box[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const moved = useRef(false);

  const measure = useCallback(() => {
    const el = step.target?.() ?? null;
    const t = el ? boxOf(el) : null;
    setRing(t);
    const shown = (b: Box) => b.width > 0 && b.top < window.innerHeight && b.top + b.height > 0 && b.left < window.innerWidth && b.left + b.width > 0;
    const also = (step.also?.() ?? []).map(boxOf).filter(shown);
    setLit(also);
    const c = cardRef.current;
    const size = { w: c?.offsetWidth || CARD_W, h: c?.offsetHeight || 160 };
    const all = (sel: string) => [...document.querySelectorAll(sel)].map(boxOf).filter(shown);
    const avoid = (step.avoid?.() ?? []).map(boxOf).filter((b) => b.width > 0);
    // The card stays off the lit scenes too, as hard as off the toolbar.
    const keep = [...all('[data-tour], [data-set-switcher], [data-subplot-chip], [data-strip-card], [data-template]'), ...also];
    const cards = all('[data-stage-item]').filter((b) => !t || b.left !== t.left || b.top !== t.top);
    setPos(placeCard(t, size, avoid, { w: window.innerWidth, h: window.innerHeight }, keep, cards));
  }, [step]);

  // A step starts: set the board up, bring the target into view, and measure
  // as the board settles (cards ease into place over most of a second).
  useEffect(() => {
    moved.current = false;
    setPos(null);
    onStep?.(step.id);
    step.prepare?.();
    const timers = [0, 120, 400, 800, 1300].map((ms) => window.setTimeout(() => {
      const el = step.target?.();
      if (el && !moved.current && !wholeInView(el)) { moved.current = true; try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* jsdom */ } }
      measure();
    }, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);
  useLayoutEffect(() => { if (pos) measure(); /* the card's own height may change with the step */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);
  useEffect(() => {
    let t = 0;
    const later = () => { window.clearTimeout(t); t = window.setTimeout(measure, 60); };
    window.addEventListener('resize', later);
    window.addEventListener('scroll', later, true);
    return () => { window.clearTimeout(t); window.removeEventListener('resize', later); window.removeEventListener('scroll', later, true); };
  }, [measure]);
  // A step that waits on the writer moves on when its condition holds: checked
  // after any click and on a slow beat (a template landing takes a moment).
  useEffect(() => {
    if (!step.doneWhen) return undefined;
    let done = false;
    const check = () => { if (done || !step.doneWhen?.()) return; done = true; window.setTimeout(() => setI((n) => Math.min(steps.length - 1, n + 1)), 350); };
    const onClick = () => window.setTimeout(check, 250);
    document.addEventListener('click', onClick, true);
    const iv = window.setInterval(check, 500);
    return () => { document.removeEventListener('click', onClick, true); window.clearInterval(iv); };
  }, [step, steps.length]);

  const ink = dark ? '#ececf0' : '#1d2230';
  const soft = dark ? '#a8a8b2' : '#4f5463';
  const muted = dark ? '#7a7a84' : '#8a8f9c';
  const btn: React.CSSProperties = { font: 'inherit', fontSize: 12.5, fontWeight: 650, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${dark ? '#3a3a42' : '#ddd8cc'}`, background: 'transparent', color: ink };
  const primary: React.CSSProperties = { ...btn, border: `1px solid ${ACCENT}`, background: ACCENT, color: '#fff' };
  const last = i >= steps.length - 1;
  return createPortal(
    <>
      {/* THE SPOTLIGHT (Ben: "still not standing out enough"): the rest of
          the screen dims around a cutout, one shadow and no blur, and clicks
          still go through. */}
      {ring && lit.length ? (
        // Several things lit at once (a subplot and its scenes): one dim with
        // a hole for each, the target in the full ring, the rest lighter.
        <>
          <svg aria-hidden data-coach-dim width="100%" height="100%" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9000 }}>
            <defs>
              <mask id="ff-coach-holes">
                <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
                {[ring, ...lit].map((b, k) => <rect key={k} x={b.left - 8} y={b.top - 8} width={b.width + 16} height={b.height + 16} rx={12} fill="#000" />)}
              </mask>
            </defs>
            <rect x="0" y="0" width="100%" height="100%" fill={dark ? 'rgba(0,0,0,.55)' : 'rgba(30,24,14,.38)'} mask="url(#ff-coach-holes)" />
          </svg>
          <div data-coach-ring aria-hidden style={{ position: 'fixed', left: ring.left - 8, top: ring.top - 8, width: ring.width + 16, height: ring.height + 16, borderRadius: 12, border: `2.5px solid ${ACCENT}`, pointerEvents: 'none', zIndex: 9000, boxShadow: '0 0 0 4px rgba(255,107,53,.22)' }} />
          {lit.map((b, k) => <div key={k} data-coach-also aria-hidden style={{ position: 'fixed', left: b.left - 8, top: b.top - 8, width: b.width + 16, height: b.height + 16, borderRadius: 12, border: `2px dashed ${ACCENT}`, pointerEvents: 'none', zIndex: 9000 }} />)}
        </>
      ) : ring ? (
        <div data-coach-ring aria-hidden style={{ position: 'fixed', left: ring.left - 8, top: ring.top - 8, width: ring.width + 16, height: ring.height + 16, borderRadius: 12, border: `2.5px solid ${ACCENT}`, pointerEvents: 'none', zIndex: 9000,
          boxShadow: `0 0 0 4px rgba(255,107,53,.22), 0 0 0 9999px ${dark ? 'rgba(0,0,0,.55)' : 'rgba(30,24,14,.38)'}`, transition: 'left 200ms ease, top 200ms ease, width 200ms ease, height 200ms ease' }} />
      ) : (
        <div data-coach-dim aria-hidden style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9000, background: dark ? 'rgba(0,0,0,.55)' : 'rgba(30,24,14,.38)' }} />
      )}
      <div
        ref={cardRef} data-coach-card={step.id} role="dialog" aria-label={step.title}
        style={{
          position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: CARD_W, boxSizing: 'border-box', zIndex: 9001,
          padding: '14px 16px 12px', borderRadius: 12, fontFamily: 'system-ui, sans-serif',
          background: dark ? '#1e1e22' : '#fff', border: `1px solid ${dark ? '#2e2e35' : '#e6e0d2'}`,
          boxShadow: dark ? '0 14px 40px rgba(0,0,0,.5)' : '0 14px 40px rgba(60,40,10,.16)',
          transition: 'left 220ms ease, top 220ms ease',
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.7px', textTransform: 'uppercase', color: ACCENT }}>{last ? 'Your turn' : `${i + 1} of ${steps.length - 1}`}</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: ink, marginTop: 4, lineHeight: 1.3 }}>{step.title}</div>
        <div style={{ fontSize: 13, color: soft, marginTop: 5, lineHeight: 1.5 }}>{step.body}</div>
        {step.cue && <div data-coach-cue style={{ fontSize: 12, fontWeight: 650, color: ACCENT, marginTop: 8 }}>{step.cue}</div>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {step.actions
            ? step.actions.map((a) => <button key={a.label} type="button" data-coach-action={a.label} onClick={a.run} style={a.primary ? primary : btn}>{a.label}</button>)
            : (
              <>
                {i > 0 && !steps[i - 1].doneWhen && <button type="button" data-coach-back onClick={() => setI((n) => Math.max(0, n - 1))} style={btn}>Back</button>}
                {step.id !== 'template' && <button type="button" data-coach-next onClick={() => setI((n) => Math.min(steps.length - 1, n + 1))} style={step.doneWhen ? btn : primary}>{step.doneWhen ? 'Skip this step' : 'Next'}</button>}
              </>
            )}
          <button type="button" data-coach-skip onClick={onSkip} style={{ ...btn, border: 'none', padding: '6px 4px', marginLeft: 'auto', color: muted, fontWeight: 500 }}>{last ? 'Close' : 'End the tour'}</button>
        </div>
      </div>
    </>,
    document.body,
  );
}

/** The Matrix walk. `api` is what the steps need from the page. Every step
 *  moves on with Next and the guide does the clicking (Ben, 2026-11-08: "it
 *  should be an easy next button on the modal, not forcing me to click in");
 *  only opening the film is the writer's, from a button in the card. */
export function sandboxTourSteps(api: {
  hasTemplate: () => boolean;
  useTemplate: () => void;
  openCard: (id: string) => void;
  closeCard: () => void;
  openSubplot: (name: string) => void;
  showScenes: (on: boolean) => void;
  clearTemplate: () => void;
  finish: () => void;
}): CoachStep[] {
  const q = (s: string) => document.querySelector(s);
  const firstScene = () => [...document.querySelectorAll('[data-stage-item^="evt_tpl_"]')].find((el) => el.querySelector('[data-order-no]')?.textContent?.trim() === '1') ?? q('[data-stage-item^="evt_tpl_"]');
  const around = () => [...document.querySelectorAll('[data-focus-card], [data-focus-chips], [data-focus-satellite], [data-focus-ghost]')];
  const openFirst = () => { const id = firstScene()?.getAttribute('data-stage-item'); if (id) api.openCard(id); };
  return [
    {
      id: 'template', target: () => q(`[data-template="${TOUR_TEMPLATE_ID}"]`),
      title: 'Start with a film you know',
      body: 'The Matrix is built on its rules: what the world is shapes every scene. Open it and we will walk the board together.',
      actions: [{ label: 'Open The Matrix', primary: true, run: api.useTemplate }],
      doneWhen: () => api.hasTemplate() && !!firstScene(),
    },
    {
      id: 'scene', target: firstScene, prepare: () => { api.showScenes(false); api.closeCard(); },
      title: 'A story here is scenes on a line',
      body: 'The film opens on Trinity escaping the police. Every scene is a card, and the line joins them in story order.',
    },
    {
      id: 'sticky', prepare: openFirst, target: () => q('[data-focus-satellite]'), avoid: around,
      title: 'Open a scene and its notes gather round',
      body: 'This is a sticky: a feeling about the scene, kept right beside it. Notes that are not scenes yet land as stickies.',
    },
    {
      id: 'cast', target: () => q('[data-focus-slide="cast"]'), avoid: around,
      // Who it names: the cast cards that move in round the scene, and doors to any elsewhere.
      also: () => [...document.querySelectorAll('[data-focus-member], [data-focus-satellite]')],
      prepare: () => { if (!q('[data-focus-card]')) openFirst(); window.setTimeout(() => (q('[data-focus-slide="cast"]') as HTMLElement | null)?.click(), 150); },
      title: 'Who is in it',
      body: 'Cast shows who is in the scene: Trinity, with Agent Smith close behind her.',
    },
    {
      id: 'beat', target: () => q('[data-stage-item^="seq_tpl_"]'), prepare: api.closeCard,
      title: 'Act I is a beat',
      body: 'Beats are tabs on the line. Every scene after one belongs to it, up to the next: Act I runs until Neo wakes up in the real world.',
    },
    {
      id: 'subplot', prepare: () => api.openSubplot('Neo and Trinity'), target: () => q('[data-strip-card]'),
      // Its scenes: lit on the board (ff-lit) or in the Scenes view (data-strip-lit).
      also: () => [...document.querySelectorAll('[data-stage-item^="evt_"].ff-lit, [data-strip-lit]')],
      title: 'Subplots run through the scenes',
      body: 'Neo and Trinity is a thread across the film. Open one and the scenes where it moves light up on the board.',
    },
    {
      id: 'scenes', prepare: () => api.showScenes(true), target: () => q('[data-scenes-toggle]') ?? q('[data-tour="sbx-scenes"]'),
      title: 'The whole film, in order',
      body: 'Scenes lines everything up in story order: as a grid, in columns by act, or on a timeline. Home brings the board back.',
    },
    {
      id: 'yours', prepare: () => api.showScenes(false),
      title: 'Now start your own',
      body: 'That is the board. Clear The Matrix and begin your own story right here.',
      actions: [{ label: 'Clear The Matrix', primary: true, run: () => { api.finish(); api.clearTemplate(); } }],
    },
  ];
}
