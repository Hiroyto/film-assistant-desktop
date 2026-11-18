// SharedScriptPages — o roteiro de um link compartilhado, em folhas, com o
// painel de navegação à esquerda.
//
// A FOLHA é a do editor (components/Scripts/PaginatedEditor): carta de
// 816 x 1056 px, Courier 12pt em linhas de 16px, margem de texto de 1,5 pol. à
// esquerda e 1 pol. nas outras, número da página no alto à direita a partir da
// segunda. A paginação é a do próprio app (`layoutScreenplay`, a que desenha o
// PDF): 54 linhas por página, slugline nunca sozinha no pé da folha, fala
// dividida com (MORE) / (CONT'D), ação dividida só entre frases.
//
// O PAINEL é o outline do editor de roteiro (pages/app/freeform-script, o
// `script-nav`): as sequências como seções, as cenas como linhas com o número,
// e aqui também a página em que cada uma começa. Clicar numa linha leva até a
// cena; a cena que está na tela fica marcada. Ele se recolhe pela alça, como lá.
//
// Só leitura: cada linha do roteiro é texto posicionado, nada aqui é campo.
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { entityColorForMode, getEntityColor } from '../Freeform/entityColors';
import { layoutScreenplay, wrapText, type ExportBlock, type LaidLine } from '../../lib/screenplayExport';
import type { SharedBoard, SharedScript } from '../../lib/shareLinks';

const PAGE_W = 816;
const PAGE_H = 1056;
const PX_PER_IN = 96;
const LINE_H = 16;
const TOP = 96;        // 1 pol. até a primeira linha
const PAGE_GAP = 40;
const NAV_W = 248;     // a largura do painel de outline do editor
const NARROW = 900;    // abaixo disso o painel abre por cima das folhas
const NAV_OPEN_KEY = 'ff-share-script-nav';
const SCRATCH = '__scratch__';
const COURIER = '"Courier New", Courier, monospace';
const FONT = 'system-ui, sans-serif';
/** Polegadas da folha em px, sem a poeira de ponto flutuante (3,7 x 96 = 355,20000000000005). */
const px = (inches: number): number => Math.round(inches * PX_PER_IN * 100) / 100;
const TYPES = new Set(['title', 'scene', 'description', 'character', 'parenthetical', 'dialogue', 'transition']);
/** As colunas do layout (lib/screenplayExport COLUMN): onde cada tipo de linha começa e quantos caracteres cabem. */
const COLS: Record<string, { x: number; width: number }> = {
  scene: { x: 1.5, width: 60 }, description: { x: 1.5, width: 60 }, character: { x: 3.7, width: 38 }, parenthetical: { x: 3.1, width: 23 }, dialogue: { x: 2.5, width: 35 },
};

/** A tela mostra qualquer glifo: só os espaços são normalizados (o PDF troca
 *  travessões e aspas curvas pelas formas de máquina de escrever; aqui não). */
const screenText = (s: string): string => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

const typed = (b: { type: string; text: string }): ExportBlock => ({
  type: (TYPES.has(b.type) ? b.type : 'description') as ExportBlock['type'],
  text: String(b.text ?? ''),
});
const blocksOf = (script: SharedScript): ExportBlock[] => script.scenes.flatMap((s) => s.blocks).map(typed);

/** Uma linha do painel: uma cena (ou o texto ainda sem cena) e onde ela começa. */
export interface ScriptNavEntry { id: string; label: string; number: number | null; sequence: string; sheet: number; slot: number; page: number }

/** Onde cada cena começa nas folhas. O layout não diz de que bloco veio cada
 *  linha, então a primeira linha de cada cena (quase sempre a slugline, que
 *  nunca se divide) é procurada nas páginas, em ordem, a partir de onde a cena
 *  anterior foi achada. Uma cena não achada fica onde a anterior está. Pura. */
