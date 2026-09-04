import { useState } from "react";

// SIS-2026-0316 (Iury): clicar no cabeçalho da coluna ordena a tabela —
// mesmo padrão do Windows Explorer (setinha indicando a coluna/direção
// ativa). Usado em Meus Itens, Aprovação Malote e Pagamento Malote.
export type Direcao = "asc" | "desc";

export interface OrdenacaoTabela<C extends string> {
  coluna: C | null;
  direcao: Direcao;
  /** Clica no cabeçalho: 1º clique numa coluna nova = asc; clique de novo
   * na mesma coluna alterna asc/desc (igual ao Explorer — não existe
   * estado "sem ordenação" depois do primeiro clique). */
  alternar: (coluna: C) => void;
}

export function useOrdenacaoTabela<C extends string>(colunaInicial: C | null = null): OrdenacaoTabela<C> {
  const [coluna, setColuna] = useState<C | null>(colunaInicial);
  const [direcao, setDirecao] = useState<Direcao>("asc");

  function alternar(col: C) {
    if (coluna !== col) {
      setColuna(col);
      setDirecao("asc");
      return;
    }
    setDirecao((d) => (d === "asc" ? "desc" : "asc"));
  }

  return { coluna, direcao, alternar };
}
