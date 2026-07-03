import React, { useState } from "react";
import { resetPassword, confirmResetPassword } from "aws-amplify/auth";

interface ForgotPasswordModalProps {
    onBackToLogin: () => void;
}

export default function ForgotPasswordModal({ onBackToLogin }: ForgotPasswordModalProps) {
    const [step, setStep] = useState<"request" | "submit">("request");
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const handleRequestCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            await resetPassword({
                username: email,
            });

            setStep("submit");
            setSuccessMessage("verification_sent");

        } catch (err: any) {
            console.error("Forgot password error:", err);
            switch (err.name) {
                case "UserNotFoundException":
                    setError("User not found.");
                    break;
                case "LimitExceededException":
                    setError("Too many attempts. Please try again later.");
                    break;
                case "InvalidParameterException":
                    setError("Invalid email.");
                    break;
                default:
                    setError("Failed to request reset. Please try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    const handleSubmitNewPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccessMessage(null);
        setLoading(true);

        try {
            await confirmResetPassword({
                username: email,
                newPassword,
                confirmationCode: code,
            });

            setSuccessMessage("Password successfully reset! Redirecting to login...");
            setTimeout(onBackToLogin, 3000);

        } catch (err: any) {
            console.error("Reset password error:", err);
            switch (err.name) {
                case "CodeMismatchException":
                    setError("Incorrect code.");
                    break;
                case "ExpiredCodeException":
                    setError("Code expired. Please request a new one.");
                    break;
                case "InvalidPasswordException":
                    setError("Password does not meet the security requirements.");
                    break;
                default:
                    setError("Failed to reset password. Please check your details and try again.");
            }
        } finally {
            setLoading(false);
        }
    };

    const renderSuccessMessage = () => {
        if (step === "submit" && successMessage === "verification_sent") {
            return (
                <p className="text-green-400 text-sm mb-4">
                    A verification code was sent to{' '}
                    <span className="font-semibold text-orange-400">
                        {email}
                    </span>
                    . Please enter it below.
                </p>
            );
        }
        if (successMessage) {
            return <p className="text-green-400 text-sm mb-4">{successMessage}</p>;
        }
        return null;
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-white text-center mb-6">
                {step === "request" ? "Reset Password" : "Enter Code & New Password"}
            </h2>

            {renderSuccessMessage()}
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}

            {step === "request" && (
                <form onSubmit={handleRequestCode} className="space-y-5">
                    <div>
                        <label className="block text-gray-300 text-sm mb-1">Email</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                            placeholder="yourname@example.com"
                            required
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !email}
                        className="w-full py-2 rounded-lg bg-gradient-to-r from-[#ff6b35] to-[#ff8c42] text-white font-semibold hover:opacity-90 hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(255,107,53,0.4)] transition"
                    >
                        {loading ? "Sending Code..." : "Send Reset Code"}
                    </button>

                    <button
                        type="button"
                        onClick={onBackToLogin}
                        className="w-full text-gray-400 text-sm mt-3 hover:text-[#ff6b35] transition"
                    >
                        &larr; Back to Sign In
                    </button>
                </form>
            )}

            {step === "submit" && (
                <form onSubmit={handleSubmitNewPassword} className="space-y-5">
                    <div>
                        <label className="block text-gray-300 text-sm mb-1">Confirmation Code</label>
                        <input
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                            placeholder="123456"
                            required
                        />
                    </div>
                    <div className="relative">
                        <label className="block text-gray-300 text-sm mb-1">New Password</label>
                        <input
                            type={showPassword ? "text" : "password"}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                            placeholder="••••••••"
                            required
                        />
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 bottom-[10px] text-gray-400 hover:text-white"
                        >
                            {showPassword ? (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width='1.5em' height='1.5em'><path fill="currentColor" d="M2 5.27L3.28 4L20 20.72L18.73 22l-3.08-3.08c-1.15.38-2.37.58-3.65.58c-5 0-9.27-3.11-11-7.5c.69-1.76 1.79-3.31 3.19-4.54zM12 9a3 3 0 0 1 3 3a3 3 0 0 1-.17 1L11 9.17A3 3 0 0 1 12 9m0-4.5c5 0 9.27 3.11 11 7.5a11.8 11.8 0 0 1-4 5.19l-1.42-1.43A9.86 9.86 0 0 0 20.82 12A9.82 9.82 0 0 0 12 6.5c-1.09 0-2.16.18-3.16.5L7.3 5.47c1.44-.62 3.03-.97 4.7-.97M3.18 12A9.82 9.82 0 0 0 12 17.5c.69 0 1.37-.07 2-.21L11.72 15A3.064 3.064 0 0 1 9 12.28L5.6 8.87c-.99.85-1.82 1.91-2.42 3.13" /></svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width='1.5em' height='1.5em'><path fill="currentColor" d="M12 9a3 3 0 0 1 3 3a3 3 0 0 1-3 3a3 3 0 0 1-3-3a3 3 0 0 1 3-3m0-4.5c5 0 9.27 3.11 11 7.5c-1.73 4.39-6 7.5-11 7.5S2.73 16.39 1 12c1.73-4.39 6-7.5 11-7.5M3.18 12a9.821 9.821 0 0 0 17.64 0a9.821 9.821 0 0 0-17.64 0" /></svg>
                            )}
                        </button>
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !code || !newPassword}
                        className="w-full py-2 rounded-lg bg-gradient-to-r from-[#ff6b35] to-[#ff8c42] text-white font-semibold hover:opacity-90 transition"
                    >
                        {loading ? "Resetting..." : "Set New Password"}
                    </button>

                    <button
                        type="button"
                        onClick={onBackToLogin}
                        className="w-full text-gray-400 text-sm mt-3 hover:text-[#ff6b35] transition"
                    >
                        &larr; Back to Sign In
                    </button>
                </form>
            )}
        </div>
    );
}