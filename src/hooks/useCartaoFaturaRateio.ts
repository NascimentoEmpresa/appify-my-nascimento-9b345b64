import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0568: Classificação + Contrato por item da fatura do Cartão de
// Crédito, podendo dividir (rateio) 1 item entre várias linhas — mesmo
// espírito de malote_despesa_rateio_linha (useMaloteDespesa.ts), mas sem a
// bagagem de orçamento/aprovação/parcelas que o Malote carrega. Delete-then-
// insert client-side, com a permissão resolvida pela RLS
// (cartao_fatura_pode_classificar) — mesmo padrão já usado lá, sem RPC.

const KEY = "malote_cartao_fatura_item_rateio";

export interface RateioItemLinha {
  id?: string;
  classificacao_id: string;
  contrato_id: string | null;
  percentual: number | null;
  valor: number;
  ordem: number;
}

export function useRateioItemFatura(itemId: string | null) {
  return useQuery({
    queryKey: [KEY, itemId],
    enabled: !!itemId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("malote_cartao_fatura_item_rateio")
        .select("id, classificacao_id, contrato_id, percentual, valor, ordem")
        .eq("item_id", itemId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as RateioItemLinha[];
    },
  });
}

// Tela "Classificar Lançamentos de Cartão" (SIS-2026-0568): busca todos os
// itens confirmados — a RLS (malote_cartao_fatura_item_select_autorizado)
// já devolve só os dos cartões em que o usuário está em
// usuarios_classificar_ids (ou tem 'visualizar' no módulo inteiro), sem
// precisar filtrar aqui.
export interface ItemParaClassificar {
  id: string;
  descricao: string;
  data_compra: string | null;
  valor: number;
  parcela_atual: number | null;
  parcela_total: number | null;
  cartao_id: string;
  nome_cartao: string;
  competencia: string;
  qtd_rateio: number;
}

export function useItensParaClassificar() {
  return useQuery({
    queryKey: [KEY, "para_classificar"],
    queryFn: async () => {
      const [itensRes, rateiosRes] = await Promise.all([
        (supabase as any)
          .from("malote_cartao_fatura_item")
          .select(
            "id, descricao, data_compra, valor, parcela_atual, parcela_total, " +
              "malote_cartao_fatura(competencia, cartao_id, malote_cartao_credito(nome_cartao))",
          )
          .eq("status", "confirmado")
          .order("data_compra", { ascending: false }),
        (supabase as any).from("malote_cartao_fatura_item_rateio").select("item_id"),
      ]);
      if (itensRes.error) throw itensRes.error;
      if (rateiosRes.error) throw rateiosRes.error;

      const qtdPorItem = new Map<string, number>();
      for (const r of rateiosRes.data ?? []) {
        qtdPorItem.set(r.item_id, (qtdPorItem.get(r.item_id) ?? 0) + 1);
      }

      return (itensRes.data ?? []).map((i: any) => ({
        id: i.id,
        descricao: i.descricao,
        data_compra: i.data_compra,
        valor: i.valor,
        parcela_atual: i.parcela_atual,
        parcela_total: i.parcela_total,
        cartao_id: i.malote_cartao_fatura?.cartao_id ?? "",
        nome_cartao: i.malote_cartao_fatura?.malote_cartao_credito?.nome_cartao ?? "—",
        competencia: i.malote_cartao_fatura?.competencia ?? "",
        qtd_rateio: qtdPorItem.get(i.id) ?? 0,
      })) as ItemParaClassificar[];
    },
  });
}

export function useSalvarRateioItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, linhas }: { itemId: string; linhas: RateioItemLinha[] }) => {
      const { error: erroDelete } = await (supabase as any)
        .from("malote_cartao_fatura_item_rateio")
        .delete()
        .eq("item_id", itemId);
      if (erroDelete) throw erroDelete;

      if (linhas.length > 0) {
        const rows = linhas.map(({ id: _id, ...l }, i) => ({ ...l, item_id: itemId, ordem: i }));
        const { error: erroInsert } = await (supabase as any).from("malote_cartao_fatura_item_rateio").insert(rows);
        if (erroInsert) throw erroInsert;
      }
    },
    onSuccess: (_data, { itemId }) => {
      qc.invalidateQueries({ queryKey: [KEY, itemId] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    },
  });
}
