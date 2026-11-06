import { useEffect, useState } from "react";

// Estado da paginação numerada (ver BarraPaginacao): página, tamanho lembrado no navegador e volta à 1ª quando a quantidade muda.
export const TAMANHOS_PADRAO = [25, 50, 100] as const;

export function usePaginacaoNumerada(totalItens: number, chave: string, padrao = 50) {
  const chaveTamanho = `${chave}.porPagina`;
  const [porPagina, setPorPagina] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(chaveTamanho));
      return (TAMANHOS_PADRAO as readonly number[]).includes(n) ? n : padrao;
    } catch { return padrao; }
  });
  const [pagina, setPagina] = useState(1);
  // A quantidade mudou (filtro): volta para a primeira página.
  useEffect(() => { setPagina(1); }, [totalItens]);

  const totalPaginas = Math.max(1, Math.ceil(totalItens / porPagina));
  const atual = Math.min(pagina, totalPaginas);
  const ini = (atual - 1) * porPagina;
  return {
    pagina: atual, totalPaginas, porPagina, ini, fim: Math.min(ini + porPagina, totalItens),
    irPara: (p: number) => setPagina(Math.min(Math.max(1, p), totalPaginas)),
    trocarTamanho: (n: number) => {
      setPorPagina(n);
      try { localStorage.setItem(chaveTamanho, String(n)); } catch { /* sem armazenamento: só não lembra */ }
      setPagina(Math.floor(ini / n) + 1); // mantém a primeira linha que estava na tela
    },
  };
}
