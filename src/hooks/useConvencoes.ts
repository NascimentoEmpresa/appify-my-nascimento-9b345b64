import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  normalizarBeneficios, planoAnexos, situacaoConvencao,
  type AnexoLista, type ChaveBeneficio, type MapaBeneficios, type RespostaReferencia, type TipoCadastro,
} from "@/lib/licitacoes/convencoes";

// Convenções Coletivas e Decretos Municipais (mig 20261027000930): cadastro,
// vínculo do posto (Planilha de Custo) e os benefícios da vaga.

const sb = supabase as unknown as SupabaseClient;
export const BUCKET_CONVENCOES = "convencoes-coletivas";

export interface Convencao {
  id: string;
  /** 'decreto' = decreto municipal em cadastro próprio (mig 20261103002250). */
  tipo: TipoCadastro;
  /** Decreto não tem contrato: empresa/contrato só são obrigatórios na CCT. */
  empresa_id: string | null;
  contrato_id: string | null;
  identificacao: string | null;
  categoria_profissional: string | null;
  sindicato: string | null;
  municipio: string | null;
  uf: string | null;
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
  /** Vários anexos da CCT (mig 20261109004500), na ordem em que entraram. */
  anexos?: AnexoConvencaoLinha[];
}

/** Linha de LIC_CONVENCAO_ANEXO. */
export interface AnexoConvencaoLinha {
  id: string;
  convencao_id: string;
  path: string;
  nome: string | null;
  tamanho: number | null;
  descricao: string | null;
  criado_em: string;
}

export type ConvencaoInput = Omit<Convencao, "id" | "situacao" | "versao" | "created_at" | "updated_at" | "contrato" | "empresa" | "anexos">;

export const nomeEmpresa = (e: Convencao["empresa"]) => e?.nome_fantasia || e?.razao_social || "—";

export function useConvencoes() {
  return useQuery({
    queryKey: ["lic_convencoes"],
    queryFn: async (): Promise<Convencao[]> => {
      // Anexos numa consulta à parte (e não embutidos): banco ainda sem a
      // tabela nova não derruba a lista — a tela cai no anexo único antigo.
      const [conv, anx] = await Promise.all([
        sb.from("LIC_CONVENCAO_COLETIVA")
          .select("*, contrato:contratos(id, nome, cliente), empresa:empresas(id, razao_social, nome_fantasia)")
          .order("updated_at", { ascending: false }),
        sb.from("LIC_CONVENCAO_ANEXO")
          .select("id, convencao_id, path, nome, tamanho, descricao, criado_em")
          .order("criado_em", { ascending: true }),
      ]);
      if (conv.error) throw conv.error;
      const porConvencao = new Map<string, AnexoConvencaoLinha[]>();
      for (const a of (anx.error ? [] : anx.data ?? []) as AnexoConvencaoLinha[]) {
        porConvencao.set(a.convencao_id, [...(porConvencao.get(a.convencao_id) ?? []), a]);
      }
      return ((conv.data ?? []) as Convencao[]).map((c) => ({ ...c, anexos: porConvencao.get(c.id) ?? [] }));
    },
  });
}

/**
 * Grava a lista de anexos da convenção (depois de a convenção estar salva):
 * insere os novos, troca descrições, tira as linhas que saíram e, por último,
 * apaga do storage os arquivos que saíram.
 */
export async function salvarAnexosConvencao(convencaoId: string, antes: AnexoLista[], depois: AnexoLista[]) {
  const plano = planoAnexos(antes, depois);
  if (plano.inserir.length) {
    const { error } = await sb.from("LIC_CONVENCAO_ANEXO")
      .insert(plano.inserir.map((a) => ({ convencao_id: convencaoId, ...a })));
    if (error) throw error;
  }
  for (const a of plano.atualizar) {
    const { error } = await sb.from("LIC_CONVENCAO_ANEXO").update({ descricao: a.descricao }).eq("id", a.id);
    if (error) throw error;
  }
  if (plano.removerLinhas.length) {
    const { error } = await sb.from("LIC_CONVENCAO_ANEXO").delete().in("id", plano.removerLinhas);
    if (error) throw error;
  }
  if (plano.removerArquivos.length) {
    await sb.storage.from(BUCKET_CONVENCOES).remove(plano.removerArquivos).catch(() => undefined);
  }
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
    mutationFn: async (c: Pick<Convencao, "id" | "cct_arquivo_path" | "decreto_arquivo_path" | "anexos">) => {
      const { error } = await sb.from("LIC_CONVENCAO_COLETIVA").delete().eq("id", c.id);
      if (error) {
        // FK RESTRICT do vínculo do posto (23503): diz onde está em uso.
        if (error.code === "23503") throw new Error("Esta convenção está vinculada a contrato(s) ou a posto(s) na Planilha de Custo. Troque o vínculo lá antes de excluir.");
        throw error;
      }
      // As linhas de anexo saem pelo CASCADE; os arquivos, aqui (todos).
      const arquivos = [...new Set([c.cct_arquivo_path, c.decreto_arquivo_path, ...(c.anexos ?? []).map((a) => a.path)]
        .filter(Boolean) as string[])];
      if (arquivos.length) await sb.storage.from(BUCKET_CONVENCOES).remove(arquivos);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lic_convencoes"] }),
  });
}

