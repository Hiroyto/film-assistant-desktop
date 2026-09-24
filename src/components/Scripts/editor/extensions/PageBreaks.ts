/**
 * PageBreaks
 * ==========
 * Quebras de página VISUAIS para um único editor ProseMirror.
 *
 * O documento inteiro vive num editor só. Este plugin MEDE onde cada página
 * termina e empurra o parágrafo que inicia cada nova página para o topo da folha
 * seguinte aplicando um `margin-top` grande NESSE parágrafo (via `Decoration.node`).
 *
 *   margin-top = (CONTENT_H − alturaUsada) + 2*MARGIN_V + PAGE_GAP
 *
 * Por que `margin-top` no parágrafo, e NÃO um <div> espaçador entre parágrafos:
 * o CSS do roteiro usa seletor de irmão adjacente (`.ProseMirror p + p { margin }`)
 * e margens em `em` por tipo de linha. Um <div> injetado ENTRE dois <p> fazia o
 * `p + p` deixar de casar e alterava o margin-collapse — então `offsetTop` divergia
 * entre "com espaçador" e "sem espaçador", e a quebra OSCILAVA (o parágrafo pulava
 * de uma página para outra). Aplicando a margem no próprio parágrafo, a estrutura de
 * irmãos nunca muda quando uma quebra liga/desliga: só um valor de margem muda, e a
 * medição subtrai exatamente essa margem → determinística, sem oscilação.
 *
 * Consequências:
 *  - Nenhuma linha cruza a borda impressa (o parágrafo é jogado pra folha de baixo).
 *  - O texto reflui sozinho: deletar encurta páginas anteriores e as margens
 *    recalculam, reaproveitando o espaço inferior (Problema 1).
 *  - Seleção nativa cobre o doc inteiro (Problema 2). Copy/cut/paste nativos.
 *
 * A medição roda em coordenadas NATURAIS (offsetTop menos as margens já injetadas
 * acima), e só re-dispara quando a "assinatura" das quebras muda. A transação é
 * apenas de decoration (não mexe no history).
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

export interface PageBreaksOptions {
    pageHeight: number;
    contentHeight: number;
    marginV: number;
    pageGap: number;
    /** Chamado quando a contagem de páginas muda (para o overlay de folhas).
     *  titlePage: page one is the title page (its lines are typed `title`),
     *  so the sheet overlay numbers the script from the second sheet. */
    onPageCountChange?: (n: number, titlePage?: boolean) => void;
}

export const pageBreaksKey = new PluginKey("pageBreaks");

interface BreakSpec {
    /** 'break': the paragraph opens a new sheet. 'push': a title page's first
     *  contact line, pushed down so the contact block sits at the bottom of
     *  its sheet (Final Draft anchors it there; a fixed CSS gap overflowed an
     *  eleven-line title page, 2026-09-17). Both are inline margin-top
     *  replacements the measurement subtracts back out. */
    kind: "break" | "push";
    /** Posição PM imediatamente antes do parágrafo que inicia a página. */
    pos: number;
    /** margin-top (px) INLINE aplicado nesse parágrafo (substitui a margem nativa). */
    height: number;
    /**
     * Margem-top NATIVA (px) que o parágrafo teria sem a injeção (resolvida do
     * cascade: `p + p`, `data-line-type`, tema). O deslocamento real que a injeção
     * causa sobre o layout natural é `height − native` (inline SUBSTITUI a nativa,
     * não soma) — a medição precisa subtrair exatamente esse delta para ser
     * invariante e não oscilar.
     */
    native: number;
}

// Tolerância pra não flipar a decisão por diferença sub-pixel exatamente na borda.
const EPS = 0.5;

function signature(breaks: BreakSpec[]): string {
    return breaks.map(b => `${b.kind[0]}${b.pos}:${Math.round(b.height)}`).join("|");
}

// Ranges [from, to) de cada nó top-level do doc.
function nodeRanges(doc: PMNode): { pos: number[]; end: number[] } {
    const pos: number[] = [];
    const end: number[] = [];
    let acc = 0;
    doc.forEach((node) => {
        pos.push(acc);
        acc += node.nodeSize;
        end.push(acc);
    });
    return { pos, end };
}

