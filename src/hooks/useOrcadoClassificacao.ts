import { useMemo } from "react";
import { useClassificacoesOrcamentoAdmin, usePlanejamentosOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useOrcamentoContratos } from "@/hooks/useOrcamentoContratos";
import { fimDoMes } from "@/hooks/usePlanilhaCusto";
import { getStatusVigencia } from "@/pages/malote/orcamentoUtils";

// Resolve o Orçado de UMA Classificação do Malote num Ano/Mês — mesma
// regra usada em OrcamentoGeral.tsx/DetalheOrcamento.tsx (SIS-2026-0168),
// extraída aqui pra ser reaproveitada também na alçada de aprovação
// (SIS-2026-0132 — % de alçada do aprovador, antes nunca consumido).
//
// Tipo Contrato: soma das rubricas ligadas daquele contrato. Tipo
// Administrativo: soma de planejamento_orcamentario cuja vigência cobre o
// período. Sem dado suficiente pra resolver (classificação não
// encontrada/ainda carregando, ou contrato não informado numa
// Classificação tipo Contrato), retorna null — "orçado desconhecido",
// não "zero".
export function useOrcadoClassificacao(empresaId: string | null | undefined, anoMes: string) {
  const { data: classificacoes = [], isLoading: carregandoClassificacoes } = useClassificacoesOrcamentoAdmin();
  const { data: orcamentosAdm = [], isLoading: carregandoAdm } = usePlanejamentosOrcamento(empresaId);
  // SIS-2026-0212: faltava no isLoading agregado — enquanto essa ligação
  // ainda não carregava, maloteIdPorAdministrativa ficava vazio e o
  // resolver() de tipo administrativo sempre devolvia 0 (nenhuma linha de
  // orçamento batia), mesmo com isLoading=false liberando o botão Aprovar.
  const { data: ligacoesAdm = [], isLoading: carregandoLigacoes } = useLigacoesAdministrativoClassificacao();
  const { data: gruposContrato = [], isLoading: carregandoContrato } = useOrcamentoContratos(anoMes);

  const classificacoesPorId = useMemo(() => new Map(classificacoes.map((c) => [c.id, c])), [classificacoes]);
  const maloteIdPorAdministrativa = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of ligacoesAdm) map.set(l.classificacao_administrativa_id, l.classificacao_malote_id);
    return map;
  }, [ligacoesAdm]);
  const referenciaPeriodo = useMemo(() => fimDoMes(anoMes), [anoMes]);

  function resolver(classificacaoId: string | null | undefined, contratoId: string | null | undefined): number | null {
    if (!classificacaoId) return null;
    const classificacao = classificacoesPorId.get(classificacaoId);
    if (!classificacao) return null;

    if (classificacao.tipo === "contrato") {
      if (!contratoId) return null;
      const grupo = gruposContrato.find((g) => g.contrato.id === contratoId);
      if (!grupo) return 0;
      return grupo.rubricas.filter((r) => r.classificacaoMaloteId === classificacaoId).reduce((s, r) => s + r.valor, 0);
    }

    let soma = 0;
    for (const o of orcamentosAdm) {
      if (maloteIdPorAdministrativa.get(o.classificacao_id) !== classificacaoId) continue;
      if (getStatusVigencia(o.inicio_vigencia, o.fim_vigencia, referenciaPeriodo) !== "na_vigencia") continue;
      soma += Number(o.valor) || 0;
    }
    return soma;
  }

  return { resolver, isLoading: carregandoClassificacoes || carregandoAdm || carregandoLigacoes || carregandoContrato };
}
