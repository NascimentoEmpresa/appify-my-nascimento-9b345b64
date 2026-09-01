import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const sb = supabase as any;

/**
 * Aniversariantes do Início.
 *
 * Tudo passa por RPC (`rh_aniversariantes`, `rh_aniversario_mural`,
 * `rh_aniversario_felicitar`) porque a EMPREGADOS é fechada por RLS e porque
 * o banco é quem decide o que é "hoje": o relógio do navegador da recepção
 * já foi encontrado três horas adiantado, e um aniversário que começa cedo
 * demais deixa o mural aberto no dia errado. Ver a migration
 * 20260930000024 para a regra completa.
 *
 * A lista NÃO traz o ano de nascimento — só dia e mês. Idade é dado pessoal.
 */

export type ReacaoChave = "festa" | "bolo" | "coracao" | "palmas" | "brinde";

/** As reações e o desenho de cada uma. Trocar o emoji aqui não pede migration:
 *  o banco guarda a chave, não o caractere. */
export const REACOES: { chave: ReacaoChave; emoji: string; titulo: string }[] = [
  { chave: "festa",   emoji: "🎉", titulo: "Parabéns!" },
  { chave: "bolo",    emoji: "🎂", titulo: "Feliz aniversário" },
  { chave: "coracao", emoji: "❤️", titulo: "Com carinho" },
  { chave: "palmas",  emoji: "👏", titulo: "Sucesso sempre" },
  { chave: "brinde",  emoji: "🥳", titulo: "Bora comemorar" },
];

export const EMOJI_REACAO: Record<string, string> =
  Object.fromEntries(REACOES.map((r) => [r.chave, r.emoji]));

export interface Aniversariante {
  user_id: string;
  nome: string;
  avatar_url: string | null;
  cargo: string;
  setor: string;
  dia: number;
  mes: number;
  /** 0 = hoje. */
  dias_ate: number;
}

export interface Felicitacao {
  aniversariante: string;
  autor: string;
  autor_nome: string;
  autor_avatar: string | null;
  reacao: ReacaoChave | null;
  mensagem: string | null;
  criado_em: string;
  sou_eu: boolean;
}

const CHAVE_LISTA = "aniversariantes";
const CHAVE_MURAL = "aniversariantes-mural";

export function useAniversariantes(dias = 15) {
  const { user } = useAuth();

  const listaQ = useQuery({
    queryKey: [CHAVE_LISTA, dias],
    enabled: !!user?.id,
    // A lista muda uma vez por dia; revalidar de minuto em minuto seria
    // gastar requisição na tela que mais fica aberta no ERP.
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<Aniversariante[]> => {
      const { data, error } = await sb.rpc("rh_aniversariantes", { _dias: dias });
      if (error) throw error;
      return (data ?? []) as Aniversariante[];
    },
  });

  const deHoje = useMemo(
    () => (listaQ.data ?? []).filter((a) => a.dias_ate === 0),
    [listaQ.data],
  );
  const emBreve = useMemo(
    () => (listaQ.data ?? []).filter((a) => a.dias_ate > 0),
    [listaQ.data],
  );

  const muralQ = useQuery({
    queryKey: [CHAVE_MURAL],
    // Sem aniversariante hoje não existe mural — não vale a ida ao servidor.
    enabled: !!user?.id && deHoje.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<Felicitacao[]> => {
      const { data, error } = await sb.rpc("rh_aniversario_mural");
      if (error) throw error;
      return (data ?? []) as Felicitacao[];
    },
  });

  return {
    deHoje,
    emBreve,
    mural: muralQ.data ?? [],
    carregando: listaQ.isLoading,
    carregandoMural: muralQ.isLoading,
  };
}

/**
 * Grava o estado COMPLETO da minha felicitação (reação + recado) para uma
 * pessoa. Mandar os dois juntos é de propósito: assim ligar/desligar a
 * reação não apaga um recado já escrito, e vice-versa.
 */
export function useFelicitar() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (args: {
      aniversariante: string;
      reacao: ReacaoChave | null;
      mensagem: string | null;
    }) => {
      const { data, error } = await sb.rpc("rh_aniversario_felicitar", {
        _aniversariante: args.aniversariante,
        _reacao: args.reacao,
        _mensagem: args.mensagem,
      });
      if (error) throw error;
      if (data && data.ok === false) throw new Error(data.error ?? "Não deu para enviar.");
      return data;
    },

    // Otimista: a reação tem que acender no clique. Ida e volta ao Supabase
    // num cartão de mural é lento o bastante para a pessoa clicar duas vezes.
    onMutate: async (args) => {
      await qc.cancelQueries({ queryKey: [CHAVE_MURAL] });
      const anterior = qc.getQueryData<Felicitacao[]>([CHAVE_MURAL]) ?? [];
      const semAMinha = anterior.filter(
        (f) => !(f.aniversariante === args.aniversariante && f.autor === user?.id),
      );
      const vazia = !args.reacao && !args.mensagem?.trim();
      const otimista: Felicitacao[] = vazia
        ? semAMinha
        : [
            ...semAMinha,
            {
              aniversariante: args.aniversariante,
              autor: user?.id ?? "",
              autor_nome: "Você",
              autor_avatar: null,
              reacao: args.reacao,
              mensagem: args.mensagem?.trim() || null,
              criado_em: new Date().toISOString(),
              sou_eu: true,
            },
          ];
      qc.setQueryData([CHAVE_MURAL], otimista);
      return { anterior };
    },

    onError: (_e, _args, ctx) => {
      if (ctx?.anterior) qc.setQueryData([CHAVE_MURAL], ctx.anterior);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [CHAVE_MURAL] });
    },
  });
}
