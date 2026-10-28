import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizarBeneficios, situacaoConvencao,
  type ChaveBeneficio, type MapaBeneficios, type RespostaReferencia,
} from "@/lib/licitacoes/convencoes";

// Convenções Coletivas e Decretos Municipais (mig 20261027000930): cadastro,
// vínculo do posto (Planilha de Custo) e os benefícios da vaga.

const sb = supabase as unknown as SupabaseClient;
export const BUCKET_CONVENCOES = "convencoes-coletivas";

export interface Convencao {
  id: string;
  empresa_id: string;
  contrato_id: string;
  identificacao: string | null;
  categoria_profissional: string | null;
  sindicato: string | null;
  municipio: string | null;
  vigencia_inicio: string | null;
  vigencia_fim: string | null;
  cct_arquivo_path: string | null;
  cct_arquivo_nome: string | null;
  cct_arquivo_tamanho: number | null;
  decreto_numero: string | null;
  decreto_arquivo_path: string | null;
  decreto_arquivo_nome: string | null;
  decreto_arquivo_tamanho: number | null;
  beneficios: MapaBeneficios;
  observacoes: string | null;
  situacao: "completo" | "pendente";
  versao: number;
  created_at: string;
  updated_at: string;
  contrato?: { id: string; nome: string; cliente: string | null } | null;
  empresa?: { id: string; razao_social: string | null; nome_fantasia: string | null } | null;
}

export type ConvencaoInput = Omit<Convencao, "id" | "situacao" | "versao" | "created_at" | "updated_at" | "contrato" | "empresa">;

export const nomeEmpresa = (e: Convencao["empresa"]) => e?.nome_fantasia || e?.razao_social || "—";

export function useConvencoes() {
  return useQuery({
    queryKey: ["lic_convencoes"],
    queryFn: async (): Promise<Convencao[]> => {
      const { data, error } = await sb
        .from("LIC_CONVENCAO_COLETIVA")
        .select("*, contrato:contratos(id, nome, cliente), empresa:empresas(id, razao_social, nome_fantasia)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Convencao[];
    },
  });
}

/** Grava a convenção; a situação vem da mesma regra que desenha os avisos. */
export function useSalvarConvencao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: ConvencaoInput & { id?: string }): Promise<string> => {
      const beneficios = normalizarBeneficios(input.beneficios ?? {});
      const linha = { ...input, beneficios, situacao: situacaoConvencao({ ...input, beneficios }) };
      if (id) {
        const { error } = await sb.from("LIC_CONVENCAO_COLETIVA").update(linha).eq("id", id);
        if (error) throw error;
        return id;
      }
      const { data, error } = await sb.from("LIC_CONVENCAO_COLETIVA").insert(linha).select("id").single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lic_convencoes"] });
      qc.invalidateQueries({ queryKey: ["lic_referencia_posto"] });
    },
  });
}

export function useExcluirConvencao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Pick<Convencao, "id" | "cct_arquivo_path" | "decreto_arquivo_path">) => {
      const { error } = await sb.from("LIC_CONVENCAO_COLETIVA").delete().eq("id", c.id);
      if (error) {
        // FK RESTRICT do vínculo do posto (23503): diz onde está em uso.
        if (error.code === "23503") throw new Error("Esta convenção está vinculada a posto(s) na Planilha de Custo. Troque o vínculo lá antes de excluir.");
        throw error;
      }
      const arquivos = [c.cct_arquivo_path, c.decreto_arquivo_path].filter(Boolean) as string[];
      if (arquivos.length) await sb.storage.from(BUCKET_CONVENCOES).remove(arquivos);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lic_convencoes"] }),
  });
}

/** Sobe um anexo e devolve caminho/nome/tamanho para gravar na convenção. */
export async function enviarAnexoConvencao(contratoId: string, tipo: "cct" | "decreto", arquivo: File) {
  const ext = (arquivo.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${contratoId}/${tipo}-${Date.now()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET_CONVENCOES).upload(path, arquivo, { upsert: false, contentType: arquivo.type || undefined });
  if (error) throw error;
  return { path, nome: arquivo.name, tamanho: arquivo.size };
}

/** Abre o anexo numa aba (URL assinada de 1 h). */
export async function abrirAnexoConvencao(path: string): Promise<string | null> {
  const { data, error } = await sb.storage.from(BUCKET_CONVENCOES).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) return "Não foi possível abrir o arquivo.";
  window.open(data.signedUrl, "_blank", "noopener");
  return null;
}

