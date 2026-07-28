import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ItemCalculado, TotaisNf, PercentuaisFiscais, InssCategoria } from "@/pages/financeiro/nf-emissao/calculos";

const BUCKET = "nf-emissao";

const NF_EMISSAO_KEY = "nf_emissao";

export interface NfEmissaoRow {
  id: string;
  empresa_id: string;
  contrato_id: string;
  variacao: string | null;
  competencia: string;
  data_emissao: string | null;
  numero_nf: string | null;
  status: "rascunho" | "enviada" | "concluida" | "cancelada";
  observacoes: string | null;
  observacoes_financeiro: string | null;
  data_pagamento: string | null;
  valor_pago: number | null;
  valor_contrato_exec_total: number;
  vlr_bruto_total: number;
  vlr_liquido_total: number;
  issqn_total: number;
  inss_total: number;
  ir_total: number;
  cofins_total: number;
  pis_total: number;
  csll_total: number;
  issqn_pct: number;
  ir_pct: number;
  cofins_pct: number;
  pis_pct: number;
  csll_pct: number;
  created_at: string;
  contrato: { id: string; nome: string; cliente: string } | null;
}

export function useNfsEmissao(empresaId: string | null | undefined) {
  return useQuery({
    queryKey: [NF_EMISSAO_KEY, empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_emissao")
        .select("*, contrato:contrato_id(id, nome, cliente)")
        .eq("empresa_id", empresaId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as NfEmissaoRow[];
    },
  });
}

export interface AnexoParaEnviar {
  file: File;
}

interface SalvarNfEmissaoInput {
  empresa_id: string;
  contrato_id: string;
  variacao: string | null;
  competencia: string;
  data_emissao: string | null;
  numero_nf: string | null;
  observacoes: string | null;
  itens: ItemCalculado[];
  totais: TotaisNf;
  pctFiscais: PercentuaisFiscais;
  anexos: AnexoParaEnviar[];
  status: "rascunho" | "enviada";
}

export function useSalvarNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SalvarNfEmissaoInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;

      const { data: nf, error } = await (supabase as any)
        .from("nf_emissao")
        .insert({
          empresa_id: input.empresa_id,
          contrato_id: input.contrato_id,
          variacao: input.variacao,
          competencia: input.competencia,
          data_emissao: input.data_emissao,
          numero_nf: input.numero_nf,
          observacoes: input.observacoes,
          status: input.status,
          ...input.totais,
          ...input.pctFiscais,
          created_by: userId,
          updated_by: userId,
        })
        .select("id")
        .single();
      if (error) throw error;

      const nfId = nf.id as string;

      if (input.itens.length > 0) {
        const payloadItens = input.itens.map((it, idx) => ({
          nf_emissao_id: nfId,
          ordem: idx + 1,
          identificacao: (it as any).identificacao || `Item ${idx + 1}`,
          ...it,
        }));
        const { error: eItens } = await (supabase as any).from("nf_emissao_item").insert(payloadItens);
        if (eItens) throw eItens;
      }

      for (const a of input.anexos) {
        const path = `${input.empresa_id}/${nfId}/${Date.now()}-${a.file.name}`;
        const up = await supabase.storage.from(BUCKET).upload(path, a.file, {
          contentType: a.file.type,
          upsert: false,
        });
        if (up.error) throw up.error;
        const { error: eAnexo } = await (supabase as any).from("nf_emissao_anexo").insert({
          nf_emissao_id: nfId,
          storage_path: path,
          file_name: a.file.name,
          mime_type: a.file.type,
          size_bytes: a.file.size,
          uploaded_by: userId,
        });
        if (eAnexo) throw eAnexo;
      }

      return nfId;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

interface AtualizarNfEmissaoInput {
  id: string;
  empresa_id: string;
  contrato_id: string;
  variacao: string | null;
  competencia: string;
  data_emissao: string | null;
  observacoes: string | null;
  itens: ItemCalculado[];
  totais: TotaisNf;
  pctFiscais: PercentuaisFiscais;
  anexosNovos: AnexoParaEnviar[];
  anexosParaRemover: { id: string; storage_path: string }[];
  status: "rascunho" | "enviada";
}

export function useAtualizarNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AtualizarNfEmissaoInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;

      const { error } = await (supabase as any)
        .from("nf_emissao")
        .update({
          contrato_id: input.contrato_id,
          variacao: input.variacao,
          competencia: input.competencia,
          data_emissao: input.data_emissao,
          observacoes: input.observacoes,
          status: input.status,
          ...input.totais,
          ...input.pctFiscais,
          updated_by: userId,
        })
        .eq("id", input.id);
      if (error) throw error;

      const { error: eDelItens } = await (supabase as any).from("nf_emissao_item").delete().eq("nf_emissao_id", input.id);
      if (eDelItens) throw eDelItens;

      if (input.itens.length > 0) {
        const payloadItens = input.itens.map((it, idx) => ({
          nf_emissao_id: input.id,
          ordem: idx + 1,
          identificacao: (it as any).identificacao || `Item ${idx + 1}`,
          ...it,
        }));
        const { error: eItens } = await (supabase as any).from("nf_emissao_item").insert(payloadItens);
        if (eItens) throw eItens;
      }

      for (const a of input.anexosParaRemover) {
        const rm = await supabase.storage.from(BUCKET).remove([a.storage_path]);
        if (rm.error) throw rm.error;
        const { error: eDelAnexo } = await (supabase as any).from("nf_emissao_anexo").delete().eq("id", a.id);
        if (eDelAnexo) throw eDelAnexo;
      }

      for (const a of input.anexosNovos) {
        const path = `${input.empresa_id}/${input.id}/${Date.now()}-${a.file.name}`;
        const up = await supabase.storage.from(BUCKET).upload(path, a.file, {
          contentType: a.file.type,
          upsert: false,
        });
        if (up.error) throw up.error;
        const { error: eAnexo } = await (supabase as any).from("nf_emissao_anexo").insert({
          nf_emissao_id: input.id,
          storage_path: path,
          file_name: a.file.name,
          mime_type: a.file.type,
          size_bytes: a.file.size,
          uploaded_by: userId,
        });
        if (eAnexo) throw eAnexo;
      }

      return input.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] });
      qc.invalidateQueries({ queryKey: ["nf_emissao_item"] });
      qc.invalidateQueries({ queryKey: ["nf_emissao_anexo"] });
    },
  });
}