export function scriptNavEntries(script: SharedScript, layout: ReturnType<typeof layoutScreenplay>, board?: SharedBoard): ScriptNavEntry[] {
  const fromBoard = new Map<string, { number: number; sequence: string }>();
  for (const s of board?.sections ?? []) for (const scene of s.scenes) fromBoard.set(scene.id, { number: scene.number, sequence: s.title });
  const lead = layout.titlePage ? 1 : 0;
  const out: ScriptNavEntry[] = [];
  let p = 0;
  let slot = 0;
  let last = { page: 0, slot: 0 };
  script.scenes.forEach((scene, i) => {
    const first = scene.blocks.map(typed).find((b) => b.type !== 'title' && screenText(b.text));
    if (!first) return; // só linhas de título: é a página de título, não uma cena
    const text = screenText(first.text);
    const col = COLS[first.type] ?? COLS.description;
    const want = first.type === 'transition'
      ? { text: text.toUpperCase(), right: true, x: 0 }
      : { text: wrapText(first.type === 'scene' || first.type === 'character' ? text.toUpperCase() : text, col.width)[0], right: false, x: col.x };
    let found: { page: number; slot: number } | null = null;
    for (let pi = p; pi < layout.pages.length && !found; pi++) {
      for (let si = pi === p ? slot : 0; si < layout.pages[pi].length; si++) {
        const l = layout.pages[pi][si];
        if (l && l.text === want.text && (want.right ? l.align === 'right' : !l.align && l.x === want.x)) { found = { page: pi, slot: si }; break; }
      }
    }
    if (found) { p = found.page; slot = found.slot + 1; last = found; }
    const known = fromBoard.get(scene.id);
    const loose = scene.id === SCRATCH;
    out.push({
      id: scene.id,
      label: scene.title || (loose ? 'Loose pages' : 'Untitled scene'),
      number: loose ? null : scene.number ?? known?.number ?? i + 1,
      sequence: loose ? '' : scene.sequence ?? known?.sequence ?? '',
      sheet: last.page + lead,
      slot: last.slot,
      page: last.page + 1,
    });
  });
  return out;
}

function Line({ line, slot, bold }: { line: LaidLine; slot: number; bold: boolean }): JSX.Element {
  const top = TOP + slot * LINE_H;
  const base: React.CSSProperties = { position: 'absolute', top, whiteSpace: 'pre', fontWeight: bold ? 700 : 400 };
  if (line.align === 'right') return <div style={{ ...base, right: px(PAGE_W / PX_PER_IN - line.x), textAlign: 'right' }}>{line.text}</div>;
  if (line.align === 'center') return <div style={{ ...base, left: px(line.x), transform: 'translateX(-50%)', textAlign: 'center' }}>{line.text}</div>;
  return <div style={{ ...base, left: px(line.x) }}>{line.text}</div>;
}

const isNarrow = (): boolean => window.innerWidth <= NARROW;
/** O painel começa aberto onde há lugar para ele; quem o recolheu o reencontra recolhido. */
function navStartsOpen(): boolean {
  if (isNarrow()) return false;
  try { return localStorage.getItem(NAV_OPEN_KEY) !== '0'; } catch { return true; }
}

