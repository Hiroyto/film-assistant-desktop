import { createContext } from "react";

export type GlobalError = {
  title?: string;
  message: string;
  actions?: React.ReactNode;
};

export type ErrorContextType = {
  error: GlobalError | null;
  showError: (error: GlobalError) => void;
  clearError: () => void;
};

export const ErrorContext = createContext<ErrorContextType | null>(null);
