import { useMemo } from "react";
import { useContratosERP, ContratoERP } from "@/hooks/useContratosERP";
import { usePlanilhaCustos, resolverLinhasVigentes, resolverLinhasPorPeriodo, somarCamposEmLinhas, fimDoMes, PlanilhaCustoRow } from "@/hooks/usePlanilhaCusto";
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

// outros_1/2/3 são campos livres da Planilha de Custo (com descrição por
// linha, digitada caso a caso — ex.: "FERIADO EM DOBRO") pra itens
// específicos de cada contrato, por isso CLASSIFICACOES_LICITACAO exclui
// eles de propósito (não são uma classificação fixa). Sem isso, contratos
// que usam esses campos ficavam com o Orçado abaixo do total real da
// Planilha de Custo. Aqui cada descrição vira sua própria rubrica
// dinâmica, agrupando por descrição (case-insensitive) quando repetida.
const SLOTS_OUTROS = [
  { campo: "outros_1" as const, descricaoCampo: "outros_1_descricao" as const, fallback: "Outros 1" },
  { campo: "outros_2" as const, descricaoCampo: "outros_2_descricao" as const, fallback: "Outros 2" },
  { campo: "outros_3" as const, descricaoCampo: "outros_3_descricao" as const, fallback: "Outros 3" },
];

function coletarRubricasOutros(linhasVigentes: PlanilhaCustoRow[]): OrcamentoContratoRubrica[] {
  const acumulado = new Map<string, { label: string; valor: number }>();
  for (const r of linhasVigentes) {
    const multiplicador = r.qt_postos || 1;
    for (const slot of SLOTS_OUTROS) {
      const valorLinha = Number(r[slot.campo]) || 0;
      if (!valorLinha) continue;
      const descricao = (r[slot.descricaoCampo] ?? "").trim();
      const label = descricao || slot.fallback;
      const chave = descricao ? descricao.toLowerCase() : `${slot.campo}:${label}`;
      const atual = acumulado.get(chave) ?? { label, valor: 0 };
      atual.valor += valorLinha * multiplicador;
      acumulado.set(chave, atual);
    }
  }
  return Array.from(acumulado.entries())
    .filter(([, v]) => v.valor !== 0)
    .map(([chave, v]) => ({
      campo: `outros:${chave}`,
      label: v.label,
      grupo: "Outros / Específicos",
      valor: v.valor,
      classificacaoMaloteId: null,
    }));
}

// Orçamento de Contratos (SIS-2026-0125, ajustado após feedback): espelho
// direto da Planilha de Custo por contrato — cada rubrica fixa (a
// "Classificação Licitação") já é a classificação, não precisa de nenhuma
// ligação pra aparecer aqui. A ligação Licitação→Malote é usada só em
// Orçamento Geral, pra enriquecer com aprovadores quando existir.
// `anoMes` opcional ("YYYY-MM", SIS-2026-0168): quando informado, o Orçado
// de cada rubrica é resolvido pela vigência que cobre aquele período (via
// resolverLinhasPorPeriodo), no lugar da vigência de "hoje" — usado pelo
// Orçamento Geral. Sem `anoMes`, mantém o comportamento original ("hoje"),
// usado por OrcamentoContratos.tsx.
export function useOrcamentoContratos(anoMes?: string) {
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
      // Conta/exibe apenas contratos ATIVOS — alinha com o KPI "Contratos
      // Ativos" da tela de Contratos e com o breakdown da Planilha de Custo.
      // Um contrato ativo sem execução lançada aparece com R$ 0 (sinaliza a
      // lacuna de dados em vez de sumir e gerar divergência de contagem).
      if (contrato.status !== "ativo") continue;
      const linhasVigentes = anoMes
        ? resolverLinhasPorPeriodo(planilha, contrato.id, fimDoMes(anoMes))
        : resolverLinhasVigentes(planilha, contrato.id);
      const rubricas: OrcamentoContratoRubrica[] = [];
      for (const c of CLASSIFICACOES_LICITACAO) {
        const valorBruto = somarCamposEmLinhas(linhasVigentes, [c.campo]);
        // "Deduções" é a única rubrica que representa um desconto do total
        // (mesmo tratamento do somaBeneficios em PlanilhaCusto.tsx) — soma-la
        // como as demais (positiva) fazia o total ficar 2x o valor de
        // deduções acima do total_por_empregado real da Planilha de Custo.
        const valor = c.campo === "deducoes" ? -valorBruto : valorBruto;
        if (valor !== 0) {
          rubricas.push({
            campo: c.campo,
            label: c.label,
            grupo: c.grupo,
            valor,
            classificacaoMaloteId: maloteIdPorCampo.get(c.campo) ?? null,
          });
        }
      }
      rubricas.push(...coletarRubricasOutros(linhasVigentes));
      const valorTotal = rubricas.reduce((s, r) => s + r.valor, 0);
      resultado.push({ contrato, rubricas, valorTotal });
    }
    return resultado;
  }, [contratos, planilha, maloteIdPorCampo, anoMes]);

  return {
    data: grupos,
    isLoading: carregandoContratos || carregandoPlanilha || carregandoLigacoes,
  };
}
