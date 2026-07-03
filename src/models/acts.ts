export type SegmentStats = {
    scenesCount: number;
};

export type ActStats = {
    totalScenes: number;
    progressPercentage: number;
};

export type ActChild = {
    id: string;
    label: string;
    targetId: string;
    stats?: SegmentStats;
};

export interface SceneItem {
    id: string;
    label: string;
}

export interface SegmentItem {
    id: string;
    label: string;
    targetId?: string;
    stats?: SegmentStats;
    scenes?: SceneItem[];
}

export type ActItem = {
    id: string;
    label: string;
    stats?: ActStats;
    children: SegmentItem[];
};
// models/scenes.ts

export interface Scene {
    sceneId: string;
    title: string;
    content: string;
    isExpanded?: boolean;
    metadata?: Record<string, any>;
}

export interface SegmentWithScenes {
    id: string;
    title: string;
    content?: string;
    scenes: Scene[];
    isSelected?: boolean;
    act: number;
    description: string;
}

