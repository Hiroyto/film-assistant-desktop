export type CommandGroup =
    | 'Navigation'
    | 'Scenes'
    | 'AI'
    | 'Canvas'
    | 'Command UI';

export type Command = {
    id: string;
    label: string;
    keywords?: string[];
    group: CommandGroup;
    run: () => void;
};
