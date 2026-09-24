import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0160: início do Fluxo de Caixa (Financeiro > Gestão Financeira).
// Lê direto de v_malote_pagamento_fluxo_caixa (20260907000002), que já
// resolve os nomes de empresa/contrato/classificação — sem join no
// client.
//
// SIS-2026-0254 (achado ao implementar "qual parcela está sendo paga"):
// despesa NÃO parcelada continua 1 linha só, quando fica despesa_paga; se
// for estornada/cancelada depois, a linha some sozinha. Despesa PARCELADA
// virou 1 linha por PARCELA PAGA (malote_despesa_parcela.status = 'paga'),
// cada uma com a data/valor reais daquela parcela — antes só aparecia 1x,
// no fim, com o valor cheio da despesa na data da última parcela (distorção
// real de Fluxo de Caixa/Fatura do Mês do cartão, não só falta de coluna).
export interface FluxoCaixaMaloteLinha {
  despesa_id: string;
  id_malote: string;
  data_pagamento: string | null;
  competencia: string | null;
  empresa_id: string | null;
  empresa_nome: string | null;
  contrato_id: string | null;
  contrato_nome: string | null;
  classificacao_id: string | null;
  classificacao_nome: string | null;
  descricao: string;
  forma_pagamento: string | null;
  // SIS-2026-0307: banco usado no pagamento (catálogo malote_cartao_banco,
  // reaproveitado do Cartão de Crédito) — a view já resolve o nome, sem
  // join no client.
  banco_id: string | null;
  banco_nome: string | null;
  banco_logo_path: string | null;
  // SIS-2026-0254: despesa parcelada agora entra 1 linha por PARCELA PAGA
  // (não mais 1 linha só no fim) — os dois vêm null pra despesa não
  // parcelada.
  numero_parcela: number | null;
  numero_parcelas: number | null;
  valor: number;
  // SIS-2026-0256: até então só existia saída (Malote); Débito Automático
  // soma entrada também (Nota Recebida, Movimentação Financeira "linha de
  // entrada").
  tipo: "entrada" | "saida";
  // SIS-2026-0413: de qual tabela/RPC esta linha vem — usado pra escolher
  // o botão/mutation certos de Excluir na tela de Fluxo de Caixa.
  // SIS-2026-0473: "aplicacao_financeira" cobre tanto a saída (aplicar)
  // quanto a entrada (resgate) — as duas views compartilham o mesmo
  // despesa_id só pra aplicar (id da APLICACAO_FINANCEIRA); resgate usa o
  // id do próprio resgate (não tem edição/exclusão pela tela de Fluxo, só
  // pela tela de Aplicações Financeiras).
  origem: "malote" | "debito_automatico" | "cartao_fatura" | "aplicacao_financeira";
  // SIS-2026-0489: true quando existe uma linha em
  // financeiro_fluxo_caixa_ajuste pra este lançamento — os campos exibidos
  // já vêm resolvidos pela view (COALESCE(ajuste, original)), este flag é
  // só pra tela avisar visualmente que aquele valor foi editado só aqui,
  // sem mudar o lançamento original.
  ajustado: boolean;
}

export function useFluxoCaixaMalote() {
  return useQuery({
    queryKey: ["fluxo_caixa_malote"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_malote_pagamento_fluxo_caixa")
        .select("*")
        .order("data_pagamento", { ascending: false });
      if (error) throw error;
      return (data ?? []) as FluxoCaixaMaloteLinha[];
    },
  });
}

// SIS-2026-0256/0255: fonte combinada da tela /app/financeiro/gestao-
// financeira/fluxo-caixa — Pagamento Malote (só saída) + Débito Automático
// (entrada e saída, itens "pago" que não passam pelo Malote) + fatura de
// Cartão de Crédito importada (SIS-2026-0255, saída, itens confirmados que
// também não passam pelo Malote). Colunas alinhadas 1:1 nas 3 views — dá
// pra concatenar direto sem transformação. A tela de Cartão de Crédito em
// si continua só com a fonte do Malote (useFluxoCaixaMalote), que é o que
// calcularUtilizadoEFatura usa — fatura importada não conta pro "Utilizado"
// do card, é lançamento próprio.
export function useFluxoCaixaCombinado() {
  return useQuery({
    queryKey: ["fluxo_caixa_combinado"],
    queryFn: async () => {
      // SIS-2026-0473: Aplicações Financeiras entra como DUAS views — aplicar
      // (saída) e resgate (entrada) — pelo mesmo motivo de não dar pra
      // representar as duas pontas de uma "aplicação com resgate" numa
      // linha só (datas e tipos diferentes), mesma ideia da Movimentação
      // Financeira do Débito Automático (2 linhas ligadas por par).
      const [malote, debitoAutomatico, cartaoFatura, aplicacaoFinanceira, resgateAplicacao] = await Promise.all([
        (supabase as any).from("v_malote_pagamento_fluxo_caixa").select("*"),
        (supabase as any).from("v_debito_automatico_fluxo_caixa").select("*"),
        (supabase as any).from("v_cartao_fatura_fluxo_caixa").select("*"),
        (supabase as any).from("v_aplicacao_financeira_fluxo_caixa").select("*"),
        (supabase as any).from("v_aplicacao_financeira_resgate_fluxo_caixa").select("*"),
      ]);
      if (malote.error) throw malote.error;
      if (debitoAutomatico.error) throw debitoAutomatico.error;
      if (cartaoFatura.error) throw cartaoFatura.error;
      if (aplicacaoFinanceira.error) throw aplicacaoFinanceira.error;
      if (resgateAplicacao.error) throw resgateAplicacao.error;
      const linhas = [
        ...(malote.data ?? []),
        ...(debitoAutomatico.data ?? []),
        ...(cartaoFatura.data ?? []),
        ...(aplicacaoFinanceira.data ?? []),
        ...(resgateAplicacao.data ?? []),
      ] as FluxoCaixaMaloteLinha[];
      linhas.sort((a, b) => (b.data_pagamento ?? "").localeCompare(a.data_pagamento ?? ""));
      return linhas;
    },
  });
}

