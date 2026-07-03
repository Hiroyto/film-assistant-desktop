import React, { createContext, useContext, useEffect, useState } from 'react';

export type CommandUIMode = 'palette' | 'bar' | 'docked';

interface CommandUIState {
  open: boolean;
  mode: CommandUIMode;

  openPalette: () => void;
  close: () => void;
  toggle: () => void;

  setMode: (mode: CommandUIMode) => void;
}

export const CommandUIContext = createContext<CommandUIState | null>(null);

export function CommandUIProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CommandUIMode>('palette');

  // Ctrl / Cmd + K
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();

        // Se for bar ou docked, só alterna open
        if (mode !== 'palette') {
          setOpen(o => !o);
          return;
        }

        // Palette: abre/fecha normalmente
        setOpen(o => !o);
      }

      if (e.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode]);

  const value: CommandUIState = {
    open,
    mode,

    openPalette: () => {
      setMode('palette');
      setOpen(true);
    },

    close: () => setOpen(false),

    toggle: () => setOpen(o => !o),

    setMode,
  };

  return (
    <CommandUIContext.Provider value={value}>
      {children}
    </CommandUIContext.Provider>
  );
}
