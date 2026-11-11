// components/Freeform/corkboard/sandboxTemplates.tsx
//
// TEMPLATES TO GET YOU STARTED (Ben + Otavio, 2026-10-14). An empty sandbox
// is a lot to face; beside the dump prompt this panel offers a ready board
// per way of building a story (character-driven, plot-driven, world-driven),
// each from a film the writer already knows, so they see how their approach
// looks as a board and then work off it. The material lands flagged as a
// template (lib/templates.mjs on the backend): editing a card makes it the
// writer's, Clear template removes the rest.

import React, { useState } from 'react';
import type { SandboxTemplate } from '../../../lib/freeformApi';
import { getEntityColor } from '../entityColors';
import { itemSize, type Pos, type StageItem } from './sandboxBoard';
import { GlobeIcon } from './sandboxFocus';
import { webLayout } from './sandboxRing';

const SERIF = "'Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";
const WORLD_GREEN = '#5f9a6a';
const STICKY = '#e2c46b';

/** The shape at a glance: one strip of little blocks, a colour per kind
 *  (scenes, characters, world, stickies), so mostly-scenes, mostly-people
 *  and mostly-world read differently before a word is read. */
function Shape({ counts, dark }: { counts: SandboxTemplate['counts']; dark: boolean }) {
  const kinds: Array<{ n: number; c: string; label: string }> = [
    { n: counts.scenes, c: getEntityColor('event' as any) || '#7c3aed', label: counts.scenes === 1 ? 'scene' : 'scenes' },
    { n: counts.characters, c: getEntityColor('character' as any) || '#e67e22', label: counts.characters === 1 ? 'character' : 'characters' },
    { n: counts.world, c: WORLD_GREEN, label: 'world' },
    { n: counts.stickies, c: STICKY, label: counts.stickies === 1 ? 'sticky' : 'stickies' },
  ];
  return (
    <div style={{ margin: '8px 0 0' }}>
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }} aria-hidden>
        {kinds.flatMap((k) => Array.from({ length: k.n }).map((_, i) => (
          <i key={`${k.label}${i}`} style={{ width: 7, height: 7, borderRadius: 2, background: k.c, opacity: dark ? 0.85 : 0.9, display: 'inline-block' }} />
        )))}
      </div>
      <div style={{ fontSize: 11, color: dark ? '#9a9aa4' : '#7a7f8c', marginTop: 5 }}>
        {kinds.filter((k) => k.n > 0).map((k) => `${k.n} ${k.label}`).join(' · ')}
      </div>
    </div>
  );
}

/** The panel's width: it sits flush on the window's left edge. */
export const TEMPLATES_W = 360;

