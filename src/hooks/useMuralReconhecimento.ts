import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useAuth } from "@/hooks/useAuth";
import { filtrarMural, type StatusMural } from "@/lib/formularios/muralReconhecimento";

// RPCs fora do types.ts gerado: mesmo padrão de FormularioRespostas.
const sb = supabase as unknown as SupabaseClient;

/**
 * Mural de Reconhecimento (migration 20261030003200).
 *
 * Tudo por RPC: CS_FORM_MURAL_RECONHECIMENTO é fechada a anon/authenticated e
 * as respostas do formulário são anônimas — quem decide o que sai (positivo,
 * liberado, mês anterior em Brasília) é o banco. O front só repete o filtro
 * de `lib/formularios/muralReconhecimento` como segunda checagem.
 */

export interface ItemMuralInicio {
  chave: string;
  colaborador: string;
  setor: string | null;
  cargo: string | null;
  avatar_url: string | null;
  nota: string | null;
  escala: number;
  comentario: string;
  formulario: string;
  enviado_em: string;
  status: StatusMural;
}

export interface ItemModeracao {
  resposta_id: string;
  pergunta_id: string;
  linha: number;
  colaborador: string;
  setor: string | null;
  nota: string | null;
  escala: number;
  comentario: string;
  enviado_em: string;
  status: StatusMural;
  decidido_em: string | null;
  decidido_por: string | null;
}

const CHAVE_INICIO = "mural-reconhecimento-inicio";
const CHAVE_MODERACAO = "mural-reconhecimento-moderacao";

/** O que o cartão do Início mostra. Erro (RPC ainda não aplicada) = cartão some. */
export function useMuralInicio() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [CHAVE_INICIO, user?.id],
    enabled: !!user?.id,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<{ mes: string; itens: ItemMuralInicio[] }> => {
      const { data, error } = await sb.rpc("cs_form_mural_inicio");
      if (error) throw error;
      const itens = (data?.itens ?? []) as ItemMuralInicio[];
      return { mes: String(data?.mes ?? ""), itens: filtrarMural(itens) };
    },
  });
}

/** Fila de moderação de um formulário num mês ("AAAA-MM"). */
export function useMuralModeracao(formId: string | undefined, mes: string, ativo: boolean) {
  return useQuery({
    queryKey: [CHAVE_MODERACAO, formId, mes],
    enabled: !!formId && ativo,
    queryFn: async (): Promise<ItemModeracao[]> => {
      const { data, error } = await sb.rpc("cs_form_mural_moderacao", { _form_id: formId, _mes: `${mes}-01` });
      if (error) throw error;
      return (data ?? []) as ItemModeracao[];
    },
  });
}

/** Liberar / recusar / voltar a pendente — uma ou várias linhas. */
export function useDecidirMural() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itens, status }: { itens: Pick<ItemModeracao, "resposta_id" | "pergunta_id" | "linha">[]; status: StatusMural }) => {
      for (const i of itens) {
        const { error } = await sb.rpc("cs_form_mural_decidir", {
          _resposta_id: i.resposta_id, _pergunta_id: i.pergunta_id, _linha: i.linha, _status: status,
        });
        if (error) throw error;
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [CHAVE_MODERACAO] });
      qc.invalidateQueries({ queryKey: [CHAVE_INICIO] });
    },
  });
}
