import { useMemo } from "react";
import { useContratosERP, ContratoERP } from "@/hooks/useContratosERP";
import { usePlanilhaCustos, resolverLinhasPorPeriodo, somarCamposEmLinhas, fimDoMes } from "@/hooks/usePlanilhaCusto";
import { useNfsEmissao } from "@/hooks/useNfEmissao";
import { useEmpresasGrupo } from "@/hooks/useMaloteDespesa";
import { contratoEncerradoNaCompetencia } from "../vigenciaContrato";
import { contaNoFaturamento, executavelSemPlanilha } from "./regras";
import type { FonteExecutavel } from "./composicao";

// SIS-2026-0556: fontes comuns às duas telas (Faturamento da Empresa e
// Lucratividade de Contratos). Os hooks já têm cache próprio no React Query —
// as mesmas chaves do Controle de Faturamento e do Relatório de Serviços.
export function useBaseFaturamento() {
  const { data: contratos = [], isLoading: c1 } = useContratosERP({ todasEmpresas: true });
  const { data: planilha = [], isLoading: c2 } = usePlanilhaCustos({ todasEmpresas: true });
  const { data: nfsTodas = [], isLoading: c3 } = useNfsEmissao(null, { todasEmpresas: true });
  const { data: empresas = [] } = useEmpresasGrupo();

  const nfs = useMemo(() => nfsTodas.filter(contaNoFaturamento), [nfsTodas]);
  const contratoPorId = useMemo(() => new Map(contratos.map((c) => [c.id, c])), [contratos]);
  // contrato|YYYY-MM com ao menos uma NF que conta no faturamento.
  const mesesComNota = useMemo(() => new Set(nfs.map((n) => `${n.contrato_id}|${n.competencia.slice(0, 7)}`)), [nfs]);
  const empresaNomePorId = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);
  const planilhaPorContrato = useMemo(() => {
    const mapa = new Map<string, typeof planilha>();
    for (const r of planilha) {
      if (!r.contrato_id) continue;
      const arr = mapa.get(r.contrato_id) ?? [];
      arr.push(r);
      mapa.set(r.contrato_id, arr);
    }
    return mapa;
  }, [planilha]);

  // Valor executável do contrato no mês ("YYYY-MM"): planilha_custo vigente,
  // 0 depois do fim do contrato (mesma regra do Controle de Faturamento).
  // SIS-2026-0641: além do valor, de onde ele vem (o modal "como é formado" mostra a origem).
  function origemExecutavel(c: ContratoERP, anoMes: string): { valor: number; fonte: FonteExecutavel } {
    if (contratoEncerradoNaCompetencia(c, `${anoMes}-01`)) return { valor: 0, fonte: "encerrado" };
    const rows = planilhaPorContrato.get(c.id) ?? [];
    // SIS-2026-0641: sem nenhuma planilha de custo, usa o Valor Executado Mensal do cadastro do contrato.
    if (rows.length === 0) {
      const v = executavelSemPlanilha(c, anoMes);
      return { valor: v, fonte: v > 0 ? "cadastro" : "sem_valor" };
    }
    const exec = somarCamposEmLinhas(resolverLinhasPorPeriodo(rows, c.id, fimDoMes(anoMes)), ["total_por_empregado"]);
    // Mesmo critério do Controle de Faturamento: mês com nota e planilha toda
    // "encerrada" usa as linhas encerradas só naquele mês (ex. SEMAE - 3038/2020).
    if (exec === 0 && mesesComNota.has(`${c.id}|${anoMes}`)) {
      const v = somarCamposEmLinhas(resolverLinhasPorPeriodo(rows, c.id, fimDoMes(anoMes), true), ["total_por_empregado"]);
      return { valor: v, fonte: v > 0 ? "planilha" : "sem_valor" };
    }
    return { valor: exec, fonte: exec > 0 ? "planilha" : "sem_valor" };
  }

  function executavelDoContrato(c: ContratoERP, anoMes: string): number {
    return origemExecutavel(c, anoMes).valor;
  }

  return { contratos, nfs, empresas, contratoPorId, empresaNomePorId, executavelDoContrato, origemExecutavel, carregando: c1 || c2 || c3 };
}

export const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function rotuloMes(anoMes: string): string {
  return `${MESES_ABREV[Number(anoMes.slice(5, 7)) - 1] ?? "?"}/${anoMes.slice(2, 4)}`;
}
