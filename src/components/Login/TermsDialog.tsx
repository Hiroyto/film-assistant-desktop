import React, { useEffect, useRef, useState } from 'react';

interface TermsAndConditionsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const Spinner: React.FC = () => (
    <div className="w-10 h-10 border-4 border-gray-200 border-t-blue-500 rounded-full animate-spin"></div>
);

const TermsAndConditionsModal: React.FC<TermsAndConditionsModalProps> = ({
    isOpen,
    onClose,
}) => {

    const [termsLoaded, setTermsLoaded] = useState(false);
    const termsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setTermsLoaded(false);

            const scriptId = "getterms-embed-js";
            let observer: MutationObserver | null = null;


            const existingScript = document.getElementById(scriptId);
            if (existingScript) existingScript.remove();

            const script = document.createElement("script");
            script.src = "https://app.getterms.io/dist/js/embed.js";
            script.id = scriptId;

            script.onload = () => {
                const target = termsRef.current?.querySelector(".getterms-document-embed");
                if (target) {
                    observer = new MutationObserver((mutations) => {
                        for (const mutation of mutations) {
                            if (mutation.addedNodes.length > 0) {
                                setTermsLoaded(true);
                                observer?.disconnect();
                                break;
                            }
                        }
                    });
                    observer.observe(target, { childList: true, subtree: true });
                }
            };

            document.body.appendChild(script);

            return () => {
                observer?.disconnect();
                const existing = document.getElementById(scriptId);
                if (existing) existing.remove();
            };
        }
    }, [isOpen]);

    if (!isOpen) {
        return null;
    }

    return (
        <div
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4 transition-opacity duration-300"
            onClick={onClose}
        >

            <div
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-lg shadow-2xl w-full mx-auto max-w-[900px] max-h-[80vh] 
                           transform transition-all duration-300 scale-100 flex flex-col"
            >
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-bold">Terms and Conditions</h2>

                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-700 transition"
                        aria-label="Fechar"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                </div>

                <div ref={termsRef} className="relative flex-grow overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-gray-500 scrollbar-track-white scrollbar-thumb:rounded-full">
                    <div
                        className={`flex justify-center items-center 
                        transition-all duration-500 
                        ${!termsLoaded
                                ? 'opacity-100 min-h-[500px]'
                                : 'opacity-0 h-0 overflow-hidden absolute inset-0'}`
                        }
                    >
                        <Spinner />
                    </div>
                    <div
                        className={`h-full overflow-y-auto
                            [&_a]:text-blue-600 [&_a]:underline [&_a]:hover:text-blue-800 
                    ${termsLoaded ? 'opacity-100' : 'opacity-0 h-0'}`}
                    >
                        <div
                            className="getterms-document-embed"
                            data-getterms="RRt2r"
                            data-getterms-document="tos"
                            data-getterms-styles="true"
                            data-getterms-lang="en-us"
                            data-getterms-mode="direct"
                        />
                    </div>
                </div>

                <div className="flex justify-end p-4 border-t">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-semibold rounded-lg transition-colors bg-orange text-white hover:bg-[#ff8c42]"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TermsAndConditionsModal;