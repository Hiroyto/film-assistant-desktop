/**
 * exportScreenplayToPdf.ts
 *
 * The Scripts preview's export entry. Layout and drawing live in
 * screenplayExport.ts (Final Draft geometry, single spacing, a blank line
 * between action paragraphs, (MORE)/(CONT'D) splits, Courier-safe text);
 * this only turns the preview's TipTap HTML into typed blocks.
 */

import { blocksFromScreenplayHtml, exportScreenplayPdf } from "./screenplayExport";

/**
 * @param screenplayHTML  Raw HTML from PaginatedEditor.getAllHTML()
 * @param title           Story title, used as the filename
 */
export function exportScreenplayToPdf(
    screenplayHTML: string,
    title: string = "Screenplay",
): void {
    const blocks = blocksFromScreenplayHtml(screenplayHTML);
    if (blocks.length === 0) return;
    void exportScreenplayPdf(blocks, title);
}
