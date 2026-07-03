import { TourStep } from "./TourProvider";

type CreateTourStepsParams = {
  setMenuOpen: (value: boolean) => void;
};

export const createTourSteps = ({
  setMenuOpen,
}: CreateTourStepsParams): TourStep[] => [
    {
      id: "storyBrainstorming",
      selector: "#storyBrainstorming",
      content: (
        <>
          <div className="font-semibold text-base">
            Creating your story
          </div>

          <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
            Getting started is easy! Just write your story idea in the
            “Story Brainstorming” field. When you’re ready, click
            “Process into Synopsis” and we’ll turn your idea into a
            synopsis for you.
          </div>
        </>
      )
    },
    {
      id: "storySummary",
      selector: "#storySummary",
      content: (
        <>
          <div className="font-semibold text-base">
            Prefer full control?
          </div>

          <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
            If you prefer, you can also write your story free-hand,
            typing it out yourself and shaping it in your own way.
          </div>
        </>
      )
    },
    {
      id: "generateButton",
      selector: "#generateButton",
      content: (
        <>
          <div className="font-semibold text-base">
            Feeling stuck? No worries
          </div>

          <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
            If you need help, each field gives you the option to generate
            that part of the story on its own.
          </div>
        </>
      )
    },
    {
      id: "canvasButton",
      selector: "#canvasButton",
      content: (
        <>
          <div className="font-semibold text-base">
            Revise Specific Lines or Get Suggestions
          </div>

          <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
            Didn’t like any of the generated text or unsure about a specific section? Open Canvas Mode.
          </div>
        </>
      ),
    },
    // {
    //   id: "canvasButton",
    //   selector: "#canvasButton",
    //   content: (
    //     <>
    //       <div className="font-semibold text-base">
    //         Edit specific lines
    //       </div>

    //       <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
    //         Didn’t like any of the generated text or unsure about a specific section? Open Canvas Mode.
    //       </div>
    //     </>
    //   ),
    //   onEnter: () => {
    //     onOpenCanvas('SUM');
    //   }
    // },
    {
      id: "generateStory",
      selector: "#generateStory",
      content: (
        <>
          <div className="font-semibold text-base">
            Looking for more?
          </div>

          <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
            Scroll to the end of the page and click “Generate Story” to
            create all Acts based on your synopsis.
          </div>
        </>
      )
    },
    // {
    //   id: "actsPreview",
    //   selector: "#actsPreview",
    //   content: (
    //     <>
    //       <div className="font-semibold text-base">
    //         Ready to wrap things up?
    //       </div>

    //       <div className="mt-1 text-sm text-[#ffb089] leading-relaxed">
    //         From the floating menu, select “Acts Preview” to read your
    //         complete story. Use distraction-free mode in the top-right
    //         corner, or export your story as a PDF to move into production.
    //       </div>
    //     </>
    //   ),
    //   onEnter: () => {
    //     setMenuOpen(true);
    //   }
    // }
  ];