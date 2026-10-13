import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useScreenAccess } from "@/hooks/useScreenAccess";
import {
  prepararColaborador,
  type BaseEfet, type ColaboradorPrep, type Diarista, type EventoOcorrencia, type MotivoOcorrencia,
  type Ocorrencia, type StatusCobertura,
} from "@/lib/efetividade";

// =====================================================================
// Operacional › Efetividade e Coberturas — acesso a dados (mig
// 20261008000030). O espelho da Senior não é exposto à API: só a RPC
// ope_efet_base (SECURITY DEFINER) lê as batidas. As tabelas OPE_EFET_* são
// lidas pela RLS (visualizar) e escritas só pelas RPCs (alterar).
// =====================================================================

export const MENU_EFETIVIDADE = "ope_efetividade";

type Resp<T> = Promise<{ data: T | null; error: { message: string } | null }>;
type ChamadaRpc = <T>(fn: string, args?: Record<string, unknown>) => Resp<T>;
const sb = supabase as unknown as {
  rpc: ChamadaRpc;
  from: (t: string) => {
    select: (c: string) => {
      gte: (c: string, v: string) => { lte: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => Resp<unknown[]> } };
      eq: (c: string, v: string | number) => { order: (c: string, o: { ascending: boolean }) => Resp<unknown[]> };
      in: (c: string, v: (string | number)[]) => { order: (c: string, o: { ascending: boolean }) => Resp<unknown[]> };
    };
  };
};

const vazio = (ini: string, fim: string): BaseEfet => ({
  disponivel: false, inicio: ini, fim, sincronizado_ate: null, ultima_sincronizacao: null, gerado_em: "", contratos: [], colaboradores: [],
});

/** Colaboradores + batidas do período (a empresa toda, ou só um contrato). */
export function useEfetBase(ini: string | null, fim: string | null, empresa: number | null = null, filial: number | null = null) {
  const q = useQuery({
    queryKey: ["efetividade", "base", ini, fim, empresa, filial],
    enabled: !!ini && !!fim,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BaseEfet> => {
      const { data, error } = await sb.rpc<BaseEfet>("ope_efet_base", {
        p_ini: ini, p_fim: fim, p_empresa: empresa, p_filial: filial,
      });
      if (error) throw error;
      return data ?? vazio(ini!, fim!);
    },
  });
  const preps: ColaboradorPrep[] = useMemo(() => (q.data?.colaboradores ?? []).map(prepararColaborador), [q.data]);
  return { ...q, preps };
}

export function useEfetOcorrencias(ini: string | null, fim: string | null) {
  return useQuery({
    queryKey: ["efetividade", "ocorrencias", ini, fim],
    enabled: !!ini && !!fim,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.from("OPE_EFET_OCORRENCIA").select("*").gte("data", ini!).lte("data", fim!).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Ocorrencia[];
    },
  });
}

export function useEfetEventos(ocorrenciaId: number | null) {
  return useQuery({
    queryKey: ["efetividade", "eventos", ocorrenciaId],
    enabled: ocorrenciaId != null,
    queryFn: async () => {
      const { data, error } = await sb.from("OPE_EFET_EVENTO").select("*").eq("ocorrencia_id", ocorrenciaId!).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as EventoOcorrencia[];
    },
  });
}

export function useEfetDiaristas(ini: string | null = null, fim: string | null = null) {
  return useQuery({
    queryKey: ["efetividade", "diaristas", ini, fim],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await sb.rpc<Diarista[]>("ope_efet_diaristas", { p_ini: ini, p_fim: fim });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface ObsPosto { id: number; empresa: number | null; filial: number | null; posto: string; texto: string; autor_id: string | null; autor_nome: string | null; created_at: string }

export function useEfetObsPosto(posto: string | null) {
  return useQuery({
    queryKey: ["efetividade", "obs", posto],
    enabled: !!posto,
    queryFn: async () => {
      const { data, error } = await sb.from("OPE_EFET_POSTO_OBS").select("*").eq("posto", posto!).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ObsPosto[];
    },
  });
}

export const usePodeAlterarEfetividade = () => useScreenAccess(MENU_EFETIVIDADE, "alterar").data === true;

// ---- Mutações ----------------------------------------------------------------

export interface NovaOcorrencia {
  data: string; empresa?: number | null; filial?: number | null; contrato?: string | null;
  posto_codigo?: string | null; posto_nome?: string | null; turno?: string | null; horario_previsto?: number | null;
  empregado_id?: number | null; empregado_nome?: string | null; motivo: MotivoOcorrencia; origem: "ponto" | "manual";
  observacao?: string | null;
}

export function useEfetAcoes() {
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: ["efetividade"], predicate: (q) => q.queryKey[1] !== "base" });
  const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await sb.rpc<T>(fn, args);
    if (error) throw new Error(error.message);
    return data as T;
  };

  const registrar = useMutation({
    mutationFn: (p: NovaOcorrencia) => rpc<number>("ope_efet_registrar", { p }),
    onSuccess: invalidar,
  });
  const acionar = useMutation({
    mutationFn: (a: { id: number; tipo: "diarista" | "colaborador"; empregadoId?: number | null; diaristaId?: number | null; nome?: string | null; telefone?: string | null; observacao?: string | null }) =>
      rpc<void>("ope_efet_acionar", {
        p_id: a.id, p_tipo: a.tipo, p_empregado_id: a.empregadoId ?? null, p_diarista_id: a.diaristaId ?? null,
        p_nome: a.nome ?? null, p_telefone: a.telefone ?? null, p_observacao: a.observacao ?? null,
      }),
    onSuccess: invalidar,
  });
  const status = useMutation({
    mutationFn: (a: { id: number; status: StatusCobertura; observacao?: string | null }) =>
      rpc<void>("ope_efet_status", { p_id: a.id, p_status: a.status, p_observacao: a.observacao ?? null }),
    onSuccess: invalidar,
  });
  const salvarDiarista = useMutation({
    mutationFn: (p: Partial<Diarista>) => rpc<number>("ope_efet_diarista_salvar", { p }),
    onSuccess: invalidar,
  });
  const adicionarObs = useMutation({
    mutationFn: (a: { empresa: number | null; filial: number | null; posto: string; texto: string }) =>
      rpc<number>("ope_efet_obs_adicionar", { p_empresa: a.empresa, p_filial: a.filial, p_posto: a.posto, p_texto: a.texto }),
    onSuccess: invalidar,
  });
  const removerObs = useMutation({
    mutationFn: (id: number) => rpc<void>("ope_efet_obs_remover", { p_id: id }),
    onSuccess: invalidar,
  });

  /** Registra (se ainda não existe) e devolve o id da ocorrência. */
  const garantirOcorrencia = async (o: Ocorrencia | null, nova: NovaOcorrencia) => o?.id ?? (await registrar.mutateAsync(nova));

  return { registrar, acionar, status, salvarDiarista, adicionarObs, removerObs, garantirOcorrencia };
}
