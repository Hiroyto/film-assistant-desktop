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
    /** Chamado quando a contagem de páginas muda (para o overlay de folhas). */
    onPageCountChange?: (n: number) => void;
}

export const pageBreaksKey = new PluginKey("pageBreaks");

interface BreakSpec {
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
    return breaks.map(b => `${b.pos}:${Math.round(b.height)}`).join("|");
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
                        class: "pm-page-break-start",
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
                        let injAccum = 0;              // soma das margens injetadas até aqui (inclusive)
                        let pageTop: number | null = null; // topo natural do 1º parágrafo da página atual
                        let count = 1;

                        const n = Math.min(pElems.length, nodePos.length);
                        for (let k = 0; k < n; k++) {
                            const el = pElems[k];
                            const pos = nodePos[k];

                            // Estado de quebra ATUAL lido do DOM (fonte da verdade). Um break tem a
                            // classe .pm-page-break-start; sua margem inline é o valor injetado e o
                            // data-attr guarda a margem nativa que ele substituiu.
                            const isBreak = el.classList.contains("pm-page-break-start");
                            const injMargin = isBreak ? (parseFloat(getComputedStyle(el).marginTop) || 0) : 0;
                            const nativeAttr = isBreak ? (parseFloat(el.getAttribute("data-pb-native") || "") || 0) : 0;

                            // O deslocamento REAL que a injeção causou sobre o layout natural é
                            // `injMargin − native` (o margin-top inline SUBSTITUI a margem nativa, não
                            // soma). Subtrair isso — lido do DOM — torna a reconstrução invariante e
                            // sempre consistente com o que está renderizado (sem oscilar nem colapsar
                            // após um split que mapeia/remove a decoration).
                            injAccum += isBreak ? (injMargin - nativeAttr) : 0;

                            const naturalTop = el.offsetTop - injAccum;
                            const h = el.offsetHeight;
                            if (pageTop === null) pageTop = naturalTop;

                            const used = naturalTop - pageTop;   // conteúdo antes dele nesta página
                            const bottom = used + h;

                            // Quebra ANTES dele se estoura a página E não é o primeiro da página
                            // (um parágrafo sozinho maior que a página transborda visualmente —
                            // não quebramos no meio de um parágrafo).
                            if (bottom > CH + EPS && naturalTop > pageTop) {
                                const marginTop = (CH - used) + 2 * MV + PG;
                                if (pos > 0 && marginTop > 0) {
                                    // Margem nativa: se já é break, vem do data-attr (o computed
                                    // devolveria o valor injetado, errado); senão lê do cascade agora
                                    // (parágrafo ainda sem override inline).
                                    const native = isBreak
                                        ? nativeAttr
                                        : (parseFloat(getComputedStyle(el).marginTop) || 0);
                                    breaks.push({ pos, height: Math.round(marginTop), native });
                                    count++;
                                    pageTop = naturalTop;
                                }
                            }
                        }

                        const sig = signature(breaks);
                        if (sig !== lastSig) {
                            lastSig = sig;
                            const decoSet = buildDecoSet(view.state.doc, breaks);
                            view.dispatch(view.state.tr.setMeta(pageBreaksKey, { decorations: decoSet }));
                        }
                        if (count !== lastCount) {
                            lastCount = count;
                            opts.onPageCountChange?.(count);
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
