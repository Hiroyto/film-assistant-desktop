import { StoryStep } from "../components/Home/StoryTutorialModal";
import writing from "../assets/images/tutorial/writing (2).gif"
import storyBrainstorming from "../assets/images/tutorial/storyBrainstorming.png"
import generateContent from "../assets/images/tutorial/generateContent.png"
import generateStory from "../assets/images/tutorial/generateStory.png"
import preview from "../assets/images/tutorial/preview.png"

export const tutorialSteps: StoryStep[] = [
    {
        id: 1,
        title: "Creating your story",
        description:
            "Getting started is easy! Just write your story idea in the “Story Brainstorming” field. When you’re ready, click “Process into Synopsis” and we’ll turn your idea into a synopsis for you.",
        image: storyBrainstorming,
    },
    {
        id: 2,
        title: "Prefer full control?",
        description:
            "If you prefer, you can also write your story free-hand, typing it out yourself and shaping it in your own way.",
        image: writing,
    },
    {
        id: 3,
        title: "Feeling stuck? No worries",
        description:
            "If you need help, each field gives you the option to generate that part of the story on its own",
        image: generateContent,
    },
    {
        id: 4,
        title: "Looking for more?",
        description:
            "Scroll to the end of the page and click “Generate Story” to create all Acts based on your synopsis.",
        image: generateStory,
    },
    {
        id: 5,
        title: "Ready to wrap things up?",
        description:
            "From the floating menu, select “Acts Preview” to read your complete story. Use distraction-free mode in the top-right corner (next to the X), or export your story as a PDF to move into production.",
        image: preview,
    },
];