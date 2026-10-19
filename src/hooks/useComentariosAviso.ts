import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  LIMITE_COMENTARIOS, MENU_PUBLICAR, MENU_QUADRO, TABELA_COMENTARIO, TABELA_REACAO,
  type ComentarioAviso, type ReacaoAviso,
} from "@/lib/notificacoes";

// As tabelas novas ainda não estão no types.ts gerado.
const sb = supabase as any;

/**
 * Comentários e reações de UM aviso (16/10/2026).
 *
 * Só busca quando o aviso está aberto E aceita comentários (`habilitado`):
 * o banco andou caindo no dia em que isto nasceu, e o gate abre para todo
 * mundo ao entrar — carregar comentário de aviso fechado, ou de aviso que nem
 * aceita, seria consulta à toa multiplicada por cada login.
 *
 * Os últimos LIMITE_COMENTARIOS, mais novos primeiro no banco e invertidos na
 * tela (conversa se lê de cima para baixo). Reações: só as colunas que a
 * contagem usa.
 *
 * Quem lê e quem grava é a RLS (aviso_pode_ver / aviso_pode_comentar) — aqui
 * é só a tela.
 */
export function useComentariosAviso(notificacaoId: number, habilitado: boolean) {
  const { user } = useAuth();
  const { can } = usePermissoes();
  const qc = useQueryClient();
  const chave = ["aviso_comentarios", notificacaoId];
  const chaveReacoes = ["aviso_reacoes", notificacaoId];

  /** Heurística de UI para mostrar o "apagar" em comentário dos outros. */
  const podeModerar = can("incluir", undefined, MENU_PUBLICAR) || can("excluir", undefined, MENU_QUADRO);

  const comentariosQ = useQuery({
    queryKey: chave,
    enabled: habilitado && notificacaoId > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<ComentarioAviso[]> => {
      const { data, error } = await sb
        .from(TABELA_COMENTARIO)
        .select("id,notificacao_id,user_id,autor_nome,anonimo,texto,criado_em")
        .eq("notificacao_id", notificacaoId)
        .order("criado_em", { ascending: false })
        .limit(LIMITE_COMENTARIOS);
      if (error) throw error;
      return ((data ?? []) as ComentarioAviso[]).reverse();
    },
  });

  const reacoesQ = useQuery({
    queryKey: chaveReacoes,
    enabled: habilitado && notificacaoId > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<ReacaoAviso[]> => {
      const { data, error } = await sb
        .from(TABELA_REACAO)
        .select("id,comentario_id,user_id,emoji")
        .eq("notificacao_id", notificacaoId)
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as ReacaoAviso[];
    },
  });

  const comentar = useMutation({
    mutationFn: async ({ texto, anonimo }: { texto: string; anonimo: boolean }) => {
      // Sem user_id/autor_nome: quem preenche (ou apaga, no anônimo) é o
      // gatilho do banco. Mandar daqui seria fingir que o navegador decide.
      const { error } = await sb.from(TABELA_COMENTARIO).insert({
        notificacao_id: notificacaoId, texto: texto.trim(), anonimo,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chave }),
  });

  const apagar = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from(TABELA_COMENTARIO).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chave });
      qc.invalidateQueries({ queryKey: chaveReacoes });
    },
  });

  /** Liga/desliga a MINHA reação com aquele emoji, no aviso (null) ou num comentário. */
  const reagir = useMutation({
    mutationFn: async ({ emoji, comentarioId }: { emoji: string; comentarioId: number | null }) => {
      const minha = (reacoesQ.data ?? []).find((r) =>
        r.user_id === user?.id && r.emoji === emoji && (r.comentario_id ?? null) === comentarioId);
      if (minha) {
        const { error } = await sb.from(TABELA_REACAO).delete().eq("id", minha.id);
        if (error) throw error;
        return;
      }
      const { error } = await sb.from(TABELA_REACAO).insert({
        notificacao_id: notificacaoId, comentario_id: comentarioId, emoji,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: chaveReacoes }),
  });

  return {
    comentarios: comentariosQ.data ?? [],
    reacoes: reacoesQ.data ?? [],
    carregando: comentariosQ.isLoading,
    erro: comentariosQ.error as Error | null,
    eu: user?.id ?? null,
    podeModerar,
    comentar, apagar, reagir,
  };
}