const PageBreaks = Extension.create<PageBreaksOptions>({
    name: "pageBreaks",

    addOptions() {
        return {
            pageHeight: 1056,
            contentHeight: 864,
            marginV: 96,
            pageGap: 40,
            onPageCountChange: undefined,
        };
    },

    addProseMirrorPlugins() {
        const opts = this.options;
        let lastSig = "";
        let lastCount = -1;
        let lastTitle: boolean | null = null;

        const buildDecoSet = (doc: PMNode, breaks: BreakSpec[]): DecorationSet => {
            const { pos, end } = nodeRanges(doc);
            const posToIdx = new Map<number, number>();
            pos.forEach((p, i) => posToIdx.set(p, i));
            const decos: Decoration[] = [];
            for (const b of breaks) {
                const idx = posToIdx.get(b.pos);
                if (idx == null) continue;
                decos.push(
                    Decoration.node(pos[idx], end[idx], {
                        // Inline vence o `p + p`/`data-line-type` do CSS (não-!important).
                        style: `margin-top: ${b.height}px`,
                        class: b.kind === "push" ? "pm-title-push" : "pm-page-break-start",
                        // Margem nativa gravada no DOM para a medição reconstruir o topo
                        // natural direto do DOM (fonte da verdade), sem depender de estado
                        // interno que fica stale após edições que mapeiam/removem a quebra.
                        "data-pb-native": String(Math.round(b.native)),
                    })
                );
            }
            return DecorationSet.create(doc, decos);
        };

        return [
            new Plugin({
                key: pageBreaksKey,

                state: {
                    init: () => ({ decorations: DecorationSet.empty as DecorationSet }),
                    apply(tr, value: { decorations: DecorationSet }) {
                        const meta = tr.getMeta(pageBreaksKey);
                        if (meta) return { decorations: meta.decorations as DecorationSet };
                        if (tr.docChanged) {
                            // O mapeamento pode DESCARTAR uma node-decoration cujo parágrafo foi
                            // fundido/dividido (Backspace/merge, splits, plugins do freeform). Se
                            // isso acontecer, o estado aplicado diverge do computado. Invalidar o
                            // dedup (lastSig/lastCount) força a próxima medição a re-aplicar as
                            // quebras do zero — o DOM nunca fica permanentemente sem a quebra.
                            lastSig = "";
                            lastCount = -1;
                            return { decorations: value.decorations.map(tr.mapping, tr.doc) };
                        }
                        return value;
                    },
                },

                props: {
                    decorations(state) {
                        return pageBreaksKey.getState(state)?.decorations ?? DecorationSet.empty;
                    },
                },

                view(view) {
                    let rafId: number | null = null;
                    let timer: ReturnType<typeof setTimeout> | null = null;
                    let ro: ResizeObserver | null = null;
                    let destroyed = false;

                    const measure = () => {
                        rafId = null;
                        if (destroyed || view.isDestroyed) return;

                        const dom = view.dom as HTMLElement;
                        const pElems = (Array.from(dom.children) as HTMLElement[])
                            .filter(el => el.tagName === "P");
                        if (pElems.length === 0) return;

                        const { pos: nodePos } = nodeRanges(view.state.doc);

                        // Como não inserimos NENHUM elemento entre os <p>, os filhos <p> do DOM
                        // correspondem 1:1 aos nós top-level do doc. O estado de quebra injetado
                        // é lido do PRÓPRIO DOM (classe/margem/data-attr da decoration), que reflete
                        // o que está de fato renderizado — imune a estado interno stale após splits.

                        const CH = opts.contentHeight;
                        const MV = opts.marginV;
                        const PG = opts.pageGap;

                        const breaks: BreakSpec[] = [];
                        const tops: number[] = [];     // natural top per paragraph (keep-with-next walks back)
                        let injAccum = 0;              // soma das margens injetadas até aqui (inclusive)
                        let pageTop: number | null = null; // topo natural do 1º parágrafo da página atual
                        let pageInj = 0;               // intended in-page injection (a title push) since pageTop
                        let count = 1;

                        // TITLE CONTACT TAILS: for the first contact line of each title
                        // block, the natural height of the contact lines from it to the
                        // block's end (16px between lines). The push lands so this tail
                        // ends at the sheet's bottom margin.
                        const tailH = new Map<number, number>();
                        for (let k = 0; k < pElems.length; k++) {
                            if (pElems[k].getAttribute("data-line-type") !== "title") continue;
                            if (!pElems[k].classList.contains("ff-title-contact")) continue;
                            if (k > 0 && pElems[k - 1].getAttribute("data-line-type") === "title" && pElems[k - 1].classList.contains("ff-title-contact")) continue;
                            let h = 0; let n = 0;
                            for (let j = k; j < pElems.length && pElems[j].getAttribute("data-line-type") === "title"; j++) { h += pElems[j].offsetHeight; n++; }
                            tailH.set(k, h + 16 * (n - 1));
                        }

                        const n = Math.min(pElems.length, nodePos.length);
                        for (let k = 0; k < n; k++) {
                            const el = pElems[k];
                            const pos = nodePos[k];

                            // Estado de quebra ATUAL lido do DOM (fonte da verdade). Um break tem a
                            // classe .pm-page-break-start; sua margem inline é o valor injetado e o
                            // data-attr guarda a margem nativa que ele substituiu.
                            const isBreak = el.classList.contains("pm-page-break-start");
                            const isInjected = isBreak || el.classList.contains("pm-title-push");
                            const injMargin = isInjected ? (parseFloat(getComputedStyle(el).marginTop) || 0) : 0;
                            const nativeAttr = isInjected ? (parseFloat(el.getAttribute("data-pb-native") || "") || 0) : 0;

                            // O deslocamento REAL que a injeção causou sobre o layout natural é
                            // `injMargin − native` (o margin-top inline SUBSTITUI a margem nativa, não
                            // soma). Subtrair isso — lido do DOM — torna a reconstrução invariante e
                            // sempre consistente com o que está renderizado (sem oscilar nem colapsar
                            // após um split que mapeia/remove a decoration).
                            injAccum += isInjected ? (injMargin - nativeAttr) : 0;

                            const naturalTop = el.offsetTop - injAccum;
                            tops[k] = naturalTop;
                            const h = el.offsetHeight;
                            // Page one's origin is the text margin (MV), not the first
                            // paragraph's top: a title page pushes its first line a third
                            // of the way down, and measuring from there would land the
                            // next sheet's first line that far down too.
                            if (pageTop === null) pageTop = Math.min(naturalTop, MV);

                            // A title page's contact block sits at the BOTTOM of its sheet:
                            // push its first line down by whatever room is left after the
                            // lines above and the tail below. No room, no push (the block
                            // then paginates like anything else).
                            const tail = tailH.get(k);
                            if (tail !== undefined && k > 0) {
                                const prevBottom = (tops[k - 1] - pageTop) + pageInj + pElems[k - 1].offsetHeight;
                                const native = isInjected
                                    ? nativeAttr
                                    : (parseFloat(getComputedStyle(el).marginTop) || 0);
                                const push = CH - prevBottom - tail;
                                if (push > native + EPS && pos > 0) {
                                    breaks.push({ kind: "push", pos, height: Math.round(push), native });
                                    pageInj += push - native;
                                }
                            }

                            const used = naturalTop - pageTop + pageInj;   // conteúdo antes dele nesta página
                            const bottom = used + h;

                            // TITLE PAGE (2026-09-15): the title lines own a sheet of their
                            // own. The first title line after non-title text and the first
                            // non-title paragraph after the title lines are both FORCED onto
                            // a new sheet, the way Final Draft keeps the title page apart.
                            const lt = el.getAttribute("data-line-type");
                            const prevLt = k > 0 ? pElems[k - 1].getAttribute("data-line-type") : null;
                            const forced = k > 0 && (
                                (prevLt === "title" && lt !== "title")
                                || (lt === "title" && prevLt !== "title")
                            );

                            // Quebra ANTES dele se estoura a página E não é o primeiro da página
                            // (um parágrafo sozinho maior que a página transborda visualmente —
                            // não quebramos no meio de um parágrafo).
                            if ((bottom > CH + EPS || forced) && naturalTop > pageTop) {
                                // KEEP-WITH-NEXT (2026-09-15): a cue never ends a page on its
                                // own. When the overflow lands on the FIRST speech paragraph
                                // after a cue (the dialogue, or the wryly between them), the
                                // break moves up to the cue, which then opens the next sheet
                                // with its speech. Final Draft's rule. A break inside a long
                                // speech is left where it falls (FD splits those with MORE).
                                let at = k;
                                if (!forced && (lt === "dialogue" || lt === "parenthetical")) {
                                    let j = k - 1;
                                    if (j >= 0 && pElems[j].getAttribute("data-line-type") === "parenthetical") j -= 1;
                                    // tops[j] > pageTop: the cue is not already this page's first
                                    // line. Its CURRENT break state must not matter: the pass
                                    // that put the break on the cue is followed by a pass that
                                    // sees it as a break, and refusing it there made the break
                                    // hop between cue and dialogue on alternate passes.
                                    if (j >= 0 && pElems[j].getAttribute("data-line-type") === "character" && tops[j] > pageTop) {
                                        at = j;
                                    }
                                }
                                const target = pElems[at];
                                const targetPos = nodePos[at];
                                const targetTop = tops[at];
                                const targetIsBreak = target.classList.contains("pm-page-break-start");
                                const targetUsed = targetTop - pageTop + pageInj;
                                // Margem nativa: se já é break, vem do data-attr (o computed
                                // devolveria o valor injetado, errado); senão lê do cascade agora
                                // (parágrafo ainda sem override inline).
                                const native = targetIsBreak
                                    ? (parseFloat(target.getAttribute("data-pb-native") || "") || 0)
                                    : (parseFloat(getComputedStyle(target).marginTop) || 0);
                                // FIRST LINE OF A PAGE AT THE TEXT MARGIN (2026-09-12, matches
                                // Final Draft, which suppresses space-before at a page top). The
                                // injected margin REPLACES the native one, so the paragraph's
                                // visual top is naturalTop + (injected - native); with page 1
                                // starting exactly at MV (first-child rule in scripts.css) the
                                // injected value must carry `+ native` to land the paragraph at
                                // MV on the new page. The page origin stays the natural top: the
                                // fill check runs in natural coordinates and maps to the visual
                                // page exactly (measured pages 1 to 6 at 96px, 2026-09-12).
                                const marginTop = (CH - targetUsed) + 2 * MV + PG + native;
                                if (targetPos > 0 && marginTop > 0) {
                                    breaks.push({ kind: "break", pos: targetPos, height: Math.round(marginTop), native });
                                    count++;
                                    pageTop = targetTop;
                                    pageInj = 0;
                                }
                            }
                        }

                        const sig = signature(breaks);
                        if (sig !== lastSig) {
                            lastSig = sig;
                            const decoSet = buildDecoSet(view.state.doc, breaks);
                            view.dispatch(view.state.tr.setMeta(pageBreaksKey, { decorations: decoSet }));
                        }
                        const titleFirst = pElems[0].getAttribute("data-line-type") === "title";
                        if (count !== lastCount || titleFirst !== lastTitle) {
                            lastCount = count;
                            lastTitle = titleFirst;
                            opts.onPageCountChange?.(count, titleFirst);
                        }
                    };

                    // Medição no PRÓXIMO frame, ANTES da pintura: os callbacks de rAF rodam
                    // depois de o doc mudar o DOM (posição natural) mas ANTES do browser
                    // pintar. Medir + aplicar a margem da quebra aqui faz o texto já aparecer
                    // na posição paginada no mesmo frame — sem o flash de "posição natural →
                    // posição correta". Caminho quente (edições). Coalescido por frame.
                    const scheduleFrame = () => {
                        if (timer) { clearTimeout(timer); timer = null; }
                        if (rafId == null) rafId = requestAnimationFrame(measure);
                    };

                    // Debounced — resize/carregamento de fontes (não crítico a latência).
                    const schedule = (delay = 150) => {
                        if (rafId != null) return; // já vai medir neste frame
                        if (timer) clearTimeout(timer);
                        timer = setTimeout(() => {
                            timer = null;
                            if (rafId == null) rafId = requestAnimationFrame(measure);
                        }, delay);
                    };

                    // Medições iniciais (carregamento de fontes / primeiro paint).
                    const t1 = setTimeout(() => requestAnimationFrame(measure), 60);
                    const t2 = setTimeout(() => requestAnimationFrame(measure), 250);
                    const t3 = setTimeout(() => requestAnimationFrame(measure), 650);

                    try {
                        ro = new ResizeObserver(() => schedule(150));
                        ro.observe(view.dom);
                    } catch {
                        ro = null;
                    }

                    return {
                        update(v, prev) {
                            if (prev.doc !== v.state.doc) scheduleFrame();
                        },
                        destroy() {
                            destroyed = true;
                            if (timer) clearTimeout(timer);
                            if (rafId) cancelAnimationFrame(rafId);
                            clearTimeout(t1);
                            clearTimeout(t2);
                            clearTimeout(t3);
                            if (ro) ro.disconnect();
                        },
                    };
                },
            }),
        ];
    },
});

export default PageBreaks;