// SIS-2026-0489: valores que sobrescrevem a linha SÓ no Fluxo de Caixa
// (financeiro_fluxo_caixa_ajuste) — a tabela de origem (malote_despesa/
// "DEBITO_AUTOMATICO"/malote_cartao_fatura_item) nunca é tocada. `undefined`
// num campo = "não mudar esse campo"; `null` = "apagar o ajuste e voltar
// pro valor original" (usado pelo botão de reverter, campo a campo).
export interface AjusteFluxoCaixaInput {
  origem: FluxoCaixaMaloteLinha["origem"];
  despesaId: string;
  numeroParcela: number | null;
  dataPagamento?: string | null;
  tipo?: "entrada" | "saida" | null;
  classificacaoId?: string | null;
  descricao?: string | null;
  competencia?: string | null;
  empresaId?: string | null;
  bancoId?: string | null;
  formaPagamento?: string | null;
  // SIS-2026-0492: adicionado depois do SIS-2026-0489 original — a
  // conciliação com o Fluxo de Caixa interno precisa poder corrigir o
  // valor de um lançamento (divergência de "VALOR SIMILAR"), coisa que o
  // pedido original de edição de linha não previa.
  valor?: number | null;
}

// Upsert manual (não usa .upsert()/on_conflict do PostgREST): numero_parcela
// é NULL na maioria dos casos (malote não-parcelado, débito automático), e
// NULL nunca "conflita" com NULL num ON CONFLICT — o upsert nativo criaria
// uma linha de ajuste nova a cada edição em vez de atualizar a existente.
export function useAjustarLinhaFluxoCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AjusteFluxoCaixaInput) => {
      const { origem, despesaId, numeroParcela, ...campos } = input;
      let q = (supabase as any)
        .from("financeiro_fluxo_caixa_ajuste")
        .select("id")
        .eq("origem", origem)
        .eq("despesa_id", despesaId);
      q = numeroParcela == null ? q.is("numero_parcela", null) : q.eq("numero_parcela", numeroParcela);
      const { data: existente, error: errBusca } = await q.maybeSingle();
      if (errBusca) throw errBusca;

      const payload = {
        data_pagamento: campos.dataPagamento,
        tipo: campos.tipo,
        classificacao_id: campos.classificacaoId,
        descricao: campos.descricao,
        competencia: campos.competencia,
        empresa_id: campos.empresaId,
        banco_id: campos.bancoId,
        forma_pagamento: campos.formaPagamento,
        valor: campos.valor,
      };
      // Só grava os campos que quem chamou de fato passou — os outros
      // continuam com o que já estava salvo no ajuste (ou null, se for
      // linha nova).
      const camposPresentes = Object.fromEntries(
        Object.entries(payload).filter(([, v]) => v !== undefined),
      );

      if (existente) {
        const { error } = await (supabase as any)
          .from("financeiro_fluxo_caixa_ajuste")
          .update(camposPresentes)
          .eq("id", existente.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("financeiro_fluxo_caixa_ajuste")
          .insert({ origem, despesa_id: despesaId, numero_parcela: numeroParcela, ...camposPresentes });
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] }),
  });
}

// Apaga a linha de ajuste inteira — a linha volta a mostrar 100% do valor
// original (não dá pra reverter campo a campo por aqui; quem editou um
// campo errado edita ele de novo, com o valor certo).
export function useReverterAjusteFluxoCaixa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ origem, despesaId, numeroParcela }: Pick<AjusteFluxoCaixaInput, "origem" | "despesaId" | "numeroParcela">) => {
      let q = (supabase as any)
        .from("financeiro_fluxo_caixa_ajuste")
        .delete()
        .eq("origem", origem)
        .eq("despesa_id", despesaId);
      q = numeroParcela == null ? q.is("numero_parcela", null) : q.eq("numero_parcela", numeroParcela);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] }),
  });
}
