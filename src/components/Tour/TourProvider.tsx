"use client";

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useRef
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "react-hot-toast";
import { handleTourKeydown } from "../../features/tour/model/tourKeyboard";

export type TourStep = {
    id: string;
    selector: string;
    content: React.ReactNode;
    onEnter?: () => void;
    onExit?: () => void;
};

type TourContextType = {
    startTour: (steps: TourStep[]) => void;
};

export const TourContext = createContext<TourContextType | null>(null);

export const useTour = () => {
    const ctx = useContext(TourContext);
    if (!ctx) throw new Error("useTour must be inside TourProvider");
    return ctx;
};

export const TourProvider = ({
    children
}: {
    children: React.ReactNode;
}) => {
    const [steps, setSteps] = useState<TourStep[]>([]);
    const [currentStep, setCurrentStep] = useState(0);
    const [rect, setRect] = useState<DOMRect | null>(null);
    const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
    const [arrowDirection, setArrowDirection] =
        useState<"up" | "down">("up");
    const [arrowOffset, setArrowOffset] = useState(24);
    const [active, setActive] = useState(false);

    const tooltipRef = useRef<HTMLDivElement | null>(null);

    const startTour = (newSteps: TourStep[]) => {
        setSteps(newSteps);
        setCurrentStep(0);
        setActive(true);
    };

    const closeTour = () => {
        setActive(false);
        setRect(null);
    };

    const nextStep = () => {
        const current = steps[currentStep];
        current?.onExit?.();

        if (currentStep < steps.length - 1) {
            setCurrentStep((prev) => prev + 1);
        } else {
            closeTour();
        }
    };

    useEffect(() => {
        if (active) {
            document.body.classList.add("tour-active");
        } else {
            document.body.classList.remove("tour-active");
        }
    }, [active]);

    useEffect(() => {
        if (!active) return;

        const preventScroll = (e: Event) => {
            e.preventDefault();
        };

        // COD-006 / BR-MIGRAR-040: block the 9 nav keys AND Tab (focus can't escape
        // the tour), and make Escape an explicit "skip tour" with a message.
        const preventScrollKeys = (e: KeyboardEvent) => {
            handleTourKeydown(e, {
                onSkip: () => {
                    closeTour();
                    toast("Tour skipped");
                },
            });
        };

        const originalOverflow = document.body.style.overflow;
        const originalPaddingRight = document.body.style.paddingRight;

        const scrollbarWidth =
            window.innerWidth - document.documentElement.clientWidth;

        // 🔒 trava scroll visual
        document.body.style.overflow = "hidden";
        document.body.style.paddingRight = `${scrollbarWidth}px`;

        // 🔒 bloqueia eventos de scroll
        window.addEventListener("wheel", preventScroll, { passive: false });
        window.addEventListener("touchmove", preventScroll, { passive: false });
        window.addEventListener("keydown", preventScrollKeys);

        return () => {
            document.body.style.overflow = originalOverflow;
            document.body.style.paddingRight = originalPaddingRight;

            window.removeEventListener("wheel", preventScroll);
            window.removeEventListener("touchmove", preventScroll);
            window.removeEventListener("keydown", preventScrollKeys);
        };
    }, [active]);

    useEffect(() => {
        if (!active || !steps[currentStep]) return;

        const step = steps[currentStep];

        const el = document.querySelector(step.selector) as HTMLElement | null;
        if (!el) return;

        step.onEnter?.();

        const updatePosition = () => {
            const r = el.getBoundingClientRect();

            const roundedRect = {
                top: Math.round(r.top),
                left: Math.round(r.left),
                width: Math.round(r.width),
                height: Math.round(r.height),
                bottom: Math.round(r.bottom),
                right: Math.round(r.right),
            };

            setRect(roundedRect as DOMRect);

            const tooltipEl = tooltipRef.current;
            if (!tooltipEl) return;

            const tooltipHeight = tooltipEl.offsetHeight;
            const tooltipWidth = tooltipEl.offsetWidth;

            if (!tooltipHeight || !tooltipWidth) return;

            const padding = 16;

            let top = roundedRect.bottom + 16;
            let left = roundedRect.left;

            let direction: "up" | "down" = "up";

            if (top + tooltipHeight > window.innerHeight - padding) {
                top = roundedRect.top - tooltipHeight - 16;
                direction = "down";
            }

            if (top < padding) {
                top = window.innerHeight / 2 - tooltipHeight / 2;
            }

            if (left + tooltipWidth > window.innerWidth - padding) {
                left = window.innerWidth - tooltipWidth - padding;
            }

            if (left < padding) left = padding;

            const elementCenter =
                roundedRect.left + roundedRect.width / 2;

            let arrowX = elementCenter - left;

            const min = 12;
            const max = tooltipWidth - 12;

            if (arrowX < min) arrowX = min;
            if (arrowX > max) arrowX = max;

            setArrowOffset(arrowX);
            setArrowDirection(direction);
            setTooltipPos({ top, left });
        };

        el.scrollIntoView({ behavior: "auto", block: "center" });

        // 🔥 PRIMEIRO CÁLCULO
        requestAnimationFrame(() => {
            requestAnimationFrame(updatePosition);
        });

        // =========================
        // 🔥 AUTO LAYOUT ENGINE
        // =========================

        // 1️⃣ Resize do elemento alvo
        // 1️⃣ Resize do elemento alvo
        const resizeObserver = new ResizeObserver(() => {
            requestAnimationFrame(updatePosition);
        });
        resizeObserver.observe(el);

        // 2️⃣ Resize global
        const handleResize = () => requestAnimationFrame(updatePosition);
        window.addEventListener("resize", handleResize);

        // 3️⃣ Scroll em qualquer container
        const handleScroll = () => requestAnimationFrame(updatePosition);
        window.addEventListener("scroll", handleScroll, true);


        return () => {
            resizeObserver.disconnect();
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("scroll", handleScroll, true);
        };
    }, [currentStep, steps, active]);

    return (
        <TourContext.Provider value={{ startTour }}>
            {children}

            <AnimatePresence>
                {active && rect && (
                    <>
                        {/* Overlay com recorte */}
                        <motion.div
                            className="fixed inset-0 z-[9990] pointer-events-none"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            style={{
                                backdropFilter: "blur(4px)",
                                background: "rgba(0,0,0,0.5)",
                                clipPath: `
                                polygon(
                                    0% 0%,
                                    100% 0%,
                                    100% 100%,
                                    0% 100%,
                                    0% ${rect.top}px,
                                    ${rect.left}px ${rect.top}px,
                                    ${rect.left}px ${rect.bottom}px,
                                    ${rect.right}px ${rect.bottom}px,
                                    ${rect.right}px ${rect.top}px,
                                    ${rect.left}px ${rect.top}px,
                                    0% ${rect.top}px
                                )
                                `,
                            }}
                        />

                        {/* Spotlight */}
                        <motion.div
                            className="fixed z-[9995] pointer-events-none rounded-xl"
                            animate={{
                                top: rect.top - 8,
                                left: rect.left - 8,
                                width: rect.width + 16,
                                height: rect.height + 16
                            }}
                            transition={{
                                type: "spring",
                                stiffness: 500,
                                damping: 40
                            }}
                            style={{
                                border: "2px solid #ff6b35",
                                boxShadow: "0 0 25px rgba(255,107,53,0.7)"
                            }}
                        />

                        {/* Tooltip */}
                        <motion.div
                            ref={tooltipRef}
                            className="fixed z-[9998]"
                            initial={{ opacity: 0, y: 10 }}
                            animate={{
                                opacity: 1,
                                y: 0,
                                top: tooltipPos.top,
                                left: tooltipPos.left
                            }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                        >
                            <div className="relative px-4 py-4 rounded-lg bg-[rgba(255,108,53,0.15)] border border-[#ff6b35]
                text-[#ff8c42] text-sm font-medium shadow-[0_0_12px_rgba(255,108,53,0.6)]
                backdrop-blur-md flex flex-col items-start max-w-[300px]">

                                {steps[currentStep].content}

                                <button
                                    className="mt-3 px-3 py-1 rounded-lg bg-[#ff6b35] text-black font-semibold hover:bg-[#ff8c42] transition"
                                    onClick={nextStep}
                                >
                                    Next
                                </button>

                                {/* 🔥 Seta inteligente */}
                                <div
                                    className="absolute w-3 h-3 bg-[#ff6b35]"
                                    style={{
                                        left: arrowOffset,
                                        top:
                                            arrowDirection === "up" ? -6 : undefined,
                                        bottom:
                                            arrowDirection === "down" ? -6 : undefined,
                                        transform:
                                            "translateX(-50%) rotate(45deg)"
                                    }}
                                />
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </TourContext.Provider>
    );
};