import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

type ConsultaNotificacoes = {
  eq: (coluna: string, valor: unknown) => ConsultaNotificacoes;
  like: (coluna: string, valor: string) => ConsultaNotificacoes;
  limit: (quantidade: number) => Promise<{ data: { id: string }[] | null; error: Error | null }>;
};

const tabelaNotificacoes = () => (supabase as unknown as {
  from: (tabela: string) => { select: (colunas: string) => ConsultaNotificacoes };
}).from("notificacoes");

// Bolinha do menu de Prazos, Recursos e Impugnações. A notificação do sino
// identifica quem deve agir; esta bolinha mantém o aviso visível no submódulo.
export function usePrazosRecursosNotif() {
  const { user } = useAuth();
  const { data = false } = useQuery({
    queryKey: ["prazos-recursos-notif", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    refetchInterval: 180_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data: notificacoes, error } = await tabelaNotificacoes()
        .select("id")
        .eq("user_id", user!.id)
        .eq("lida", false)
        .like("link", "/app/licitacoes/prazos-recursos%")
        .limit(1);
      if (error) return false;
      return (notificacoes ?? []).length > 0;
    },
  });
  return data;
}
