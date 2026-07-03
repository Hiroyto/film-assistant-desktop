import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { confirmAndSignIn, resendCode } from '../../features/auth/model/useAuth';

interface ConfirmCodeModalProps {
    email: string;
    password?: string;
    onBack: () => void;
    onSuccess: () => void;
}

export default function ConfirmCodeModal({
    email,
    password,
    onBack,
    onSuccess
}: ConfirmCodeModalProps) {

    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [resendStatus, setResendStatus] = useState<string | null>(null);
    const [resendCooldown, setResendCooldown] = useState(0);

    const handleConfirm = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            if (!password) throw new Error("MissingPasswordForSignIn");
            // Delegated to features/auth: atomic confirm-then-sign-in (BR-MIGRAR-006)
            // with 6-digit code validation (BR-MIGRAR-004).
            await confirmAndSignIn(email, code, password);
            onSuccess();
        } catch (err: any) {
            console.error("Confirmation/Login error:", err);
            if (err.name === 'CodeMismatchException') {
                setError("Invalid verification code. Please check and try again.");
            } else if (err.name === 'ExpiredCodeException') {
                setError("The verification code has expired. Please request a new code.");
            } else if (err.name === 'LimitExceededException') {
                setError("Attempt limit exceeded. Please try again later.");
            } else {
                setError(err.message || "An error occurred during confirmation.");
            }

        } finally {
            setLoading(false);
        }
    };

    const handleResendCode = async () => {
        if (resendCooldown > 0) return;

        setError(null);
        setResendStatus(null);

        try {
            await resendCode(email); // SQLite-persisted 60s throttle, survives OS sleep (BR-MIGRAR-005)
            setResendCooldown(60);
            const timer = setInterval(() => {
                setResendCooldown(prev => {
                    if (prev <= 1) {
                        clearInterval(timer);
                        setResendStatus(null);
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        } catch (err: any) {
            console.error("Resend error:", err);
            setError(err.message || "Could not resend code. Please wait a moment and try again.");
        }
    };

    return (
        <div className="flex flex-col items-center p-4">
            <h2 className="text-2xl font-bold mb-4 text-center text-white">Confirm Your Account</h2>
            <p className="text-gray-300 mb-6 text-center text-sm">
                A verification code was sent to <span className="font-semibold text-orange">{email}</span>. Please enter it below.
            </p>

            <form onSubmit={handleConfirm}>
                <div className="mb-4">
                    <label htmlFor="code" className="block text-gray-300 text-sm mb-1">Verification Code</label>
                    <input
                        id="code"
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        required
                        placeholder="6-digit code"
                        className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                        maxLength={6}
                    />
                </div>

                {error && (
                    <p className="text-sm text-red-500 bg-red-50 p-3 rounded-md mb-4 border border-red-200">
                        {error}
                    </p>
                )}

                <button
                    type="submit"
                    disabled={loading || code.length < 6}
                    className={`w-full py-3 rounded-md font-semibold text-white transition-all duration-300 ease-in-out shadow-lg 
                            ${loading || code.length < 6
                            ? '"opacity-30 cursor-not-allowed transform-none bg-[rgba(255,107,53,0.15)]'
                            : 'bg-gradient-to-r from-[#ff6b35] to-[#ff8c42] hover:opacity-90 hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(255,107,53,0.4)] transition'
                        }`}
                >
                    {loading ? (
                        <span className="flex items-center justify-center gap-2">
                            <Loader2 className="h-5 w-5 animate-spin" />
                            Confirming...
                        </span>
                    ) : 'Confirm Account'}
                </button>
            </form>
            <div className="mt-6 text-center w-full">
                {resendStatus && (
                    <p className={`text-xs p-2 rounded-md mb-3 ${resendStatus.includes("sent") ? 'text-green-400' : 'text-red-400'}`}>
                        {resendStatus}
                    </p>
                )}

                <button
                    onClick={handleResendCode}
                    disabled={loading || resendCooldown > 0}
                    className={`text-sm font-medium transition-colors 
                        ${loading || resendCooldown > 0
                            ? 'text-gray-500 cursor-not-allowed'
                            : 'text-gray-300 hover:text-orange-400'
                        }`}
                >
                    {resendCooldown > 0
                        ? `Resend in ${resendCooldown}s`
                        : "Didn't receive the code? Resend"
                    }
                </button>

                <button
                    onClick={onBack}
                    className="text-sm font-medium text-gray-500 hover:text-gray-400 block mt-3 mx-auto"
                >
                    Back to Login/Sign Up
                </button>
            </div>

        </div>

    );
}