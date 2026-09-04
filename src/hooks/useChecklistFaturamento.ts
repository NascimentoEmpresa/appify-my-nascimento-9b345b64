import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// SIS-2026-0304: Checklist de Faturamento — migrado do "Sistema Financeiro
// Nascimento" (app desktop Python/eel legado). Matriz Contrato × Documento
// × Competência, com status clicável e anexo real por célula. "Concluir e
// baixar" substitui o envio por Outlook Desktop do legado (automação COM
// inviável num ERP web) — gera .zip, usuário manda pelo e-mail dele.
//
// Achado revisando com o usuário: o catálogo de documentos e o vínculo
// Contrato × Documento NÃO são tabelas próprias do Checklist — reaproveita
// `doc_tipos`/`contrato_docs_config`, já existentes em Licitações >
// Documentos (mesmo catálogo, batendo quase 1:1 com o do legado, mas por
// EMPRESA em vez de global — cada empresa tem seu próprio conjunto de 51+
// tipos). O Checklist grava sempre com `posto = ''` (nível contrato, sem
// quebrar por posto) e `periodicidade = 'mensal'` (é isso que ele cobra
// todo mês). CHECKLIST_FATURAMENTO_MARCACAO/_ANEXO/_ENVIO continuam
// tabelas próprias — não têm equivalente em Documentos.

export interface ContratoChecklist {
  id: string;
  nome: string;
  empresa_id: string;
}

// useContratosAtivos (useMaloteDespesa.ts) não filtra por status — pega
// contrato encerrado junto. Aqui o Checklist só faz sentido pra contrato
// ativo mesmo.
export function useContratosAtivosChecklist() {
  return useQuery({
    queryKey: ["checklist_fat_contratos_ativos"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contratos")
        .select("id, nome, empresa_id")
        .eq("status", "ativo")
        .order("nome");
      if (error) throw error;
      return (data ?? []) as ContratoChecklist[];
    },
  });
}

export type StatusMarcacao = "pendente" | "a_conferir" | "ok" | "nao_aplicavel";
export const STATUS_CICLO: StatusMarcacao[] = ["pendente", "a_conferir", "ok", "nao_aplicavel"];
export const STATUS_LABEL_CHECKLIST: Record<StatusMarcacao, string> = {
  pendente: "Pendente",
  a_conferir: "A conferir",
  ok: "OK",
  nao_aplicavel: "N/A",
};

export const BUCKET_CHECKLIST_ANEXOS = "checklist-faturamento-anexos";
const BUCKET_ANEXOS = BUCKET_CHECKLIST_ANEXOS;

// ── Catálogo de documentos (doc_tipos, por empresa) ──────────────────────
export interface DocPadrao {
  id: string;
  empresa_id: string;
  nome: string;
  descricao: string | null;
}

const DOCS_KEY = "checklist_fat_docs";

export function useDocsPadrao(empresaId: string | null) {
  return useQuery({
    queryKey: [DOCS_KEY, empresaId],
    enabled: !!empresaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("doc_tipos")
        .select("id, empresa_id, nome, descricao")
        .eq("empresa_id", empresaId)
        .order("nome");
      if (error) throw error;
      return (data ?? []) as DocPadrao[];
    },
  });
}

export function useSalvarDocPadrao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { empresaId: string; nome: string; descricao: string | null }) => {
      const { error } = await (supabase as any)
        .from("doc_tipos")
        .insert({ empresa_id: input.empresaId, nome: input.nome.trim(), descricao: input.descricao });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: [DOCS_KEY, vars.empresaId] }),
  });
}

export function useExcluirDocPadrao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; empresaId: string }) => {
      const { error } = await (supabase as any).from("doc_tipos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: [DOCS_KEY, vars.empresaId] }),
  });
}

// ── Vínculo Contrato × Documento (contrato_docs_config, posto='') ────────
export interface ContratoDocVinculo {
  id: string;
  contrato_id: string;
  empresa_id: string;
  doc_id: string; // = contrato_docs_config.doc_tipo_id
  periodicidade: string | null;
  doc: { nome: string } | null;
}

const CONTRATO_DOCS_KEY = "checklist_fat_contrato_docs";

