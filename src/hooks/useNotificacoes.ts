import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  MENU_PUBLICAR, MENU_QUADRO, TABELA, TABELA_CIENCIA, bloqueantesDe, pendentesDe,
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

  /**
   * Quem publica Novidades continua publicando aviso — era assim antes do
   * Quadro existir, e tirar isso obrigaria a reconfigurar o acesso de quem já
   * usava. O menu do Quadro entra AO LADO, com uma capacidade por ação, e é
   * ele que permite dar o quadro a quem não mexe no changelog do ERP.
   *
   * Isto é heurística de UI (esconder botão). Quem recusa de verdade é a RLS,
   * pela função pode_gerir_avisos.
   */
  const podePublicar = can("incluir", undefined, MENU_PUBLICAR);
  const podeVerQuadro = podePublicar || can("visualizar", undefined, MENU_QUADRO);
  const podeCriar = podePublicar || can("incluir", undefined, MENU_QUADRO);
  const podeEditar = podePublicar || can("alterar", undefined, MENU_QUADRO);
  const podeExcluir = podePublicar || can("excluir", undefined, MENU_QUADRO);

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
    enabled: podeVerQuadro,
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
        categoria: f.categoria || null,
        resumo: f.resumo.trim() || null,
        // Vazio é "não expira" — string vazia em coluna timestamptz estoura
        // no Postgres ("invalid input syntax"), a ausência é NULL.
        expira_em: f.expira_em ? f.expira_em : null,
        publico_alvo: f.publico_alvo || "todos",
        exigir_ciencia: f.exigir_ciencia,
        // Bloquear sem exigir ciência prenderia a pessoa num aviso sem botão
        // de saída; o formulário recusa, e aqui o valor é normalizado também,
        // porque a tela não é o único caminho até esta função.
        bloquear_acesso: f.exigir_ciencia && f.bloquear_acesso,
        permitir_escolha: f.permitir_escolha,
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
    mutationFn: async (
      { id, escolha, observacao, lidoEm }:
      { id: number; escolha: Escolha; observacao?: string; lidoEm?: string },
    ) => {
      const { error } = await sb.from(TABELA_CIENCIA).insert({
        notificacao_id: id,
        user_id: user?.id,
        escolha,
        observacao: observacao?.trim() || null,
        // Quando o aviso abriu na frente da pessoa. A distância até
        // respondido_em é o que separa quem leu de quem só tirou da frente.
        lido_em: lidoEm ?? new Date().toISOString(),
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
    minhas,
    /** Pede ciência e ainda não foi respondido — aparece para a pessoa. */
    pendentes: pendentesDe(notificacoes, minhas),
    /** Desses, os que travam a tela até responder. */
    bloqueantes: bloqueantesDe(notificacoes, minhas),
    carregando: listaQ.isLoading || minhasQ.isLoading,
    podePublicar,
    podeVerQuadro,
    podeCriar,
    podeEditar,
    podeExcluir,
    salvar,
    excluir,
    responder,
  };
}
