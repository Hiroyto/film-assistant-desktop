// Command palette consolidado (BC-07 / BR-MIGRAR-039 / tech-debt #9 / DEV-007).
// O legado registrava o hotkey Cmd/Ctrl+K em 3 lugares (CommandBar, useCommandPalette,
// CommandUIContext) com 2 open flags. Aqui há UM controller, UM open state e UM listener.
// No desktop o mesmo atalho é registrado também no menu nativo do OS (Tarefa 15).

type Listener = (open: boolean) => void;

export interface CommandPalette {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  subscribe: (l: Listener) => () => void;
  /** Registra o ÚNICO listener global de keydown. Retorna unmount. */
  mount: () => () => void;
  /** Exposto para teste / integração com handlers externos. */
  handleKeydown: (e: KeyboardEvent) => void;
}

export function createCommandPalette(): CommandPalette {
  let open = false;
  const listeners = new Set<Listener>();

  const setOpen = (v: boolean) => {
    if (v === open) return;
    open = v;
    listeners.forEach((l) => l(open));
  };
  const toggle = () => setOpen(!open);

  const handleKeydown = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'Escape' && open) {
      setOpen(false);
    }
  };

  return {
    isOpen: () => open,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    mount: () => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener('keydown', handleKeydown);
      return () => window.removeEventListener('keydown', handleKeydown);
    },
    handleKeydown,
  };
}

/** Instância única do palette — fonte única de verdade (resolve tech-debt #9). */
export const commandPalette = createCommandPalette();