export function useContratoDocs(contratoId: string | null) {
  return useQuery({
    queryKey: [CONTRATO_DOCS_KEY, contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("contrato_docs_config")
        .select("id, contrato_id, empresa_id, doc_tipo_id, periodicidade, doc_tipos(nome)")
        .eq("contrato_id", contratoId)
        .eq("posto", "");
      if (error) throw error;
      const linhas = (data ?? []).map((r: any) => ({
        id: r.id,
        contrato_id: r.contrato_id,
        empresa_id: r.empresa_id,
        doc_id: r.doc_tipo_id,
        periodicidade: r.periodicidade,
        doc: r.doc_tipos ? { nome: r.doc_tipos.nome } : null,
      })) as ContratoDocVinculo[];
      linhas.sort((a, b) => (a.doc?.nome ?? "").localeCompare(b.doc?.nome ?? "", "pt-BR"));
      return linhas;
    },
  });
}

export function useVincularDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, empresaId, docId }: { contratoId: string; empresaId: string; docId: string }) => {
      const { error } = await (supabase as any)
        .from("contrato_docs_config")
        .insert({ contrato_id: contratoId, empresa_id: empresaId, posto: "", doc_tipo_id: docId, periodicidade: "mensal", obrigatorio: true });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: [CONTRATO_DOCS_KEY, vars.contratoId] }),
  });
}

export function useDesvincularDoc() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; contratoId: string }) => {
      const { error } = await (supabase as any).from("contrato_docs_config").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: [CONTRATO_DOCS_KEY, vars.contratoId] }),
  });
}

// ── Config por contrato (dia-limite padrão) — só o Checklist tem isso,
// sem equivalente em Documentos ─────────────────────────────────────────
export interface ContratoConfig {
  contrato_id: string;
  dia_limite_padrao: number | null;
  comp_inicio: string | null;
}

const CONFIG_KEY = "checklist_fat_config";

export function useContratoConfig(contratoId: string | null) {
  return useQuery({
    queryKey: [CONFIG_KEY, contratoId],
    enabled: !!contratoId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHECKLIST_FATURAMENTO_CONTRATO_CONFIG")
        .select("contrato_id, dia_limite_padrao, comp_inicio")
        .eq("contrato_id", contratoId)
        .maybeSingle();
      if (error) throw error;
      return data as ContratoConfig | null;
    },
  });
}

export function useSalvarContratoConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ContratoConfig) => {
      const { error } = await (supabase as any).from("CHECKLIST_FATURAMENTO_CONTRATO_CONFIG").upsert(input);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: [CONFIG_KEY, vars.contrato_id] }),
  });
}

// ── Marcações (matriz) ────────────────────────────────────────────────────
export interface Marcacao {
  id: string;
  contrato_id: string;
  doc_id: string;
  competencia: string;
  status: StatusMarcacao;
  usuario_marcacao: string | null;
  atualizado_em: string;
}

const MARCACOES_KEY = "checklist_fat_marcacoes";

export function useMarcacoes(contratoId: string | null, competenciaISO: string | null) {
  return useQuery({
    queryKey: [MARCACOES_KEY, contratoId, competenciaISO],
    enabled: !!contratoId && !!competenciaISO,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHECKLIST_FATURAMENTO_MARCACAO")
        .select("*")
        .eq("contrato_id", contratoId)
        .eq("competencia", competenciaISO);
      if (error) throw error;
      return (data ?? []) as Marcacao[];
    },
  });
}

// Auto-save — cada mudança de status é gravada na hora.
export function useAtualizarMarcacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contratoId, docId, competenciaISO, status,
    }: { contratoId: string; docId: string; competenciaISO: string; status: StatusMarcacao }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await (supabase as any)
        .from("CHECKLIST_FATURAMENTO_MARCACAO")
        .upsert(
          {
            contrato_id: contratoId, doc_id: docId, competencia: competenciaISO,
            status, usuario_marcacao: userData.user?.id ?? null, atualizado_em: new Date().toISOString(),
          },
          { onConflict: "contrato_id,doc_id,competencia" },
        );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: [MARCACOES_KEY, vars.contratoId, vars.competenciaISO] }),
  });
}

// ── Anexos ────────────────────────────────────────────────────────────────
export interface AnexoChecklist {
  id: string;
  contrato_id: string;
  doc_id: string;
  competencia: string;
  storage_path: string;
  nome_original: string;
  tamanho_bytes: number | null;
  uploaded_by: string | null;
  uploaded_at: string;
}

const ANEXOS_KEY = "checklist_fat_anexos";

export function useAnexos(contratoId: string | null, competenciaISO: string | null) {
  return useQuery({
    queryKey: [ANEXOS_KEY, contratoId, competenciaISO],
    enabled: !!contratoId && !!competenciaISO,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHECKLIST_FATURAMENTO_ANEXO")
        .select("*")
        .eq("contrato_id", contratoId)
        .eq("competencia", competenciaISO);
      if (error) throw error;
      return (data ?? []) as AnexoChecklist[];
    },
  });
}

