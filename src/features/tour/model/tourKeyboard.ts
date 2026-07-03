// Tour keyboard + scroll-lock (BC-07 / BR-MIGRAR-040 / COD-006). O legado bloqueava
// 9 navigation keys mas deixava TAB e ESC escaparem. Fix: bloquear TAB também; ESC vira
// "skip tour" explícito (com mensagem). Funções puras + helper de scroll-lock.

/** Códigos de navegação bloqueados durante o tour (9 do legado + Tab — COD-006). */
export const BLOCKED_NAV_CODES = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'Tab', // adicionado (fix do 🟡)
] as const;

export function isBlockedKey(code: string): boolean {
  return (BLOCKED_NAV_CODES as readonly string[]).includes(code);
}

export function isSkipKey(key: string): boolean {
  return key === 'Escape';
}

export interface TourKeyHandlers {
  /** ESC explícito = pular o tour (a UI mostra mensagem "Tour pulado"). */
  onSkip: () => void;
}

/**
 * Handler único de keydown do tour. ESC => skip explícito; demais teclas de navegação
 * (incl. TAB) são bloqueadas. Retorna true se o evento foi tratado/bloqueado.
 */
export function handleTourKeydown(e: KeyboardEvent, handlers: TourKeyHandlers): boolean {
  if (isSkipKey(e.key)) {
    e.preventDefault();
    handlers.onSkip(); // skip explícito + acessibilidade (BR-MIGRAR-040)
    return true;
  }
  if (isBlockedKey(e.code)) {
    e.preventDefault();
    return true;
  }
  return false;
}

/** Trava o scroll (body overflow + padding-right). Retorna função de restauração. */
export function lockScroll(): () => void {
  if (typeof document === 'undefined') return () => {};
  const { overflow, paddingRight } = document.body.style;
  document.body.style.overflow = 'hidden';
  return () => {
    document.body.style.overflow = overflow;
    document.body.style.paddingRight = paddingRight;
  };
}
