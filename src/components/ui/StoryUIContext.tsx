import { createContext, useContext, useState, useCallback } from "react";

export type StoryChangeSource = "auto" | "user";

type StoryUIContextType = {
    storyChangeSource: StoryChangeSource;
    setStoryChangeSource: (source: StoryChangeSource) => void;
};

const StoryUIContext = createContext<StoryUIContextType | null>(null);

export function StoryUIProvider({ children }: { children: React.ReactNode }) {
    const [storyChangeSource, setStoryChangeSource] =
        useState<StoryChangeSource>("auto");

    return (
        <StoryUIContext.Provider
            value={{ storyChangeSource, setStoryChangeSource }}
        >
            {children}
        </StoryUIContext.Provider>
    );
}

export function useStoryUI() {
    const ctx = useContext(StoryUIContext);
    if (!ctx) {
        throw new Error("useStoryUI must be used within StoryUIProvider");
    }
    return ctx;
}
