import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

const sb = supabase as any;

/**
 * Chat geral da empresa — uma sala só, mostrada no Início.
 *
 * A LEITURA passa por RPC (`chat_geral_listar`) porque precisa do nome e da
 * foto de quem escreveu, que moram em `profiles`. A ESCRITA vai direto na
 * tabela: não há o que validar além de "o autor é você", e isso a policy
 * cobra melhor que uma função.
 *
 * ATUALIZAÇÃO POR POLLING, não por realtime. Não existe uma única
 * `supabase.channel()` em todo o `src/` deste ERP — o chat da tela inicial
 * não é o lugar de estrear o mecanismo. 15 segundos é o intervalo: a tela
 * fica aberta o expediente todo em máquina de recepção, e a mensagem que
 * VOCÊ manda aparece na hora (a mutation invalida o cache), então o atraso
 * só vale para mensagem dos outros.
 */

export const CHAVE_CHAT = "chat-geral";
export const LIMITE_TEXTO = 500;

export interface MensagemChat {
  id: number;
  autor: string;
  autor_nome: string;
  autor_avatar: string | null;
  texto: string;
  criado_em: string;
  sou_eu: boolean;
  posso_apagar: boolean;
}

export function useChatGeral(limite = 60) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const listaQ = useQuery({
    queryKey: [CHAVE_CHAT, limite],
    enabled: !!user?.id,
    staleTime: 5_000,
    refetchInterval: 15_000,
    // Voltar para a aba é o momento em que a pessoa mais quer ver o que
    // perdeu — vale a ida ao servidor mesmo dentro do staleTime.
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<MensagemChat[]> => {
      const { data, error } = await sb.rpc("chat_geral_listar", { _limite: limite });
      if (error) throw error;
      return (data ?? []) as MensagemChat[];
    },
  });

  const enviar = useMutation({
    mutationFn: async (texto: string) => {
      const limpo = texto.trim().slice(0, LIMITE_TEXTO);
      if (!limpo) return;
      // `autor` tem DEFAULT auth.uid() no banco — mandar daqui seria repetir
      // (e permitir divergir de) o que a policy já cobra.
      const { error } = await sb.from("SISTEMA_CHAT_GERAL").insert({ texto: limpo });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE_CHAT] }),
  });

  const apagar = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.from("SISTEMA_CHAT_GERAL").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [CHAVE_CHAT] }),
  });

  return {
    mensagens: listaQ.data ?? [],
    carregando: listaQ.isLoading,
    erro: listaQ.error as Error | null,
    enviar,
    apagar,
  };
}
