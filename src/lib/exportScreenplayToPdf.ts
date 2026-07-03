/**
 * exportScreenplayToPdf.ts
 * 
 * Exports a TipTap screenplay HTML string to a properly-formatted PDF
 * using jsPDF with letter paper (8.5 × 11 in).
 *
 * Mirrors the industry-standard screenplay format:
 *   - Courier New 12pt throughout
 *   - 1-inch margins on all sides (left margin 1.5in for binding)
 *   - Character cue indented to ~3.7in from left edge
 *   - Dialogue block 2.5in–6.0in (3.5in wide)
 *   - Parenthetical 3.1in–5.4in (2.3in wide)
 *   - Transition flush right
 *   - Scene heading (slugline) full width, uppercase, bold
 *   - Description full width
 *
 * All measurements below are in jsPDF "mm" units (letter = 215.9 × 279.4 mm).
 */

import jsPDF from "jspdf";

// ─── Letter page geometry (mm) ───────────────────────────────────────────────

const PAGE_W = 215.9;  // 8.5 in
const PAGE_H = 279.4;  // 11 in

// Standard screenplay margins
const MARGIN_TOP = 25.4;  // 1 in
const MARGIN_BOTTOM = 25.4;  // 1 in
const MARGIN_LEFT = 38.1;  // 1.5 in
const MARGIN_RIGHT = 25.4;  // 1 in

const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT;  // ~152.4 mm (6 in)
const CONTENT_H = PAGE_H - MARGIN_TOP - MARGIN_BOTTOM; // ~228.6 mm (9 in)

// Font size
const FONT_SIZE = 12;   // pt
const LINE_HEIGHT = 6.35; // mm ≈ 12pt × 1.5 line-height at 25.4mm/in

// Indents from the LEFT MARGIN (not from page edge)
// Screenplay spec uses positions from the left page edge:
//   description: 1.5in left → offset 0 from MARGIN_LEFT
//   character:   3.7in left → offset 2.2in = 55.9mm
//   dialogue:    2.5in left → offset 1.0in = 25.4mm;  right at 6.0in → maxW 3.5in = 88.9mm
//   parenthetical: 3.1in left → offset 1.6in = 40.6mm; right at 5.4in → maxW 2.3in = 58.4mm
//   transition:  flush right (right edge = 7.5in from left page = 6.0in from MARGIN_LEFT)

const INDENT: Record<string, { left: number; maxWidth: number; align?: "left" | "right" }> = {
    scene: { left: 0, maxWidth: CONTENT_W },
    description: { left: 0, maxWidth: CONTENT_W },
    character: { left: 55.9, maxWidth: CONTENT_W - 55.9 },
    dialogue: { left: 25.4, maxWidth: 88.9 },
    parenthetical: { left: 40.6, maxWidth: 58.4 },
    transition: { left: 0, maxWidth: CONTENT_W, align: "right" },
};

