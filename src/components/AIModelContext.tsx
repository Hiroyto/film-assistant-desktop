import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

// Model override context for session-based model selection
interface AIModelContextType {
  // Current selected model ID (null = use defaults)
  modelOverride: string | null;
  
  // Set the model override for the session
  setModelOverride: (modelId: string | null) => void;
  
  // Reset to default (Film Assistant fine-tuned models)
  resetToDefault: () => void;
  
  // Helper to get the model to use for API calls
  // Returns the override if set, otherwise null (backend uses its default)
  getModelForAPI: () => string | null;
}

const AIModelContext = createContext<AIModelContextType | undefined>(undefined);

interface AIModelProviderProps {
  children: ReactNode;
}

export function AIModelProvider({ children }: AIModelProviderProps) {
  // Session state - resets when user refreshes or leaves
  const [modelOverride, setModelOverrideState] = useState<string | null>(null);

  const setModelOverride = useCallback((modelId: string | null) => {
    // If selecting 'default', clear the override
    if (modelId === 'default' || modelId === null) {
      setModelOverrideState(null);
    } else {
      setModelOverrideState(modelId);
    }
  }, []);

  const resetToDefault = useCallback(() => {
    setModelOverrideState(null);
  }, []);

  const getModelForAPI = useCallback(() => {
    return modelOverride;
  }, [modelOverride]);

  const value: AIModelContextType = {
    modelOverride,
    setModelOverride,
    resetToDefault,
    getModelForAPI,
  };

  return (
    <AIModelContext.Provider value={value}>
      {children}
    </AIModelContext.Provider>
  );
}

// Custom hook for accessing the context
export function useAIModel() {
  const context = useContext(AIModelContext);
  if (context === undefined) {
    throw new Error('useAIModel must be used within an AIModelProvider');
  }
  return context;
}

// Helper hook that returns the selected model ID for display purposes
// Returns 'default' if no override is set
export function useSelectedModelId(): string {
  const { modelOverride } = useAIModel();
  return modelOverride || 'default';
}

export default AIModelContext;