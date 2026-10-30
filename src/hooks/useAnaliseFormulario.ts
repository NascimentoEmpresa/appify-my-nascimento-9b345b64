import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Filtro, LinhaResposta, LinhaTurnover, Respostas } from "../../supabase/functions/_shared/pesquisa-permanencia";

// RH › Pesquisa de Permanência (mig 20261028001200). Tudo por RPC: as tabelas
// não têm policy (anon e authenticated não leem direto). A página pública usa
// pp_publica/pp_responder (anon); a tela do RH, as demais, que cobram o menu
// rh_pesquisa_permanencia. As contas ficam no _shared, igual à Edge Function.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface PostoOpcao { codigo: string; nome: string; funcoes: string[] }
export interface ContratoOpcao { empresa: number; filial: number; nome: string; funcoes: string[]; postos: PostoOpcao[] }
export interface PesquisaPublica {
  encontrada: boolean; aberta?: boolean; titulo?: string;
  inicia_em?: string | null; encerra_em?: string | null;
  contratos?: ContratoOpcao[];
}
export interface Aplicacao {
  id: string; titulo: string; token: string; inicia_em: string | null; encerra_em: string | null;
  ativa: boolean; aberta: boolean; created_at: string; respostas: number;
}
export interface PlanoPesquisa {
  id: string; titulo: string | null; status: string; prioridade: string | null; prazo: string | null;
  responsavel: string | null; created_at: string; aplicacao_id: string | null;
  empresa: number | null; filial: number | null; contrato: string | null;
  posto: string | null; posto_nome: string | null; funcao: string | null; motivo: string | null;
}

export const usePesquisaPublica = (token: string | undefined) => useQuery({
  queryKey: ["pp-publica", token], enabled: !!token, staleTime: 10 * 60_000, retry: 1,
  queryFn: async (): Promise<PesquisaPublica> => {
    const { data, error } = await sb.rpc("pp_publica", { p_token: token });
    if (error) throw new Error(error.message);
    return data as PesquisaPublica;
  },
});

export const useResponderPesquisa = () => useMutation({
  mutationFn: async (p: { token: string; empresa: number; filial: number; posto: string | null; funcao: string; respostas: Respostas }) => {
    const { error } = await sb.rpc("pp_responder", {
      p_token: p.token, p_empresa: p.empresa, p_filial: p.filial, p_posto: p.posto, p_funcao: p.funcao, p_respostas: p.respostas,
    });
    if (error) throw new Error(error.message);
  },
});

const K = ["pesquisa-permanencia"];

export const useAplicacoes = () => useQuery({
  queryKey: [...K, "aplicacoes"], staleTime: 60_000,
  queryFn: async (): Promise<Aplicacao[]> => {
    const { data, error } = await sb.rpc("pp_aplicacoes");
    if (error) throw new Error(error.message);
    return (data ?? []) as Aplicacao[];
  },
});

export function useSalvarAplicacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { id: string | null; titulo: string; inicia_em: string | null; encerra_em: string | null; ativa: boolean }) => {
      const { data, error } = await sb.rpc("pp_aplicacao_salvar", {
        p_id: a.id, p_titulo: a.titulo, p_inicia_em: a.inicia_em, p_encerra_em: a.encerra_em, p_ativa: a.ativa,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: K }),
  });
}

export const useRespostasPesquisa = () => useQuery({
  queryKey: [...K, "respostas"], staleTime: 2 * 60_000,
  queryFn: async (): Promise<LinhaResposta[]> => {
    const { data, error } = await sb.rpc("pp_respostas", { p_aplicacao: null });
    if (error) throw new Error(error.message);
    return (data ?? []) as LinhaResposta[];
  },
});

export const useTurnoverPesquisa = (meses = 12) => useQuery({
  queryKey: [...K, "turnover", meses], staleTime: 10 * 60_000,
  queryFn: async (): Promise<{ meses: string[]; linhas: LinhaTurnover[] }> => {
    const { data, error } = await sb.rpc("pp_turnover", { p_meses: meses });
    if (error) throw new Error(error.message);
    return { meses: data?.meses ?? [], linhas: data?.linhas ?? [] };
  },
});

export const usePlanosPesquisa = () => useQuery({
  queryKey: [...K, "planos"], staleTime: 60_000,
  queryFn: async (): Promise<PlanoPesquisa[]> => {
    const { data, error } = await sb.rpc("pp_planos");
    if (error) throw new Error(error.message);
    return (data ?? []) as PlanoPesquisa[];
  },
});

/** Recorte de onde a ação nasceu (contrato/posto/função da pesquisa). */
export interface OrigemPlano {
  aplicacao_id: string | null; empresa: number | null; filial: number | null; contrato: string | null;
  posto: string | null; posto_nome: string | null; funcao: string | null; motivo: string;
}

/**
 * Cria a ação pelo criar_plano_acao de sempre (Plano de Ações — mesma regra e
 * permissão da tela de lá) e registra a origem na pesquisa.
 */
export function useCriarPlanoPesquisa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: {
      empresaId: string; titulo: string; problema: string; acao: string; area: string | null;
      prioridade: string; responsavel: string; prazo: string | null; origem: OrigemPlano;
    }) => {
      const { data: id, error } = await sb.rpc("criar_plano_acao", {
        _empresa_id: p.empresaId, _titulo: p.titulo, _problema: p.problema || null, _acao: p.acao || null,
        _area: p.area, _setor: p.area, _prioridade_normalizada: p.prioridade, _status_normalizado: "a_definir",
        _responsavel_profile_id: p.responsavel, _data_inicio_planejado: new Date().toISOString().slice(0, 10),
        _data_fim_planejado: p.prazo, _visibilidade: "publico",
        _comentarios: `Gerado pela Pesquisa de Permanência (RH). ${p.origem.motivo}`.slice(0, 1000),
      });
      if (error) throw new Error(error.message);
      const o = p.origem;
      const { error: e2 } = await sb.rpc("pp_vincular_plano", {
        p_plano: id, p_aplicacao: o.aplicacao_id, p_empresa: o.empresa, p_filial: o.filial, p_contrato: o.contrato,
        p_posto: o.posto, p_posto_nome: o.posto_nome, p_funcao: o.funcao, p_motivo: o.motivo,
      });
      if (e2) throw new Error(`A ação foi criada no Plano de Ações, mas não ficou ligada à pesquisa: ${e2.message}`);
      return id as string;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...K, "planos"] }),
  });
}

export type MsgIA = { role: "user" | "assistant"; content: string };

export async function perguntarIA(p: { modo: "analise" | "pergunta"; pergunta?: string; historico?: MsgIA[]; filtro?: Filtro }): Promise<string> {
  const { data, error } = await supabase.functions.invoke("pesquisa-permanencia-ia", { body: p });
  if (error) {
    // A mensagem útil vem no corpo (403 sem acesso, 429 sem tokens).
    const ctx = (error as { context?: Response }).context;
    const corpo = ctx && typeof ctx.json === "function" ? await ctx.json().catch(() => null) : null;
    throw new Error(corpo?.error ?? error.message);
  }
  if (data?.error) throw new Error(data.error);
  return String(data?.texto ?? "");
}
