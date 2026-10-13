import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chaveFatura } from "@/pages/financeiro/cartao-credito/faturaConsolidada";

// SIS-2026-0632: faturas do cartão com "fatura consolidada no Fluxo" (Sicredi
// 2719). A soma das despesas vem da view consolidada do Fluxo (o mesmo número que a
// linha do Fluxo mostra); o valor real da fatura e o boleto ficam em
// malote_cartao_fatura (mesma tabela/permissão 'financeiro-cartao-credito' da
// importação de fatura — sem menu nem ação novos).

const BUCKET = "cartao-faturas";
const KEY = "cartao_fatura_consolidada";
const FATURAS_INFORMADAS_KEY = "cartao_fatura_valores_informados";

export interface FaturaConsolidadaLinha {
  chave: string;
  cartao_id: string;
  fatura_mes: string; // yyyy-mm-01
  vencimento: string; // yyyy-mm-dd (data da linha do Fluxo)
  despesas: number;
  soma: number;
  valor_informado: number | null;
  boleto_path: string | null;
  boleto_nome: string | null;
}

interface FaturaRow {
  cartao_id: string;
  competencia: string;
  valor_fatura_informado: number | null;
  boleto_path: string | null;
  boleto_nome: string | null;
}

async function buscarFaturasRows(): Promise<FaturaRow[]> {
  const { data, error } = await (supabase as any)
    .from("malote_cartao_fatura")
    .select("cartao_id, competencia, valor_fatura_informado, boleto_path, boleto_nome");
  if (error) {
    // migration 20261008000005 ainda não aplicada (coluna ausente) ou sem acesso
    if (error.code === "42703" || error.code === "PGRST205") return [];
    throw error;
  }
  return (data ?? []) as FaturaRow[];
}

// Só os valores informados, por chave cartão+mês — usado pelo Fluxo para a
// comparação ao lado da linha da fatura. Sem acesso à tabela vira mapa vazio.
export function useFaturasInformadas() {
  return useQuery({
    queryKey: [FATURAS_INFORMADAS_KEY],
    staleTime: 60_000,
    queryFn: async () => {
      const rows = await buscarFaturasRows().catch(() => [] as FaturaRow[]);
      const mapa = new Map<string, number>();
      for (const r of rows) if (r.valor_fatura_informado != null) mapa.set(chaveFatura(r.cartao_id, r.competencia), Number(r.valor_fatura_informado));
      return mapa;
    },
  });
}

// Faturas (cartão × mês) com a soma das despesas e o que já foi informado.
export function useFaturasConsolidadas() {
  return useQuery({
    queryKey: [KEY],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("v_malote_pagamento_fluxo_caixa_consolidado")
        .select("despesa_id_origem, fatura_cartao_id, fatura_mes, data_pagamento, valor")
        .not("fatura_cartao_id", "is", null)
        .limit(20000);
      if (error) {
        if (error.code === "42703" || error.code === "PGRST205" || error.code === "42P01") return [] as FaturaConsolidadaLinha[];
        throw error;
      }
      const grupos = new Map<string, { cartao_id: string; fatura_mes: string; vencimento: string; desp: Set<string>; soma: number }>();
      for (const l of (data ?? []) as any[]) {
        const chave = chaveFatura(l.fatura_cartao_id, l.fatura_mes);
        let g = grupos.get(chave);
        if (!g) {
          g = { cartao_id: l.fatura_cartao_id, fatura_mes: l.fatura_mes, vencimento: l.data_pagamento, desp: new Set(), soma: 0 };
          grupos.set(chave, g);
        }
        g.desp.add(`${l.despesa_id_origem}`);
        g.soma += Number(l.valor) || 0;
      }
      const faturas = await buscarFaturasRows();
      const porChave = new Map(faturas.map((f) => [chaveFatura(f.cartao_id, f.competencia), f]));
      return Array.from(grupos.entries())
        .map(([chave, g]) => {
          const f = porChave.get(chave);
          return {
            chave,
            cartao_id: g.cartao_id,
            fatura_mes: g.fatura_mes,
            vencimento: g.vencimento,
            despesas: g.desp.size,
            soma: Math.round(g.soma * 100) / 100,
            valor_informado: f?.valor_fatura_informado != null ? Number(f.valor_fatura_informado) : null,
            boleto_path: f?.boleto_path ?? null,
            boleto_nome: f?.boleto_nome ?? null,
          } as FaturaConsolidadaLinha;
        })
        .sort((a, b) => b.fatura_mes.localeCompare(a.fatura_mes));
    },
  });
}

function useInvalidarFaturas() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: [KEY] });
    qc.invalidateQueries({ queryKey: [FATURAS_INFORMADAS_KEY] });
    qc.invalidateQueries({ queryKey: ["malote_cartao_fatura"] });
  };
}

// Grava o valor real da fatura (cria a linha da fatura se ainda não existe).
export function useSalvarValorFatura() {
  const invalidar = useInvalidarFaturas();
  return useMutation({
    mutationFn: async ({ cartaoId, faturaMes, valor }: { cartaoId: string; faturaMes: string; valor: number | null }) => {
      const { error } = await (supabase as any)
        .from("malote_cartao_fatura")
        .upsert({ cartao_id: cartaoId, competencia: faturaMes, valor_fatura_informado: valor }, { onConflict: "cartao_id,competencia" });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useAnexarBoletoFatura() {
  const invalidar = useInvalidarFaturas();
  return useMutation({
    mutationFn: async ({ cartaoId, faturaMes, arquivo, caminhoAnterior }: { cartaoId: string; faturaMes: string; arquivo: File; caminhoAnterior?: string | null }) => {
      const ext = arquivo.name.split(".").pop() ?? "pdf";
      const path = `boletos/${cartaoId}/${faturaMes.slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, arquivo, { upsert: false });
      if (upErr) throw upErr;
      const { data: user } = await supabase.auth.getUser();
      const { error } = await (supabase as any)
        .from("malote_cartao_fatura")
        .upsert(
          {
            cartao_id: cartaoId,
            competencia: faturaMes,
            boleto_path: path,
            boleto_nome: arquivo.name,
            boleto_anexado_em: new Date().toISOString(),
            boleto_anexado_por: user.user?.id ?? null,
          },
          { onConflict: "cartao_id,competencia" },
        );
      if (error) {
        await supabase.storage.from(BUCKET).remove([path]);
        throw error;
      }
      if (caminhoAnterior) await supabase.storage.from(BUCKET).remove([caminhoAnterior]);
    },
    onSuccess: invalidar,
  });
}

export function useRemoverBoletoFatura() {
  const invalidar = useInvalidarFaturas();
  return useMutation({
    mutationFn: async ({ cartaoId, faturaMes, caminho }: { cartaoId: string; faturaMes: string; caminho: string }) => {
      const { error } = await (supabase as any)
        .from("malote_cartao_fatura")
        .update({ boleto_path: null, boleto_nome: null, boleto_anexado_em: null, boleto_anexado_por: null })
        .eq("cartao_id", cartaoId)
        .eq("competencia", faturaMes);
      if (error) throw error;
      await supabase.storage.from(BUCKET).remove([caminho]);
    },
    onSuccess: invalidar,
  });
}

export async function urlBoletoFatura(caminho: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(caminho, 300);
  if (error || !data?.signedUrl) throw error ?? new Error("Não foi possível abrir o boleto.");
  return data.signedUrl;
}
