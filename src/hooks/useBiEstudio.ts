// Estúdio de BI — painéis, widgets, execução de SQL e a IA.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FiltroPainel, Painel, ResultadoSql, Widget, WidgetRascunho } from "@/lib/bi/estudio";

const sb = supabase as any;

export function usePaineisBi() {
  return useQuery<Painel[]>({
    queryKey: ["bi_paineis"],
    queryFn: async () => {
      const { data, error } = await sb.from("BI_PAINEL").select("*").order("atualizado_em", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePainelBi(id: number | null) {
  return useQuery<{ painel: Painel; widgets: Widget[] } | null>({
    queryKey: ["bi_painel", id],
    enabled: !!id,
    queryFn: async () => {
      const { data: painel, error } = await sb.from("BI_PAINEL").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!painel) return null;
      const { data: widgets, error: e2 } = await sb.from("BI_WIDGET").select("*").eq("painel_id", id).order("ordem").order("id");
      if (e2) throw e2;
      return { painel, widgets: widgets ?? [] };
    },
  });
}

export function useSalvarPainelBi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: Partial<Painel> & { id?: number }) => {
      const { id, ...resto } = p;
      if (id) {
        const { data, error } = await sb.from("BI_PAINEL").update(resto).eq("id", id).select("*").single();
        if (error) throw error;
        return data as Painel;
      }
      const { data, error } = await sb.from("BI_PAINEL").insert(resto).select("*").single();
      if (error) throw error;
      return data as Painel;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["bi_paineis"] });
      qc.invalidateQueries({ queryKey: ["bi_painel", p.id] });
    },
  });
}

export function useExcluirPainelBi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from("BI_PAINEL").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bi_paineis"] }),
  });
}

export function useSalvarWidgetBi(painelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (w: Partial<Widget> & { id?: number }) => {
      const { id, ...resto } = w;
      // Campos que só existem no rascunho da IA não vão pro banco.
      const limpo: any = { ...resto };
      delete limpo.explicacao; delete limpo.ok; delete limpo.erro; delete limpo.amostra;
      if (id) {
        const { data, error } = await sb.from("BI_WIDGET").update(limpo).eq("id", id).select("*").single();
        if (error) throw error;
        return data as Widget;
      }
      const { data, error } = await sb.from("BI_WIDGET").insert({ ...limpo, painel_id: painelId }).select("*").single();
      if (error) throw error;
      return data as Widget;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bi_painel", painelId] }),
  });
}

export function useExcluirWidgetBi(painelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from("BI_WIDGET").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bi_painel", painelId] }),
  });
}

/** Reordena: grava `ordem` = posição de cada id. */
export function useReordenarWidgetsBi(painelId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: number[]) => {
      await Promise.all(ids.map((id, i) => sb.from("BI_WIDGET").update({ ordem: i }).eq("id", id)));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bi_painel", painelId] }),
  });
}

/** Dado do widget gravado (quem vê o painel). */
export function useDadosWidgetBi(widgetId: number | null, params: Record<string, string | null>, atualizarSeg?: number) {
  return useQuery<ResultadoSql>({
    queryKey: ["bi_widget_dados", widgetId, params],
    enabled: !!widgetId,
    staleTime: 60_000,
    refetchInterval: atualizarSeg && atualizarSeg > 0 ? atualizarSeg * 1000 : false,
    queryFn: async () => {
      const { data, error } = await sb.rpc("bi_widget_dados", { p_widget_id: widgetId, p_params: params });
      if (error) throw error;
      return data as ResultadoSql;
    },
  });
}

/** SQL livre (o analista, no editor). */
export async function executarSqlBi(sql: string, params: Record<string, string | null> = {}, limite = 500): Promise<ResultadoSql> {
  const { data, error } = await sb.rpc("bi_executar_sql", { p_sql: sql, p_params: params, p_limite: limite });
  if (error) throw new Error(error.message);
  return data as ResultadoSql;
}

export function useCatalogoBi(ativo: boolean) {
  return useQuery<{ nome: string; tipo: "tabela" | "view"; colunas: { nome: string; tipo: string }[] }[]>({
    queryKey: ["bi_catalogo"],
    enabled: ativo,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc("bi_catalogo");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface RespostaIaBi {
  resposta: string;
  painel: { nome: string; descricao: string | null; filtros: FiltroPainel[] } | null;
  widgets: WidgetRascunho[];
  tentativas: number;
  modelo: string;
}

export async function pedirParaIaBi(corpo: {
  pedido: string;
  painel_id?: number | null;
  widget_atual?: Partial<WidgetRascunho> | null;
  filtros?: FiltroPainel[];
  params?: Record<string, string | null>;
  historico?: { role: "user" | "assistant"; content: string }[];
}): Promise<RespostaIaBi> {
  const { data, error } = await supabase.functions.invoke("bi-ia", { body: corpo });
  if (error) {
    // O corpo de erro da function vem em context; sem ele, a mensagem genérica.
    let msg = error.message;
    try {
      const ctx = (error as any).context;
      if (ctx && typeof ctx.json === "function") { const j = await ctx.json(); if (j?.error) msg = j.error; }
    } catch { /* fica a genérica */ }
    throw new Error(msg);
  }
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as RespostaIaBi;
}
