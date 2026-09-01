import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMeusContratosAnalista, useAnalistasDosContratos } from "@/hooks/useMaloteAnalistas";
import { useOrcadoClassificacaoMultiMes } from "@/hooks/useOrcadoClassificacao";
import { useUtilizadoOrcamento } from "@/hooks/useUtilizadoOrcamento";
import { montarCombosAlcada, encontrarComboQueEstouraAlcada } from "@/pages/malote/orcamentoUtils";
import { StatusDespesa } from "@/hooks/useMaloteDespesa";

// SIS-2026-0283 (Iury): "Justificativa Analistas" — submódulo em Licitações
// que mostra os itens do malote que os analistas precisam justificar. Mesmo
// cálculo já usado no badge de Aprovações/Meus Itens
// (JustificativaPendenteBadge.tsx, SIS-2026-0261), só que aqui em LOTE (pra
// listar todas as pendências de uma vez, não só sinalizar 1 despesa já
// visível na lista de outra tela).
//
// Escopo decidido com o usuário (achado do próprio teste dele, DM-2026-0163):
// "por ora todos poderíamos ver, para o gerente e colegas se alertarem que
// ali tem uma justificativa" — por isso a tela usa `useTodasJustificativasPendentes`
// (sem filtro de contrato), não `useMinhasJustificativasPendentes`. Esse
// segundo hook continua existindo pro filtro "Minhas" de Aprovações.tsx, que
// É pra ser por usuário mesmo.
export interface ItemJustificativaAnalista {
  linhaId: string;
  despesaId: string;
  numero: string;
  nome: string;
  motivo: string | null;
  status: StatusDespesa;
  classificacaoNome: string | null;
  contratoId: string;
  valorLinha: number;
  dataPagamento: string | null;
  competencia: string | null;
}

interface LinhaRaw {
  id: string;
  despesa_id: string;
  contrato_id: string | null;
  valor: number;
  justificativa_texto: string | null;
  despesa: {
    id: string;
    numero: string;
    nome: string;
    motivo: string | null;
    status: StatusDespesa;
    valor_total: number;
    data_pagamento: string | null;
    competencia: string | null;
    parcelado: boolean;
    empresa_id: string;
    classificacao_id: string | null;
    classificacao: { nome: string; limite_justificativa_pct: number | null } | null;
  } | null;
}

const LINHA_SELECT =
  "id, despesa_id, contrato_id, valor, justificativa_texto, " +
  "despesa:despesa_id(id, numero, nome, motivo, status, valor_total, data_pagamento, competencia, parcelado, empresa_id, classificacao_id, " +
  "classificacao:classificacao_id(nome, limite_justificativa_pct))";

// `contratoIds` undefined = todos os contratos (tela "Justificativa
// Analistas", visível a qualquer um por decisão do usuário); array = só
// esses contratos (filtro "Minhas" de Aprovações, por usuário).
function useLinhasCandidatas(contratoIds: string[] | undefined) {
  const restrito = contratoIds !== undefined;
  const chave = restrito ? contratoIds!.slice().sort().join(",") : "todas";
  return useQuery({
    queryKey: ["malote_justificativa_analista_linhas", chave],
    enabled: !restrito || contratoIds!.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      let query = (supabase as any).from("malote_despesa_rateio_linha").select(LINHA_SELECT).is("justificativa_texto", null);
      if (restrito) query = query.in("contrato_id", contratoIds);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as LinhaRaw[];
    },
  });
}

function useParcelasDasDespesas(despesaIds: string[]) {
  const chave = despesaIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["malote_justificativa_analista_parcelas", chave],
    enabled: despesaIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_despesa_parcela")
        .select("despesa_id, data_vencimento, valor")
        .in("despesa_id", despesaIds);
      if (error) throw error;
      const mapa = new Map<string, { data_vencimento: string; valor: number }[]>();
      for (const p of (data ?? []) as any[]) {
        const lst = mapa.get(p.despesa_id) ?? [];
        lst.push({ data_vencimento: p.data_vencimento, valor: p.valor });
        mapa.set(p.despesa_id, lst);
      }
      return mapa;
    },
  });
}

