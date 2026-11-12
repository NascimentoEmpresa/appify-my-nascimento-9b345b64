import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BUCKET_CLASSIFICACAO_CARTAO, caminhoAnexoClassificacao, type AnexoClassificacao } from "@/lib/cartaoFatura/anexosClassificacao";

// SIS-2026-0568: Classificação + Contrato por item da fatura do Cartão de
// Crédito, podendo dividir (rateio) 1 item entre várias linhas — mesmo
// espírito de malote_despesa_rateio_linha (useMaloteDespesa.ts), mas sem a
// bagagem de orçamento/aprovação/parcelas que o Malote carrega. Delete-then-
// insert client-side, com a permissão resolvida pela RLS
// (cartao_fatura_pode_classificar) — mesmo padrão já usado lá, sem RPC.

const KEY = "malote_cartao_fatura_item_rateio";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tabelas/RPCs fora do types.ts gerado (SIS-2026-0879: um cast só para o arquivo)
const db = supabase as any;

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
      const { data, error } = await db
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
  /** SIS-2026-0879: anexos (NF, prints) e observação gravados ao classificar. */
  qtd_anexos: number;
  tem_observacao: boolean;
}

// Linha crua do select de useItensParaClassificar (fatura e cartão vêm aninhados).
interface ItemBruto {
  id: string;
  descricao: string;
  data_compra: string | null;
  valor: number;
  parcela_atual: number | null;
  parcela_total: number | null;
  malote_cartao_fatura?: { competencia?: string; cartao_id?: string; malote_cartao_credito?: { nome_cartao?: string } | null } | null;
}

export function useItensParaClassificar() {
  return useQuery({
    queryKey: [KEY, "para_classificar"],
    queryFn: async () => {
      const [itensRes, rateiosRes, complRes] = await Promise.all([
        db
          .from("malote_cartao_fatura_item")
          .select(
            "id, descricao, data_compra, valor, parcela_atual, parcela_total, " +
              "malote_cartao_fatura(competencia, cartao_id, malote_cartao_credito(nome_cartao))",
          )
          .eq("status", "confirmado")
          // SIS-2026-0751: valor <= 0 (pagamento da fatura anterior, estorno) não entra na fatura do Fluxo
          // nem tem o que ratear (o rateio exige valor >= 0) — fora da lista de classificação.
          .gt("valor", 0)
          .order("data_compra", { ascending: false }),
        db.from("malote_cartao_fatura_item_rateio").select("item_id"),
        // SIS-2026-0879: só o que a lista precisa para o ícone (quantos anexos, se tem observação).
        db.from("malote_cartao_fatura_item_complemento").select("item_id, observacao, anexos"),
      ]);
      if (itensRes.error) throw itensRes.error;
      if (rateiosRes.error) throw rateiosRes.error;
      // Tabela ainda não criada (frontend publicado antes da migration 20261112210000): a lista segue sem os ícones.
      if (complRes.error && !["42P01", "PGRST205"].includes(complRes.error.code)) throw complRes.error;

      const complPorItem = new Map<string, { qtd: number; obs: boolean }>();
      for (const c of complRes.data ?? []) {
        complPorItem.set(c.item_id, { qtd: Array.isArray(c.anexos) ? c.anexos.length : 0, obs: !!String(c.observacao ?? "").trim() });
      }

      const qtdPorItem = new Map<string, number>();
      for (const r of rateiosRes.data ?? []) {
        qtdPorItem.set(r.item_id, (qtdPorItem.get(r.item_id) ?? 0) + 1);
      }

      return ((itensRes.data ?? []) as ItemBruto[]).map((i) => ({
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
        qtd_anexos: complPorItem.get(i.id)?.qtd ?? 0,
        tem_observacao: complPorItem.get(i.id)?.obs ?? false,
      })) as ItemParaClassificar[];
    },
  });
}

