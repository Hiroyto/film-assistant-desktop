// domUtils.ts
export function scrollToAndFlash(id: string, opts?: { block?: ScrollLogicalPosition; durationMs?: number }) {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`[scrollToAndFlash] element not found: ${id}`);
        return false;
    }

    const block = opts?.block ?? "center";
    const duration = opts?.durationMs ?? 1300;

    // scroll suave
    el.scrollIntoView({ behavior: "smooth", block });

    // aplica highlight: reinicia animação removendo e readicionando a classe
    el.classList.remove("flash-highlight");
    // força reflow para reiniciar a animação
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    void el.offsetWidth;
    el.classList.add("flash-highlight");

    // garante remoção após término (por segurança)
    setTimeout(() => {
        try {
            el.classList.remove("flash-highlight");
        } catch (e) {
            /* ignore */
        }
    }, duration + 80);

    return true;
}
