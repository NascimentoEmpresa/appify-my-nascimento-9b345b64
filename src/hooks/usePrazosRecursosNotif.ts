import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";

type NotificacaoCache = {
  link: string | null;
  lida: boolean;
};

// Bolinha do menu de Prazos, Recursos e Impugnações. A notificação do sino
// identifica quem deve agir; esta bolinha só observa o MESMO cache da Topbar.
// Não faz consulta própria: a Sidebar existe em todas as telas e uma busca aqui
// multiplicaria tráfego pelo ERP inteiro.
export function usePrazosRecursosNotif() {
  const { user } = useAuth();
  const { data = false } = useQuery<NotificacaoCache[], Error, boolean>({
    queryKey: ["notificacoes", user?.id],
    enabled: false,
    select: (notificacoes) => notificacoes.some((notificacao) =>
      !notificacao.lida && notificacao.link?.startsWith("/app/licitacoes/prazos-recursos"),
    ),
  });
  return data;
}