interface ValidarNfEmissaoInput {
  id: string;
  numero_nf: string | null;
  data_emissao: string | null;
  observacoes_financeiro: string | null;
  itens: ItemCalculado[];
  totais: TotaisNf;
  status: "concluida" | "cancelada";
}

export function useValidarNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ValidarNfEmissaoInput) => {
      const userId = (await supabase.auth.getUser()).data.user?.id ?? null;

      const { error } = await (supabase as any)
        .from("nf_emissao")
        .update({
          numero_nf: input.numero_nf,
          data_emissao: input.data_emissao,
          observacoes_financeiro: input.observacoes_financeiro,
          status: input.status,
          ...input.totais,
          updated_by: userId,
        })
        .eq("id", input.id);
      if (error) throw error;

      const { error: eDelItens } = await (supabase as any).from("nf_emissao_item").delete().eq("nf_emissao_id", input.id);
      if (eDelItens) throw eDelItens;

      if (input.itens.length > 0) {
        const payloadItens = input.itens.map((it, idx) => ({
          nf_emissao_id: input.id,
          ordem: idx + 1,
          identificacao: (it as any).identificacao || `Item ${idx + 1}`,
          ...it,
        }));
        const { error: eItens } = await (supabase as any).from("nf_emissao_item").insert(payloadItens);
        if (eItens) throw eItens;
      }

      return input.id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] });
      qc.invalidateQueries({ queryKey: ["nf_emissao_item"] });
    },
  });
}

interface RegistrarPagamentoNfInput {
  id: string;
  data_pagamento: string | null;
  valor_pago: number | null;
}

export function useRegistrarPagamentoNf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: RegistrarPagamentoNfInput) => {
      const { error } = await (supabase as any)
        .from("nf_emissao")
        .update({ data_pagamento: input.data_pagamento, valor_pago: input.valor_pago })
        .eq("id", input.id);
      if (error) throw error;
      return input.id;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

export function useExcluirNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; anexos: { storage_path: string }[] }) => {
      if (input.anexos.length > 0) {
        const rm = await supabase.storage.from(BUCKET).remove(input.anexos.map((a) => a.storage_path));
        if (rm.error) throw rm.error;
      }
      const { error } = await (supabase as any).from("nf_emissao").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

export function useEnviarNfEmissao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("nf_emissao").update({ status: "enviada" }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [NF_EMISSAO_KEY] }),
  });
}

export interface NfEmissaoItemRow {
  id: string;
  ordem: number;
  identificacao: string | null;
  valor_contrato_exec: number;
  vlr_va: number;
  vlr_vt: number;
  vlr_materiais: number;
  faltas: number;
  posto_nao_implementado: number;
  multas: number;
  glosas: number;
  outros_descontos: number;
  multas_pos_emissao: number;
  glosas_pos_emissao: number;
  outros_descontos_pos_emissao: number;
  qtd_colaboradores: number;
  vlr_bruto: number;
  total_descontos: number;
  vlr_mao_obra: number;
  vlr_liquido: number;
  issqn: number;
  inss: number;
  ir: number;
  cofins: number;
  pis: number;
  csll: number;
  inss_categoria: InssCategoria;
}

export function useItensNfEmissao(nfEmissaoId: string | null | undefined) {
  return useQuery({
    queryKey: ["nf_emissao_item", nfEmissaoId],
    enabled: !!nfEmissaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_emissao_item")
        .select("*")
        .eq("nf_emissao_id", nfEmissaoId)
        .order("ordem");
      if (error) throw error;
      return (data ?? []) as NfEmissaoItemRow[];
    },
  });
}

export function useAnexosNfEmissao(nfEmissaoId: string | null | undefined) {
  return useQuery({
    queryKey: ["nf_emissao_anexo", nfEmissaoId],
    enabled: !!nfEmissaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_emissao_anexo")
        .select("*")
        .eq("nf_emissao_id", nfEmissaoId);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export async function baixarAnexoNfEmissao(storagePath: string) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}

export interface NfEmissaoHistoricoRow {
  id: string;
  nf_emissao_id: string;
  user_id: string;
  acao: string;
  detalhe: string;
  created_at: string;
}

export function useHistoricoNfEmissao(nfEmissaoId: string | null | undefined) {
  return useQuery({
    queryKey: ["nf_emissao_historico", nfEmissaoId],
    enabled: !!nfEmissaoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("nf_emissao_historico")
        .select("*")
        .eq("nf_emissao_id", nfEmissaoId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as NfEmissaoHistoricoRow[];
    },
  });
}

export interface UsuarioAtivo {
  id: string;
  display_name: string;
}

export function useUsuariosAtivos() {
  return useQuery({
    queryKey: ["usuarios_ativos"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("listar_usuarios_ativos");
      if (error) throw error;
      return (data ?? []) as UsuarioAtivo[];
    },
  });
}