export function useUploadAnexo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      contratoId, docId, competenciaISO, arquivo,
    }: { contratoId: string; docId: string; competenciaISO: string; arquivo: File }) => {
      const { data: userData } = await supabase.auth.getUser();
      const ext = arquivo.name.split(".").pop() ?? "dat";
      const path = `${contratoId}/${competenciaISO}/${docId}-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET_ANEXOS).upload(path, arquivo);
      if (uploadError) throw uploadError;

      const { error } = await (supabase as any).from("CHECKLIST_FATURAMENTO_ANEXO").insert({
        contrato_id: contratoId, doc_id: docId, competencia: competenciaISO,
        storage_path: path, nome_original: arquivo.name, tamanho_bytes: arquivo.size,
        uploaded_by: userData.user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: [ANEXOS_KEY, vars.contratoId, vars.competenciaISO] }),
  });
}

export function useExcluirAnexo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (anexo: AnexoChecklist) => {
      await supabase.storage.from(BUCKET_ANEXOS).remove([anexo.storage_path]);
      const { error } = await (supabase as any).from("CHECKLIST_FATURAMENTO_ANEXO").delete().eq("id", anexo.id);
      if (error) throw error;
    },
    onSuccess: (_d, anexo) => qc.invalidateQueries({ queryKey: [ANEXOS_KEY, anexo.contrato_id, anexo.competencia] }),
  });
}

// ── Envio ("Concluir e baixar") ──────────────────────────────────────────
export interface EnvioChecklist {
  id: string;
  contrato_id: string;
  competencia: string;
  baixado_em: string;
  baixado_por: string | null;
}

const ENVIOS_KEY = "checklist_fat_envios";

export function useEnvio(contratoId: string | null, competenciaISO: string | null) {
  return useQuery({
    queryKey: [ENVIOS_KEY, contratoId, competenciaISO],
    enabled: !!contratoId && !!competenciaISO,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("CHECKLIST_FATURAMENTO_ENVIO")
        .select("*")
        .eq("contrato_id", contratoId)
        .eq("competencia", competenciaISO)
        .maybeSingle();
      if (error) throw error;
      return data as EnvioChecklist | null;
    },
  });
}

export function useMarcarBaixado() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, competenciaISO }: { contratoId: string; competenciaISO: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const { error } = await (supabase as any)
        .from("CHECKLIST_FATURAMENTO_ENVIO")
        .upsert(
          { contrato_id: contratoId, competencia: competenciaISO, baixado_em: new Date().toISOString(), baixado_por: userData.user?.id ?? null },
          { onConflict: "contrato_id,competencia" },
        );
      if (error) throw error;
    },
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: [ENVIOS_KEY, vars.contratoId, vars.competenciaISO] }),
  });
}

// ── Dashboard de pendências ────────────────────────────────────────────
// Volume modesto (65 contratos ativos, matriz enxuta por contrato) —
// agregação client-side em vez de view/RPC nova.
export interface ResumoContratoChecklist {
  contrato_id: string;
  total_docs: number;
  ok: number;
  pendentes: number;
}

export function useResumoPendencias(competenciaISO: string | null) {
  return useQuery({
    queryKey: ["checklist_fat_resumo", competenciaISO],
    enabled: !!competenciaISO,
    queryFn: async () => {
      const [{ data: vinculos, error: e1 }, { data: marcacoes, error: e2 }] = await Promise.all([
        (supabase as any).from("contrato_docs_config").select("contrato_id, doc_tipo_id").eq("posto", ""),
        (supabase as any).from("CHECKLIST_FATURAMENTO_MARCACAO").select("contrato_id, doc_id, status").eq("competencia", competenciaISO),
      ]);
      if (e1) throw e1;
      if (e2) throw e2;

      const statusPorChave = new Map<string, StatusMarcacao>();
      for (const m of marcacoes ?? []) statusPorChave.set(`${m.contrato_id}:${m.doc_id}`, m.status);

      const porContrato = new Map<string, ResumoContratoChecklist>();
      for (const v of vinculos ?? []) {
        const atual = porContrato.get(v.contrato_id) ?? { contrato_id: v.contrato_id, total_docs: 0, ok: 0, pendentes: 0 };
        atual.total_docs++;
        const status = statusPorChave.get(`${v.contrato_id}:${v.doc_tipo_id}`) ?? "pendente";
        if (status === "pendente") atual.pendentes++;
        else atual.ok++;
        porContrato.set(v.contrato_id, atual);
      }
      return porContrato;
    },
  });
}
