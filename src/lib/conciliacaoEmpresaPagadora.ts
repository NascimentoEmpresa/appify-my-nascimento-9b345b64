import type { FluxoCaixaMaloteLinha } from "@/hooks/useFluxoCaixaMalote";

// Despesa rateada entre empresas sai de UMA conta: no extrato cai o total, na conta da empresa que pagou. O Fluxo só tem a empresa de cada
// fatia (a do contrato); aqui a conciliação passa a tratar a despesa inteira como da empresa pagadora. Só vale para a conciliação.

export interface EmpresaPagadora {
  origem: string;
  despesa_id: string;
  numero_parcela: number | null;
  empresa_pagadora_id: string;
}

const chave = (origem: string, despesaId: string, parcela: number | null) => `${origem}|${despesaId}|${parcela ?? ""}`;

export function mapaEmpresaPagadora(registros: EmpresaPagadora[]): Map<string, string> {
  return new Map(registros.map((r) => [chave(r.origem, r.despesa_id, r.numero_parcela), r.empresa_pagadora_id]));
}

/** A pagadora da parcela; se só a despesa inteira foi marcada, vale a dela. */
export function empresaPagadoraDaLinha(l: Pick<FluxoCaixaMaloteLinha, "origem" | "despesa_id" | "numero_parcela">, mapa: Map<string, string>): string | null {
  if (!l.despesa_id) return null;
  return mapa.get(chave(l.origem, l.despesa_id, l.numero_parcela ?? null)) ?? mapa.get(chave(l.origem, l.despesa_id, null)) ?? null;
}

/** Linhas com a empresa trocada pela pagadora (quando marcada). O resto da conciliação (filtro por empresa, soma do rateio) segue igual. */
export function aplicarEmpresaPagadora(linhas: FluxoCaixaMaloteLinha[], mapa: Map<string, string>, nomes: Map<string, string>): FluxoCaixaMaloteLinha[] {
  if (mapa.size === 0) return linhas;
  return linhas.map((l) => {
    const pagadora = empresaPagadoraDaLinha(l, mapa);
    if (!pagadora || pagadora === l.empresa_id) return l;
    return { ...l, empresa_id: pagadora, empresa_nome: nomes.get(pagadora) ?? l.empresa_nome };
  });
}
