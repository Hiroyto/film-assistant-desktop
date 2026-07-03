import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, HelpCircle, X, Image as ImageIcon } from "lucide-react";
import { tutorialSteps } from "../../models/tutorialSteps";

export type StoryStep = {
    id: number;
    title: string;
    description: string;
    image?: string;
};

type StoryTutorialProps = {
    steps?: StoryStep[];
    isOpen: boolean;
    onClose: () => void;
};


export default function StoryTutorialModal({
    steps = tutorialSteps,
    isOpen,
    onClose,
}: StoryTutorialProps) {
    const [currentStep, setCurrentStep] = useState(0);

    const step = steps[currentStep];
    const isFirst = currentStep === 0;
    const isLast = currentStep === steps.length - 1;

    function next() {
        if (!isLast) setCurrentStep((s) => s + 1);
    }

    function previous() {
        if (!isFirst) setCurrentStep((s) => s - 1);
    }

    return (
        <AnimatePresence>
            {isOpen && (
                <motion.div
                    className="fixed inset-0 z-[9999] w-screen h-screen flex items-center justify-center bg-black/70 backdrop-blur-md"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                >
                    <motion.div
                        className="w-full max-w-2xl mx-4 rounded-xl shadow-xl p-6 border border-[#ff6b35]/20 bg-[linear-gradient(135deg,#1a1a1a_0%,#0e0e0e_100%)] text-white"
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                    >
                        <div className="flex items-center justify-between mb-5">
                            <div className="flex items-center gap-2 text-[#ff6b35] font-semibold text-xl">
                                <HelpCircle className="w-6 h-6" />
                                Help Tutorial
                            </div>

                            <button
                                onClick={onClose}
                                className="text-white/70 hover:text-white transition"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>

                        <h3 className="text-lg font-semibold text-[#ff8c42] mb-2">
                            Step {step.id}: {step.title}
                        </h3>

                        {step.image ? (
                            <img
                                src={step.image}
                                alt="Help"
                                className="w-full rounded-lg border border-[#ff8c42]/30 mb-4"
                            />
                        ) : (
                            <div className="w-full h-40 flex items-center justify-center rounded-lg border border-[#ff8c42]/30 mb-4 bg-white/5">
                                <ImageIcon className="w-10 h-10 text-[#ff6b35]" />
                            </div>
                        )}

                        <p className="text-white/80 leading-relaxed mb-6">
                            {step.description}
                        </p>


                        <div className="flex justify-between">
                            <button
                                onClick={previous}
                                disabled={isFirst}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border border-[#ff6b35]/40 transition ${isFirst
                                    ? "opacity-40 cursor-not-allowed"
                                    : "hover:bg-[#ff6b35]/20"
                                    }`}
                            >
                                <ArrowLeft className="w-5 h-5" /> Previous
                            </button>

                            <button
                                onClick={isLast ? onClose : next}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#ff6b35] hover:bg-[#ff8c42] transition text-black font-semibold"
                            >
                                {isLast ? "Finish" : "Next"}
                                {!isLast && <ArrowRight className="w-5 h-5" />}
                            </button>
                        </div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
