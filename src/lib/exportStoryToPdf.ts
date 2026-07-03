import jsPDF from "jspdf";

type SegmentKey =
    | "S1" | "S2" | "S3"
    | "S4" | "S5" | "S6"
    | "S7" | "S8" | "S9";

type StoryPdfData = Partial<Record<SegmentKey, string>> & {
    title?: string;
    SUM?: string;
};

const segmentOrder: SegmentKey[] = [
    "S1", "S2", "S3",
    "S4", "S5", "S6",
    "S7", "S8", "S9",
];

export const exportStoryToPdf = (
    story: StoryPdfData,
    mode: "acts" | "scenes"
) => {

    const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();

    const marginX = 25;
    const maxWidth = pageWidth - marginX * 2;

    let y = 30;

    const ensurePageSpace = (requiredSpace = 10) => {
        if (y + requiredSpace > pageHeight - 20) {
            doc.addPage();
            y = 30;
        }
    };

    /* =========================
       TITLE
    ========================= */
    const title = story.title || "Story";

    doc.setFont("courier", "bold");
    doc.setFontSize(18);
    doc.text(title, pageWidth / 2, y, { align: "center" });

    y += 20;

    /* =========================
       SYNOPSIS
    ========================= */
    if (story.SUM && story.SUM.trim()) {

        doc.setFont("courier", "bold");
        doc.setFontSize(14);
        doc.text("Synopsis", pageWidth / 2, y, { align: "center" });

        y += 12;

        doc.setFont("courier", "normal");
        doc.setFontSize(11);

        const splitSynopsis = doc.splitTextToSize(
            story.SUM,
            maxWidth
        );

        splitSynopsis.forEach((line: string) => {
            ensurePageSpace(6);
            doc.text(line, marginX, y);
            y += 6;
        });

        y += 16;
    }

    /* =========================
       SEGMENTS
    ========================= */
    const keys: SegmentKey[] = [
        "S1", "S2", "S3",
        "S4", "S5", "S6",
        "S7", "S8", "S9",
    ];

    keys.forEach((key) => {
        const text = story[key];

        if (!text) return;

        // Page break safety
        if (y > 250) {
            doc.addPage();
            y = 30;
        }

        /* SEGMENT TITLE */
        doc.setFont("courier", "bold");
        doc.setFontSize(14);
        doc.text(key, pageWidth / 2, y, { align: "center" });

        y += 12;

        doc.setFont("courier", "normal");
        doc.setFontSize(11);

        if (mode === "acts") {
            const splitText = doc.splitTextToSize(text, maxWidth);

            splitText.forEach((line: string) => {
                if (y > 270) {
                    doc.addPage();
                    y = 30;
                }

                doc.text(line, marginX, y);
                y += 6;
            });

            y += 16;
        }

        if (mode === "scenes") {
            // Split scenes by double line break (how we joined them)
            const scenes = text.split("\n\n");

            scenes.forEach((sceneText, index) => {
                const sceneNumber = `${key}.${index + 1}`;

                const sceneLines = doc.splitTextToSize(
                    `${sceneNumber}\n${sceneText}`,
                    maxWidth
                );

                sceneLines.forEach((line: string) => {
                    if (y > 270) {
                        doc.addPage();
                        y = 30;
                    }

                    doc.text(line, marginX, y);
                    y += 6;
                });

                y += 10;
            });

            y += 10;
        }
    });

    const fileSuffix = mode === "scenes" ? "_scenes" : "_outline";
    doc.save(`${title}${fileSuffix}.pdf`);
};