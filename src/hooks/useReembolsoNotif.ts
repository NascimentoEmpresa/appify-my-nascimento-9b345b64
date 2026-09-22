import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// =====================================================================
// A BOLINHA DO REEMBOLSO
//
// "Tem reembolso para eu aprovar" = existe solicitação pendente num setor
// que eu aprovo. Mesmo desenho da Mudança de Função (useTrocaFuncaoNotif),
// pelo mesmo motivo: é fila de trabalho, não conversa. Enquanto houver
// alguém esperando decisão a bolinha fica acesa, mesmo que a pessoa já tenha
// aberto a tela e saído sem decidir — "visto" esconderia trabalho pendente.
//
// Pedido de 17/09/2026: "alerta como um ícone vermelho igual os outros ao
// lado do nome do módulo, e no sino de notificação". O sino é a trigger
// `cs_reembolso_notifica_novo` (uma notificação por solicitação nova); esta
// bolinha é o estado atual da fila. Os dois se complementam: o sino diz que
// chegou, a bolinha diz que ainda não foi resolvido.
//
// A RPC (`cs_reembolso_alcada_resumo`) devolve dois números e aplica o mesmo
// recorte da fila (menu de aprovação + aprova o setor). Quem não aprova nada
// recebe 0/0 — nada vaza, e não há por que gastar uma consulta em quem nem
// tem a tela: por isso `enabled` só com usuário logado.
// =====================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

export interface ReembolsoNotif {
  /** Pendentes na minha alçada. */
  pendentes: number;
  /** Desses, quantos passaram da meta de 24h sem decisão. */
  atrasados: number;
  /** O que a sidebar consulta. */
  temPendente: boolean;
}

const VAZIO: ReembolsoNotif = { pendentes: 0, atrasados: 0, temPendente: false };

export function useReembolsoNotif(): ReembolsoNotif {
  const { user } = useAuth();
  const { data } = useQuery({
    queryKey: ["reembolso-notif", user?.id ?? ""],
    enabled: !!user?.id,
    queryFn: async (): Promise<ReembolsoNotif> => {
      const { data, error } = await sb.rpc("cs_reembolso_alcada_resumo");
      // RPC ainda não existe no banco (migration não aplicada) ou qualquer
      // outra falha: bolinha apagada, nunca erro na sidebar inteira.
      if (error) return VAZIO;
      const linha = (Array.isArray(data) ? data[0] : data) ?? {};
      const pendentes = Number(linha.pendentes ?? 0) || 0;
      const atrasados = Number(linha.atrasados ?? 0) || 0;
      return { pendentes, atrasados, temPendente: pendentes > 0 };
    },
    staleTime: 60_000,
    // Quem aprova costuma ficar parado numa tela esperando: sonda no mesmo
    // ritmo do sininho (Topbar).
    //
    // 21/09/2026: era 60s, junto com a Topbar. Ambos subiram para 180s depois
    // do reinício do Postgres por esgotamento de conexões — roda na Sidebar,
    // logo em toda tela de todo usuário logado. Quem aprova continua vendo o
    // efeito da própria ação na hora, porque a mutation invalida a query.
    refetchInterval: 180_000,
    refetchOnWindowFocus: true,
  });

  return data ?? VAZIO;
}
