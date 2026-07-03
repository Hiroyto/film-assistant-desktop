import React, { useEffect, useState } from "react";
import TermsAndConditionsModal from "./TermsDialog";
import ConfirmCodeModal from "./ConfirmCodeModal"
import { getCurrentUser, resendSignUpCode, signUp, signIn, confirmSignUp, type SignUpInput } from "aws-amplify/auth";

interface SignupFormProps {
    onSwitch: () => void;
    onSuccess: (email: string, password: string) => void;
    onOpenTerms: () => void;
}

export default function SignupForm({ onSwitch, onSuccess, onOpenTerms }: SignupFormProps) {
    const [step, setStep] = useState<"signup" | "confirm">("signup");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [username, setUsername] = useState("");
    const [loading, setLoading] = useState(false);
    const [code, setCode] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [showValidation, setShowValidation] = useState(false);

    const requirements = [
        { label: "At least 8 characters", test: /.{8,}/ },
        { label: "At least one uppercase letter", test: /[A-Z]/ },
        { label: "At least one lowercase letter", test: /[a-z]/ }, // BR-MIGRAR-002 (was missing — Cognito enforces it)
        { label: "At least one number", test: /[0-9]/ },
        { label: "At least one symbol", test: /[^A-Za-z0-9]/ },
    ];

    const allRequirementsMet = requirements.every((req) => req.test.test(password));
    const passwordsMatch = password === confirmPassword && password.length > 0;
    const isFormValid = allRequirementsMet && passwordsMatch;

    const unmetRequirements = requirements.filter(
        (req) => !req.test.test(password)
    );

    const handleSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (!isChecked) {
            setError("You must accept the terms before continuing.");
            return;
        }

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setLoading(true);
        try {
            const { nextStep } = await signUp({
                username: email,
                password,
                options: {
                    userAttributes: {
                        email,
                        preferred_username: username,
                    },
                },
            } as SignUpInput);

            console.log("Signup successful:", nextStep);
            onSuccess(email, password);
        } catch (err: any) {
            if (err.code === 'UsernameExistsException' || err.name === 'UsernameExistsException') {
                try {
                    await resendSignUpCode({ username: email });
                    onSuccess(email, password);
                    return { success: false, reason: 'USERNAME_EXISTS_RESENT', next: 'confirm' };
                } catch (resendErr: any) {
                    console.error('resendSignUp error', resendErr);
                    if (resendErr.code === 'NotAuthorizedException' || resendErr.name === 'NotAuthorizedException') {
                        return { success: false, reason: 'ALREADY_CONFIRMED', next: 'signIn' };
                    }
                    return { success: false, reason: 'RESEND_FAILED', error: resendErr };
                }
            }
            return { success: false, reason: 'OTHER', error: err };
        } finally {
            setLoading(false);
        }
    };
    const [isChecked, setIsChecked] = useState(false);

    const handleChange = (e: { target: { checked: boolean | ((prevState: boolean) => boolean); }; }) => {
        setIsChecked(e.target.checked);
    };

    return (
        <div className="">
            <h2 className="text-2xl font-bold text-white text-center mb-6">
                Create your account
            </h2>
            <form onSubmit={handleSignUp} className="space-y-5">
                <div>
                    <label className="block text-gray-300 text-sm mb-1">Email</label>
                    <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                        placeholder="yourname@example.com"
                    />
                </div>

                <div className="relative">
                    <label className="block text-gray-300 text-sm mb-1">Password</label>
                    <input
                        type={showPassword ? "text" : "password"}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={() => setShowValidation(true)}
                        onBlur={() => setShowValidation(false)}
                        className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                        placeholder="••••••••"
                    />
                    <button
                        type="button"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setShowPassword(!showPassword);
                        }}
                        className="absolute right-3 bottom-[10px] text-gray-400 hover:text-white"
                    >
                        {showPassword ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width='1.5em' height='1.5em'><path fill="currentColor" d="M2 5.27L3.28 4L20 20.72L18.73 22l-3.08-3.08c-1.15.38-2.37.58-3.65.58c-5 0-9.27-3.11-11-7.5c.69-1.76 1.79-3.31 3.19-4.54zM12 9a3 3 0 0 1 3 3a3 3 0 0 1-.17 1L11 9.17A3 3 0 0 1 12 9m0-4.5c5 0 9.27 3.11 11 7.5a11.8 11.8 0 0 1-4 5.19l-1.42-1.43A9.86 9.86 0 0 0 20.82 12A9.82 9.82 0 0 0 12 6.5c-1.09 0-2.16.18-3.16.5L7.3 5.47c1.44-.62 3.03-.97 4.7-.97M3.18 12A9.82 9.82 0 0 0 12 17.5c.69 0 1.37-.07 2-.21L11.72 15A3.064 3.064 0 0 1 9 12.28L5.6 8.87c-.99.85-1.82 1.91-2.42 3.13" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width='1.5em' height='1.5em'><path fill="currentColor" d="M12 9a3 3 0 0 1 3 3a3 3 0 0 1-3 3a3 3 0 0 1-3-3a3 3 0 0 1 3-3m0-4.5c5 0 9.27 3.11 11 7.5c-1.73 4.39-6 7.5-11 7.5S2.73 16.39 1 12c1.73-4.39 6-7.5 11-7.5M3.18 12a9.821 9.821 0 0 0 17.64 0a9.821 9.821 0 0 0-17.64 0" /></svg>
                        )}
                    </button>
                </div>

                {showValidation && (
                    <div
                        className={`
                            mt-3 rounded-lg p-3 border transition-all duration-300 ease-out 
                            ${unmetRequirements.length > 0
                                ? "bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] text-white translate-y-0 opacity-100"
                                : "bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] text-green-500 translate-y-0 opacity-100"
                            }
                        `}
                    >
                        {unmetRequirements.length > 0 ? (
                            <>
                                <p className="text-sm font-medium mb-2">
                                    The password must contain:
                                </p>
                                <ul className="flex flex-col text-sm">
                                    {requirements.map((req, index) => {
                                        const met = req.test.test(password);
                                        return (
                                            <li
                                                key={index}
                                                className={`
                                                    flex items-center gap-2 transition-all duration-300 ease-out text-red-500
                                                ${met
                                                        ? "opacity-0 scale-95 pointer-events-none"
                                                        : "opacity-100 scale-100"}
                                                `}
                                                style={{
                                                    height: met ? "0px" : "20px", // define altura fixa pra evitar pulo
                                                    marginBottom: met ? "0px" : "4px", // controla o espaço entre visíveis
                                                    transitionDelay: met ? `${index * 50}ms` : "0ms",
                                                }}
                                            >
                                                {req.label}
                                            </li>
                                        );
                                    })}
                                </ul>
                            </>
                        ) : (
                            <p className="text-sm font-medium flex items-center gap-2">
                                Strong password! All requirements have been met.
                            </p>
                        )}
                    </div>
                )}

                <div className="relative">
                    <label className="block text-gray-300 text-sm mb-1">Confirm your Password</label>
                    <input
                        type={showConfirmPassword ? "text" : "password"}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                        placeholder="••••••••"
                    />

                    <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 bottom-[10px] text-gray-400 hover:text-white"
                    >
                        {showConfirmPassword ? (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width='1.5em' height='1.5em'><path fill="currentColor" d="M2 5.27L3.28 4L20 20.72L18.73 22l-3.08-3.08c-1.15.38-2.37.58-3.65.58c-5 0-9.27-3.11-11-7.5c.69-1.76 1.79-3.31 3.19-4.54zM12 9a3 3 0 0 1 3 3a3 3 0 0 1-.17 1L11 9.17A3 3 0 0 1 12 9m0-4.5c5 0 9.27 3.11 11 7.5a11.8 11.8 0 0 1-4 5.19l-1.42-1.43A9.86 9.86 0 0 0 20.82 12A9.82 9.82 0 0 0 12 6.5c-1.09 0-2.16.18-3.16.5L7.3 5.47c1.44-.62 3.03-.97 4.7-.97M3.18 12A9.82 9.82 0 0 0 12 17.5c.69 0 1.37-.07 2-.21L11.72 15A3.064 3.064 0 0 1 9 12.28L5.6 8.87c-.99.85-1.82 1.91-2.42 3.13" /></svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width='1.5em' height='1.5em'><path fill="currentColor" d="M12 9a3 3 0 0 1 3 3a3 3 0 0 1-3 3a3 3 0 0 1-3-3a3 3 0 0 1 3-3m0-4.5c5 0 9.27 3.11 11 7.5c-1.73 4.39-6 7.5-11 7.5S2.73 16.39 1 12c1.73-4.39 6-7.5 11-7.5M3.18 12a9.821 9.821 0 0 0 17.64 0a9.821 9.821 0 0 0-17.64 0" /></svg>
                        )}
                    </button>
                </div>
                {!passwordsMatch && confirmPassword.length > 0 && (
                    <p className="text-sm text-red-500 mt-1">Passwords must match</p>
                )}

                <div>
                    <label className="block text-gray-300 text-sm mb-1">Preferred Username</label>
                    <input
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full px-4 py-2 rounded-lg bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.15)] focus:outline-none focus:border-[#ff6b35] text-white placeholder-gray-400 transition"
                        placeholder="Username"
                    />
                </div>

                {error && <p className="text-red-400 text-sm">{error}</p>}


                <div className="flex items-start">
                    <div className="relative flex items-center h-5">
                        <input
                            id="terms-and-conditions"
                            name="terms"
                            type="checkbox"
                            checked={isChecked}
                            onChange={handleChange}
                            className="peer appearance-none w-5 h-5 border-2 rounded-sm cursor-pointer border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.08)] transition duration-200 
                            focus:outline-none focus:ring-2 focus:ring-[#ff8c42] focus:ring-opacity-50"
                        />
                        <span className={`absolute top-0 left-0 w-5 h-5 rounded-sm pointer-events-none flex items-center justify-center transition-all duration-200 ease-in-out
                            ${isChecked
                                ? 'bg-orange border-orange opacity-100 scale-100'
                                : 'bg-transparent border-transparent opacity-0 scale-0'
                            }
                        `}>
                            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                            </svg>
                        </span>
                    </div>
                    <div className="ml-3 text-sm">
                        <label htmlFor="terms-and-conditions" className="text-gray-300 cursor-pointer">
                            I agree with the
                            <button
                                onClick={onOpenTerms}
                                className="text-orange hover:text-[#ff8c42] ml-1 underline transition-colors duration-200"
                                type="button"
                            >
                                Terms and Conditions
                            </button>
                            .
                        </label>
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={!isFormValid}
                    className={`
                        w-full mt-4 py-2 rounded-lg font-medium transition
                        ${isFormValid
                            ? "bg-[#ff6b35] text-white hover:opacity-90 hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(255,107,53,0.4)] transition cursor-pointer"
                            : "bg-[rgba(255,255,255,0.1)] text-gray-400 cursor-not-allowed"
                        }
                    `}
                >
                    {loading ? "Registering..." : "Sign Up"}
                </button>
            </form>

            <div className="flex items-center my-5">
                <div className="flex-grow h-px bg-[rgba(255,255,255,0.15)]" />
                <span className="text-gray-400 text-sm px-2">or</span>
                <div className="flex-grow h-px bg-[rgba(255,255,255,0.15)]" />
            </div>

            <button onClick={onSwitch} className="w-full py-2 rounded-lg border border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.05)] text-white hover:bg-[rgba(255,255,255,0.1)] hover:-translate-y-[2px] hover:shadow-[0_6px_16px_rgba(255,255,255,0.05)] transition">
                Login to your account
            </button>
        </div >
    );
}