export function TemplatesPanel({ templates, dark, busyId, onUse, onClose, top, onPreview, only }: {
  templates: SandboxTemplate[];
  /** The one template on offer (the first-run guide's, 2026-11-08): the
   *  others blur back and take no clicks. */
  only?: string;
  dark: boolean;
  /** Where the toolbar ends, in the window: the panel hangs from there to the
   *  window's bottom, flush on its left edge (Ben, 2026-10-15: a panel, not a
   *  box floating on the board). */
  top: number;
  /** The template the pointer is over, for the preview beside the panel. */
  onPreview?: (id: string | null) => void;
  /** The template being applied, while it lands. */
  busyId: string | null;
  onUse: (id: string) => void;
  onClose: () => void;
}) {
  const [hover, setHoverRaw] = useState<string | null>(null);
  const setHover = (id: string | null) => { setHoverRaw(id); onPreview?.(id); };
  const ink = dark ? '#e8e8ec' : '#1d2230';
  const muted = dark ? '#9a9aa4' : '#6b7080';
  const line = dark ? '#2a2a30' : '#ece5d7';
  if (!templates.length) return null;
  return (
    <div
      data-templates-panel
      role="complementary"
      aria-label="Templates to get you started"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseLeave={() => setHover(null)}
      style={{
        position: 'fixed', left: 0, top, bottom: 0, width: TEMPLATES_W, zIndex: 120, boxSizing: 'border-box',
        overflowY: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none',
        background: dark ? '#17171b' : '#fff', borderRight: `1px solid ${line}`, borderTop: `1px solid ${line}`,
        boxShadow: dark ? '8px 0 28px rgba(0,0,0,.35)' : '8px 0 24px rgba(120,90,40,.08)',
        padding: '16px 16px 14px', fontFamily: 'system-ui, sans-serif', color: ink,
        animation: 'ffTplIn 260ms cubic-bezier(.2,.7,.2,1) both',
      }}
    >
      <style>{`[data-templates-panel]::-webkit-scrollbar{display:none}@keyframes ffTplIn{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}@keyframes ffTplPv{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}`}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ff8c42" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>Templates to get you started</span>
        <button type="button" onClick={onClose} aria-label="Close templates" title="Start from scratch" style={{ marginLeft: 'auto', font: 'inherit', fontSize: 16, lineHeight: 1, background: 'transparent', border: 'none', color: muted, cursor: 'pointer', padding: 2 }}>×</button>
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.45, color: muted, margin: '6px 0 10px' }}>
        See a film you know laid out as a board, to get a feel for how the board works. Clear template takes it away.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {templates.map((t) => {
          const on = hover === t.id;
          const busy = busyId === t.id;
          return (
            <div
              key={t.id} data-template={t.id} aria-hidden={only && t.id !== only ? true : undefined} {...(only && t.id !== only ? { 'data-template-off': '' } : {})}
              onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover(null)}
              style={{
                ...(only && t.id !== only ? { filter: 'blur(3px)', opacity: 0.35, pointerEvents: 'none' as const, userSelect: 'none' as const } : {}),
                border: `1px solid ${on ? (dark ? '#4a4a54' : '#d9cfbd') : line}`, borderRadius: 10, padding: '9px 11px 10px',
                background: on ? (dark ? '#1d1d22' : '#fffdf8') : 'transparent', transition: 'border-color 140ms, background 140ms, transform 140ms',
                transform: on ? 'translateY(-1px)' : 'none',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: '#ff6b35' }}>{t.label}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 3 }}>
                <span style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 700 }}>{t.film}</span>
                <span style={{ fontSize: 11.5, color: muted }}>{t.year}</span>
              </div>
              <div style={{ fontSize: 11.5, lineHeight: 1.4, color: dark ? '#c9c9d1' : '#444a57', marginTop: 3 }}>{t.blurb}</div>
              <Shape counts={t.counts} dark={dark} />
              <button
                type="button" data-use-template={t.id} disabled={!!busyId} onClick={() => onUse(t.id)}
                style={{
                  marginTop: 8, font: 'inherit', fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8, cursor: busyId ? 'default' : 'pointer',
                  border: '1px solid transparent', background: '#ff8c42', color: '#fff', opacity: busyId && !busy ? 0.5 : 1,
                  boxShadow: on ? '0 4px 14px rgba(255,140,66,.35)' : 'none', transition: 'box-shadow 140ms, opacity 140ms',
                }}
              >
                {busy ? 'Laying it out…' : `Use ${t.film}`}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const words = (p: string) => p.replace(/_/g, ' ').trim().toLowerCase();
const CHAR_INK = '#d4a24c';

/** THE HOVER PREVIEW (Ben, 2026-10-15): the film's shape beside the panel,
 *  the layer that makes it that kind of story bright and the rest faint.
 *  Character-driven lights the web of ties; plot-driven, the thread of
 *  scenes in their acts; world-driven, the world notes with the globe. */
