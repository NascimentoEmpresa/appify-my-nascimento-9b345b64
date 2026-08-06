import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtiva } from "@/context/EmpresaAtivaContext";
import { useAuth } from "@/hooks/useAuth";

export type CotacaoStatus = "pendente" | "visualizado" | "respondido";
export type LadoCotacao = "solicitacao" | "resposta";

/** Anexo em `cotacoes_licitacao_arquivo` — N por lado (20260826000001). */
export type AnexoCotacao = {
  id: string;
  cotacao_id: string;
  lado: LadoCotacao;
  caminho: string;
  nome: string;
  tamanho: number | null;
  enviado_por_nome: string | null;
  created_at: string;
};

export type CotacaoLicitacao = {
  id: string;
  empresa_id: string;
  tipo: string;
  comentario: string;
  remetente_id: string | null;
  remetente_nome: string | null;
  status: CotacaoStatus;
  visualizado_por_id: string | null;
  visualizado_por_nome: string | null;
  visualizado_em: string | null;
  resposta_comentario: string | null;
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
  /** Anexos já separados por lado; vêm resolvidos na própria query da lista. */
  anexosSolicitacao: AnexoCotacao[];
  anexosResposta: AnexoCotacao[];
};

// `cotacoes_licitacao` e as RPCs sup_cot_* ainda não constam de
// integrations/supabase/types.ts (gerado a partir do banco). Sem este recorte
// o arquivo acumula ~15 erros de tipo. Mesma solução dos outros hooks do
// módulo (useSupPatrimonio, useSupPedidos): storage e auth seguem tipados, só
// o acesso a estas tabelas passa pelo cast.
const sb = supabase as any;

const BUCKET = "cotacoes-arquivos";

/**
 * Link temporário de download.
 *
 * Sempre com `download`, nunca abrindo na aba: o canal aceita QUALQUER
 * extensão, e um .html ou .svg renderizado a partir do storage executaria
 * script no navegador de quem clicou. Forçar o download tira essa
 * possibilidade sem limitar o que o usuário pode anexar — e de quebra o
 * arquivo chega com o nome original em vez do caminho aleatório.
 */
export async function urlAssinada(caminho: string, nome?: string): Promise<string | null> {
  if (!caminho) return null;
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(caminho, 3600, { download: nome || true });
  if (error) return null;
  return data.signedUrl;
}

/** Sobe os arquivos e devolve o que gravar em `cotacoes_licitacao_arquivo`. */
export async function uploadArquivos(files: File[], empresaId: string) {
  const subidos: { caminho: string; nome: string; tamanho: number }[] = [];
  for (const file of files) {
    const ext = file.name.includes(".") ? "." + file.name.split(".").pop() : "";
    const caminho = `${empresaId}/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(caminho, file);
    if (error) throw error;
    subidos.push({ caminho, nome: file.name, tamanho: file.size });
  }
  return subidos;
}

async function gravarAnexos(
  cotacaoId: string, lado: LadoCotacao,
  arquivos: { caminho: string; nome: string; tamanho: number }[],
  userId: string | null, userNome: string | null,
) {
  if (!arquivos.length) return;
  const { error } = await sb.from("cotacoes_licitacao_arquivo").insert(
    arquivos.map((a) => ({
      cotacao_id: cotacaoId, lado,
      caminho: a.caminho, nome: a.nome, tamanho: a.tamanho,
      enviado_por: userId, enviado_por_nome: userNome,
    })),
  );
  if (error) throw error;
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

      const cotacoes = (data ?? []) as CotacaoLicitacao[];
      if (!cotacoes.length) return [];

      // Uma query só para todos os anexos da página, agrupada no cliente —
      // evita N+1 conforme o histórico cresce.
      const { data: anexos, error: erroAnexos } = await sb
        .from("cotacoes_licitacao_arquivo")
        .select("*")
        .in("cotacao_id", cotacoes.map((c) => c.id))
        .order("created_at", { ascending: true });
      if (erroAnexos) throw erroAnexos;

      const porCotacao = new Map<string, AnexoCotacao[]>();
      for (const a of (anexos ?? []) as AnexoCotacao[]) {
        if (!porCotacao.has(a.cotacao_id)) porCotacao.set(a.cotacao_id, []);
        porCotacao.get(a.cotacao_id)!.push(a);
      }

      return cotacoes.map((c) => {
        const lista = porCotacao.get(c.id) ?? [];
        return {
          ...c,
          anexosSolicitacao: lista.filter((a) => a.lado === "solicitacao"),
          anexosResposta: lista.filter((a) => a.lado === "resposta"),
        };
      });
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
      arquivos: File[];
      remetente_nome: string;
    }) => {
      const subidos = await uploadArquivos(payload.arquivos, empresa.id);
      const { data, error } = await sb.from("cotacoes_licitacao").insert({
        empresa_id: empresa.id,
        tipo: payload.tipo,
        comentario: payload.comentario,
        remetente_id: user?.id ?? null,
        remetente_nome: payload.remetente_nome,
        status: "pendente",
      }).select("id").single();
      if (error) throw error;
      await gravarAnexos(data.id, "solicitacao", subidos, user?.id ?? null, payload.remetente_nome);
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
      arquivos: File[];
      editado_por_nome: string;
      editado_por_id: string;
    }) => {
      const subidos = await uploadArquivos(payload.arquivos, empresa.id);
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
        })
        .eq("id", payload.id);
      if (error) throw error;
      await gravarAnexos(payload.id, "solicitacao", subidos, payload.editado_por_id, payload.editado_por_nome);
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

/** Tira um anexo já gravado. A RLS só deixa mexer no anexo do próprio lado. */
export function useCotacaoRemoverAnexo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (anexoId: string) => {
      const { data, error } = await sb
        .from("cotacoes_licitacao_arquivo").delete().eq("id", anexoId).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Você não tem permissão para remover este anexo.");
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
 * Lado de Compras — a resposta. Comentário e ao menos um arquivo são
 * obrigatórios (§7.2): não existe resposta sem o documento que a Licitação vai
 * anexar ao processo.
 *
 * O nome do respondente sai de `profiles` dentro da RPC, nunca daqui.
 */
export function useCotacaoResponder() {
  const qc = useQueryClient();
  const { empresa } = useEmpresaAtiva();

  return useMutation({
    mutationFn: async (payload: { id: string; comentario: string; arquivos: File[] }) => {
      const subidos = await uploadArquivos(payload.arquivos, empresa.id);
      const { error } = await sb.rpc("sup_cot_responder", {
        p_id: payload.id,
        p_comentario: payload.comentario,
        p_arquivos: subidos,
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
