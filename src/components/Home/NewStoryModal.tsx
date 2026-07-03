import React, { useEffect, useState } from "react";
import { motion, AnimatePresence, easeOut } from "framer-motion";

interface NewStoryModalAppleProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (data: {
        title: string;
        primaryGenre: string;
        secondaryGenre?: string;
        theme: string;
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

    useEffect(() => {
        if (isOpen) {
            setTitle("");
            setPrimaryGenre("");
            setSecondaryGenre("");
            setTheme("");
        }
    }, [isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({
            title,
            primaryGenre,
            secondaryGenre: secondaryGenre || undefined,
            theme,
        });
        onClose();
    };

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