export function TemplatePreview({ template, dark, left, top }: { template: SandboxTemplate; dark: boolean; left: number; top: number }) {
  const pv = template.preview;
  const [view, setView] = useState(() => ({ w: typeof window !== 'undefined' ? window.innerWidth : 1400, h: typeof window !== 'undefined' ? window.innerHeight : 800 }));
  React.useEffect(() => {
    const on = () => setView({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  if (!pv) return null;
  const W = Math.max(420, view.w - left - 28), H = Math.max(320, view.h - top - 28);
  // Inside the paper's padding.
  const IW = W - 40;
  const ink = dark ? '#e8e8ec' : '#1d2230';
  const muted = dark ? '#9a9aa4' : '#6b7080';
  const paper = dark ? '#1b1b20' : '#fffdf8';
  const kind = template.id;
  const faint = 0.28;
  const nameOf = new Map(pv.characters.map((c) => [c.key, c.name]));
  // The faint rows: scenes as a strip of act-coloured tabs, people as name
  // chips, the world as globe chips.
  const sceneRow = (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {pv.scenes.map((sc, i) => (
        <span key={sc.key} style={{ fontSize: 10.5, padding: '3px 7px', borderRadius: 4, border: `1.5px solid ${sc.color || '#3b82f6'}`, background: paper, color: ink, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i + 1}. {sc.title}</span>
      ))}
    </div>
  );
  const castRow = (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {pv.characters.map((c) => <span key={c.key} style={{ fontSize: 10.5, padding: '3px 8px', borderRadius: 4, border: `1.5px solid ${CHAR_INK}`, background: paper, color: ink }}>{c.name}</span>)}
    </div>
  );
  const worldRow = pv.world.length ? (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      {pv.world.map((w) => <span key={w.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, padding: '3px 8px', borderRadius: 3, background: dark ? '#2b3327' : '#e3e7da', color: dark ? '#9fcf8e' : '#4f7a42', textTransform: 'uppercase', letterSpacing: '.4px', fontWeight: 700 }}><GlobeIcon size={10} />{w.kind}</span>)}
    </div>
  ) : null;

  let main: React.ReactNode = null;
  const mainH = H - 150;
  if (kind === 'character') {
    // The web: the most tied in the middle, every tie a labelled line.
    const CW = 136, CH = 46;
    const weight = new Map(pv.characters.map((c) => [c.key, 0]));
    for (const t of pv.ties) { weight.set(t.from, (weight.get(t.from) ?? 0) + 2); weight.set(t.to, (weight.get(t.to) ?? 0) + 2); }
    const pos = webLayout({ ids: pv.characters.map((c) => c.key), ties: pv.ties.map((t) => ({ a: t.from, b: t.to, lw: 16 + words(t.predicate).length * 6.4 })), weight, viewW: IW, viewH: mainH, w: CW, h: CH });
    const xs = [...pos.values()], minX = Math.min(...xs.map((p) => p.x)), maxX = Math.max(...xs.map((p) => p.x + CW)), minY = Math.min(...xs.map((p) => p.y)), maxY = Math.max(...xs.map((p) => p.y + CH));
    const k = Math.min(1, (IW - 20) / (maxX - minX), (mainH - 10) / (maxY - minY));
    const at = (key: string) => { const p = pos.get(key)!; return { x: (p.x - minX) * k + (IW - (maxX - minX) * k) / 2, y: (p.y - minY) * k }; };
    main = (
      <div style={{ position: 'relative', height: (maxY - minY) * k + 8 }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}>
          {pv.ties.map((t) => { const a = at(t.from), b = at(t.to); return <line key={t.from + t.to} x1={a.x + (CW * k) / 2} y1={a.y + (CH * k) / 2} x2={b.x + (CW * k) / 2} y2={b.y + (CH * k) / 2} stroke={dark ? '#8a8f9c' : '#a7a097'} strokeWidth={1.4} />; })}
        </svg>
        {pv.ties.map((t) => { const a = at(t.from), b = at(t.to); return <span key={'l' + t.from + t.to} style={{ position: 'absolute', left: (a.x + b.x + CW * k) / 2, top: (a.y + b.y + CH * k) / 2, transform: 'translate(-50%,-50%)', font: '600 10.5px system-ui, sans-serif', padding: '3px 7px', borderRadius: 999, border: `1px solid ${CHAR_INK}`, background: dark ? '#1a1a1e' : '#fff', color: dark ? '#e3b768' : '#b07a1c', whiteSpace: 'nowrap' }}>{words(t.predicate)}</span>; })}
        {pv.characters.map((c) => { const p = at(c.key); return <div key={c.key} style={{ position: 'absolute', left: p.x, top: p.y, width: CW * k, height: CH * k, boxSizing: 'border-box', padding: '0 10px', display: 'flex', flexDirection: 'column', justifyContent: 'center', borderRadius: 4, border: `1.5px solid ${CHAR_INK}`, background: paper, boxShadow: '0 4px 12px rgba(120,90,40,.12)' }}><span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '.5px', color: CHAR_INK }}>CHARACTER</span><span style={{ fontSize: 12.5, fontWeight: 650, color: ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nameOf.get(c.key)}</span></div>; })}
      </div>
    );
  } else if (kind === 'plot') {
    // The thread: scene after scene, back and forth, each in its act's colour.
    const SW = 168, SH = 58, GX = 34, GY = 40;
    const per = Math.max(2, Math.min(5, Math.floor((IW + GX) / (SW + GX))));
    const pts = pv.scenes.map((_, i) => { const row = Math.floor(i / per), j = i % per, col = row % 2 ? per - 1 - j : j; return { x: col * (SW + GX), y: row * (SH + GY) }; });
    const offX = (IW - (per * SW + (per - 1) * GX)) / 2;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${offX + p.x + SW / 2},${p.y + SH / 2}`).join(' ');
    const rowsN = Math.ceil(pv.scenes.length / per);
    main = (
      <div style={{ position: 'relative', height: rowsN * (SH + GY) - GY + 4 }}>
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible' }}><path d={d} fill="none" stroke={dark ? 'rgba(118,168,249,.6)' : 'rgba(59,130,246,.55)'} strokeWidth={2.2} strokeDasharray="7 5" /></svg>
        {pv.scenes.map((sc, i) => { const p = pts[i]; return <div key={sc.key} style={{ position: 'absolute', left: offX + p.x, top: p.y, width: SW, height: SH, boxSizing: 'border-box', padding: '6px 9px', borderRadius: 4, border: `1.5px solid ${sc.color || '#3b82f6'}`, background: paper, boxShadow: '0 4px 12px rgba(120,90,40,.12)' }}><span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 8.5, fontWeight: 700, letterSpacing: '.5px', color: sc.color || '#3b82f6' }}><b style={{ width: 14, height: 14, borderRadius: 7, background: sc.color || '#3b82f6', color: '#fff', fontSize: 8.5, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</b>ACT {['I', 'II', 'III'][sc.act - 1] ?? ''}</span><span style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 11.5, fontWeight: 650, lineHeight: 1.25, color: ink, marginTop: 2 }}>{sc.title}</span></div>; })}
      </div>
    );
  } else {
    // The world view itself (Ben, 2026-10-15: the Matrix's highlight): a
    // column per kind, each headed by the globe.
    const COLS: Array<[string, string]> = [['place', 'Setting'], ['rule', 'Rules'], ['history', 'History'], ['faction', 'Factions'], ['thing', 'Things']];
    const cols = COLS.map(([k, label]) => ({ label, list: pv.world.filter((w) => (k === 'thing' ? !['place', 'rule', 'history', 'faction'].includes(w.kind) : w.kind === k)) })).filter((c) => c.list.length);
    const ink2 = dark ? '#9fcf8e' : '#4f7a42';
    main = (
      <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', maxHeight: mainH, overflow: 'hidden' }}>
        {cols.map((c) => (
          <div key={c.label} style={{ flex: '1 1 0', minWidth: 0, maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: ink2, paddingBottom: 6, borderBottom: `1.5px solid ${dark ? 'rgba(159,207,142,.35)' : 'rgba(79,122,66,.3)'}` }}>
              <GlobeIcon size={13} />{c.label}<span style={{ marginLeft: 'auto', fontWeight: 600, opacity: .7 }}>{c.list.length}</span>
            </div>
            {c.list.map((w) => (
              <div key={w.key} style={{ padding: '10px 12px', borderRadius: 2, background: dark ? '#262c23' : '#e3e7da', boxShadow: '0 2px 4px rgba(0,0,0,.06), 0 8px 14px rgba(120,90,40,.10)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: ink2 }}><GlobeIcon size={11} />{w.kind === 'place' ? 'Setting' : `World · ${w.kind}`}</span>
                <div style={{ fontFamily: SERIF, fontSize: 13, lineHeight: 1.4, color: dark ? '#e6e6ea' : '#3b3a33', marginTop: 4 }}>{w.text}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
  const caption = kind === 'character' ? 'The people come first: who is tied to whom, and how.' : kind === 'plot' ? 'The scenes come first: each one causes the next, act by act.' : 'The world comes first: its rules, places and powers, set beside the scenes.';
  const rows = [kind !== 'character' ? { label: 'Characters', node: castRow } : null, kind !== 'plot' ? { label: 'Scenes', node: sceneRow } : null, kind !== 'world' && worldRow ? { label: 'World', node: worldRow } : null].filter(Boolean) as Array<{ label: string; node: React.ReactNode }>;
  return (
    <div
      key={template.id} data-template-preview={template.id} aria-hidden
      style={{ position: 'fixed', left, top, width: W, height: H, zIndex: 110, pointerEvents: 'none', fontFamily: 'system-ui, sans-serif', animation: 'ffTplPv 220ms cubic-bezier(.2,.7,.2,1) both', display: 'flex', flexDirection: 'column', gap: 18, boxSizing: 'border-box', padding: '16px 20px', borderRadius: 12, background: dark ? 'rgba(20,20,23,.96)' : 'rgba(253,251,247,.97)', border: `1px solid ${dark ? '#26262b' : '#ebe8e0'}` }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.6px', textTransform: 'uppercase', color: '#ff6b35' }}>{template.label}</span>
        <span style={{ fontSize: 12.5, color: muted }}>{caption}</span>
      </div>
      {main}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, opacity: faint }}>
        {rows.map((r) => <div key={r.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}><span style={{ width: 70, flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: muted, paddingTop: 4 }}>{r.label}</span>{r.node}</div>)}
      </div>
    </div>
  );
}

/** The mark a template card, sticky or world entry wears until it is edited. */
export function TemplateTag({ dark }: { dark: boolean }) {
  return (
    <span
      data-template-tag aria-label="Template"
      style={{
        position: 'absolute', top: -8, right: 10, zIndex: 3, pointerEvents: 'none',
        font: '700 9px/1 system-ui, sans-serif', letterSpacing: '.6px', textTransform: 'uppercase',
        padding: '3px 6px', borderRadius: 999, border: `1px dashed ${dark ? '#5a5a64' : '#c9bfae'}`,
        background: dark ? '#1b1b20' : '#fffdf7', color: dark ? '#a8a8b2' : '#8a7f6c',
      }}
    >
      Template
    </span>
  );
}

/** Where a template's pieces go when it lands. It should look like a board
 *  a braindump builds, not a spreadsheet (Ben, 2026-10-14: "too clean, it
 *  needs to be recognizable against the sandboxes that would arise from
 *  braindumps"):
 *  - world cards along the top, a little uneven, wrapping when there are many;
 *  - the scenes weave across the board in story order, left to right then
 *    back, each one set a little higher or lower than its neighbour, so the
 *    thread winds through them;
 *  - each character sits in the weave beside the first scene they are in,
 *    in a gap, never on another card; one in no scene goes to the edge;
 *  - a world note that names its scene (`near`) sits beside that scene too,
 *    in the gaps the characters left; the rest run along the top.
 *  The unevenness is fixed per position, so a template always lands the same
 *  way. Items that are not template material keep their place. */
export function templateLayout(items: StageItem[], sceneOrder: string[], involves: Array<{ from: string; to: string }> = [], boardW = 1440): Record<string, Pos> {
  const tpl = (it: StageItem) => (it.kind === 'card' ? String((it.entity as any).template ?? '') === '1' : it.kind === 'world' ? !!it.entry.template : it.kind === 'sticky' ? !!it.fragment.template : false);
  const out: Record<string, Pos> = {};
  const LEFT = 24, TOP = 24;
  const wob = (i: number, amp: number) => (((i * 37 + 11) % 9) - 4) * (amp / 4);
  const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
  const put = (it: StageItem, p: Pos) => { const z = itemSize(it); out[it.id] = { x: Math.round(Math.max(0, p.x)), y: Math.round(Math.max(0, p.y)) }; rects.push({ ...out[it.id], ...z }); };
  const clear = (p: Pos, z: { w: number; h: number }, pad = 18) => rects.every((r) => p.x + z.w + pad <= r.x || r.x + r.w + pad <= p.x || p.y + z.h + pad <= r.y || r.y + r.h + pad <= p.y);

  // World notes (loose template stickies, the way a dump leaves world
  // material) along the top, a little uneven; a template from before the
  // notes may still carry World cards, which go there too.
  // A note that names its scene (`near`) waits for the weave and lands beside
  // that scene; only the rest run along the top.
  // A sample's world entry names its scene the same way (2026-10-22).
  const nearOf = (it: StageItem) => (it.kind === 'sticky' ? it.fragment.near : it.kind === 'world' ? it.entry.near : undefined);
  const world = items.filter((it) => tpl(it) && (it.kind === 'world' || it.kind === 'sticky') && !nearOf(it));
  const nearNotes = items.filter((it) => tpl(it) && (it.kind === 'sticky' || it.kind === 'world') && !!nearOf(it));
  let wx = LEFT, wy = TOP, rowH = 0;
  world.forEach((it, i) => {
    const z = itemSize(it);
    if (wx > LEFT && wx + z.w > boardW) { wx = LEFT + 40; wy += rowH + 24; rowH = 0; }
    put(it, { x: wx + wob(i, 12), y: wy + wob(i + 3, 10) });
    wx += z.w + 28 + Math.abs(wob(i + 5, 16));
    rowH = Math.max(rowH, z.h);
  });
  // The scenes start just under them (2026-10-14: they began far too low).
  const minCharY = world.length ? wy + rowH + 24 : TOP;
  // With nothing along the top, keep a strip above the first row so the
  // people and notes of scene one have somewhere to sit.
  const top = world.length ? wy + rowH + 64 : TOP + 150;

  // THE WEAVE, AS BEN LAID IT OUT (2026-11-08: "this is the layout i want
  // actually", The Matrix arranged by hand): four across, each a step lower
  // than the one before, then back the other way; an act's tab takes its
  // place in the line right before its first scene (Act II opens the second
  // row at the right, Act III sits in the line ahead of its scene), the
  // opening tab hangs over the first scene. Characters and world cards find
  // room above, between and beside.
  const rank = new Map(sceneOrder.map((id, i) => [id, i]));
  const scenes = items.filter((it) => tpl(it) && it.kind === 'card' && it.entity.type === 'event')
    .sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6));
  const line = items.filter((it) => tpl(it) && it.kind === 'card' && (it.entity.type === 'event' || it.entity.type === 'sequence'))
    .sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6));
  const sz = scenes.length ? itemSize(scenes[0]) : { w: 300, h: 140 };
  const firstAt = line.findIndex((it) => it.kind === 'card' && it.entity.type === 'event');
  const leading = firstAt > 0 ? line.slice(0, firstAt) : [];
  const weave = firstAt > 0 ? line.slice(firstAt) : line;
  const stepX = sz.w + 60;
  const perBand = Math.max(2, Math.min(4, Math.floor((boardW - LEFT - sz.w) / stepX) + 1));
  const WEAVE_X = LEFT + 20;
  const STAIR = 30; // each one a little lower than the last
  const bandH = sz.h + STAIR * (perBand - 1) + 100; // a row, plus the room between rows (Ben's: about 310)
  weave.forEach((it, i) => {
    const band = Math.floor(i / perBand), j = i % perBand;
    const col = band % 2 === 0 ? j : perBand - 1 - j; // back and forth
    const z = itemSize(it);
    put(it, { x: WEAVE_X + col * stepX + (sz.w - z.w) / 2 + wob(i, 14), y: top + band * bandH + j * STAIR + (sz.h - z.h) / 2 + wob(i + 2, 10) });
  });
  // The opening tab(s) over the first scene.
  const p0 = weave.length ? out[weave[0].id] : undefined;
  leading.forEach((it, k) => {
    if (!p0) return;
    const z = itemSize(it);
    put(it, { x: p0.x + 14 + k * (z.w + 20), y: p0.y - z.h - 50 });
  });
  // The thread between scenes is not a place to sit: a strip along each
  // link counts as taken (2026-10-14: a note landed on the thread at a turn).
  for (let k = 0; k < line.length - 1; k++) {
    const a = out[line[k].id], b = out[line[k + 1].id];
    if (!a || !b) continue;
    const za = itemSize(line[k]), zb = itemSize(line[k + 1]);
    const ax = a.x + za.w / 2, ay = a.y + za.h / 2, bx = b.x + zb.w / 2, by = b.y + zb.h / 2;
    if (Math.abs(bx - ax) < Math.abs(by - ay)) rects.push({ x: (ax + bx) / 2 - 8, y: Math.min(ay, by), w: 16, h: Math.abs(by - ay) });
    else rects.push({ x: Math.min(ax, bx), y: (ay + by) / 2 - 8, w: Math.abs(bx - ax), h: 16 });
  }
  // Characters beside the first scene they are in, in a gap.
  const firstScene = new Map<string, string>();
  for (const sc of scenes) for (const e of involves) if (e.from === sc.id && !firstScene.has(e.to)) firstScene.set(e.to, sc.id);
  // Whoever appears first picks first, so a scene-one character is not
  // crowded away from scene one by someone who arrives later.
  const order = new Map(scenes.map((sc, i) => [sc.id, i]));
  const chars = items.filter((it) => tpl(it) && it.kind === 'card' && it.entity.type === 'character')
    .sort((a, b) => (order.get(firstScene.get(a.id) ?? '') ?? 1e6) - (order.get(firstScene.get(b.id) ?? '') ?? 1e6));
  let edgeY = top;
  // Last resort: down the right edge of the board.
  const edgeX = Math.min(WEAVE_X + (perBand - 1) * stepX + sz.w + 48, boardW - 240);
  // Beside an anchor scene, in a gap; failing that, outward around it;
  // failing that, the right edge of the weave.
  const placeNear = (it: StageItem, anchorIds: string[], i: number) => {
    const z = itemSize(it);
    const ok = (p: Pos) => p.x >= 0 && p.x + z.w <= boardW + 120 && p.y >= minCharY && clear(p, z);
    // Four spots along a scene's bottom edge, four along its top, then its
    // sides: a scene with two characters and a note still has room.
    const spotsBy = (anchor: Pos): Pos[] => {
      const xs = [anchor.x - 30, anchor.x + 30, anchor.x + sz.w - z.w, anchor.x + sz.w - z.w + 60].map((x, k) => x + wob(i + k, 10));
      // Either side of where the thread leaves the scene's middle, for a
      // piece as wide as the scene (a story strip at a turn of the weave).
      xs.push(anchor.x + sz.w / 2 - 30 - z.w, anchor.x + sz.w / 2 + 30);
      const below = anchor.y + sz.h + 34, above = anchor.y - z.h - 18;
      return [
        ...xs.map((x) => ({ x, y: below })),
        ...xs.map((x) => ({ x, y: above })),
        { x: anchor.x + sz.w + 28, y: anchor.y + 40 + wob(i, 16) },
        { x: anchor.x - z.w - 28, y: anchor.y + 40 + wob(i, 16) },
        { x: anchor.x + sz.w + 28, y: below },
        { x: anchor.x - z.w - 28, y: below },
      ];
    };
    // Their first scene, then the next ones they are in: a crowded opening
    // scene spreads its people along the scenes they share.
    const anchors = anchorIds.map((id) => out[id]).filter((a): a is Pos => !!a);
    for (const anchor of anchors) for (const p of spotsBy(anchor)) if (ok(p)) { put(it, p); return; }
    // Then outward around the first one.
    const first = anchors[0];
    if (first) {
      const cx = first.x + sz.w / 2 - z.w / 2, cy = first.y + sz.h / 2 - z.h / 2;
      for (let r = 1; r <= 6; r++) {
        for (let a = 0; a < 12; a++) {
          const th = (a / 12) * Math.PI * 2 + r * 0.4;
          const p = { x: cx + Math.cos(th) * r * (z.w * 0.8), y: cy + Math.sin(th) * r * (z.h + 30) };
          if (ok(p)) { put(it, p); return; }
        }
      }
    }
    // Last, the right edge of the weave.
    while (!clear({ x: edgeX, y: edgeY }, z)) edgeY += 24;
    put(it, { x: edgeX, y: edgeY });
    edgeY += z.h + 24;
  };
  const scenesOf = (charId: string) => scenes.filter((sc) => involves.some((e) => e.from === sc.id && e.to === charId)).map((sc) => sc.id);
  // World notes first (Ben, 2026-11-08: "keep the world stickies close to
  // where they are established"): each takes the spot beside the scene that
  // sets it up before the people do.
  nearNotes.sort((a, b) => (order.get(nearOf(a) ?? '') ?? 1e6) - (order.get(nearOf(b) ?? '') ?? 1e6))
    .forEach((it, i) => placeNear(it, [nearOf(it)!], i));
  chars.forEach((it, i) => placeNear(it, scenesOf(it.id), i + nearNotes.length));
  // THE TOP ROW (Ben, 2026-11-08: "these cards should be closer to fitting
  // to the top row"): what sits above the first row of scenes (the opening
  // tab, the people and notes over it) lines up along the top of the board
  // instead of each hanging at its own height. One that would land on
  // another stays where it was.
  const firstRowTop = Math.min(...weave.slice(0, perBand).map((it) => out[it.id]?.y ?? Infinity));
  const sizeOf = new Map(items.map((it) => [it.id, itemSize(it)]));
  const above = Object.keys(out).filter((id) => !!sizeOf.get(id) && out[id].y < firstRowTop && !weave.slice(0, perBand).some((it) => it.id === id))
    .sort((a, b) => out[a].x - out[b].x);
  const row: Array<{ x: number; w: number }> = [];
  for (const id of above) {
    const z = sizeOf.get(id)!;
    const x = out[id].x;
    if (row.some((r) => x < r.x + r.w + 16 && r.x < x + z.w + 16)) continue;
    out[id] = { x, y: TOP };
    row.push({ x, w: z.w });
  }
  return out;
}