export function useSalvarRateioItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, linhas }: { itemId: string; linhas: RateioItemLinha[] }) => {
      const { error: erroDelete } = await db
        .from("malote_cartao_fatura_item_rateio")
        .delete()
        .eq("item_id", itemId);
      if (erroDelete) throw erroDelete;

      if (linhas.length > 0) {
        const rows = linhas.map(({ id: _id, ...l }, i) => ({ ...l, item_id: itemId, ordem: i }));
        const { error: erroInsert } = await db.from("malote_cartao_fatura_item_rateio").insert(rows);
        if (erroInsert) throw erroInsert;
      }
    },
    onSuccess: (_data, { itemId }) => {
      qc.invalidateQueries({ queryKey: [KEY, itemId] });
      qc.invalidateQueries({ queryKey: ["fluxo_caixa_combinado"] });
    },
  });
}

// ── SIS-2026-0879: observação + anexos (NF, prints) do item ─────────────────
// Leitura pela RLS (mesma regra do rateio); escrita só pela RPC cartao_fatura_item_salvar_complemento
// (migration 20261112210000), que confere cada caminho e cada arquivo no storage.

export interface ComplementoItemFatura {
  observacao: string;
  anexos: AnexoClassificacao[];
}

export function useComplementoItemFatura(itemId: string | null) {
  return useQuery({
    queryKey: [KEY, "complemento", itemId],
    enabled: !!itemId,
    queryFn: async (): Promise<ComplementoItemFatura> => {
      const { data, error } = await db
        .from("malote_cartao_fatura_item_complemento")
        .select("observacao, anexos")
        .eq("item_id", itemId)
        .maybeSingle();
      // Antes da migration rodar a tabela não existe: o diálogo abre vazio em vez de quebrar.
      if (error && !["42P01", "PGRST205"].includes(error.code)) throw error;
      return { observacao: data?.observacao ?? "", anexos: (data?.anexos ?? []) as AnexoClassificacao[] };
    },
  });
}

export function useSalvarComplementoItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: { itemId: string; observacao: string; manter: AnexoClassificacao[]; removidos: AnexoClassificacao[]; arquivos: File[] }) => {
      // Um arquivo por vez (cada upload é uma conexão do pool do Storage). Se algo falhar, apaga os que já
      // subiram e nada é gravado.
      const novos: AnexoClassificacao[] = [];
      const agora = Date.now();
      try {
        for (const [indice, f] of i.arquivos.entries()) {
          const path = caminhoAnexoClassificacao(i.itemId, f.name, indice, agora);
          const { error } = await supabase.storage.from(BUCKET_CLASSIFICACAO_CARTAO).upload(path, f, { contentType: f.type || undefined, upsert: false });
          if (error) throw new Error(`Não foi possível anexar "${f.name}": ${error.message}`);
          novos.push({ nome: f.name, path, tipo: f.type || null, tamanho: f.size });
        }
        const { error } = await db.rpc("cartao_fatura_item_salvar_complemento", {
          _item_id: i.itemId,
          _observacao: i.observacao,
          _anexos: [...i.manter, ...novos],
        });
        if (error) throw new Error(error.message);
      } catch (e) {
        if (novos.length) await supabase.storage.from(BUCKET_CLASSIFICACAO_CARTAO).remove(novos.map((a) => a.path)).catch(() => undefined);
        throw e;
      }
      // Os removidos já saíram do complemento: agora a policy deixa apagar o arquivo. Falhar aqui não desfaz nada.
      if (i.removidos.length) await supabase.storage.from(BUCKET_CLASSIFICACAO_CARTAO).remove(i.removidos.map((a) => a.path)).catch(() => undefined);
    },
    onSuccess: (_data, { itemId }) => {
      qc.invalidateQueries({ queryKey: [KEY, "complemento", itemId] });
      qc.invalidateQueries({ queryKey: [KEY, "para_classificar"] });
    },
  });
}

/**
 * Bytes do anexo pelo download autenticado (como os anexos de chamado e do Controle de Faturamento): quem chama
 * reserva a aba ainda no clique, senão o bloqueador de pop-up barra o window.open depois do await.
 */
export async function obterAnexoClassificacao(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET_CLASSIFICACAO_CARTAO).download(path);
  if (error || !data) throw new Error(error?.message ? `O servidor não entregou o arquivo (${error.message}). Tente de novo em instantes.` : "O servidor não entregou o arquivo. Tente de novo em instantes.");
  if (data.size === 0) throw new Error("O arquivo está vazio no servidor.");
  return data;
}
