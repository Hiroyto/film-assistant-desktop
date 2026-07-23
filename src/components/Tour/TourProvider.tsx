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
import { ExploreOnOwn } from "./ExploreOnOwn";

export type TourStep = {
    id: string;
    selector: string;
    content: React.ReactNode;
    onEnter?: () => void;
    onExit?: () => void;
    /** Hide the built-in "Next" button — for beats that advance on an external
     *  event (e.g. the wow flow advancing on braindump_complete / peer_stream_done).
     *  The orchestrator drives advancement via next()/endTour(). */
    hideNext?: boolean;
    /** Custom label for the advance button (default "Next"). */
    nextLabel?: string;
    /** 'side' places the tooltip beside the target (right, or left if no room)
     *  instead of below/above — so it doesn't cover a large target like a bento
     *  tile. Default is below/above. */
    placement?: 'auto' | 'side';
    /** Custom spotlight rect, overriding the `selector` element's bounds — used
     *  to highlight a REGION (e.g. two character cards + the space between for the
     *  relationship beat). Returns null while its inputs aren't on screen yet (the
     *  engine retries). Re-read every frame, so it tracks as the cards move. */
    getRect?: () => DOMRect | null;
    /** Where to align the target when scrolling it into view. Default 'center';
     *  use 'start' to jump the target to the TOP of its scroll container (e.g.
     *  bring the Information section to the top of the right panel). */
    scrollBlock?: ScrollLogicalPosition;
};

export type StartTourOptions = {
    /** Lock body scroll while the tour runs. Default true (static-page tours).
     *  The corkboard wow passes false so the canvas stays pannable. */
    lockScroll?: boolean;
    /** When set, every tooltip shows an "I'll explore on my own" opt-out that
     *  ends the tour and calls this (the wow uses it to mark itself seen). */
    onSkip?: () => void;
};

