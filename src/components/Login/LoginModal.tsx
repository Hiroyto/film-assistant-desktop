import React, { useState } from "react";
import ConfirmCodeModal from "./ConfirmCodeModal"
import { resendSignUpCode, getCurrentUser } from "aws-amplify/auth";
import { signInUser } from "../../features/auth/model/useAuth";

interface LoginFormProps {
    onSwitch: () => void;
    onSuccess: (email: string, password: string) => void;
    onForgotPassword: () => void;
}

export default function LoginForm({ onSwitch, onSuccess, onForgotPassword }: LoginFormProps) {
    const [step, setStep] = useState<"signin" | "confirm">("signin");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [user, setUser] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [code, setCode] = useState("");
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [isVisible, setVisible] = useState(true);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            // Delegated to features/auth (single source for Cognito sign-in, BR-MIGRAR-001).
            const { nextStep, isSignedIn } = await signInUser(email, password);

            if (isSignedIn) {
                const current = await getCurrentUser();
                setUser(current);
            } else {
                console.log("Next step:", nextStep);
                if (nextStep.signInStep === 'CONFIRM_SIGN_UP') {
                    await resendSignUpCode({ username: email });
                    onSuccess(email, password);
                    return {
                        success: false,
                        reason: 'USER_NOT_CONFIRMED',
                        next: 'confirm',
                        message: 'Account not confirmed. We have resent the code.'
                    };
                }
            }

        } catch (err: any) {
            console.error(err);
            if (err.name === 'UserNotConfirmedException') {
                console.warn("User not confirmed. Resending code...");
                await resendSignUpCode({ username: email });
                onSuccess(email, password);
                return {
                    success: false,
                    reason: 'USER_NOT_CONFIRMED',
                    next: 'confirm',
                    message: 'Account not confirmed. We have resent the code.'
                };
            } else if (err.name === 'NotAuthorizedException' || err.name === 'UserNotFoundException') {
                setError("Invalid username or password.");
            } else {
                setError(err.message || "Login failed");
            }

        } finally {
            setLoading(false);
        }
    };

    return (
        <div >
            <h2 className="text-2xl font-bold text-white text-center mb-6">
                Sign in
            </h2>
            <form onSubmit={handleLogin} className="space-y-5">
                <div>
                    <label className="block text-gray-300 text-sm mb-1">Email</label>
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                        placeholder="yourname@example.com" />
                </div>

                <div className="relative pb-4">
                    <label className="block text-gray-300 text-sm mb-1">Password</label>
                    <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                        placeholder="••••••••" />
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 bottom-[53px] text-gray-400 hover:text-white"
                    >
                        {showPassword ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width='1.5em' height='1.5em'><path fill="currentColor" d="M2 5.27L3.28 4L20 20.72L18.73 22l-3.08-3.08c-1.15.38-2.37.58-3.65.58c-5 0-9.27-3.11-11-7.5c.69-1.76 1.79-3.31 3.19-4.54zM12 9a3 3 0 0 1 3 3a3 3 0 0 1-.17 1L11 9.17A3 3 0 0 1 12 9m0-4.5c5 0 9.27 3.11 11 7.5a11.8 11.8 0 0 1-4 5.19l-1.42-1.43A9.86 9.86 0 0 0 20.82 12A9.82 9.82 0 0 0 12 6.5c-1.09 0-2.16.18-3.16.5L7.3 5.47c1.44-.62 3.03-.97 4.7-.97M3.18 12A9.82 9.82 0 0 0 12 17.5c.69 0 1.37-.07 2-.21L11.72 15A3.064 3.064 0 0 1 9 12.28L5.6 8.87c-.99.85-1.82 1.91-2.42 3.13" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width='1.5em' height='1.5em'><path fill="currentColor" d="M12 9a3 3 0 0 1 3 3a3 3 0 0 1-3 3a3 3 0 0 1-3-3a3 3 0 0 1 3-3m0-4.5c5 0 9.27 3.11 11 7.5c-1.73 4.39-6 7.5-11 7.5S2.73 16.39 1 12c1.73-4.39 6-7.5 11-7.5M3.18 12a9.821 9.821 0 0 0 17.64 0a9.821 9.821 0 0 0-17.64 0" /></svg>
                        )}
                    </button>
                    <div className="text-right mt-1">
                        <button
                            type="button"
                            onClick={onForgotPassword}
                            className="text-sm text-gray-400 hover:text-[#ff6b35] transition"
                        >
                            Forgot your password?
                        </button>
                    </div>
                </div>

                {error && <p className="text-red-400 text-sm">{error}</p>}

                <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2 mt-3 rounded-lg bg-gradient-to-r from-[#ff6b35] to-[#ff8c42] text-white font-semibold hover:opacity-90 hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(255,107,53,0.4)] transition"
                >
                    {loading
                        ? (
                            <span className="flex items-center justify-center">
                                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                                    xmlns="http://www.w3.org/2000/svg"
                                    fill="none"
                                    viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Signing in...
                            </span>
                        )
                        : 'Sign In'}
                </button>
            </form>

            <div className="flex items-center my-5">
                <div className="flex-grow h-px bg-[rgba(255,255,255,0.15)]" />
                <span className="text-gray-400 text-sm px-2">or</span>
                <div className="flex-grow h-px bg-[rgba(255,255,255,0.15)]" />
            </div>

            <button onClick={onSwitch} className="w-full py-2 rounded-lg border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.1)] hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(255,255,255,0.05)] transition">
                Create an account
            </button>
        </div>
    )
}
