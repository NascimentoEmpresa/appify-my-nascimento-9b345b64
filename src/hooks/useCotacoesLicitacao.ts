import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useAuth } from "@/hooks/useAuth";

export type CotacaoStatus = "pendente" | "visualizado" | "respondido";

export type CotacaoLicitacao = {
  id: string;
  empresa_id: string;
  tipo: string;
  comentario: string;
  arquivo_url: string | null;
  arquivo_nome: string | null;
  remetente_id: string | null;
  remetente_nome: string | null;
  status: CotacaoStatus;
  visualizado_por_id: string | null;
  visualizado_por_nome: string | null;
  visualizado_em: string | null;
  resposta_comentario: string | null;
  resposta_arquivo_url: string | null;
  resposta_arquivo_nome: string | null;
  respondente_id: string | null;
  respondente_nome: string | null;
  data_resposta: string | null;
  resposta_visualizada_por_id: string | null;
  resposta_visualizada_em: string | null;
  editado_por_id: string | null;
  editado_por_nome: string | null;
  editado_em: string | null;
  created_at: string;
  updated_at: string;
};

// `cotacoes_licitacao` e as RPCs sup_cot_* ainda não constam de
// integrations/supabase/types.ts (gerado a partir do banco). Sem este recorte
// o arquivo acumula ~15 erros de tipo. Mesma solução dos outros hooks do
// módulo (useSupPatrimonio, useSupPedidos): storage e auth seguem tipados, só
// o acesso a estas tabelas passa pelo cast.
const sb = supabase as any;

const BUCKET = "cotacoes-arquivos";

/**
 * As colunas `arquivo_url` guardam o CAMINHO no storage, não uma URL — o
 * bucket é privado (20260825000001) porque planilha de cotação traz preço de
 * fornecedor. Linhas antigas guardavam a URL pública inteira; a migration
 * converteu as que existiam, e este helper cobre qualquer sobra.
 */
export function caminhoNoBucket(valor: string | null): string | null {
  if (!valor) return null;
  const marca = `/object/public/${BUCKET}/`;
  const i = valor.indexOf(marca);
  return i >= 0 ? valor.slice(i + marca.length) : valor;
}

/** Link temporário de download. Devolve null se o arquivo sumiu do storage. */
export async function urlAssinada(valor: string | null): Promise<string | null> {
  const path = caminhoNoBucket(valor);
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

async function uploadArquivo(file: File, empresaId: string): Promise<{ path: string; nome: string }> {
  const ext = file.name.split(".").pop();
  const path = `${empresaId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw error;
  return { path, nome: file.name };
}

export function useCotacoesLicitacao() {
  const { empresa } = useEmpresaAtiva();
  const empresaId = empresa?.id ?? null;

  return useQuery({
    queryKey: ["cotacoes_licitacao", empresaId],
    enabled: !!empresaId,
    staleTime: 30_000,
    queryFn: async (): Promise<CotacaoLicitacao[]> => {
      const { data, error } = await sb
        .from("cotacoes_licitacao")
        .select("*")
        .eq("empresa_id", empresaId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CotacaoLicitacao[];
    },
  });
}

export function useCotacaoInsert() {
  const qc = useQueryClient();
  const { empresa } = useEmpresaAtiva();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (payload: {
      tipo: string;
      comentario: string;
      arquivo: File | null;
      remetente_nome: string;
    }) => {
      let arquivo_url: string | null = null;
      let arquivo_nome: string | null = null;
      if (payload.arquivo) {
        const up = await uploadArquivo(payload.arquivo, empresa.id);
        arquivo_url = up.path;
        arquivo_nome = up.nome;
      }
      const { error } = await sb.from("cotacoes_licitacao").insert({
        empresa_id: empresa.id,
        tipo: payload.tipo,
        comentario: payload.comentario,
        arquivo_url,
        arquivo_nome,
        remetente_id: user?.id ?? null,
        remetente_nome: payload.remetente_nome,
        status: "pendente",
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}

export function useCotacaoUpdate() {
  const qc = useQueryClient();
  const { empresa } = useEmpresaAtiva();

  return useMutation({
    mutationFn: async (payload: {
      id: string;
      comentario: string;
      arquivo: File | null;
      editado_por_nome: string;
      editado_por_id: string;
    }) => {
      let extra: Record<string, unknown> = {};
      if (payload.arquivo) {
        const up = await uploadArquivo(payload.arquivo, empresa.id);
        extra = { arquivo_url: up.path, arquivo_nome: up.nome };
      }
      const { error } = await sb
        .from("cotacoes_licitacao")
        .update({
          comentario: payload.comentario,
          editado_por_id: payload.editado_por_id,
          editado_por_nome: payload.editado_por_nome,
          editado_em: new Date().toISOString(),
          // Editar reseta visualização do compras
          visualizado_por_id: null,
          visualizado_por_nome: null,
          visualizado_em: null,
          status: "pendente",
          ...extra,
        })
        .eq("id", payload.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}

export function useCotacaoDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // DELETE barrado pela RLS volta SUCESSO com zero linhas, não erro. Sem o
      // .select() o usuário sem permissão via "excluído" e a linha continuava lá.
      const { data, error } = await sb
        .from("cotacoes_licitacao").delete().eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) {
        throw new Error("Você não tem permissão para excluir esta cotação.");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}

/**
 * Lado de Compras — "ler é o ato de marcar como lido" (§7.4). Abrir um card
 * pendente carimba quem leu e quando; é o que alimenta o "Visualizado por
 * Compras em…" que a tela da Licitação renderiza.
 *
 * A RPC é idempotente (só age sobre `pendente`), então reabrir o card não
 * reescreve a data original.
 */
export function useCotacaoMarcarVisualizada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.rpc("sup_cot_marcar_visualizada", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}

/**
 * Lado de Compras — a resposta. Comentário e arquivo são obrigatórios (§7.2):
 * não existe resposta sem o documento que a Licitação vai anexar ao processo.
 *
 * O nome do respondente sai de `profiles` dentro da RPC, nunca daqui.
 */
export function useCotacaoResponder() {
  const qc = useQueryClient();
  const { empresa } = useEmpresaAtiva();

  return useMutation({
    mutationFn: async (payload: { id: string; comentario: string; arquivo: File }) => {
      const up = await uploadArquivo(payload.arquivo, empresa.id);
      const { error } = await sb.rpc("sup_cot_responder", {
        p_id: payload.id,
        p_comentario: payload.comentario,
        p_arquivo_path: up.path,
        p_arquivo_nome: up.nome,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}

export function useCotacaoMarcarRespostaVista() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb
        .from("cotacoes_licitacao")
        .update({
          resposta_visualizada_por_id: user?.id ?? null,
          resposta_visualizada_em: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "respondido")
        .is("resposta_visualizada_por_id", null);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cotacoes_licitacao"] }),
  });
}
