// SIS-2026-0650: regras puras da aba "NFs Não Emitidas" do Controle de Faturamento
// (etapa atual derivada da Emissão de NF e o resumo do impacto financeiro).

export type EtapaNf = "NAO_INICIADA" | "RASCUNHO" | "ENVIADA";

export const ETAPA_LABEL: Record<EtapaNf, string> = {
  NAO_INICIADA: "Não iniciada",
  RASCUNHO: "Em rascunho",
  ENVIADA: "Enviada ao Financeiro",
};

// Etapa do contrato na competência, vista pela Emissão de NF. O contrato só está na lista de
// pendentes porque NÃO tem nota Código N concluída — então a etapa é o ponto mais avançado
// entre as notas ainda não concluídas: enviada ao Financeiro > rascunho > nada iniciado.
// Nota cancelada não conta (o analista ainda precisa emitir).
export function etapaDaNf(nfsDoContratoNaCompetencia: { status?: string | null }[]): EtapaNf {
  let etapa: EtapaNf = "NAO_INICIADA";
  for (const n of nfsDoContratoNaCompetencia) {
    if (n.status === "enviada") return "ENVIADA";
    if (n.status === "rascunho") etapa = "RASCUNHO";
  }
  return etapa;
}

export interface PendenciaBase {
  empresaNome: string;
  contratoNome: string;
  // valor não emitido do contrato na competência (para pendente = executável inteiro)
  naoEmitido: number;
}

export interface ResumoPendencias {
  qtd: number;
  valorNaoFaturado: number;
  // % do valor não faturado sobre o executável total da competência
  impactoPct: number;
  maior: { contratoNome: string; valor: number } | null;
  // % dos 3 maiores sobre o total não faturado
  concentracaoTop3Pct: number;
  porEmpresa: { empresa: string; valor: number }[];
  // executável da competência que não está nas pendências (já faturado, parcial ou fora da lista)
  executavelForaDasPendencias: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function impactoDoContratoPct(naoEmitido: number, executavelTotal: number): number {
  return executavelTotal > 0 ? (naoEmitido / executavelTotal) * 100 : 0;
}

export function resumirPendencias(linhas: PendenciaBase[], executavelTotal: number): ResumoPendencias {
  const ordenadas = [...linhas].sort((a, b) => b.naoEmitido - a.naoEmitido);
  const valorNaoFaturado = r2(linhas.reduce((s, l) => s + l.naoEmitido, 0));
  const top3 = ordenadas.slice(0, 3).reduce((s, l) => s + l.naoEmitido, 0);
  const porEmpresa = new Map<string, number>();
  for (const l of linhas) porEmpresa.set(l.empresaNome, (porEmpresa.get(l.empresaNome) ?? 0) + l.naoEmitido);
  return {
    qtd: linhas.length,
    valorNaoFaturado,
    impactoPct: impactoDoContratoPct(valorNaoFaturado, executavelTotal),
    maior: ordenadas[0] ? { contratoNome: ordenadas[0].contratoNome, valor: ordenadas[0].naoEmitido } : null,
    concentracaoTop3Pct: valorNaoFaturado > 0 ? (top3 / valorNaoFaturado) * 100 : 0,
    porEmpresa: Array.from(porEmpresa.entries())
      .map(([empresa, valor]) => ({ empresa, valor: r2(valor) }))
      .sort((a, b) => b.valor - a.valor),
    executavelForaDasPendencias: r2(Math.max(0, executavelTotal - valorNaoFaturado)),
  };
}