/** Sobe um anexo e devolve caminho/nome/tamanho para gravar na convenção. */
export async function enviarAnexoConvencao(contratoId: string | null, tipo: "cct" | "decreto", arquivo: File) {
  const ext = (arquivo.name.split(".").pop() || "pdf").toLowerCase().replace(/[^a-z0-9]/g, "");
  // Sem contrato (decreto próprio e, desde 03/11/2026, a CCT): pasta pelo tipo.
  // Sufixo aleatório: vários anexos enviados no mesmo save caem no mesmo milissegundo.
  const path = `${contratoId ?? (tipo === "decreto" ? "decretos" : "convencoes")}/${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
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
      qc.invalidateQueries({ queryKey: ["lic_postos_do_contrato"] });
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
      qc.invalidateQueries({ queryKey: ["lic_postos_do_contrato"] });
      qc.invalidateQueries({ queryKey: ["lic_referencia_posto"] });
    },
  });
}

// ── Vínculo pelo lado da convenção (mig 20261028000910) ────────────────────

export interface PostoDoContrato { posto: string; linhas: number; pessoas: number; convencao_id: string | null }

/** Postos do contrato na Planilha de Custo, com a convenção de cada um (se houver). */
export function usePostosDoContrato(contratoId: string | null | undefined) {
  return useQuery({
    queryKey: ["lic_postos_do_contrato", contratoId ?? ""],
    enabled: !!contratoId,
    queryFn: async (): Promise<PostoDoContrato[]> => {
      const { data, error } = await sb.rpc("lic_postos_do_contrato", { p_contrato_id: contratoId });
      if (error) throw error;
      return (data ?? []) as PostoDoContrato[];
    },
  });
}

/**
 * Cadastro da convenção: os postos marcados passam a seguir ESTA convenção
 * (como principal); os desmarcados que seguiam ela perdem o vínculo. Posto que
 * seguia outra convenção e foi marcado troca de principal — as regras por
 * benefício que apontavam para esta saem (seriam "igual à principal").
 */
export function useSincronizarPostosConvencao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ convencaoId, contratoId, listados, marcados, vinculos }: {
      convencaoId: string; contratoId: string;
      /** Postos que estavam na tela: vínculo de posto fora da lista não é mexido. */
      listados: string[];
      marcados: string[]; vinculos: Map<string, VinculoPosto> | undefined;
    }) => {
      const querem = new Set(marcados.map(chavePosto));
      const naTela = new Set(listados.map(chavePosto));
      const doContrato = [...(vinculos?.values() ?? [])].filter((v) => v.contrato_id === contratoId);
      const sair = doContrato.filter((v) => v.convencao_id === convencaoId && naTela.has(chavePosto(v.posto)) && !querem.has(chavePosto(v.posto)));
      for (const v of sair) {
        const { error } = await sb.from("LIC_POSTO_CONVENCAO").delete().eq("id", v.id);
        if (error) throw error;
      }
      for (const posto of marcados) {
        const atual = vinculoDe(vinculos, contratoId, posto);
        if (atual?.convencao_id === convencaoId) continue;
        const regras = Object.fromEntries(Object.entries(atual?.regras ?? {}).filter(([, id]) => id && id !== convencaoId));
        const linha = { contrato_id: contratoId, posto: posto.trim(), convencao_id: convencaoId, regras };
        const { error } = atual
          ? await sb.from("LIC_POSTO_CONVENCAO").update(linha).eq("id", atual.id)
          : await sb.from("LIC_POSTO_CONVENCAO").insert(linha);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lic_posto_convencao"] });
      qc.invalidateQueries({ queryKey: ["lic_postos_do_contrato"] });
      qc.invalidateQueries({ queryKey: ["lic_referencia_posto"] });
    },
  });
}

// ── Convenção do CONTRATO (mig 20261113100500) ─────────────────────────────
// Vinculada no contrato, vale para TODOS os postos dele (vence o vínculo do
// posto no resolvedor lic_referencia_do_posto_interno).

export interface ConvencaoDoContrato { contrato_id: string; convencao_id: string; decreto_id: string | null; atualizado_em: string }

export function useConvencaoDoContrato(contratoId: string | null | undefined) {
  return useQuery({
    queryKey: ["lic_contrato_convencao", contratoId ?? ""],
    enabled: !!contratoId,
    queryFn: async (): Promise<ConvencaoDoContrato | null> => {
      const { data, error } = await sb.from("LIC_CONTRATO_CONVENCAO")
        .select("contrato_id, convencao_id, decreto_id, atualizado_em").eq("contrato_id", contratoId!).maybeSingle();
      // Banco ainda sem a tabela: o contrato aparece sem convenção, sem quebrar o modal.
      if (error) return null;
      return (data as ConvencaoDoContrato | null) ?? null;
    },
  });
}

/** Grava (ou tira, com convencao_id null) a convenção do contrato. */
export function useSalvarConvencaoDoContrato() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ contratoId, convencaoId, decretoId }: { contratoId: string; convencaoId: string | null; decretoId: string | null }) => {
      const { error } = convencaoId
        ? await sb.from("LIC_CONTRATO_CONVENCAO").upsert(
            { contrato_id: contratoId, convencao_id: convencaoId, decreto_id: decretoId || null },
            { onConflict: "contrato_id" })
        : await sb.from("LIC_CONTRATO_CONVENCAO").delete().eq("contrato_id", contratoId);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["lic_contrato_convencao", v.contratoId] });
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
