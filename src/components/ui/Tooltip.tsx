import React, {
    useState,
    useRef,
    useLayoutEffect,
    useMemo,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

type TooltipPosition = "top" | "bottom" | "left" | "right";

interface TooltipProps {
    children: React.ReactNode;
    description: string;
    position?: TooltipPosition;
}

const Tooltip: React.FC<TooltipProps> = ({
    children,
    description,
    position = "right",
}) => {
    const [show, setShow] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    const triggerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!show || !triggerRef.current || !tooltipRef.current) return;

        const trigger = triggerRef.current.getBoundingClientRect();
        const tooltip = tooltipRef.current.getBoundingClientRect();
        const gap = 10;

        let top = 0;
        let left = 0;

        switch (position) {
            case "top":
                top = trigger.top - tooltip.height - gap;
                left = trigger.left + trigger.width / 2 - tooltip.width / 2;
                break;
            case "bottom":
                top = trigger.bottom + gap;
                left = trigger.left + trigger.width / 2 - tooltip.width / 2;
                break;
            case "left":
                top = trigger.top + trigger.height / 2 - tooltip.height / 2;
                left = trigger.left - tooltip.width - gap;
                break;
            case "right":
            default:
                top = trigger.top + trigger.height / 2 - tooltip.height / 2;
                left = trigger.right + gap;
                break;
        }

        setCoords({ top, left });
    }, [show, position]);

    const arrowClasses = useMemo(() => {
        switch (position) {
            case "top":
                return "bottom-[-4px] left-1/2 -translate-x-1/2 rotate-45";
            case "bottom":
                return "top-[-4px] left-1/2 -translate-x-1/2 rotate-45";
            case "left":
                return "right-[-4px] top-1/2 -translate-y-1/2 rotate-45";
            case "right":
            default:
                return "left-[-4px] top-1/2 -translate-y-1/2 rotate-45";
        }
    }, [position]);

    const variants = useMemo(() => {
        const distance = 6;
        switch (position) {
            case "top":
                return {
                    initial: { opacity: 0, y: distance },
                    animate: { opacity: 1, y: 0 },
                    exit: { opacity: 0, y: distance },
                };
            case "bottom":
                return {
                    initial: { opacity: 0, y: -distance },
                    animate: { opacity: 1, y: 0 },
                    exit: { opacity: 0, y: -distance },
                };
            case "left":
                return {
                    initial: { opacity: 0, x: distance },
                    animate: { opacity: 1, x: 0 },
                    exit: { opacity: 0, x: distance },
                };
            case "right":
            default:
                return {
                    initial: { opacity: 0, x: -distance },
                    animate: { opacity: 1, x: 0 },
                    exit: { opacity: 0, x: -distance },
                };
        }
    }, [position]);

    return (
        <>
            <div
                ref={triggerRef}
                className="inline-block"
                onMouseEnter={() => setShow(true)}
                onMouseLeave={() => setShow(false)}
                onFocus={() => setShow(true)}
                onBlur={() => setShow(false)}
            >
                {children}
            </div>

            {createPortal(
                <AnimatePresence>
                    {show && (
                        <motion.div
                            ref={tooltipRef}
                            variants={variants}
                            initial="initial"
                            animate="animate"
                            exit="exit"
                            transition={{ duration: 0.18, ease: "easeOut" }}
                            className="fixed z-[9999] bg-orange text-white text-xs px-3 py-2 rounded-md shadow-lg whitespace-nowrap"
                            style={{ top: coords.top, left: coords.left }}
                        >
                            {description}
                            <div
                                className={`absolute w-2.5 h-2.5 bg-orange shadow-md ${arrowClasses}`}
                            />
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </>
    );
};

export default Tooltip;
