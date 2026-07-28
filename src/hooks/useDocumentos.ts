import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";

export interface DocTipo {
  id: string;
  empresa_id: string;
  nome: string;
  descricao: string | null;
  created_at: string;
}

export interface ContratoDocConfig {
  id: string;
  empresa_id: string;
  contrato_id: string;
  posto: string; // '' = nível contrato, string = posto específico
  doc_tipo_id: string;
  periodicidade: "mensal" | "trimestral" | "semestral" | "implantação" | "implantação + recorrência" | null;
  recorrencia: "mensal" | "trimestral" | "semestral" | "anual" | null;
  obrigatorio: boolean;
  observacoes: string | null;
  created_at: string;
}

const QK_TIPOS = (empresaId: string) => ["doc_tipos", empresaId];
const QK_CONFIG = (empresaId: string) => ["contrato_docs_config", empresaId];

// ─── Doc Tipos ───────────────────────────────────────────────────────────────

export function useDocTipos() {
  const { empresa } = useEmpresaAtiva();
  return useQuery({
    queryKey: QK_TIPOS(empresa?.id ?? ""),
    enabled: !!empresa?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("doc_tipos")
        .select("*")
        .eq("empresa_id", empresa!.id)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as DocTipo[];
    },
  });
}

export function useDocTipoSave() {
  const { empresa } = useEmpresaAtiva();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id?: string; nome: string; descricao?: string }) => {
      const { id, ...rest } = payload;
      if (id) {
        const { error } = await (supabase as any).from("doc_tipos").update(rest).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("doc_tipos").insert({ ...rest, empresa_id: empresa!.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_TIPOS(empresa!.id) });
      toast.success("Tipo de documento salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDocTipoDelete() {
  const { empresa } = useEmpresaAtiva();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("doc_tipos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_TIPOS(empresa!.id) });
      qc.invalidateQueries({ queryKey: QK_CONFIG(empresa!.id) });
      toast.success("Tipo removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// ─── Contrato Docs Config ─────────────────────────────────────────────────────

export function useContratoDocsPorContrato(contratoId: string | null | undefined) {
  return useQuery({
    queryKey: ["contrato_docs_config", "por_contrato", contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contrato_docs_config")
        .select("*, doc_tipos(nome)")
        .eq("contrato_id", contratoId)
        .order("posto")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as (ContratoDocConfig & { doc_tipos: { nome: string } | null })[];
    },
  });
}

export function useContratoDocsConfig() {
  const { empresa } = useEmpresaAtiva();
  return useQuery({
    queryKey: QK_CONFIG(empresa?.id ?? ""),
    enabled: !!empresa?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contrato_docs_config")
        .select("*")
        .eq("empresa_id", empresa!.id)
        .order("posto")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as ContratoDocConfig[];
    },
  });
}

export function useContratoDocSave() {
  const { empresa } = useEmpresaAtiva();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      id?: string;
      contrato_id: string;
      posto: string;
      doc_tipo_id: string;
      periodicidade: string | null;
      recorrencia: string | null;
      obrigatorio: boolean;
      observacoes: string | null;
    }) => {
      const { id, ...rest } = payload;
      if (id) {
        const { error } = await (supabase as any)
          .from("contrato_docs_config")
          .update(rest)
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("contrato_docs_config")
          .insert({ ...rest, empresa_id: empresa!.id });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_CONFIG(empresa!.id) });
      toast.success("Documento salvo.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useContratoDocDelete() {
  const { empresa } = useEmpresaAtiva();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("contrato_docs_config")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK_CONFIG(empresa!.id) });
      toast.success("Documento removido.");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
