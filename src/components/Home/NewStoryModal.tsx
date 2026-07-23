import React, { useEffect, useState } from "react";
import { motion, AnimatePresence, easeOut } from "framer-motion";

export type StoryWorkflow = 'outline' | 'freeform';

interface NewStoryModalAppleProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: {
        title: string;
        primaryGenre: string;
        secondaryGenre?: string;
        theme: string;
        /** Which pathway this story lives in: the structured outline editor
         *  (/home) or the freeform corkboard (/freeform/:storyId). */
        workflow: StoryWorkflow;
    }) => void;
}

const GENRES = [
    "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
    "Mystery", "Romance", "Sci-Fi", "Thriller", "Crime", "Historical", "Biography"
];

export default function NewStoryModalApple({
    isOpen,
    onClose,
    onSubmit,
}: NewStoryModalAppleProps) {

    const [title, setTitle] = useState("");
    const [primaryGenre, setPrimaryGenre] = useState("");
    const [secondaryGenre, setSecondaryGenre] = useState("");
    const [theme, setTheme] = useState("");
    const [workflow, setWorkflow] = useState<StoryWorkflow>('freeform');

    useEffect(() => {
        if (isOpen) {
            setTitle("");
            setPrimaryGenre("");
            setSecondaryGenre("");
            setTheme("");
            setWorkflow('freeform');
        }
    }, [isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({
            title,
            primaryGenre,
            secondaryGenre: secondaryGenre || undefined,
            theme,
            workflow,
        });
        onClose();
    };

    const WORKFLOWS: Array<{ id: StoryWorkflow; name: string; blurb: string; recommended?: boolean }> = [
        { id: 'freeform', name: 'Corkboard', blurb: 'Freeform canvas: braindump, cards, and a writing peer.', recommended: true },
        { id: 'outline', name: 'Outline Template', blurb: 'A fixed story outline surface for writers looking for structure.' },
    ];

    const modalVariants = {
        hidden: { opacity: 0, y: 8, scale: 0.995 },
        visible: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: 6, scale: 0.995 },
    };

    const fieldVariants = {
        hidden: { opacity: 0, y: -4 },
        visible: { opacity: 1, y: 0 }
    };

    const transition = { duration: 0.28, ease: easeOut };

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 z-[9999] flex items-center justify-center"
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                >
                    <motion.div
                        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
                        variants={{
                            hidden: { opacity: 0 },
                            visible: { opacity: 1 },
                            exit: { opacity: 0 }
                        }}
                        transition={transition}
                        onClick={onClose}
                    />

                    <motion.div
                        className="relative w-[92vw] max-w-lg rounded-xl shadow-xl overflow-hidden border border-[#ff8c42]/30 bg-gradient-to-br from-bgdark1 to-bgdark2 p-6"
                        variants={modalVariants}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        transition={transition}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h2 className="text-white text-2xl font-semibold mb-1">
                            Create New Story
                        </h2>
                        <p className="text-[#ff8c42]/80 text-sm mb-5">
                            Start a new screenplay
                        </p>

                        <form onSubmit={handleSubmit}>
                            <motion.div
                                className="space-y-4"
                                initial="hidden"
                                animate="visible"
                                exit="hidden"
                                transition={{ staggerChildren: 0.025 }} //
                            >
                                <motion.div variants={fieldVariants} transition={transition}>
                                    <label className="block text-sm text-[#ff8c42] mb-2 font-medium">
                                        Workflow
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        {WORKFLOWS.map((w) => {
                                            const active = workflow === w.id;
                                            return (
                                                <button
                                                    key={w.id}
                                                    type="button"
                                                    onClick={() => setWorkflow(w.id)}
                                                    className={
                                                        'text-left rounded-xl px-4 py-3 border-2 transition-all duration-200 ' +
                                                        (active
                                                            ? 'border-[#ff6b35] bg-[#ff6b35]/15 shadow-[0_0_16px_rgba(255,107,53,0.18)]'
                                                            : 'border-[#ff8c42]/25 bg-black/30 hover:border-[#ff8c42]/50')
                                                    }
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <div className={'font-semibold text-sm ' + (active ? 'text-[#ff8c42]' : 'text-white/85')}>
                                                            {w.name}
                                                        </div>
                                                        {w.recommended && (
                                                            <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#ff6b35]/20 text-[#ff8c42] border border-[#ff6b35]/40">
                                                                Recommended
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-white/40 mt-1 leading-snug">
                                                        {w.blurb}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </motion.div>

                                <motion.div variants={fieldVariants} transition={transition}>
                                    <label className="block text-sm text-[#ff8c42] mb-1 font-medium">
                                        Title <span className="text-[#ff8c42]/60">(optional)</span>
                                    </label>
                                    <input
                                        value={title}
                                        onChange={(e) => setTitle(e.target.value)}
                                        placeholder="Story title..."
                                        autoFocus
                                        className="w-full px-5 py-4 rounded-xl bg-black/40 border-2 border-[#ff8c42]/50 text-white text-lg placeholder-white/30 
                                        outline-none
                                        focus:border-[#ff8c42] focus:shadow-[0_0_20px_rgba(255,140,66,0.15)]
                                        transition-all duration-300"
                                    />

                                    <p className="mt-2 text-xs text-white/20">
                                        Leave this empty and we’ll generate a title automatically.
                                    </p>
                                </motion.div>

                                {/* 
                                <motion.div variants={fieldVariants} transition={transition} className="grid grid-cols-1 md:grid-cols-2 gap-4">

                                    <div>
                                        <label className="block text-sm text-[#ff8c42] mb-1 font-medium">
                                            Primary Genre
                                        </label>
                                        <select
                                            value={primaryGenre}
                                            onChange={(e) => setPrimaryGenre(e.target.value)}
                                            className="w-full px-3 py-2 rounded-md bg-[#ff6b35]/10 border border-[#ff8c42]/30 text-white focus:ring-2 
                                            focus:ring-[#ff6b35]/30 focus:border-[#ff6b35]"
                                        >
                                            <option value="">Select...</option>
                                            {GENRES.map((g) => (
                                                <option key={g} value={g} className="bg-black text-white">
                                                    {g}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm text-[#ff8c42] mb-1 font-medium">
                                            Secondary Genre (optional)
                                        </label>
                                        <select
                                            value={secondaryGenre}
                                            onChange={(e) => setSecondaryGenre(e.target.value)}
                                            className="w-full px-3 py-2 rounded-md bg-[#ff6b35]/10 border border-[#ff8c42]/30 text-white
                                            focus:ring-2 focus:ring-[#ff6b35]/30 focus:border-[#ff6b35]"
                                        >
                                            <option value="">None</option>
                                            {GENRES.map((g) => (
                                                <option key={g} value={g} className="bg-black text-white">
                                                    {g}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </motion.div>

                                <motion.div variants={fieldVariants} transition={transition}>
                                    <label className="block text-sm text-[#ff8c42] mb-1 font-medium">
                                        Theme
                                    </label>
                                    <input
                                        value={theme}
                                        onChange={(e) => setTheme(e.target.value)}
                                        placeholder="Central theme..."
                                        className="w-full px-3 py-2 rounded-md bg-[#ff6b35]/10 border border-[#ff8c42]/30 text-white placeholder-white/40 
                                        focus:ring-2 focus:ring-[#ff6b35]/30 focus:border-[#ff6b35]"
                                    />
                                </motion.div> */}

                                <motion.div variants={fieldVariants} transition={transition} className="flex justify-end gap-3 pt-2 mt-2">
                                    <button
                                        type="button"
                                        onClick={onClose}
                                        className="px-4 py-2 rounded-md border border-[#ff8c42]/30 text-[#ff8c42]
                                        hover:bg-[#ff8c42]/10 transition"
                                    >
                                        Cancel
                                    </button>

                                    <button
                                    type="submit"
                                    className="px-5 py-2.5 rounded-lg text-white font-medium
                                    bg-gradient-to-r from-[#ff6b35] to-[#ff8c42]
                                    hover:from-[#ff7b45] hover:to-[#ff9c52]
                                    hover:-translate-y-[2px] hover:shadow-[0_8px_24px_rgba(255,107,53,0.4)]
                                    active:translate-y-0 active:shadow-[0_2px_8px_rgba(255,107,53,0.3)]
                                    transition-all duration-200"
                                >
                                    Create Story
                                </button>
                                </motion.div>
                            </motion.div>
                        </form>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
