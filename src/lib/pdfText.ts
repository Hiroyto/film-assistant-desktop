// src/lib/pdfText.ts
// Client-side PDF text extraction via pdfjs-dist. The module is dynamically
// imported by callers so it stays out of the main bundle, and the worker is
// pulled from the CDN at the exact installed version to avoid bundler
// worker-config friction (CRA/craco). Scanned/image-only PDFs yield little or
// nothing (no OCR) — callers should handle a short result.
//
// LAYER 0 of the screenplay parser (lib/screenplayParse.ts): positions are the
// signal. Each text run's x/y ride into physical-line grouping, page-furniture
// stripping (numbers/CONTINUED in the margin bands), and indent columns
// ENCODED INTO the returned text as leading spaces + blank lines for vertical
// gaps. The result is the ONE canonical text: braindump prose, source spans,
// and the element classifier all read the same string, and the layout signal
// survives because it is the text.
import { pdfPagesToIndentedText, type PdfPageItems } from './screenplayParse';

// Structure roles that are one paragraph of text. A TAGGED PDF (Google Docs,
// Word, Chrome print) marks every paragraph in its structure tree; geometry
// cannot see a paragraph break with zero spacing, the tags can.
const PARA_ROLES = new Set(['P', 'H', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'LBody', 'Lbl', 'Caption', 'Title', 'BlockQuote']);

/** Marked-content id -> paragraph key, from the page's structure tree. */
function paragraphOfContent(tree: any, pageIndex: number): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  const walk = (node: any, para: string | null) => {
    if (!node) return;
    if (node.type === 'content' && node.id) {
      if (para) out.set(node.id, para);
      return;
    }
    const here = node.role && PARA_ROLES.has(node.role) ? `${pageIndex}:${n++}` : para;
    for (const c of node.children ?? []) walk(c, here);
  };
  walk(tree, null);
  return out;
}

export async function parsePdfToText(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<string> {
  // LEGACY build (main AND worker): embute os polyfills core-js, então roda em
  // qualquer Chromium que o shell venha a usar; os dois lados precisam casar.
  // O subpath legacy reexporta a API pública do entrypoint principal (ver a
  // declaração em src/custom.d.ts), então os tipos batem carregando o legacy.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.min.mjs');
  // Worker servido do PRÓPRIO app (public/pdf.worker.min.mjs, copiado de
  // node_modules pelo craco.config.js a cada start/build) — nunca de um CDN:
  // código remoto no renderer teria acesso a window.electronAPI, e a CSP do
  // desktop (script-src 'self') não permitiria mesmo.
  pdfjs.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  // pdf.js ≥ 6.2.108 (GHSA de execução de JS via PDF malicioso corrigido) e sem o
  // antigo caminho de `new Function` para fontes (isEvalSupported foi removido).
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  return pdfPagesToIndentedText(await pagesFromPdf(pdf, onProgress));
}

/** Positioned items per page, each run tagged with its paragraph when the
 *  PDF carries a structure tree. Separate from the file read so the import
 *  eval runs this exact code on pdf.js's node build. */
export async function pagesFromPdf(
  pdf: { numPages: number; getPage: (i: number) => Promise<any> },
  onProgress?: (page: number, total: number) => void,
): Promise<PdfPageItems[]> {
  const pages: PdfPageItems[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent({ includeMarkedContent: true });
    // Untagged PDFs (Final Draft, most screenplay apps, our own export) have
    // no tree; their items simply carry no paragraph and geometry decides.
    let paraOf = new Map<string, string>();
    try { paraOf = paragraphOfContent(await page.getStructTree(), i); } catch { /* untagged */ }
    const open: Array<string | null> = [];
    const items: PdfPageItems['items'] = [];
    for (const it of content.items as any[]) {
      if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') {
        open.push(it.id ? paraOf.get(it.id) ?? null : null);
        continue;
      }
      if (it.type === 'endMarkedContent') { open.pop(); continue; }
      if (!('str' in it)) continue;
      const para = [...open].reverse().find((x) => x) ?? undefined;
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, ...(para ? { para } : {}) });
    }
    pages.push({ width: vp.width, height: vp.height, items });
    onProgress?.(i, pdf.numPages);
  }
  return pages;
}
