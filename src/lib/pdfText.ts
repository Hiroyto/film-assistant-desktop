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

export async function parsePdfToText(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  const pages: PdfPageItems[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({
      width: vp.width,
      height: vp.height,
      items: content.items.flatMap((it) => {
        if (!('str' in it)) return [];
        const item = it as { str: string; width: number; transform: number[] };
        return [{ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width }];
      }),
    });
    onProgress?.(i, pdf.numPages);
  }

  return pdfPagesToIndentedText(pages);
}
