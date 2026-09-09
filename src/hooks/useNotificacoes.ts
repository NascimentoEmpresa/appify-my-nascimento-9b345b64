import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  MENU_PUBLICAR, TABELA, TABELA_CIENCIA, pendentesDe,
  type CienciaNotificacao, type Escolha, type FormNotificacao, type Notificacao,
} from "@/lib/notificacoes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

/**
 * Notificações com ciência — uma fonte só para as duas superfícies: o modal
 * que trava a tela de quem recebe e a tela de gestão de quem publica.
 *
 * Quem pode publicar sai do MESMO gerenciamento de acesso do resto do ERP
 * (`novidades_publicar`). Isto aqui é heurística de UI (esconder botão); quem
 * recusa de verdade é a RLS.
 */
export function useNotificacoes() {
  const { user } = useAuth();
  const meuNome = useMeuNome();
  const { can } = usePermissoes();
  const qc = useQueryClient();

  const podePublicar = can("incluir", undefined, MENU_PUBLICAR);

  const listaQ = useQuery({
    queryKey: ["notificacoes"],
    staleTime: 60_000,
    queryFn: async (): Promise<Notificacao[]> => {
      // Sem filtro por `publicado`: a RLS já devolve rascunho só para quem
      // publica, e filtrar aqui esconderia o rascunho de quem o criou.
      const { data, error } = await sb.from(TABELA).select("*").order("publicado_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Notificacao[];
    },
  });

  /** O que EU já respondi — é o que decide se o modal aparece. */
  const minhasQ = useQuery({
    queryKey: ["notificacoes_minhas", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<CienciaNotificacao[]> => {
      const { data, error } = await sb.from(TABELA_CIENCIA).select("*").eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []) as CienciaNotificacao[];
    },
  });

  /** O histórico completo — só quem publica enxerga (a RLS confirma). */
  const historicoQ = useQuery({
    queryKey: ["notificacoes_historico"],
    enabled: podePublicar,
    staleTime: 30_000,
    queryFn: async (): Promise<CienciaNotificacao[]> => {
      const { data, error } = await sb
        .from(TABELA_CIENCIA)
        .select("*")
        .order("respondido_em", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CienciaNotificacao[];
    },
  });

  const salvar = useMutation({
    mutationFn: async (f: FormNotificacao) => {
      const linha = {
        titulo: f.titulo.trim(),
        mensagem: f.mensagem.trim(),
        publicado: f.publicado,
        criado_por_nome: meuNome ?? null,
      };
      const { error } = f.id
        ? await sb.from(TABELA).update(linha).eq("id", f.id)
        : await sb.from(TABELA).insert(linha);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notificacoes"] }),
  });

  const excluir = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from(TABELA).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes"] });
      qc.invalidateQueries({ queryKey: ["notificacoes_historico"] });
    },
  });

  /**
   * A resposta da pessoa. Grava e some da frente dela.
   *
   * `insert` puro, sem upsert: a chave é (notificação, pessoa) e responder
   * duas vezes tem que ser recusado pelo banco. Registro de ciência que se
   * sobrescreve não serve como registro de ciência.
   */
  const responder = useMutation({
    mutationFn: async ({ id, escolha }: { id: number; escolha: Escolha }) => {
      const { error } = await sb.from(TABELA_CIENCIA).insert({
        notificacao_id: id,
        user_id: user?.id,
        escolha,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes_minhas"] });
      qc.invalidateQueries({ queryKey: ["notificacoes_historico"] });
    },
  });

  const notificacoes = listaQ.data ?? [];
  const minhas = minhasQ.data ?? [];

  return {
    notificacoes,
    historico: historicoQ.data ?? [],
    pendentes: pendentesDe(notificacoes, minhas),
    carregando: listaQ.isLoading || minhasQ.isLoading,
    podePublicar,
    salvar,
    excluir,
    responder,
  };
}
