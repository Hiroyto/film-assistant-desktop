import React from 'react';
import StoryCard from './StoryCard';
import { Story } from './StoryCard.types';
import { ChevronsRightLeft } from 'lucide-react';
import { resolveStoryWorkflow } from '../../lib/storyWorkflows';

interface StoryGridProps {
    works?: Record<string, Story>; // 👈 agora pode ser undefined
    onNavigateStory: (storyId: string) => void;
    onDeleteStory: (storyId: string) => void;
    loading?: boolean;
}

const StoryGrid: React.FC<StoryGridProps> = ({
    works,
    onDeleteStory,
    onNavigateStory,
    loading = false,
}) => {

    const placeholderCount = 4;

    const getStoryDisplayData = (story: Story) => {
        if (!story) return null;

        const isFreeform = resolveStoryWorkflow(story as any, story.storyId) === 'freeform';
        return {
            title: story.title || "Untitled Story",
            // Freeform stories badge as Corkboard (they carry no outline genre).
            genre: isFreeform ? 'Corkboard' : (story.G || "No Genre"),
            summary: isFreeform
                ? (story.SUM || "Freeform corkboard story")
                : (story.SUM || "No summary available"),
            lastModified: story.lastModified
                ? new Date(story.lastModified).toLocaleDateString("en-US")
                : ""
        };
    };

    // ============================================
    // 🔄 LOADING STATE
    // ============================================
    if (loading) {
        return (
            <div className="grid grid-cols-[repeat(auto-fill,_minmax(250px,_1fr))] lg:grid-cols-[repeat(auto-fill,_minmax(280px,_1fr))] gap-6">
                {Array.from({ length: placeholderCount }).map((_, idx) => (
                    <div
                        key={idx}
                        className="bg-glassBg rounded-[12px] p-7 animate-pulse"
                    >
                        <div className="h-6 bg-gray-500 rounded w-3/4 mb-4"></div>
                        <div className="h-6 bg-gray-500 rounded w-full mb-1"></div>
                        <div className="h-4 bg-gray-500 rounded w-2/3"></div>
                    </div>
                ))}
            </div>
        );
    }

    // ============================================
    // ⏳ STILL INITIALIZING (works undefined)
    // ============================================
    if (works === undefined) {
        return null;
    }

    // ============================================
    // 📭 EMPTY STATE (after load)
    // ============================================
    if (Object.keys(works).length === 0) {
        return (
            <p className="text-sm text-white/60 text-center py-10">
                No stories available.
            </p>
        );
    }

    // ============================================
    // 📚 STORIES GRID
    // ============================================
    return (
        <div
            className="
                grid
                grid-cols-[repeat(auto-fill,_minmax(200px,_1fr))]
                sm:grid-cols-[repeat(auto-fill,_minmax(250px,_1fr))]
                lg:grid-cols-[repeat(auto-fill,_minmax(280px,_1fr))]
                gap-6
            "
        >
            {Object.keys(works).map((storyId) => {
                const story = works[storyId];
                const displayData = getStoryDisplayData(story);
                if (!displayData) return null;

                return (
                    <StoryCard
                        key={story.storyId}
                        title={displayData.title}
                        category={displayData.genre}
                        lastModified={displayData.lastModified}
                        description={displayData.summary}
                        onClick={() => onNavigateStory(story.storyId)}
                        onDelete={() => onDeleteStory(story.storyId)}
                    />
                );
            })}
        </div>
    );
};

export default StoryGrid;