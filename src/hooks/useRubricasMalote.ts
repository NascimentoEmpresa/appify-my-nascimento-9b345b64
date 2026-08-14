import { useMemo } from "react";
import { useClassificacoesAdministrativo } from "@/hooks/useMaloteClassificacaoAdministrativo";
import { useLigacoesAdministrativoClassificacao } from "@/hooks/useMaloteAdministrativoClassificacaoLink";
import { useLigacoesLicitacaoClassificacao } from "@/hooks/useMaloteLicitacaoClassificacaoLink";
import { useClassificacoesOrcamento, ClassificacaoOrcamento } from "@/hooks/usePlanejamentoOrcamentario";
import { CLASSIFICACOES_LICITACAO } from "@/lib/planilhaCustoClassificacoes";

export interface RubricaVinculada {
  id: string; // "adm:<classificacao_administrativa_id>" | "lic:<campo_planilha_custo>"
  origem: "administrativo" | "contrato";
  label: string;
  campoOuId: string; // classificacao_administrativa_id (origem=administrativo) ou campo_planilha_custo (origem=contrato)
  classificacaoMalote: ClassificacaoOrcamento;
}

// Criar Despesa (SIS-2026-0132-ish, pedido do Iury): em vez de escolher a
// Classificação Malote diretamente (uma entidade abstrata sem valor), o
// usuário escolhe a rubrica de verdade (Administrativo ou Contrato) e o
// sistema resolve a Classificação Malote vinculada por trás — mesmas
// tabelas de ligação já usadas nas telas de Ligação. Só entram rubricas já
// vinculadas: sem vínculo, não tem aprovador/regra pra resolver.
export function useRubricasVinculadas() {
  const { data: adminRubricas = [], isLoading: l1 } = useClassificacoesAdministrativo();
  const { data: ligacoesAdmin = [], isLoading: l2 } = useLigacoesAdministrativoClassificacao();
  const { data: ligacoesLicitacao = [], isLoading: l3 } = useLigacoesLicitacaoClassificacao();
  const { data: classificacoes = [], isLoading: l4 } = useClassificacoesOrcamento();

  const rubricas = useMemo<RubricaVinculada[]>(() => {
    const classificacaoPorId = new Map(classificacoes.map((c) => [c.id, c]));

    const administrativas: RubricaVinculada[] = ligacoesAdmin
      .map((lig) => {
        const rubrica = adminRubricas.find((r) => r.id === lig.classificacao_administrativa_id);
        const classificacaoMalote = classificacaoPorId.get(lig.classificacao_malote_id);
        if (!rubrica || !classificacaoMalote) return null;
        return {
          id: `adm:${rubrica.id}`,
          origem: "administrativo" as const,
          label: rubrica.nome,
          campoOuId: rubrica.id,
          classificacaoMalote,
        };
      })
      .filter((r): r is RubricaVinculada => !!r);

    const licitacao: RubricaVinculada[] = ligacoesLicitacao
      .map((lig) => {
        const rubrica = CLASSIFICACOES_LICITACAO.find((r) => r.campo === lig.campo_planilha_custo);
        const classificacaoMalote = classificacaoPorId.get(lig.classificacao_malote_id);
        if (!rubrica || !classificacaoMalote) return null;
        return {
          id: `lic:${rubrica.campo}`,
          origem: "contrato" as const,
          label: rubrica.label,
          campoOuId: rubrica.campo,
          classificacaoMalote,
        };
      })
      .filter((r): r is RubricaVinculada => !!r);

    return [...administrativas, ...licitacao].sort((a, b) => a.label.localeCompare(b.label));
  }, [adminRubricas, ligacoesAdmin, ligacoesLicitacao, classificacoes]);

  return { data: rubricas, isLoading: l1 || l2 || l3 || l4 };
}
