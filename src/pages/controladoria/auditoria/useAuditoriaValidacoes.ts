import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StatusValidacao, TipoValidacao } from "./regras";

// SIS-2026-0553: decisões da Controladoria. Leitura direto das tabelas (RLS por
// can_access); escrita SEMPRE pela RPC auditoria_registrar (ela valida
// permissão, grava histórico e notifica o responsável).

export interface ValidacaoRow {
  id: string;
  periodo: string;
  empresa_id: string | null;
  tipo: TipoValidacao;
  status: StatusValidacao;
  justificativa: string | null;
  observacao: string | null;
  valores: { a?: number; b?: number } | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
}

export interface HistoricoRow {
  id: string;
  periodo: string;
  empresa_id: string | null;
  tipo: TipoValidacao | null;
  acao: "aprovado" | "rejeitado" | "reaberto" | "revisao_solicitada" | "observacao";
  status_anterior: string | null;
  status_novo: string | null;
  justificativa: string | null;
  observacao: string | null;
  user_nome: string | null;
  created_at: string;
}

export interface ResponsavelRow { tipo: TipoValidacao; user_ids: string[]; nomes: string[] }

const filtroEmpresa = (q: any, empresaId: string | null) => (empresaId ? q.eq("empresa_id", empresaId) : q.is("empresa_id", null));

export function useValidacoesPeriodo(mes: string, empresaId: string | null) {
  return useQuery({
    queryKey: ["auditoria_validacoes", mes, empresaId],
    queryFn: async () => {
      const { data, error } = await filtroEmpresa((supabase as any).from("controladoria_auditoria_validacao").select("*").eq("periodo", `${mes}-01`), empresaId);
      if (error) throw error;
      return (data ?? []) as ValidacaoRow[];
    },
  });
}

export function useHistoricoPeriodo(mes: string, empresaId: string | null, ativo: boolean) {
  return useQuery({
    queryKey: ["auditoria_historico", mes, empresaId],
    enabled: ativo,
    queryFn: async () => {
      const { data, error } = await filtroEmpresa(
        (supabase as any).from("controladoria_auditoria_historico").select("*").eq("periodo", `${mes}-01`).order("created_at", { ascending: false }).limit(200),
        empresaId
      );
      if (error) throw error;
      return (data ?? []) as HistoricoRow[];
    },
  });
}

export function useResponsaveisAuditoria() {
  return useQuery({
    queryKey: ["auditoria_responsaveis"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("controladoria_auditoria_responsavel").select("tipo, user_ids, nomes");
      if (error) throw error;
      return (data ?? []) as ResponsavelRow[];
    },
  });
}

export function useSalvarResponsaveis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { tipo: TipoValidacao; user_ids: string[]; nomes: string[] }) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;
      const { error } = await (supabase as any)
        .from("controladoria_auditoria_responsavel")
        .upsert({ ...input, updated_at: new Date().toISOString(), updated_by: userId }, { onConflict: "tipo" });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auditoria_responsaveis"] }),
  });
}

export type AcaoAuditoria = "aprovar" | "rejeitar" | "reabrir" | "solicitar_revisao" | "observacao";

export interface RegistrarAuditoriaInput {
  mes: string;
  empresaId: string | null;
  tipo: TipoValidacao | null;
  acao: AcaoAuditoria;
  justificativa?: string;
  observacao?: string;
  valores?: { a: number; b: number } | null;
}

export function useRegistrarAuditoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (i: RegistrarAuditoriaInput) => {
      const { error } = await (supabase as any).rpc("auditoria_registrar", {
        _periodo: `${i.mes}-01`,
        _empresa: i.empresaId,
        _tipo: i.tipo,
        _acao: i.acao,
        _justificativa: i.justificativa ?? null,
        _observacao: i.observacao ?? null,
        _valores: i.valores ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, i) => {
      qc.invalidateQueries({ queryKey: ["auditoria_validacoes", i.mes] });
      qc.invalidateQueries({ queryKey: ["auditoria_historico", i.mes] });
      qc.invalidateQueries({ queryKey: ["auditoria_status_periodo"] });
    },
  });
}

// Para a Lucratividade: só status/carimbo, sem valores (RPC SECURITY DEFINER).
export interface StatusPeriodoRow { tipo: TipoValidacao; status: StatusValidacao; decidido_em: string | null; decidido_por_nome: string | null }

export function useStatusPeriodoAuditoria(mes: string, empresaId: string | null) {
  return useQuery({
    queryKey: ["auditoria_status_periodo", mes, empresaId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("auditoria_status_periodo", { _periodo: `${mes}-01`, _empresa: empresaId });
      if (error) {
        // Migration ainda não aplicada neste ambiente: a Lucratividade segue sem o aviso.
        if (error.code === "PGRST202" || error.code === "42883") return null;
        throw error;
      }
      return (data ?? []) as StatusPeriodoRow[];
    },
  });
}