// ── Vínculo do posto (Planilha de Custo) ───────────────────────────────────

export interface VinculoPosto {
  id: string;
  contrato_id: string;
  posto: string;
  convencao_id: string;
  regras: Partial<Record<ChaveBeneficio, string>>;
  atualizado_em: string;
}

const chavePosto = (s: string) => s.trim().toUpperCase();

/** Todos os vínculos — a Planilha de Custo mostra a coluna em todas as linhas. */
export function useVinculosPosto() {
  return useQuery({
    queryKey: ["lic_posto_convencao"],
    queryFn: async (): Promise<Map<string, VinculoPosto>> => {
      const { data, error } = await sb.from("LIC_POSTO_CONVENCAO").select("*");
      // Banco ainda sem a tabela: a coluna aparece vazia, sem quebrar a planilha.
      if (error) return new Map();
      return new Map((data as VinculoPosto[]).map((v) => [`${v.contrato_id}|${chavePosto(v.posto)}`, v]));
    },
  });
}

export const vinculoDe = (mapa: Map<string, VinculoPosto> | undefined, contratoId: string | null | undefined, posto: string) =>
  contratoId ? mapa?.get(`${contratoId}|${chavePosto(posto)}`) ?? null : null;

export function useSalvarVinculoPosto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { id?: string; contrato_id: string; posto: string; convencao_id: string; regras: Partial<Record<ChaveBeneficio, string>> }) => {
      const linha = { contrato_id: v.contrato_id, posto: v.posto.trim(), convencao_id: v.convencao_id, regras: v.regras };
      const { error } = v.id
        ? await sb.from("LIC_POSTO_CONVENCAO").update(linha).eq("id", v.id)
        : await sb.from("LIC_POSTO_CONVENCAO").insert(linha);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lic_posto_convencao"] });
      qc.invalidateQueries({ queryKey: ["lic_referencia_posto"] });
    },
  });
}

export function useRemoverVinculoPosto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("LIC_POSTO_CONVENCAO").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lic_posto_convencao"] });
      qc.invalidateQueries({ queryKey: ["lic_referencia_posto"] });
    },
  });
}

// ── Benefícios na vaga ─────────────────────────────────────────────────────

/** Abertura de Vagas: contrato + posto escolhidos → referência (antes de a vaga existir). */
export function useReferenciaDoPosto(contratoId: string | null | undefined, posto: string | null | undefined) {
  return useQuery({
    queryKey: ["lic_referencia_posto", contratoId ?? "", posto ?? ""],
    enabled: !!contratoId && !!posto?.trim(),
    queryFn: async (): Promise<RespostaReferencia | null> => {
      const { data, error } = await sb.rpc("lic_referencia_do_posto", { p_contrato_id: contratoId, p_posto: posto });
      // Banco ainda sem a RPC: sem quadro (a tela some com ele), sem quebrar o formulário.
      if (error) return null;
      return data as RespostaReferencia;
    },
  });
}

export interface ObservacoesVaga { observacoes: string | null; observacoes_por: string | null; observacoes_em: string | null }

/** Detalhe da solicitação: a referência que a vaga usou (versão congelada) + observações. */
export function useBeneficiosDaVaga(vagaId: number | null | undefined) {
  return useQuery({
    queryKey: ["rec_beneficios_vaga", vagaId],
    enabled: !!vagaId,
    queryFn: async (): Promise<{ referencia: RespostaReferencia | null; obs: ObservacoesVaga | null }> => {
      const [ref, obs] = await Promise.all([
        sb.rpc("rec_beneficios_da_vaga", { p_vaga: vagaId }),
        sb.from("SISTEMA_RECRUTAMENTO_BENEFICIOS").select("observacoes, observacoes_por, observacoes_em").eq("vaga_id", vagaId!).maybeSingle(),
      ]);
      return {
        referencia: ref.error ? null : (ref.data as RespostaReferencia),
        obs: obs.error ? null : ((obs.data as ObservacoesVaga | null) ?? null),
      };
    },
  });
}

export function useAtualizarBeneficiosVaga(vagaId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await sb.rpc("rec_beneficios_da_vaga", { p_vaga: vagaId, p_atualizar: true });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rec_beneficios_vaga", vagaId] }),
  });
}

export function useSalvarObservacoesVaga(vagaId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (texto: string) => {
      const { error } = await sb.rpc("rec_vaga_observacoes_salvar", { p_vaga: vagaId, p_texto: texto });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rec_beneficios_vaga", vagaId] }),
  });
}
