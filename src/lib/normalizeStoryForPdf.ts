// src/lib/normalizeStoryForPdf.ts

export type SegmentKey =
    | "S1" | "S2" | "S3"
    | "S4" | "S5" | "S6"
    | "S7" | "S8" | "S9";

export interface SegmentObject {
    S?: string;
    scenes?: {
        sceneId: string;
        metadata?: Record<string, unknown>;
        title?: string;
        content?: string;
    }[];
}

export type StoryInput = Partial<
    Record<SegmentKey, string | SegmentObject>
> & {
    title?: string;
    SUM?: string | SegmentObject;
};

export type StoryPdfData = Partial<
    Record<SegmentKey, string>
> & {
    title?: string;
    SUM?: string;
};

export type NormalizeMode = "acts" | "scenes";

function extractActsText(
    segment: string | SegmentObject | undefined
): string {
    if (typeof segment === "string") {
        return segment.trim();
    }

    if (
        segment &&
        typeof segment === "object" &&
        typeof segment.S === "string"
    ) {
        return segment.S.trim();
    }

    return "";
}

function extractScenesText(
    segment: string | SegmentObject | undefined
): string {

    if (!segment || typeof segment !== "object") {
        return "";
    }

    if (Array.isArray(segment.scenes) && segment.scenes.length > 0) {
        const scenesText = segment.scenes
            .map(scene => {
                const title = scene.title?.trim();
                const content = scene.content?.trim();

                if (!content) return "";

                return title
                    ? `${title}\n${content}`
                    : content;
            })
            .filter(Boolean)
            .join("\n\n");

        if (scenesText.trim()) {
            return scenesText;
        }
    }

    return "";
}

export function normalizeStoryForPdf(
    story: StoryInput,
    mode: NormalizeMode
): StoryPdfData {

    const result: StoryPdfData = {
        title: story.title?.trim() ?? "",
        SUM: "",
    };

    const keys: SegmentKey[] = [
        "S1", "S2", "S3",
        "S4", "S5", "S6",
        "S7", "S8", "S9",
    ];

    keys.forEach((key) => {
        const segment = story[key];
        console.log("tste")

        if (mode === "acts") {
            result[key] = extractActsText(segment);
            console.log("CENAS ACTS: ", extractActsText(segment))
        }

        if (mode === "scenes") {
            result[key] = extractScenesText(segment);
            console.log("CENAS SCENES: ", extractScenesText(segment))
        }
    });

    // Normalize synopsis
    const sum = story.SUM;

    if (typeof sum === "string") {
        result.SUM = sum.trim();
    } else if (
        sum &&
        typeof sum === "object" &&
        typeof sum.S === "string"
    ) {
        result.SUM = sum.S.trim();
    }

    return result;
}