import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// =====================================================================
// A BOLINHA DE APROVAÇÃO PENDENTE NO MENU (06/10/2026, mig 20261006000006)
//
// Pedido: "uma bolinha vermelha, como aparece no Jurídico, quando tem algo
// dependendo da minha aprovação — sem precisar o pessoal avisar ou eu ficar
// entrando a todo momento". Malote, Recrutamento (vagas), Demissões, Plano
// de Ações e Suprimentos.
//
// Mesmo desenho do useJuridicoNotif: acesa enquanto houver fila na etapa que
// EU decido — sem "visto", que esconderia trabalho pendente. A diferença: a
// conta é toda no banco (minhas_pendencias_aprovacao), numa chamada só, que
// devolve { rota do menu: quantidade }. A regra de quem aprova o quê está
// lá, espelhando cada tela/trigger — mudou a regra de uma aprovação, muda lá.
// =====================================================================

export interface AprovacoesNotif {
  /** rota do item do menu → quantas pendências minhas há lá. */
  porRota: Record<string, number>;
}

const VAZIO: AprovacoesNotif = { porRota: {} };

export function useAprovacoesNotif(): AprovacoesNotif {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["aprovacoes-notif", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    refetchInterval: 5 * 60_000,
    queryFn: async (): Promise<AprovacoesNotif> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("minhas_pendencias_aprovacao");
      // Bolinha é aviso, não tela: falhou, fica apagada em vez de quebrar o menu.
      if (error) return VAZIO;
      return { porRota: (data ?? {}) as Record<string, number> };
    },
  });
  return data ?? VAZIO;
}
