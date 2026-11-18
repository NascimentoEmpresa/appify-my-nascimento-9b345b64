import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { nomeArquivoSeguro } from "@/lib/treinamentos/contratoTreinamento";
import { BUCKET_DSS, type DssResumo, type LinhaContratoDss, type PessoaDss } from "@/lib/treinamentos/dss";

// =====================================================================
// DSS — Diálogo Semanal de Segurança, lado do SST (mig 20261119100000).
// Tabelas fora do types.ts gerado, por isso o `as any` — mesmo padrão de
// useTreinamentosContrato. Quem pode o quê é decidido no banco: cada RPC
// confere a ação do menu treinamentos_dss.
// =====================================================================

const sb = supabase as any;

export interface ContratoDssOpcao { empresa: number; filial: number; nome: string; colaboradores: number }
export interface DssCompleto extends DssResumo {
  conteudo: string; arquivo_path: string | null; arquivo_nome: string | null; conteudo_hash: string | null;
  contratos: { empresa: number; filial: number; contrato_nome: string }[];
}
export interface FolhaDss {
  id: string; empresa: number; filial: number; contrato_nome: string; storage_path: string;
  arquivo_nome: string | null; anexado_em: string;
}
export interface DssInput {
  id: string; tema: string; conteudo: string; arquivo_path: string | null; arquivo_nome: string | null;
  semana_ref: string; disponivel_de: string; disponivel_ate: string | null;
  todos_contratos: boolean; contratos: { empresa: number; filial: number; nome: string }[];
}

const num = <T extends Record<string, any>>(r: T, campos: string[]): T => {
  const o: any = { ...r };
  for (const c of campos) if (o[c] != null) o[c] = Number(o[c]);
  return o;
};

export function useContratosDss() {
  return useQuery({
    queryKey: ["dss", "contratos"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ContratoDssOpcao[]> => {
      const { data, error } = await sb.rpc("sst_dss_contratos");
      if (error) throw error;
      return (data ?? []).map((r: any) => num(r, ["empresa", "filial", "colaboradores"]));
    },
  });
}

export function usePainelDss(de: string | null, ate: string | null) {
  return useQuery({
    queryKey: ["dss", "painel", de, ate],
    queryFn: async (): Promise<{ dss: DssResumo[]; contratos: LinhaContratoDss[] }> => {
      const { data, error } = await sb.rpc("sst_dss_painel", { p_de: de, p_ate: ate });
      if (error) throw error;
      return {
        dss: data?.dss ?? [],
        contratos: (data?.contratos ?? []).map((r: any) =>
          num(r, ["empresa", "filial", "destinatarios", "acessaram", "assinaram", "assinaram_papel"])),
      };
    },
  });
}

export function useDss(id: string | undefined) {
  return useQuery({
    queryKey: ["dss", "um", id],
    enabled: !!id,
    queryFn: async (): Promise<DssCompleto | null> => {
      const { data, error } = await sb.from("SST_DSS").select("*, contratos:SST_DSS_CONTRATO(empresa, filial, contrato_nome)").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { ...data, vigente: false, tem_arquivo: !!data.arquivo_path, contratos: (data.contratos ?? []).map((c: any) => num(c, ["empresa", "filial"])) };
    },
  });
}

export function usePessoasDss(id: string | undefined) {
  return useQuery({
    queryKey: ["dss", "pessoas", id],
    enabled: !!id,
    queryFn: async (): Promise<PessoaDss[]> => {
      const { data, error } = await sb.rpc("sst_dss_pessoas", { p_dss: id });
      if (error) throw error;
      return (data ?? []).map((r: any) => num(r, ["empregado_id", "empresa", "filial"]));
    },
  });
}

export interface LinhaColaboradorDss extends Pick<PessoaDss,
  "empregado_id" | "nome" | "matricula" | "cargo" | "empresa" | "filial" | "contrato_nome" | "acessado_em" | "assinado_em" | "origem"> {
  dss_id: string; tema: string; semana_ref: string;
}

export function useDssPorColaborador(busca: string, de: string | null, ate: string | null) {
  const b = busca.trim();
  return useQuery({
    queryKey: ["dss", "colaborador", b, de, ate],
    enabled: b.length >= 3,
    queryFn: async (): Promise<LinhaColaboradorDss[]> => {
      const { data, error } = await sb.rpc("sst_dss_por_colaborador", { p_busca: b, p_de: de, p_ate: ate });
      if (error) throw error;
      return (data ?? []).map((r: any) => num(r, ["empregado_id", "empresa", "filial"]));
    },
  });
}

export function useFolhasDss(id: string | undefined) {
  return useQuery({
    queryKey: ["dss", "folhas", id],
    enabled: !!id,
    queryFn: async (): Promise<FolhaDss[]> => {
      const { data, error } = await sb.from("SST_DSS_FOLHA").select("id, empresa, filial, contrato_nome, storage_path, arquivo_nome, anexado_em")
        .eq("dss_id", id).order("anexado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r: any) => num(r, ["empresa", "filial"]));
    },
  });
}

/** Sobe um arquivo para dss/<id>/… ou folhas/<id>/… (nome com data para nunca sobrescrever). */
export async function enviarArquivoDss(pasta: "dss" | "folhas", dssId: string, arquivo: File): Promise<string> {
  const path = `${pasta}/${dssId}/${Date.now()}-${nomeArquivoSeguro(arquivo.name)}`;
  const { error } = await supabase.storage.from(BUCKET_DSS).upload(path, arquivo, { upsert: false, contentType: arquivo.type || undefined });
  if (error) throw error;
  return path;
}

export async function abrirArquivoDss(path: string) {
  const { data, error } = await supabase.storage.from(BUCKET_DSS).createSignedUrl(path, 120);
  if (error || !data?.signedUrl) throw error ?? new Error("Não foi possível abrir o arquivo.");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function useInvalidarDss() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["dss"] });
}

