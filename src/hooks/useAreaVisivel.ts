import { useEffect, useState } from "react";

export interface AreaVisivel {
  top: number;
  height: number;
}

const medir = (): AreaVisivel | null => {
  const v = typeof window !== "undefined" ? window.visualViewport : null;
  return v ? { top: v.offsetTop, height: v.height } : null;
};

/**
 * A parte da tela que sobra com o teclado aberto. No Android o viewport
 * `interactive-widget=resizes-content` (index.html) já encolhe a página, mas o
 * Safari do iPhone não encolhe: um `fixed bottom-0` fica atrás do teclado. Por
 * isso a conversa do WhatsApp toma a altura daqui, e o campo de digitar fica
 * sempre acima do teclado. Só escuta enquanto `ligado`.
 */
export function useAreaVisivel(ligado: boolean): AreaVisivel | null {
  const [area, setArea] = useState<AreaVisivel | null>(() => (ligado ? medir() : null));
  useEffect(() => {
    const v = window.visualViewport;
    if (!ligado || !v) { setArea(null); return; }
    const mudou = () => setArea(medir());
    mudou();
    v.addEventListener("resize", mudou);
    v.addEventListener("scroll", mudou);
    return () => {
      v.removeEventListener("resize", mudou);
      v.removeEventListener("scroll", mudou);
    };
  }, [ligado]);
  return area;
}