// Vertical spacing before each line type (mm added BEFORE the block)
const SPACE_BEFORE: Record<string, number> = {
    scene: LINE_HEIGHT * 2,   // 2 blank lines before slugline
    description: 0,
    character: LINE_HEIGHT,       // 1 blank line before character cue
    dialogue: 0,
    parenthetical: 0,
    transition: LINE_HEIGHT * 1.5,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse the raw HTML into an ordered list of {lineType, text, sceneId} */
interface ScreenplayLine {
    lineType: string;
    text: string;
    sceneId?: string;
}

function parseScreenplayHTML(html: string): ScreenplayLine[] {
    if (!html) return [];
    const div = document.createElement("div");
    div.innerHTML = html;
    const paragraphs = Array.from(div.querySelectorAll("p")) as HTMLElement[];

    return paragraphs.map(p => ({
        lineType: p.getAttribute("data-line-type") || "description",
        text: p.textContent?.trim() ?? "",
        sceneId: p.getAttribute("data-scene-id") ?? undefined,
    })).filter(l => l.text.length > 0);
}

// ─── Main export function ─────────────────────────────────────────────────────

/**
 * exportScreenplayToPdf
 *
 * @param screenplayHTML  Raw HTML from PaginatedEditor.getAllHTML()
 * @param title           Story title — used as filename and first-page header
 */
export function exportScreenplayToPdf(
    screenplayHTML: string,
    title: string = "Screenplay",
): void {
    const lines = parseScreenplayHTML(screenplayHTML);
    if (lines.length === 0) return;

    const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "letter",
    });

    doc.setFont("courier", "normal");
    doc.setFontSize(FONT_SIZE);

    let y = MARGIN_TOP;
    let pageNum = 1;

    // ── Page-number header (top right, from page 2 onwards) ─────────────────
    const stampPageNumber = () => {
        if (pageNum === 1) return; // Title page or first page — no number
        doc.setFont("courier", "normal");
        doc.setFontSize(FONT_SIZE);
        doc.text(
            `${pageNum}.`,
            PAGE_W - MARGIN_RIGHT,
            MARGIN_TOP - 6.35,
            { align: "right" }
        );
    };

    const addPage = () => {
        doc.addPage();
        pageNum++;
        y = MARGIN_TOP;
        stampPageNumber();
        doc.setFont("courier", "normal");
        doc.setFontSize(FONT_SIZE);
    };

    // ── Ensure there is room for at least `needed` mm; add page if not ──────
    const ensureSpace = (needed: number) => {
        if (y + needed > MARGIN_TOP + CONTENT_H) addPage();
    };

    // ── Title block ──────────────────────────────────────────────────────────
    const cleanTitle = title.trim() || "Screenplay";
    const titleY = PAGE_H / 2 - 10;

    doc.setFont("courier", "bold");
    doc.setFontSize(14);
    doc.text(cleanTitle.toUpperCase(), PAGE_W / 2, titleY, { align: "center" });

    doc.setFont("courier", "normal");
    doc.setFontSize(FONT_SIZE);
    doc.text("Written with filmassistant.io", PAGE_W / 2, titleY + 12, { align: "center" });

    // Start screenplay content on page 2
    addPage();

    // ── Render each line ─────────────────────────────────────────────────────
    for (let i = 0; i < lines.length; i++) {
        const { lineType, text } = lines[i];

        const indent = INDENT[lineType] ?? INDENT.description;
        const spaceBefore = SPACE_BEFORE[lineType] ?? 0;

        // Apply space-before (respecting page breaks)
        if (spaceBefore > 0 && y > MARGIN_TOP) {
            // Don't add space at the very top of a page
            ensureSpace(spaceBefore + LINE_HEIGHT);
            y += spaceBefore;
        }

        // Set font weight — scene headings are bold
        const isBold = lineType === "scene";
        doc.setFont("courier", isBold ? "bold" : "normal");
        doc.setFontSize(FONT_SIZE);

        const xPos = MARGIN_LEFT + indent.left;

        // Transition: uppercase, right-aligned
        if (lineType === "transition") {
            ensureSpace(LINE_HEIGHT);
            doc.text(
                text.toUpperCase(),
                MARGIN_LEFT + CONTENT_W,
                y,
                { align: "right" }
            );
            y += LINE_HEIGHT;
            continue;
        }

        // Scene heading: uppercase
        const displayText = lineType === "scene" || lineType === "character"
            ? text.toUpperCase()
            : text;

        // Wrap text to maxWidth
        const wrapped = doc.splitTextToSize(displayText, indent.maxWidth);

        for (const wrappedLine of wrapped) {
            ensureSpace(LINE_HEIGHT);
            doc.text(wrappedLine, xPos, y);
            y += LINE_HEIGHT;
        }

        // Scene headings get a blank line after them
        if (lineType === "scene") {
            y += LINE_HEIGHT * 0.5;
        }
    }

    // ── Save ─────────────────────────────────────────────────────────────────
    const filename = cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");

    doc.save(`${filename}_screenplay.pdf`);
}