type TourContextType = {
    startTour: (steps: TourStep[], opts?: StartTourOptions) => void;
    /** Advance to the next step (ends the tour if on the last). For event-driven tours. */
    next: () => void;
    /** End the tour immediately. */
    endTour: () => void;
    /** Whether a tour is currently active. */
    active: boolean;
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
        useState<"up" | "down" | "left" | "right">("up");
    const [arrowOffset, setArrowOffset] = useState(24);
    const [active, setActive] = useState(false);
    const [lockScroll, setLockScroll] = useState(true);
    const [onSkip, setOnSkip] = useState<(() => void) | null>(null);
    // Bumped to re-run the position effect while waiting for a target element
    // that hasn't mounted yet (wow cards still animating in).
    const [retryTick, setRetryTick] = useState(0);

    const tooltipRef = useRef<HTMLDivElement | null>(null);
    // Tracks which step index has already had onEnter fired, so it runs exactly
    // once per step — and crucially BEFORE the target lookup, so a step's onEnter
    // can create its own target (e.g. open the right panel).
    const enteredStepRef = useRef<number>(-1);

    const startTour = (newSteps: TourStep[], opts?: StartTourOptions) => {
        setSteps(newSteps);
        setCurrentStep(0);
        enteredStepRef.current = -1;
        setLockScroll(opts?.lockScroll !== false);
        setOnSkip(() => opts?.onSkip ?? null);
        setActive(true);
    };

    const closeTour = () => {
        setActive(false);
        setRect(null);
        setOnSkip(null);
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

    // Step back WITHOUT firing onExit — orchestrators use onExit as the
    // advance/commit hook (the wow flow's phase transitions live there), so
    // firing it on Back derails their state machines and can leave the card
    // gate stuck. The previous step's onEnter re-fires on revisit
    // (enteredStepRef compares against the CURRENT index), so a step that
    // opens its own target rebuilds it.
    const prevStep = () => {
        if (currentStep === 0) return;
        setCurrentStep((prev) => prev - 1);
    };

    useEffect(() => {
        if (active) {
            document.body.classList.add("tour-active");
        } else {
            document.body.classList.remove("tour-active");
        }
    }, [active]);

    // Reset the target-element retry budget whenever the step changes.
    useEffect(() => {
        setRetryTick(0);
    }, [currentStep, active]);

    useEffect(() => {
        if (!active || !lockScroll) return;

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
    }, [active, lockScroll]);

    useEffect(() => {
        if (!active || !steps[currentStep]) return;

        const step = steps[currentStep];

        // Fire onEnter once per step, BEFORE the target lookup, so a step can
        // open/create its own target (e.g. the right panel) and the retry below
        // then finds it. Clear the previous step's spotlight immediately so a
        // step whose target isn't found yet never shows a stale highlight.
        if (enteredStepRef.current !== currentStep) {
            enteredStepRef.current = currentStep;
            setRect(null);
            step.onEnter?.();
        }

        const hasCustomRect = typeof step.getRect === 'function';
        const el = document.querySelector(step.selector) as HTMLElement | null;
        const customRect = hasCustomRect ? step.getRect!() : null;
        if ((hasCustomRect && !customRect) || (!hasCustomRect && !el)) {
            // Target (element or custom-rect inputs) may still be mounting /
            // animating in (wow cards stream in after braindump_complete; the
            // panel opens via onEnter). Retry.
            if (retryTick < 25) {
                const t = window.setTimeout(() => setRetryTick((n) => n + 1), 120);
                return () => window.clearTimeout(t);
            }
            return;
        }

        const updatePosition = () => {
            const r = hasCustomRect ? step.getRect!() : el!.getBoundingClientRect();
            if (!r) return;

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

            // Side placement — beside the target (right, or left if no room),
            // vertically centered. Keeps the tooltip OFF the target (e.g. a big
            // bento tile we're explaining).
            if (step.placement === 'side') {
                const gap = 16;
                let sideLeft = roundedRect.right + gap;
                let dir: 'left' | 'right' = 'left'; // tooltip on the right → arrow points left at the tile
                if (sideLeft + tooltipWidth > window.innerWidth - padding) {
                    sideLeft = roundedRect.left - tooltipWidth - gap; // place on the left instead
                    dir = 'right';
                }
                sideLeft = Math.max(padding, Math.min(sideLeft, window.innerWidth - tooltipWidth - padding));
                let sideTop = roundedRect.top + roundedRect.height / 2 - tooltipHeight / 2;
                sideTop = Math.max(padding, Math.min(sideTop, window.innerHeight - tooltipHeight - padding));
                const elemMidY = roundedRect.top + roundedRect.height / 2;
                let arrowY = elemMidY - sideTop;
                arrowY = Math.max(12, Math.min(arrowY, tooltipHeight - 12));
                setArrowOffset(arrowY);
                setArrowDirection(dir);
                setTooltipPos({ top: sideTop, left: sideLeft });
                return;
            }

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

        el?.scrollIntoView({ behavior: "auto", block: step.scrollBlock ?? "center" });

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
        if (el) resizeObserver.observe(el);

        // 2️⃣ Resize global
        const handleResize = () => requestAnimationFrame(updatePosition);
        window.addEventListener("resize", handleResize);

        // 3️⃣ Scroll em qualquer container
        const handleScroll = () => requestAnimationFrame(updatePosition);
        window.addEventListener("scroll", handleScroll, true);

        // Continuous tracking — keeps the spotlight glued to its target even when
        // the element MOVES without a scroll/resize event (corkboard cards glide
        // on peer-focus, grow on expand, balls stick, etc.).
        let rafId = window.requestAnimationFrame(function tick() {
            updatePosition();
            rafId = window.requestAnimationFrame(tick);
        });

        return () => {
            window.cancelAnimationFrame(rafId);
            resizeObserver.disconnect();
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("scroll", handleScroll, true);
        };
    }, [currentStep, steps, active, retryTick]);

    return (
        <TourContext.Provider value={{ startTour, next: nextStep, endTour: closeTour, active }}>
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

                                {/* Step counter — a tiny kicker above the content so it
                                    never squeezes the button row. */}
                                {steps.length > 1 && (
                                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider select-none text-[rgba(255,176,137,0.6)]">
                                        Step {currentStep + 1} of {steps.length}
                                    </div>
                                )}

                                {steps[currentStep].content}

                                {/* Footer: Back (from step 2 on) + Next. Buttons keep
                                    their label on one line; a long Next wraps below Back. */}
                                {(currentStep > 0 || !steps[currentStep].hideNext) && (
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                        {currentStep > 0 && (
                                            <button
                                                className="px-3 py-1 rounded-lg border border-[rgba(255,107,53,0.5)] text-[#ff8c42] font-semibold hover:bg-[rgba(255,107,53,0.15)] transition whitespace-nowrap"
                                                onClick={prevStep}
                                            >
                                                Back
                                            </button>
                                        )}
                                        {!steps[currentStep].hideNext && (
                                            <button
                                                className="px-3 py-1 rounded-lg bg-[#ff6b35] text-black font-semibold hover:bg-[#ff8c42] transition whitespace-nowrap"
                                                onClick={nextStep}
                                            >
                                                {steps[currentStep].nextLabel ?? "Next"}
                                            </button>
                                        )}
                                    </div>
                                )}

                                {onSkip && (
                                    <div className="mt-2">
                                        <ExploreOnOwn
                                            color="rgba(255,176,137,0.65)"
                                            onClick={() => { const fn = onSkip; closeTour(); fn?.(); }}
                                        />
                                    </div>
                                )}

                                {/* 🔥 Seta inteligente — up/down (offset = horizontal)
                                    or left/right for side placement (offset = vertical). */}
                                <div
                                    className="absolute w-3 h-3 bg-[#ff6b35]"
                                    style={
                                        arrowDirection === "left" || arrowDirection === "right"
                                            ? {
                                                  top: arrowOffset,
                                                  left: arrowDirection === "left" ? -6 : undefined,
                                                  right: arrowDirection === "right" ? -6 : undefined,
                                                  transform: "translateY(-50%) rotate(45deg)",
                                              }
                                            : {
                                                  left: arrowOffset,
                                                  top: arrowDirection === "up" ? -6 : undefined,
                                                  bottom: arrowDirection === "down" ? -6 : undefined,
                                                  transform: "translateX(-50%) rotate(45deg)",
                                              }
                                    }
                                />
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>
        </TourContext.Provider>
    );
};