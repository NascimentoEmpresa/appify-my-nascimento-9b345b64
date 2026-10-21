import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ESTRUTURA_VAZIA, type Estrutura } from "@/lib/organograma/estruturaProcessos";

// =====================================================================
// Organograma › Estrutura de Setores e Processos (mig 20261020000060).
// Leitura pela RPC org_proc_estrutura (publicada ou rascunho, com foto);
// escrita direta nas tabelas ORG_PROC_* (RLS pelo menu do cadastro).
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;
const K = "org-estrutura-processos";
export const BUCKET_ORG_PROCESSOS = "org-processos";

const erro = (e: { message?: string } | null) => { if (e) throw new Error(e.message ?? "Erro"); };

/** publicada = o que o Organograma Geral mostra; false = o rascunho do cadastro. */
export const useEstrutura = (publicada: boolean) => useQuery({
  queryKey: [K, publicada ? "publicada" : "rascunho"],
  staleTime: 60_000,
  queryFn: async (): Promise<Estrutura> => {
    const { data, error } = await sb.rpc("org_proc_estrutura", { p_publicada: publicada });
    erro(error);
    return { ...ESTRUTURA_VAZIA, ...(data ?? {}) } as Estrutura;
  },
});

export const useHistoricoEstrutura = (ativo: boolean) => useQuery({
  queryKey: [K, "historico"], enabled: ativo,
  queryFn: async () => {
    const { data, error } = await sb.rpc("org_proc_historico");
    erro(error);
    return (data ?? []) as { versao: number; observacao: string | null; publicado_por: string | null; publicado_em: string; setores: number; processos: number; conexoes: number }[];
  },
});

export async function buscarPessoas(busca: string) {
  const { data, error } = await sb.rpc("org_proc_buscar_pessoas", { p_busca: busca });
  erro(error);
  return (data ?? []) as { empregado_id: number; nome: string; cargo: string | null; setor: string | null; user_id: string | null; avatar_url: string | null }[];
}

type Tabela = "ORG_PROC_UNIDADE" | "ORG_PROC_SETOR" | "ORG_PROC_MEMBRO" | "ORG_PROC_MACRO" | "ORG_PROC_PROCESSO" | "ORG_PROC_CONEXAO";

/** Salvar (insert sem id, update com id) e excluir em qualquer tabela da estrutura. */
export function useGravarEstrutura() {
  const qc = useQueryClient();
  const invalidar = () => qc.invalidateQueries({ queryKey: [K] });
  const salvar = useMutation({
    mutationFn: async ({ tabela, dados }: { tabela: Tabela; dados: Record<string, unknown> }) => {
      const { id, ...resto } = dados as { id?: string };
      const r = id
        ? await sb.from(tabela).update(resto).eq("id", id).select("*").maybeSingle()
        : await sb.from(tabela).insert(resto).select("*").maybeSingle();
      erro(r.error);
      return r.data as Record<string, unknown>;
    },
    onSuccess: invalidar,
  });
  const excluir = useMutation({
    mutationFn: async ({ tabela, id }: { tabela: Tabela; id: string }) => {
      const { error } = await sb.from(tabela).delete().eq("id", id);
      erro(error);
    },
    onSuccess: invalidar,
  });
  /** Várias posições de uma vez ("Salvar rascunho"). */
  const posicoes = useMutation({
    mutationFn: async (lista: { id: string; pos_x: number; pos_y: number }[]) => {
      for (const p of lista) {
        const { error } = await sb.from("ORG_PROC_PROCESSO").update({ pos_x: Math.round(p.pos_x), pos_y: Math.round(p.pos_y) }).eq("id", p.id);
        erro(error);
      }
    },
    onSuccess: invalidar,
  });
  const publicar = useMutation({
    mutationFn: async (observacao: string) => {
      const { data, error } = await sb.rpc("org_proc_publicar", { p_observacao: observacao || null });
      erro(error);
      return Number(data);
    },
    onSuccess: invalidar,
  });
  return { salvar, excluir, posicoes, publicar };
}

export function useDocumentosProcesso() {
  const qc = useQueryClient();
  const anexar = useMutation({
    mutationFn: async ({ processoId, arquivos, autor }: { processoId: string; arquivos: File[]; autor: string | null }) => {
      for (const f of arquivos) {
        const limpo = f.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
        const caminho = `${processoId}/${Date.now()}-${limpo || "arquivo"}`;
        const up = await supabase.storage.from(BUCKET_ORG_PROCESSOS).upload(caminho, f, { upsert: false, contentType: f.type || undefined });
        if (up.error) throw new Error(`${f.name}: ${up.error.message}`);
        const { error } = await sb.from("ORG_PROC_DOCUMENTO").insert({
          processo_id: processoId, nome_arquivo: f.name, storage_path: caminho, mime_type: f.type || null, tamanho_bytes: f.size, enviado_por: autor,
        });
        if (error) { await supabase.storage.from(BUCKET_ORG_PROCESSOS).remove([caminho]); throw new Error(error.message); }
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
  const remover = useMutation({
    mutationFn: async ({ id, path }: { id: string; path: string }) => {
      const { error } = await sb.from("ORG_PROC_DOCUMENTO").delete().eq("id", id);
      erro(error);
      await supabase.storage.from(BUCKET_ORG_PROCESSOS).remove([path]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [K] }),
  });
  return { anexar, remover };
}

export async function urlDocumentoProcesso(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(BUCKET_ORG_PROCESSOS).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}
