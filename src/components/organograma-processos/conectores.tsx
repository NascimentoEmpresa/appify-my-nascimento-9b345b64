import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

// =====================================================================
// Linhas entre caixas que o layout HTML posiciona (Organograma Geral):
// cada caixa leva data-no="<chave>"; depois de desenhar, mede-se onde cada
// uma ficou (relativo ao contêiner) e as linhas viram caminhos SVG em
// cotovelo. Re-mede quando o contêiner muda de tamanho.
// =====================================================================

export interface Ligacao {
  de: string; para: string; cor: string; dash?: string; largura?: number;
  /** Altura da "dobra" (0–1 entre a saída e a chegada), para separar linhas paralelas. */
  dobra?: number;
  /** Deslocamento horizontal na saída/chegada (px), para não sobrepor. */
  dx1?: number; dx2?: number;
  seta?: boolean;
  /** "baixo" sai da base e chega no topo; "lado" sai da direita e chega na esquerda. */
  sentido?: "baixo" | "lado" | "cima";
}
export interface Caminho { d: string; cor: string; dash?: string; largura: number; seta: boolean; chave: string }

export function useConectores(container: RefObject<HTMLElement>, ligacoes: Ligacao[], deps: unknown[]) {
  const [caminhos, setCaminhos] = useState<Caminho[]>([]);
  const [tamanho, setTamanho] = useState({ w: 0, h: 0 });

  const medir = useCallback(() => {
    const raiz = container.current;
    if (!raiz) return;
    const base = raiz.getBoundingClientRect();
    const rect = (k: string) => {
      const el = raiz.querySelector(`[data-no="${CSS.escape(k)}"]`) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
    };
    const out: Caminho[] = [];
    ligacoes.forEach((l, i) => {
      const a = rect(l.de), b = rect(l.para);
      if (!a || !b) return;
      let d: string;
      if (l.sentido === "lado") {
        const x1 = a.x + a.w, y1 = a.y + a.h / 2, x2 = b.x, y2 = b.y + b.h / 2;
        const xm = x1 + (x2 - x1) * (l.dobra ?? 0.5);
        d = `M${x1},${y1} H${xm} V${y2} H${x2 - (l.seta ? 2 : 0)}`;
      } else if (l.sentido === "cima") {
        const x1 = a.x + a.w / 2 + (l.dx1 ?? 0), y1 = a.y, x2 = b.x + b.w / 2 + (l.dx2 ?? 0), y2 = b.y + b.h;
        const ym = y2 + (y1 - y2) * (l.dobra ?? 0.5);
        d = `M${x1},${y1} V${ym} H${x2} V${y2 + (l.seta ? 2 : 0)}`;
      } else {
        const x1 = a.x + a.w / 2 + (l.dx1 ?? 0), y1 = a.y + a.h, x2 = b.x + b.w / 2 + (l.dx2 ?? 0), y2 = b.y;
        const ym = y1 + (y2 - y1) * (l.dobra ?? 0.5);
        d = `M${x1},${y1} V${ym} H${x2} V${y2 - (l.seta ? 2 : 0)}`;
      }
      out.push({ d, cor: l.cor, dash: l.dash, largura: l.largura ?? 1.6, seta: !!l.seta, chave: `${l.de}>${l.para}>${i}` });
    });
    setCaminhos(out);
    setTamanho({ w: raiz.scrollWidth, h: raiz.scrollHeight });
  }, [container, ligacoes]);

  useLayoutEffect(() => {
    medir();
    const raiz = container.current;
    if (!raiz) return;
    const ro = new ResizeObserver(() => medir());
    ro.observe(raiz);
    const t = window.setTimeout(medir, 250);   // fotos e fontes terminam de carregar depois
    return () => { ro.disconnect(); window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medir, ...deps]);

  return { caminhos, tamanho, medir };
}