export function useSalvarDss() {
  const invalidar = useInvalidarDss();
  return useMutation({
    mutationFn: async ({ dados, publicar }: { dados: DssInput; publicar: boolean }) => {
      const { data, error } = await sb.rpc("sst_dss_salvar", {
        p_id: dados.id, p_tema: dados.tema, p_conteudo: dados.conteudo, p_arquivo_path: dados.arquivo_path,
        p_arquivo_nome: dados.arquivo_nome, p_semana_ref: dados.semana_ref, p_disponivel_de: dados.disponivel_de,
        p_disponivel_ate: dados.disponivel_ate, p_todos_contratos: dados.todos_contratos,
        p_contratos: dados.todos_contratos ? null : dados.contratos, p_publicar: publicar,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: invalidar,
  });
}

export function useEncerrarDss() {
  const invalidar = useInvalidarDss();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc("sst_dss_encerrar", { p_id: id });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useExcluirRascunhoDss() {
  const invalidar = useInvalidarDss();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc("sst_dss_excluir_rascunho", { p_id: id });
      if (error) throw error;
    },
    onSuccess: invalidar,
  });
}

export function useLancarPapelDss() {
  const invalidar = useInvalidarDss();
  return useMutation({
    mutationFn: async (p: { dssId: string; empresa: number; filial: number; arquivo: File; empregados: number[] }) => {
      const path = await enviarArquivoDss("folhas", p.dssId, p.arquivo);
      const { data, error } = await sb.rpc("sst_dss_lancar_papel", {
        p_dss: p.dssId, p_empresa: p.empresa, p_filial: p.filial, p_path: path,
        p_arquivo_nome: p.arquivo.name, p_empregados: p.empregados,
      });
      if (error) throw error;
      return data as { folha_id: string; lancados: number; ja_assinados: number; fora_do_contrato: number };
    },
    onSuccess: invalidar,
  });
}