export function SharedScriptPages({ script, dark, board, footer }: {
  script: SharedScript; dark: boolean;
  /** O board do mesmo link, quando veio: dá o número e a sequência das cenas a um link antigo. */
  board?: SharedBoard;
  /** O que vai depois da última folha (a nota de preview). */
  footer?: React.ReactNode;
}): JSX.Element {
  const blocks = useMemo(() => blocksOf(script), [script]);
  const layout = useMemo(() => layoutScreenplay(blocks, screenText), [blocks]);
  // As sluglines saem em negrito, como no editor. O layout não diz de que tipo
  // é cada linha, então elas são reconhecidas pelo texto: as linhas em que cada
  // slugline quebra, na coluna da margem.
  const sluglines = useMemo(() => {
    const out = new Set<string>();
    for (const b of blocks) if (b.type === 'scene') for (const l of wrapText(screenText(b.text).toUpperCase(), 60)) out.add(l);
    return out;
  }, [blocks]);
  const isSlug = (l: LaidLine): boolean => !l.align && l.x === 1.5 && sluglines.has(l.text);

  const sheets = useMemo(() => [
    ...(layout.titlePage ? [{ key: 'title', number: null as number | null, title: true, lines: layout.titlePage }] : []),
    ...layout.pages.map((p, i) => ({
      key: `p${i}`,
      number: i + 1 as number | null,
      title: false,
      lines: p.flatMap((l, slot) => (l ? [{ line: l, slot }] : [])),
    })),
  ], [layout]);
  const total = layout.pages.length;

  // O painel: as cenas com onde começam, agrupadas pela sequência.
  const entries = useMemo(() => scriptNavEntries(script, layout, board), [script, layout, board]);
  const groups = useMemo(() => {
    const out: Array<{ key: string; sequence: string; rows: ScriptNavEntry[] }> = [];
    for (const e of entries) {
      const tail = out[out.length - 1];
      if (tail && tail.sequence === e.sequence) tail.rows.push(e);
      else out.push({ key: `${e.sequence}:${e.id}`, sequence: e.sequence, rows: [e] });
    }
    return out;
  }, [entries]);
  const anchorsBySheet = useMemo(() => {
    const out = new Map<number, ScriptNavEntry[]>();
    for (const e of entries) out.set(e.sheet, [...(out.get(e.sheet) ?? []), e]);
    return out;
  }, [entries]);

  const [narrow, setNarrow] = useState(isNarrow);
  const [navOpen, setNavOpen] = useState(navStartsOpen);
  useEffect(() => {
    const onResize = (): void => setNarrow(isNarrow());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const toggleNav = (): void => {
    setNavOpen((v) => {
      // Numa tela estreita o painel é uma gaveta: abrir e fechar ali não vira preferência.
      if (!narrow) { try { localStorage.setItem(NAV_OPEN_KEY, v ? '0' : '1'); } catch { /* sem storage */ } }
      return !v;
    });
  };

  // A folha tem largura fixa; numa coluna mais estreita ela encolhe inteira,
  // como num leitor de PDF. (O painel abrindo e fechando muda a coluna.)
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  // Quando a folha muda de tamanho (o painel abriu ou fechou, a janela mudou) o
  // leitor continua no mesmo trecho: a rolagem volta à mesma fração do roteiro.
  const keepAt = useRef(0);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (box && keepAt.current > 0) box.scrollTop = keepAt.current * box.scrollHeight;
  }, [scale]);
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const fit = (): void => {
      const w = host.clientWidth;
      if (w <= 0) return;
      const box = scrollRef.current;
      if (box && box.scrollHeight > 0) keepAt.current = box.scrollTop / box.scrollHeight;
      setScale(Math.min(1, w / PAGE_W));
    };
    fit();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(fit);
      ro.observe(host);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  // Onde o leitor está: a página (para o indicador) e a cena (para o painel).
  const sheetRefs = useRef<Array<HTMLDivElement | null>>([]);
  const anchorRefs = useRef<Record<string, HTMLSpanElement | null>>({});
  const [current, setCurrent] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return undefined;
    let raf = 0;
    const read = (): void => {
      raf = 0;
      if (!box.clientHeight) { setActive(entries[0]?.id ?? null); return; } // sem layout (teste): o começo
      const top = box.getBoundingClientRect().top;
      let at = 0;
      sheetRefs.current.forEach((el, i) => { if (el && el.getBoundingClientRect().top <= top + box.clientHeight / 2) at = i; });
      setCurrent(at);
      let scene: string | null = entries[0]?.id ?? null;
      for (const e of entries) { const a = anchorRefs.current[e.id]; if (a && a.getBoundingClientRect().top <= top + 160) scene = e.id; }
      setActive(scene);
    };
    const onScroll = (): void => { if (!raf) raf = window.requestAnimationFrame(read); };
    read();
    box.addEventListener('scroll', onScroll, { passive: true });
    return () => { box.removeEventListener('scroll', onScroll); if (raf) window.cancelAnimationFrame(raf); };
  }, [entries, sheets.length, scale]);
  // Salto direto, sem animação: num roteiro longo a rolagem suave até uma cena
  // distante demora, e não termina numa aba em segundo plano.
  const goPage = (i: number): void => {
    const el = sheetRefs.current[Math.max(0, Math.min(sheets.length - 1, i))];
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  };
  const goScene = useCallback((id: string): void => {
    const el = anchorRefs.current[id];
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
    setActive(id);
    if (isNarrow()) setNavOpen(false); // a gaveta sai do caminho
  }, []);

  const ink = dark ? '#f3f4f6' : '#111827';
  const hair = dark ? '#26262c' : '#e3dbcb';
  const mute = dark ? '#9a9aa4' : '#777';
  const seqTint = dark ? getEntityColor('sequence') : entityColorForMode(getEntityColor('sequence'), 'light');
  const navBtn: React.CSSProperties = {
    font: 'inherit', fontSize: 14, lineHeight: 1, width: 26, height: 26, borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${dark ? '#2a2a30' : '#e6dfd2'}`, background: dark ? '#1a1a1e' : '#fff', color: dark ? '#c8c8d0' : '#3d4250',
  };
  const handle: React.CSSProperties = {
    position: 'absolute', top: '50%', transform: 'translateY(-50%)', zIndex: 30, width: 17, height: 54, padding: 0,
    border: `1px solid ${hair}`, background: dark ? '#131316' : '#fbf8f1', color: dark ? '#8a8a93' : '#736b5e', fontSize: 13, fontFamily: FONT,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
  };
  const shownNumber = sheets[current]?.number;
  const row = (e: ScriptNavEntry | null, label: string, page: string, on: boolean, onClick: () => void): JSX.Element => (
    <button
      key={e?.id ?? 'title'}
      type="button"
      className="ff-share-nav-row"
      data-testid="script-nav-row"
      data-on={on ? '' : undefined}
      aria-current={on ? 'true' : undefined}
      title={label}
      onClick={onClick}
    >
      <span className="ff-share-nav-no">{e?.number != null ? String(e.number).padStart(2, '0') : ''}</span>
      <span className="ff-share-nav-title" style={e && e.number == null ? { fontStyle: 'italic' } : undefined}>{label}</span>
      <span className="ff-share-nav-page">{page}</span>
    </button>
  );

  return (
    <div data-testid="shared-script" data-dark={dark ? '' : undefined} style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', position: 'relative' }}>
      {/* As linhas do painel: as cores e o hover do outline do editor. */}
      <style>{`
        .ff-share-nav-row { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 10px 4px 14px; border: none; border-left: 2px solid transparent; background: transparent; cursor: pointer; text-align: left; font-family: ${FONT}; transition: background 120ms; }
        .ff-share-nav-no { font-family: ui-monospace, monospace; font-size: 10px; font-weight: 700; color: #6b6b74; flex-shrink: 0; width: 18px; }
        .ff-share-nav-title { font-size: 12px; line-height: 18px; color: #333; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ff-share-nav-page { font-family: ui-monospace, monospace; font-size: 10px; color: #8a8578; flex-shrink: 0; font-variant-numeric: tabular-nums; }
        .ff-share-nav-row:hover { background: rgba(234,88,12,0.05); border-left-color: rgba(255,107,53,0.45); }
        .ff-share-nav-row:hover .ff-share-nav-no, .ff-share-nav-row[data-on] .ff-share-nav-no { color: #ff8c42; }
        .ff-share-nav-row[data-on] { background: rgba(234,88,12,0.08); border-left-color: #ff6b35; }
        [data-dark] .ff-share-nav-title { color: #b9b9c1; }
        [data-dark] .ff-share-nav-page { color: #6b6b74; }
        [data-dark] .ff-share-nav-row:hover { background: rgba(255,140,66,0.06); }
        [data-dark] .ff-share-nav-row[data-on] { background: rgba(255,107,53,0.10); }
        [data-dark] .ff-share-nav-row:hover .ff-share-nav-title, [data-dark] .ff-share-nav-row[data-on] .ff-share-nav-title { color: #e6e6ea; }
      `}</style>

      {/* A alça, recolhido: uma aba fina na borda esquerda. */}
      {!navOpen ? (
        <button type="button" onClick={toggleNav} title="Show the outline panel" aria-label="Show the outline panel" aria-expanded={false} style={{ ...handle, left: 0, borderLeft: 'none', borderRadius: '0 9px 9px 0', boxShadow: '2px 0 10px rgba(0,0,0,0.18)' }}>›</button>
      ) : null}
      {navOpen ? (
        <nav
          data-testid="script-nav"
          aria-label="Script outline"
          style={{
            width: NAV_W, flexShrink: 0, position: narrow ? 'absolute' : 'relative', ...(narrow ? { left: 0, top: 0, bottom: 0, zIndex: 25, boxShadow: '6px 0 24px rgba(0,0,0,0.28)' } : {}),
            borderRight: `1px solid ${dark ? '#1f1f24' : '#e8e0d2'}`, background: dark ? '#0e0e10' : '#fbf8f1', fontFamily: FONT,
          }}
        >
          {/* A alça, aberto: anda na borda direita do painel. */}
          <button type="button" onClick={toggleNav} title="Hide the outline panel" aria-label="Hide the outline panel" aria-expanded style={{ ...handle, right: -12, borderRadius: 9, boxShadow: dark ? '0 2px 10px rgba(0,0,0,0.22)' : '0 2px 10px rgba(60,40,10,0.10)' }}>‹</button>
          <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '10px 0 40px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 14px 8px', fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: mute }}>
              <span style={{ flex: 1 }}>Script</span>
              <span style={{ fontWeight: 600, letterSpacing: 0.2, textTransform: 'none' }}>{total} {total === 1 ? 'page' : 'pages'}</span>
            </div>
            {layout.titlePage ? row(null, 'Title page', '', current === 0, () => goPage(0)) : null}
            {groups.map((g) => (
              <div key={g.key} style={{ margin: '0 4px 6px', borderRadius: 7 }}>
                {g.sequence ? (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, padding: '7px 10px 3px' }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: seqTint, flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', color: mute, minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g.sequence}>
                      {g.sequence}
                    </span>
                  </div>
                ) : null}
                {g.rows.map((e) => row(e, e.label, `p. ${e.page}`, active === e.id && !(layout.titlePage && current === 0), () => goScene(e.id)))}
              </div>
            ))}
          </div>
        </nav>
      ) : null}

      <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex' }}>
        <div ref={scrollRef} data-testid="shared-script-scroll" style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '22px clamp(12px, 4vw, 26px) 72px' }}>
          <div ref={hostRef} style={{ width: '100%', maxWidth: PAGE_W, margin: '0 auto' }}>
            {sheets.map((sheet, i) => (
              <div
                key={sheet.key}
                ref={(el) => { sheetRefs.current[i] = el; }}
                // A folha encolhida ocupa o tamanho encolhido (o transform não muda o layout).
                style={{ width: PAGE_W * scale, height: PAGE_H * scale, marginTop: i === 0 ? 0 : PAGE_GAP * scale, scrollMarginTop: 12 }}
              >
                <div
                  data-testid="shared-page"
                  data-page={sheet.title ? 'title' : sheet.number}
                  role="group"
                  aria-label={sheet.title ? 'Title page' : `Page ${sheet.number} of ${total}`}
                  style={{
                    position: 'relative', width: PAGE_W, height: PAGE_H, transform: scale === 1 ? undefined : `scale(${scale})`, transformOrigin: 'top left',
                    background: dark ? '#1e1e1e' : '#ffffff', color: ink, borderRadius: 2, overflow: 'hidden',
                    boxShadow: dark ? '0 4px 24px rgba(0,0,0,0.6)' : '0 2px 16px rgba(0,0,0,0.18)',
                    fontFamily: COURIER, fontSize: 16, lineHeight: `${LINE_H}px`,
                  }}
                >
                  {/* O cabeçalho do Final Draft: "N." à direita, meia polegada do topo,
                      a partir da segunda página; a página de título não conta. */}
                  {sheet.number !== null && sheet.number > 1 ? (
                    <div data-testid="shared-page-number" style={{ position: 'absolute', top: 48, right: PX_PER_IN, color: dark ? '#c9c9d2' : '#111' }}>{sheet.number}.</div>
                  ) : null}
                  {sheet.lines.map(({ line, slot }, k) => <Line key={k} line={line} slot={slot} bold={!sheet.title && isSlug(line)} />)}
                  {/* Onde cada cena começa: o ponto para onde o painel leva. */}
                  {(anchorsBySheet.get(i) ?? []).map((e) => (
                    <span
                      key={e.id}
                      ref={(el) => { anchorRefs.current[e.id] = el; }}
                      data-scene-anchor={e.id}
                      aria-hidden="true"
                      style={{ position: 'absolute', left: 0, top: TOP + e.slot * LINE_H, width: 1, height: 1, scrollMarginTop: 56 }}
                    />
                  ))}
                </div>
              </div>
            ))}
            {footer ? <div style={{ margin: '20px 0 0', textAlign: 'center' }}>{footer}</div> : null}
          </div>
        </div>

        {total > 1 ? (
          <div
            style={{
              position: 'absolute', left: '50%', bottom: 14, transform: 'translateX(-50%)', zIndex: 6, display: 'flex', alignItems: 'center', gap: 8,
              padding: '5px 8px', borderRadius: 10, fontFamily: FONT, fontSize: 12, fontWeight: 600,
              background: dark ? 'rgba(26,26,30,0.94)' : 'rgba(255,255,255,0.96)', color: dark ? '#c8c8d0' : '#3d4250',
              border: `1px solid ${dark ? '#2a2a30' : '#e6dfd2'}`, boxShadow: dark ? '0 6px 20px rgba(0,0,0,0.5)' : '0 4px 14px rgba(60,45,20,0.12)',
            }}
          >
            <button type="button" aria-label="Previous page" onClick={() => goPage(current - 1)} disabled={current <= 0} style={{ ...navBtn, opacity: current <= 0 ? 0.4 : 1 }}>‹</button>
            <span data-testid="shared-page-indicator" style={{ minWidth: 92, textAlign: 'center' }}>
              {shownNumber ? `Page ${shownNumber} of ${total}` : 'Title page'}
            </span>
            <button type="button" aria-label="Next page" onClick={() => goPage(current + 1)} disabled={current >= sheets.length - 1} style={{ ...navBtn, opacity: current >= sheets.length - 1 ? 0.4 : 1 }}>›</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default SharedScriptPages;