// Núcleo compartilhado: dado um conjunto de linhas candidatas (já
// pré-filtradas por contrato ou não), resolve quais realmente estouram o
// limite configurado — mesma lógica pura de JustificativaPendenteBadge.
function useJustificativasPendentesDe(contratoIds: string[] | undefined) {
  const { data: linhasRaw = [], isLoading: carregandoLinhas } = useLinhasCandidatas(contratoIds);
  const despesaIdsParceladas = useMemo(
    () => Array.from(new Set(linhasRaw.filter((l) => l.despesa?.parcelado).map((l) => l.despesa_id))),
    [linhasRaw]
  );
  const { data: parcelasPorDespesa = new Map<string, { data_vencimento: string; valor: number }[]>(), isLoading: carregandoParcelas } =
    useParcelasDasDespesas(despesaIdsParceladas);
  const empresaIds = useMemo(
    () => Array.from(new Set(linhasRaw.map((l) => l.despesa?.empresa_id).filter((v): v is string => !!v))),
    [linhasRaw]
  );
  // Malote é operado dentro de UMA empresa por vez em todo o resto do
  // sistema (mesmo critério de JustificativaPendenteBadge, que resolve por
  // despesa.empresa_id) — se algum dia isso precisar abranger contratos em
  // mais de uma empresa ao mesmo tempo, isso vira 1 resolver por empresa.
  const { resolver: resolverOrcadoMultiMes, isLoading: carregandoOrcado } = useOrcadoClassificacaoMultiMes(empresaIds[0]);
  const { data: utilizadoLinhasGlobal = [], isLoading: carregandoUtilizado } = useUtilizadoOrcamento();

  const itens = useMemo<ItemJustificativaAnalista[]>(() => {
    function utilizadoAntesNoMes(despesaId: string, classificacaoId: string | null, contratoId: string | null, mes: string): number {
      return utilizadoLinhasGlobal.reduce((soma, u) => {
        if (u.despesa_id === despesaId) return soma;
        if (u.classificacao_id !== classificacaoId) return soma;
        if (!u.competencia || u.competencia.slice(0, 7) !== mes) return soma;
        if ((u.contrato_id ?? null) !== contratoId) return soma;
        return soma + (Number(u.valor) || 0);
      }, 0);
    }

    const resultado: ItemJustificativaAnalista[] = [];
    for (const linha of linhasRaw) {
      const d = linha.despesa;
      if (!d) continue;
      const limitePct = d.classificacao?.limite_justificativa_pct ?? null;
      if (limitePct == null) continue;
      const anoMesDespesa = d.competencia ? d.competencia.slice(0, 7) : d.data_pagamento?.slice(0, 7) ?? "";
      const parcelas = d.parcelado ? parcelasPorDespesa.get(d.id) ?? [] : [];
      const combos = montarCombosAlcada({
        parcelado: parcelas.length > 0,
        parcelas,
        linhas: [{ contrato_id: linha.contrato_id, valor: linha.valor }],
        valorTotalDespesa: d.valor_total,
        anoMesDespesa,
        fatorValorAprovado: 1,
      });
      const estoura = encontrarComboQueEstouraAlcada(
        combos,
        limitePct,
        (contratoId, mes) => resolverOrcadoMultiMes(d.classificacao_id, contratoId, mes),
        (contratoId, mes) => utilizadoAntesNoMes(d.id, d.classificacao_id, contratoId, mes)
      );
      if (!estoura) continue;
      resultado.push({
        linhaId: linha.id,
        despesaId: d.id,
        numero: d.numero,
        nome: d.nome,
        motivo: d.motivo,
        status: d.status,
        classificacaoNome: d.classificacao?.nome ?? null,
        contratoId: linha.contrato_id!,
        valorLinha: Number(linha.valor) || 0,
        dataPagamento: d.data_pagamento,
        competencia: d.competencia,
      });
    }
    return resultado;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhasRaw, parcelasPorDespesa, utilizadoLinhasGlobal, resolverOrcadoMultiMes]);

  return {
    itens,
    isLoading: carregandoLinhas || carregandoParcelas || carregandoOrcado || carregandoUtilizado,
  };
}

// Só as pendências dos contratos do usuário LOGADO — usada pelo filtro
// "Minhas" de Aprovações.tsx.
export function useMinhasJustificativasPendentes() {
  const { data: meusContratos, isLoading: carregandoContratos } = useMeusContratosAnalista();
  const contratoIds = useMemo(() => (meusContratos ? Array.from(meusContratos) : []), [meusContratos]);
  const nucleo = useJustificativasPendentesDe(contratoIds);
  return { itens: nucleo.itens, isLoading: carregandoContratos || nucleo.isLoading };
}

// TODAS as pendências, de qualquer contrato — usada na tela "Justificativa
// Analistas" (decisão do usuário: visibilidade aberta por ora, pra
// gerente/colega também verem, não só o analista dono do contrato).
export function useTodasJustificativasPendentes() {
  const nucleo = useJustificativasPendentesDe(undefined);
  const contratoIds = useMemo(() => Array.from(new Set(nucleo.itens.map((i) => i.contratoId))), [nucleo.itens]);
  const { data: analistasPorContrato } = useAnalistasDosContratos(contratoIds);
  const itensComResponsavel = useMemo(
    () =>
      nucleo.itens.map((i) => ({
        ...i,
        analistas: analistasPorContrato?.get(i.contratoId) ?? [],
      })),
    [nucleo.itens, analistasPorContrato]
  );
  return { itens: itensComResponsavel, isLoading: nucleo.isLoading };
}

// Conjunto de despesa_id com justificativa pendente do usuário logado — usado
// pelo filtro "Minhas" em Aprovações (SIS-2026-0283: "que contemple a coluna
// de justificativa também... a pessoa vê despesas que estão com a sua
// justificativa pendente").
export function useMinhasDespesasComJustificativaPendente(): Set<string> {
  const { itens } = useMinhasJustificativasPendentes();
  return useMemo(() => new Set(itens.map((i) => i.despesaId)), [itens]);
}
