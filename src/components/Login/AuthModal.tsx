import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import LoginForm from "./LoginModal";
import SignupForm from "./SignupModal";
import ConfirmCodeModal from "./ConfirmCodeModal";
import TermsAndConditionsModal from "./TermsDialog";
import ForgotPasswordModal from "./ForgotPasswordModal";

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type AuthView = "login" | "signup" | "confirmCode" | "forgotPassword";

export default function AuthModal({ isOpen, onClose }: AuthModalProps) {
    const [view, setView] = useState<AuthView>("login");
    const [email, setEmail] = useState<string>("");
    const [passwordToLogin, setPasswordToLogin] = useState<string>("");

    const [isTermsOpen, setIsTermsOpen] = useState(false);

    const handleConfirmEmail = (userEmail: string, userPassword?: string) => {
        setEmail(userEmail);
        setPasswordToLogin(userPassword || "");
        setView("confirmCode");
    };

    const handleBackToForm = () => {
        setView("login");
        setEmail("");
        setPasswordToLogin("");
    };

    const handleGoToForgotPassword = () => {
        setView("forgotPassword");
    };

    const handleOpenTerms = () => {
        setIsTermsOpen(true);
    };

    const handleCloseTerms = () => {
        setIsTermsOpen(false);
    };


    let content;
    let componentKey: string;

    if (view === "confirmCode") {
        content = (
            <ConfirmCodeModal
                email={email}
                password={passwordToLogin}
                onBack={handleBackToForm}
                onSuccess={onClose}
            />
        );
        componentKey = "confirmCode";
    }
    else if (view === "forgotPassword") {
        content = (
            <ForgotPasswordModal
                onBackToLogin={handleBackToForm}
            />
        );
        componentKey = "forgotPassword";
    }
    else {
        content = view === "login" ? (
            <LoginForm
                onSwitch={() => setView("signup")}
                onSuccess={handleConfirmEmail}
                onForgotPassword={handleGoToForgotPassword}
            />
        ) : (
            <SignupForm
                onSwitch={() => setView("login")}
                onSuccess={handleConfirmEmail}
                onOpenTerms={handleOpenTerms}
            />
        );
        componentKey = view;
    }

    return (
        <>
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                    // onClick={onClose}
                    >
                        <motion.div
                            className="relative bg-[rgba(255,107,53,0.08)] backdrop-blur-lg border border-[rgba(255,140,66,0.3)] rounded-2xl shadow-2xl p-8 w-full max-w-md mx-4 overflow-hidden"
                            initial={{ y: 40, opacity: 0, scale: 0.95 }}
                            animate={{ y: 0, opacity: 1, scale: 1 }}
                            exit={{ y: 40, opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.25 }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                onClick={onClose}
                                className="absolute top-3 right-3 text-gray-400 hover:text-white transition"
                            >
                                ✕
                            </button>

                            <AnimatePresence mode="wait">
                                <motion.div
                                    key={componentKey} // Usamos a chave dinâmica
                                    initial={{ opacity: 0, rotateY: 90 }}
                                    animate={{ opacity: 1, rotateY: 0 }}
                                    exit={{ opacity: 0, rotateY: -90 }}
                                    transition={{ duration: 0.4 }}
                                >
                                    {content}
                                </motion.div>
                            </AnimatePresence>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
            <TermsAndConditionsModal
                isOpen={isTermsOpen}
                onClose={handleCloseTerms}
            />
        </>
    );
}