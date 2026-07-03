// tourSteps.ts

import type { TourStep } from "./TourProvider";

export const tourSteps: TourStep[] = [
    {
        id: "generateScenes",
        selector: "#generateScenes",
        content: (
            <>
                <div className="font-semibold text-base">
                    Start write your scenes
                </div>

                <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
                    Getting started is easy! Click “Generate Scenes” to
                    create all Scenes based on your segment.
                </div>
            </>
        )
    },
    // {
    //     id: "storySummary",
    //     selector: "#storySummary",
    //     content: (
    //         <>
    //             <div className="font-semibold text-base">
    //                 Prefer full control?
    //             </div>

    //             <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
    //                 If you prefer, you can also write your story free-hand,
    //                 typing it out yourself and shaping it in your own way.
    //             </div>
    //         </>
    //     )
    // },
    // {
    //     id: "generateButton",
    //     selector: "#generateButton",
    //     content: (
    //         <>
    //             <div className="font-semibold text-base">
    //                 Feeling stuck? No worries
    //             </div>

    //             <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
    //                 If you need help, each field gives you the option to generate
    //                 that part of the story on its own.
    //             </div>
    //         </>
    //     )
    // },
    // {
    //     id: "generateStory",
    //     selector: "#generateStory",
    //     content: (
    //         <>
    //             <div className="font-semibold text-base">
    //                 Looking for more?
    //             </div>

    //             <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
    //                 Scroll to the end of the page and click “Generate Story” to
    //                 create all Acts based on your synopsis.
    //             </div>
    //         </>
    //     )
    // },
    // {
    //     id: "acts-preview",
    //     selector: "#acts-preview",
    //     content: (
    //         <>
    //             <div className="font-semibold text-base">
    //                 Ready to wrap things up? ACTS PREVIEW
    //             </div>

    //             <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
    //                 From the floating menu, select “Acts Preview” to read your
    //                 complete story. Use distraction-free mode in the top-right
    //                 corner, or export your story as a PDF to move into production.
    //             </div>
    //         </>
    //     )
    // }
];