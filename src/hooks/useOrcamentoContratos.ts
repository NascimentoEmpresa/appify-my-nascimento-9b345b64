import { useMemo } from "react";
import { useContratosERP, ContratoERP } from "@/hooks/useContratosERP";
import { usePlanilhaCustos, resolverLinhasVigentes, somarCamposEmLinhas } from "@/hooks/usePlanilhaCusto";
import { useLigacoesLicitacaoClassificacao } from "@/hooks/useMaloteLicitacaoClassificacaoLink";
import { CLASSIFICACOES_LICITACAO } from "@/lib/planilhaCustoClassificacoes";

export interface OrcamentoContratoRubrica {
  campo: string;
  label: string;
  grupo: string;
  valor: number;
  // Classificação do Malote ligada a essa rubrica (Configurações →
  // Ligações), se existir — usada só como enriquecimento opcional (ex.:
  // aprovadores no Orçamento Geral), nunca como filtro pra essa rubrica
  // aparecer ou não aqui.
  classificacaoMaloteId: string | null;
}

export interface OrcamentoContratoGrupo {
  contrato: ContratoERP;
  rubricas: OrcamentoContratoRubrica[];
  valorTotal: number;
}

// Orçamento de Contratos (SIS-2026-0125, ajustado após feedback): espelho
// direto da Planilha de Custo por contrato — cada rubrica fixa (a
// "Classificação Licitação") já é a classificação, não precisa de nenhuma
// ligação pra aparecer aqui. A ligação Licitação→Malote é usada só em
// Orçamento Geral, pra enriquecer com aprovadores quando existir.
export function useOrcamentoContratos() {
  const { data: contratos = [], isLoading: carregandoContratos } = useContratosERP();
  const { data: planilha = [], isLoading: carregandoPlanilha } = usePlanilhaCustos();
  const { data: ligacoes = [], isLoading: carregandoLigacoes } = useLigacoesLicitacaoClassificacao();

  const maloteIdPorCampo = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of ligacoes) map.set(l.campo_planilha_custo, l.classificacao_malote_id);
    return map;
  }, [ligacoes]);

  const grupos: OrcamentoContratoGrupo[] = useMemo(() => {
    const resultado: OrcamentoContratoGrupo[] = [];
    for (const contrato of contratos) {
      const linhasVigentes = resolverLinhasVigentes(planilha, contrato.id);
      const rubricas: OrcamentoContratoRubrica[] = [];
      for (const c of CLASSIFICACOES_LICITACAO) {
        const valor = somarCamposEmLinhas(linhasVigentes, [c.campo]);
        if (valor > 0) {
          rubricas.push({
            campo: c.campo,
            label: c.label,
            grupo: c.grupo,
            valor,
            classificacaoMaloteId: maloteIdPorCampo.get(c.campo) ?? null,
          });
        }
      }
      if (rubricas.length > 0) {
        const valorTotal = rubricas.reduce((s, r) => s + r.valor, 0);
        resultado.push({ contrato, rubricas, valorTotal });
      }
    }
    return resultado;
  }, [contratos, planilha, maloteIdPorCampo]);

  return {
    data: grupos,
    isLoading: carregandoContratos || carregandoPlanilha || carregandoLigacoes,
  };
}
