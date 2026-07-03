import { useCallback, useState } from "react";
import { ErrorContext } from "./ErrorContext";

export type GlobalError = {
    title?: string;
    message: string;
    actions?: React.ReactNode;
};

export function ErrorProvider({ children }: { children: React.ReactNode }) {
    const [error, setError] = useState<GlobalError | null>(null);

    const showError = useCallback((error: GlobalError) => {
        setError(error);
    }, []);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    return (
        <ErrorContext.Provider value={{ error, showError, clearError }}>
            {children}
        </ErrorContext.Provider>
    );
}
