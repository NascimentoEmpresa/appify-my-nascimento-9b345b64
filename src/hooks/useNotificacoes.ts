import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useMeuNome } from "@/hooks/useMeuNome";
import { usePermissoes } from "@/context/PermissoesContext";
import {
  BUCKET_ANEXOS, MENU_PUBLICAR, MENU_QUADRO, TABELA, TABELA_ALVO, TABELA_CIENCIA,
  bloqueantesDe, pendentesDe,
  type AlvoNotificacao, type CienciaNotificacao, type Escolha,
  type FormNotificacao, type Notificacao,
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

  /**
   * Para quem é cada aviso.
   *
   * A lista de avisos JÁ chega recortada (a RLS chama notificacao_para_mim),
   * então isto não filtra nada: serve para o formulário de quem publica e
   * para a tela poder dizer "este aviso foi para RH e Financeiro".
   */
  const alvosQ = useQuery({
    queryKey: ["notificacoes_alvos"],
    staleTime: 60_000,
    queryFn: async (): Promise<AlvoNotificacao[]> => {
      const { data, error } = await sb.from(TABELA_ALVO).select("*");
      if (error) throw error;
      return (data ?? []) as AlvoNotificacao[];
    },
  });

  /** Setores do catálogo — a mesma fonte que o resto do ERP usa. */
  const setoresQ = useQuery({
    queryKey: ["setor_catalogo"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await sb.from("setor_catalogo").select("nome").order("nome");
      if (error) throw error;
      return (data ?? []).map((x: { nome: string }) => x.nome);
    },
  });

  /** As pessoas, para mandar um aviso nominal. Só quem publica precisa. */
  const pessoasQ = useQuery({
    queryKey: ["notificacoes_pessoas"],
    enabled: podeCriar || podeEditar,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ id: string; nome: string }[]> => {
      const { data, error } = await sb
        .from("profiles")
        .select("id,display_name,email")
        .order("display_name");
      if (error) throw error;
      return (data ?? []).map((x: { id: string; display_name: string | null; email: string | null }) => ({
        id: x.id,
        nome: x.display_name || x.email || "(sem nome)",
      }));
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
        // Sem imagem é NULL, não string vazia: a tela testa a coluna para
        // decidir se desenha o bloco, e "" é um valor que passa no if.
        anexo_url: f.anexo_url.trim() || null,
        anexo_nome: f.anexo_nome.trim() || null,
        exigir_ciencia: f.exigir_ciencia,
        // publico_alvo saiu na 081: a verdade é a tabela de alvos, e ter as
        // duas era duas fontes para a mesma pergunta.
        // Bloquear sem exigir ciência prenderia a pessoa num aviso sem botão
        // de saída; o formulário recusa, e aqui o valor é normalizado também,
        // porque a tela não é o único caminho até esta função.
        bloquear_acesso: f.exigir_ciencia && f.bloquear_acesso,
        permitir_escolha: f.permitir_escolha,
        criado_por_nome: meuNome ?? null,
      };
      let id = f.id;
      if (id) {
        const { error } = await sb.from(TABELA).update(linha).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await sb.from(TABELA).insert(linha).select("id").single();
        if (error) throw error;
        id = data.id as number;
      }

      // Apaga e reinsere, em vez de calcular o que entrou e o que saiu: são
      // poucas linhas, e o diff seria código novo só para errar em silêncio.
      const { error: erroApagar } = await sb.from(TABELA_ALVO).delete().eq("notificacao_id", id);
      if (erroApagar) throw erroApagar;

      const alvos = [
        ...f.setores.map((setor) => ({ notificacao_id: id, setor, user_id: null })),
        ...f.usuarios.map((user_id) => ({ notificacao_id: id, setor: null, user_id })),
      ];
      if (alvos.length) {
        const { error } = await sb.from(TABELA_ALVO).insert(alvos);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes"] });
      qc.invalidateQueries({ queryKey: ["notificacoes_alvos"] });
    },
  });

  /**
   * Sobe a imagem do aviso e devolve a URL pública.
   *
   * Não apaga a anterior ao trocar: o arquivo velho pode estar sendo servido
   * para quem já tem o aviso aberto na tela, e uma imagem que some no meio de
   * um comunicado que trava o sistema é pior que um arquivo órfão no bucket.
   */
  const subirAnexo = async (arquivo: File): Promise<string> => {
    const ext = arquivo.name.split(".").pop()?.toLowerCase() || "png";
    const caminho = `avisos/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from(BUCKET_ANEXOS)
      .upload(caminho, arquivo, { upsert: false, contentType: arquivo.type || undefined });
    if (error) throw error;
    return supabase.storage.from(BUCKET_ANEXOS).getPublicUrl(caminho).data.publicUrl;
  };

  const excluir = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from(TABELA).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notificacoes"] });
      qc.invalidateQueries({ queryKey: ["notificacoes_historico"] });
      qc.invalidateQueries({ queryKey: ["notificacoes_alvos"] });
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
    alvos: alvosQ.data ?? [],
    setores: setoresQ.data ?? [],
    pessoas: pessoasQ.data ?? [],
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
    subirAnexo,
  };
}
