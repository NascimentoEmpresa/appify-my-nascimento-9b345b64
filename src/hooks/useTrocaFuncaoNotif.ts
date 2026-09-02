import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// =====================================================================
// A BOLINHA DA MUDANÇA DE FUNÇÃO
//
// "Tem coisa para mim" = existe solicitação parada no MEU status. Só isso.
//
// Por que não copiei o desenho dos Chamados (que compara `updated_at` com um
// "visto" no localStorage): lá a bolinha avisa NOVIDADE numa conversa que vai
// e volta. Aqui é fila de trabalho — enquanto houver alguém esperando decisão,
// a bolinha tem que continuar acesa, mesmo que a pessoa já tenha aberto a tela
// e saído sem decidir. Marcar como "visto" esconderia trabalho pendente, que é
// o oposto do que o Pablo pediu ("sempre que tiver uma solicitação mostrar
// notificação no módulo").
//
// Uma consulta só, agregando os status, porque a sidebar precisa de todos ao
// mesmo tempo e um count por fila seria um round-trip por fila a cada
// navegação.
//
// A fila do ANALISTA entrou em 02/09/2026 e é a primeira do fluxo. A rota do
// escritório (`/app/rh/troca-funcao-escritorio`) saiu do menu do RH no mesmo
// dia, mas continua aqui: a rota segue de pé para quem tem a permissão antiga,
// e uma bolinha a menos é trabalho invisível.
// =====================================================================

const sb = supabase as any;

export interface TrocaFuncaoNotif {
  /** rota → tem pendência? É assim que a sidebar consulta. */
  porRota: Record<string, boolean>;
}

const VAZIO: TrocaFuncaoNotif = { porRota: {} };

export function useTrocaFuncaoNotif(): TrocaFuncaoNotif {
  const { data } = useQuery({
    queryKey: ["troca-funcao-notif"],
    // A RLS da tabela é aberta para authenticated (o controle é o menu), então
    // quem não tem a tela liberada nem vê o item — a bolinha não vaza nada.
    queryFn: async (): Promise<TrocaFuncaoNotif> => {
      const { data, error } = await sb
        .from("SISTEMA_SOLICITACOES_TROCA_FUNCAO")
        .select("status, e_escritorio")
        .in("status", ["Pendente Analista", "Pendente Operacional", "Pendente Escritório", "Pendente SST", "Pendente RH"]);
      if (error) return VAZIO;

      const linhas = (data ?? []) as Array<{ status: string; e_escritorio: boolean }>;
      const tem = (f: (l: { status: string; e_escritorio: boolean }) => boolean) => linhas.some(f);

      return {
        porRota: {
          "/app/licitacoes/analistas/troca-funcao": tem(l => l.status === "Pendente Analista"),
          "/app/operacional/troca-funcao":      tem(l => l.status === "Pendente Operacional"),
          "/app/rh/troca-funcao-escritorio":    tem(l => l.status === "Pendente Escritório"),
          "/app/sst/troca-funcao":              tem(l => l.status === "Pendente SST"),
          "/app/rh/troca-funcao":               tem(l => l.status === "Pendente RH"),
        },
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  return data ?? VAZIO;
}
