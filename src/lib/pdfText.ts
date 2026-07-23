// src/lib/pdfText.ts
// Client-side PDF text extraction via pdfjs-dist. The module is dynamically
// imported by callers so it stays out of the main bundle, and the worker is
// pulled from the CDN at the exact installed version to avoid bundler
// worker-config friction (CRA/craco). Returns plain text; scanned/image-only
// PDFs yield little or nothing (no OCR) — callers should handle a short result.
export async function parsePdfToText(
  file: File,
  onProgress?: (page: number, total: number) => void,
): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Respect pdfjs end-of-line markers so screenplay structure (sluglines,
    // dialogue) survives instead of collapsing into one run of words.
    const line = content.items
      .map((it) => {
        if (!('str' in it)) return '';
        const item = it as { str: string; hasEOL?: boolean };
        return item.str + (item.hasEOL ? '\n' : ' ');
      })
      .join('');
    pages.push(line);
    onProgress?.(i, pdf.numPages);
  }

  return pages
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
