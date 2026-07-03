import { ErrorModal } from "../ui/ErrorModal";
import { useError } from "./useError";

export function GlobalErrorModal() {
    const { error, clearError } = useError();

    if (!error) return null;

    return (
        <ErrorModal
            open={true}
            onClose={clearError}
            title={error.title ?? "Error"}
            message={error.message}
            actions={error.actions}
        />
    );
}
